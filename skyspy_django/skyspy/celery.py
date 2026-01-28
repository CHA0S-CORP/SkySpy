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
    os.environ.get('CELERY_POOL', '').lower() == 'gevent' or
    '--pool=gevent' in sys.argv or
    '-P gevent' in ' '.join(sys.argv)
)

if _use_gevent:
    # Gevent monkey patching must happen before any other imports
    # This patches standard library modules for cooperative multitasking
    from gevent import monkey
    # Patch all except ssl and subprocess to avoid issues with Django ORM
    monkey.patch_all(ssl=False)

    # Tell Django we're in a sync context even with gevent
    os.environ['DJANGO_ALLOW_ASYNC_UNSAFE'] = 'true'

from celery import Celery
from celery.schedules import crontab

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skyspy.settings')

app = Celery('skyspy')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Debug task for testing Celery configuration."""
    print(f'Request: {self.request!r}')


# =============================================================================
# Celery Beat Schedule
# =============================================================================
app.conf.beat_schedule = {
    # Aircraft polling - every 2 seconds
    'poll-aircraft-every-2s': {
        'task': 'skyspy.tasks.aircraft.poll_aircraft',
        'schedule': 2.0,
        'options': {'expires': 2.0},  # Don't queue if missed
    },

    # Session cleanup - every 5 minutes
    'cleanup-sessions-every-5m': {
        'task': 'skyspy.tasks.aircraft.cleanup_sessions',
        'schedule': 300.0,  # 5 minutes
    },

    # Airspace advisory refresh - every 5 minutes
    'refresh-airspace-advisories-every-5m': {
        'task': 'skyspy.tasks.airspace.refresh_airspace_advisories',
        'schedule': 300.0,  # 5 minutes
    },

    # Airspace boundary refresh - daily at 3 AM UTC
    'refresh-airspace-boundaries-daily': {
        'task': 'skyspy.tasks.airspace.refresh_airspace_boundaries',
        'schedule': crontab(hour=3, minute=0),
    },

    # Antenna analytics update - every 5 minutes
    'update-antenna-analytics-every-5m': {
        'task': 'skyspy.tasks.analytics.update_antenna_analytics',
        'schedule': 300.0,  # 5 minutes
    },

    # External database sync - daily at 4 AM UTC
    'sync-external-databases-daily': {
        'task': 'skyspy.tasks.external_db.sync_external_databases',
        'schedule': crontab(hour=4, minute=0),
    },

    # Check for stale external databases - every 6 hours
    'update-stale-databases-every-6h': {
        'task': 'skyspy.tasks.external_db.update_stale_databases',
        'schedule': 21600.0,  # 6 hours
    },

    # Geographic data refresh - daily at 3:30 AM UTC
    'refresh-geodata-daily': {
        'task': 'skyspy.tasks.geodata.refresh_all_geodata',
        'schedule': crontab(hour=3, minute=30),
    },

    # Check and refresh geodata if stale - every hour
    'check-geodata-freshness-hourly': {
        'task': 'skyspy.tasks.geodata.check_and_refresh_geodata',
        'schedule': 3600.0,  # 1 hour
    },

    # PIREP cleanup - every hour
    'cleanup-pireps-hourly': {
        'task': 'skyspy.tasks.geodata.cleanup_old_pireps',
        'schedule': 3600.0,  # 1 hour
    },

    # PIREP refresh - every 10 minutes
    'refresh-pireps-every-10m': {
        'task': 'skyspy.tasks.geodata.refresh_pireps',
        'schedule': 600.0,  # 10 minutes
    },

    # METAR refresh - every 10 minutes
    'refresh-metars-every-10m': {
        'task': 'skyspy.tasks.geodata.refresh_metars',
        'schedule': 600.0,  # 10 minutes
    },

    # TAF refresh - every 30 minutes
    'refresh-tafs-every-30m': {
        'task': 'skyspy.tasks.geodata.refresh_tafs',
        'schedule': 1800.0,  # 30 minutes
    },

    # Stats cache update - every 60 seconds
    'update-stats-cache-every-60s': {
        'task': 'skyspy.tasks.aircraft.update_stats_cache',
        'schedule': 60.0,
    },

    # Safety stats update - every 30 seconds
    'update-safety-stats-every-30s': {
        'task': 'skyspy.tasks.aircraft.update_safety_stats',
        'schedule': 30.0,
    },

    # ACARS stats update - every 60 seconds
    'update-acars-stats-every-60s': {
        'task': 'skyspy.tasks.analytics.refresh_acars_stats',
        'schedule': 60.0,
    },

    # Time comparison stats update - every 5 minutes
    'update-time-comparison-stats-every-5m': {
        'task': 'skyspy.tasks.analytics.refresh_time_comparison_stats',
        'schedule': 300.0,  # 5 minutes
    },

    # Flight pattern and geographic stats update - every 2 minutes
    'update-flight-pattern-geographic-stats-every-2m': {
        'task': 'skyspy.tasks.analytics.refresh_flight_pattern_geographic_stats',
        'schedule': 120.0,  # 2 minutes
    },

    # Tracking quality stats update - every 2 minutes
    'update-tracking-quality-stats-every-2m': {
        'task': 'skyspy.tasks.analytics.refresh_tracking_quality_stats',
        'schedule': 120.0,  # 2 minutes
    },

    # Engagement stats update - every 2 minutes
    'update-engagement-stats-every-2m': {
        'task': 'skyspy.tasks.analytics.refresh_engagement_stats',
        'schedule': 120.0,  # 2 minutes
    },

    # Update favorite tracking - every 5 minutes
    'update-favorite-tracking-every-5m': {
        'task': 'skyspy.tasks.analytics.update_favorite_tracking',
        'schedule': 300.0,  # 5 minutes
    },

    # Transcription queue processing - every 10 seconds
    'process-transcription-queue-every-10s': {
        'task': 'skyspy.tasks.transcription.process_transcription_queue',
        'schedule': 10.0,
        'options': {'expires': 10.0},
    },

    # Hourly antenna analytics aggregation - every hour
    'aggregate-hourly-antenna-analytics': {
        'task': 'skyspy.tasks.analytics.aggregate_hourly_antenna_analytics',
        'schedule': crontab(minute=5),  # 5 minutes past each hour
    },

    # Antenna analytics cleanup - daily at 4:30 AM UTC
    'cleanup-antenna-analytics-daily': {
        'task': 'skyspy.tasks.analytics.cleanup_antenna_analytics_snapshots',
        'schedule': crontab(hour=4, minute=30),
    },

    # Aircraft info refresh - daily at 5 AM UTC
    'refresh-stale-aircraft-info-daily': {
        'task': 'skyspy.tasks.external_db.refresh_stale_aircraft_info',
        'schedule': crontab(hour=5, minute=0),
    },

    # Aircraft photo upgrades - daily at 5:30 AM UTC
    'upgrade-aircraft-photos-daily': {
        'task': 'skyspy.tasks.external_db.batch_upgrade_aircraft_photos',
        'schedule': crontab(hour=5, minute=30),
    },

    # Orphan aircraft info cleanup - weekly on Sundays at 6 AM UTC
    'cleanup-orphan-aircraft-info-weekly': {
        'task': 'skyspy.tasks.external_db.cleanup_orphan_aircraft_info',
        'schedule': crontab(hour=6, minute=0, day_of_week='sunday'),
    },

    # Notification queue processing - every 30 seconds
    'process-notification-queue-every-30s': {
        'task': 'skyspy.tasks.notifications.process_notification_queue',
        'schedule': 30.0,
    },

    # Notification log cleanup - daily at 3:15 AM UTC
    'cleanup-notification-logs-daily': {
        'task': 'skyspy.tasks.notifications.cleanup_old_notification_logs',
        'schedule': crontab(hour=3, minute=15),
    },

    # NOTAMs refresh - every 15 minutes
    'refresh-notams-every-15m': {
        'task': 'skyspy.tasks.notams.refresh_notams',
        'schedule': 900.0,  # 15 minutes
    },

    # OpenAIP airspace refresh - daily at 5:15 AM UTC
    'refresh-openaip-daily': {
        'task': 'skyspy.tasks.openaip.refresh_openaip_data',
        'schedule': crontab(hour=5, minute=15),
    },

    # NOTAM cleanup - daily at 4:15 AM UTC
    'cleanup-expired-notams-daily': {
        'task': 'skyspy.tasks.notams.cleanup_expired_notams',
        'schedule': crontab(hour=4, minute=15),
    },

    # Daily stats calculation - daily at 1 AM UTC
    'calculate-daily-stats': {
        'task': 'skyspy.tasks.analytics.calculate_daily_stats',
        'schedule': crontab(hour=1, minute=0),
    },

    # Memory cache cleanup - every 5 minutes
    'cleanup-memory-cache-every-5m': {
        'task': 'skyspy.tasks.analytics.cleanup_memory_cache',
        'schedule': 300.0,  # 5 minutes
    },
}


# Task routing
app.conf.task_routes = {
    # High-priority aircraft polling
    'skyspy.tasks.aircraft.poll_aircraft': {'queue': 'polling'},
    'skyspy.tasks.aircraft.update_stats_cache': {'queue': 'polling'},
    'skyspy.tasks.aircraft.update_safety_stats': {'queue': 'polling'},

    # Antenna analytics (runs frequently, should be quick)
    'skyspy.tasks.analytics.update_antenna_analytics': {'queue': 'polling'},

    # Background database operations
    'skyspy.tasks.external_db.*': {'queue': 'database'},
    'skyspy.tasks.geodata.*': {'queue': 'database'},
    'skyspy.tasks.notams.*': {'queue': 'database'},
    'skyspy.tasks.openaip.*': {'queue': 'database'},
    'skyspy.tasks.aircraft.cleanup_sessions': {'queue': 'database'},
    'skyspy.tasks.analytics.cleanup_antenna_analytics_snapshots': {'queue': 'database'},
    'skyspy.tasks.analytics.aggregate_hourly_antenna_analytics': {'queue': 'database'},
    'skyspy.tasks.analytics.refresh_time_comparison_stats': {'queue': 'database'},
    'skyspy.tasks.analytics.refresh_tracking_quality_stats': {'queue': 'database'},
    'skyspy.tasks.analytics.refresh_engagement_stats': {'queue': 'database'},
    'skyspy.tasks.analytics.update_favorite_tracking': {'queue': 'database'},
    'skyspy.tasks.analytics.refresh_flight_pattern_geographic_stats': {'queue': 'database'},
    'skyspy.tasks.analytics.calculate_daily_stats': {'queue': 'database'},
    'skyspy.tasks.analytics.cleanup_memory_cache': {'queue': 'default'},

    # Long-running transcription tasks
    'skyspy.tasks.transcription.*': {'queue': 'transcription'},

    # Notification tasks
    'skyspy.tasks.notifications.send_notification_task': {'queue': 'notifications'},
    'skyspy.tasks.notifications.process_notification_queue': {'queue': 'notifications'},
    'skyspy.tasks.notifications.*': {'queue': 'notifications'},

    # Default queue for everything else
    'skyspy.tasks.*': {'queue': 'default'},
}


# Worker settings
app.conf.worker_prefetch_multiplier = 1  # Disable prefetching for time-sensitive tasks
app.conf.task_acks_late = True  # Acknowledge after completion
app.conf.task_reject_on_worker_lost = True  # Re-queue if worker dies
