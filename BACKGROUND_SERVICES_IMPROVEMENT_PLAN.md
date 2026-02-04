# Django Background Services Improvement Plan

This document provides detailed implementation plans for improving the Django background services architecture in SkySpy.

---

## Table of Contents

1. [P0: Task Monitoring & Observability](#1-p0-task-monitoring--observability)
2. [P0: Fix Unbounded In-Memory Caches](#2-p0-fix-unbounded-in-memory-caches)
3. [P0: Async Webhook Delivery](#3-p0-async-webhook-delivery)
4. [P1: Redis Cooldown Key Cleanup](#4-p1-redis-cooldown-key-cleanup)
5. [P1: Batch Stats Aggregation](#5-p1-batch-stats-aggregation)
6. [P2: Task Dependencies with Celery Primitives](#6-p2-task-dependencies-with-celery-primitives)
7. [P2: Differential WebSocket Updates](#7-p2-differential-websocket-updates)
8. [P2: Connection Snapshot Caching](#8-p2-connection-snapshot-caching)
9. [P3: Database Index Optimization](#9-p3-database-index-optimization)
10. [P3: Alert Rule Segmentation](#10-p3-alert-rule-segmentation)
11. [P3: Consolidate RPi Configuration](#11-p3-consolidate-rpi-configuration)

---

## 1. P0: Task Monitoring & Observability

### Problem
No task duration tracking, queue depth monitoring, or alerting for stalled tasks. When tasks fail silently or queue backlogs occur, there's no visibility.

### Current State
- Tasks log manually via `logger.info()` but inconsistently
- No centralized metrics collection
- No health check for critical tasks like `stream_aircraft`
- No queue depth monitoring

### Solution

#### 1.1 Create Task Metrics Service

**New file: `skyspy_django/skyspy/services/task_metrics.py`**

```python
"""
Celery task metrics collection with optional Prometheus export.

Tracks:
- Task execution duration (histogram)
- Task success/failure counts
- Queue depth per queue
- Active task counts
"""

import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TaskMetrics:
    """Metrics for a single task type."""
    execution_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    total_duration_ms: float = 0
    last_execution: Optional[float] = None
    last_success: Optional[float] = None
    last_failure: Optional[float] = None
    duration_buckets: dict = field(default_factory=lambda: defaultdict(int))

    @property
    def avg_duration_ms(self) -> float:
        if self.execution_count == 0:
            return 0
        return self.total_duration_ms / self.execution_count

    @property
    def success_rate(self) -> float:
        if self.execution_count == 0:
            return 0
        return self.success_count / self.execution_count


class CeleryMetricsCollector:
    """Collects and exports Celery task metrics."""

    # Duration histogram buckets in ms
    DURATION_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]

    def __init__(self):
        self._metrics: dict[str, TaskMetrics] = defaultdict(TaskMetrics)
        self._lock = threading.Lock()
        self._queue_depths: dict[str, int] = {}
        self._active_tasks: dict[str, int] = defaultdict(int)

    def record_task_start(self, task_name: str):
        """Record task execution start."""
        with self._lock:
            self._active_tasks[task_name] += 1

    def record_task_complete(
        self,
        task_name: str,
        duration_ms: float,
        success: bool = True,
        error: Optional[str] = None
    ):
        """Record task completion with duration."""
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
                metrics.duration_buckets[float('inf')] += 1

            if success:
                metrics.success_count += 1
                metrics.last_success = now
            else:
                metrics.failure_count += 1
                metrics.last_failure = now

            self._active_tasks[task_name] = max(0, self._active_tasks[task_name] - 1)

    def update_queue_depth(self, queue_name: str, depth: int):
        """Update queue depth metric."""
        with self._lock:
            self._queue_depths[queue_name] = depth

    def get_task_metrics(self, task_name: str) -> dict:
        """Get metrics for a specific task."""
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
            }

    def get_all_metrics(self) -> dict:
        """Get all collected metrics."""
        with self._lock:
            return {
                "tasks": {
                    name: {
                        "execution_count": m.execution_count,
                        "success_rate": round(m.success_rate, 3),
                        "avg_duration_ms": round(m.avg_duration_ms, 2),
                        "active": self._active_tasks.get(name, 0),
                    }
                    for name, m in self._metrics.items()
                },
                "queues": dict(self._queue_depths),
                "active_tasks": dict(self._active_tasks),
            }

    def get_stale_tasks(self, max_age_seconds: dict[str, int]) -> list[str]:
        """
        Get tasks that haven't run within their expected interval.

        Args:
            max_age_seconds: Dict mapping task name to max allowed age

        Returns:
            List of stale task names
        """
        now = time.time()
        stale = []

        with self._lock:
            for task_name, max_age in max_age_seconds.items():
                metrics = self._metrics.get(task_name)
                if not metrics or not metrics.last_execution:
                    stale.append(task_name)
                elif now - metrics.last_execution > max_age:
                    stale.append(task_name)

        return stale

    def export_prometheus(self) -> str:
        """Export metrics in Prometheus format."""
        lines = []

        with self._lock:
            # Task metrics
            for task_name, m in self._metrics.items():
                safe_name = task_name.replace(".", "_")
                lines.append(f'celery_task_total{{task="{safe_name}"}} {m.execution_count}')
                lines.append(f'celery_task_success{{task="{safe_name}"}} {m.success_count}')
                lines.append(f'celery_task_failure{{task="{safe_name}"}} {m.failure_count}')
                lines.append(f'celery_task_duration_ms_avg{{task="{safe_name}"}} {m.avg_duration_ms:.2f}')

            # Queue depths
            for queue, depth in self._queue_depths.items():
                lines.append(f'celery_queue_depth{{queue="{queue}"}} {depth}')

            # Active tasks
            for task, count in self._active_tasks.items():
                safe_name = task.replace(".", "_")
                lines.append(f'celery_task_active{{task="{safe_name}"}} {count}')

        return "\n".join(lines)


# Global singleton
task_metrics = CeleryMetricsCollector()
```

#### 1.2 Create Task Timer Decorator

**Add to `skyspy_django/skyspy/services/task_metrics.py`**

```python
import functools
from celery import current_task


def timed_task(func=None, *, name: str = None):
    """
    Decorator to automatically time Celery tasks.

    Usage:
        @shared_task
        @timed_task
        def my_task():
            ...
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
            except Exception as e:
                success = False
                error = str(e)
                raise
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                task_metrics.record_task_complete(
                    task_name, duration_ms, success, error
                )

        return wrapper

    if func is not None:
        return decorator(func)
    return decorator
```

#### 1.3 Add Queue Depth Monitoring Task

**New file: `skyspy_django/skyspy/tasks/monitoring.py`**

```python
"""
Monitoring tasks for Celery health and metrics.
"""

import logging
from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)


@shared_task
def update_queue_metrics():
    """
    Update queue depth metrics.

    Runs every 30 seconds to check queue depths across all queues.
    """
    from skyspy.services.task_metrics import task_metrics

    try:
        import redis

        redis_url = getattr(settings, "CELERY_BROKER_URL", settings.REDIS_URL)
        r = redis.from_url(redis_url)

        queues = ["polling", "database", "notifications", "transcription", "low_priority", "default"]

        for queue in queues:
            # Celery uses lists in Redis for queues
            depth = r.llen(queue)
            task_metrics.update_queue_depth(queue, depth)

        return {"status": "ok", "queues": {q: task_metrics._queue_depths.get(q, 0) for q in queues}}

    except Exception as e:
        logger.warning(f"Failed to update queue metrics: {e}")
        return {"status": "error", "error": str(e)}


@shared_task
def check_task_health():
    """
    Check for stale or failing tasks.

    Runs every minute to detect tasks that haven't executed within
    their expected intervals.
    """
    from skyspy.services.task_metrics import task_metrics
    from skyspy.socketio.utils import sync_emit

    # Expected max age for critical tasks (in seconds)
    critical_task_intervals = {
        "skyspy.tasks.aircraft.poll_aircraft": 10,  # Should run every 1-2s
        "skyspy.tasks.aircraft_stream.stream_aircraft": 60,  # Long-running, check restart
        "skyspy.tasks.aircraft.update_stats_cache": 120,  # Every 60s
        "skyspy.tasks.aircraft.update_safety_stats": 60,  # Every 30s
    }

    stale_tasks = task_metrics.get_stale_tasks(critical_task_intervals)

    if stale_tasks:
        logger.warning(f"Stale tasks detected: {stale_tasks}")

        # Broadcast health warning
        try:
            sync_emit("system:health", {
                "status": "degraded",
                "stale_tasks": stale_tasks,
            }, room="topic_admin")
        except Exception:
            pass

        return {"status": "warning", "stale_tasks": stale_tasks}

    return {"status": "healthy"}


@shared_task
def collect_worker_stats():
    """
    Collect Celery worker statistics.
    """
    from skyspy.celery import app

    try:
        inspect = app.control.inspect()

        stats = {
            "active": inspect.active() or {},
            "reserved": inspect.reserved() or {},
            "scheduled": inspect.scheduled() or {},
        }

        # Count active tasks per worker
        worker_stats = {}
        for worker, tasks in stats["active"].items():
            worker_stats[worker] = {
                "active_tasks": len(tasks),
                "reserved_tasks": len(stats["reserved"].get(worker, [])),
            }

        return {"workers": worker_stats}

    except Exception as e:
        logger.warning(f"Failed to collect worker stats: {e}")
        return {"error": str(e)}
```

#### 1.4 Add to Beat Schedule

**Modify `skyspy_django/skyspy/celery.py`**

```python
# Add to beat_schedule dict:

    # Monitoring tasks
    "update-queue-metrics-every-30s": {
        "task": "skyspy.tasks.monitoring.update_queue_metrics",
        "schedule": 30.0,
    },
    "check-task-health-every-60s": {
        "task": "skyspy.tasks.monitoring.check_task_health",
        "schedule": 60.0,
    },
    "collect-worker-stats-every-5m": {
        "task": "skyspy.tasks.monitoring.collect_worker_stats",
        "schedule": 300.0,
    },
```

#### 1.5 Add Metrics API Endpoint

**Add to `skyspy_django/skyspy/api/config.py`**

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([IsAdminUser])
def task_metrics_view(request):
    """Get Celery task metrics."""
    from skyspy.services.task_metrics import task_metrics

    format = request.query_params.get("format", "json")

    if format == "prometheus":
        return Response(
            task_metrics.export_prometheus(),
            content_type="text/plain"
        )

    return Response(task_metrics.get_all_metrics())
```

### Files to Create/Modify
- **Create**: `skyspy_django/skyspy/services/task_metrics.py`
- **Create**: `skyspy_django/skyspy/tasks/monitoring.py`
- **Modify**: `skyspy_django/skyspy/celery.py` (add beat schedule entries)
- **Modify**: `skyspy_django/skyspy/api/config.py` (add metrics endpoint)
- **Modify**: `skyspy_django/skyspy/tasks/__init__.py` (import monitoring)

### Testing
```python
# tests/test_task_metrics.py
def test_task_metrics_recording():
    from skyspy.services.task_metrics import task_metrics

    task_metrics.record_task_start("test_task")
    task_metrics.record_task_complete("test_task", 150.0, success=True)

    metrics = task_metrics.get_task_metrics("test_task")
    assert metrics["execution_count"] == 1
    assert metrics["success_count"] == 1
    assert metrics["avg_duration_ms"] == 150.0

def test_stale_task_detection():
    from skyspy.services.task_metrics import task_metrics

    # Task that hasn't run
    stale = task_metrics.get_stale_tasks({"missing_task": 60})
    assert "missing_task" in stale
```

---

## 2. P0: Fix Unbounded In-Memory Caches

### Problem
Multiple in-memory caches can grow indefinitely, causing memory exhaustion on long-running workers:

| Cache | Location | Current Behavior |
|-------|----------|------------------|
| `_memory_cache` | `services/cache.py:156` | Dict with TTL but no size limit |
| `_rate_limit_timestamps` | `services/cache.py:160` | Dict, never cleaned proactively |
| `_last_lookup` | `services/aircraft_info.py:62` | Dict with size limit but lazy cleanup |
| LLM cache | `services/llm.py` | Dict, prunes only at 1000 entries |

### Solution

#### 2.1 Add Size Limits to Memory Cache

**Modify `skyspy_django/skyspy/services/cache.py`**

```python
# Replace the unbounded _memory_cache with a BoundedCache instance

# Line 156 - Replace:
# _memory_cache: dict[str, tuple[Any, float]] = {}
# _memory_cache_lock = threading.RLock()

# With:
_memory_cache = BoundedCache(maxsize=10000, name="memory")


def get_from_memory_cache(key: str) -> tuple[bool, Any]:
    """Get value from in-memory cache."""
    value = _memory_cache.get(key)
    if value is not None:
        return True, value
    return False, None


def set_in_memory_cache(key: str, value: Any, ttl: int = None):
    """Set value in in-memory cache."""
    if ttl is None:
        ttl = getattr(settings, "CACHE_TTL", 300)
    _memory_cache.set(key, value, ttl=ttl)


def delete_from_memory_cache(key: str):
    """Delete value from in-memory cache."""
    _memory_cache.delete(key)


def clear_memory_cache():
    """Clear all entries from in-memory cache."""
    _memory_cache.clear()


def cleanup_expired_memory_cache():
    """Remove expired entries from in-memory cache."""
    return _memory_cache.cleanup_expired()
```

#### 2.2 Add Bounded Rate Limit Cache

**Modify `skyspy_django/skyspy/services/cache.py`**

```python
# Replace unbounded rate limit dict with bounded version

class BoundedRateLimitCache:
    """
    Bounded rate limit cache with automatic cleanup.
    """

    MAX_SIZE = 10000

    def __init__(self, maxsize: int = MAX_SIZE):
        self._timestamps: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self._maxsize = maxsize

    def check_and_set(self, key: str, min_interval: float) -> bool:
        """
        Check if rate limit allows and set timestamp if so.

        Returns True if allowed, False if rate limited.
        """
        now = time.time()

        with self._lock:
            # Cleanup if too large
            if len(self._timestamps) >= self._maxsize:
                self._cleanup_old(now, min_interval * 2)

            last = self._timestamps.get(key, 0)
            if now - last < min_interval:
                return False

            # Update and move to end
            self._timestamps[key] = now
            self._timestamps.move_to_end(key)
            return True

    def get_remaining(self, key: str, min_interval: float) -> float:
        """Get remaining seconds until rate limit clears."""
        now = time.time()
        with self._lock:
            last = self._timestamps.get(key, 0)
            remaining = min_interval - (now - last)
            return max(0, remaining)

    def reset(self, key: str):
        """Reset rate limit for a key."""
        with self._lock:
            self._timestamps.pop(key, None)

    def clear(self):
        """Clear all rate limits."""
        with self._lock:
            self._timestamps.clear()

    def _cleanup_old(self, now: float, max_age: float):
        """Remove entries older than max_age. Must hold lock."""
        cutoff = now - max_age
        while self._timestamps:
            key, ts = next(iter(self._timestamps.items()))
            if ts < cutoff:
                del self._timestamps[key]
            else:
                break

    def cleanup(self, max_age: float = 7200):
        """Public cleanup method."""
        now = time.time()
        with self._lock:
            self._cleanup_old(now, max_age)

    def __len__(self):
        return len(self._timestamps)


# Replace global rate limit dict
_rate_limiter = BoundedRateLimitCache(maxsize=10000)


def check_rate_limit(key: str, min_interval: int = None) -> bool:
    """Check if an upstream API call is allowed based on rate limiting."""
    if min_interval is None:
        min_interval = settings.UPSTREAM_API_MIN_INTERVAL
    return _rate_limiter.check_and_set(key, min_interval)


def get_rate_limit_remaining(key: str, min_interval: int = None) -> float:
    """Get remaining seconds until rate limit allows next call."""
    if min_interval is None:
        min_interval = settings.UPSTREAM_API_MIN_INTERVAL
    return _rate_limiter.get_remaining(key, min_interval)


def reset_rate_limit(key: str):
    """Reset rate limit for a specific key."""
    _rate_limiter.reset(key)


def clear_rate_limits():
    """Clear all rate limit timestamps."""
    _rate_limiter.clear()


def cleanup_rate_limits(max_age_seconds: int = 7200):
    """Clean up old rate limit entries."""
    _rate_limiter.cleanup(max_age_seconds)
```

#### 2.3 Fix LLM Cache

**Modify `skyspy_django/skyspy/services/llm.py`**

```python
# Add at top of file:
from skyspy.services.cache import BoundedCache

# Replace the _cache dict with:
_llm_cache = BoundedCache(maxsize=1000, name="llm")


# Update cache access methods:
def _get_cached_response(prompt_hash: str) -> Optional[str]:
    """Get cached LLM response."""
    return _llm_cache.get(prompt_hash)


def _set_cached_response(prompt_hash: str, response: str, ttl: int = 3600):
    """Cache LLM response."""
    _llm_cache.set(prompt_hash, response, ttl=ttl)
```

#### 2.4 Add Periodic Cache Cleanup Task

**Already exists in `celery.py` but enhance it:**

**Modify `skyspy_django/skyspy/tasks/analytics.py`**

```python
@shared_task
def cleanup_memory_cache():
    """
    Clean up all in-memory caches to prevent memory growth.

    Runs every 5 minutes (configured in celery.py beat_schedule).
    """
    from skyspy.services.cache import (
        cleanup_all_caches,
        get_cache_stats,
    )

    # Run comprehensive cleanup
    cleanup_all_caches()

    # Log cache stats for monitoring
    stats = get_cache_stats()
    logger.debug(f"Cache cleanup complete: {stats}")

    return {"status": "ok", "stats": stats}
```

### Files to Modify
- `skyspy_django/skyspy/services/cache.py` - Replace unbounded caches
- `skyspy_django/skyspy/services/llm.py` - Use BoundedCache
- `skyspy_django/skyspy/tasks/analytics.py` - Enhance cleanup task

### Testing
```python
def test_bounded_cache_eviction():
    cache = BoundedCache(maxsize=3)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    cache.set("d", 4)  # Should evict 'a'

    assert cache.get("a") is None
    assert cache.get("b") == 2

def test_rate_limit_cleanup():
    limiter = BoundedRateLimitCache(maxsize=5)
    for i in range(10):
        limiter.check_and_set(f"key_{i}", 60)

    assert len(limiter) <= 5
```

---

## 3. P0: Async Webhook Delivery

### Problem
Webhook calls in `services/alerts.py:_call_webhook()` are synchronous and block the alert trigger flow. If a webhook is slow or times out, it delays all alert processing.

### Current State
```python
# services/alerts.py:475-484
def _call_webhook(self, url: str, data: dict):
    """Call external webhook with alert data."""
    try:
        self._post_webhook_with_retry(url, data)  # BLOCKING!
    except Exception as e:
        logger.error(f"Webhook call failed after retries: {e}")
```

### Solution

#### 3.1 Create Webhook Delivery Task

**Add to `skyspy_django/skyspy/tasks/notifications.py`**

```python
@shared_task(
    bind=True,
    max_retries=5,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=3600,
    retry_jitter=True,
)
def send_webhook_task(
    self,
    url: str,
    data: dict,
    timeout: float = 10.0,
    rule_id: int = None,
    rule_name: str = None,
):
    """
    Send webhook notification asynchronously with retry support.

    Args:
        url: Webhook URL to POST to
        data: JSON payload to send
        timeout: Request timeout in seconds
        rule_id: Alert rule ID for logging
        rule_name: Alert rule name for logging
    """
    import httpx
    from skyspy.services.notifications import _is_safe_url

    # Validate URL safety
    if not _is_safe_url(url):
        logger.warning(f"Blocked unsafe webhook URL for rule {rule_id}: {url[:100]}")
        return {"status": "blocked", "reason": "unsafe_url"}

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=data)
            response.raise_for_status()

            logger.debug(f"Webhook delivered to {url[:50]}... status={response.status_code}")
            return {
                "status": "delivered",
                "status_code": response.status_code,
                "rule_id": rule_id,
            }

    except httpx.TimeoutException:
        logger.warning(f"Webhook timeout for rule {rule_id}: {url[:50]}...")
        raise  # Will trigger retry

    except httpx.HTTPStatusError as e:
        logger.warning(f"Webhook HTTP error for rule {rule_id}: {e.response.status_code}")
        if e.response.status_code >= 500:
            raise  # Retry on 5xx
        return {
            "status": "failed",
            "status_code": e.response.status_code,
            "rule_id": rule_id,
        }

    except Exception as e:
        logger.error(f"Webhook failed for rule {rule_id}: {e}")
        raise  # Will trigger retry
```

#### 3.2 Update Alert Service to Use Async Webhooks

**Modify `skyspy_django/skyspy/services/alerts.py`**

```python
# Replace _call_webhook method:

def _call_webhook(self, url: str, data: dict, rule: CompiledRule):
    """
    Queue webhook delivery as async task.

    This is non-blocking - the actual HTTP call happens in a Celery worker.
    """
    from skyspy.tasks.notifications import send_webhook_task

    try:
        send_webhook_task.delay(
            url=url,
            data=data,
            timeout=10.0,
            rule_id=rule.id,
            rule_name=rule.name,
        )
        logger.debug(f"Queued webhook for rule {rule.id}")
    except Exception as e:
        logger.error(f"Failed to queue webhook for rule {rule.id}: {e}")


# Update _trigger_alert to pass rule object:
# Line 378-382:
if rule.api_url:
    if _is_safe_url(rule.api_url):
        self._call_webhook(rule.api_url, alert_data, rule)  # Pass rule
    else:
        logger.warning(f"Blocked unsafe webhook URL for rule {rule.id}")
```

#### 3.3 Add Webhook Queue Routing

**Modify `skyspy_django/skyspy/celery.py`**

```python
# Add to task_routes:
"skyspy.tasks.notifications.send_webhook_task": {"queue": "notifications"},
```

### Files to Modify
- `skyspy_django/skyspy/tasks/notifications.py` - Add `send_webhook_task`
- `skyspy_django/skyspy/services/alerts.py` - Update `_call_webhook`
- `skyspy_django/skyspy/celery.py` - Add queue routing

### Testing
```python
@pytest.mark.asyncio
async def test_webhook_task_success(mocker):
    mock_response = mocker.Mock()
    mock_response.status_code = 200

    mocker.patch("httpx.Client.post", return_value=mock_response)

    result = send_webhook_task(
        "https://example.com/webhook",
        {"test": "data"},
        rule_id=1,
    )

    assert result["status"] == "delivered"

def test_webhook_unsafe_url_blocked():
    result = send_webhook_task(
        "http://192.168.1.1/webhook",  # Private IP
        {"test": "data"},
        rule_id=1,
    )

    assert result["status"] == "blocked"
```

---

## 4. P1: Redis Cooldown Key Cleanup

### Problem
Redis keys for alert cooldowns (`alert:cooldown:{rule_id}:{icao}`) accumulate for aircraft that are no longer being tracked. While they have TTL, the pattern `SCAN` operations become slower over time.

### Current State
- Keys use `SETEX` with TTL equal to cooldown_seconds
- No proactive cleanup of keys for deleted rules
- Pattern scans for `clear_rule()` can be slow with many keys

### Solution

#### 4.1 Add Periodic Cooldown Cleanup Task

**Add to `skyspy_django/skyspy/tasks/cleanup.py`**

```python
@shared_task
def cleanup_orphan_cooldown_keys():
    """
    Clean up Redis cooldown keys for deleted alert rules.

    Runs daily at 4 AM (configured in celery.py).
    """
    from django.conf import settings
    from skyspy.models import AlertRule

    try:
        import redis

        redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
        r = redis.from_url(redis_url, decode_responses=True)

        # Get all active rule IDs
        active_rule_ids = set(AlertRule.objects.values_list("id", flat=True))

        # Scan for cooldown keys
        cursor = 0
        orphan_keys = []
        pattern = "alert:cooldown:*"

        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=500)

            for key in keys:
                # Extract rule_id from key: alert:cooldown:{rule_id}:{icao}
                parts = key.split(":")
                if len(parts) >= 3:
                    try:
                        rule_id = int(parts[2])
                        if rule_id not in active_rule_ids:
                            orphan_keys.append(key)
                    except ValueError:
                        pass

            if cursor == 0:
                break

        # Delete orphan keys in batches
        deleted = 0
        if orphan_keys:
            for i in range(0, len(orphan_keys), 100):
                batch = orphan_keys[i:i+100]
                deleted += r.delete(*batch)

        logger.info(f"Cleaned up {deleted} orphan cooldown keys")
        return {"deleted": deleted, "scanned": len(orphan_keys)}

    except Exception as e:
        logger.warning(f"Failed to cleanup cooldown keys: {e}")
        return {"error": str(e)}


@shared_task
def cleanup_stale_cooldown_keys(max_age_hours: int = 24):
    """
    Clean up cooldown keys that haven't been updated in a long time.

    This catches keys that somehow didn't expire properly.
    """
    from django.conf import settings

    try:
        import redis

        redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
        r = redis.from_url(redis_url, decode_responses=True)

        cursor = 0
        checked = 0
        deleted = 0
        pattern = "alert:cooldown:*"

        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=500)

            for key in keys:
                checked += 1
                # Check TTL - if no TTL, delete it
                ttl = r.ttl(key)
                if ttl == -1:  # No TTL set
                    r.delete(key)
                    deleted += 1

            if cursor == 0:
                break

        logger.info(f"Checked {checked} keys, deleted {deleted} without TTL")
        return {"checked": checked, "deleted": deleted}

    except Exception as e:
        logger.warning(f"Failed to cleanup stale keys: {e}")
        return {"error": str(e)}
```

#### 4.2 Add to Beat Schedule

**Modify `skyspy_django/skyspy/celery.py`**

```python
# Add to beat_schedule:

    # Cooldown key cleanup - daily at 4:30 AM UTC
    "cleanup-orphan-cooldown-keys-daily": {
        "task": "skyspy.tasks.cleanup.cleanup_orphan_cooldown_keys",
        "schedule": crontab(hour=4, minute=30),
    },
    # Stale cooldown key cleanup - weekly on Sundays at 5 AM
    "cleanup-stale-cooldown-keys-weekly": {
        "task": "skyspy.tasks.cleanup.cleanup_stale_cooldown_keys",
        "schedule": crontab(hour=5, minute=0, day_of_week="sunday"),
    },
```

#### 4.3 Add Cleanup on Rule Delete Signal

**Modify `skyspy_django/skyspy/models/alerts.py`**

```python
from django.db.models.signals import post_delete
from django.dispatch import receiver


@receiver(post_delete, sender=AlertRule)
def cleanup_rule_cooldowns(sender, instance, **kwargs):
    """Clean up cooldowns when a rule is deleted."""
    from skyspy.services.alert_cooldowns import cooldown_manager

    try:
        count = cooldown_manager.clear_rule(instance.id)
        logger.debug(f"Cleared {count} cooldowns for deleted rule {instance.id}")
    except Exception as e:
        logger.warning(f"Failed to clear cooldowns for rule {instance.id}: {e}")
```

### Files to Modify
- `skyspy_django/skyspy/tasks/cleanup.py` - Add cleanup tasks
- `skyspy_django/skyspy/celery.py` - Add beat schedule
- `skyspy_django/skyspy/models/alerts.py` - Add post_delete signal

### Testing
```python
def test_orphan_key_cleanup(redis_client, mocker):
    # Create keys for rules that don't exist
    redis_client.setex("alert:cooldown:9999:ABC123", 300, "1234567890")

    result = cleanup_orphan_cooldown_keys()

    assert result["deleted"] >= 1
    assert redis_client.get("alert:cooldown:9999:ABC123") is None
```

---

## 5. P1: Batch Stats Aggregation

### Problem
Multiple stats tasks run independently every 30-60 seconds, each making separate database queries:
- `update_stats_cache` (60s)
- `update_safety_stats` (30s)
- `update_acars_stats` (60s)

This creates redundant database connections and query overhead.

### Solution

#### 5.1 Create Unified Stats Aggregation Task

**Add to `skyspy_django/skyspy/tasks/analytics.py`**

```python
@shared_task
def aggregate_all_stats():
    """
    Unified stats aggregation task.

    Combines aircraft stats, safety stats, and ACARS stats into a single
    task with shared database connection and transaction.

    Runs every 60 seconds (replaces individual stats tasks).
    """
    from django.core.cache import cache
    from django.db import connection
    from django.utils import timezone
    from datetime import timedelta

    from skyspy.models import (
        AircraftPosition,
        SafetyEvent,
        AcarsMessage,
    )
    from skyspy.services.stats_cache import StatsCache

    start_time = time.perf_counter()
    results = {}

    try:
        # Use a single database connection for all queries
        with connection.cursor() as cursor:
            now = timezone.now()

            # 1. Aircraft Stats
            aircraft_stats = _compute_aircraft_stats(now)
            cache.set("aircraft_stats", aircraft_stats, timeout=120)
            results["aircraft_stats"] = "ok"

            # 2. Safety Stats
            safety_cutoff = now - timedelta(hours=24)
            safety_stats = _compute_safety_stats(safety_cutoff)
            cache.set("safety_stats", safety_stats, timeout=60)
            results["safety_stats"] = "ok"

            # 3. ACARS Stats
            acars_cutoff = now - timedelta(hours=1)
            acars_stats = _compute_acars_stats(acars_cutoff)
            cache.set("acars_stats", acars_stats, timeout=120)
            results["acars_stats"] = "ok"

        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.debug(f"Stats aggregation completed in {duration_ms:.1f}ms")

        return {
            "status": "ok",
            "duration_ms": round(duration_ms, 1),
            "results": results,
        }

    except Exception as e:
        logger.error(f"Stats aggregation failed: {e}")
        return {"status": "error", "error": str(e)}


def _compute_aircraft_stats(now) -> dict:
    """Compute aircraft statistics."""
    from skyspy.models import AircraftSession
    from django.db.models import Count, Avg, Max

    # Active sessions (seen in last 5 minutes)
    active_cutoff = now - timedelta(minutes=5)

    stats = AircraftSession.objects.filter(
        last_seen__gte=active_cutoff
    ).aggregate(
        total_aircraft=Count("id"),
        avg_altitude=Avg("last_altitude"),
        max_altitude=Max("last_altitude"),
    )

    # Category breakdown
    categories = AircraftSession.objects.filter(
        last_seen__gte=active_cutoff
    ).values("category").annotate(
        count=Count("id")
    ).order_by("-count")[:10]

    return {
        "total_aircraft": stats["total_aircraft"] or 0,
        "avg_altitude": round(stats["avg_altitude"] or 0),
        "max_altitude": stats["max_altitude"] or 0,
        "categories": list(categories),
        "timestamp": now.isoformat(),
    }


def _compute_safety_stats(cutoff) -> dict:
    """Compute safety event statistics."""
    from skyspy.models import SafetyEvent
    from django.db.models import Count

    stats = SafetyEvent.objects.filter(
        timestamp__gte=cutoff
    ).aggregate(
        total_events=Count("id"),
    )

    by_type = SafetyEvent.objects.filter(
        timestamp__gte=cutoff
    ).values("event_type").annotate(
        count=Count("id")
    ).order_by("-count")

    return {
        "total_events": stats["total_events"] or 0,
        "by_type": list(by_type),
    }


def _compute_acars_stats(cutoff) -> dict:
    """Compute ACARS message statistics."""
    from skyspy.models import AcarsMessage
    from django.db.models import Count

    stats = AcarsMessage.objects.filter(
        timestamp__gte=cutoff
    ).aggregate(
        total_messages=Count("id"),
    )

    return {
        "total_messages": stats["total_messages"] or 0,
        "period_hours": 1,
    }
```

#### 5.2 Update Beat Schedule

**Modify `skyspy_django/skyspy/celery.py`**

```python
# Replace these three entries:
# - "update-stats-cache-every-60s"
# - "update-safety-stats-every-30s"
# - "update-acars-stats-every-60s"

# With single unified task:
    "aggregate-all-stats-every-60s": {
        "task": "skyspy.tasks.analytics.aggregate_all_stats",
        "schedule": 60.0,
        "options": {"expires": 60.0},
    },
```

### Files to Modify
- `skyspy_django/skyspy/tasks/analytics.py` - Add unified task
- `skyspy_django/skyspy/celery.py` - Update beat schedule

### Testing
```python
def test_aggregate_all_stats(db):
    result = aggregate_all_stats()

    assert result["status"] == "ok"
    assert "aircraft_stats" in result["results"]
    assert "safety_stats" in result["results"]
    assert "acars_stats" in result["results"]
```

---

## 6. P2: Task Dependencies with Celery Primitives

### Problem
Task coordination is done via cache flags (e.g., `stream_aircraft` checks `aircraft_stream_active` cache key). This is error-prone and doesn't leverage Celery's built-in task composition.

### Current State
```python
# tasks/aircraft_stream.py
def start_aircraft_stream(self):
    # Check cache flag
    if cache.get("aircraft_stream_active"):
        return {"status": "already_running"}
    # Start stream...
```

### Solution

#### 6.1 Use Celery Primitives for Task Chains

**Modify `skyspy_django/skyspy/tasks/aircraft_stream.py`**

```python
from celery import chain, group, chord
from celery.result import AsyncResult


def get_stream_task_status() -> dict:
    """
    Check if stream task is running using Celery inspect.

    More reliable than cache flags.
    """
    from skyspy.celery import app

    try:
        inspect = app.control.inspect()
        active = inspect.active() or {}

        for worker, tasks in active.items():
            for task in tasks:
                if "stream_aircraft" in task.get("name", ""):
                    return {
                        "running": True,
                        "worker": worker,
                        "task_id": task.get("id"),
                    }

        return {"running": False}

    except Exception as e:
        logger.warning(f"Failed to inspect tasks: {e}")
        # Fall back to cache check
        from django.core.cache import cache
        return {"running": cache.get("aircraft_stream_active", False)}


@shared_task(bind=True)
def start_aircraft_stream(self):
    """
    Start aircraft streaming if not already running.

    Uses Celery inspect to check if stream is active.
    """
    status = get_stream_task_status()

    if status.get("running"):
        logger.debug(f"Stream already running on {status.get('worker')}")
        return {"status": "already_running", **status}

    # Start the stream task
    result = stream_aircraft.delay()

    return {
        "status": "started",
        "task_id": result.id,
    }


@shared_task(bind=True)
def orchestrate_aircraft_pipeline(self):
    """
    Orchestrate the full aircraft data pipeline using Celery primitives.

    Pipeline:
    1. Poll/stream aircraft data
    2. In parallel: lookup new aircraft, update sessions
    3. After both complete: update stats
    """
    from celery import group, chain

    # Define the pipeline
    pipeline = chain(
        # Step 1: Get aircraft data (stream or poll)
        poll_aircraft.si(),

        # Step 2: Parallel tasks after data received
        group(
            process_new_aircraft_lookups.si(),
            update_aircraft_sessions_from_cache.si(),
        ),

        # Step 3: Update stats after enrichment
        aggregate_all_stats.si(),
    )

    # Execute pipeline
    return pipeline.apply_async()
```

### Files to Modify
- `skyspy_django/skyspy/tasks/aircraft_stream.py` - Use Celery inspect and primitives

### Note
This is a larger refactor that should be done incrementally. Start with the `get_stream_task_status()` function and verify it works before replacing all cache-based coordination.

---

## 7. P2: Differential WebSocket Updates

### Problem
`broadcast_aircraft_update()` sends full aircraft state every cycle, even when only position changed. This wastes bandwidth and processing on clients.

### Current State
```python
# tasks/aircraft_stream.py
def broadcast_aircraft_update(aircraft_list: list):
    sync_emit("aircraft:update", {"aircraft": aircraft_list}, room="topic_aircraft")
```

### Solution

#### 7.1 Track State Changes

**Add to `skyspy_django/skyspy/tasks/aircraft_stream.py`**

```python
# Add state tracking
_previous_aircraft_state: dict[str, dict] = {}
_state_lock = threading.Lock()


def compute_aircraft_delta(current: list[dict]) -> dict:
    """
    Compute delta between current and previous aircraft state.

    Returns:
        {
            "added": [...],      # New aircraft
            "updated": [...],    # Changed aircraft (only changed fields)
            "removed": [...],    # Aircraft no longer present
            "full_update": bool, # True if too many changes, send full state
        }
    """
    global _previous_aircraft_state

    with _state_lock:
        current_by_hex = {ac["hex"]: ac for ac in current if ac.get("hex")}
        current_hexes = set(current_by_hex.keys())
        previous_hexes = set(_previous_aircraft_state.keys())

        added = []
        updated = []
        removed = list(previous_hexes - current_hexes)

        # Check for new and updated aircraft
        for hex_code, ac in current_by_hex.items():
            if hex_code not in _previous_aircraft_state:
                added.append(ac)
            else:
                # Check if changed
                prev = _previous_aircraft_state[hex_code]
                changes = _compute_field_changes(prev, ac)
                if changes:
                    updated.append({"hex": hex_code, **changes})

        # If too many changes, send full update
        total_changes = len(added) + len(updated) + len(removed)
        if total_changes > len(current) * 0.5:  # More than 50% changed
            _previous_aircraft_state = current_by_hex.copy()
            return {"full_update": True, "aircraft": current}

        # Update previous state
        _previous_aircraft_state = current_by_hex.copy()

        return {
            "full_update": False,
            "added": added,
            "updated": updated,
            "removed": removed,
        }


# Fields that trigger updates
TRACKED_FIELDS = {"lat", "lon", "alt", "alt_baro", "gs", "track", "vr", "squawk", "flight"}


def _compute_field_changes(prev: dict, curr: dict) -> dict:
    """Compute which fields changed between prev and curr."""
    changes = {}

    for field in TRACKED_FIELDS:
        prev_val = prev.get(field)
        curr_val = curr.get(field)

        if prev_val != curr_val:
            changes[field] = curr_val

    return changes


def broadcast_aircraft_delta(delta: dict):
    """
    Broadcast aircraft delta update.

    Clients receive either:
    - Full update: {"type": "full", "aircraft": [...]}
    - Delta update: {"type": "delta", "added": [...], "updated": [...], "removed": [...]}
    """
    if delta.get("full_update"):
        sync_emit("aircraft:update", {
            "type": "full",
            "aircraft": delta["aircraft"],
        }, room="topic_aircraft")
    else:
        sync_emit("aircraft:update", {
            "type": "delta",
            "added": delta.get("added", []),
            "updated": delta.get("updated", []),
            "removed": delta.get("removed", []),
        }, room="topic_aircraft")
```

#### 7.2 Update Stream Task

```python
# In stream_aircraft task, replace:
# broadcast_aircraft_update(aircraft_list)

# With:
delta = compute_aircraft_delta(aircraft_list)
broadcast_aircraft_delta(delta)
```

### Frontend Changes Required
The frontend needs to handle delta updates:
```javascript
socket.on("aircraft:update", (data) => {
    if (data.type === "full") {
        // Replace entire state
        setAircraft(data.aircraft);
    } else {
        // Apply delta
        setAircraft(prev => {
            const updated = {...prev};
            // Remove
            data.removed.forEach(hex => delete updated[hex]);
            // Add
            data.added.forEach(ac => updated[ac.hex] = ac);
            // Update
            data.updated.forEach(change => {
                if (updated[change.hex]) {
                    Object.assign(updated[change.hex], change);
                }
            });
            return updated;
        });
    }
});
```

### Files to Modify
- `skyspy_django/skyspy/tasks/aircraft_stream.py` - Add delta computation
- `web/src/hooks/socket/useSocketIOData.js` - Handle delta updates

---

## 8. P2: Connection Snapshot Caching

### Problem
Every new Socket.IO client connection triggers a full aircraft list query from the database, which is expensive with many concurrent connections.

### Current State
```python
# socketio/namespaces/main.py
async def _get_current_aircraft(self):
    # Queries database or cache every time
    return cache.get("current_aircraft") or []
```

### Solution

#### 8.1 Pre-serialize Snapshots

**Add to `skyspy_django/skyspy/socketio/utils/snapshot_cache.py`**

```python
"""
Pre-serialized snapshot caching for Socket.IO connections.

Reduces database queries when multiple clients connect simultaneously.
"""

import json
import logging
import threading
import time
from typing import Optional

from django.core.cache import cache

logger = logging.getLogger(__name__)


class SnapshotCache:
    """
    Cache for pre-serialized connection snapshots.

    Reduces query load by caching JSON-serialized snapshots
    that can be sent directly to clients.
    """

    CACHE_KEY_PREFIX = "socketio:snapshot"
    DEFAULT_TTL = 5  # 5 seconds

    def __init__(self):
        self._local_cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def get_snapshot(self, topic: str) -> Optional[str]:
        """
        Get cached snapshot JSON for a topic.

        Returns pre-serialized JSON string or None if not cached.
        """
        now = time.time()
        cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"

        # Check local cache first (fastest)
        with self._lock:
            if cache_key in self._local_cache:
                data, expires = self._local_cache[cache_key]
                if expires > now:
                    return data
                else:
                    del self._local_cache[cache_key]

        # Check Redis cache
        data = cache.get(cache_key)
        if data:
            # Populate local cache
            with self._lock:
                self._local_cache[cache_key] = (data, now + self.DEFAULT_TTL)
            return data

        return None

    def set_snapshot(self, topic: str, data: any, ttl: int = None):
        """
        Cache a snapshot for a topic.

        Args:
            topic: Topic name (e.g., "aircraft", "safety")
            data: Data to serialize and cache
            ttl: Cache TTL in seconds (default 5)
        """
        if ttl is None:
            ttl = self.DEFAULT_TTL

        cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"

        # Serialize to JSON
        json_data = json.dumps(data, default=str)

        # Store in both local and Redis cache
        expires = time.time() + ttl

        with self._lock:
            self._local_cache[cache_key] = (json_data, expires)

        cache.set(cache_key, json_data, timeout=ttl)

    def invalidate(self, topic: str):
        """Invalidate cached snapshot for a topic."""
        cache_key = f"{self.CACHE_KEY_PREFIX}:{topic}"

        with self._lock:
            self._local_cache.pop(cache_key, None)

        cache.delete(cache_key)

    def invalidate_all(self):
        """Invalidate all cached snapshots."""
        with self._lock:
            self._local_cache.clear()


# Global singleton
snapshot_cache = SnapshotCache()
```

#### 8.2 Update Namespace to Use Cached Snapshots

**Modify `skyspy_django/skyspy/socketio/namespaces/main.py`**

```python
from skyspy.socketio.utils.snapshot_cache import snapshot_cache


async def _send_initial_state(self, sid: str, topics: list[str]):
    """Send cached snapshots to newly connected client."""

    for topic in topics:
        # Try cached snapshot first
        cached = snapshot_cache.get_snapshot(topic)

        if cached:
            # Send pre-serialized JSON directly
            await self.emit(
                f"{topic}:snapshot",
                json.loads(cached),  # Parse back for emit
                room=sid
            )
        else:
            # Generate snapshot and cache it
            data = await self._generate_snapshot(topic)
            snapshot_cache.set_snapshot(topic, data)
            await self.emit(f"{topic}:snapshot", data, room=sid)


async def _generate_snapshot(self, topic: str) -> dict:
    """Generate snapshot data for a topic."""
    if topic == "aircraft":
        return await self._get_current_aircraft()
    elif topic == "safety":
        return await self._get_recent_safety_events()
    # ... other topics
```

#### 8.3 Update Broadcast to Invalidate Cache

**Modify broadcast functions to invalidate snapshot on major updates:**

```python
def broadcast_aircraft_update(aircraft_list: list):
    """Broadcast aircraft update and refresh snapshot cache."""
    from skyspy.socketio.utils.snapshot_cache import snapshot_cache

    # Broadcast to connected clients
    sync_emit("aircraft:update", {"aircraft": aircraft_list}, room="topic_aircraft")

    # Update snapshot cache for new connections
    snapshot_cache.set_snapshot("aircraft", {"aircraft": aircraft_list})
```

### Files to Create/Modify
- **Create**: `skyspy_django/skyspy/socketio/utils/snapshot_cache.py`
- **Modify**: `skyspy_django/skyspy/socketio/namespaces/main.py`
- **Modify**: `skyspy_django/skyspy/tasks/aircraft_stream.py`

---

## 9. P3: Database Index Optimization

### Problem
Stats queries use `.order_by("-timestamp")` without proper indexes, causing full table scans on large tables.

### Solution

#### 9.1 Create Migration for Indexes

**Create migration: `skyspy_django/skyspy/migrations/XXXX_add_timestamp_indexes.py`**

```python
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('skyspy', 'previous_migration'),
    ]

    operations = [
        # AircraftPosition timestamp index
        migrations.AddIndex(
            model_name='aircraftposition',
            index=migrations.Index(
                fields=['-timestamp'],
                name='aircraftpos_ts_idx',
            ),
        ),

        # SafetyEvent timestamp index
        migrations.AddIndex(
            model_name='safetyevent',
            index=migrations.Index(
                fields=['-timestamp'],
                name='safetyevent_ts_idx',
            ),
        ),

        # AcarsMessage timestamp index
        migrations.AddIndex(
            model_name='acarsmessage',
            index=migrations.Index(
                fields=['-timestamp'],
                name='acarsmsg_ts_idx',
            ),
        ),

        # AlertHistory timestamp index
        migrations.AddIndex(
            model_name='alerthistory',
            index=migrations.Index(
                fields=['-timestamp'],
                name='alerthistory_ts_idx',
            ),
        ),

        # NotificationLog timestamp index
        migrations.AddIndex(
            model_name='notificationlog',
            index=migrations.Index(
                fields=['-timestamp'],
                name='notiflog_ts_idx',
            ),
        ),

        # Composite index for AircraftSession queries
        migrations.AddIndex(
            model_name='aircraftsession',
            index=migrations.Index(
                fields=['last_seen', 'icao_hex'],
                name='session_lastseen_icao_idx',
            ),
        ),
    ]
```

#### 9.2 Add Index to Models

**Update `skyspy_django/skyspy/models/` model files:**

```python
class AircraftPosition(models.Model):
    # ... fields ...

    class Meta:
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['icao_hex', '-timestamp']),
        ]


class SafetyEvent(models.Model):
    # ... fields ...

    class Meta:
        indexes = [
            models.Index(fields=['-timestamp']),
            models.Index(fields=['event_type', '-timestamp']),
        ]
```

### Files to Create/Modify
- Create migration file
- Optionally update model Meta classes for documentation

---

## 10. P3: Alert Rule Segmentation

### Problem
Alert evaluation checks all rules against all aircraft every 1-2 seconds. With 100 rules and 1,000 aircraft, that's 100,000 evaluations per cycle.

### Solution

#### 10.1 Pre-index Rules by Target

**Modify `skyspy_django/skyspy/services/alert_rule_cache.py`**

```python
class RuleCache:
    """Enhanced rule cache with segmented indexes."""

    def __init__(self):
        self._rules: list[CompiledRule] = []
        self._rules_by_icao: dict[str, list[CompiledRule]] = {}
        self._rules_by_squawk: dict[str, list[CompiledRule]] = {}
        self._rules_by_callsign_prefix: dict[str, list[CompiledRule]] = {}
        self._general_rules: list[CompiledRule] = []
        self._lock = threading.Lock()

    def refresh(self):
        """Refresh and index rules from database."""
        rules = [CompiledRule.from_db_rule(r) for r in AlertRule.objects.filter(enabled=True)]

        # Build indexes
        by_icao = defaultdict(list)
        by_squawk = defaultdict(list)
        by_callsign_prefix = defaultdict(list)
        general = []

        for rule in rules:
            if rule.target_icao:
                by_icao[rule.target_icao.upper()].append(rule)
            elif rule.target_squawk:
                by_squawk[rule.target_squawk].append(rule)
            elif rule.target_callsign_prefix:
                by_callsign_prefix[rule.target_callsign_prefix.upper()].append(rule)
            else:
                general.append(rule)

        with self._lock:
            self._rules = rules
            self._rules_by_icao = dict(by_icao)
            self._rules_by_squawk = dict(by_squawk)
            self._rules_by_callsign_prefix = dict(by_callsign_prefix)
            self._general_rules = general

    def get_rules_for_aircraft(self, aircraft: dict) -> list[CompiledRule]:
        """
        Get rules that could potentially match this aircraft.

        Uses indexes for O(1) lookup of targeted rules.
        """
        icao = (aircraft.get("hex") or "").upper()
        squawk = aircraft.get("squawk") or ""
        callsign = (aircraft.get("flight") or "").upper()

        with self._lock:
            rules = []

            # O(1) lookup for ICAO-targeted rules
            if icao in self._rules_by_icao:
                rules.extend(self._rules_by_icao[icao])

            # O(1) lookup for squawk-targeted rules
            if squawk in self._rules_by_squawk:
                rules.extend(self._rules_by_squawk[squawk])

            # Prefix matching for callsign
            for prefix, prefix_rules in self._rules_by_callsign_prefix.items():
                if callsign.startswith(prefix):
                    rules.extend(prefix_rules)

            # Always include general rules
            rules.extend(self._general_rules)

            return rules
```

#### 10.2 Update Alert Service

**Modify `skyspy_django/skyspy/services/alerts.py`**

```python
def check_alerts(self, aircraft_list: list) -> list:
    """Check alerts using segmented rule lookup."""
    triggered = []
    now = timezone.now()

    for ac in aircraft_list:
        # Get only potentially matching rules
        rules = rule_cache.get_rules_for_aircraft(ac)

        for rule in rules:
            if not rule.is_scheduled_active(now):
                continue

            if rule.can_match(ac) and self._check_rule(rule, ac):
                alert = self._trigger_alert(rule, ac)
                if alert:
                    triggered.append(alert)

    return triggered
```

### Expected Improvement
- ICAO-specific rules: O(1) lookup instead of O(rules)
- Reduces evaluations from `O(rules × aircraft)` to approximately `O(general_rules × aircraft + targeted_rules)`
- With 100 rules (80 targeted, 20 general) and 1000 aircraft: ~20,000 evaluations instead of 100,000

---

## 11. P3: Consolidate RPi Configuration

### Problem
RPi-specific optimizations are scattered across multiple files, making it hard to tune and maintain.

### Solution

#### 11.1 Create Centralized RPi Config Module

**Create `skyspy_django/skyspy/config/rpi.py`**

```python
"""
Centralized Raspberry Pi configuration.

All RPi-specific settings and optimizations in one place.
"""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class RPiConfig:
    """RPi-specific configuration."""

    # Detection
    enabled: bool = False

    # Polling
    polling_interval: float = 4.0  # Seconds between polls

    # Task intervals (seconds)
    stats_cache_interval: float = 90.0
    safety_stats_interval: float = 60.0
    acars_stats_interval: float = 120.0
    flight_pattern_stats_interval: float = 600.0  # 10 min
    tracking_quality_interval: float = 600.0
    engagement_stats_interval: float = 600.0
    time_comparison_interval: float = 900.0  # 15 min
    antenna_analytics_interval: float = 600.0

    # Cache sizes
    max_seen_aircraft: int = 5000
    max_aircraft_info_cache: int = 3000
    max_route_cache: int = 500
    max_photo_cache: int = 1000
    max_memory_cache: int = 5000

    # Database
    stats_sample_size: int = 2000
    batch_delete_size: int = 5000

    # Streaming
    db_buffer_maxlen: int = 5000
    new_aircraft_queue_maxlen: int = 250


def get_rpi_config() -> RPiConfig:
    """
    Get RPi configuration based on environment.

    Returns default config if not in RPi mode.
    """
    if not _is_rpi_mode():
        return RPiConfig(enabled=False)

    return RPiConfig(
        enabled=True,
        polling_interval=float(os.environ.get("POLLING_INTERVAL", "4")),
        # ... load other overrides from environment
    )


def _is_rpi_mode() -> bool:
    """Check if running in RPi mode."""
    settings_module = os.environ.get("DJANGO_SETTINGS_MODULE", "")
    return "settings_rpi" in settings_module or os.environ.get("RPI_MODE", "").lower() == "true"


# Global config instance
rpi_config = get_rpi_config()


def get_cache_size(cache_name: str) -> int:
    """Get appropriate cache size based on RPi mode."""
    if not rpi_config.enabled:
        # Full-size defaults
        defaults = {
            "aircraft_info": 10000,
            "routes": 2000,
            "photos": 5000,
            "memory": 20000,
        }
    else:
        defaults = {
            "aircraft_info": rpi_config.max_aircraft_info_cache,
            "routes": rpi_config.max_route_cache,
            "photos": rpi_config.max_photo_cache,
            "memory": rpi_config.max_memory_cache,
        }

    return defaults.get(cache_name, 1000)


def get_task_interval(task_name: str) -> float:
    """Get task interval based on RPi mode."""
    if not rpi_config.enabled:
        return None  # Use default

    intervals = {
        "stats_cache": rpi_config.stats_cache_interval,
        "safety_stats": rpi_config.safety_stats_interval,
        "acars_stats": rpi_config.acars_stats_interval,
        "flight_pattern_stats": rpi_config.flight_pattern_stats_interval,
        "tracking_quality": rpi_config.tracking_quality_interval,
        "engagement_stats": rpi_config.engagement_stats_interval,
        "time_comparison": rpi_config.time_comparison_interval,
        "antenna_analytics": rpi_config.antenna_analytics_interval,
    }

    return intervals.get(task_name)
```

#### 11.2 Update Services to Use Centralized Config

**Example update in `skyspy_django/skyspy/services/cache.py`**

```python
from skyspy.config.rpi import get_cache_size

# Replace hardcoded sizes:
aircraft_info_cache = BoundedCache(
    maxsize=get_cache_size("aircraft_info"),
    name="aircraft_info"
)
route_cache = BoundedCache(
    maxsize=get_cache_size("routes"),
    name="routes"
)
```

### Files to Create/Modify
- **Create**: `skyspy_django/skyspy/config/rpi.py`
- **Modify**: `skyspy_django/skyspy/services/cache.py`
- **Modify**: `skyspy_django/skyspy/tasks/aircraft_stream.py`
- **Modify**: `skyspy_django/skyspy/celery.py`

---

## Summary

| # | Improvement | Priority | Effort | Files Changed |
|---|-------------|----------|--------|---------------|
| 1 | Task Monitoring | P0 | Medium | 4 new/modified |
| 2 | Fix Unbounded Caches | P0 | Low | 3 modified |
| 3 | Async Webhook Delivery | P0 | Low | 3 modified |
| 4 | Redis Cooldown Cleanup | P1 | Low | 3 modified |
| 5 | Batch Stats Aggregation | P1 | Medium | 2 modified |
| 6 | Task Dependencies | P2 | Medium | 1 modified |
| 7 | Differential Updates | P2 | High | 2 modified |
| 8 | Snapshot Caching | P2 | Medium | 3 new/modified |
| 9 | Database Indexes | P3 | Low | 1 migration |
| 10 | Alert Rule Segmentation | P3 | High | 2 modified |
| 11 | RPi Config Consolidation | P3 | Low | 4 modified |

### Recommended Implementation Order

1. **P0 Items First** (Week 1-2):
   - Fix unbounded caches (immediate memory safety)
   - Async webhook delivery (prevents blocking)
   - Task monitoring (visibility for debugging)

2. **P1 Items** (Week 3):
   - Redis cooldown cleanup
   - Batch stats aggregation

3. **P2/P3 Items** (Week 4+):
   - Based on observed bottlenecks from monitoring
   - Differential updates if bandwidth is an issue
   - Rule segmentation if alert evaluation is slow
