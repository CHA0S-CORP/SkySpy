"""
Celery tasks for terrain elevation data management.
"""

import logging

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def download_srtm_tiles(self, radius_nm: float = 100):
    """
    Download SRTM tiles needed for the feeder's coverage area.

    Downloads tiles in a circle around FEEDER_LAT/FEEDER_LON.
    Tiles are ~2.8MB each (1201x1201 samples * 2 bytes).
    """
    from skyspy.services.terrain_elevation import _download_tile, _tile_path, get_required_tiles

    feeder_lat = getattr(settings, "FEEDER_LAT", None)
    feeder_lon = getattr(settings, "FEEDER_LON", None)

    if feeder_lat is None or feeder_lon is None:
        logger.warning("FEEDER_LAT/FEEDER_LON not configured, skipping SRTM download")
        return {"status": "skipped", "reason": "no_feeder_location"}

    tiles = get_required_tiles(feeder_lat, feeder_lon, radius_nm)
    logger.info(f"Need {len(tiles)} SRTM tiles for coverage area (radius={radius_nm}nm)")

    downloaded = 0
    skipped = 0
    failed = 0

    for tile_lat, tile_lon in tiles:
        tile_path = _tile_path(tile_lat, tile_lon)

        # Skip if already downloaded
        if tile_path.exists() or tile_path.with_suffix(".nodata").exists():
            skipped += 1
            continue

        try:
            result = _download_tile(tile_lat, tile_lon)
            if result:
                downloaded += 1
            else:
                skipped += 1  # nodata (ocean)
        except Exception as e:
            logger.warning(f"Failed to download tile ({tile_lat}, {tile_lon}): {e}")
            failed += 1

    result = {
        "status": "completed",
        "total_tiles": len(tiles),
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": failed,
    }
    logger.info(f"SRTM download complete: {result}")
    return result


@shared_task
def check_srtm_coverage():
    """Check SRTM tile coverage and download missing tiles."""
    from skyspy.services.terrain_elevation import get_tile_status

    status = get_tile_status()
    logger.info(f"SRTM tile status: {status}")

    if not status["exists"] or status["tiles"] == 0:
        logger.info("No SRTM tiles found, triggering download")
        download_srtm_tiles.delay()

    return status
