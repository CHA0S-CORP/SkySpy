"""
Business logic services for SkysPy.

This package contains domain services that implement core business logic,
ported from the FastAPI services.

Services:
- safety: Safety monitoring and event detection
- alerts: Alert rule processing and notification
- acars: ACARS/VDL2 message processing
- audio: Audio transmission upload, storage, and transcription
- llm: LLM-enhanced transcript analysis (callsign validation, resolution, deduplication)
- photo_cache: Aircraft photo caching (S3 and local)
- stats_cache: Statistics caching and aggregation
- storage: S3 and local file storage abstraction
- cache: In-memory caching with TTL and rate limiting
- external_db: Multi-source aircraft database (ADSBX, tar1090, FAA, OpenSky)
- geodata: Geographic data caching (airports, navaids, GeoJSON)
- weather_cache: Weather data caching (METAR, PIREP)
- notifications: Multi-platform notifications via Apprise
- antenna_analytics: Antenna performance metrics and analysis
- aircraft_info: Aircraft info lookup with caching and rate limiting
"""

import os

# Skip service imports during build mode (collectstatic, etc.)
if os.environ.get("BUILD_MODE"):
    __all__ = []
else:
    # Import service modules (lazy load to avoid circular imports)
    # from skyspy.services import audio
    # from skyspy.services import photo_cache
    # from skyspy.services import stats_cache
    # from skyspy.services import storage
    # from skyspy.services import cache
    # from skyspy.services import external_db
    # from skyspy.services import geodata
    # from skyspy.services import weather_cache
    # New data source services
    from skyspy.services import (
        adsbx_live,
        aviationstack,
        avwx,
        checkwx,
        military_db,
        notams,
        openaip,
        openflights,
        opensky_live,
    )
    from skyspy.services.acars import AcarsService, acars_service
    from skyspy.services.aircraft_info import (
        check_and_queue_new_aircraft,
        get_aircraft_info,
        get_aircraft_photo,
        get_bulk_aircraft_info,
        queue_aircraft_lookup,
    )
    from skyspy.services.aircraft_info import (
        get_cache_stats as get_aircraft_info_stats,
    )
    from skyspy.services.airspace import (
        broadcast_advisory_update,
        broadcast_boundary_update,
        get_advisories,
        get_advisory_history,
        get_airspace_snapshot,
        get_airspace_stats,
        get_boundaries,
    )
    from skyspy.services.alert_cooldowns import DistributedCooldownManager, cooldown_manager
    from skyspy.services.alert_metrics import AlertMetricsCollector, alert_metrics
    from skyspy.services.alert_rule_cache import AlertRuleCache, CompiledRule, rule_cache
    from skyspy.services.alerts import AlertService, alert_service
    from skyspy.services.antenna_analytics import (
        calculate_polar_data,
        calculate_rssi_data,
        calculate_summary,
    )
    from skyspy.services.antenna_analytics import (
        get_cached_data as get_antenna_data,
    )
    from skyspy.services.antenna_analytics import (
        refresh_cache as refresh_antenna_cache,
    )
    from skyspy.services.llm import (
        LLMClient,
        deduplicate_mentions,
        enhance_callsign_extraction,
        get_llm_stats,
        llm_client,
        resolve_ambiguous_callsigns,
        validate_callsigns,
    )
    from skyspy.services.llm import (
        clear_cache as clear_llm_cache,
    )
    from skyspy.services.notifications import NotificationManager, notifier, send_notification
    from skyspy.services.safety import SafetyMonitor, safety_monitor

    __all__ = [
        # Core services
        "safety_monitor",
        "SafetyMonitor",
        "alert_service",
        "AlertService",
        "acars_service",
        "AcarsService",
        # Notification services
        "notifier",
        "NotificationManager",
        "send_notification",
        # Alert performance services
        "cooldown_manager",
        "DistributedCooldownManager",
        "rule_cache",
        "AlertRuleCache",
        "CompiledRule",
        "alert_metrics",
        "AlertMetricsCollector",
        # Antenna analytics
        "calculate_polar_data",
        "calculate_rssi_data",
        "calculate_summary",
        "refresh_antenna_cache",
        "get_antenna_data",
        # Aircraft info
        "get_aircraft_info",
        "get_bulk_aircraft_info",
        "queue_aircraft_lookup",
        "check_and_queue_new_aircraft",
        "get_aircraft_photo",
        "get_aircraft_info_stats",
        # Airspace
        "get_advisories",
        "get_boundaries",
        "get_advisory_history",
        "get_airspace_snapshot",
        "get_airspace_stats",
        "broadcast_advisory_update",
        "broadcast_boundary_update",
        # LLM services
        "llm_client",
        "LLMClient",
        "validate_callsigns",
        "resolve_ambiguous_callsigns",
        "deduplicate_mentions",
        "enhance_callsign_extraction",
        "get_llm_stats",
        "clear_llm_cache",
        # Module names for explicit imports
        "audio",
        "llm",
        "photo_cache",
        "stats_cache",
        "storage",
        "cache",
        "external_db",
        "geodata",
        "weather_cache",
        "notifications",
        "antenna_analytics",
        "aircraft_info",
        "airspace",
        # New data source services
        "notams",
        "checkwx",
        "avwx",
        "openaip",
        "openflights",
        "military_db",
        "opensky_live",
        "adsbx_live",
        "aviationstack",
    ]
