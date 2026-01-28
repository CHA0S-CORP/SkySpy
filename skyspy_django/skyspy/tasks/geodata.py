"""
Geographic data refresh tasks.

Provides Celery tasks for:
- Refreshing cached airports from Aviation Weather Center
- Refreshing cached navaids from Aviation Weather Center
- Refreshing GeoJSON boundaries
- PIREP cleanup
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def refresh_all_geodata(self):
    """
    Refresh all geographic data (airports, navaids, GeoJSON).

    Runs daily at 3 AM.
    """
    from datetime import datetime
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    logger.info("Starting geographic data refresh")

    try:
        from skyspy.services import geodata

        results = geodata.refresh_all_geodata()
        logger.info(f"Geographic data refresh complete: {results}")

        # Broadcast update to WebSocket clients
        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                sync_group_send(
                    channel_layer,
                    'airspace_all',
                    {
                        'type': 'geodata_refresh',
                        'data': {
                            'airports': results.get('airports', 0),
                            'navaids': results.get('navaids', 0),
                            'geojson': results.get('geojson', 0),
                            'timestamp': datetime.utcnow().isoformat() + 'Z'
                        }
                    }
                )
        except Exception as e:
            logger.warning(f"Failed to broadcast geodata refresh: {e}")

        return results

    except Exception as e:
        logger.error(f"Failed to refresh geographic data: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def refresh_airports(self):
    """
    Refresh cached airport data.

    Runs daily.
    """
    logger.info("Refreshing airport data")

    try:
        from skyspy.services import geodata

        count = geodata.refresh_airports()
        logger.info(f"Refreshed {count} airports")

        return count

    except Exception as e:
        logger.error(f"Failed to refresh airports: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def refresh_navaids(self):
    """
    Refresh cached navaid data.

    Runs daily.
    """
    logger.info("Refreshing navaid data")

    try:
        from skyspy.services import geodata

        count = geodata.refresh_navaids()
        logger.info(f"Refreshed {count} navaids")

        return count

    except Exception as e:
        logger.error(f"Failed to refresh navaids: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def refresh_geojson(self):
    """
    Refresh cached GeoJSON boundaries.

    Runs daily.
    """
    logger.info("Refreshing GeoJSON boundaries")

    try:
        from skyspy.services import geodata

        count = geodata.refresh_geojson()
        logger.info(f"Refreshed {count} GeoJSON features")

        return count

    except Exception as e:
        logger.error(f"Failed to refresh GeoJSON: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task
def check_and_refresh_geodata():
    """
    Check if geographic data needs refresh and trigger if stale.

    Runs every hour.
    """
    try:
        from skyspy.services import geodata

        if geodata.should_refresh():
            logger.info("Geographic data is stale, triggering refresh")
            refresh_all_geodata.delay()
            return True
        else:
            logger.debug("Geographic data is fresh")
            return False

    except Exception as e:
        logger.error(f"Error checking geodata freshness: {e}")
        return False


@shared_task
def cleanup_old_pireps(retention_hours: int = 24):
    """
    Clean up old PIREPs from the database.

    Runs every hour.
    """
    logger.info(f"Cleaning up PIREPs older than {retention_hours} hours")

    try:
        from skyspy.services import weather_cache

        deleted = weather_cache.cleanup_old_pireps(retention_hours)
        logger.info(f"Cleaned up {deleted} old PIREPs")

        return deleted

    except Exception as e:
        logger.error(f"Failed to cleanup PIREPs: {e}")
        return 0


@shared_task(bind=True, max_retries=3)
def refresh_pireps(self, bbox: str = "24,-130,50,-60", hours: int = 6):
    """
    Fetch PIREPs from Aviation Weather Center and store in database.

    Runs every 10 minutes.
    """
    from datetime import datetime
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    logger.info("Fetching PIREPs from Aviation Weather Center")

    try:
        from skyspy.services import weather_cache

        stored = weather_cache.fetch_and_store_pireps(bbox=bbox, hours=hours)
        logger.info(f"Stored {stored} new PIREPs")

        # Broadcast update to WebSocket clients
        if stored > 0:
            try:
                channel_layer = get_channel_layer()
                if channel_layer:
                    sync_group_send(
                        channel_layer,
                        'aviation_data',
                        {
                            'type': 'pirep_update',
                            'data': {
                                'new_count': stored,
                                'timestamp': datetime.utcnow().isoformat() + 'Z'
                            }
                        }
                    )
            except Exception as e:
                logger.warning(f"Failed to broadcast PIREP update: {e}")

        return stored

    except Exception as e:
        logger.error(f"Failed to fetch PIREPs: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
def refresh_metars(self, bbox: str = "24,-130,50,-60", hours: int = 2):
    """
    Fetch METARs from Aviation Weather Center and cache them.

    Runs every 10 minutes.
    """
    from datetime import datetime
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    logger.info("Fetching METARs from Aviation Weather Center")

    try:
        from skyspy.services import weather_cache

        metars = weather_cache.fetch_and_cache_metars(bbox=bbox, hours=hours)
        count = len(metars)
        logger.info(f"Fetched and cached {count} METARs")

        # Broadcast update to WebSocket clients
        if count > 0:
            try:
                channel_layer = get_channel_layer()
                if channel_layer:
                    sync_group_send(
                        channel_layer,
                        'aviation_data',
                        {
                            'type': 'metar_update',
                            'data': {
                                'count': count,
                                'timestamp': datetime.utcnow().isoformat() + 'Z'
                            }
                        }
                    )
            except Exception as e:
                logger.warning(f"Failed to broadcast METAR update: {e}")

        return count

    except Exception as e:
        logger.error(f"Failed to fetch METARs: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
def refresh_tafs(self, bbox: str = "24,-130,50,-60"):
    """
    Fetch TAFs from Aviation Weather Center and cache them.

    Runs every 30 minutes.
    """
    logger.info("Fetching TAFs from Aviation Weather Center")

    try:
        from skyspy.services import weather_cache

        tafs = weather_cache.fetch_and_cache_tafs(bbox=bbox)
        count = len(tafs)
        logger.info(f"Fetched and cached {count} TAFs")

        return count

    except Exception as e:
        logger.error(f"Failed to fetch TAFs: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task
def get_geodata_stats():
    """
    Get statistics about cached geographic data.
    """
    try:
        from skyspy.services import geodata

        stats = geodata.get_cache_stats()
        return stats

    except Exception as e:
        logger.error(f"Error getting geodata stats: {e}")
        return {}


@shared_task(bind=True, max_retries=3)
def refresh_openflights_data(self):
    """
    Refresh OpenFlights airline and aircraft type data.

    Runs weekly on Sundays at 4 AM.
    """
    logger.info("Starting OpenFlights data refresh")

    try:
        from skyspy.services import openflights

        if openflights.should_refresh():
            results = openflights.refresh_all_openflights_data()
            logger.info(f"OpenFlights data refresh complete: {results}")
            return results
        else:
            logger.info("OpenFlights data is still fresh, skipping refresh")
            return {'status': 'skipped', 'reason': 'data still fresh'}

    except Exception as e:
        logger.error(f"Failed to refresh OpenFlights data: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task
def check_and_refresh_openflights():
    """
    Check if OpenFlights data needs refresh and trigger if stale.
    """
    try:
        from skyspy.services import openflights

        if openflights.should_refresh():
            logger.info("OpenFlights data is stale, triggering refresh")
            refresh_openflights_data.delay()
            return True
        else:
            logger.debug("OpenFlights data is fresh")
            return False

    except Exception as e:
        logger.error(f"Error checking OpenFlights freshness: {e}")
        return False
