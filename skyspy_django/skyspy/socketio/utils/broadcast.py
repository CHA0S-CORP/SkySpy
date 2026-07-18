"""
Socket.IO broadcast utilities for Celery integration.

This module provides synchronous broadcast functions that can be called from
Celery tasks (which use gevent) to send messages to Socket.IO clients.

Since python-socketio's AsyncServer is async-only, we bypass it entirely and
publish directly to the Redis pub/sub channel that the Socket.IO Redis manager
subscribes to.

The Redis channel format for python-socketio with Redis manager is:
    socketio/{namespace}

Message format follows Socket.IO's internal protocol (msgpack serialized).
"""

import json
import logging
from threading import Lock

from django.conf import settings

try:
    from redis.exceptions import RedisError

    _REDIS_ERRORS: tuple[type[BaseException], ...] = (RedisError,)
except ImportError:  # pragma: no cover - redis is an optional runtime dependency
    _REDIS_ERRORS = ()

# Redis publish failures: connection/timeout errors (which subclass the builtins in redis-py)
# plus RedisError for protocol/response errors. TypeError/ValueError cover json.dumps() failures
# on a non-serializable data payload.
_BROADCAST_ERRORS = (ConnectionError, OSError, TimeoutError, TypeError, ValueError, *_REDIS_ERRORS)

logger = logging.getLogger(__name__)

# Redis connection pool for sync Socket.IO broadcasts (thread-safe singleton)
_redis_pool = None
_redis_pool_lock = Lock()


def _get_redis_client():
    """
    Get a sync Redis client for Socket.IO broadcasts using connection pooling.

    Uses a connection pool to properly manage connections and support
    automatic reconnection. Each call returns a new Redis client instance
    that shares the underlying connection pool.

    Thread-safe: Uses double-checked locking pattern to ensure only one
    pool is created even under concurrent access.
    """
    global _redis_pool

    # Fast path: pool already exists
    if _redis_pool is not None:
        import redis

        return redis.Redis(connection_pool=_redis_pool)

    # Slow path: need to create pool with lock
    with _redis_pool_lock:
        # Double-check after acquiring lock
        if _redis_pool is None:
            import redis

            redis_url = getattr(settings, "REDIS_URL", "redis://localhost:6379/0")
            pool_size = getattr(settings, "SOCKETIO_REDIS_POOL_SIZE", 50)
            _redis_pool = redis.ConnectionPool.from_url(
                redis_url,
                max_connections=pool_size,
                retry_on_timeout=True,
            )
            logger.info(f"Created Redis connection pool with {pool_size} max connections")

    import redis

    return redis.Redis(connection_pool=_redis_pool)


def _build_socketio_message(
    event: str,
    data: dict,
    room: str | None = None,
    namespace: str = "/",
    skip_sid: str | None = None,
) -> dict:
    """
    Build a Socket.IO message in the format expected by the Redis manager.

    python-socketio's RedisManager expects messages in a specific format
    when published to Redis. The format is:

    {
        "method": "emit",
        "event": <event_name>,
        "data": <event_data>,
        "namespace": <namespace>,
        "room": <room_or_None>,
        "skip_sid": <sid_to_skip_or_None>,
        "callback": None,
        "host_id": <unique_host_id>  # Optional, for identifying sender
    }

    Args:
        event: The event name to emit
        data: The data payload for the event
        room: Optional room to broadcast to (None for all in namespace)
        namespace: The Socket.IO namespace (default '/')
        skip_sid: Optional session ID to skip (useful when broadcasting
                  to all except the sender)

    Returns:
        The message dict ready for serialization
    """
    return {
        "method": "emit",
        "event": event,
        "data": data,
        "namespace": namespace,
        "room": room,
        "skip_sid": skip_sid,
        "callback": None,
    }


def _serialize_message(message: dict) -> bytes:
    """
    Serialize a message for Redis pub/sub.

    python-socketio v5.x AsyncRedisManager expects JSON-serialized messages.
    The _thread method tries json.loads() on received messages.

    Args:
        message: The message dict to serialize

    Returns:
        Serialized message as JSON bytes
    """
    return json.dumps(message).encode("utf-8")


def _get_channel_name(namespace: str = "/") -> str:
    """
    Get the Redis pub/sub channel name for Socket.IO.

    python-socketio's RedisManager uses a single channel named 'socketio'
    for all namespaces. The namespace is included in the message payload,
    not in the channel name.

    Args:
        namespace: The Socket.IO namespace (included in message, not channel)

    Returns:
        The Redis channel name ('socketio')
    """
    # python-socketio uses 'socketio' as the channel for all namespaces
    return "socketio"


