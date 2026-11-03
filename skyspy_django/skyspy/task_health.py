"""Cross-process task liveness, separate from process-local duration metrics."""

import logging
import os
import time

from celery.signals import task_postrun, task_prerun, worker_ready
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)
PREFIX = "task-health:"


def record_worker_ready(**kwargs):
    pool = os.environ.get("CELERY_POOL", "threads")
    cache.set(f"{PREFIX}boot:{pool}", time.time(), timeout=86400)


def record_task_start(task=None, **kwargs):
    if task is not None:
        task.request._health_started_at = time.monotonic()
        from skyspy.services.task_metrics import task_metrics

        task_metrics.record_task_start(task.name)


def record_task_result(task=None, state=None, retval=None, **kwargs):
    if task is None:
        return
    try:
        from skyspy.services.task_metrics import task_metrics

        started = getattr(task.request, "_health_started_at", time.monotonic())
        success = state == "SUCCESS"
        task_metrics.record_task_complete(
            task.name,
            (time.monotonic() - started) * 1000,
            success,
            None if success else str(retval)[:200],
        )
        if success:
            cache.set(f"{PREFIX}success:{task.name}", time.time(), timeout=86400)
    except Exception:
        # A telemetry failure must not change the outcome of an executed task.
        logger.exception("Failed to record task health for %s", task.name)


def stale_tasks(intervals: dict[str, int]) -> list[str]:
    now = time.time()
    streaming = getattr(settings, "AIRCRAFT_STREAM_ENABLED", False)
    mode = getattr(settings, "AIRCRAFT_STREAM_MODE", "sse")
    stale = []
    for name, max_age in intervals.items():
        is_stream = name.endswith(".stream_aircraft")
        is_flush = name.endswith(".flush_stream_to_database")
        is_poll = name.endswith(".poll_aircraft")
        if (is_stream or is_flush) and not streaming:
            continue
        if is_poll and streaming and mode == "adsblol":
            continue
        pool = "gevent" if is_stream or is_poll else "threads"
        boot = cache.get(f"{PREFIX}boot:{pool}")
        if boot is not None and now - boot < max_age:
            continue
        if is_stream:
            if not cache.get("aircraft_stream_active"):
                stale.append(name)
        else:
            last_success = cache.get(f"{PREFIX}success:{name}")
            if last_success is None or now - last_success > max_age:
                stale.append(name)
    return stale


def register_task_health_signals():
    worker_ready.connect(record_worker_ready, weak=False, dispatch_uid="skyspy-health-worker")
    task_prerun.connect(record_task_start, weak=False, dispatch_uid="skyspy-health-start")
    task_postrun.connect(record_task_result, weak=False, dispatch_uid="skyspy-health-result")
