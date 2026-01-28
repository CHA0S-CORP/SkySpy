"""
Weather data caching service.

Provides Redis caching for METAR data and database storage for PIREPs.
"""
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from math import radians, sin, cos, sqrt, atan2
from typing import Optional, List

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Max, Count

from skyspy.models import CachedPirep

logger = logging.getLogger(__name__)

# Internal tracking for stats
_metar_stats = {
    "cache_hits": 0,
    "cache_misses": 0,
    "api_requests": 0,
    "api_errors": 0,
    "last_api_call": None,
}
_pirep_stats = {
    "stored": 0,
    "duplicates": 0,
    "queries": 0,
    "last_store": None,
}


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles between two points."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


# =============================================================================
# METAR Redis Cache (using Django cache framework)
# =============================================================================

def _make_metar_key(station: str, hours: int = 2) -> str:
    """Create a cache key for METAR data."""
    return f"metar:{station.upper()}:{hours}"


def _make_metar_bbox_key(bbox: str, hours: int = 2) -> str:
    """Create a cache key for METAR bbox query."""
    bbox_hash = hashlib.md5(bbox.encode()).hexdigest()[:12]
    return f"metar:bbox:{bbox_hash}:{hours}"


def get_cached_metar(station: str, hours: int = 2) -> Optional[list]:
    """Get cached METAR data for a station from Redis."""
    global _metar_stats

    key = _make_metar_key(station, hours)
    data = cache.get(key)

    if data:
        logger.debug(f"Cache hit for METAR {station}")
        _metar_stats["cache_hits"] += 1
        return data
    else:
        _metar_stats["cache_misses"] += 1
        return None


def cache_metar(station: str, data: list, hours: int = 2, ttl: int = 300) -> bool:
    """Cache METAR data for a station in Redis."""
    key = _make_metar_key(station, hours)
    cache.set(key, data, ttl)
    logger.debug(f"Cached METAR {station} (TTL: {ttl}s)")
    return True


def get_cached_metars_bbox(bbox: str, hours: int = 2) -> Optional[list]:
    """Get cached METAR data for a bounding box from Redis."""
    global _metar_stats

    key = _make_metar_bbox_key(bbox, hours)
    data = cache.get(key)

    if data:
        logger.debug(f"Cache hit for METAR bbox query")
        _metar_stats["cache_hits"] += 1
        return data
    else:
        _metar_stats["cache_misses"] += 1
        return None


def cache_metars_bbox(bbox: str, data: list, hours: int = 2, ttl: int = 300) -> bool:
    """Cache METAR bbox results in Redis."""
    key = _make_metar_bbox_key(bbox, hours)
    cache.set(key, data, ttl)
    logger.debug(f"Cached METAR bbox results (TTL: {ttl}s)")
    return True


# =============================================================================
# PIREP Database Storage
# =============================================================================

def _generate_pirep_id(pirep: dict) -> str:
    """Generate a unique ID for a PIREP based on its content."""
    parts = [
        pirep.get("rawOb", ""),
        str(pirep.get("lat", "")),
        str(pirep.get("lon", "")),
        str(pirep.get("obsTime", "")),
    ]
    content = "|".join(parts)
    return hashlib.md5(content.encode()).hexdigest()


def _parse_pirep_time(pirep: dict) -> Optional[datetime]:
    """Parse observation time from PIREP data."""
    obs_time = pirep.get("obsTime")
    if obs_time:
        try:
            # AWC returns Unix timestamp
            if isinstance(obs_time, (int, float)):
                return datetime.utcfromtimestamp(obs_time)
            # Try ISO format
            return datetime.fromisoformat(str(obs_time).replace("Z", "+00:00")).replace(tzinfo=None)
        except (ValueError, TypeError):
            pass
    return None


@transaction.atomic
def store_pirep(pirep: dict) -> Optional[int]:
    """Store a single PIREP in the database."""
    global _pirep_stats

    pirep_id = _generate_pirep_id(pirep)

    # Check if already exists
    if CachedPirep.objects.filter(pirep_id=pirep_id).exists():
        _pirep_stats["duplicates"] += 1
        return None

    try:
        cached_pirep = CachedPirep.objects.create(
            pirep_id=pirep_id,
            report_type=pirep.get("reportType", "UA"),
            latitude=pirep.get("lat"),
            longitude=pirep.get("lon"),
            location=pirep.get("location"),
            observation_time=_parse_pirep_time(pirep),
            flight_level=pirep.get("fltlvl"),
            altitude_ft=pirep.get("altFt"),
            aircraft_type=pirep.get("acType"),
            turbulence_type=pirep.get("turbType"),
            turbulence_freq=pirep.get("turbFreq"),
            turbulence_base_ft=pirep.get("turbBas"),
            turbulence_top_ft=pirep.get("turbTop"),
            icing_type=pirep.get("iceType"),
            icing_intensity=pirep.get("iceInt"),
            icing_base_ft=pirep.get("icgBas"),
            icing_top_ft=pirep.get("icgTop"),
            sky_cover=pirep.get("skyCondition"),
            visibility_sm=pirep.get("visib"),
            weather=pirep.get("wxString"),
            temperature_c=pirep.get("temp"),
            wind_dir=pirep.get("wdir"),
            wind_speed_kt=pirep.get("wspd"),
            raw_text=pirep.get("rawOb"),
            source_data=pirep,
        )
        _pirep_stats["stored"] += 1
        _pirep_stats["last_store"] = datetime.utcnow().isoformat()
        return cached_pirep.id
    except Exception as e:
        logger.error(f"Failed to store PIREP: {e}")
        return None


