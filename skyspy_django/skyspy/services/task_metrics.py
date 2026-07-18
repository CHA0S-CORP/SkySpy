"""
Celery task metrics collection with optional Prometheus export.

Tracks:
- Task execution duration (histogram)
- Task success/failure counts
- Queue depth per queue
- Active task counts

This module provides centralized metrics collection for Celery tasks,
enabling monitoring of task health, performance, and queue backlogs.
"""

import functools
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class TaskMetrics:
    """Metrics for a single task type."""

    execution_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    total_duration_ms: float = 0
    last_execution: float | None = None
    last_success: float | None = None
    last_failure: float | None = None
    last_error: str | None = None
    duration_buckets: dict = field(default_factory=lambda: defaultdict(int))

    @property
    def avg_duration_ms(self) -> float:
        """Calculate average execution duration."""
        if self.execution_count == 0:
            return 0
        return self.total_duration_ms / self.execution_count

    @property
    def success_rate(self) -> float:
        """Calculate success rate as a decimal (0.0 to 1.0)."""
        if self.execution_count == 0:
            return 0
        return self.success_count / self.execution_count


class CeleryMetricsCollector:
    """
    Collects and exports Celery task metrics.

    Thread-safe metrics collection for use across multiple Celery workers.
    Provides:
    - Per-task execution metrics (count, duration, success/failure)
    - Queue depth monitoring
    - Active task tracking
    - Stale task detection
    - Prometheus-format export
    """

    # Duration histogram buckets in milliseconds
    DURATION_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]

    def __init__(self):
        self._metrics: dict[str, TaskMetrics] = defaultdict(TaskMetrics)
        self._lock = threading.Lock()
        self._queue_depths: dict[str, int] = {}
        self._active_tasks: dict[str, int] = defaultdict(int)

    def record_task_start(self, task_name: str) -> None:
        """
        Record task execution start.

        Args:
            task_name: Full task name (e.g., 'skyspy.tasks.aircraft.poll_aircraft')
        """
        with self._lock:
            self._active_tasks[task_name] += 1

    def record_task_complete(
        self,
        task_name: str,
        duration_ms: float,
        success: bool = True,
        error: str | None = None,
    ) -> None:
        """
        Record task completion with duration.

        Args:
            task_name: Full task name
            duration_ms: Execution duration in milliseconds
            success: Whether the task completed successfully
            error: Error message if task failed
        """
        now = time.time()

        with self._lock:
            metrics = self._metrics[task_name]
            metrics.execution_count += 1
            metrics.total_duration_ms += duration_ms
            metrics.last_execution = now

            # Update duration histogram bucket
            for bucket in self.DURATION_BUCKETS:
                if duration_ms <= bucket:
                    metrics.duration_buckets[bucket] += 1
                    break
            else:
                metrics.duration_buckets[float("inf")] += 1

            if success:
                metrics.success_count += 1
                metrics.last_success = now
            else:
                metrics.failure_count += 1
                metrics.last_failure = now
                metrics.last_error = error

            self._active_tasks[task_name] = max(0, self._active_tasks[task_name] - 1)

    def update_queue_depth(self, queue_name: str, depth: int) -> None:
        """
        Update queue depth metric.

        Args:
            queue_name: Name of the Celery queue
            depth: Current queue depth (number of pending tasks)
        """
        with self._lock:
            self._queue_depths[queue_name] = depth

    def get_task_metrics(self, task_name: str) -> dict:
        """
        Get metrics for a specific task.

        Args:
            task_name: Full task name

        Returns:
            Dict with task metrics or empty dict if task not found
        """
        with self._lock:
            m = self._metrics.get(task_name)
            if not m:
                return {}
            return {
                "execution_count": m.execution_count,
                "success_count": m.success_count,
                "failure_count": m.failure_count,
                "success_rate": round(m.success_rate, 3),
                "avg_duration_ms": round(m.avg_duration_ms, 2),
                "last_execution": m.last_execution,
                "last_success": m.last_success,
                "last_failure": m.last_failure,
                "last_error": m.last_error,
            }

    def get_all_metrics(self) -> dict:
        """
        Get all collected metrics.

        Returns:
            Dict containing tasks, queues, and active_tasks metrics
        """
        with self._lock:
            return {
                "tasks": {
                    name: {
                        "execution_count": m.execution_count,
                        "success_count": m.success_count,
                        "failure_count": m.failure_count,
                        "success_rate": round(m.success_rate, 3),
                        "avg_duration_ms": round(m.avg_duration_ms, 2),
                        "last_execution": m.last_execution,
                        "last_success": m.last_success,
                        "last_failure": m.last_failure,
                        "active": self._active_tasks.get(name, 0),
                    }
                    for name, m in self._metrics.items()
                },
                "queues": dict(self._queue_depths),
                "active_tasks": dict(self._active_tasks),
                "total_active": sum(self._active_tasks.values()),
                "total_executions": sum(m.execution_count for m in self._metrics.values()),
                "total_failures": sum(m.failure_count for m in self._metrics.values()),
            }

    def get_stale_tasks(self, max_age_seconds: dict[str, int]) -> list[str]:
        """
        Get tasks that haven't run within their expected interval.

        Args:
            max_age_seconds: Dict mapping task name to max allowed age in seconds

        Returns:
            List of stale task names
        """
        now = time.time()
        stale = []

        with self._lock:
            for task_name, max_age in max_age_seconds.items():
                metrics = self._metrics.get(task_name)
                if not metrics or not metrics.last_execution or now - metrics.last_execution > max_age:
                    stale.append(task_name)

        return stale

    def get_failing_tasks(self, min_failure_rate: float = 0.5, min_executions: int = 10) -> list[dict]:
        """
        Get tasks with high failure rates.

        Args:
            min_failure_rate: Minimum failure rate to consider (0.0 to 1.0)
            min_executions: Minimum executions required to evaluate

        Returns:
            List of dicts with task name and failure info
        """
        failing = []

        with self._lock:
            for task_name, m in self._metrics.items():
                if m.execution_count >= min_executions:
                    failure_rate = 1.0 - m.success_rate
                    if failure_rate >= min_failure_rate:
                        failing.append(
                            {
                                "task_name": task_name,
                                "failure_rate": round(failure_rate, 3),
                                "failure_count": m.failure_count,
                                "execution_count": m.execution_count,
                                "last_error": m.last_error,
                            }
                        )

        return sorted(failing, key=lambda x: x["failure_rate"], reverse=True)

    def reset_task_metrics(self, task_name: str) -> None:
        """Reset metrics for a specific task."""
        with self._lock:
            if task_name in self._metrics:
                self._metrics[task_name] = TaskMetrics()

    def reset_all_metrics(self) -> None:
        """Reset all collected metrics."""
        with self._lock:
            self._metrics.clear()
            self._queue_depths.clear()
            self._active_tasks.clear()

    def export_prometheus(self) -> str:
        """
        Export metrics in Prometheus format.

        Returns:
            Prometheus-formatted metrics string
        """
        lines = []

        with self._lock:
            # Task metrics
            for task_name, m in self._metrics.items():
                safe_name = task_name.replace(".", "_")
                lines.append(f'celery_task_total{{task="{safe_name}"}} {m.execution_count}')
                lines.append(f'celery_task_success{{task="{safe_name}"}} {m.success_count}')
                lines.append(f'celery_task_failure{{task="{safe_name}"}} {m.failure_count}')
                lines.append(f'celery_task_duration_ms_avg{{task="{safe_name}"}} {m.avg_duration_ms:.2f}')

                # Duration histogram buckets
                cumulative = 0
                for bucket in self.DURATION_BUCKETS:
                    cumulative += m.duration_buckets.get(bucket, 0)
                    lines.append(f'celery_task_duration_ms_bucket{{task="{safe_name}",le="{bucket}"}} {cumulative}')
                cumulative += m.duration_buckets.get(float("inf"), 0)
                lines.append(f'celery_task_duration_ms_bucket{{task="{safe_name}",le="+Inf"}} {cumulative}')

            # Queue depths
            for queue, depth in self._queue_depths.items():
                lines.append(f'celery_queue_depth{{queue="{queue}"}} {depth}')

            # Active tasks
            for task, count in self._active_tasks.items():
                safe_name = task.replace(".", "_")
                lines.append(f'celery_task_active{{task="{safe_name}"}} {count}')

            # Summary metrics
            total_active = sum(self._active_tasks.values())
            total_executions = sum(m.execution_count for m in self._metrics.values())
            total_failures = sum(m.failure_count for m in self._metrics.values())
            lines.append(f"celery_tasks_active_total {total_active}")
            lines.append(f"celery_tasks_executed_total {total_executions}")
            lines.append(f"celery_tasks_failed_total {total_failures}")

        return "\n".join(lines)


def timed_task(func: Any = None, *, name: str = None):
    """
    Decorator to automatically time Celery tasks.

    Records task start, completion, duration, and success/failure status.

    Usage:
        @shared_task
        @timed_task
        def my_task():
            ...

        @shared_task
        @timed_task(name="custom_task_name")
        def my_task():
            ...

    Args:
        func: The function to wrap (when used without arguments)
        name: Optional custom task name (defaults to function name)
    """

    def decorator(fn):
        task_name = name or fn.__name__

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            task_metrics.record_task_start(task_name)
            start = time.perf_counter()
            success = True
            error = None

            try:
                return fn(*args, **kwargs)
            except Exception as e:  # broad: task metrics wrapper must record any task failure, then re-raise
                success = False
                error = str(e)
                raise
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                task_metrics.record_task_complete(task_name, duration_ms, success, error)

        return wrapper

    if func is not None:
        return decorator(func)
    return decorator


# Global singleton instance
task_metrics = CeleryMetricsCollector()
