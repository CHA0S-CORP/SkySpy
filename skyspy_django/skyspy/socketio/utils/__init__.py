"""
Socket.IO utilities for SkysPy.

Utility functions for message serialization, room management,
broadcasting from sync contexts (Celery), and other Socket.IO helpers.
"""
from .rate_limiter import RateLimiter, DEFAULT_RATE_LIMITS
from .batcher import MessageBatcher, DEFAULT_BATCH_CONFIG
from .broadcast import (
    sync_emit,
    broadcast_to_room,
    broadcast_to_all,
    broadcast_aircraft_update,
    broadcast_alert,
    broadcast_safety_event,
)

__all__ = [
    # Rate limiting
    'RateLimiter',
    'DEFAULT_RATE_LIMITS',
    # Message batching
    'MessageBatcher',
    'DEFAULT_BATCH_CONFIG',
    # Sync broadcast (for Celery tasks)
    'sync_emit',
    'broadcast_to_room',
    'broadcast_to_all',
    'broadcast_aircraft_update',
    'broadcast_alert',
    'broadcast_safety_event',
]