def store_pireps(pireps: list) -> int:
    """Store multiple PIREPs in the database."""
    if not pireps:
        return 0

    stored_count = 0
    for pirep in pireps:
        try:
            result = store_pirep(pirep)
            if result:
                stored_count += 1
        except Exception as e:
            logger.warning(f"Failed to store PIREP: {e}")
            continue

    if stored_count > 0:
        logger.info(f"Stored {stored_count} new PIREPs in database")

    return stored_count


def get_cached_pireps(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    hours: int = 6,
    limit: int = 100
) -> List[dict]:
    """Get PIREPs from the database cache."""
    global _pirep_stats

    _pirep_stats["queries"] += 1

    cutoff = datetime.utcnow() - timedelta(hours=hours)

    queryset = CachedPirep.objects.filter(observation_time__gte=cutoff)

    # Add bounding box filter if location specified
    if lat is not None and lon is not None:
        deg_offset = radius_nm / 60.0
        queryset = queryset.filter(
            latitude__range=(lat - deg_offset, lat + deg_offset),
            longitude__range=(lon - deg_offset, lon + deg_offset),
        )

    pireps = list(queryset.order_by('-observation_time')[:limit * 2])

    results = []
    for pirep in pireps:
        data = {
            "pirep_id": pirep.pirep_id,
            "reportType": pirep.report_type,
            "lat": pirep.latitude,
            "lon": pirep.longitude,
            "location": pirep.location,
            "obsTime": pirep.observation_time.isoformat() if pirep.observation_time else None,
            "fltlvl": pirep.flight_level,
            "altFt": pirep.altitude_ft,
            "acType": pirep.aircraft_type,
            "turbType": pirep.turbulence_type,
            "turbFreq": pirep.turbulence_freq,
            "iceType": pirep.icing_type,
            "iceInt": pirep.icing_intensity,
            "skyCondition": pirep.sky_cover,
            "visib": pirep.visibility_sm,
            "wxString": pirep.weather,
            "temp": pirep.temperature_c,
            "wdir": pirep.wind_dir,
            "wspd": pirep.wind_speed_kt,
            "rawOb": pirep.raw_text,
        }

        # Calculate distance if location provided
        if lat is not None and lon is not None and pirep.latitude and pirep.longitude:
            distance = haversine_nm(lat, lon, pirep.latitude, pirep.longitude)
            if distance <= radius_nm:
                data["distance_nm"] = round(distance, 1)
                results.append(data)
        else:
            results.append(data)

    # Sort by distance if applicable
    if lat is not None and lon is not None:
        results.sort(key=lambda x: x.get("distance_nm", 9999))

    return results[:limit]


def cleanup_old_pireps(retention_hours: int = 24) -> int:
    """Remove PIREPs older than retention period."""
    cutoff = datetime.utcnow() - timedelta(hours=retention_hours)

    deleted, _ = CachedPirep.objects.filter(observation_time__lt=cutoff).delete()

    if deleted > 0:
        logger.info(f"Cleaned up {deleted} old PIREPs")

    return deleted


