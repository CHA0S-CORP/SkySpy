"""
Centralized Raspberry Pi configuration.

All RPi-specific settings and optimizations in one place.

This module provides a single source of truth for RPi-specific configuration,
making it easy to tune performance settings across the entire application.

Usage:
    from skyspy.config.rpi import rpi_config, get_cache_size, get_task_interval

    # Check if RPi mode is enabled
    if rpi_config.enabled:
        # Use RPi-optimized settings
        ...

    # Get appropriate cache size based on deployment mode
    cache_size = get_cache_size("aircraft_info")

    # Get task interval (returns None if not in RPi mode for default behavior)
    interval = get_task_interval("stats_cache")
"""

import os
from dataclasses import dataclass


@dataclass
class RPiConfig:
    """
    RPi-specific configuration settings.

    All settings have sensible defaults optimized for Raspberry Pi 5 deployment.
    These can be overridden via environment variables when needed.

    Attributes:
        enabled: Whether RPi mode is active
        polling_interval: Seconds between aircraft polling (default 4.0)

        Task Intervals (seconds):
            stats_cache_interval: Stats cache refresh interval
            safety_stats_interval: Safety stats refresh interval
            acars_stats_interval: ACARS stats refresh interval
            flight_pattern_stats_interval: Flight pattern stats interval
            tracking_quality_interval: Tracking quality stats interval
            engagement_stats_interval: Engagement stats interval
            time_comparison_interval: Time comparison stats interval
            antenna_analytics_interval: Antenna analytics interval

        Cache Sizes (number of entries):
            max_seen_aircraft: Maximum aircraft in seen tracking
            max_aircraft_info_cache: Maximum aircraft info cache entries
            max_route_cache: Maximum route cache entries
            max_photo_cache: Maximum photo cache entries
            max_memory_cache: Maximum general memory cache entries

        Database Settings:
            stats_sample_size: Sample size for stats calculations
            batch_delete_size: Batch size for bulk delete operations

        Streaming Settings:
            db_buffer_maxlen: Database buffer maximum length
            new_aircraft_queue_maxlen: New aircraft queue maximum length
    """

    # Detection
    enabled: bool = False

    # Polling
    polling_interval: float = 4.0  # Seconds between polls (was 2s in standard mode)

    # Task intervals (seconds) - these are RPi-optimized intervals
    # Standard mode uses shorter intervals defined in celery.py
    stats_cache_interval: float = 90.0  # Was 60s
    safety_stats_interval: float = 60.0  # Was 30s
    acars_stats_interval: float = 120.0  # Was 60s
    flight_pattern_stats_interval: float = 600.0  # Was 120s (10 min instead of 2 min)
    tracking_quality_interval: float = 600.0  # Was 120s
    engagement_stats_interval: float = 600.0  # Was 120s
    time_comparison_interval: float = 900.0  # Was 300s (15 min instead of 5 min)
    antenna_analytics_interval: float = 600.0  # Was 300s (10 min instead of 5 min)

    # Cache sizes (number of entries)
    max_seen_aircraft: int = 5000  # Was 10000
    max_aircraft_info_cache: int = 3000  # Reduced for memory
    max_route_cache: int = 500  # Reduced for memory
    max_photo_cache: int = 1000  # Reduced for memory
    max_memory_cache: int = 5000  # Reduced for memory

    # Database settings
    stats_sample_size: int = 2000  # Was 5000 - limits query result sets
    batch_delete_size: int = 5000  # Batch size for bulk deletes

    # Streaming settings
    db_buffer_maxlen: int = 5000  # Database write buffer
    new_aircraft_queue_maxlen: int = 250  # New aircraft lookup queue

    # Data retention (days) - shorter for RPi storage constraints
    sighting_retention_days: int = 7  # Was 30
    session_retention_days: int = 14  # Was 90
    alert_history_days: int = 7  # Was 30
    antenna_snapshot_retention_days: int = 3  # Was 7

    # Query limits
    max_history_hours: int = 72  # Limit history queries to 3 days
    max_query_results: int = 10000  # Hard cap on result sets

    # Feature flags
    lite_mode: bool = True  # Enable lite mode for stats calculations


# Default full-capacity configuration for non-RPi deployments
_DEFAULT_CONFIG = RPiConfig(enabled=False)

