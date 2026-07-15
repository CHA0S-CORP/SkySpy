"""
NOTAM background tasks.

Provides Celery tasks for:
- Consuming NOTAMs from FAA SWIM FNS (primary source)
- Refreshing cached NOTAMs (legacy fallback)
- Broadcasting TFR updates via WebSocket
"""

import logging
from datetime import datetime

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def consume_swim_notams(self, max_messages: int = 1000, timeout_seconds: int = 300):
    """
    Consume NOTAMs from FAA SWIM FNS service.

    This task connects to the FAA SWIM Solace broker and receives
    real-time NOTAM updates.

    Uses subprocess execution to avoid gevent compatibility issues with the
    Solace PubSub+ library.

    Args:
        max_messages: Maximum messages to process per run (default 1000)
        timeout_seconds: Maximum time to run in seconds (default 5 minutes)
    """
    from skyspy.services import swim_fns

    if not swim_fns.is_enabled():
        logger.info("SWIM FNS is disabled, skipping")
        return {"status": "disabled"}

    logger.info(f"Starting SWIM FNS consumer (max_messages={max_messages})")

    try:
        # Use gevent-safe consumer that runs in subprocess if needed
        stats = swim_fns.consume_with_gevent_workaround(max_messages=max_messages, timeout_seconds=timeout_seconds)

        if stats.get("status") == "connection_failed":
            logger.error("Failed to connect to SWIM FNS")
            raise self.retry(exc=Exception("Connection failed"), countdown=60)

        if stats.get("status") == "error":
            error_msg = stats.get("error_message", "Unknown error")
            logger.error(f"SWIM FNS consumer error: {error_msg}")
            raise self.retry(exc=Exception(error_msg), countdown=120)

        logger.info(f"SWIM FNS consumer finished: {stats}")

        # Broadcast update
        from skyspy.services import notams
        from skyspy.socketio.utils import sync_emit

        notam_stats = notams.get_notam_stats()
        sync_emit(
            "notam:refresh",
            {
                "count": stats.get("messages_processed", 0),
                "active_notams": notam_stats.get("active_notams", 0),
                "active_tfrs": notam_stats.get("active_tfrs", 0),
                "source": "swim_fns",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room="topic_aircraft",
        )

        return {
            "status": stats.get("status", "complete"),
            "messages_received": stats.get("messages_received", 0),
            "messages_processed": stats.get("messages_processed", 0),
            "errors": stats.get("errors", 0),
        }

    except Exception as e:  # broad: Celery task top-level guard — retry on any failure
        logger.error(f"SWIM FNS consumer error: {e}")
        raise self.retry(exc=e, countdown=120)


@shared_task
def check_swim_status():
    """Check SWIM FNS connection status and restart if needed."""
    from skyspy.services import swim_fns

    status = swim_fns.get_status()
    logger.info(f"SWIM FNS status: {status}")

    if status["enabled"] and not status["connected"]:
        logger.info("SWIM FNS not connected, queueing consumer task")
        consume_swim_notams.delay()

    return status


@shared_task(bind=True, max_retries=3)
def refresh_notams(self):
    """
    Refresh all NOTAMs from FAA Aviation Weather API.

    Runs every 15 minutes.
    """
    from skyspy.socketio.utils import sync_emit

    logger.info("Starting NOTAM cache refresh")

    try:
        from skyspy.services import notams

        count = notams.refresh_notams()
        logger.info(f"Refreshed {count} NOTAMs")

        # Broadcast update to WebSocket clients via Socket.IO
        try:
            stats = notams.get_notam_stats()
            update_data = {
                "count": count,
                "active_notams": stats.get("active_notams", 0),
                "active_tfrs": stats.get("active_tfrs", 0),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

            # Broadcast to topic_aircraft room (general aviation updates)
            sync_emit("notam:refresh", update_data, room="topic_aircraft")

            # Broadcast to notams room
            sync_emit(
                "notam:stats",
                {
                    "total_active": stats.get("active_notams", 0),
                    "tfr_count": stats.get("active_tfrs", 0),
                    "by_type": stats.get("by_type", {}),
                    "last_update": datetime.utcnow().isoformat() + "Z",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
                room="topic_notams",
            )
        except Exception as e:  # broad: WebSocket broadcast is best-effort, must not fail the refresh
            logger.warning(f"Failed to broadcast NOTAM refresh: {e}")

        return count

    except Exception as e:  # broad: Celery task top-level guard — retry on any failure
        logger.error(f"Failed to refresh NOTAMs: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task
def check_and_refresh_notams():
    """
    Check if NOTAMs need refresh and trigger if stale.

    Runs every 5 minutes as a check.
    """
    try:
        from skyspy.services import notams

        if notams.should_refresh():
            logger.info("NOTAM cache is stale, triggering refresh")
            refresh_notams.delay()
            return True
        else:
            logger.debug("NOTAM cache is fresh")
            return False

    except Exception as e:  # broad: Celery task top-level guard — must not crash the worker
        logger.error(f"Error checking NOTAM freshness: {e}")
        return False


@shared_task
def refresh_notams_for_airports(icao_list: list):
    """
    Refresh NOTAMs for specific airports.

    Args:
        icao_list: List of airport ICAO codes
    """
    logger.info(f"Refreshing NOTAMs for airports: {icao_list}")

    try:
        from skyspy.services import notams

        count = notams.refresh_notams(icao_list=icao_list)
        logger.info(f"Refreshed {count} NOTAMs for {len(icao_list)} airports")
        return count

    except Exception as e:  # broad: Celery task top-level guard — must not crash the worker
        logger.error(f"Failed to refresh airport NOTAMs: {e}")
        return 0


@shared_task
def broadcast_new_tfr(tfr_data: dict):
    """
    Broadcast a new TFR notification to WebSocket clients via Socket.IO.

    Args:
        tfr_data: TFR data dictionary
    """
    from datetime import datetime

    from skyspy.socketio.utils import sync_emit

    try:
        tfr_message = {"tfr": tfr_data, "timestamp": datetime.utcnow().isoformat() + "Z"}

        # Broadcast to topic_aircraft room (general aviation updates)
        sync_emit("notam:tfr_new", tfr_message, room="topic_aircraft")

        # Broadcast to notams room
        sync_emit("notam:tfr_new", tfr_data, room="topic_notams")

        # Broadcast to TFR-specific room
        sync_emit("notam:tfr_new", tfr_data, room="topic_tfrs")

        logger.info(f"Broadcast new TFR: {tfr_data.get('notam_id')}")
    except Exception as e:  # broad: WebSocket broadcast is best-effort, must not crash the worker
        logger.error(f"Failed to broadcast TFR: {e}")


@shared_task
def cleanup_expired_notams(archive_days: int = 7, delete_days: int = 90):
    """
    Archive and clean up expired NOTAMs.

    This task performs two-stage cleanup:
    1. Archive NOTAMs that have been expired for `archive_days`
    2. Hard delete NOTAMs that have been archived for `delete_days`

    Args:
        archive_days: Days after expiration to archive (default 7)
        delete_days: Days after archival to hard delete (default 90)
    """
    from datetime import timedelta

    from django.db import DatabaseError
    from django.utils import timezone

    from skyspy.models.notams import CachedNotam

    logger.info(f"Running NOTAM cleanup (archive after {archive_days}d, delete after {delete_days}d)")

    try:
        now = timezone.now()

        # Stage 1: Soft archive expired NOTAMs (not yet archived)
        archive_cutoff = now - timedelta(days=archive_days)
        archived_count = CachedNotam.objects.filter(
            effective_end__lt=archive_cutoff,
            is_permanent=False,
            is_archived=False,
        ).update(
            is_archived=True,
            archived_at=now,
            archive_reason="expired",
        )

        if archived_count:
            logger.info(f"Archived {archived_count} expired NOTAMs")

        # Stage 2: Hard delete NOTAMs that have been archived for delete_days
        hard_delete_cutoff = now - timedelta(days=delete_days)
        deleted, _ = CachedNotam.objects.filter(
            is_archived=True,
            archived_at__lt=hard_delete_cutoff,
        ).delete()

        if deleted:
            logger.info(f"Hard deleted {deleted} old archived NOTAMs")

        return {"archived": archived_count, "deleted": deleted}

    except DatabaseError as e:
        logger.error(f"Failed to cleanup NOTAMs: {e}")
        return {"archived": 0, "deleted": 0}


@shared_task
def get_notam_stats():
    """
    Get statistics about cached NOTAMs.
    """
    try:
        from skyspy.services import notams

        stats = notams.get_notam_stats()
        return stats

    except Exception as e:  # broad: Celery task top-level guard — must not crash the worker
        logger.error(f"Error getting NOTAM stats: {e}")
        return {}
