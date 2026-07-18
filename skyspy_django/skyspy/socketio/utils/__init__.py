"""
Socket.IO utilities for SkysPy.

Utility functions for message serialization, room management,
broadcasting from sync contexts (Celery), and other Socket.IO helpers.
"""

from .batcher import DEFAULT_BATCH_CONFIG, MessageBatcher
from .broadcast import (
    broadcast_aircraft_update,
    broadcast_safety_event,
    broadcast_to_all,
    broadcast_to_room,
    sync_emit,
)
from .rate_limiter import DEFAULT_RATE_LIMITS, RateLimiter
from .snapshot_cache import SnapshotCache, snapshot_cache

__all__ = [
    # Rate limiting
    "RateLimiter",
    "DEFAULT_RATE_LIMITS",
    # Message batching
    "MessageBatcher",
    "DEFAULT_BATCH_CONFIG",
    # Sync broadcast (for Celery tasks)
    "sync_emit",
    "broadcast_to_room",
    "broadcast_to_all",
    "broadcast_aircraft_update",
    "broadcast_safety_event",
    # Snapshot caching
    "SnapshotCache",
    "snapshot_cache",
]
