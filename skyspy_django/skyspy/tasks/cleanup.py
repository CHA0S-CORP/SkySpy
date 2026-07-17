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
from django.db import DatabaseError, connection
from django.utils import timezone

from skyspy.tasks.locks import singleton_task

try:
    from redis.exceptions import RedisError

    _REDIS_ERRORS: tuple[type[BaseException], ...] = (RedisError,)
except ImportError:  # pragma: no cover - redis is an optional runtime dependency
    _REDIS_ERRORS = ()

# Redis command failures: connection/timeout errors (subclassed by redis-py) plus RedisError.
_REDIS_OP_ERRORS = (ConnectionError, OSError, TimeoutError, *_REDIS_ERRORS)

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

    retention_days = _get_retention_days("SIGHTING_RETENTION_DAYS", 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        # Count first for logging
        count_to_delete = AircraftSighting.objects.filter(timestamp__lt=cutoff).count()

        if count_to_delete == 0:
            logger.debug(f"No sightings older than {retention_days} days to delete")
            return {"deleted": 0, "retention_days": retention_days}

        # Delete in batches to avoid long-running transactions
        batch_size = 10000
        total_deleted = 0

        while True:
            # Get IDs of records to delete
            ids_to_delete = list(
                AircraftSighting.objects.filter(timestamp__lt=cutoff).values_list("id", flat=True)[:batch_size]
            )

            if not ids_to_delete:
                break

            # Delete batch
            deleted, _ = AircraftSighting.objects.filter(id__in=ids_to_delete).delete()
            total_deleted += deleted

            logger.debug(f"Deleted batch of {deleted} sightings, total: {total_deleted}")

        logger.info(f"Sighting cleanup: deleted {total_deleted} records older than {retention_days} days")

        return {"deleted": total_deleted, "retention_days": retention_days, "cutoff": cutoff.isoformat()}

    except DatabaseError as e:
        logger.error(f"Error cleaning up old sightings: {e}")
        raise


@shared_task
def cleanup_old_sessions():
    """
    Clean up old aircraft tracking sessions based on retention policy.

    Retention: SESSION_RETENTION_DAYS (default: 90 days)
    """
    from skyspy.models import AircraftSession

    retention_days = _get_retention_days("SESSION_RETENTION_DAYS", 90)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = AircraftSession.objects.filter(last_seen__lt=cutoff).delete()

        if deleted > 0:
            logger.info(f"Session cleanup: deleted {deleted} records older than {retention_days} days")

        return {"deleted": deleted, "retention_days": retention_days, "cutoff": cutoff.isoformat()}

    except DatabaseError as e:
        logger.error(f"Error cleaning up old sessions: {e}")
        raise


@shared_task
def cleanup_old_alert_history():
    """
    Clean up old alert history based on retention policy.

    Retention: ALERT_HISTORY_DAYS (default: 30 days)
    """
    from skyspy.models import AlertHistory

    retention_days = _get_retention_days("ALERT_HISTORY_DAYS", 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = AlertHistory.objects.filter(triggered_at__lt=cutoff).delete()

        if deleted > 0:
            logger.info(f"Alert history cleanup: deleted {deleted} records older than {retention_days} days")

        return {"deleted": deleted, "retention_days": retention_days, "cutoff": cutoff.isoformat()}

    except DatabaseError as e:
        logger.error(f"Error cleaning up old alert history: {e}")
        raise


@shared_task
def cleanup_old_safety_events():
    """
    Clean up old safety events based on retention policy.

    Retention: SAFETY_EVENT_RETENTION_DAYS (default: 90 days)
    """
    from skyspy.models import SafetyEvent

    retention_days = _get_retention_days("SAFETY_EVENT_RETENTION_DAYS", 90)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = SafetyEvent.objects.filter(timestamp__lt=cutoff).delete()

        if deleted > 0:
            logger.info(f"Safety event cleanup: deleted {deleted} records older than {retention_days} days")

        return {"deleted": deleted, "retention_days": retention_days, "cutoff": cutoff.isoformat()}

    except DatabaseError as e:
        logger.error(f"Error cleaning up old safety events: {e}")
        raise


@shared_task
def cleanup_old_notification_logs():
    """
    Clean up old notification logs.

    Retention: Uses ALERT_HISTORY_DAYS (same as alert history)
    """
    from skyspy.models import NotificationLog

    retention_days = _get_retention_days("ALERT_HISTORY_DAYS", 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    try:
        deleted, _ = NotificationLog.objects.filter(timestamp__lt=cutoff).delete()

        if deleted > 0:
            logger.info(f"Notification log cleanup: deleted {deleted} records older than {retention_days} days")

        return {"deleted": deleted, "retention_days": retention_days, "cutoff": cutoff.isoformat()}

    except DatabaseError as e:
        logger.error(f"Error cleaning up old notification logs: {e}")
        raise


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

    retention_days = _get_retention_days("ANTENNA_SNAPSHOT_RETENTION_DAYS", 7)

    try:
        now = timezone.now()

        # Delete scheduled snapshots older than retention_days
        scheduled_cutoff = now - timedelta(days=retention_days)
        deleted_scheduled, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=scheduled_cutoff, snapshot_type="scheduled"
        ).delete()

        # Delete hourly snapshots older than 30 days
        hourly_cutoff = now - timedelta(days=30)
        deleted_hourly, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=hourly_cutoff, snapshot_type="hourly"
        ).delete()

        # Delete daily snapshots older than 365 days
        daily_cutoff = now - timedelta(days=365)
        deleted_daily, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=daily_cutoff, snapshot_type="daily"
        ).delete()

        total_deleted = deleted_scheduled + deleted_hourly + deleted_daily

        if total_deleted > 0:
            logger.info(
                f"Antenna snapshot cleanup: deleted {deleted_scheduled} scheduled, "
                f"{deleted_hourly} hourly, {deleted_daily} daily snapshots"
            )

        return {
            "scheduled_deleted": deleted_scheduled,
            "hourly_deleted": deleted_hourly,
            "daily_deleted": deleted_daily,
            "total_deleted": total_deleted,
            "retention_days": retention_days,
        }

    except DatabaseError as e:
        logger.error(f"Error cleaning up old antenna snapshots: {e}")
        raise


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
        deleted, _ = AcarsMessage.objects.filter(timestamp__lt=cutoff).delete()

        if deleted > 0:
            logger.info(f"ACARS message cleanup: deleted {deleted} records older than {retention_days} days")

        return {"deleted": deleted, "retention_days": retention_days, "cutoff": cutoff.isoformat()}

    except DatabaseError as e:
        logger.error(f"Error cleaning up old ACARS messages: {e}")
        raise


