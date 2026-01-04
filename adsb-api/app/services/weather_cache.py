"""
Weather data caching service.

Provides Redis caching for METAR data and database storage for PIREPs.
"""
import hashlib
import json
import logging
import time
from datetime import datetime
from typing import Optional

from prometheus_client import Counter, Gauge, Histogram
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CachedPirep

settings = get_settings()
logger = logging.getLogger(__name__)

# Redis client (lazy initialization)
_redis_client = None

# =============================================================================
# Prometheus Metrics
# =============================================================================

METAR_CACHE_HITS = Counter(
    "skyspy_metar_cache_hits_total",
    "Total METAR cache hits",
    ["cache_type"]  # station, bbox
)
METAR_CACHE_MISSES = Counter(
    "skyspy_metar_cache_misses_total",
    "Total METAR cache misses",
    ["cache_type"]
)
METAR_CACHE_STORES = Counter(
    "skyspy_metar_cache_stores_total",
    "Total METAR cache store operations",
    ["cache_type"]
)
METAR_API_REQUESTS = Counter(
    "skyspy_metar_api_requests_total",
    "Total METAR API requests made",
    ["status"]  # success, error
)

PIREP_STORED = Counter(
    "skyspy_pirep_stored_total",
    "Total PIREPs stored in database"
)
PIREP_DUPLICATES = Counter(
    "skyspy_pirep_duplicates_total",
    "Total duplicate PIREPs skipped"
)
PIREP_QUERIES = Counter(
    "skyspy_pirep_queries_total",
    "Total PIREP database queries"
)
PIREP_CACHE_TOTAL = Gauge(
    "skyspy_pirep_cache_total",
    "Total PIREPs in database cache"
)
PIREP_CACHE_RECENT = Gauge(
    "skyspy_pirep_cache_recent",
    "PIREPs in last 6 hours"
)
PIREP_TURBULENCE_REPORTS = Gauge(
    "skyspy_pirep_turbulence_reports",
    "Turbulence reports in last 6 hours"
)
PIREP_ICING_REPORTS = Gauge(
    "skyspy_pirep_icing_reports",
    "Icing reports in last 6 hours"
)

REDIS_OPERATIONS = Counter(
    "skyspy_redis_operations_total",
    "Total Redis operations",
    ["operation", "status"]  # get/set, success/error
)
REDIS_LATENCY = Histogram(
    "skyspy_redis_latency_seconds",
    "Redis operation latency",
    ["operation"],
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5]
)

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


async def get_redis():
    """Get Redis client, initializing if needed."""
    global _redis_client
    if _redis_client is None and settings.redis_enabled and settings.redis_url:
        try:
            import redis.asyncio as redis
            _redis_client = redis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            # Test connection
            await _redis_client.ping()
            logger.info("Redis connection established for weather cache")
        except Exception as e:
            logger.warning(f"Failed to connect to Redis: {e}")
            _redis_client = None
    return _redis_client


# =============================================================================
# METAR Redis Cache
# =============================================================================

def _make_metar_key(station: str, hours: int = 2) -> str:
    """Create a cache key for METAR data."""
    return f"metar:{station.upper()}:{hours}"


def _make_metar_bbox_key(bbox: str, hours: int = 2) -> str:
    """Create a cache key for METAR bbox query."""
    bbox_hash = hashlib.md5(bbox.encode()).hexdigest()[:12]
    return f"metar:bbox:{bbox_hash}:{hours}"


async def get_cached_metar(station: str, hours: int = 2) -> Optional[list]:
    """Get cached METAR data for a station from Redis."""
    global _metar_stats
    redis = await get_redis()
    if not redis:
        METAR_CACHE_MISSES.labels(cache_type="station").inc()
        _metar_stats["cache_misses"] += 1
        return None

    start_time = time.time()
    try:
        key = _make_metar_key(station, hours)
        data = await redis.get(key)
        latency = time.time() - start_time
        REDIS_LATENCY.labels(operation="get").observe(latency)
        REDIS_OPERATIONS.labels(operation="get", status="success").inc()

        if data:
            logger.debug(f"Redis cache hit for METAR {station}")
            METAR_CACHE_HITS.labels(cache_type="station").inc()
            _metar_stats["cache_hits"] += 1
            return json.loads(data)
        else:
            METAR_CACHE_MISSES.labels(cache_type="station").inc()
            _metar_stats["cache_misses"] += 1
    except Exception as e:
        REDIS_OPERATIONS.labels(operation="get", status="error").inc()
        logger.warning(f"Redis get error for METAR {station}: {e}")
        METAR_CACHE_MISSES.labels(cache_type="station").inc()
        _metar_stats["cache_misses"] += 1

    return None


