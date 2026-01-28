"""
OpenAIP data refresh tasks.

Provides Celery tasks for refreshing global airspace data from OpenAIP.
"""
import logging
from datetime import datetime

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def refresh_openaip_data(self):
    """
    Refresh OpenAIP airspace data by prefetching for common regions.

    Warms the cache by prefetching airspace, airport, and navaid data
    for major US regions.

    Runs daily at 5 AM.
    """
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    logger.info("Starting OpenAIP data refresh")

    try:
        from skyspy.services import openaip

        # Check if OpenAIP is enabled
        if not openaip._is_enabled():
            logger.info("OpenAIP is not enabled, skipping refresh")
            return {'status': 'disabled'}

        # Get API status
        status = openaip.get_api_status()
        logger.info(f"OpenAIP API status: {status}")

        # Define regions to prefetch (CONUS grid)
        regions = [
            # Western US
            (37.0, -122.0, 200),  # California
            (47.0, -122.0, 200),  # Pacific Northwest
            (33.0, -112.0, 200),  # Arizona/New Mexico
            (40.0, -105.0, 200),  # Colorado
            # Central US
            (35.0, -97.0, 200),   # Texas/Oklahoma
            (41.0, -95.0, 200),   # Midwest
            # Eastern US
            (33.0, -84.0, 200),   # Southeast
            (40.0, -75.0, 200),   # Northeast
            (28.0, -82.0, 200),   # Florida
        ]

        total_airspaces = 0
        total_airports = 0
        total_navaids = 0

        for lat, lon, radius_nm in regions:
            try:
                # Prefetch airspaces
                airspaces = openaip.get_airspaces(lat, lon, radius_nm)
                total_airspaces += len(airspaces)

                # Prefetch airports
                airports = openaip.get_airports(lat, lon, radius_nm)
                total_airports += len(airports)

                # Prefetch navaids
                navaids = openaip.get_navaids(lat, lon, radius_nm)
                total_navaids += len(navaids)

                logger.debug(f"Prefetched region ({lat}, {lon}): {len(airspaces)} airspaces, {len(airports)} airports, {len(navaids)} navaids")
            except Exception as e:
                logger.warning(f"Failed to prefetch region ({lat}, {lon}): {e}")
                continue

        logger.info(f"OpenAIP prefetch complete: {total_airspaces} airspaces, {total_airports} airports, {total_navaids} navaids")

        # Broadcast update notification
        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                sync_group_send(
                    channel_layer,
                    'airspace_all',
                    {
                        'type': 'openaip_refresh',
                        'data': {
                            'status': 'complete',
                            'airspaces': total_airspaces,
                            'airports': total_airports,
                            'navaids': total_navaids,
                            'timestamp': datetime.utcnow().isoformat() + 'Z'
                        }
                    }
                )
        except Exception as e:
            logger.warning(f"Failed to broadcast OpenAIP refresh: {e}")

        return {
            'status': 'complete',
            'airspaces': total_airspaces,
            'airports': total_airports,
            'navaids': total_navaids,
        }

    except Exception as e:
        logger.error(f"Failed to refresh OpenAIP data: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task
def prefetch_openaip_airspaces(lat: float, lon: float, radius_nm: float = 200):
    """
    Prefetch OpenAIP airspaces for a specific region.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Search radius in nautical miles
    """
    logger.info(f"Prefetching OpenAIP airspaces for {lat}, {lon}, radius {radius_nm}nm")

    try:
        from skyspy.services import openaip

        if not openaip._is_enabled():
            return {'status': 'disabled'}

        airspaces = openaip.get_airspaces(lat, lon, radius_nm)
        logger.info(f"Prefetched {len(airspaces)} airspaces")

        return {
            'status': 'complete',
            'count': len(airspaces),
        }

    except Exception as e:
        logger.error(f"Failed to prefetch OpenAIP airspaces: {e}")
        return {'status': 'error', 'error': str(e)}


@shared_task
def get_openaip_stats():
    """
    Get OpenAIP API status and statistics.
    """
    try:
        from skyspy.services import openaip

        return openaip.get_api_status()

    except Exception as e:
        logger.error(f"Error getting OpenAIP stats: {e}")
        return {'error': str(e)}
