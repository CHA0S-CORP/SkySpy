"""
Rate limiter for Socket.IO messages.

Provides per-topic token-bucket rate limiting to control message frequency
and reduce bandwidth usage. Token buckets allow short bursts (e.g. the flood
of requests a dashboard fires on page load) while still enforcing the
sustained rate.

Thread-safe: Uses threading.Lock to protect internal state from
concurrent access in multi-threaded async environments.
"""

import time
from threading import Lock

# Default rate limits (messages per second, sustained)
DEFAULT_RATE_LIMITS = {
    "aircraft:update": 10,  # Max 10 Hz
    "aircraft:position": 5,  # Max 5 Hz
    "stats:update": 0.5,  # Max 0.5 Hz (2 second minimum)
    "default": 5,  # Default rate limit
    "request": 10,  # Max 10 requests per second sustained
}

# Burst window: each topic's bucket holds rate * BURST_SECONDS tokens, so a
# client can burst that many messages instantly before the sustained rate
# applies. Page load fires ~15 requests at once; 3s of budget absorbs that.
BURST_SECONDS = 3.0


class RateLimiter:
    """Per-topic token-bucket rate limiter for Socket.IO messages (thread-safe)."""

    def __init__(self, rate_limits: dict[str, float] | None = None):
        """
        Initialize the rate limiter.

        Args:
            rate_limits: Optional dict mapping topic names to sustained rate
                        limits (Hz). If not provided, uses DEFAULT_RATE_LIMITS.
        """
        # topic -> (tokens, last_refill_monotonic)
        self._buckets: dict[str, tuple[float, float]] = {}
        self._rate_limits = rate_limits if rate_limits is not None else DEFAULT_RATE_LIMITS.copy()
        self._lock = Lock()

    def _capacity(self, rate: float) -> float:
        return max(1.0, rate * BURST_SECONDS)

    def _refill(self, topic: str, rate: float, now: float) -> float:
        """Return current token count for topic after refilling. Lock held by caller."""
        capacity = self._capacity(rate)
        tokens, last = self._buckets.get(topic, (capacity, now))
        tokens = min(capacity, tokens + (now - last) * rate)
        return tokens

    def can_send(self, topic: str) -> bool:
        """
        Check if a message for this topic can be sent (thread-safe).

        Consumes one token when allowed.

        Args:
            topic: The message topic/event name.

        Returns:
            True if the message can be sent, False if rate limited.
        """
        now = time.monotonic()

        with self._lock:
            rate = self._rate_limits.get(topic, self._rate_limits.get("default", 5))

            if rate <= 0:
                return True  # No limit

            tokens = self._refill(topic, rate, now)
            if tokens >= 1.0:
                self._buckets[topic] = (tokens - 1.0, now)
                return True
            self._buckets[topic] = (tokens, now)
            return False

    def get_wait_time(self, topic: str) -> float:
        """
        Get time to wait before next send is allowed (thread-safe).

        Args:
            topic: The message topic/event name.

        Returns:
            Time in seconds to wait before sending is allowed.
            Returns 0 if sending is allowed immediately.
        """
        now = time.monotonic()

        with self._lock:
            rate = self._rate_limits.get(topic, self._rate_limits.get("default", 5))

            if rate <= 0:
                return 0

            tokens = self._refill(topic, rate, now)
            if tokens >= 1.0:
                return 0
            return (1.0 - tokens) / rate

    def reset(self, topic: str | None = None):
        """
        Reset rate limiting state (thread-safe).

        Args:
            topic: Optional topic to reset. If None, resets all topics.
        """
        with self._lock:
            if topic is None:
                self._buckets.clear()
            elif topic in self._buckets:
                del self._buckets[topic]

    def set_rate_limit(self, topic: str, rate: float):
        """
        Set or update the rate limit for a specific topic (thread-safe).

        Args:
            topic: The message topic/event name.
            rate: The sustained rate limit in Hz (messages per second).
                  Use 0 or negative for no limit.
        """
        with self._lock:
            self._rate_limits[topic] = rate
            # Existing bucket keeps its tokens but is clamped on next refill

    def cleanup_old_entries(self, max_age: float = 300.0):
        """
        Remove stale entries from the rate limiter to prevent memory leaks (thread-safe).

        This should be called periodically (e.g., on disconnect or via a
        background task) to clean up entries for topics that are no longer
        being used.

        Args:
            max_age: Maximum age in seconds for entries to keep (default: 300s / 5 min)
        """
        now = time.monotonic()
        with self._lock:
            self._buckets = {k: (t, ts) for k, (t, ts) in self._buckets.items() if now - ts < max_age}
