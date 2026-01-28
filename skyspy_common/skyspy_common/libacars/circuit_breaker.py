"""
Circuit breaker pattern implementation for libacars binding.

Provides intelligent error recovery with:
- State machine (CLOSED, OPEN, HALF_OPEN)
- Error categorization
- Exponential backoff
- Automatic recovery attempts
"""

import logging
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Callable, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(Enum):
    """Circuit breaker states."""

    CLOSED = auto()  # Normal operation, calls allowed
    OPEN = auto()  # Failure threshold reached, calls blocked
    HALF_OPEN = auto()  # Recovery test, limited calls allowed


class ErrorCategory(Enum):
    """Categories of errors for differential handling."""

    MEMORY = "memory"  # Out of memory - critical, may need restart
    MALFORMED = "malformed"  # Input validation failed - skip message
    UNSUPPORTED = "unsupported"  # Label/format not supported - skip
    LIBRARY_CRASH = "crash"  # Segfault/abort - disable immediately
    JSON_ERROR = "json"  # Output parsing error - may retry
    TIMEOUT = "timeout"  # Operation timed out - may retry
    LOAD_ERROR = "load"  # Library failed to load - disable
    UNKNOWN = "unknown"  # Unexpected error - conservative handling

    @classmethod
    def from_exception(cls, exc: Exception) -> "ErrorCategory":
        """Categorize an exception."""
        exc_name = type(exc).__name__.lower()
        exc_msg = str(exc).lower()

        if "memory" in exc_name or "memory" in exc_msg:
            return cls.MEMORY
        if "validation" in exc_name or "malformed" in exc_msg:
            return cls.MALFORMED
        if "unsupported" in exc_msg or "not supported" in exc_msg:
            return cls.UNSUPPORTED
        if "segfault" in exc_msg or "signal" in exc_msg or "crash" in exc_msg:
            return cls.LIBRARY_CRASH
        if "json" in exc_name or "decode" in exc_msg:
            return cls.JSON_ERROR
        if "timeout" in exc_name or "timed out" in exc_msg:
            return cls.TIMEOUT
        if "load" in exc_name or "library" in exc_msg:
            return cls.LOAD_ERROR
        return cls.UNKNOWN


@dataclass
class CircuitBreakerStats:
    """Statistics for circuit breaker operations."""

    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    rejected_calls: int = 0  # Calls rejected due to open circuit
    state_changes: int = 0
    current_state: str = "CLOSED"
    time_in_current_state: float = 0.0
    failure_counts: dict = field(default_factory=dict)
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    recovery_attempts: int = 0
    successful_recoveries: int = 0

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "total_calls": self.total_calls,
            "successful_calls": self.successful_calls,
            "failed_calls": self.failed_calls,
            "rejected_calls": self.rejected_calls,
            "state_changes": self.state_changes,
            "current_state": self.current_state,
            "time_in_current_state": round(self.time_in_current_state, 2),
            "failure_counts": self.failure_counts,
            "last_failure_time": self.last_failure_time,
            "last_success_time": self.last_success_time,
            "recovery_attempts": self.recovery_attempts,
            "successful_recoveries": self.successful_recoveries,
            "success_rate": round(
                (self.successful_calls / self.total_calls * 100)
                if self.total_calls > 0
                else 0.0,
                2,
            ),
        }