def sync_emit(
    event: str,
    data: dict,
    room: str | None = None,
    namespace: str = "/",
    skip_sid: str | None = None,
) -> bool:
    """
    Synchronously emit a Socket.IO event via Redis pub/sub.

    This function is designed to be called from Celery tasks or other
    synchronous contexts (including gevent-based code) that cannot use
    asyncio.

    It publishes directly to the Redis channel that the Socket.IO Redis
    manager subscribes to, bypassing the async server entirely.

    Args:
        event: The event name to emit (e.g., 'aircraft:update', 'alert:new')
        data: The event data payload (must be JSON-serializable)
        room: Optional room to broadcast to. If None, broadcasts to all
              connected clients in the namespace
        namespace: The Socket.IO namespace (default '/')
        skip_sid: Optional session ID to exclude from the broadcast

    Returns:
        True if the message was published successfully, False otherwise

    Example:
        # Broadcast aircraft update to all clients
        sync_emit('aircraft:update', {'icao': 'ABC123', 'alt': 35000})

        # Send alert to a specific room
        sync_emit('alert:new', alert_data, room='alerts')

        # Broadcast to specific namespace
        sync_emit('status', data, namespace='/admin')
    """
    try:
        client = _get_redis_client()

        # Build the message in Socket.IO Redis manager format
        message = _build_socketio_message(
            event=event,
            data=data,
            room=room,
            namespace=namespace,
            skip_sid=skip_sid,
        )

        # Serialize the message
        payload = _serialize_message(message)

        # Get the channel name
        channel = _get_channel_name(namespace)

        # Publish to Redis
        # Note: num_subscribers is the count of Redis pub/sub subscribers
        # (Socket.IO servers), not connected clients. It's normal to be 0
        # if the web server hasn't started or during Celery-only operation.
        client.publish(channel, payload)

        return True

    except _BROADCAST_ERRORS as e:
        logger.warning(
            f"Socket.IO sync_emit error: {e} (event={event}, room={room}, namespace={namespace})", exc_info=True
        )
        return False


def broadcast_to_room(
    room: str,
    event: str,
    data: dict,
    namespace: str = "/",
    skip_sid: str | None = None,
) -> bool:
    """
    Broadcast a Socket.IO event to a specific room.

    This is a convenience wrapper around sync_emit for room-targeted broadcasts.
    Rooms in Socket.IO are arbitrary strings that clients can join/leave.

    Args:
        room: The room name to broadcast to
        event: The event name to emit
        data: The event data payload
        namespace: The Socket.IO namespace (default '/')
        skip_sid: Optional session ID to exclude from the broadcast

    Returns:
        True if the message was published successfully, False otherwise

    Example:
        # Broadcast to aircraft tracking room
        broadcast_to_room('aircraft:live', 'update', aircraft_data)

        # Broadcast alert to alert subscribers
        broadcast_to_room('alerts', 'new', alert_data)
    """
    return sync_emit(
        event=event,
        data=data,
        room=room,
        namespace=namespace,
        skip_sid=skip_sid,
    )


def broadcast_to_all(
    event: str,
    data: dict,
    namespace: str = "/",
    skip_sid: str | None = None,
) -> bool:
    """
    Broadcast a Socket.IO event to all connected clients in a namespace.

    This is a convenience wrapper around sync_emit for namespace-wide broadcasts.
    When room is None, the message is delivered to all connected clients in
    the specified namespace.

    Args:
        event: The event name to emit
        data: The event data payload
        namespace: The Socket.IO namespace (default '/')
        skip_sid: Optional session ID to exclude from the broadcast

    Returns:
        True if the message was published successfully, False otherwise

    Example:
        # Broadcast system status to all clients
        broadcast_to_all('system:status', {'status': 'healthy'})

        # Broadcast to admin namespace
        broadcast_to_all('maintenance', data, namespace='/admin')
    """
    return sync_emit(
        event=event,
        data=data,
        room=None,
        namespace=namespace,
        skip_sid=skip_sid,
    )


def broadcast_aircraft_update(
    aircraft_data: dict,
    room: str = "aircraft:live",
    namespace: str = "/",
) -> bool:
    """
    Broadcast an aircraft update event.

    Convenience function for the common case of broadcasting aircraft
    position/state updates to tracking clients.

    Args:
        aircraft_data: The aircraft data dict (icao, position, altitude, etc.)
        room: The room for aircraft updates (default 'aircraft:live')
        namespace: The Socket.IO namespace (default '/')

    Returns:
        True if the message was published successfully, False otherwise
    """
    return broadcast_to_room(
        room=room,
        event="aircraft:update",
        data=aircraft_data,
        namespace=namespace,
    )


def broadcast_safety_event(
    event_data: dict,
    room: str = "safety",
    namespace: str = "/",
) -> bool:
    """
    Broadcast a safety event.

    Convenience function for broadcasting safety-related events (TCAS,
    proximity warnings, etc.) to clients monitoring safety.

    Args:
        event_data: The safety event data dict
        room: The room for safety events (default 'safety')
        namespace: The Socket.IO namespace (default '/')

    Returns:
        True if the message was published successfully, False otherwise
    """
    return broadcast_to_room(
        room=room,
        event="safety:event",
        data=event_data,
        namespace=namespace,
    )
