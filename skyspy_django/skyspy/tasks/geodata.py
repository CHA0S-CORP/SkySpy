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
from django.conf import settings

from skyspy.tasks.locks import singleton_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=1800)
def refresh_all_geodata(self):
    """
    Refresh all geographic data (airports, navaids, GeoJSON, airlines, aircraft types).

    Runs daily at 3 AM.
    """
    from datetime import datetime

    from skyspy.socketio.utils import sync_emit

    logger.info("Starting geographic data refresh")

    try:
        from skyspy.services import geodata, openflights

        results = geodata.refresh_all_geodata()

        # Also refresh OpenFlights data (airlines and aircraft types) if stale
        if openflights.should_refresh():
            openflights_results = openflights.refresh_all_openflights_data()
            results["airlines"] = openflights_results.get("airlines", 0)
            results["aircraft_types"] = openflights_results.get("aircraft_types", 0)

        logger.info(f"Geographic data refresh complete: {results}")

        # Broadcast update to WebSocket clients via Socket.IO
        try:
            sync_emit(
                "geodata:refresh",
                {
                    "airports": results.get("airports", 0),
                    "navaids": results.get("navaids", 0),
                    "geojson": results.get("geojson", 0),
                    "faa_enroute": results.get("faa_enroute", 0),
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
                room="topic_aircraft",
            )
        except Exception as e:  # broad: broadcast must never crash the task
            logger.warning(f"Failed to broadcast geodata refresh: {e}")

        return results

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh geographic data: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=900)
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

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh airports: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=900)
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

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh navaids: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=900)
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

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh GeoJSON: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=1200)
def refresh_faa_enroute(self):
    """
    Refresh cached FAA enroute structure (US airways + named fixes).

    Runs daily (also invoked by refresh_all_geodata).
    """
    logger.info("Refreshing FAA enroute structure (airways + fixes)")

    try:
        from skyspy.services import geodata

        count = geodata.refresh_faa_enroute()
        logger.info(f"Refreshed {count} FAA enroute features")

        return count

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh FAA enroute data: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=600)
def refresh_wildfires(self):
    """Refresh cached Watch Duty wildfires near the feeder.

    Runs every WILDFIRES_REFRESH_INTERVAL seconds (default 5 min). No-op when
    WILDFIRES_ENABLED is off.
    """
    from datetime import datetime

    from skyspy.socketio.utils import sync_emit

    if not getattr(settings, "WILDFIRES_ENABLED", False):
        return {"status": "skipped", "reason": "disabled"}

    logger.info("Refreshing Watch Duty wildfires")

    try:
        from skyspy.services import wildfires

        count = wildfires.refresh_wildfires()
        logger.info(f"Cached {count} wildfires")

        # Broadcast update to WebSocket clients via Socket.IO
        try:
            sync_emit(
                "wildfires:refresh",
                {"count": count, "timestamp": datetime.utcnow().isoformat() + "Z"},
                room="topic_aircraft",
            )
        except Exception as e:  # broad: broadcast must never crash the task
            logger.warning(f"Failed to broadcast wildfire refresh: {e}")

        return count

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh wildfires: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task
@singleton_task(timeout=1800)
def check_and_refresh_geodata():
    """
    Check if geographic data needs refresh and trigger if stale.

    Runs every hour.
    """
    try:
        from skyspy.services import geodata, openflights

        refreshed = False

        if geodata.should_refresh():
            logger.info("Geographic data is stale, triggering refresh")
            refresh_all_geodata.delay()
            refreshed = True

        # Also check OpenFlights data (airlines/aircraft types)
        if openflights.should_refresh():
            logger.info("OpenFlights data is stale, triggering refresh")
            refresh_openflights_data.delay()
            refreshed = True

        if not refreshed:
            logger.debug("Geographic data is fresh")

        return refreshed

    except Exception as e:  # broad: periodic task must not crash; returns safe default
        logger.error(f"Error checking geodata freshness: {e}")
        return False