# RPi-optimized configuration
_RPI_CONFIG = RPiConfig(enabled=True)


def _is_rpi_mode() -> bool:
    """
    Check if running in RPi mode.

    Detection methods:
    1. Check DJANGO_SETTINGS_MODULE for "settings_rpi"
    2. Check RPI_MODE environment variable

    Returns:
        True if RPi mode is enabled, False otherwise
    """
    settings_module = os.environ.get("DJANGO_SETTINGS_MODULE", "")
    if "settings_rpi" in settings_module:
        return True

    rpi_mode_env = os.environ.get("RPI_MODE", "").lower()
    return rpi_mode_env in ("true", "1", "yes")


def get_rpi_config() -> RPiConfig:
    """
    Get RPi configuration based on current environment.

    Returns default (full-capacity) config if not in RPi mode,
    otherwise returns RPi-optimized config with values potentially
    overridden from environment variables.

    Returns:
        RPiConfig instance appropriate for current deployment
    """
    if not _is_rpi_mode():
        return _DEFAULT_CONFIG

    # Create RPi config with environment overrides
    config = RPiConfig(
        enabled=True,
        # Polling
        polling_interval=float(os.environ.get("POLLING_INTERVAL", "4")),
        # Task intervals
        stats_cache_interval=float(os.environ.get("STATS_CACHE_INTERVAL", "90")),
        safety_stats_interval=float(os.environ.get("SAFETY_STATS_INTERVAL", "60")),
        acars_stats_interval=float(os.environ.get("ACARS_STATS_INTERVAL", "120")),
        flight_pattern_stats_interval=float(os.environ.get("FLIGHT_PATTERN_STATS_INTERVAL", "600")),
        tracking_quality_interval=float(os.environ.get("TRACKING_QUALITY_INTERVAL", "600")),
        engagement_stats_interval=float(os.environ.get("ENGAGEMENT_STATS_INTERVAL", "600")),
        time_comparison_interval=float(os.environ.get("TIME_COMPARISON_INTERVAL", "900")),
        antenna_analytics_interval=float(os.environ.get("ANTENNA_ANALYTICS_INTERVAL", "600")),
        # Cache sizes
        max_seen_aircraft=int(os.environ.get("MAX_SEEN_AIRCRAFT", "5000")),
        max_aircraft_info_cache=int(os.environ.get("MAX_AIRCRAFT_INFO_CACHE", "3000")),
        max_route_cache=int(os.environ.get("MAX_ROUTE_CACHE", "500")),
        max_photo_cache=int(os.environ.get("MAX_PHOTO_CACHE", "1000")),
        max_memory_cache=int(os.environ.get("MAX_MEMORY_CACHE", "5000")),
        # Database settings
        stats_sample_size=int(os.environ.get("STATS_SAMPLE_SIZE", "2000")),
        batch_delete_size=int(os.environ.get("BATCH_DELETE_SIZE", "5000")),
        # Streaming settings
        db_buffer_maxlen=int(os.environ.get("DB_BUFFER_MAXLEN", "5000")),
        new_aircraft_queue_maxlen=int(os.environ.get("NEW_AIRCRAFT_QUEUE_MAXLEN", "250")),
        # Data retention
        sighting_retention_days=int(os.environ.get("SIGHTING_RETENTION_DAYS", "7")),
        session_retention_days=int(os.environ.get("SESSION_RETENTION_DAYS", "14")),
        alert_history_days=int(os.environ.get("ALERT_HISTORY_DAYS", "7")),
        antenna_snapshot_retention_days=int(os.environ.get("ANTENNA_SNAPSHOT_RETENTION_DAYS", "3")),
        # Query limits
        max_history_hours=int(os.environ.get("MAX_HISTORY_HOURS", "72")),
        max_query_results=int(os.environ.get("MAX_QUERY_RESULTS", "10000")),
        # Feature flags
        lite_mode=os.environ.get("RPI_LITE_MODE", "true").lower() in ("true", "1", "yes"),
    )

    return config


# Global singleton - initialized at module load time
rpi_config: RPiConfig = get_rpi_config()


