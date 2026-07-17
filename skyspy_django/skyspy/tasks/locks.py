"""
Distributed singleton locks for periodic tasks.

Long-running beat tasks (external DB syncs, SWIM consumer, cleanup jobs)
can overlap themselves when a run outlives its schedule interval or when a
Celery retry lands next to a fresh beat tick. Overlapping runs pile up
worker slots and duplicate external API load.

``singleton_task`` guards a task with an atomic ``cache.add`` (SET NX on
the Redis cache backend): a second invocation skips instead of running
concurrently. The lock TTL bounds worst-case runtime — a crashed holder's
lock self-expires, so the schedule can never wedge permanently.
"""

import functools
import logging
import uuid

from django.core.cache import cache

try:
    from redis.exceptions import RedisError

    _REDIS_ERRORS: tuple[type[BaseException], ...] = (RedisError,)
except ImportError:  # pragma: no cover - redis is an optional runtime dependency
    _REDIS_ERRORS = ()

# Redis command failures: connection/timeout errors (subclassed by redis-py) plus RedisError.
_REDIS_OP_ERRORS = (ConnectionError, OSError, TimeoutError, *_REDIS_ERRORS)

logger = logging.getLogger(__name__)

LOCK_KEY_PREFIX = "task-lock:"


def singleton_task(timeout: int):
    """
    Skip a task invocation if a previous run still holds the lock.

    Apply *under* ``@shared_task`` so the Celery task name is derived from
    the wrapped function::

        @shared_task(bind=True, max_retries=3)
        @singleton_task(timeout=3600)
        def sync_external_databases(self): ...

    Args:
        timeout: Lock TTL in seconds. Must exceed the task's worst-case
            runtime, or a slow run's successor may start before it ends.
    """

    def decorator(func):
        # Qualify by module: several tasks share a bare name across modules
        # (e.g. cleanup_old_notification_logs in both notifications.py and
        # cleanup.py), which would otherwise collide on one lock.
        lock_key = f"{LOCK_KEY_PREFIX}{func.__module__}.{func.__name__}"

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            token = uuid.uuid4().hex
            try:
                acquired = cache.add(lock_key, token, timeout=timeout)
            except _REDIS_OP_ERRORS as e:
                # Fail open: if Redis is down the broker (also Redis) is
                # already degraded; do not add a second failure mode.
                logger.warning(f"{func.__name__}: lock cache unavailable, running unguarded: {e}")
                acquired = True
                token = None

            if not acquired:
                logger.info(f"{func.__name__}: previous run still in progress, skipping")
                return {"status": "skipped", "reason": "already_running"}

            try:
                return func(*args, **kwargs)
            finally:
                if token is not None:
                    try:
                        # Only release a lock we still own (TTL may have
                        # expired and been re-acquired by a newer run).
                        if cache.get(lock_key) == token:
                            cache.delete(lock_key)
                    except _REDIS_OP_ERRORS:  # pragma: no cover - best-effort release; TTL is the backstop
                        pass

        return wrapper

    return decorator