@shared_task
def cleanup_old_audio_transmissions():
    """
    Clean up old radio transmissions based on retention policy.

    Retention: RADIO_RETENTION_DAYS (default: 7 days)

    Deletes both the AudioTransmission rows and their local audio files
    under RADIO_AUDIO_DIR (S3-stored audio keeps only the DB row removal;
    S3 lifecycle rules own remote expiry).
    """
    import os

    from django.conf import settings

    from skyspy.models import AudioTransmission

    retention_days = _get_retention_days("RADIO_RETENTION_DAYS", 7)
    cutoff = timezone.now() - timedelta(days=retention_days)
    audio_dir = getattr(settings, "RADIO_AUDIO_DIR", "/data/radio")

    try:
        batch_size = 1000
        total_deleted = 0
        files_deleted = 0

        while True:
            batch = list(AudioTransmission.objects.filter(created_at__lt=cutoff).values("id", "filename")[:batch_size])
            if not batch:
                break

            for row in batch:
                filename = row.get("filename")
                if not filename:
                    continue
                # filenames are stored bare; refuse anything path-like
                if os.path.basename(filename) != filename:
                    logger.warning(f"Skipping suspicious audio filename during cleanup: {filename!r}")
                    continue
                path = os.path.join(audio_dir, filename)
                try:
                    os.remove(path)
                    files_deleted += 1
                except FileNotFoundError:
                    pass
                except OSError as e:
                    logger.warning(f"Could not delete audio file {path}: {e}")

            deleted, _ = AudioTransmission.objects.filter(id__in=[row["id"] for row in batch]).delete()
            total_deleted += deleted

        if total_deleted:
            logger.info(
                f"Audio cleanup: deleted {total_deleted} transmissions ({files_deleted} files) "
                f"older than {retention_days} days"
            )

        return {
            "deleted": total_deleted,
            "files_deleted": files_deleted,
            "retention_days": retention_days,
            "cutoff": cutoff.isoformat(),
        }

    except DatabaseError as e:
        logger.error(f"Error cleaning up old audio transmissions: {e}")
        raise


