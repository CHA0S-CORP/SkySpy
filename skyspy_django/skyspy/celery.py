"""
Celery configuration for SkysPy.

This module configures Celery for background task processing including:
- Aircraft polling (every 2 seconds)
- Session cleanup (every 5 minutes)
- Airspace advisory refresh (every 5 minutes)
- Airspace boundary refresh (daily at 3 AM)
- Antenna analytics (every 5 minutes, hourly aggregation, daily cleanup)
- External database sync (daily at 4 AM)
- Aircraft info refresh (daily at 5 AM)
- Aircraft photo upgrades (daily at 5:30 AM)
- Orphan aircraft info cleanup (weekly on Sundays)
- Stats cache updates (every 60 seconds)
- Safety stats updates (every 30 seconds)
- Time comparison stats (every 5 minutes)
- Transcription queue processing (every 10 seconds)

Uses gevent for green-threaded concurrent task execution.
"""

import os
import sys

# Only apply gevent monkey patching when running as celery worker with gevent pool
# Check via environment variable or command line args
_use_gevent = (
    os.environ.get("CELERY_POOL", "").lower() == "gevent"
    or "--pool=gevent" in sys.argv
    or "-P gevent" in " ".join(sys.argv)
)

if _use_gevent:
    # Gevent monkey patching must happen before any other imports
    # This patches standard library modules for cooperative multitasking
    from gevent import monkey

    # Patch all except ssl and subprocess to avoid issues with Django ORM
    monkey.patch_all(ssl=False)

    # Tell Django we're in a sync context even with gevent
    os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"

from celery import Celery
from celery.schedules import crontab

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "skyspy.settings")

app = Celery("skyspy")


# Check if running with RPi settings
def _is_rpi_mode():
    """Check if using RPi-optimized settings."""
    return "settings_rpi" in os.environ.get("DJANGO_SETTINGS_MODULE", "")


# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Load task modules from all registered Django apps.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Debug task for testing Celery configuration."""
    print(f"Request: {self.request!r}")


from celery.signals import worker_ready  # noqa: E402


@worker_ready.connect
def _load_cached_databases_on_ready(sender=None, **kwargs):
    """Bootstrap external aircraft DBs from cached files when the worker starts.

    Without this a freshly-restarted worker has empty in-memory FAA/OpenSky/etc.
    until the daily 4 AM sync — so on-demand lookups return no owner/manufacturer/
    LE data (the stale-check task skips DBs it has never loaded). Enqueued rather
    than run inline so it never delays worker readiness.
    """
    try:
        from skyspy.tasks.external_db import load_cached_databases

        load_cached_databases.delay()
    except Exception as e:  # broad: startup hook must never crash the worker
        import logging

        logging.getLogger(__name__).warning(f"Failed to queue cached-DB load on startup: {e}")


# =============================================================================
# Celery Beat Schedule
# =============================================================================
# Wildfire refresh cadence is configurable (fires move faster than aviation
# reference data); read once at import (settings are configured above).
from django.conf import settings as _beat_settings  # noqa: E402

_wildfire_interval = float(getattr(_beat_settings, "WILDFIRES_REFRESH_INTERVAL", 300) or 300)

