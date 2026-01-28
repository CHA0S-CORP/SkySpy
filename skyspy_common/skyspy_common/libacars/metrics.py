"""
Metrics and observability for libacars binding.

Provides:
- Prometheus metrics export
- Structured logging helpers
- Performance tracking
- Health checks
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class TimingStats:
    """Statistics for timing measurements."""

    count: int = 0
    total_ms: float = 0.0
    min_ms: float = float("inf")
    max_ms: float = 0.0
    last_ms: float = 0.0

    def record(self, duration_ms: float) -> None:
        """Record a timing measurement."""
        self.count += 1
        self.total_ms += duration_ms
        self.last_ms = duration_ms
        self.min_ms = min(self.min_ms, duration_ms)
        self.max_ms = max(self.max_ms, duration_ms)

    @property
    def avg_ms(self) -> float:
        """Calculate average duration."""
        return (self.total_ms / self.count) if self.count > 0 else 0.0

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "count": self.count,
            "total_ms": round(self.total_ms, 2),
            "avg_ms": round(self.avg_ms, 2),
            "min_ms": round(self.min_ms, 2) if self.min_ms != float("inf") else 0.0,
            "max_ms": round(self.max_ms, 2),
            "last_ms": round(self.last_ms, 2),
        }


@dataclass
class CounterStats:
    """Statistics for counter measurements."""

    value: int = 0
    last_increment: int = 0
    last_increment_time: Optional[float] = None

    def increment(self, delta: int = 1) -> int:
        """Increment the counter."""
        self.value += delta
        self.last_increment = delta
        self.last_increment_time = time.time()
        return self.value

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "value": self.value,
            "last_increment": self.last_increment,
            "last_increment_time": self.last_increment_time,
        }


class MetricsCollector:
    """
    Centralized metrics collector for libacars operations.

    Collects and aggregates metrics for:
    - Decode operations (count, timing, success rate)
    - Cache performance (hits, misses, evictions)
    - Circuit breaker state
    - Resource pool usage
    - Error rates by category

    Usage:
        metrics = MetricsCollector()

        # Record decode operation
        with metrics.time_operation("decode"):
            result = decode_acars_apps(...)

        # Record event
        metrics.increment("decode_success")

        # Export metrics
        prometheus_output = metrics.export_prometheus()
    """

    def __init__(self, prefix: str = "libacars"):
        """
        Initialize the metrics collector.

        Args:
            prefix: Prefix for all metric names
        """
        self._prefix = prefix
        self._lock = threading.RLock()

        # Timing metrics
        self._timings: dict[str, TimingStats] = {}

        # Counter metrics
        self._counters: dict[str, CounterStats] = {}

        # Gauge metrics (current values)
        self._gauges: dict[str, float] = {}

        # Labels for dimensional metrics
        self._labels: dict[str, dict[str, Any]] = {}

        # Start time for uptime calculation
        self._start_time = time.time()

    def time_operation(self, name: str) -> "TimingContext":
        """
        Context manager for timing an operation.

        Args:
            name: Name of the operation

        Returns:
            TimingContext that records duration on exit
        """
        return TimingContext(self, name)

    def record_timing(self, name: str, duration_ms: float) -> None:
        """
        Record a timing measurement.

        Args:
            name: Name of the operation
            duration_ms: Duration in milliseconds
        """
        with self._lock:
            if name not in self._timings:
                self._timings[name] = TimingStats()
            self._timings[name].record(duration_ms)

    def increment(self, name: str, delta: int = 1) -> int:
        """
        Increment a counter.

        Args:
            name: Counter name
            delta: Amount to increment

        Returns:
            New counter value
        """
        with self._lock:
            if name not in self._counters:
                self._counters[name] = CounterStats()
            return self._counters[name].increment(delta)

    def set_gauge(self, name: str, value: float) -> None:
        """
        Set a gauge value.

        Args:
            name: Gauge name
            value: Current value
        """
        with self._lock:
            self._gauges[name] = value

    def get_counter(self, name: str) -> int:
        """Get current counter value."""
        with self._lock:
            counter = self._counters.get(name)
            return counter.value if counter else 0

    def get_gauge(self, name: str) -> float:
        """Get current gauge value."""
        with self._lock:
            return self._gauges.get(name, 0.0)

    def get_timing(self, name: str) -> Optional[dict]:
        """Get timing statistics for an operation."""
        with self._lock:
            timing = self._timings.get(name)
            return timing.to_dict() if timing else None

    def get_all_metrics(self) -> dict:
        """
        Get all metrics as a dictionary.

        Returns:
            Dictionary with all metrics organized by type
        """
        with self._lock:
            return {
                "uptime_seconds": round(time.time() - self._start_time, 2),
                "counters": {
                    name: counter.to_dict()
                    for name, counter in self._counters.items()
                },
                "timings": {
                    name: timing.to_dict()
                    for name, timing in self._timings.items()
                },
                "gauges": dict(self._gauges),
            }

    def export_prometheus(self) -> str:
        """
        Export metrics in Prometheus format.

        Returns:
            String containing metrics in Prometheus exposition format
        """
        lines = []
        prefix = self._prefix

        with self._lock:
            # Uptime
            uptime = time.time() - self._start_time
            lines.append(f"# HELP {prefix}_uptime_seconds Time since metrics collector started")
            lines.append(f"# TYPE {prefix}_uptime_seconds gauge")
            lines.append(f"{prefix}_uptime_seconds {uptime:.2f}")
            lines.append("")

            # Counters
            for name, counter in self._counters.items():
                metric_name = f"{prefix}_{name}_total"
                lines.append(f"# HELP {metric_name} Total count of {name}")
                lines.append(f"# TYPE {metric_name} counter")
                lines.append(f"{metric_name} {counter.value}")
                lines.append("")

            # Timings (as histograms/summaries)
            for name, timing in self._timings.items():
                base_name = f"{prefix}_{name}"

                lines.append(f"# HELP {base_name}_duration_ms Duration of {name} operations")
                lines.append(f"# TYPE {base_name}_duration_ms summary")
                lines.append(f'{base_name}_duration_ms{{quantile="0"}} {timing.min_ms:.2f}')
                lines.append(f'{base_name}_duration_ms{{quantile="1"}} {timing.max_ms:.2f}')
                lines.append(f"{base_name}_duration_ms_sum {timing.total_ms:.2f}")
                lines.append(f"{base_name}_duration_ms_count {timing.count}")
                lines.append("")

                # Also export average as gauge
                lines.append(f"# HELP {base_name}_avg_ms Average duration of {name}")
                lines.append(f"# TYPE {base_name}_avg_ms gauge")
                lines.append(f"{base_name}_avg_ms {timing.avg_ms:.2f}")
                lines.append("")

            # Gauges
            for name, value in self._gauges.items():
                metric_name = f"{prefix}_{name}"
                lines.append(f"# HELP {metric_name} Current value of {name}")
                lines.append(f"# TYPE {metric_name} gauge")
                lines.append(f"{metric_name} {value}")
                lines.append("")

        return "\n".join(lines)

    def reset(self) -> None:
        """Reset all metrics."""
        with self._lock:
            self._timings.clear()
            self._counters.clear()
            self._gauges.clear()
            self._start_time = time.time()


class TimingContext:
    """Context manager for timing operations."""

    def __init__(self, collector: MetricsCollector, name: str):
        self._collector = collector
        self._name = name
        self._start_time: Optional[float] = None

    def __enter__(self) -> "TimingContext":
        self._start_time = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._start_time is not None:
            duration_ms = (time.perf_counter() - self._start_time) * 1000
            self._collector.record_timing(self._name, duration_ms)


class HealthChecker:
    """
    Health check provider for libacars binding.

    Provides health status based on:
    - Library availability
    - Error rates
    - Circuit breaker state
    - Resource availability
    """

    def __init__(
        self,
        error_rate_threshold: float = 50.0,
        min_checks_for_health: int = 10,
    ):
        """
        Initialize the health checker.

        Args:
            error_rate_threshold: Error rate percentage above which unhealthy
            min_checks_for_health: Minimum operations before health is meaningful
        """
        self._error_rate_threshold = error_rate_threshold
        self._min_checks = min_checks_for_health
        self._checks: list[Callable[[], tuple[bool, str]]] = []

    def add_check(self, name: str, check_func: Callable[[], tuple[bool, str]]) -> None:
        """
        Add a health check.

        Args:
            name: Name of the check
            check_func: Function returning (is_healthy, message)
        """
        self._checks.append((name, check_func))

    def check_health(self) -> dict:
        """
        Run all health checks.

        Returns:
            Dictionary with overall status and individual check results
        """
        results = {}
        overall_healthy = True

        for name, check_func in self._checks:
            try:
                is_healthy, message = check_func()
                results[name] = {
                    "healthy": is_healthy,
                    "message": message,
                }
                if not is_healthy:
                    overall_healthy = False
            except Exception as e:
                results[name] = {
                    "healthy": False,
                    "message": f"Check failed: {e}",
                }
                overall_healthy = False

        return {
            "healthy": overall_healthy,
            "timestamp": time.time(),
            "checks": results,
        }


# Global metrics collector instance
_metrics: Optional[MetricsCollector] = None


def get_metrics_collector(prefix: str = "libacars") -> MetricsCollector:
    """
    Get or create the global metrics collector.

    Args:
        prefix: Metric name prefix (only used on first call)

    Returns:
        The global MetricsCollector instance
    """
    global _metrics
    if _metrics is None:
        _metrics = MetricsCollector(prefix=prefix)
    return _metrics


def reset_metrics() -> None:
    """Reset the global metrics collector."""
    global _metrics
    if _metrics is not None:
        _metrics.reset()
    _metrics = None


# Convenience functions for common metrics
def record_decode_attempt() -> None:
    """Record a decode attempt."""
    get_metrics_collector().increment("decode_attempts")


def record_decode_success(duration_ms: float) -> None:
    """Record a successful decode with timing."""
    metrics = get_metrics_collector()
    metrics.increment("decode_success")
    metrics.record_timing("decode", duration_ms)


def record_decode_failure(error_category: str) -> None:
    """Record a decode failure."""
    metrics = get_metrics_collector()
    metrics.increment("decode_failures")
    metrics.increment(f"decode_failures_{error_category}")


def record_cache_hit() -> None:
    """Record a cache hit."""
    get_metrics_collector().increment("cache_hits")


def record_cache_miss() -> None:
    """Record a cache miss."""
    get_metrics_collector().increment("cache_misses")


def update_circuit_state(state: str) -> None:
    """Update the circuit breaker state gauge."""
    state_values = {"closed": 0, "half_open": 1, "open": 2}
    value = state_values.get(state.lower(), -1)
    get_metrics_collector().set_gauge("circuit_state", value)
