"""
Data cleanup and retention tasks.

Provides configurable retention policies for:
- Aircraft sightings
- Aircraft sessions
- Alert history
- Safety events
- Antenna analytics snapshots

Retention periods are configurable via environment variables:
- SIGHTING_RETENTION_DAYS (default: 30, RPi: 7)
- SESSION_RETENTION_DAYS (default: 90, RPi: 14)
- ALERT_HISTORY_DAYS (default: 30, RPi: 7)
- SAFETY_EVENT_RETENTION_DAYS (default: 90, RPi: 14)
- ANTENNA_SNAPSHOT_RETENTION_DAYS (default: 7, RPi: 3)
"""
import logging
import os
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import connection
from django.utils import timezone

logger = logging.getLogger(__name__)


def _get_retention_days(setting_name: str, default: int) -> int:
    """Get retention days from settings or environment."""
    # Check settings first (for settings_rpi.py override)
    value = getattr(settings, setting_name, None)
    if value is not None:
        return int(value)

    # Fall back to environment variable
    env_value = os.getenv(setting_name)
    if env_value is not None:
        try:
            return int(env_value)
        except ValueError:
            logger.warning(f"Invalid {setting_name} value: {env_value}, using default {default}")

    return default


@shared_task
def cleanup_old_sightings():
    """
    Clean up old aircraft sightings based on retention policy.

    Retention: SIGHTING_RETENTION_DAYS (default: 30 days)

    Uses batch deletion to avoid locking the table for extended periods.
    """
    from skyspy.models import AircraftSighting

    retention_days = _get_retention_days('SIGHTING_RETENTION_DAYS', 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        # Count first for logging
        count_to_delete = AircraftSighting.objects.filter(
            timestamp__lt=cutoff
        ).count()

        if count_to_delete == 0:
            logger.debug(f"No sightings older than {retention_days} days to delete")
            return {'deleted': 0, 'retention_days': retention_days}

        # Delete in batches to avoid long-running transactions
        batch_size = 10000
        total_deleted = 0

        while True:
            # Get IDs of records to delete
            ids_to_delete = list(
                AircraftSighting.objects.filter(timestamp__lt=cutoff)
                .values_list('id', flat=True)[:batch_size]
            )

            if not ids_to_delete:
                break

            # Delete batch
            deleted, _ = AircraftSighting.objects.filter(id__in=ids_to_delete).delete()
            total_deleted += deleted

            logger.debug(f"Deleted batch of {deleted} sightings, total: {total_deleted}")

        logger.info(f"Sighting cleanup: deleted {total_deleted} records older than {retention_days} days")

        return {
            'deleted': total_deleted,
            'retention_days': retention_days,
            'cutoff': cutoff.isoformat()
        }

    except Exception as e:
        logger.error(f"Error cleaning up old sightings: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_old_sessions():
    """
    Clean up old aircraft tracking sessions based on retention policy.

    Retention: SESSION_RETENTION_DAYS (default: 90 days)
    """
    from skyspy.models import AircraftSession

    retention_days = _get_retention_days('SESSION_RETENTION_DAYS', 90)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = AircraftSession.objects.filter(
            last_seen__lt=cutoff
        ).delete()

        if deleted > 0:
            logger.info(f"Session cleanup: deleted {deleted} records older than {retention_days} days")

        return {
            'deleted': deleted,
            'retention_days': retention_days,
            'cutoff': cutoff.isoformat()
        }

    except Exception as e:
        logger.error(f"Error cleaning up old sessions: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_old_alert_history():
    """
    Clean up old alert history based on retention policy.

    Retention: ALERT_HISTORY_DAYS (default: 30 days)
    """
    from skyspy.models import AlertHistory

    retention_days = _get_retention_days('ALERT_HISTORY_DAYS', 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = AlertHistory.objects.filter(
            triggered_at__lt=cutoff
        ).delete()

        if deleted > 0:
            logger.info(f"Alert history cleanup: deleted {deleted} records older than {retention_days} days")

        return {
            'deleted': deleted,
            'retention_days': retention_days,
            'cutoff': cutoff.isoformat()
        }

    except Exception as e:
        logger.error(f"Error cleaning up old alert history: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_old_safety_events():
    """
    Clean up old safety events based on retention policy.

    Retention: SAFETY_EVENT_RETENTION_DAYS (default: 90 days)
    """
    from skyspy.models import SafetyEvent

    retention_days = _get_retention_days('SAFETY_EVENT_RETENTION_DAYS', 90)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = SafetyEvent.objects.filter(
            timestamp__lt=cutoff
        ).delete()

        if deleted > 0:
            logger.info(f"Safety event cleanup: deleted {deleted} records older than {retention_days} days")

        return {
            'deleted': deleted,
            'retention_days': retention_days,
            'cutoff': cutoff.isoformat()
        }

    except Exception as e:
        logger.error(f"Error cleaning up old safety events: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_old_notification_logs():
    """
    Clean up old notification logs.

    Retention: Uses ALERT_HISTORY_DAYS (same as alert history)
    """
    from skyspy.models import NotificationLog

    retention_days = _get_retention_days('ALERT_HISTORY_DAYS', 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = NotificationLog.objects.filter(
            timestamp__lt=cutoff
        ).delete()

        if deleted > 0:
            logger.info(f"Notification log cleanup: deleted {deleted} records older than {retention_days} days")

        return {
            'deleted': deleted,
            'retention_days': retention_days,
            'cutoff': cutoff.isoformat()
        }

    except Exception as e:
        logger.error(f"Error cleaning up old notification logs: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_old_antenna_snapshots():
    """
    Clean up old antenna analytics snapshots.

    Retention (configurable via ANTENNA_SNAPSHOT_RETENTION_DAYS):
    - Scheduled (5-min) snapshots: retention_days (default: 7 days)
    - Hourly snapshots: 30 days
    - Daily snapshots: 365 days
    """
    from skyspy.models import AntennaAnalyticsSnapshot

    retention_days = _get_retention_days('ANTENNA_SNAPSHOT_RETENTION_DAYS', 7)

    try:
        now = timezone.now()

        # Delete scheduled snapshots older than retention_days
        scheduled_cutoff = now - timedelta(days=retention_days)
        deleted_scheduled, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=scheduled_cutoff,
            snapshot_type='scheduled'
        ).delete()

        # Delete hourly snapshots older than 30 days
        hourly_cutoff = now - timedelta(days=30)
        deleted_hourly, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=hourly_cutoff,
            snapshot_type='hourly'
        ).delete()

        # Delete daily snapshots older than 365 days
        daily_cutoff = now - timedelta(days=365)
        deleted_daily, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=daily_cutoff,
            snapshot_type='daily'
        ).delete()

        total_deleted = deleted_scheduled + deleted_hourly + deleted_daily

        if total_deleted > 0:
            logger.info(
                f"Antenna snapshot cleanup: deleted {deleted_scheduled} scheduled, "
                f"{deleted_hourly} hourly, {deleted_daily} daily snapshots"
            )

        return {
            'scheduled_deleted': deleted_scheduled,
            'hourly_deleted': deleted_hourly,
            'daily_deleted': deleted_daily,
            'total_deleted': total_deleted,
            'retention_days': retention_days
        }

    except Exception as e:
        logger.error(f"Error cleaning up old antenna snapshots: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_old_acars_messages():
    """
    Clean up old ACARS/VDL2 messages.

    Retention: 7 days (fixed, ACARS messages are typically transient)
    """
    from skyspy.models import AcarsMessage

    retention_days = 7
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = AcarsMessage.objects.filter(
            timestamp__lt=cutoff
        ).delete()

        if deleted > 0:
            logger.info(f"ACARS message cleanup: deleted {deleted} records older than {retention_days} days")

        return {
            'deleted': deleted,
            'retention_days': retention_days,
            'cutoff': cutoff.isoformat()
        }

    except Exception as e:
        logger.error(f"Error cleaning up old ACARS messages: {e}")
        return {'error': str(e)}


@shared_task
def run_all_cleanup_tasks():
    """
    Run all data retention cleanup tasks.

    This is the main entry point for scheduled cleanup.
    Runs daily at 3 AM (configured in celery.py beat_schedule).
    """
    results = {}

    # Run each cleanup task
    try:
        results['sightings'] = cleanup_old_sightings()
    except Exception as e:
        results['sightings'] = {'error': str(e)}

    try:
        results['sessions'] = cleanup_old_sessions()
    except Exception as e:
        results['sessions'] = {'error': str(e)}

    try:
        results['alert_history'] = cleanup_old_alert_history()
    except Exception as e:
        results['alert_history'] = {'error': str(e)}

    try:
        results['safety_events'] = cleanup_old_safety_events()
    except Exception as e:
        results['safety_events'] = {'error': str(e)}

    try:
        results['notification_logs'] = cleanup_old_notification_logs()
    except Exception as e:
        results['notification_logs'] = {'error': str(e)}

    try:
        results['antenna_snapshots'] = cleanup_old_antenna_snapshots()
    except Exception as e:
        results['antenna_snapshots'] = {'error': str(e)}

    try:
        results['acars_messages'] = cleanup_old_acars_messages()
    except Exception as e:
        results['acars_messages'] = {'error': str(e)}

    # Calculate totals
    total_deleted = sum(
        r.get('deleted', 0) or r.get('total_deleted', 0)
        for r in results.values()
        if isinstance(r, dict) and 'error' not in r
    )

    logger.info(f"Total cleanup: deleted {total_deleted} records across all tables")

    results['total_deleted'] = total_deleted
    results['timestamp'] = timezone.now().isoformat()

    return results


@shared_task
def vacuum_analyze_tables():
    """
    Run VACUUM ANALYZE on frequently updated tables.

    This reclaims space and updates statistics for the query planner.
    Should be run weekly or after large cleanups.

    Note: This is PostgreSQL-specific.
    """
    tables = [
        'skyspy_aircraftsighting',
        'skyspy_aircraftsession',
        'skyspy_alerthistory',
        'skyspy_safetyevent',
        'skyspy_antennaanalyticssnapshot',
    ]

    results = {}

    for table in tables:
        try:
            with connection.cursor() as cursor:
                # VACUUM ANALYZE must run outside a transaction
                cursor.execute(f"VACUUM ANALYZE {table}")
            results[table] = 'success'
            logger.debug(f"VACUUM ANALYZE completed for {table}")
        except Exception as e:
            results[table] = f'error: {str(e)}'
            logger.warning(f"VACUUM ANALYZE failed for {table}: {e}")

    logger.info(f"VACUUM ANALYZE completed for {len([r for r in results.values() if r == 'success'])} tables")
    return results