app.conf.beat_schedule = {
    # Aircraft polling - every 2s FALLBACK (no-op when the stream is active, which
    # is the normal deployment). Was 1.0s: with the stream active this queued 86k
    # pointless no-op tasks/day onto the realtime queue. The stream's own 30s
    # health-check (start_aircraft_stream) recovers a dead stream, so a 2s poll
    # fallback is ample. expire=2.0 so a briefly-busy worker discards stale ones.
    "poll-aircraft-every-2s": {
        "task": "skyspy.tasks.aircraft.poll_aircraft",
        "schedule": 2.0,
        "options": {"expire_seconds": 2.0},  # Don't run if not picked up in time
    },
    # Aircraft streaming - check/start every 30 seconds
    # (actual stream runs continuously, this just ensures it's running)
    "start-aircraft-stream-every-30s": {
        "task": "skyspy.tasks.aircraft_stream.start_aircraft_stream",
        "schedule": 30.0,
        "options": {"expire_seconds": 30.0},
    },
    # Aircraft stream cold path - flush buffered data to database every 5 seconds
    # (non-blocking, doesn't affect client latency)
    "flush-stream-to-database-every-5s": {
        "task": "skyspy.tasks.aircraft_stream.flush_stream_to_database",
        "schedule": 5.0,
        "options": {"expire_seconds": 5.0},
    },
    # Aircraft stream cold path - process new aircraft info lookups every 10 seconds
    "process-new-aircraft-lookups-every-10s": {
        "task": "skyspy.tasks.aircraft_stream.process_new_aircraft_lookups",
        "schedule": 10.0,
        "options": {"expire_seconds": 10.0},
    },
    # Aircraft stream cold path - periodic cleanup of stale aircraft every 30 seconds
    # Safety net that catches aircraft that slip through normal batch-based removal
    "cleanup-stale-aircraft-every-30s": {
        "task": "skyspy.tasks.aircraft_stream.cleanup_stale_aircraft",
        "schedule": 30.0,
        "options": {"expire_seconds": 30.0},
    },
    # Update aircraft sessions - every 5 seconds
    "update-aircraft-sessions-every-5s": {
        "task": "skyspy.tasks.aircraft.update_aircraft_sessions_from_cache",
        "schedule": 5.0,
        "options": {"expire_seconds": 5.0},
    },
    # Session cleanup - every 5 minutes
    "cleanup-sessions-every-5m": {
        "task": "skyspy.tasks.aircraft.cleanup_sessions",
        "schedule": 300.0,  # 5 minutes
    },
    # Airspace advisory refresh - every 5 minutes
    "refresh-airspace-advisories-every-5m": {
        "task": "skyspy.tasks.airspace.refresh_airspace_advisories",
        "schedule": 300.0,  # 5 minutes
    },
    # Airspace boundary refresh - daily at 3 AM UTC
    "refresh-airspace-boundaries-daily": {
        "task": "skyspy.tasks.airspace.refresh_airspace_boundaries",
        "schedule": crontab(hour=3, minute=0),
    },
    # Antenna analytics update - every 5 minutes
    "update-antenna-analytics-every-5m": {
        "task": "skyspy.tasks.analytics.update_antenna_analytics",
        "schedule": 300.0,  # 5 minutes
    },
    # External database sync - daily at 4 AM UTC
    "sync-external-databases-daily": {
        "task": "skyspy.tasks.external_db.sync_external_databases",
        "schedule": crontab(hour=4, minute=0),
    },
    # Check for stale external databases - every 6 hours
    "update-stale-databases-every-6h": {
        "task": "skyspy.tasks.external_db.update_stale_databases",
        "schedule": 21600.0,  # 6 hours
    },
    # Registration/ownership analysis - populate the RegistrationAnalysis table
    # that the ownership screen + RegistrationAnalysisViewSet read from. Without
    # these two the table stays empty and ownership analysis shows nothing. Runs
    # after the 4 AM external-DB sync so FAA owner/registration data is loaded.
    "analyze-new-sightings-daily": {
        "task": "skyspy.tasks.registration_analysis.analyze_new_sightings",
        "schedule": crontab(hour=5, minute=0),
    },
    "analyze-known-aircraft-daily": {
        "task": "skyspy.tasks.registration_analysis.analyze_known_aircraft_batch",
        "schedule": crontab(hour=5, minute=30),
    },
    # Geographic data refresh - daily at 3:30 AM UTC
    "refresh-geodata-daily": {
        "task": "skyspy.tasks.geodata.refresh_all_geodata",
        "schedule": crontab(hour=3, minute=30),
    },
    # Check and refresh geodata if stale - every hour
    "check-geodata-freshness-hourly": {
        "task": "skyspy.tasks.geodata.check_and_refresh_geodata",
        "schedule": 3600.0,  # 1 hour
    },
    # Watch Duty wildfire refresh - every WILDFIRES_REFRESH_INTERVAL (default 5 min).
    # No-op when WILDFIRES_ENABLED is off (the task returns early).
    "refresh-wildfires": {
        "task": "skyspy.tasks.geodata.refresh_wildfires",
        "schedule": _wildfire_interval,
    },
    # PIREP cleanup - every hour
    "cleanup-pireps-hourly": {
        "task": "skyspy.tasks.geodata.cleanup_old_pireps",
        "schedule": 3600.0,  # 1 hour
    },
    # OpenFlights data refresh (airlines and aircraft types) - weekly on Sundays at 4 AM UTC
    "refresh-openflights-weekly": {
        "task": "skyspy.tasks.geodata.refresh_openflights_data",
        "schedule": crontab(hour=4, minute=0, day_of_week="sunday"),
    },
    # Check and refresh OpenFlights data if stale - every 6 hours
    "check-openflights-freshness-every-6h": {
        "task": "skyspy.tasks.geodata.check_and_refresh_openflights",
        "schedule": 21600.0,  # 6 hours
    },
    # PIREP refresh - every 10 minutes
    "refresh-pireps-every-10m": {
        "task": "skyspy.tasks.geodata.refresh_pireps",
        "schedule": 600.0,  # 10 minutes
    },
    # METAR refresh - every 10 minutes
    "refresh-metars-every-10m": {
        "task": "skyspy.tasks.geodata.refresh_metars",
        "schedule": 600.0,  # 10 minutes
    },
    # TAF refresh - every 30 minutes
    "refresh-tafs-every-30m": {
        "task": "skyspy.tasks.geodata.refresh_tafs",
        "schedule": 1800.0,  # 30 minutes
    },
    # Per-aircraft turbulence risk scoring - reads current_aircraft cache and
    # writes turb:by_hex (off the hot path). Interval via env.
    "score-aircraft-turbulence": {
        "task": "skyspy.tasks.turbulence.score_aircraft_turbulence",
        "schedule": float(os.environ.get("TURB_SCORE_INTERVAL", "60")),
        "options": {"expire_seconds": float(os.environ.get("TURB_SCORE_INTERVAL", "60"))},
    },
    # ==========================================================================
    # Unified Stats Aggregation (P1 optimization)
    # ==========================================================================
    # Replaces the individual stats tasks below with a single unified task
    # that shares a database connection context for better efficiency.
    "aggregate-all-stats-every-60s": {
        "task": "skyspy.tasks.analytics.aggregate_all_stats",
        "schedule": 60.0,
        "options": {"expire_seconds": 60.0},
    },
    # Lightweight KPI tick for the Statistics screen (cache reads only, no DB).
    # Interval via env STATS_TICK_INTERVAL (seconds); RPi override below.
    "emit-stats-tick": {
        "task": "skyspy.tasks.analytics.emit_stats_tick",
        "schedule": float(os.environ.get("STATS_TICK_INTERVAL", "10")),
        "options": {"expire_seconds": float(os.environ.get("STATS_TICK_INTERVAL", "10"))},
    },
    # --------------------------------------------------------------------------
    # Legacy individual stats tasks (commented out - replaced by aggregate_all_stats)
    # Kept for reference and in case individual tasks need to be called directly.
    # --------------------------------------------------------------------------
    # # Stats cache update - every 60 seconds
    # "update-stats-cache-every-60s": {
    #     "task": "skyspy.tasks.aircraft.update_stats_cache",
    #     "schedule": 60.0,
    # },
    # # Safety stats update - every 30 seconds
    # "update-safety-stats-every-30s": {
    #     "task": "skyspy.tasks.aircraft.update_safety_stats",
    #     "schedule": 30.0,
    # },
    # # ACARS stats update - every 60 seconds
    # "update-acars-stats-every-60s": {
    #     "task": "skyspy.tasks.analytics.refresh_acars_stats",
    #     "schedule": 60.0,
    # },
    # Time comparison stats update - every 5 minutes
    "update-time-comparison-stats-every-5m": {
        "task": "skyspy.tasks.analytics.refresh_time_comparison_stats",
        "schedule": 300.0,  # 5 minutes
    },
    # Flight pattern and geographic stats update - every 2 minutes
    "update-flight-pattern-geographic-stats-every-2m": {
        "task": "skyspy.tasks.analytics.refresh_flight_pattern_geographic_stats",
        "schedule": 120.0,  # 2 minutes
    },
    # Tracking quality stats update - every 2 minutes
    "update-tracking-quality-stats-every-2m": {
        "task": "skyspy.tasks.analytics.refresh_tracking_quality_stats",
        "schedule": 120.0,  # 2 minutes
    },
    # Engagement stats update - every 2 minutes
    "update-engagement-stats-every-2m": {
        "task": "skyspy.tasks.analytics.refresh_engagement_stats",
        "schedule": 120.0,  # 2 minutes
    },
    # Update favorite tracking - every 5 minutes
    "update-favorite-tracking-every-5m": {
        "task": "skyspy.tasks.analytics.update_favorite_tracking",
        "schedule": 300.0,  # 5 minutes
    },
    # Transcription queue processing - every 10 seconds
    "process-transcription-queue-every-10s": {
        "task": "skyspy.tasks.transcription.process_transcription_queue",
        "schedule": 10.0,
        "options": {"expire_seconds": 10.0},
    },
    # ACARS decode queue processing - every 30 seconds
    # Picks up messages that need libacars decoding
    "process-acars-decode-queue-every-30s": {
        "task": "skyspy.tasks.acars.process_acars_decode_queue",
        "schedule": 30.0,
        "options": {"expire_seconds": 30.0},
    },
    # Hourly antenna analytics aggregation - every hour
    "aggregate-hourly-antenna-analytics": {
        "task": "skyspy.tasks.analytics.aggregate_hourly_antenna_analytics",
        "schedule": crontab(minute=5),  # 5 minutes past each hour
    },
    # Antenna analytics cleanup - daily at 4:30 AM UTC
    "cleanup-antenna-analytics-daily": {
        "task": "skyspy.tasks.analytics.cleanup_antenna_analytics_snapshots",
        "schedule": crontab(hour=4, minute=30),
    },
    # Aircraft info refresh - daily at 5 AM UTC
    "refresh-stale-aircraft-info-daily": {
        "task": "skyspy.tasks.external_db.refresh_stale_aircraft_info",
        "schedule": crontab(hour=5, minute=0),
    },
    # Aircraft photo upgrades - daily at 5:30 AM UTC
    "upgrade-aircraft-photos-daily": {
        "task": "skyspy.tasks.external_db.batch_upgrade_aircraft_photos",
        "schedule": crontab(hour=5, minute=30),
    },
    # Orphan aircraft info cleanup - weekly on Sundays at 6 AM UTC
    "cleanup-orphan-aircraft-info-weekly": {
        "task": "skyspy.tasks.external_db.cleanup_orphan_aircraft_info",
        "schedule": crontab(hour=6, minute=0, day_of_week="sunday"),
    },
    # Notification queue processing - every 30 seconds
    "process-notification-queue-every-30s": {
        "task": "skyspy.tasks.notifications.process_notification_queue",
        "schedule": 30.0,
    },
    # Notification log cleanup - daily at 3:15 AM UTC
    "cleanup-notification-logs-daily": {
        "task": "skyspy.tasks.notifications.cleanup_old_notification_logs",
        "schedule": crontab(hour=3, minute=15),
    },
    # SWIM FNS NOTAM consumer - every 5 minutes
    # Connects to FAA SWIM to receive real-time NOTAM updates
    "swim-notams-every-5m": {
        "task": "skyspy.tasks.notams.consume_swim_notams",
        "schedule": 300.0,  # 5 minutes
        "kwargs": {"max_messages": 500, "timeout_seconds": 240},
    },
    # Legacy NOTAMs refresh - every 30 minutes (fallback if SWIM disabled)
    "refresh-notams-every-30m": {
        "task": "skyspy.tasks.notams.refresh_notams",
        "schedule": 1800.0,  # 30 minutes
    },
    # OpenAIP airspace refresh - daily at 5:15 AM UTC
    "refresh-openaip-daily": {
        "task": "skyspy.tasks.openaip.refresh_openaip_data",
        "schedule": crontab(hour=5, minute=15),
    },
    # NOTAM cleanup - daily at 4:15 AM UTC
    "cleanup-expired-notams-daily": {
        "task": "skyspy.tasks.notams.cleanup_expired_notams",
        "schedule": crontab(hour=4, minute=15),
    },
    # Daily stats calculation - daily at 1 AM UTC
    "calculate-daily-stats": {
        "task": "skyspy.tasks.analytics.calculate_daily_stats",
        "schedule": crontab(hour=1, minute=0),
    },
    # Memory cache cleanup - every 5 minutes
    "cleanup-memory-cache-every-5m": {
        "task": "skyspy.tasks.analytics.cleanup_memory_cache",
        "schedule": 300.0,  # 5 minutes
    },
    # Notification cooldown cleanup - every 30 minutes
    "cleanup-notification-cooldowns-every-30m": {
        "task": "skyspy.tasks.notifications.cleanup_notification_cooldowns",
        "schedule": crontab(minute="*/30"),
    },
    # ==========================================================================
    # Cannonball Mode Tasks
    # ==========================================================================
    # Cannonball pattern analysis - every 5 seconds
    "analyze-aircraft-patterns-every-5s": {
        "task": "skyspy.tasks.cannonball.analyze_aircraft_patterns",
        "schedule": 5.0,
        "options": {"expire_seconds": 5.0},
    },
    # Cannonball session cleanup - every 5 minutes
    "cleanup-cannonball-sessions-every-5m": {
        "task": "skyspy.tasks.cannonball.cleanup_cannonball_sessions",
        "schedule": 300.0,
    },
    # Cannonball pattern cleanup - daily at 3:45 AM UTC
    "cleanup-cannonball-patterns-daily": {
        "task": "skyspy.tasks.cannonball.cleanup_old_patterns",
        "schedule": crontab(hour=3, minute=45),
    },
    # Cannonball stats aggregation - hourly
    "aggregate-cannonball-stats-hourly": {
        "task": "skyspy.tasks.cannonball.aggregate_cannonball_stats",
        "schedule": crontab(minute=10),  # 10 minutes past each hour
    },
    # ==========================================================================
    # SRTM Terrain Tile Management
    # ==========================================================================
    # Check SRTM tile coverage on startup and weekly
    "check-srtm-coverage-weekly": {
        "task": "skyspy.tasks.terrain.check_srtm_coverage",
        "schedule": crontab(hour=3, minute=15, day_of_week="monday"),
    },
    # ==========================================================================
    # Weather Proxy Cache Refresh
    # ==========================================================================
    "refresh-nexrad-cache-every-5m": {
        "task": "skyspy.tasks.geodata.refresh_nexrad_cache",
        "schedule": 300.0,  # 5 minutes
    },
    "refresh-sigmets-cache-every-15m": {
        "task": "skyspy.tasks.geodata.refresh_sigmets_cache",
        "schedule": 900.0,  # 15 minutes
    },
    "refresh-winds-aloft-every-30m": {
        "task": "skyspy.tasks.geodata.refresh_winds_aloft_cache",
        "schedule": 1800.0,  # 30 minutes
    },
    # ==========================================================================
    # Data Retention Cleanup Tasks
    # ==========================================================================
    # Daily cleanup of all old data - runs at 3 AM
    "cleanup-all-old-data-daily": {
        "task": "skyspy.tasks.cleanup.run_all_cleanup_tasks",
        "schedule": crontab(hour=3, minute=0),
    },
    # Weekly vacuum analyze - runs at 4 AM on Sundays
    "vacuum-analyze-weekly": {
        "task": "skyspy.tasks.cleanup.vacuum_analyze_tables",
        "schedule": crontab(hour=4, minute=0, day_of_week=0),
    },
    # ==========================================================================
    # Law Enforcement Data Sync
    # ==========================================================================
    # Sync LE aircraft database from external sources - daily at 4:45 AM UTC
    "sync-le-external-sources-daily": {
        "task": "skyspy.tasks.le_data_sync.sync_le_external_sources",
        "schedule": crontab(hour=4, minute=45),
    },
    # Cooldown key cleanup - daily at 4:30 AM UTC
    # Removes Redis cooldown keys for deleted alert rules
    "cleanup-orphan-cooldown-keys-daily": {
        "task": "skyspy.tasks.cleanup.cleanup_orphan_cooldown_keys",
        "schedule": crontab(hour=4, minute=30),
    },
    # Stale cooldown key cleanup - weekly on Sundays at 5 AM
    # Removes cooldown keys that have no TTL set (should never happen, but safety net)
    "cleanup-stale-cooldown-keys-weekly": {
        "task": "skyspy.tasks.cleanup.cleanup_stale_cooldown_keys",
        "schedule": crontab(hour=5, minute=0, day_of_week="sunday"),
    },
    # ==========================================================================
    # Task Monitoring Tasks
    # ==========================================================================
    # Update queue depth metrics - every 30 seconds
    "update-queue-metrics-every-30s": {
        "task": "skyspy.tasks.monitoring.update_queue_metrics",
        "schedule": 30.0,
        "options": {"expire_seconds": 30.0},
    },
    # Check for stale/failing tasks - every 60 seconds
    "check-task-health-every-60s": {
        "task": "skyspy.tasks.monitoring.check_task_health",
        "schedule": 60.0,
        "options": {"expire_seconds": 60.0},
    },
    # Collect worker statistics - every 5 minutes
    "collect-worker-stats-every-5m": {
        "task": "skyspy.tasks.monitoring.collect_worker_stats",
        "schedule": 300.0,
    },
    # Cleanup stale task metrics - daily at 2 AM UTC
    "cleanup-stale-task-metrics-daily": {
        "task": "skyspy.tasks.monitoring.cleanup_stale_task_metrics",
        "schedule": crontab(hour=2, minute=0),
    },
    # ==========================================================================
    # Aircraft Incident Records (NTSB)
    # ==========================================================================
    # Enrich NTSB incident/accident records for tracked airframes - daily at 6:30 AM UTC
    "refresh-aircraft-incidents-daily": {
        "task": "skyspy.tasks.incidents.refresh_aircraft_incidents",
        "schedule": crontab(hour=6, minute=30),
    },
    # ==========================================================================
    # Airframe RAG index
    # ==========================================================================
    # Re-embed dossiers for recently-changed airframes - daily at 7 AM UTC
    "refresh-airframe-documents-daily": {
        "task": "skyspy.tasks.rag.refresh_airframe_documents",
        "schedule": crontab(hour=7, minute=0),
    },
    # Embed recent ACARS/NOTAM/PIREP text for semantic search - every 30 min
    "refresh-rag-documents": {
        "task": "skyspy.tasks.rag.refresh_rag_documents",
        "schedule": crontab(minute="*/30"),
    },
    # ==========================================================================
    # Auto-generated airframe type cards
    # ==========================================================================
    # LLM-write reference cards for newly-seen aircraft types - daily at 7:30 AM UTC
    # (after the airframe info/RAG refreshes). No-op unless AIRFRAME_CARD_GEN_ENABLED.
    "generate-airframe-type-cards-daily": {
        "task": "skyspy.tasks.airframe_cards.generate_airframe_type_cards",
        "schedule": crontab(hour=7, minute=30),
    },
}