async def cache_metar(station: str, data: list, hours: int = 2, ttl: int = 300) -> bool:
    """Cache METAR data for a station in Redis."""
    redis = await get_redis()
    if not redis:
        return False

    start_time = time.time()
    try:
        key = _make_metar_key(station, hours)
        await redis.setex(key, ttl, json.dumps(data))
        latency = time.time() - start_time
        REDIS_LATENCY.labels(operation="set").observe(latency)
        REDIS_OPERATIONS.labels(operation="set", status="success").inc()
        METAR_CACHE_STORES.labels(cache_type="station").inc()
        logger.debug(f"Cached METAR {station} in Redis (TTL: {ttl}s)")
        return True
    except Exception as e:
        REDIS_OPERATIONS.labels(operation="set", status="error").inc()
        logger.warning(f"Redis set error for METAR {station}: {e}")
        return False


async def get_cached_metars_bbox(bbox: str, hours: int = 2) -> Optional[list]:
    """Get cached METAR data for a bounding box from Redis."""
    global _metar_stats
    redis = await get_redis()
    if not redis:
        METAR_CACHE_MISSES.labels(cache_type="bbox").inc()
        _metar_stats["cache_misses"] += 1
        return None

    start_time = time.time()
    try:
        key = _make_metar_bbox_key(bbox, hours)
        data = await redis.get(key)
        latency = time.time() - start_time
        REDIS_LATENCY.labels(operation="get").observe(latency)
        REDIS_OPERATIONS.labels(operation="get", status="success").inc()

        if data:
            logger.debug(f"Redis cache hit for METAR bbox query")
            METAR_CACHE_HITS.labels(cache_type="bbox").inc()
            _metar_stats["cache_hits"] += 1
            return json.loads(data)
        else:
            METAR_CACHE_MISSES.labels(cache_type="bbox").inc()
            _metar_stats["cache_misses"] += 1
    except Exception as e:
        REDIS_OPERATIONS.labels(operation="get", status="error").inc()
        logger.warning(f"Redis get error for METAR bbox: {e}")
        METAR_CACHE_MISSES.labels(cache_type="bbox").inc()
        _metar_stats["cache_misses"] += 1

    return None


async def cache_metars_bbox(bbox: str, data: list, hours: int = 2, ttl: int = 300) -> bool:
    """Cache METAR bbox results in Redis."""
    redis = await get_redis()
    if not redis:
        return False

    start_time = time.time()
    try:
        key = _make_metar_bbox_key(bbox, hours)
        await redis.setex(key, ttl, json.dumps(data))
        latency = time.time() - start_time
        REDIS_LATENCY.labels(operation="set").observe(latency)
        REDIS_OPERATIONS.labels(operation="set", status="success").inc()
        METAR_CACHE_STORES.labels(cache_type="bbox").inc()
        logger.debug(f"Cached METAR bbox results in Redis (TTL: {ttl}s)")
        return True
    except Exception as e:
        REDIS_OPERATIONS.labels(operation="set", status="error").inc()
        logger.warning(f"Redis set error for METAR bbox: {e}")
        return False


# =============================================================================
# PIREP Database Storage
# =============================================================================

def _generate_pirep_id(pirep: dict) -> str:
    """Generate a unique ID for a PIREP based on its content."""
    # Combine key fields to create a unique identifier
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