@shared_task
@singleton_task(timeout=3600)
def run_all_cleanup_tasks():
    """
    Run all data retention cleanup tasks.

    This is the main entry point for scheduled cleanup.
    Runs daily at 3 AM (configured in celery.py beat_schedule).
    """
    results = {}

    # Run each cleanup task
    try:
        results["sightings"] = cleanup_old_sightings()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["sightings"] = {"error": str(e)}

    try:
        results["sessions"] = cleanup_old_sessions()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["sessions"] = {"error": str(e)}

    try:
        results["alert_history"] = cleanup_old_alert_history()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["alert_history"] = {"error": str(e)}

    try:
        results["safety_events"] = cleanup_old_safety_events()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["safety_events"] = {"error": str(e)}

    try:
        results["notification_logs"] = cleanup_old_notification_logs()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["notification_logs"] = {"error": str(e)}

    try:
        results["antenna_snapshots"] = cleanup_old_antenna_snapshots()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["antenna_snapshots"] = {"error": str(e)}

    try:
        results["acars_messages"] = cleanup_old_acars_messages()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["acars_messages"] = {"error": str(e)}

    try:
        results["audio_transmissions"] = cleanup_old_audio_transmissions()
    except Exception as e:  # broad: isolate sub-task failure so remaining cleanups still run
        results["audio_transmissions"] = {"error": str(e)}

    # Calculate totals
    total_deleted = sum(
        r.get("deleted", 0) or r.get("total_deleted", 0)
        for r in results.values()
        if isinstance(r, dict) and "error" not in r
    )

    logger.info(f"Total cleanup: deleted {total_deleted} records across all tables")

    results["total_deleted"] = total_deleted
    results["timestamp"] = timezone.now().isoformat()

    return results


@shared_task
@singleton_task(timeout=600)
def cleanup_orphan_cooldown_keys():
    """
    Clean up Redis cooldown keys for deleted alert rules.

    Scans Redis for `alert:cooldown:*` keys and deletes any where the
    rule_id no longer exists in the AlertRule table.

    Runs daily at 4:30 AM (configured in celery.py).

    Returns:
        dict with 'deleted' count and 'scanned' count
    """
    from skyspy.models import AlertRule

    try:
        import redis

        redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
        r = redis.from_url(redis_url, decode_responses=True)

        # Get all active rule IDs
        active_rule_ids = set(AlertRule.objects.values_list("id", flat=True))

        # Scan for cooldown keys
        cursor = 0
        orphan_keys = []
        pattern = "alert:cooldown:*"

        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=500)

            for key in keys:
                # Extract rule_id from key: alert:cooldown:{rule_id}:{icao}
                parts = key.split(":")
                if len(parts) >= 3:
                    try:
                        rule_id = int(parts[2])
                        if rule_id not in active_rule_ids:
                            orphan_keys.append(key)
                    except ValueError:
                        # Invalid rule_id format, skip
                        pass

            if cursor == 0:
                break

        # Delete orphan keys in batches
        deleted = 0
        if orphan_keys:
            for i in range(0, len(orphan_keys), 100):
                batch = orphan_keys[i : i + 100]
                deleted += r.delete(*batch)

        if deleted > 0:
            logger.info(f"Cleaned up {deleted} orphan cooldown keys for deleted rules")
        else:
            logger.debug("No orphan cooldown keys found")

        return {"deleted": deleted, "scanned": len(orphan_keys)}

    except ImportError:
        logger.warning("Redis not available for cooldown key cleanup")
        return {"error": "redis_not_available"}
    except (DatabaseError, *_REDIS_OP_ERRORS) as e:
        logger.error(f"Failed to cleanup orphan cooldown keys: {e}")
        raise