# =============================================================================
# RPi-Optimized Schedule Overrides
# =============================================================================
# When using settings_rpi, reduce frequency of expensive tasks
if _is_rpi_mode():
    from django.conf import settings as django_settings

    # Get RPi task intervals if defined
    rpi_intervals = getattr(django_settings, "RPI_TASK_INTERVALS", {})

    # Override polling interval
    polling_interval = getattr(django_settings, "POLLING_INTERVAL", 2)
    app.conf.beat_schedule["poll-aircraft-every-2s"]["schedule"] = float(polling_interval)
    app.conf.beat_schedule["poll-aircraft-every-2s"]["options"]["expire_seconds"] = float(polling_interval)

    # Override unified stats aggregation task frequency for RPi
    # Uses a longer interval (90s instead of 60s) to reduce CPU load
    app.conf.beat_schedule["aggregate-all-stats-every-60s"]["schedule"] = rpi_intervals.get("stats_cache", 90.0)
    app.conf.beat_schedule["aggregate-all-stats-every-60s"]["options"]["expire_seconds"] = rpi_intervals.get(
        "stats_cache", 90.0
    )

    # Slower KPI tick on RPi (30s instead of 10s)
    app.conf.beat_schedule["emit-stats-tick"]["schedule"] = rpi_intervals.get("stats_tick", 30.0)
    app.conf.beat_schedule["emit-stats-tick"]["options"]["expire_seconds"] = rpi_intervals.get("stats_tick", 30.0)

    # Override expensive analytics tasks with staggered schedules
    # celery crontab has no seconds resolution - stagger via minute offsets
    app.conf.beat_schedule["update-flight-pattern-geographic-stats-every-2m"]["schedule"] = crontab(minute="*/10")
    app.conf.beat_schedule["update-tracking-quality-stats-every-2m"]["schedule"] = crontab(minute="3-59/10")
    app.conf.beat_schedule["update-engagement-stats-every-2m"]["schedule"] = crontab(minute="6-59/10")
    app.conf.beat_schedule["update-time-comparison-stats-every-5m"]["schedule"] = crontab(minute="*/15")
    app.conf.beat_schedule["update-antenna-analytics-every-5m"]["schedule"] = crontab(minute="8-59/10")