@shared_task
@singleton_task(timeout=600)
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

    except Exception as e:  # broad: periodic task must not crash; returns safe default
        logger.error(f"Failed to cleanup PIREPs: {e}")
        return 0


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=600)
def refresh_pireps(self, bbox: str = "24,-130,50,-60", hours: int = 6):
    """
    Fetch PIREPs from Aviation Weather Center and store in database.

    Runs every 10 minutes.
    """
    from datetime import datetime

    from skyspy.socketio.utils import sync_emit

    logger.info("Fetching PIREPs from Aviation Weather Center")

    try:
        from skyspy.services import weather_cache

        stored = weather_cache.fetch_and_store_pireps(bbox=bbox, hours=hours)
        logger.info(f"Stored {stored} new PIREPs")

        # Broadcast update to WebSocket clients via Socket.IO
        if stored > 0:
            try:
                sync_emit(
                    "pirep:update",
                    {"new_count": stored, "timestamp": datetime.utcnow().isoformat() + "Z"},
                    room="topic_aircraft",
                )
            except Exception as e:  # broad: broadcast must never crash the task
                logger.warning(f"Failed to broadcast PIREP update: {e}")

        return stored

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to fetch PIREPs: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=600)
def refresh_metars(self, bbox: str = "24,-130,50,-60", hours: int = 2):
    """
    Fetch METARs from Aviation Weather Center and cache them.

    Runs every 10 minutes.
    """
    from datetime import datetime

    from skyspy.socketio.utils import sync_emit

    logger.info("Fetching METARs from Aviation Weather Center")

    try:
        from skyspy.services import weather_cache

        metars = weather_cache.fetch_and_cache_metars(bbox=bbox, hours=hours)
        count = len(metars)
        logger.info(f"Fetched and cached {count} METARs")

        # Broadcast update to WebSocket clients via Socket.IO
        if count > 0:
            try:
                sync_emit(
                    "metar:update",
                    {"count": count, "timestamp": datetime.utcnow().isoformat() + "Z"},
                    room="topic_aircraft",
                )
            except Exception as e:  # broad: broadcast must never crash the task
                logger.warning(f"Failed to broadcast METAR update: {e}")

        return count

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to fetch METARs: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=900)
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

    except Exception as e:  # broad: task-level guard; retries on any service failure
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

    except Exception as e:  # broad: task-level guard; returns safe default
        logger.error(f"Error getting geodata stats: {e}")
        return {}


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=3600)
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
            return {"status": "skipped", "reason": "data still fresh"}

    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh OpenFlights data: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task
@singleton_task(timeout=1800)
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

    except Exception as e:  # broad: periodic task must not crash; returns safe default
        logger.error(f"Error checking OpenFlights freshness: {e}")
        return False


@shared_task(bind=True, max_retries=2)
@singleton_task(timeout=300)
def refresh_nexrad_cache(self, bbox: str = None):
    """Pre-cache NEXRAD radar image for the feeder's coverage area."""
    from skyspy.services import weather_cache

    if bbox is None:
        feeder_lat = getattr(settings, "FEEDER_LAT", None)
        feeder_lon = getattr(settings, "FEEDER_LON", None)
        if feeder_lat is None or feeder_lon is None:
            return {"status": "skipped", "reason": "no_feeder_location"}

        # Build bbox for ~150nm radius
        deg_radius = 2.5
        bbox = (
            f"{feeder_lon - deg_radius},{feeder_lat - deg_radius},{feeder_lon + deg_radius},{feeder_lat + deg_radius}"
        )

    try:
        image_data = weather_cache.fetch_nexrad_radar(bbox)
        return {
            "status": "ok",
            "bbox": bbox,
            "size_bytes": len(image_data) if image_data else 0,
        }
    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh NEXRAD cache: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=2)
@singleton_task(timeout=600)
def refresh_sigmets_cache(self):
    """Pre-cache SIGMETs/AIRMETs."""
    from skyspy.services import weather_cache

    try:
        data = weather_cache.fetch_sigmets()
        return {"status": "ok", "count": len(data)}
    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh SIGMETs cache: {e}")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=2)
@singleton_task(timeout=900)
def refresh_winds_aloft_cache(self):
    """Pre-cache winds aloft for the feeder location."""
    from skyspy.services import weather_cache

    feeder_lat = getattr(settings, "FEEDER_LAT", None)
    feeder_lon = getattr(settings, "FEEDER_LON", None)
    if feeder_lat is None or feeder_lon is None:
        return {"status": "skipped", "reason": "no_feeder_location"}

    try:
        data = weather_cache.fetch_winds_aloft(feeder_lat, feeder_lon)
        return {"status": "ok", "has_data": data is not None}
    except Exception as e:  # broad: task-level guard; retries on any service failure
        logger.error(f"Failed to refresh winds aloft cache: {e}")
        raise self.retry(exc=e, countdown=60)