@shared_task
@singleton_task(timeout=600)
def cleanup_stale_cooldown_keys(max_age_hours: int = 24):
    """
    Clean up cooldown keys that have no TTL set.

    This catches keys that somehow didn't get a proper TTL assigned,
    which would cause them to persist indefinitely.

    Runs weekly on Sundays at 5 AM (configured in celery.py).

    Args:
        max_age_hours: Not used currently, but kept for future use if we
                       want to also clean keys older than a certain age.

    Returns:
        dict with 'checked' count and 'deleted' count
    """
    try:
        import redis

        redis_url = getattr(settings, "REDIS_URL", "redis://redis:6379/0")
        r = redis.from_url(redis_url, decode_responses=True)

        cursor = 0
        checked = 0
        deleted = 0
        pattern = "alert:cooldown:*"

        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=500)

            for key in keys:
                checked += 1
                # Check TTL - if no TTL set (-1), delete the key
                ttl = r.ttl(key)
                if ttl == -1:  # No TTL set (key persists forever)
                    r.delete(key)
                    deleted += 1

            if cursor == 0:
                break

        if deleted > 0:
            logger.info(f"Checked {checked} cooldown keys, deleted {deleted} without TTL")
        else:
            logger.debug(f"Checked {checked} cooldown keys, all have proper TTL")

        return {"checked": checked, "deleted": deleted}

    except ImportError:
        logger.warning("Redis not available for stale cooldown key cleanup")
        return {"error": "redis_not_available"}
    except _REDIS_OP_ERRORS as e:
        logger.error(f"Failed to cleanup stale cooldown keys: {e}")
        raise


@shared_task
@singleton_task(timeout=3600)
def vacuum_analyze_tables():
    """
    Run VACUUM ANALYZE on frequently updated tables.

    This reclaims space and updates statistics for the query planner.
    Should be run weekly or after large cleanups.

    Note: This is PostgreSQL-specific.
    """
    from skyspy.models import (
        AircraftSession,
        AircraftSighting,
        AlertHistory,
        AntennaAnalyticsSnapshot,
        SafetyEvent,
    )

    tables = [
        model._meta.db_table
        for model in (
            AircraftSighting,
            AircraftSession,
            AlertHistory,
            SafetyEvent,
            AntennaAnalyticsSnapshot,
        )
    ]

    results = {}
    errors = []

    for table in tables:
        try:
            with connection.cursor() as cursor:
                # VACUUM ANALYZE must run outside a transaction
                cursor.execute(f"VACUUM ANALYZE {table}")
            results[table] = "success"
            logger.debug(f"VACUUM ANALYZE completed for {table}")
        except Exception as e:  # broad: maintenance task must not crash on any DB error (tested)
            results[table] = f"error: {str(e)}"
            errors.append(f"{table}: {e}")
            logger.warning(f"VACUUM ANALYZE failed for {table}: {e}")

    logger.info(f"VACUUM ANALYZE completed for {len([r for r in results.values() if r == 'success'])} tables")

    # Surface failures to Celery so beat/metrics see the task as failed
    # (all tables are still attempted before raising)
    if errors:
        raise RuntimeError(f"VACUUM ANALYZE failed for {len(errors)} table(s): {'; '.join(errors)}")

    return results
