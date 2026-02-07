"""
Terrain elevation service using SRTM data.

Provides terrain elevation lookups for MSAW (Minimum Safe Altitude Warning).
SRTM data is 3 arc-second resolution (~90m), free from NASA.
"""

import gzip
import logging
import math
import os
import struct
from pathlib import Path

import httpx
from django.conf import settings
from django.core.cache import cache
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

# SRTM tile parameters
SRTM_SAMPLES = 1201  # 3 arc-second resolution: 1201x1201 samples per tile
SRTM_ARC_SECONDS = 3
SRTM_NODATA = -32768

# SRTM data directory
SRTM_DATA_DIR = Path(getattr(settings, "SRTM_DATA_DIR", os.path.join(settings.BASE_DIR, "data", "srtm")))

# NASA SRTM download URL (AWS S3 mirror, no auth required)
SRTM_BASE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/skadi"

# Cache TTLs
ELEVATION_CACHE_TTL = 86400  # 24 hours (terrain doesn't change)
GRID_CACHE_TTL = 3600  # 1 hour for grids


def _tile_filename(lat: int, lon: int) -> str:
    """Generate SRTM tile filename for a given integer lat/lon."""
    lat_prefix = "N" if lat >= 0 else "S"
    lon_prefix = "E" if lon >= 0 else "W"
    return f"{lat_prefix}{abs(lat):02d}{lon_prefix}{abs(lon):03d}.hgt"


def _tile_path(lat: int, lon: int) -> Path:
    """Get full path to an SRTM tile file."""
    return SRTM_DATA_DIR / _tile_filename(lat, lon)


def _tile_dir_name(lat: int, lon: int) -> str:
    """Get the S3 directory name for a tile."""
    lat_prefix = "N" if lat >= 0 else "S"
    return f"{lat_prefix}{abs(lat):02d}"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
def _download_tile(lat: int, lon: int) -> bool:
    """Download an SRTM tile from AWS S3 (public, no auth required)."""
    filename = _tile_filename(lat, lon)
    dir_name = _tile_dir_name(lat, lon)
    url = f"{SRTM_BASE_URL}/{dir_name}/{filename}.gz"

    tile_path = _tile_path(lat, lon)
    tile_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Downloading SRTM tile: {filename} from {url}")

    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        response = client.get(url, headers={"User-Agent": "SkySpyAPI/2.6 (terrain-elevation)"})

        if response.status_code == 404:
            # Tile doesn't exist (ocean area)
            logger.info(f"SRTM tile not available (ocean?): {filename}")
            # Create an empty marker file so we don't retry
            marker = tile_path.with_suffix(".nodata")
            marker.touch()
            return False

        response.raise_for_status()

    # Decompress gzip data
    decompressed = gzip.decompress(response.content)

    tile_path.write_bytes(decompressed)
    logger.info(f"Downloaded SRTM tile: {filename} ({len(decompressed)} bytes)")
    return True


def _read_tile(lat: int, lon: int) -> bytes | None:
    """Read an SRTM tile file into memory."""
    tile_path = _tile_path(lat, lon)

    # Check for nodata marker (ocean tile)
    if tile_path.with_suffix(".nodata").exists():
        return None

    if not tile_path.exists():
        # Try to download
        try:
            if not _download_tile(lat, lon):
                return None
        except Exception as e:
            logger.warning(f"Failed to download SRTM tile for ({lat}, {lon}): {e}")
            return None

    try:
        return tile_path.read_bytes()
    except Exception as e:
        logger.error(f"Failed to read SRTM tile {tile_path}: {e}")
        return None


def _get_elevation_from_tile(tile_data: bytes, lat: float, lon: float) -> int | None:
    """Extract elevation from tile data using bilinear interpolation."""
    if tile_data is None:
        return None

    # Calculate row/col in the tile
    tile_lat = int(math.floor(lat))
    tile_lon = int(math.floor(lon))

    # Fractional position within the tile
    frac_lat = lat - tile_lat
    frac_lon = lon - tile_lon

    # Row and column (row 0 is the top = highest latitude)
    row = (SRTM_SAMPLES - 1) * (1.0 - frac_lat)
    col = (SRTM_SAMPLES - 1) * frac_lon

    row_int = int(row)
    col_int = int(col)

    # Clamp to valid range
    row_int = max(0, min(row_int, SRTM_SAMPLES - 2))
    col_int = max(0, min(col_int, SRTM_SAMPLES - 2))

    # Read 4 surrounding points for bilinear interpolation
    def read_sample(r, c):
        offset = (r * SRTM_SAMPLES + c) * 2
        if offset + 2 > len(tile_data):
            return SRTM_NODATA
        value = struct.unpack(">h", tile_data[offset : offset + 2])[0]
        return value

    z00 = read_sample(row_int, col_int)
    z01 = read_sample(row_int, col_int + 1)
    z10 = read_sample(row_int + 1, col_int)
    z11 = read_sample(row_int + 1, col_int + 1)

    # Handle nodata values
    samples = [z00, z01, z10, z11]
    valid = [s for s in samples if s != SRTM_NODATA]
    if not valid:
        return 0  # Over water, assume sea level

    # If some are nodata, use average of valid ones
    if len(valid) < 4:
        return int(sum(valid) / len(valid))

    # Bilinear interpolation
    frac_row = row - row_int
    frac_col = col - col_int

    z_top = z00 + (z01 - z00) * frac_col
    z_bot = z10 + (z11 - z10) * frac_col
    z = z_top + (z_bot - z_top) * frac_row

    return int(round(z))


