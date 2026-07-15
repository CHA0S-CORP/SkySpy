"""
Distributed cooldown management for alerts using Redis.

Provides atomic cooldown checking across multiple Celery workers
to prevent duplicate alert triggers.
"""

import logging
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta

from django.conf import settings

logger = logging.getLogger(__name__)

# Lua script for atomic check-and-set cooldown operation
# Returns: [can_trigger (0/1), last_timestamp or nil]
COOLDOWN_CHECK_SET_LUA = """
local key = KEYS[1]
local now_ts = ARGV[1]
local cooldown_seconds = tonumber(ARGV[2])

-- Try to get existing value
local existing = redis.call('GET', key)

if existing then
    -- Key exists, still in cooldown
    return {0, existing}
else
    -- Key doesn't exist or expired, set it atomically
    redis.call('SETEX', key, cooldown_seconds, now_ts)
    -- Note: use false (converted to a nil reply element), never a Lua nil,
    -- which would truncate the returned table to a single element
    return {1, false}
end
"""


class LRUCooldownCache:
    """
    Thread-safe LRU cache for fallback cooldowns with max size limit.

    Automatically evicts oldest entries when max size is reached and
    periodically cleans up expired entries.
    """

    MAX_SIZE = 10000
    CLEANUP_INTERVAL = 60  # seconds

    def __init__(self, max_size: int = MAX_SIZE):
        self._cache: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self._max_size = max_size
        self._last_cleanup = 0.0

    def get(self, key: tuple) -> datetime | None:
        """Get a cooldown entry, returning None if not found."""
        with self._lock:
            if key in self._cache:
                # Move to end (most recently used)
                self._cache.move_to_end(key)
                return self._cache[key]
            return None

    def set(self, key: tuple, value: datetime):
        """Set a cooldown entry with LRU eviction if needed."""
        with self._lock:
            self._maybe_cleanup()

            if key in self._cache:
                # Update existing and move to end
                self._cache[key] = value
                self._cache.move_to_end(key)
            else:
                # Evict oldest if at capacity
                while len(self._cache) >= self._max_size:
                    self._cache.popitem(last=False)
                self._cache[key] = value

    def remove(self, key: tuple) -> bool:
        """Remove a specific key. Returns True if removed."""
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def remove_by_predicate(self, predicate) -> int:
        """Remove all keys matching predicate. Returns count removed."""
        with self._lock:
            keys_to_remove = [k for k in self._cache if predicate(k)]
            for key in keys_to_remove:
                del self._cache[key]
            return len(keys_to_remove)

    def clear(self) -> int:
        """Clear all entries. Returns count cleared."""
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            return count

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)

    def _maybe_cleanup(self):
        """Cleanup expired entries periodically. Must be called with lock held."""
        now = time.time()
        if now - self._last_cleanup < self.CLEANUP_INTERVAL:
            return

        self._last_cleanup = now
        cutoff = datetime.utcnow() - timedelta(minutes=30)  # Keep for 30 min max

        # Remove expired entries (iterate over copy of keys)
        keys_to_remove = [k for k, v in self._cache.items() if v < cutoff]
        for key in keys_to_remove:
            del self._cache[key]


