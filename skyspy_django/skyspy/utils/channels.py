"""
Channel layer utilities for safely sending messages from sync/async contexts.
"""
import logging
import re
import time

from django.conf import settings

logger = logging.getLogger(__name__)

# Pattern for validating group names (alphanumeric, hyphens, underscores only)
GROUP_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]+$')
MAX_GROUP_NAME_LENGTH = 200

# Redis client for sync channel sends (bypasses asyncio entirely)
_redis_client = None


def _get_redis_client():
    """Get or create a sync Redis client for channel sends."""
    global _redis_client
    if _redis_client is None:
        import redis
        redis_url = getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0')
        _redis_client = redis.from_url(redis_url)
    return _redis_client


def _validate_group_name(group: str) -> bool:
    """
    Validate that a group name is safe to use.

    Args:
        group: The group name to validate

    Returns:
        True if valid, False otherwise
    """
    if not group or not isinstance(group, str):
        return False
    if len(group) > MAX_GROUP_NAME_LENGTH:
        return False
    if not GROUP_NAME_PATTERN.match(group):
        return False
    return True


def sync_group_send(channel_layer, group: str, message: dict):
    """
    Send a message to a channel group using sync Redis operations.

    This bypasses the async channels_redis layer entirely to avoid
    event loop conflicts when called from Celery tasks with gevent.

    Replicates how channels_redis.core.RedisChannelLayer.group_send works:
    1. Remove expired channels from the group sorted set
    2. Get all remaining channel names
    3. Serialize using channel_layer's serializer (msgpack with random prefix)
    4. Add the message to each channel's sorted set

    Args:
        channel_layer: The Django Channels layer instance (used for config and serialization)
        group: The group name to send to
        message: The message dict to send
    """
    # Validate group name to prevent injection attacks
    if not _validate_group_name(group):
        logger.warning(f"Rejected invalid group name in sync_group_send: {group!r}")
        return

    try:
        client = _get_redis_client()

        # Get prefix from channel layer (defaults to "asgi")
        prefix = getattr(channel_layer, 'prefix', 'asgi')

        # Group membership is stored in a sorted set with creation time as score
        group_key = f"{prefix}:group:{group}"

        # Get group_expiry from channel layer (default 86400 seconds)
        group_expiry = getattr(channel_layer, 'group_expiry', 86400)

        # Remove expired channels (score < now - group_expiry)
        now = time.time()
        client.zremrangebyscore(group_key, 0, int(now) - group_expiry)

        # Get all remaining channel names
        channel_names = client.zrange(group_key, 0, -1)

        if not channel_names:
            return

        # Add group info to message (channels_redis expects this)
        full_message = {
            "__asgi_group__": group,
            **message,
        }

        # Use channel_layer's serialize method to match the expected format
        # channels_redis uses msgpack with optional random prefix
        payload = channel_layer.serialize(full_message)

        # Get expiry from channel layer config (default 60 seconds)
        expiry = getattr(channel_layer, 'expiry', 60)

        # Get capacity from channel layer (default 100)
        capacity = getattr(channel_layer, 'capacity', 100)

        # Add message to each channel's sorted set (using time as score)
        # channels_redis uses format: {prefix}{channel_name} (full channel name, no colon)
        pipe = client.pipeline()
        for channel_name in channel_names:
            if isinstance(channel_name, bytes):
                channel_name = channel_name.decode('utf-8')

            # Use the FULL channel name, not the non-local name
            # channels_redis send() uses: channel_key = self.prefix + channel
            channel_key = f"{prefix}{channel_name}"

            # Remove old messages (score < now - expiry)
            pipe.zremrangebyscore(channel_key, 0, int(now) - int(expiry))

            # Check capacity and add message if under limit
            # Note: simplified version - real channels_redis uses Lua script
            pipe.zadd(channel_key, {payload: now})
            pipe.expire(channel_key, expiry)
        pipe.execute()

    except Exception as e:
        logger.warning(f"Channel send error: {e}", exc_info=True)