def get_historical_pireps(
    start_time: datetime,
    end_time: datetime,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    turbulence_only: bool = False,
    icing_only: bool = False,
    limit: int = 500
) -> List[dict]:
    """Get historical PIREPs from the database within a time range."""
    global _pirep_stats

    _pirep_stats["queries"] += 1

    queryset = CachedPirep.objects.filter(
        observation_time__gte=start_time,
        observation_time__lte=end_time
    )

    # Add bounding box filter if location specified
    if lat is not None and lon is not None:
        deg_offset = radius_nm / 60.0
        queryset = queryset.filter(
            latitude__range=(lat - deg_offset, lat + deg_offset),
            longitude__range=(lon - deg_offset, lon + deg_offset),
        )

    # Filter by condition type
    if turbulence_only:
        queryset = queryset.exclude(turbulence_type__isnull=True)
    if icing_only:
        queryset = queryset.exclude(icing_type__isnull=True)

    pireps = list(queryset.order_by('-observation_time')[:limit * 2])

    results = []
    for pirep in pireps:
        data = {
            "pirep_id": pirep.pirep_id,
            "reportType": pirep.report_type,
            "lat": pirep.latitude,
            "lon": pirep.longitude,
            "location": pirep.location,
            "obsTime": pirep.observation_time.isoformat() if pirep.observation_time else None,
            "fltlvl": pirep.flight_level,
            "altFt": pirep.altitude_ft,
            "acType": pirep.aircraft_type,
            "turbType": pirep.turbulence_type,
            "turbFreq": pirep.turbulence_freq,
            "iceType": pirep.icing_type,
            "iceInt": pirep.icing_intensity,
            "skyCondition": pirep.sky_cover,
            "visib": pirep.visibility_sm,
            "wxString": pirep.weather,
            "temp": pirep.temperature_c,
            "wdir": pirep.wind_dir,
            "wspd": pirep.wind_speed_kt,
            "rawOb": pirep.raw_text,
        }

        # Calculate distance if location provided
        if lat is not None and lon is not None and pirep.latitude and pirep.longitude:
            distance = haversine_nm(lat, lon, pirep.latitude, pirep.longitude)
            if distance <= radius_nm:
                data["distance_nm"] = round(distance, 1)
                results.append(data)
        else:
            results.append(data)

    # Sort by time (most recent first)
    results.sort(key=lambda x: x.get("obsTime", ""), reverse=True)

    return results[:limit]


def get_pirep_stats() -> dict:
    """Get statistics about cached PIREPs."""
    now = datetime.utcnow()

    # Total count
    total = CachedPirep.objects.count()

    # Last 6 hours
    cutoff_6h = now - timedelta(hours=6)
    recent = CachedPirep.objects.filter(observation_time__gte=cutoff_6h).count()

    # Latest PIREP time
    latest = CachedPirep.objects.aggregate(Max('fetched_at'))['fetched_at__max']

    # Count by type
    turb_count = CachedPirep.objects.filter(
        observation_time__gte=cutoff_6h
    ).exclude(turbulence_type__isnull=True).count()

    ice_count = CachedPirep.objects.filter(
        observation_time__gte=cutoff_6h
    ).exclude(icing_type__isnull=True).count()

    return {
        "total_pireps": total,
        "pireps_last_6h": recent,
        "turbulence_reports_6h": turb_count,
        "icing_reports_6h": ice_count,
        "last_fetch": latest.isoformat() if latest else None,
        "runtime_stats": {
            "stored": _pirep_stats["stored"],
            "duplicates": _pirep_stats["duplicates"],
            "queries": _pirep_stats["queries"],
            "last_store": _pirep_stats["last_store"],
        }
    }


def get_metar_stats() -> dict:
    """Get METAR cache statistics."""
    return {
        "cache_hits": _metar_stats["cache_hits"],
        "cache_misses": _metar_stats["cache_misses"],
        "api_requests": _metar_stats["api_requests"],
        "api_errors": _metar_stats["api_errors"],
        "last_api_call": _metar_stats["last_api_call"],
        "hit_rate": round(
            _metar_stats["cache_hits"] / max(1, _metar_stats["cache_hits"] + _metar_stats["cache_misses"]) * 100, 2
        ),
    }


# =============================================================================
# AWC Data Fetching
# =============================================================================

AWC_BASE = "https://aviationweather.gov/api/data"


