"""
Utility modules for SkysPy.
"""

from skyspy.utils.sentry import (
    SENTRY_ENABLED,
    capture_aircraft_error,
    capture_api_error,
    capture_error,
    capture_task_error,
    log_and_capture,
    sentry_task_wrapper,
    set_aircraft_context,
    set_operation_context,
)

__all__ = [
    "capture_error",
    "capture_aircraft_error",
    "capture_task_error",
    "capture_api_error",
    "set_aircraft_context",
    "set_operation_context",
    "sentry_task_wrapper",
    "log_and_capture",
    "SENTRY_ENABLED",
]
