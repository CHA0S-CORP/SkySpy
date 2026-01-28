"""
Distributed cooldown management for alerts using Redis.

Provides atomic cooldown checking across multiple Celery workers
to prevent duplicate alert triggers.
"""
import logging
from datetime import datetime, timedelta
from typing import Tuple, Optional

from django.conf import settings

logger = logging.getLogger(__name__)


class DistributedCooldownManager:
    """
    Manages alert cooldowns using Redis SETEX for atomic operations.

    This enables consistent cooldown behavior across multiple Celery workers,
    preventing duplicate alerts when processing aircraft data in parallel.
    """

    KEY_PREFIX = "alert:cooldown"

    def __init__(self):
        self._redis = None
        self._fallback_cooldowns: dict = {}  # In-memory fallback

    @property
    def redis(self):
        """Lazy-load Redis connection."""
        if self._redis is None:
            try:
                import redis
                redis_url = getattr(settings, 'REDIS_URL', 'redis://redis:6379/0')
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

    def check_and_set(
        self,
        rule_id: int,
        icao_hex: str,
        cooldown_seconds: int
    ) -> Tuple[bool, Optional[datetime]]:
        """
        Atomically check if cooldown has passed and set if so.

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
                # Use SET with NX (only set if not exists) and EX (expiry)
                # This is atomic - if key exists, returns None, else sets and returns True
                result = self.redis.set(
                    key,
                    str(now_ts),
                    nx=True,
                    ex=cooldown_seconds
                )

                if result:
                    # Key was set - cooldown passed (or first trigger)
                    return True, None
                else:
                    # Key exists - still in cooldown
                    # Handle race condition where key may have expired between SET and GET
                    last_ts = self.redis.get(key)
                    if last_ts is None:
                        # Key expired between SET and GET - treat as cooldown passed
                        return True, None
                    last_time = datetime.fromtimestamp(float(last_ts))
                    return False, last_time

            except Exception as e:
                logger.warning(f"Redis cooldown check failed, using fallback: {e}")
                return self._check_fallback(rule_id, icao_hex, cooldown_seconds)
        else:
            return self._check_fallback(rule_id, icao_hex, cooldown_seconds)

    def _check_fallback(
        self,
        rule_id: int,
        icao_hex: str,
        cooldown_seconds: int
    ) -> Tuple[bool, Optional[datetime]]:
        """In-memory fallback when Redis is unavailable."""
        key = (rule_id, icao_hex.upper())
        now = datetime.utcnow()

        last_trigger = self._fallback_cooldowns.get(key)

        if last_trigger:
            elapsed = (now - last_trigger).total_seconds()
            if elapsed < cooldown_seconds:
                return False, last_trigger

        self._fallback_cooldowns[key] = now
        return True, last_trigger

    def get_remaining_cooldown(
        self,
        rule_id: int,
        icao_hex: str
    ) -> Optional[int]:
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

        # Also clear in-memory fallback
        keys_to_remove = [k for k in self._fallback_cooldowns.keys() if k[0] == rule_id]
        for key in keys_to_remove:
            del self._fallback_cooldowns[key]
            count += 1

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

        # Also clear in-memory fallback
        keys_to_remove = [k for k in self._fallback_cooldowns.keys() if k[1] == icao_upper]
        for key in keys_to_remove:
            del self._fallback_cooldowns[key]
            count += 1

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
        fallback_count = len(self._fallback_cooldowns)
        self._fallback_cooldowns.clear()
        count += fallback_count

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
            'redis_available': redis_available,
            'active_cooldowns': self.get_active_cooldowns_count(),
            'fallback_cooldowns': len(self._fallback_cooldowns),
            'using_fallback': not redis_available,
        }


# Global singleton instance
cooldown_manager = DistributedCooldownManager()