def _fetch_awc_data(endpoint: str, params: dict) -> dict | list:
    """Fetch data from Aviation Weather Center API."""
    import httpx

    try:
        with httpx.Client(timeout=30) as client:
            response = client.get(
                f"{AWC_BASE}/{endpoint}",
                params=params,
                headers={
                    "User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)",
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json() if response.text else []
    except Exception as e:
        logger.error(f"AWC API request failed for {endpoint}: {e}")
        return {"error": str(e)}


def fetch_and_store_pireps(bbox: str = "24,-130,50,-60", hours: int = 6) -> int:
    """
    Fetch PIREPs from Aviation Weather Center and store in database.

    Args:
        bbox: Bounding box "min_lat,min_lon,max_lat,max_lon"
        hours: Hours of PIREPs to fetch (default 6)

    Returns:
        Number of new PIREPs stored
    """
    logger.info(f"Fetching PIREPs from AWC (bbox={bbox}, hours={hours})")

    data = _fetch_awc_data("pirep", {
        "bbox": bbox,
        "format": "json",
        "hours": hours,
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch PIREPs: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected PIREP data format: {type(data)}")
        return 0

    stored = store_pireps(data)
    logger.info(f"Fetched {len(data)} PIREPs, stored {stored} new")
    return stored


def fetch_and_cache_metars(
    bbox: str = "24,-130,50,-60",
    hours: int = 2,
    ttl: int = 300
) -> List[dict]:
    """
    Fetch METARs from Aviation Weather Center and cache them.

    Args:
        bbox: Bounding box "min_lat,min_lon,max_lat,max_lon"
        hours: Hours of METARs to fetch (default 2)
        ttl: Cache TTL in seconds

    Returns:
        List of METAR data
    """
    global _metar_stats

    # Check cache first
    cached = get_cached_metars_bbox(bbox, hours)
    if cached:
        return cached

    logger.info(f"Fetching METARs from AWC (bbox={bbox}, hours={hours})")
    record_metar_api_request(success=True)

    data = _fetch_awc_data("metar", {
        "bbox": bbox,
        "format": "json",
        "hours": hours,
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch METARs: {data.get('error')}")
        record_metar_api_request(success=False)
        return []

    if not isinstance(data, list):
        logger.warning(f"Unexpected METAR data format: {type(data)}")
        return []

    # Cache the results
    cache_metars_bbox(bbox, data, hours, ttl)
    logger.info(f"Fetched and cached {len(data)} METARs")

    return data


def fetch_metar_by_station(station: str, hours: int = 2, ttl: int = 300) -> List[dict]:
    """
    Fetch METARs for a specific station.

    Args:
        station: ICAO station identifier (e.g., "KJFK")
        hours: Hours of METARs to fetch
        ttl: Cache TTL in seconds

    Returns:
        List of METAR data for the station
    """
    # Check cache first
    cached = get_cached_metar(station, hours)
    if cached:
        return cached

    logger.debug(f"Fetching METARs for station {station}")
    record_metar_api_request(success=True)

    data = _fetch_awc_data("metar", {
        "ids": station.upper(),
        "format": "json",
        "hours": hours,
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch METARs for {station}: {data.get('error')}")
        record_metar_api_request(success=False)
        return []

    if not isinstance(data, list):
        return []

    # Cache the results
    cache_metar(station, data, hours, ttl)
    return data


def fetch_and_cache_tafs(
    bbox: str = "24,-130,50,-60",
    ttl: int = 1800
) -> List[dict]:
    """
    Fetch TAFs from Aviation Weather Center and cache them.

    Args:
        bbox: Bounding box "min_lat,min_lon,max_lat,max_lon"
        ttl: Cache TTL in seconds (default 30 min)

    Returns:
        List of TAF data
    """
    cache_key = f"taf:bbox:{hashlib.md5(bbox.encode()).hexdigest()[:12]}"

    # Check cache first
    cached = cache.get(cache_key)
    if cached:
        return cached

    logger.info(f"Fetching TAFs from AWC (bbox={bbox})")

    data = _fetch_awc_data("taf", {
        "bbox": bbox,
        "format": "json",
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch TAFs: {data.get('error')}")
        return []

    if not isinstance(data, list):
        return []

    # Cache the results
    cache.set(cache_key, data, ttl)
    logger.info(f"Fetched and cached {len(data)} TAFs")

    return data


def record_metar_api_request(success: bool = True):
    """Record a METAR API request for stats tracking."""
    global _metar_stats
    _metar_stats["api_requests"] += 1
    _metar_stats["last_api_call"] = datetime.utcnow().isoformat()
    if not success:
        _metar_stats["api_errors"] += 1


# =============================================================================
# Generic Aviation Data Cache (airports, navaids, etc.)
# =============================================================================

def _make_aviation_cache_key(data_type: str, bbox: str) -> str:
    """Create a cache key for aviation data by type and bounding box."""
    bbox_hash = hashlib.md5(bbox.encode()).hexdigest()[:12]
    return f"aviation:{data_type}:{bbox_hash}"


def get_cached_aviation_data(data_type: str, bbox: str) -> Optional[list]:
    """
    Get cached aviation data (airports, navaids, etc.) from Redis.

    Args:
        data_type: Type of data (airports, navaids, pireps, metars)
        bbox: Bounding box string "lat1,lon1,lat2,lon2"

    Returns:
        Cached data list or None if not in cache
    """
    key = _make_aviation_cache_key(data_type, bbox)
    data = cache.get(key)

    if data:
        logger.debug(f"Cache hit for {data_type} bbox query")
        return data

    return None


def cache_aviation_data(data_type: str, bbox: str, data: list, ttl: int = 300) -> bool:
    """
    Cache aviation data in Redis.

    Args:
        data_type: Type of data (airports, navaids, pireps, metars)
        bbox: Bounding box string "lat1,lon1,lat2,lon2"
        data: Data to cache
        ttl: Time to live in seconds (default 5 minutes)

    Returns:
        True if cached successfully
    """
    key = _make_aviation_cache_key(data_type, bbox)
    cache.set(key, data, ttl)
    logger.debug(f"Cached {data_type} data (TTL: {ttl}s, {len(data)} items)")
    return True
