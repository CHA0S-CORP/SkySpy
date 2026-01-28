"""
Channel layer utilities for safely sending messages from sync/async contexts.
"""
import asyncio
import logging

from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)


def sync_group_send(channel_layer, group: str, message: dict):
    """
    Send a message to a channel group, handling both sync and async contexts.

    When called from a Celery task that runs in an async event loop (e.g., with
    gevent or eventlet worker pools), async_to_sync will fail with:
    "You cannot use AsyncToSync in the same thread as an async event loop"

    This utility detects the context and handles it appropriately:
    - In an async context: schedules the coroutine on the running loop
    - In a sync context: uses async_to_sync as normal

    Args:
        channel_layer: The Django Channels layer instance
        group: The group name to send to
        message: The message dict to send
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        # We're in an async context - schedule on the running loop
        future = asyncio.run_coroutine_threadsafe(
            channel_layer.group_send(group, message),
            loop
        )
        try:
            # Wait briefly for result, but don't block forever
            future.result(timeout=1.0)
        except Exception as e:
            logger.debug(f"Channel send completed with: {e}")
    else:
        # Standard sync context
        async_to_sync(channel_layer.group_send)(group, message)
