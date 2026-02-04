"""
Pre-serialized snapshot caching for Socket.IO connections.

Reduces database queries when multiple clients connect simultaneously.
Instead of querying the database for every new connection, we cache
the serialized JSON response and serve it directly.
"""

import json
import logging
import threading
import time
from typing import Any

from django.core.cache import cache

logger = logging.getLogger(__name__)


class SnapshotCache:
    """
    Cache for pre-serialized connection snapshots.

    Reduces query load by caching JSON-serialized snapshots
    that can be sent directly to clients. Uses a two-tier caching
    strategy:
    - Local in-memory cache for fastest access (single process)
    - Django/Redis cache for shared state across workers
    """

    CACHE_KEY_PREFIX = "socketio:snapshot"
    DEFAULT_TTL = 5  # 5 seconds

    def __init__(self):
        # Local cache stores tuples of (json_string, expiry_timestamp)
        self._local_cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def get_snapshot(self, topic: str) -> str | None:
        """
        Get cached snapshot JSON for a topic.

        Checks local in-memory cache first for fastest access,
        then falls back to Django/Redis cache.

        Args:
            topic: The topic name (e.g., "aircraft", "safety", "alerts")

        Returns:
            Pre-serialized JSON string or None if not cached
        """
        now = time.time()
        cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"

        # Check local cache first (fastest)
        with self._lock:
            if cache_key in self._local_cache:
                data, expires = self._local_cache[cache_key]
                if expires > now:
                    logger.debug(f"Snapshot cache hit (local) for topic: {topic}")
                    return data
                else:
                    # Expired, remove from local cache
                    del self._local_cache[cache_key]

        # Check Redis/Django cache
        try:
            data = cache.get(cache_key)
            if data:
                logger.debug(f"Snapshot cache hit (redis) for topic: {topic}")
                # Populate local cache for subsequent requests
                with self._lock:
                    self._local_cache[cache_key] = (data, now + self.DEFAULT_TTL)
                return data
        except Exception as e:
            logger.warning(f"Error reading snapshot cache for {topic}: {e}")

        logger.debug(f"Snapshot cache miss for topic: {topic}")
        return None

    def set_snapshot(self, topic: str, data: Any, ttl: int = None) -> bool:
        """
        Cache a snapshot for a topic.

        Serializes the data to JSON and stores in both local and Redis cache.

        Args:
            topic: Topic name (e.g., "aircraft", "safety")
            data: Data to serialize and cache
            ttl: Cache TTL in seconds (default 5)

        Returns:
            True if caching succeeded, False otherwise
        """
        if ttl is None:
            ttl = self.DEFAULT_TTL

        cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"

        try:
            # Serialize to JSON with fallback for non-serializable types
            json_data = json.dumps(data, default=str)
        except (TypeError, ValueError) as e:
            logger.warning(f"Failed to serialize snapshot for {topic}: {e}")
            return False

        # Store in both local and Redis cache
        expires = time.time() + ttl

        with self._lock:
            self._local_cache[cache_key] = (json_data, expires)

        try:
            cache.set(cache_key, json_data, timeout=ttl)
            logger.debug(f"Snapshot cached for topic: {topic} (ttl={ttl}s)")
            return True
        except Exception as e:
            logger.warning(f"Error setting snapshot cache for {topic}: {e}")
            return False

    def invalidate(self, topic: str) -> None:
        """
        Invalidate cached snapshot for a topic.

        Removes from both local and Redis cache.

        Args:
            topic: Topic name to invalidate
        """
        cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"

        with self._lock:
            self._local_cache.pop(cache_key, None)

        try:
            cache.delete(cache_key)
            logger.debug(f"Snapshot cache invalidated for topic: {topic}")
        except Exception as e:
            logger.warning(f"Error invalidating snapshot cache for {topic}: {e}")

    def invalidate_all(self) -> None:
        """
        Invalidate all cached snapshots.

        Clears local cache and removes all snapshot keys from Redis.
        """
        with self._lock:
            self._local_cache.clear()

        # Delete all snapshot keys from Redis
        try:
            # Get all keys with our prefix and delete them
            for topic in ["aircraft", "safety", "alerts", "acars", "notams", "stats"]:
                cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"
                cache.delete(cache_key)
            logger.debug("All snapshot caches invalidated")
        except Exception as e:
            logger.warning(f"Error invalidating all snapshot caches: {e}")

    def get_stats(self) -> dict:
        """
        Get cache statistics for monitoring.

        Returns:
            Dict with cache statistics
        """
        now = time.time()
        with self._lock:
            active_entries = sum(1 for _, (_, exp) in self._local_cache.items() if exp > now)
            return {
                "local_entries": len(self._local_cache),
                "active_entries": active_entries,
                "expired_entries": len(self._local_cache) - active_entries,
            }

    def cleanup_expired(self) -> int:
        """
        Remove expired entries from local cache.

        Returns:
            Number of entries removed
        """
        now = time.time()
        removed = 0

        with self._lock:
            expired_keys = [key for key, (_, exp) in self._local_cache.items() if exp <= now]
            for key in expired_keys:
                del self._local_cache[key]
                removed += 1

        if removed:
            logger.debug(f"Cleaned up {removed} expired snapshot cache entries")

        return removed


# Global singleton instance
snapshot_cache = SnapshotCache()
