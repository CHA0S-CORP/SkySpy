"""
Antenna Analytics Service.

Provides cached antenna performance metrics:
- Polar coverage by bearing (reception pattern)
- RSSI vs distance correlation (signal strength analysis)
- Overall antenna performance summary

Works with the Celery task for periodic updates and provides
real-time cache access for API/WebSocket consumers.
"""

import logging
import statistics
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import Avg, Count, Max, Min
from django.utils import timezone

from skyspy.models import AircraftSighting
from skyspy.services.law_enforcement_db import calculate_bearing

logger = logging.getLogger(__name__)

# Cache keys
CACHE_KEY_POLAR = "antenna_polar"
CACHE_KEY_RSSI = "antenna_rssi"
CACHE_KEY_SUMMARY = "antenna_summary"
CACHE_KEY_LAST_UPDATED = "antenna_last_updated"

# Cache timeout (10 minutes)
CACHE_TIMEOUT = 600


def _sighting_sector(lat: float, lon: float) -> int:
    """Get the 10-degree sector index (0-35) for the bearing from the receiver to a position."""
    bearing = calculate_bearing(settings.FEEDER_LAT, settings.FEEDER_LON, lat, lon)
    return int(bearing // 10) % 36


def calculate_polar_data(hours: int = 24) -> dict:
    """
    Calculate antenna polar coverage data.

    Returns bearing-grouped data (36 sectors of 10 degrees each).
    Sectors are bucketed by the bearing from the receiver (FEEDER_LAT/LON) to the
    aircraft position — NOT by the aircraft's own heading (track).
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    sightings = AircraftSighting.objects.filter(
        timestamp__gte=cutoff,
        latitude__isnull=False,
        longitude__isnull=False,
        distance_nm__isnull=False,
    )

    # Per-sector accumulators
    sector_stats = [
        {
            "count": 0,
            "rssi_sum": 0.0,
            "rssi_count": 0,
            "min_rssi": None,
            "max_rssi": None,
            "distance_sum": 0.0,
            "max_distance": None,
            "aircraft": set(),
        }
        for _ in range(36)
    ]
    total_count = 0

    rows = sightings.values_list("latitude", "longitude", "rssi", "distance_nm", "icao_hex").iterator()
    for lat, lon, rssi, distance_nm, icao_hex in rows:
        stats = sector_stats[_sighting_sector(lat, lon)]
        stats["count"] += 1
        total_count += 1
        stats["distance_sum"] += distance_nm
        if stats["max_distance"] is None or distance_nm > stats["max_distance"]:
            stats["max_distance"] = distance_nm
        if rssi is not None:
            stats["rssi_sum"] += rssi
            stats["rssi_count"] += 1
            if stats["min_rssi"] is None or rssi < stats["min_rssi"]:
                stats["min_rssi"] = rssi
            if stats["max_rssi"] is None or rssi > stats["max_rssi"]:
                stats["max_rssi"] = rssi
        stats["aircraft"].add(icao_hex)

    bearing_data = []
    sectors_with_data = 0

    for sector in range(0, 360, 10):
        stats = sector_stats[sector // 10]
        count = stats["count"]
        if count > 0:
            sectors_with_data += 1

        bearing_data.append(
            {
                "bearing_start": sector,
                "bearing_end": (sector + 10) % 360,
                "count": count,
                "avg_rssi": round(stats["rssi_sum"] / stats["rssi_count"], 1) if stats["rssi_count"] else None,
                "min_rssi": round(stats["min_rssi"], 1) if stats["min_rssi"] is not None else None,
                "max_rssi": round(stats["max_rssi"], 1) if stats["max_rssi"] is not None else None,
                "avg_distance_nm": round(stats["distance_sum"] / count, 1) if count else None,
                "max_distance_nm": round(stats["max_distance"], 1) if stats["max_distance"] is not None else None,
                "unique_aircraft": len(stats["aircraft"]),
            }
        )

    return {
        "bearing_data": bearing_data,
        "summary": {
            "total_sightings": total_count,
            "sectors_with_data": sectors_with_data,
            "coverage_pct": round((sectors_with_data / 36) * 100, 1),
        },
        "time_range_hours": hours,
    }


def calculate_rssi_data(hours: int = 24, sample_size: int = 500) -> dict:
    """
    Calculate RSSI vs distance correlation data.

    Returns scatter data and band statistics for signal analysis.
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    base_queryset = AircraftSighting.objects.filter(
        timestamp__gte=cutoff, rssi__isnull=False, distance_nm__isnull=False, distance_nm__gt=0
    )

    if not base_queryset.exists():
        return {
            "scatter_data": [],
            "band_statistics": [],
            "overall_statistics": {},
            "trend_line": None,
            "time_range_hours": hours,
            "sample_size": 0,
        }

    # Get sampled scatter data points - use deterministic ordering to avoid full table scan
    scatter_queryset = base_queryset.order_by("-timestamp")[:sample_size]
    scatter_data = []
    for row in scatter_queryset.values("distance_nm", "rssi", "altitude_baro", "icao_hex"):
        scatter_data.append(
            {
                "distance_nm": round(row["distance_nm"], 1),
                "rssi": round(row["rssi"], 1),
                "altitude": row["altitude_baro"],
                "icao": row["icao_hex"],
            }
        )

    # Get aggregated statistics by distance bands
    band_definitions = [
        ("0-25nm", 0, 25),
        ("25-50nm", 25, 50),
        ("50-75nm", 50, 75),
        ("75-100nm", 75, 100),
        ("100-150nm", 100, 150),
        ("150+nm", 150, 10000),
    ]

    band_statistics = []
    total_count = 0

    for band_name, min_dist, max_dist in band_definitions:
        band_queryset = base_queryset.filter(distance_nm__gte=min_dist, distance_nm__lt=max_dist)

        stats = band_queryset.aggregate(
            count=Count("id"),
            avg_rssi=Avg("rssi"),
            min_rssi=Min("rssi"),
            max_rssi=Max("rssi"),
            avg_distance=Avg("distance_nm"),
        )

        count = stats["count"] or 0
        total_count += count

        band_statistics.append(
            {
                "band": band_name,
                "count": count,
                "avg_rssi": round(stats["avg_rssi"], 1) if stats["avg_rssi"] else None,
                "min_rssi": round(stats["min_rssi"], 1) if stats["min_rssi"] else None,
                "max_rssi": round(stats["max_rssi"], 1) if stats["max_rssi"] else None,
                "avg_distance_nm": round(stats["avg_distance"], 1) if stats["avg_distance"] else None,
            }
        )

    # Calculate overall statistics from actual RSSI samples
    # (band means duplicated per-band would skew the median toward band averages)
    sample_rssi = [d["rssi"] for d in scatter_data]
    overall_stats = {}
    if sample_rssi:
        overall_stats = {
            "count": total_count,
            "avg_rssi": round(statistics.mean(sample_rssi), 1),
            "median_rssi": round(statistics.median(sample_rssi), 1),
        }

    # Calculate linear regression trend line
    trend_line = None
    if len(scatter_data) > 10:
        distances = [d["distance_nm"] for d in scatter_data]
        rssis = [d["rssi"] for d in scatter_data]
        n = len(distances)
        sum_x = sum(distances)
        sum_y = sum(rssis)
        sum_xy = sum(d * r for d, r in zip(distances, rssis, strict=False))
        sum_x2 = sum(d**2 for d in distances)

        denom = n * sum_x2 - sum_x**2
        if denom != 0:
            slope = (n * sum_xy - sum_x * sum_y) / denom
            intercept = (sum_y - slope * sum_x) / n
            trend_line = {
                "slope": round(slope, 4),
                "intercept": round(intercept, 2),
                "interpretation": (
                    f"RSSI decreases by {abs(round(slope * 10, 2))} dB per 10nm"
                    if slope < 0
                    else f"RSSI increases by {round(slope * 10, 2)} dB per 10nm"
                ),
            }

    return {
        "scatter_data": scatter_data,
        "band_statistics": band_statistics,
        "overall_statistics": overall_stats,
        "trend_line": trend_line,
        "time_range_hours": hours,
        "sample_size": len(scatter_data),
    }


def calculate_summary(hours: int = 24) -> dict:
    """Calculate antenna performance summary."""
    cutoff = timezone.now() - timedelta(hours=hours)

    base_queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff, distance_nm__isnull=False)

    if not base_queryset.exists():
        return {
            "range": {
                "total_sightings": 0,
                "unique_aircraft": 0,
                "avg_nm": None,
                "max_nm": None,
                "min_nm": None,
            },
            "signal": {
                "avg_rssi": None,
                "best_rssi": None,
                "worst_rssi": None,
            },
            "coverage": {
                "sectors_active": 0,
                "total_sectors": 36,
                "coverage_pct": 0,
            },
            "time_range_hours": hours,
        }

    # Get range statistics
    range_stats = base_queryset.aggregate(
        total_sightings=Count("id"),
        unique_aircraft=Count("icao_hex", distinct=True),
        avg_distance=Avg("distance_nm"),
        max_distance=Max("distance_nm"),
        min_distance=Min("distance_nm"),
    )

    # Get RSSI statistics
    rssi_stats = base_queryset.filter(rssi__isnull=False).aggregate(
        avg_rssi=Avg("rssi"),
        min_rssi=Min("rssi"),
        max_rssi=Max("rssi"),
    )

    # Get coverage by bearing from the receiver to each position (count distinct 10-degree sectors)
    active_sectors = set()
    position_rows = (
        base_queryset.filter(latitude__isnull=False, longitude__isnull=False)
        .values_list("latitude", "longitude")
        .iterator()
    )
    for lat, lon in position_rows:
        active_sectors.add(_sighting_sector(lat, lon))
    sectors_with_data = len(active_sectors)

    # Calculate percentiles
    percentiles = {}
    distances = list(base_queryset.values_list("distance_nm", flat=True)[:10000])
    if distances:
        sorted_dist = sorted(d for d in distances if d is not None)
        n = len(sorted_dist)
        if n > 0:
            percentiles = {
                "p50": round(sorted_dist[n // 2], 1),
                "p75": round(sorted_dist[int(n * 0.75)], 1),
                "p90": round(sorted_dist[int(n * 0.90)], 1),
                "p95": round(sorted_dist[min(int(n * 0.95), n - 1)], 1),
            }

    return {
        "range": {
            "total_sightings": range_stats["total_sightings"] or 0,
            "unique_aircraft": range_stats["unique_aircraft"] or 0,
            "avg_nm": round(range_stats["avg_distance"], 1) if range_stats["avg_distance"] else None,
            "max_nm": round(range_stats["max_distance"], 1) if range_stats["max_distance"] else None,
            "min_nm": round(range_stats["min_distance"], 1) if range_stats["min_distance"] else None,
            **percentiles,
        },
        "signal": {
            "avg_rssi": round(rssi_stats["avg_rssi"], 1) if rssi_stats["avg_rssi"] else None,
            "best_rssi": round(rssi_stats["max_rssi"], 1) if rssi_stats["max_rssi"] else None,
            "worst_rssi": round(rssi_stats["min_rssi"], 1) if rssi_stats["min_rssi"] else None,
        },
        "coverage": {
            "sectors_active": sectors_with_data,
            "total_sectors": 36,
            "coverage_pct": round((sectors_with_data / 36) * 100, 1),
        },
        "time_range_hours": hours,
    }


def refresh_cache(hours: int = 24) -> dict:
    """
    Refresh all antenna analytics cache.

    Returns the complete analytics data.
    """
    logger.debug("Refreshing antenna analytics cache...")
    start = datetime.now()

    try:
        polar = calculate_polar_data(hours)
        rssi = calculate_rssi_data(hours)
        summary = calculate_summary(hours)
        last_updated = timezone.now().isoformat().replace("+00:00", "Z")

        # Update cache
        cache.set(CACHE_KEY_POLAR, polar, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_RSSI, rssi, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_SUMMARY, summary, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_LAST_UPDATED, last_updated, timeout=CACHE_TIMEOUT)

        duration = (datetime.now() - start).total_seconds()
        logger.debug(f"Antenna analytics cache refreshed in {duration:.2f}s")

        return {
            "polar": polar,
            "rssi": rssi,
            "summary": summary,
            "last_updated": last_updated,
        }

    except Exception as e:  # broad: cache-refresh degradation boundary (tested)
        logger.error(f"Error refreshing antenna cache: {e}")
        return {}


def broadcast_antenna_update(data: dict = None):
    """Broadcast antenna analytics update via WebSocket."""
    from skyspy.socketio.utils import sync_emit

    try:
        if data is None:
            data = get_cached_data()

        sync_emit("stats:update", {"stat_type": "antenna_analytics", "stats": data}, room="topic_stats")
        logger.debug("Antenna analytics broadcast sent")
    except Exception as e:  # broad: Socket.IO broadcast must never raise into callers; failure modes opaque
        logger.error(f"Error broadcasting antenna analytics: {e}")


def get_cached_data() -> dict:
    """Get all cached antenna analytics data."""
    return {
        "polar": cache.get(CACHE_KEY_POLAR),
        "rssi": cache.get(CACHE_KEY_RSSI),
        "summary": cache.get(CACHE_KEY_SUMMARY),
        "last_updated": cache.get(CACHE_KEY_LAST_UPDATED),
    }


def get_cached_polar() -> dict | None:
    """Get cached polar data."""
    return cache.get(CACHE_KEY_POLAR)


def get_cached_rssi() -> dict | None:
    """Get cached RSSI data."""
    return cache.get(CACHE_KEY_RSSI)


def get_cached_summary() -> dict | None:
    """Get cached summary."""
    return cache.get(CACHE_KEY_SUMMARY)


def get_or_calculate_polar(hours: int = 24) -> dict:
    """Get cached polar data or calculate if not available."""
    cached = get_cached_polar()
    if cached and cached.get("time_range_hours") == hours:
        return cached
    return calculate_polar_data(hours)


def get_or_calculate_rssi(hours: int = 24, sample_size: int = 500) -> dict:
    """Get cached RSSI data or calculate if not available."""
    cached = get_cached_rssi()
    if cached and cached.get("time_range_hours") == hours:
        return cached
    return calculate_rssi_data(hours, sample_size)


def get_or_calculate_summary(hours: int = 24) -> dict:
    """Get cached summary or calculate if not available."""
    cached = get_cached_summary()
    if cached and cached.get("time_range_hours") == hours:
        return cached
    return calculate_summary(hours)