class DistributedCooldownManager:
    """
    Manages alert cooldowns using Redis SETEX for atomic operations.

    This enables consistent cooldown behavior across multiple Celery workers,
    preventing duplicate alerts when processing aircraft data in parallel.
    """

    # Prefixed with "skyspy:" to namespace keys in the shared Redis instance
    KEY_PREFIX = "skyspy:alert:cooldown"

    def __init__(self):
        self._redis = None
        self._lua_script = None  # Cached Lua script
        self._fallback_cooldowns = LRUCooldownCache()  # Thread-safe LRU fallback

    @property
    def redis(self):
        """Lazy-load Redis connection."""
        if self._redis is None:
            try:
                import redis

                redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
                self._redis = redis.from_url(redis_url, decode_responses=True)
                # Test connection
                self._redis.ping()
            except Exception as e:
                logger.warning(f"Redis not available for cooldowns, using in-memory fallback: {e}")
                self._redis = False  # Mark as unavailable
        return self._redis if self._redis else None

    def _get_key(self, rule_id: int, icao_hex: str) -> str:
        """Generate Redis key for a rule/aircraft combination."""
        return f"{self.KEY_PREFIX}:{rule_id}:{icao_hex.upper()}"

    def _get_lua_script(self):
        """Get or create the cached Lua script for atomic cooldown check-and-set."""
        if self._lua_script is None and self.redis:
            self._lua_script = self.redis.register_script(COOLDOWN_CHECK_SET_LUA)
        return self._lua_script

    def check_and_set(self, rule_id: int, icao_hex: str, cooldown_seconds: int) -> tuple[bool, datetime | None]:
        """
        Atomically check if cooldown has passed and set if so.

        Uses a Lua script for atomic check-and-set to prevent TOCTOU race conditions.

        Args:
            rule_id: The alert rule ID
            icao_hex: The aircraft ICAO hex code
            cooldown_seconds: Cooldown duration in seconds

        Returns:
            Tuple of (can_trigger, last_trigger_time):
            - can_trigger: True if cooldown has passed (alert can fire)
            - last_trigger_time: When the cooldown was last set (None if first trigger)
        """
        key = self._get_key(rule_id, icao_hex)
        now = datetime.utcnow()
        now_ts = now.timestamp()

        if self.redis:
            try:
                # Use Lua script for atomic check-and-set operation
                # This eliminates the TOCTOU race condition
                script = self._get_lua_script()
                result = script(keys=[key], args=[str(now_ts), cooldown_seconds])

                # Guard against short replies (Lua nil truncates returned tables)
                can_trigger = bool(result[0]) if result else False
                last_ts = result[1] if len(result) > 1 else None

                if can_trigger:
                    # Key was set - cooldown passed (or first trigger)
                    return True, None
                else:
                    # Key exists - still in cooldown
                    if last_ts is not None:
                        last_time = datetime.fromtimestamp(float(last_ts))
                        return False, last_time
                    return False, None

            except Exception as e:
                logger.warning(f"Redis cooldown check failed, using fallback: {e}")
                return self._check_fallback(rule_id, icao_hex, cooldown_seconds)
        else:
            return self._check_fallback(rule_id, icao_hex, cooldown_seconds)

    def _check_fallback(self, rule_id: int, icao_hex: str, cooldown_seconds: int) -> tuple[bool, datetime | None]:
        """In-memory fallback when Redis is unavailable. Uses thread-safe LRU cache."""
        key = (rule_id, icao_hex.upper())
        now = datetime.utcnow()

        last_trigger = self._fallback_cooldowns.get(key)

        if last_trigger:
            elapsed = (now - last_trigger).total_seconds()
            if elapsed < cooldown_seconds:
                return False, last_trigger

        self._fallback_cooldowns.set(key, now)
        return True, last_trigger

    def get_remaining_cooldown(self, rule_id: int, icao_hex: str) -> int | None:
        """
        Get remaining cooldown time in seconds.

        Returns:
            Remaining seconds, or None if no active cooldown
        """
        key = self._get_key(rule_id, icao_hex)

        if self.redis:
            try:
                ttl = self.redis.ttl(key)
                return ttl if ttl > 0 else None
            except Exception as e:
                logger.warning(f"Redis TTL check failed: {e}")
                return None
        return None

    def clear_one(self, rule_id: int, icao_hex: str) -> bool:
        """
        Clear the cooldown for a single rule/aircraft pair.

        Used to roll back a cooldown that check_and_set just wrote when the
        alert could not be persisted, so the next evaluation cycle can retry.

        Returns:
            True if a cooldown was removed
        """
        removed = False

        if self.redis:
            try:
                removed = bool(self.redis.delete(self._get_key(rule_id, icao_hex)))
            except Exception as e:
                logger.warning(f"Redis clear_one failed: {e}")

        # Also clear in-memory fallback
        if self._fallback_cooldowns.remove((rule_id, icao_hex.upper())):
            removed = True

        return removed

    def clear_rule(self, rule_id: int) -> int:
        """
        Clear all cooldowns for a specific rule.

        Used when a rule is deleted or significantly modified.

        Returns:
            Number of cooldowns cleared
        """
        pattern = f"{self.KEY_PREFIX}:{rule_id}:*"
        count = 0

        if self.redis:
            try:
                # Use SCAN to find matching keys (safe for production)
                cursor = 0
                while True:
                    cursor, keys = self.redis.scan(cursor, match=pattern, count=100)
                    if keys:
                        count += self.redis.delete(*keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.warning(f"Redis clear_rule failed: {e}")

        # Also clear in-memory fallback using predicate
        count += self._fallback_cooldowns.remove_by_predicate(lambda k: k[0] == rule_id)

        logger.debug(f"Cleared {count} cooldowns for rule {rule_id}")
        return count

    def clear_aircraft(self, icao_hex: str) -> int:
        """
        Clear all cooldowns for a specific aircraft.

        Returns:
            Number of cooldowns cleared
        """
        icao_upper = icao_hex.upper()
        pattern = f"{self.KEY_PREFIX}:*:{icao_upper}"
        count = 0

        if self.redis:
            try:
                cursor = 0
                while True:
                    cursor, keys = self.redis.scan(cursor, match=pattern, count=100)
                    if keys:
                        count += self.redis.delete(*keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.warning(f"Redis clear_aircraft failed: {e}")

        # Also clear in-memory fallback using predicate
        count += self._fallback_cooldowns.remove_by_predicate(lambda k: k[1] == icao_upper)

        return count

    def clear_all(self) -> int:
        """
        Clear all alert cooldowns.

        Use with caution - may cause alert flood.

        Returns:
            Number of cooldowns cleared
        """
        pattern = f"{self.KEY_PREFIX}:*"
        count = 0

        if self.redis:
            try:
                cursor = 0
                while True:
                    cursor, keys = self.redis.scan(cursor, match=pattern, count=100)
                    if keys:
                        count += self.redis.delete(*keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.warning(f"Redis clear_all failed: {e}")

        # Clear in-memory fallback
        count += self._fallback_cooldowns.clear()

        logger.info(f"Cleared all {count} alert cooldowns")
        return count

    def get_active_cooldowns_count(self) -> int:
        """
        Get count of active cooldowns.

        Returns:
            Number of active cooldowns
        """
        pattern = f"{self.KEY_PREFIX}:*"
        count = 0

        if self.redis:
            try:
                cursor = 0
                while True:
                    cursor, keys = self.redis.scan(cursor, match=pattern, count=100)
                    count += len(keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.warning(f"Redis count failed: {e}")
                count = len(self._fallback_cooldowns)
        else:
            count = len(self._fallback_cooldowns)

        return count

    def get_status(self) -> dict:
        """Get cooldown manager status."""
        redis_available = bool(self.redis)

        return {
            "redis_available": redis_available,
            "active_cooldowns": self.get_active_cooldowns_count(),
            "fallback_cooldowns": len(self._fallback_cooldowns),
            "using_fallback": not redis_available,
        }


# Global singleton instance
cooldown_manager = DistributedCooldownManager()