def get_cache_size(cache_name: str) -> int:
    """
    Get appropriate cache size based on deployment mode.

    Provides different cache sizes for RPi vs standard deployments.
    RPi mode uses smaller caches to conserve memory.

    Args:
        cache_name: Name of the cache to get size for.
            Supported names: "aircraft_info", "routes", "photos",
            "memory", "seen_aircraft"

    Returns:
        Maximum number of entries for the cache.

    Example:
        from skyspy.config.rpi import get_cache_size

        aircraft_cache = BoundedCache(maxsize=get_cache_size("aircraft_info"))
    """
    if not rpi_config.enabled:
        # Full-size defaults for standard deployments
        defaults = {
            "aircraft_info": 10000,
            "routes": 2000,
            "photos": 5000,
            "memory": 20000,
            "seen_aircraft": 10000,
        }
    else:
        # RPi-optimized sizes
        defaults = {
            "aircraft_info": rpi_config.max_aircraft_info_cache,
            "routes": rpi_config.max_route_cache,
            "photos": rpi_config.max_photo_cache,
            "memory": rpi_config.max_memory_cache,
            "seen_aircraft": rpi_config.max_seen_aircraft,
        }

    return defaults.get(cache_name, 1000)


def get_task_interval(task_name: str) -> float | None:
    """
    Get task interval based on deployment mode.

    For RPi mode, returns optimized (longer) intervals to reduce CPU load.
    For standard mode, returns None to indicate default intervals should be used.

    Args:
        task_name: Name of the task to get interval for.
            Supported names: "stats_cache", "safety_stats", "acars_stats",
            "flight_pattern_stats", "tracking_quality", "engagement_stats",
            "time_comparison", "antenna_analytics", "polling"

    Returns:
        Interval in seconds for RPi mode, or None for standard mode.

    Example:
        from skyspy.config.rpi import get_task_interval

        interval = get_task_interval("stats_cache")
        if interval:
            # Use RPi interval
            schedule = interval
        else:
            # Use default interval
            schedule = 60.0
    """
    if not rpi_config.enabled:
        return None  # Use default intervals

    intervals = {
        "polling": rpi_config.polling_interval,
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


def get_stats_sample_size() -> int:
    """
    Get sample size for stats calculations.

    Returns a smaller sample size for RPi mode to reduce CPU and memory usage.

    Returns:
        Maximum sample size for stats queries.
    """
    if rpi_config.enabled:
        return rpi_config.stats_sample_size
    return 5000  # Default full sample size


def get_batch_delete_size() -> int:
    """
    Get batch size for bulk delete operations.

    Returns an appropriate batch size based on deployment mode.

    Returns:
        Batch size for bulk delete operations.
    """
    if rpi_config.enabled:
        return rpi_config.batch_delete_size
    return 10000  # Default larger batch size


def get_retention_days(retention_type: str) -> int:
    """
    Get data retention period in days.

    RPi mode uses shorter retention periods to conserve storage.

    Args:
        retention_type: Type of retention. Supported types:
            "sighting", "session", "alert_history", "antenna_snapshot"

    Returns:
        Retention period in days.
    """
    if not rpi_config.enabled:
        # Standard retention periods
        defaults = {
            "sighting": 30,
            "session": 90,
            "alert_history": 30,
            "antenna_snapshot": 7,
        }
    else:
        # RPi-optimized retention
        defaults = {
            "sighting": rpi_config.sighting_retention_days,
            "session": rpi_config.session_retention_days,
            "alert_history": rpi_config.alert_history_days,
            "antenna_snapshot": rpi_config.antenna_snapshot_retention_days,
        }

    return defaults.get(retention_type, 7)


def is_lite_mode() -> bool:
    """
    Check if lite mode is enabled for stats calculations.

    Lite mode samples data instead of processing all records.

    Returns:
        True if lite mode is enabled.
    """
    return rpi_config.enabled and rpi_config.lite_mode


def get_query_limit(limit_type: str) -> int:
    """
    Get query limit based on deployment mode.

    RPi mode uses stricter limits to prevent resource exhaustion.

    Args:
        limit_type: Type of limit. Supported types:
            "max_history_hours", "max_query_results"

    Returns:
        Query limit value.
    """
    if not rpi_config.enabled:
        # Standard limits
        defaults = {
            "max_history_hours": 168,  # 7 days
            "max_query_results": 50000,
        }
    else:
        # RPi-optimized limits
        defaults = {
            "max_history_hours": rpi_config.max_history_hours,
            "max_query_results": rpi_config.max_query_results,
        }

    return defaults.get(limit_type, 10000)
