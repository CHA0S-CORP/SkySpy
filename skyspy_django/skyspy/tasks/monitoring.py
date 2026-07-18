"""
Monitoring tasks for Celery health and metrics.

Provides periodic tasks for:
- Queue depth monitoring
- Stale/stuck task detection
- Worker statistics collection

These tasks enable visibility into background processing health and
help detect issues before they become critical.
"""

import logging

from celery import shared_task
from django.conf import settings

try:
    from redis.exceptions import RedisError

    _REDIS_ERRORS: tuple[type[BaseException], ...] = (RedisError,)
except ImportError:  # pragma: no cover - redis is an optional runtime dependency
    _REDIS_ERRORS = ()

# Redis command failures: connection/timeout errors (subclassed by redis-py) plus RedisError.
# ImportError guards the optional `import redis` inside the task body.
_REDIS_OP_ERRORS = (ImportError, ConnectionError, OSError, TimeoutError, *_REDIS_ERRORS)

logger = logging.getLogger(__name__)


@shared_task(ignore_result=True)
def update_queue_metrics():
    """
    Update queue depth metrics.

    Checks Redis queue depths for all configured Celery queues.
    Runs every 30 seconds to provide near-real-time queue monitoring.

    Returns:
        Dict with status and queue depths
    """
    from skyspy.services.task_metrics import task_metrics

    try:
        import redis

        redis_url = getattr(settings, "CELERY_BROKER_URL", None) or getattr(
            settings, "REDIS_URL", "redis://redis:6379/0"
        )
        r = redis.from_url(redis_url)

        # All configured Celery queues
        queues = [
            "celery",  # Default queue
            "default",
            "polling",
            "database",
            "notifications",
            "transcription",
            "low_priority",
        ]

        queue_depths = {}
        for queue in queues:
            # Celery uses Redis lists for queues
            depth = r.llen(queue)
            task_metrics.update_queue_depth(queue, depth)
            queue_depths[queue] = depth

        total_depth = sum(queue_depths.values())

        # Log warning if any queue is getting backed up
        for queue, depth in queue_depths.items():
            if depth > 100:
                logger.warning(f"Queue '{queue}' has {depth} pending tasks")

        logger.debug(f"Queue metrics updated: total depth {total_depth}")

        return {
            "status": "ok",
            "queues": queue_depths,
            "total_depth": total_depth,
        }

    except _REDIS_OP_ERRORS as e:
        logger.warning(f"Failed to update queue metrics: {e}")
        return {"status": "error", "error": str(e)}


@shared_task(ignore_result=True)
def check_task_health():
    """
    Check for stale or failing tasks.

    Detects tasks that haven't executed within their expected intervals.
    Runs every minute to provide timely detection of stuck tasks.

    Returns:
        Dict with health status and any detected issues
    """
    from skyspy.services.task_metrics import task_metrics

    # Expected max age for critical tasks (in seconds)
    # These are the tasks that must run regularly for the system to function
    critical_task_intervals = {
        # Aircraft polling/streaming - should run every 1-2 seconds
        "skyspy.tasks.aircraft.poll_aircraft": 10,
        # Session updates - should run every 5 seconds
        "skyspy.tasks.aircraft.update_aircraft_sessions_from_cache": 30,
        # Unified stats aggregation - runs every 60s (90s on RPi)
        # (replaced the individual update_stats_cache/update_safety_stats
        # tasks, whose beat entries are commented out in celery.py)
        "skyspy.tasks.analytics.aggregate_all_stats": 180,
        # Stream tasks - long-running but should restart
        "skyspy.tasks.aircraft_stream.stream_aircraft": 120,
        "skyspy.tasks.aircraft_stream.flush_stream_to_database": 30,
        # Antenna analytics - runs every 5 minutes
        "skyspy.tasks.analytics.update_antenna_analytics": 360,
    }

    stale_tasks = task_metrics.get_stale_tasks(critical_task_intervals)
    failing_tasks = task_metrics.get_failing_tasks(min_failure_rate=0.5, min_executions=5)

    issues = []

    if stale_tasks:
        logger.warning(f"Stale tasks detected: {stale_tasks}")
        issues.append({"type": "stale_tasks", "tasks": stale_tasks})

        # Broadcast health warning via Socket.IO if available
        try:
            from skyspy.socketio.utils import sync_emit

            # Emit to topic_stats - a room clients can actually subscribe to
            # (topic_admin is not in SUPPORTED_TOPICS, so nobody ever joins it)
            sync_emit(
                "system:health",
                {
                    "status": "degraded",
                    "issue": "stale_tasks",
                    "stale_tasks": stale_tasks,
                },
                room="topic_stats",
            )
        except Exception:  # broad: socketio emit boundary — health broadcast must never break the check
            pass

    if failing_tasks:
        logger.warning(f"Failing tasks detected: {[t['task_name'] for t in failing_tasks]}")
        issues.append({"type": "failing_tasks", "tasks": failing_tasks})

    # Determine overall health status
    status = "warning" if stale_tasks or failing_tasks else "healthy"

    return {
        "status": status,
        "stale_tasks": stale_tasks,
        "failing_tasks": failing_tasks,
        "issues": issues,
    }


