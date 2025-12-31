"""Core package containing configuration, database, and utilities."""
from app.core.config import get_settings, Settings
from app.core.database import get_db, init_db, close_db, Base, db_execute_safe
from app.core.cache import cached, clear_cache
from app.core.utils import (
    calculate_distance_nm,
    is_valid_position,
    safe_int_altitude,
    parse_iso_timestamp,
    safe_request,
    get_aircraft_icon,
    simplify_aircraft,
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
    "calculate_distance_nm",
    "is_valid_position",
    "safe_int_altitude",
    "parse_iso_timestamp",
    "safe_request",
    "get_aircraft_icon",
    "simplify_aircraft",
]