# =============================================================================
# Beat pile-up guard: every periodic task gets an expiry
# =============================================================================
# If the worker is down (deploy, crash, queue backlog), beat keeps publishing
# ticks into Redis. Without an expiry, every stale tick executes on recovery —
# potentially hours of redundant runs that starve the queues for real work.
# Interval tasks expire after one interval (a fresher tick is already queued
# behind them); cron tasks get a 6-hour window so daily maintenance still runs
# after a morning outage but can never stack more than a few ticks deep.
# Runs after the RPi overrides so adjusted intervals are respected.
_CRON_EXPIRE_SECONDS = 6 * 3600.0
for _entry in app.conf.beat_schedule.values():
    _options = _entry.setdefault("options", {})
    if "expire_seconds" in _options or "expires" in _options:
        continue
    _schedule = _entry["schedule"]
    _options["expire_seconds"] = float(_schedule) if isinstance(_schedule, (int, float)) else _CRON_EXPIRE_SECONDS


# Task routing
app.conf.task_routes = {
    # -- polling queue = REALTIME HOT PATH ONLY --------------------------------
    # This queue is consumed by the dedicated gevent `celery-worker-realtime`
    # (queues=polling). Keep it to cheap, latency-sensitive tasks ONLY so the
    # live feed is never starved by heavy compute or blocking external HTTP
    # (which runs on the separate threads `celery-worker`). See
    # docs/24-celery-worker-rearchitecture.md.
    "skyspy.tasks.aircraft.poll_aircraft": {"queue": "polling"},
    # Aircraft streaming (long-running stream loop + 30s health check)
    "skyspy.tasks.aircraft_stream.stream_aircraft": {"queue": "polling"},
    "skyspy.tasks.aircraft_stream.start_aircraft_stream": {"queue": "polling"},
    # Cheap cache-only KPI tick (every 10s) — stays on the fast realtime queue so
    # sparklines don't jitter behind slower work.
    "skyspy.tasks.analytics.emit_stats_tick": {"queue": "polling"},
    # -- moved OFF polling: heavy/compute stats now on default/low_priority so
    #    they can't block the 1-2s realtime tasks (were on polling, caused the
    #    83k backlog when they ran long). --
    "skyspy.tasks.aircraft.update_stats_cache": {"queue": "default"},
    "skyspy.tasks.aircraft.update_safety_stats": {"queue": "default"},
    "skyspy.tasks.analytics.aggregate_all_stats": {"queue": "default"},
    "skyspy.tasks.analytics.update_antenna_analytics": {"queue": "low_priority"},
    "skyspy.tasks.analytics.refresh_acars_stats": {"queue": "low_priority"},
    # Aircraft stream cold path (database writes - separate queue to not block hot path)
    "skyspy.tasks.aircraft_stream.flush_stream_to_database": {"queue": "database"},
    "skyspy.tasks.aircraft_stream.process_new_aircraft_lookups": {"queue": "database"},
    # Aircraft stream stale cleanup (quick, in-memory operation)
    "skyspy.tasks.aircraft_stream.cleanup_stale_aircraft": {"queue": "default"},
    # Low-priority expensive analytics tasks (RPi optimization)
    "skyspy.tasks.analytics.refresh_time_comparison_stats": {"queue": "low_priority"},
    "skyspy.tasks.analytics.refresh_tracking_quality_stats": {"queue": "low_priority"},
    "skyspy.tasks.analytics.refresh_engagement_stats": {"queue": "low_priority"},
    "skyspy.tasks.analytics.refresh_flight_pattern_geographic_stats": {"queue": "low_priority"},
    "skyspy.tasks.analytics.calculate_daily_stats": {"queue": "low_priority"},
    "skyspy.tasks.analytics.aggregate_hourly_antenna_analytics": {"queue": "low_priority"},
    "skyspy.tasks.analytics.cleanup_antenna_analytics_snapshots": {"queue": "low_priority"},
    # Background database operations
    "skyspy.tasks.external_db.*": {"queue": "database"},
    "skyspy.tasks.geodata.*": {"queue": "database"},
    "skyspy.tasks.notams.*": {"queue": "database"},
    "skyspy.tasks.openaip.*": {"queue": "database"},
    "skyspy.tasks.aircraft.cleanup_sessions": {"queue": "database"},
    "skyspy.tasks.aircraft.update_aircraft_sessions_from_cache": {"queue": "database"},
    "skyspy.tasks.analytics.update_favorite_tracking": {"queue": "database"},
    "skyspy.tasks.analytics.cleanup_memory_cache": {"queue": "default"},
    # Cleanup tasks (low-priority, can run slowly)
    "skyspy.tasks.cleanup.*": {"queue": "low_priority"},
    # Per-aircraft turbulence scoring (weather fan-out, off the hot path)
    "skyspy.tasks.turbulence.*": {"queue": "low_priority"},
    # Law enforcement data sync (external downloads + DB writes)
    "skyspy.tasks.le_data_sync.*": {"queue": "database"},
    # Long-running transcription tasks
    "skyspy.tasks.transcription.*": {"queue": "transcription"},
    # ACARS decoding tasks (can be slow with libacars)
    "skyspy.tasks.acars.decode_acars_message": {"queue": "database"},
    "skyspy.tasks.acars.decode_acars_batch": {"queue": "database"},
    "skyspy.tasks.acars.process_acars_decode_queue": {"queue": "database"},
    # Notification tasks
    "skyspy.tasks.notifications.send_notification_task": {"queue": "notifications"},
    "skyspy.tasks.notifications.send_webhook_task": {"queue": "notifications"},
    "skyspy.tasks.notifications.process_notification_queue": {"queue": "notifications"},
    "skyspy.tasks.notifications.cleanup_notification_cooldowns": {"queue": "notifications"},
    "skyspy.tasks.notifications.*": {"queue": "notifications"},
    # Terrain tasks (tile downloads, not time-sensitive)
    "skyspy.tasks.terrain.*": {"queue": "database"},
    # Incident enrichment (external API + DB writes, not time-sensitive)
    "skyspy.tasks.incidents.*": {"queue": "database"},
    # Airframe RAG indexing (embedding API + DB writes)
    "skyspy.tasks.rag.*": {"queue": "database"},
    # Airframe type-card generation (LLM calls, daily back-fill — not time-sensitive)
    "skyspy.tasks.airframe_cards.*": {"queue": "low_priority"},
    # Cannonball pattern analysis — time-sensitive but compute-heavy, so keep it
    # on `default` (io worker), NOT the realtime `polling` queue it would block.
    "skyspy.tasks.cannonball.analyze_aircraft_patterns": {"queue": "default"},
    "skyspy.tasks.cannonball.cleanup_cannonball_sessions": {"queue": "database"},
    "skyspy.tasks.cannonball.cleanup_old_patterns": {"queue": "low_priority"},
    "skyspy.tasks.cannonball.aggregate_cannonball_stats": {"queue": "low_priority"},
    "skyspy.tasks.cannonball.*": {"queue": "default"},
    # Monitoring tasks (quick checks, run on default queue)
    "skyspy.tasks.monitoring.update_queue_metrics": {"queue": "default"},
    "skyspy.tasks.monitoring.check_task_health": {"queue": "default"},
    "skyspy.tasks.monitoring.collect_worker_stats": {"queue": "default"},
    "skyspy.tasks.monitoring.cleanup_stale_task_metrics": {"queue": "low_priority"},
    # Default queue for everything else
    "skyspy.tasks.*": {"queue": "default"},
    # Built-in result cleanup: must land on a consumed queue or TaskResult
    # rows grow unbounded (workers do not consume the implicit 'celery' queue)
    "celery.backend_cleanup": {"queue": "low_priority"},
}
app.conf.task_default_queue = "default"


# Worker settings
app.conf.worker_prefetch_multiplier = 1  # Disable prefetching for time-sensitive tasks
app.conf.task_acks_late = True  # Acknowledge after completion
app.conf.task_reject_on_worker_lost = True  # Re-queue if worker dies
app.conf.worker_cancel_long_running_tasks_on_connection_loss = (
    True  # Cancel tasks on connection loss (Celery 6.0 default)
)
