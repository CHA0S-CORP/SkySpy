"""Core package containing configuration, database, and utilities."""
from app.core.config import get_settings, Settings
from app.core.database import get_db, init_db, close_db, Base, db_execute_safe
from app.core.cache import (
    cached,
    clear_cache,
    check_upstream_rate_limit,
    mark_upstream_request,
    wait_for_upstream_rate_limit,
    get_upstream_rate_limit_status,
)
from app.core.utils import (
    calculate_distance_nm,
    is_valid_position,
    safe_int_altitude,
    parse_iso_timestamp,
    safe_request,
    get_aircraft_icon,
    simplify_aircraft,
    get_http_client,
    close_http_client,
)

__all__ = [
    "get_settings",
    "Settings",
    "get_db",
    "init_db",
    "close_db",
    "Base",
    "db_execute_safe",
    "cached",
    "clear_cache",
    "check_upstream_rate_limit",
    "mark_upstream_request",
    "wait_for_upstream_rate_limit",
    "get_upstream_rate_limit_status",
    "calculate_distance_nm",
    "is_valid_position",
    "safe_int_altitude",
    "parse_iso_timestamp",
    "safe_request",
    "get_aircraft_icon",
    "simplify_aircraft",
    "get_http_client",
    "close_http_client",
]