async def store_pirep(db: AsyncSession, pirep: dict) -> Optional[int]:
    """Store a single PIREP in the database."""
    global _pirep_stats
    pirep_id = _generate_pirep_id(pirep)

    # Check if already exists
    result = await db.execute(
        select(CachedPirep).where(CachedPirep.pirep_id == pirep_id)
    )
    if result.scalar_one_or_none():
        PIREP_DUPLICATES.inc()
        _pirep_stats["duplicates"] += 1
        return None  # Already exists

    try:
        cached_pirep = CachedPirep(
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
        db.add(cached_pirep)
        await db.flush()
        PIREP_STORED.inc()
        _pirep_stats["stored"] += 1
        _pirep_stats["last_store"] = datetime.utcnow().isoformat()
        return cached_pirep.id
    except Exception as e:
        logger.error(f"Failed to store PIREP: {e}")
        return None


async def store_pireps(db: AsyncSession, pireps: list) -> int:
    """Store multiple PIREPs in the database."""
    if not pireps:
        return 0

    stored_count = 0
    for pirep in pireps:
        try:
            result = await store_pirep(db, pirep)
            if result:
                stored_count += 1
        except Exception as e:
            logger.warning(f"Failed to store PIREP: {e}")
            continue

    if stored_count > 0:
        await db.commit()
        logger.info(f"Stored {stored_count} new PIREPs in database")

    return stored_count


async def get_cached_pireps(
    db: AsyncSession,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    hours: int = 6,
    limit: int = 100
) -> list:
    """Get PIREPs from the database cache."""
    global _pirep_stats
    from datetime import timedelta
    from math import radians, sin, cos, sqrt, atan2

    PIREP_QUERIES.inc()
    _pirep_stats["queries"] += 1

    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Build query
    query = select(CachedPirep).where(
        CachedPirep.observation_time >= cutoff
    )

    # Add bounding box filter if location specified
    if lat is not None and lon is not None:
        deg_offset = radius_nm / 60.0
        query = query.where(
            CachedPirep.latitude >= lat - deg_offset,
            CachedPirep.latitude <= lat + deg_offset,
            CachedPirep.longitude >= lon - deg_offset,
            CachedPirep.longitude <= lon + deg_offset,
        )

    query = query.order_by(CachedPirep.observation_time.desc()).limit(limit * 2)

    result = await db.execute(query)
    pireps = result.scalars().all()

    # Convert to dict and calculate distances
    def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 3440.065  # Earth radius in NM
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        return 2 * R * atan2(sqrt(a), sqrt(1-a))

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


async def cleanup_old_pireps(db: AsyncSession, retention_hours: int = 24) -> int:
    """Remove PIREPs older than retention period."""
    from datetime import timedelta

    cutoff = datetime.utcnow() - timedelta(hours=retention_hours)

    result = await db.execute(
        delete(CachedPirep).where(CachedPirep.observation_time < cutoff)
    )
    await db.commit()

    deleted = result.rowcount
    if deleted > 0:
        logger.info(f"Cleaned up {deleted} old PIREPs")

    return deleted


async def get_historical_pireps(
    db: AsyncSession,
    start_time: datetime,
    end_time: datetime,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    turbulence_only: bool = False,
    icing_only: bool = False,
    limit: int = 500
) -> list:
    """Get historical PIREPs from the database within a time range."""
    global _pirep_stats
    from math import radians, sin, cos, sqrt, atan2

    PIREP_QUERIES.inc()
    _pirep_stats["queries"] += 1

    # Build query with time range filter
    query = select(CachedPirep).where(
        CachedPirep.observation_time >= start_time,
        CachedPirep.observation_time <= end_time
    )

    # Add bounding box filter if location specified
    if lat is not None and lon is not None:
        deg_offset = radius_nm / 60.0
        query = query.where(
            CachedPirep.latitude >= lat - deg_offset,
            CachedPirep.latitude <= lat + deg_offset,
            CachedPirep.longitude >= lon - deg_offset,
            CachedPirep.longitude <= lon + deg_offset,
        )

    # Filter by condition type
    if turbulence_only:
        query = query.where(CachedPirep.turbulence_type.isnot(None))
    if icing_only:
        query = query.where(CachedPirep.icing_type.isnot(None))

    query = query.order_by(CachedPirep.observation_time.desc()).limit(limit * 2)

    result = await db.execute(query)
    pireps = result.scalars().all()

    # Convert to dict and calculate distances
    def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 3440.065  # Earth radius in NM
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        return 2 * R * atan2(sqrt(a), sqrt(1-a))

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


async def get_pirep_stats(db: AsyncSession) -> dict:
    """Get statistics about cached PIREPs."""
    from sqlalchemy import func
    from datetime import timedelta

    now = datetime.utcnow()

    # Total count
    total_result = await db.execute(select(func.count(CachedPirep.id)))
    total = total_result.scalar() or 0

    # Last 6 hours
    cutoff_6h = now - timedelta(hours=6)
    recent_result = await db.execute(
        select(func.count(CachedPirep.id)).where(CachedPirep.observation_time >= cutoff_6h)
    )
    recent = recent_result.scalar() or 0

    # Latest PIREP time
    latest_result = await db.execute(
        select(func.max(CachedPirep.fetched_at))
    )
    latest = latest_result.scalar()

    # Count by type
    turb_result = await db.execute(
        select(func.count(CachedPirep.id)).where(
            CachedPirep.observation_time >= cutoff_6h,
            CachedPirep.turbulence_type.isnot(None)
        )
    )
    turb_count = turb_result.scalar() or 0

    ice_result = await db.execute(
        select(func.count(CachedPirep.id)).where(
            CachedPirep.observation_time >= cutoff_6h,
            CachedPirep.icing_type.isnot(None)
        )
    )
    ice_count = ice_result.scalar() or 0

    # Update Prometheus Gauges
    PIREP_CACHE_TOTAL.set(total)
    PIREP_CACHE_RECENT.set(recent)
    PIREP_TURBULENCE_REPORTS.set(turb_count)
    PIREP_ICING_REPORTS.set(ice_count)

    return {
        "total_pireps": total,
        "pireps_last_6h": recent,
        "turbulence_reports_6h": turb_count,
        "icing_reports_6h": ice_count,
        "last_fetch": latest.isoformat() if latest else None,
        # Include runtime stats
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


def record_metar_api_request(success: bool = True):
    """Record a METAR API request for stats tracking."""
    global _metar_stats
    _metar_stats["api_requests"] += 1
    _metar_stats["last_api_call"] = datetime.utcnow().isoformat()
    if success:
        METAR_API_REQUESTS.labels(status="success").inc()
    else:
        METAR_API_REQUESTS.labels(status="error").inc()
        _metar_stats["api_errors"] += 1


# =============================================================================
# Generic Aviation Data Cache (airports, navaids, etc.)
# =============================================================================

def _make_aviation_cache_key(data_type: str, bbox: str) -> str:
    """Create a cache key for aviation data by type and bounding box."""
    bbox_hash = hashlib.md5(bbox.encode()).hexdigest()[:12]
    return f"aviation:{data_type}:{bbox_hash}"


async def get_cached_aviation_data(data_type: str, bbox: str) -> Optional[list]:
    """
    Get cached aviation data (airports, navaids, etc.) from Redis.

    Args:
        data_type: Type of data (airports, navaids, pireps, metars)
        bbox: Bounding box string "lat1,lon1,lat2,lon2"

    Returns:
        Cached data list or None if not in cache
    """
    redis = await get_redis()
    if not redis:
        return None

    start_time = time.time()
    try:
        key = _make_aviation_cache_key(data_type, bbox)
        data = await redis.get(key)
        latency = time.time() - start_time
        REDIS_LATENCY.labels(operation="get").observe(latency)
        REDIS_OPERATIONS.labels(operation="get", status="success").inc()

        if data:
            logger.debug(f"Redis cache hit for {data_type} bbox query")
            return json.loads(data)
    except Exception as e:
        REDIS_OPERATIONS.labels(operation="get", status="error").inc()
        logger.warning(f"Redis get error for {data_type}: {e}")

    return None


async def cache_aviation_data(data_type: str, bbox: str, data: list, ttl: int = 300) -> bool:
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
    redis = await get_redis()
    if not redis:
        return False

    start_time = time.time()
    try:
        key = _make_aviation_cache_key(data_type, bbox)
        await redis.setex(key, ttl, json.dumps(data))
        latency = time.time() - start_time
        REDIS_LATENCY.labels(operation="set").observe(latency)
        REDIS_OPERATIONS.labels(operation="set", status="success").inc()
        logger.debug(f"Cached {data_type} data in Redis (TTL: {ttl}s, {len(data)} items)")
        return True
    except Exception as e:
        REDIS_OPERATIONS.labels(operation="set", status="error").inc()
        logger.warning(f"Redis set error for {data_type}: {e}")
        return False
