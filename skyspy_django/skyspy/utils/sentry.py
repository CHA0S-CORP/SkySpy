"""
Sentry integration utilities.

Provides helper functions for explicit exception capture and context management.
"""
import logging
from functools import wraps
from typing import Any, Callable, Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# Check if Sentry is configured
SENTRY_ENABLED = bool(getattr(settings, 'SENTRY_DSN', None))

if SENTRY_ENABLED:
    import sentry_sdk
    from sentry_sdk import set_context, set_tag, set_user, capture_exception, capture_message


def capture_error(
    exception: Exception,
    extra: Optional[dict] = None,
    tags: Optional[dict] = None,
    level: str = 'error'
) -> Optional[str]:
    """
    Capture an exception to Sentry with optional context.

    Args:
        exception: The exception to capture
        extra: Additional context data
        tags: Tags to attach to the event
        level: Error level (error, warning, info)

    Returns:
        Sentry event ID if captured, None otherwise
    """
    if not SENTRY_ENABLED:
        logger.error(f"Exception (Sentry disabled): {exception}", exc_info=exception)
        return None

    try:
        with sentry_sdk.push_scope() as scope:
            if extra:
                for key, value in extra.items():
                    scope.set_extra(key, value)
            if tags:
                for key, value in tags.items():
                    scope.set_tag(key, value)
            scope.level = level

            event_id = sentry_sdk.capture_exception(exception)
            return event_id
    except Exception as e:
        logger.error(f"Failed to capture exception to Sentry: {e}")
        return None


def capture_aircraft_error(
    exception: Exception,
    icao_hex: Optional[str] = None,
    callsign: Optional[str] = None,
    operation: Optional[str] = None,
    extra: Optional[dict] = None
) -> Optional[str]:
    """
    Capture an aircraft-related exception with context.

    Args:
        exception: The exception to capture
        icao_hex: Aircraft ICAO hex code
        callsign: Aircraft callsign
        operation: The operation that failed
        extra: Additional context

    Returns:
        Sentry event ID if captured
    """
    tags = {'type': 'aircraft_error'}
    if operation:
        tags['operation'] = operation

    context = extra or {}
    if icao_hex:
        context['icao_hex'] = icao_hex
    if callsign:
        context['callsign'] = callsign

    return capture_error(exception, extra=context, tags=tags)


def capture_task_error(
    exception: Exception,
    task_name: str,
    task_args: Optional[tuple] = None,
    task_kwargs: Optional[dict] = None,
    extra: Optional[dict] = None
) -> Optional[str]:
    """
    Capture a Celery task exception with context.

    Args:
        exception: The exception to capture
        task_name: Name of the Celery task
        task_args: Task positional arguments
        task_kwargs: Task keyword arguments
        extra: Additional context

    Returns:
        Sentry event ID if captured
    """
    tags = {
        'type': 'task_error',
        'task_name': task_name
    }

    context = extra or {}
    if task_args:
        context['task_args'] = str(task_args)[:500]
    if task_kwargs:
        context['task_kwargs'] = str(task_kwargs)[:500]

    return capture_error(exception, extra=context, tags=tags)


def capture_api_error(
    exception: Exception,
    endpoint: Optional[str] = None,
    method: Optional[str] = None,
    extra: Optional[dict] = None
) -> Optional[str]:
    """
    Capture an API-related exception with context.

    Args:
        exception: The exception to capture
        endpoint: API endpoint path
        method: HTTP method
        extra: Additional context

    Returns:
        Sentry event ID if captured
    """
    tags = {'type': 'api_error'}
    if endpoint:
        tags['endpoint'] = endpoint
    if method:
        tags['method'] = method

    return capture_error(exception, extra=extra, tags=tags)


def set_aircraft_context(
    icao_hex: str,
    callsign: Optional[str] = None,
    registration: Optional[str] = None,
    aircraft_type: Optional[str] = None
):
    """Set aircraft context for Sentry events."""
    if not SENTRY_ENABLED:
        return

    context = {'icao_hex': icao_hex}
    if callsign:
        context['callsign'] = callsign
    if registration:
        context['registration'] = registration
    if aircraft_type:
        context['aircraft_type'] = aircraft_type

    sentry_sdk.set_context('aircraft', context)


def set_operation_context(
    operation: str,
    details: Optional[dict] = None
):
    """Set operation context for Sentry events."""
    if not SENTRY_ENABLED:
        return

    context = {'operation': operation}
    if details:
        context.update(details)

    sentry_sdk.set_context('operation', context)


def sentry_task_wrapper(task_name: str):
    """
    Decorator to wrap Celery tasks with Sentry error capture.

    Usage:
        @shared_task
        @sentry_task_wrapper('poll_aircraft')
        def poll_aircraft():
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                capture_task_error(e, task_name, args, kwargs)
                raise
        return wrapper
    return decorator


def log_and_capture(
    message: str,
    exception: Optional[Exception] = None,
    level: str = 'error',
    extra: Optional[dict] = None
):
    """
    Log a message and optionally capture to Sentry.

    Args:
        message: Log message
        exception: Optional exception to capture
        level: Log level
        extra: Additional context
    """
    log_func = getattr(logger, level, logger.error)

    if exception:
        log_func(f"{message}: {exception}", exc_info=exception)
        capture_error(exception, extra=extra)
    else:
        log_func(message)
        if SENTRY_ENABLED and level in ('error', 'critical'):
            with sentry_sdk.push_scope() as scope:
                if extra:
                    for key, value in extra.items():
                        scope.set_extra(key, value)
                sentry_sdk.capture_message(message, level=level)