class CircuitBreaker:
    """
    Circuit breaker for libacars operations.

    Implements the circuit breaker pattern to:
    - Prevent cascade failures
    - Allow automatic recovery
    - Categorize and track errors
    - Provide backoff mechanisms

    States:
    - CLOSED: Normal operation, all calls allowed
    - OPEN: Failure threshold reached, calls blocked
    - HALF_OPEN: Testing recovery, limited calls allowed

    Usage:
        breaker = CircuitBreaker(failure_threshold=5)

        if breaker.can_execute():
            try:
                result = decode_acars_apps(...)
                breaker.record_success()
            except Exception as e:
                breaker.record_failure(e)
        else:
            # Circuit is open, skip the call
            pass
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        half_open_max_calls: int = 3,
        exponential_backoff: bool = True,
        max_backoff: float = 300.0,
    ):
        """
        Initialize the circuit breaker.

        Args:
            failure_threshold: Number of failures before opening circuit
            recovery_timeout: Base time in seconds before attempting recovery
            half_open_max_calls: Max calls allowed in half-open state
            exponential_backoff: Whether to use exponential backoff
            max_backoff: Maximum backoff time in seconds
        """
        self._failure_threshold = failure_threshold
        self._recovery_timeout = recovery_timeout
        self._half_open_max_calls = half_open_max_calls
        self._exponential_backoff = exponential_backoff
        self._max_backoff = max_backoff

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._half_open_calls = 0
        self._consecutive_failures = 0
        self._failure_categories: Counter = Counter()

        self._state_change_time = time.time()
        self._last_failure_time: Optional[float] = None
        self._backoff_multiplier = 1

        self._lock = threading.Lock()
        self._stats = CircuitBreakerStats()

    @property
    def state(self) -> CircuitState:
        """Get current circuit state."""
        return self._state

    @property
    def is_closed(self) -> bool:
        """Check if circuit is closed (normal operation)."""
        return self._state == CircuitState.CLOSED

    @property
    def is_open(self) -> bool:
        """Check if circuit is open (blocking calls)."""
        return self._state == CircuitState.OPEN

    @property
    def is_half_open(self) -> bool:
        """Check if circuit is half-open (testing recovery)."""
        return self._state == CircuitState.HALF_OPEN

    def _get_current_timeout(self) -> float:
        """Get current recovery timeout with backoff."""
        if not self._exponential_backoff:
            return self._recovery_timeout
        timeout = self._recovery_timeout * self._backoff_multiplier
        return min(timeout, self._max_backoff)

    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state."""
        old_state = self._state
        self._state = new_state
        self._state_change_time = time.time()
        self._stats.state_changes += 1
        self._stats.current_state = new_state.name

        logger.info(
            "circuit_breaker_state_change",
            extra={
                "old_state": old_state.name,
                "new_state": new_state.name,
                "failure_count": self._failure_count,
                "consecutive_failures": self._consecutive_failures,
            },
        )

        if new_state == CircuitState.HALF_OPEN:
            self._half_open_calls = 0
            self._stats.recovery_attempts += 1
        elif new_state == CircuitState.CLOSED:
            if old_state == CircuitState.HALF_OPEN:
                self._stats.successful_recoveries += 1
            self._backoff_multiplier = 1
            self._failure_count = 0
            self._consecutive_failures = 0

    def can_execute(self) -> bool:
        """
        Check if a call should be allowed.

        Returns:
            True if call should proceed, False if circuit is open
        """
        with self._lock:
            self._stats.total_calls += 1

            if self._state == CircuitState.CLOSED:
                return True

            if self._state == CircuitState.OPEN:
                # Check if recovery timeout has elapsed
                elapsed = time.time() - self._state_change_time
                timeout = self._get_current_timeout()

                if elapsed >= timeout:
                    self._transition_to(CircuitState.HALF_OPEN)
                    return True

                self._stats.rejected_calls += 1
                return False

            if self._state == CircuitState.HALF_OPEN:
                # Allow limited calls in half-open state
                if self._half_open_calls < self._half_open_max_calls:
                    self._half_open_calls += 1
                    return True
                self._stats.rejected_calls += 1
                return False

            return False

    def record_success(self) -> None:
        """Record a successful operation."""
        with self._lock:
            self._stats.successful_calls += 1
            self._stats.last_success_time = time.time()
            self._consecutive_failures = 0

            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                # Require multiple successes before closing
                if self._success_count >= 2:
                    self._transition_to(CircuitState.CLOSED)
            elif self._state == CircuitState.CLOSED:
                # Gradual recovery of failure count
                if self._failure_count > 0:
                    self._failure_count = max(0, self._failure_count - 1)

    def record_failure(
        self,
        error: Optional[Exception] = None,
        category: Optional[ErrorCategory] = None,
    ) -> None:
        """
        Record a failed operation.

        Args:
            error: The exception that occurred (optional)
            category: Error category (auto-detected if error provided)
        """
        with self._lock:
            self._stats.failed_calls += 1
            self._stats.last_failure_time = time.time()
            self._last_failure_time = time.time()
            self._failure_count += 1
            self._consecutive_failures += 1

            # Categorize error
            if category is None and error is not None:
                category = ErrorCategory.from_exception(error)
            elif category is None:
                category = ErrorCategory.UNKNOWN

            self._failure_categories[category.value] += 1
            self._stats.failure_counts = dict(self._failure_categories)

            # Handle critical errors immediately
            if category == ErrorCategory.LIBRARY_CRASH:
                self._transition_to(CircuitState.OPEN)
                self._backoff_multiplier = 4  # Longer recovery for crashes
                return

            if self._state == CircuitState.CLOSED:
                if self._failure_count >= self._failure_threshold:
                    self._transition_to(CircuitState.OPEN)

            elif self._state == CircuitState.HALF_OPEN:
                # Any failure in half-open state reopens circuit
                self._transition_to(CircuitState.OPEN)
                if self._exponential_backoff:
                    self._backoff_multiplier = min(self._backoff_multiplier * 2, 8)

            self._success_count = 0

    def reset(self) -> None:
        """Reset the circuit breaker to initial state."""
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            self._half_open_calls = 0
            self._consecutive_failures = 0
            self._failure_categories.clear()
            self._state_change_time = time.time()
            self._last_failure_time = None
            self._backoff_multiplier = 1

            logger.info("circuit_breaker_reset")

    def force_open(self) -> None:
        """Force the circuit to open state."""
        with self._lock:
            self._transition_to(CircuitState.OPEN)

    def force_close(self) -> None:
        """Force the circuit to closed state."""
        with self._lock:
            self._transition_to(CircuitState.CLOSED)

    def get_stats(self) -> dict:
        """Get circuit breaker statistics."""
        with self._lock:
            self._stats.time_in_current_state = time.time() - self._state_change_time
            return self._stats.to_dict()

    def get_failure_analysis(self) -> dict:
        """
        Analyze failure patterns and suggest likely cause.

        Returns:
            Dictionary with analysis results
        """
        with self._lock:
            if not self._failure_categories:
                return {
                    "likely_cause": None,
                    "recommendation": "No failures recorded",
                    "failure_breakdown": {},
                }

            # Find most common failure type
            most_common = self._failure_categories.most_common(1)[0]
            category, count = most_common

            total_failures = sum(self._failure_categories.values())
            percentage = (count / total_failures * 100) if total_failures > 0 else 0

            recommendations = {
                ErrorCategory.MEMORY.value: "Check system memory, consider reducing batch sizes",
                ErrorCategory.MALFORMED.value: "Review input validation, check message sources",
                ErrorCategory.UNSUPPORTED.value: "Update label filtering, check libacars version",
                ErrorCategory.LIBRARY_CRASH.value: "Critical: Check libacars installation, review logs",
                ErrorCategory.JSON_ERROR.value: "Check libacars output format, may need update",
                ErrorCategory.TIMEOUT.value: "Increase timeout or reduce message complexity",
                ErrorCategory.LOAD_ERROR.value: "Verify libacars is installed and accessible",
                ErrorCategory.UNKNOWN.value: "Review error logs for detailed information",
            }

            return {
                "likely_cause": category,
                "likely_cause_percentage": round(percentage, 1),
                "recommendation": recommendations.get(category, "Unknown error type"),
                "failure_breakdown": dict(self._failure_categories),
                "total_failures": total_failures,
                "consecutive_failures": self._consecutive_failures,
            }

    def execute(
        self,
        func: Callable[[], T],
        fallback: Optional[Callable[[], T]] = None,
    ) -> Optional[T]:
        """
        Execute a function with circuit breaker protection.

        Args:
            func: Function to execute
            fallback: Optional fallback function if circuit is open

        Returns:
            Function result, fallback result, or None
        """
        if not self.can_execute():
            if fallback:
                return fallback()
            return None

        try:
            result = func()
            self.record_success()
            return result
        except Exception as e:
            self.record_failure(error=e)
            if fallback:
                return fallback()
            raise


# Global circuit breaker instance
_circuit_breaker: Optional[CircuitBreaker] = None


def get_circuit_breaker(
    failure_threshold: int = 5,
    recovery_timeout: float = 60.0,
) -> CircuitBreaker:
    """
    Get or create the global circuit breaker instance.

    Args:
        failure_threshold: Failures before opening (only used on first call)
        recovery_timeout: Recovery timeout in seconds (only used on first call)

    Returns:
        The global CircuitBreaker instance
    """
    global _circuit_breaker
    if _circuit_breaker is None:
        _circuit_breaker = CircuitBreaker(
            failure_threshold=failure_threshold,
            recovery_timeout=recovery_timeout,
        )
    return _circuit_breaker


def reset_circuit_breaker() -> None:
    """Reset the global circuit breaker instance."""
    global _circuit_breaker
    if _circuit_breaker is not None:
        _circuit_breaker.reset()
    _circuit_breaker = None
