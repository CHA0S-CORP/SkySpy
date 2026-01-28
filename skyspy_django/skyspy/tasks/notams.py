"""
NOTAM background tasks.

Provides Celery tasks for:
- Refreshing cached NOTAMs from FAA Aviation Weather Center
- Broadcasting TFR updates via WebSocket
"""
import logging
from datetime import datetime

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def refresh_notams(self):
    """
    Refresh all NOTAMs from FAA Aviation Weather API.

    Runs every 15 minutes.
    """
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    logger.info("Starting NOTAM cache refresh")

    try:
        from skyspy.services import notams

        count = notams.refresh_notams()
        logger.info(f"Refreshed {count} NOTAMs")

        # Broadcast update to WebSocket clients
        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                stats = notams.get_notam_stats()
                update_data = {
                    'count': count,
                    'active_notams': stats.get('active_notams', 0),
                    'active_tfrs': stats.get('active_tfrs', 0),
                    'timestamp': datetime.utcnow().isoformat() + 'Z'
                }

                # Broadcast to airspace WebSocket group
                sync_group_send(
                    channel_layer,
                    'airspace_all',
                    {
                        'type': 'notam_refresh',
                        'data': update_data
                    }
                )

                # Broadcast to notams WebSocket group
                sync_group_send(
                    channel_layer,
                    'notams_all',
                    {
                        'type': 'stats_update',
                        'data': {
                            'total_active': stats.get('active_notams', 0),
                            'tfr_count': stats.get('active_tfrs', 0),
                            'by_type': stats.get('by_type', {}),
                            'last_update': datetime.utcnow().isoformat() + 'Z',
                            'timestamp': datetime.utcnow().isoformat() + 'Z'
                        }
                    }
                )
        except Exception as e:
            logger.warning(f"Failed to broadcast NOTAM refresh: {e}")

        return count

    except Exception as e:
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

    except Exception as e:
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

    except Exception as e:
        logger.error(f"Failed to refresh airport NOTAMs: {e}")
        return 0


@shared_task
def broadcast_new_tfr(tfr_data: dict):
    """
    Broadcast a new TFR notification to WebSocket clients.

    Args:
        tfr_data: TFR data dictionary
    """
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send
    from datetime import datetime

    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            tfr_message = {
                'tfr': tfr_data,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }

            # Broadcast to airspace WebSocket group
            sync_group_send(
                channel_layer,
                'airspace_all',
                {
                    'type': 'new_tfr',
                    'data': tfr_message
                }
            )

            # Broadcast to notams WebSocket group
            sync_group_send(
                channel_layer,
                'notams_all',
                {
                    'type': 'tfr_new',
                    'data': tfr_data
                }
            )

            sync_group_send(
                channel_layer,
                'notams_tfrs',
                {
                    'type': 'tfr_new',
                    'data': tfr_data
                }
            )

            logger.info(f"Broadcast new TFR: {tfr_data.get('notam_id')}")
    except Exception as e:
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
            archive_reason='expired',
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

        return {'archived': archived_count, 'deleted': deleted}

    except Exception as e:
        logger.error(f"Failed to cleanup NOTAMs: {e}")
        return {'archived': 0, 'deleted': 0}


@shared_task
def get_notam_stats():
    """
    Get statistics about cached NOTAMs.
    """
    try:
        from skyspy.services import notams

        stats = notams.get_notam_stats()
        return stats

    except Exception as e:
        logger.error(f"Error getting NOTAM stats: {e}")
        return {}