@shared_task
def collect_worker_stats():
    """
    Collect Celery worker statistics.

    Gathers information about active workers, their current tasks,
    and reserved task counts. Runs every 5 minutes.

    Returns:
        Dict with worker statistics
    """
    from skyspy.celery import app

    try:
        inspect = app.control.inspect()

        # Get various worker stats
        active = inspect.active() or {}
        reserved = inspect.reserved() or {}
        scheduled = inspect.scheduled() or {}
        stats = inspect.stats() or {}

        # Process worker information
        worker_stats = {}
        for worker_name in set(active.keys()) | set(reserved.keys()) | set(stats.keys()):
            worker_info = {
                "active_tasks": len(active.get(worker_name, [])),
                "reserved_tasks": len(reserved.get(worker_name, [])),
                "scheduled_tasks": len(scheduled.get(worker_name, [])),
            }

            # Add pool/concurrency info if available
            if worker_name in stats:
                worker_stats_data = stats[worker_name]
                worker_info["pool"] = worker_stats_data.get("pool", {}).get("max-concurrency")
                worker_info["total_tasks"] = worker_stats_data.get("total", {})
                worker_info["prefetch_count"] = worker_stats_data.get("prefetch_count")

            worker_stats[worker_name] = worker_info

        # Calculate summary stats
        total_active = sum(w.get("active_tasks", 0) for w in worker_stats.values())
        total_reserved = sum(w.get("reserved_tasks", 0) for w in worker_stats.values())
        worker_count = len(worker_stats)

        logger.debug(
            f"Worker stats collected: {worker_count} workers, {total_active} active tasks, {total_reserved} reserved"
        )

        return {
            "status": "ok",
            "workers": worker_stats,
            "worker_count": worker_count,
            "total_active": total_active,
            "total_reserved": total_reserved,
        }

    except Exception as e:  # broad: Celery inspect/broker failure modes are unknowable
        logger.warning(f"Failed to collect worker stats: {e}")
        return {"status": "error", "error": str(e)}


@shared_task
def cleanup_stale_task_metrics(max_age_hours: int = 24):
    """
    Clean up metrics for tasks that haven't run in a long time.

    Prevents unbounded growth of the metrics dictionary for
    one-off or deprecated tasks.

    Args:
        max_age_hours: Maximum age in hours before metrics are cleared

    Returns:
        Dict with cleanup results
    """
    import time

    from skyspy.services.task_metrics import task_metrics

    now = time.time()
    max_age_seconds = max_age_hours * 3600
    cleaned = []

    with task_metrics._lock:
        tasks_to_remove = []
        for task_name, metrics in task_metrics._metrics.items():
            if metrics.last_execution:
                age = now - metrics.last_execution
                if age > max_age_seconds:
                    tasks_to_remove.append(task_name)

        for task_name in tasks_to_remove:
            del task_metrics._metrics[task_name]
            cleaned.append(task_name)

    if cleaned:
        logger.info(f"Cleaned up metrics for {len(cleaned)} stale tasks: {cleaned}")

    return {
        "status": "ok",
        "cleaned_count": len(cleaned),
        "cleaned_tasks": cleaned,
    }