def get_elevation(lat: float, lon: float) -> int:
    """
    Get terrain elevation in meters for a given lat/lon.

    Uses SRTM data with Redis caching.

    Args:
        lat: Latitude in decimal degrees
        lon: Longitude in decimal degrees

    Returns:
        Elevation in meters above sea level (0 for ocean/unknown)
    """
    # Round to ~90m precision (3 arc-seconds) for cache key
    lat_key = round(lat, 3)
    lon_key = round(lon, 3)
    cache_key = f"terrain:elev:{lat_key}:{lon_key}"

    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    tile_lat = int(math.floor(lat))
    tile_lon = int(math.floor(lon))

    tile_data = _read_tile(tile_lat, tile_lon)
    elevation = _get_elevation_from_tile(tile_data, lat, lon)

    if elevation is None:
        elevation = 0

    cache.set(cache_key, elevation, ELEVATION_CACHE_TTL)
    return elevation


def get_elevation_ft(lat: float, lon: float) -> int:
    """Get terrain elevation in feet."""
    meters = get_elevation(lat, lon)
    return int(round(meters * 3.28084))


def get_elevation_grid(north: float, south: float, east: float, west: float, resolution: int = 20) -> dict:
    """
    Get a grid of terrain elevations for a bounding box.

    Args:
        north: Northern latitude bound
        south: Southern latitude bound
        east: Eastern longitude bound
        west: Western longitude bound
        resolution: Grid points per axis (default 20x20)

    Returns:
        Dict with grid metadata and elevation data in feet
    """
    resolution = max(5, min(resolution, 50))  # Clamp 5-50

    # Build cache key
    cache_key = f"terrain:grid:{round(north, 2)}:{round(south, 2)}:{round(east, 2)}:{round(west, 2)}:{resolution}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    lat_step = (north - south) / (resolution - 1)
    lon_step = (east - west) / (resolution - 1)

    elevations = []
    for row in range(resolution):
        lat = north - row * lat_step
        row_data = []
        for col in range(resolution):
            lon = west + col * lon_step
            elev_m = get_elevation(lat, lon)
            row_data.append(int(round(elev_m * 3.28084)))  # Convert to feet
        elevations.append(row_data)

    result = {
        "bounds": {"north": north, "south": south, "east": east, "west": west},
        "resolution": resolution,
        "elevations": elevations,  # 2D array [row][col] in feet
        "unit": "ft",
    }

    cache.set(cache_key, result, GRID_CACHE_TTL)
    return result


def get_required_tiles(lat: float, lon: float, radius_nm: float = 100) -> list[tuple[int, int]]:
    """
    Calculate which SRTM tiles are needed for a given coverage area.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Coverage radius in nautical miles

    Returns:
        List of (lat, lon) integer tuples for required tiles
    """
    deg_radius = radius_nm / 60.0  # Rough conversion

    min_lat = int(math.floor(lat - deg_radius))
    max_lat = int(math.floor(lat + deg_radius))
    min_lon = int(math.floor(lon - deg_radius))
    max_lon = int(math.floor(lon + deg_radius))

    tiles = []
    for t_lat in range(min_lat, max_lat + 1):
        for t_lon in range(min_lon, max_lon + 1):
            tiles.append((t_lat, t_lon))

    return tiles


def get_tile_status() -> dict:
    """Get status of downloaded SRTM tiles."""
    if not SRTM_DATA_DIR.exists():
        return {"directory": str(SRTM_DATA_DIR), "exists": False, "tiles": 0, "nodata": 0, "size_mb": 0}

    hgt_files = list(SRTM_DATA_DIR.glob("*.hgt"))
    nodata_files = list(SRTM_DATA_DIR.glob("*.nodata"))
    total_size = sum(f.stat().st_size for f in hgt_files)

    return {
        "directory": str(SRTM_DATA_DIR),
        "exists": True,
        "tiles": len(hgt_files),
        "nodata": len(nodata_files),
        "size_mb": round(total_size / (1024 * 1024), 1),
    }
