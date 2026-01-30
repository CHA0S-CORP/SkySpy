"""
Rate limiter for Socket.IO messages.

Provides per-topic rate limiting to control message frequency
and reduce bandwidth usage.
"""
import time
from typing import Optional


# Default rate limits (messages per second)
DEFAULT_RATE_LIMITS = {
    'aircraft:update': 10,    # Max 10 Hz
    'aircraft:position': 5,   # Max 5 Hz
    'stats:update': 0.5,      # Max 0.5 Hz (2 second minimum)
    'default': 5,             # Default rate limit
}


class RateLimiter:
    """Per-topic rate limiter for Socket.IO messages."""

    def __init__(self, rate_limits: Optional[dict[str, float]] = None):
        """
        Initialize the rate limiter.

        Args:
            rate_limits: Optional dict mapping topic names to rate limits (Hz).
                        If not provided, uses DEFAULT_RATE_LIMITS.
        """
        self._last_send: dict[str, float] = {}
        self._rate_limits = rate_limits if rate_limits is not None else DEFAULT_RATE_LIMITS.copy()

    def can_send(self, topic: str) -> bool:
        """
        Check if a message for this topic can be sent.

        Args:
            topic: The message topic/event name.

        Returns:
            True if the message can be sent, False if rate limited.
        """
        now = time.time()
        rate_limit = self._rate_limits.get(topic, self._rate_limits.get('default', 5))

        if rate_limit <= 0:
            return True  # No limit

        min_interval = 1.0 / rate_limit
        last_send = self._last_send.get(topic, 0)

        if now - last_send >= min_interval:
            self._last_send[topic] = now
            return True
        return False

    def get_wait_time(self, topic: str) -> float:
        """
        Get time to wait before next send is allowed.

        Args:
            topic: The message topic/event name.

        Returns:
            Time in seconds to wait before sending is allowed.
            Returns 0 if sending is allowed immediately.
        """
        now = time.time()
        rate_limit = self._rate_limits.get(topic, self._rate_limits.get('default', 5))

        if rate_limit <= 0:
            return 0

        min_interval = 1.0 / rate_limit
        last_send = self._last_send.get(topic, 0)
        wait = min_interval - (now - last_send)
        return max(0, wait)

    def reset(self, topic: Optional[str] = None):
        """
        Reset rate limiting state.

        Args:
            topic: Optional topic to reset. If None, resets all topics.
        """
        if topic is None:
            self._last_send.clear()
        elif topic in self._last_send:
            del self._last_send[topic]

    def set_rate_limit(self, topic: str, rate: float):
        """
        Set or update the rate limit for a specific topic.

        Args:
            topic: The message topic/event name.
            rate: The rate limit in Hz (messages per second).
                  Use 0 or negative for no limit.
        """
        self._rate_limits[topic] = rate
