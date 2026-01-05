"""
Antenna Analytics Service.

Provides cached antenna performance metrics that are calculated periodically
and broadcast via Socket.IO for real-time dashboard updates.

Data includes:
- Polar coverage by bearing (reception pattern)
- RSSI vs distance correlation (signal strength analysis)
- Overall antenna performance summary
"""
import asyncio
import logging
import statistics
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AircraftSighting

logger = logging.getLogger(__name__)

# Cached analytics data
_antenna_cache = {
    "polar": None,
    "rssi": None,
    "summary": None,
    "last_updated": None,
}

# Background task handle
_refresh_task: Optional[asyncio.Task] = None

# Update interval in seconds (5 minutes)
UPDATE_INTERVAL = 300


async def calculate_polar_data(db: AsyncSession, hours: int = 24) -> dict:
    """Calculate antenna polar coverage data."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    conditions = [
        AircraftSighting.timestamp > cutoff,
        AircraftSighting.track.isnot(None),
        AircraftSighting.distance_nm.isnot(None),
    ]

    # Query for bearing-grouped data (36 sectors of 10 degrees each)
    bearing_query = (
        select(
            (func.floor(AircraftSighting.track / 10) * 10).label('bearing_sector'),
            func.count(AircraftSighting.id).label('count'),
            func.avg(AircraftSighting.rssi).label('avg_rssi'),
            func.min(AircraftSighting.rssi).label('min_rssi'),
            func.max(AircraftSighting.rssi).label('max_rssi'),
            func.avg(AircraftSighting.distance_nm).label('avg_distance'),
            func.max(AircraftSighting.distance_nm).label('max_distance'),
            func.count(func.distinct(AircraftSighting.icao_hex)).label('unique_aircraft'),
        )
        .where(and_(*conditions))
        .group_by(func.floor(AircraftSighting.track / 10) * 10)
        .order_by(func.floor(AircraftSighting.track / 10) * 10)
    )

    try:
        result = await db.execute(bearing_query)
        rows = result.all()
    except Exception as e:
        logger.error(f"Error calculating polar data: {e}")
        return {"bearing_data": [], "summary": {}}

    bearing_data = []
    total_count = 0
    sectors_with_data = 0

    for row in rows:
        sector = int(row.bearing_sector) if row.bearing_sector is not None else 0
        count = row.count or 0
        total_count += count
        if count > 0:
            sectors_with_data += 1

        bearing_data.append({
            "bearing_start": sector,
            "bearing_end": (sector + 10) % 360,
            "count": count,
            "avg_rssi": round(row.avg_rssi, 1) if row.avg_rssi else None,
            "min_rssi": round(row.min_rssi, 1) if row.min_rssi else None,
            "max_rssi": round(row.max_rssi, 1) if row.max_rssi else None,
            "avg_distance_nm": round(row.avg_distance, 1) if row.avg_distance else None,
            "max_distance_nm": round(row.max_distance, 1) if row.max_distance else None,
            "unique_aircraft": row.unique_aircraft or 0,
        })

    # Fill in missing sectors with zero data
    existing_sectors = {d['bearing_start'] for d in bearing_data}
    for sector in range(0, 360, 10):
        if sector not in existing_sectors:
            bearing_data.append({
                "bearing_start": sector,
                "bearing_end": (sector + 10) % 360,
                "count": 0,
                "avg_rssi": None,
                "min_rssi": None,
                "max_rssi": None,
                "avg_distance_nm": None,
                "max_distance_nm": None,
                "unique_aircraft": 0,
            })

    # Sort by bearing
    bearing_data.sort(key=lambda x: x['bearing_start'])

    return {
        "bearing_data": bearing_data,
        "summary": {
            "total_sightings": total_count,
            "sectors_with_data": sectors_with_data,
            "coverage_pct": round((sectors_with_data / 36) * 100, 1),
        },
        "time_range_hours": hours,
    }


async def calculate_rssi_data(
    db: AsyncSession, hours: int = 24, sample_size: int = 500
) -> dict:
    """Calculate RSSI vs distance correlation data."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    conditions = [
        AircraftSighting.timestamp > cutoff,
        AircraftSighting.rssi.isnot(None),
        AircraftSighting.distance_nm.isnot(None),
        AircraftSighting.distance_nm > 0,
    ]

    # Get sampled scatter data points
    scatter_query = (
        select(
            AircraftSighting.distance_nm,
            AircraftSighting.rssi,
            AircraftSighting.altitude_baro,
            AircraftSighting.icao_hex,
        )
        .where(and_(*conditions))
        .order_by(func.random())
        .limit(sample_size)
    )

    try:
        scatter_result = await db.execute(scatter_query)
        scatter_rows = scatter_result.all()
    except Exception as e:
        logger.error(f"Error fetching scatter data: {e}")
        scatter_rows = []

    scatter_data = []
    for row in scatter_rows:
        scatter_data.append({
            "distance_nm": round(row.distance_nm, 1),
            "rssi": round(row.rssi, 1),
            "altitude": row.altitude_baro,
            "icao": row.icao_hex,
        })

    # Get aggregated statistics by distance bands
    band_query = (
        select(
            case(
                (AircraftSighting.distance_nm < 25, '0-25nm'),
                (AircraftSighting.distance_nm < 50, '25-50nm'),
                (AircraftSighting.distance_nm < 75, '50-75nm'),
                (AircraftSighting.distance_nm < 100, '75-100nm'),
                (AircraftSighting.distance_nm < 150, '100-150nm'),
                else_='150+nm'
            ).label('distance_band'),
            func.count(AircraftSighting.id).label('count'),
            func.avg(AircraftSighting.rssi).label('avg_rssi'),
            func.min(AircraftSighting.rssi).label('min_rssi'),
            func.max(AircraftSighting.rssi).label('max_rssi'),
            func.avg(AircraftSighting.distance_nm).label('avg_distance'),
        )
        .where(and_(*conditions))
        .group_by('distance_band')
    )

    try:
        band_result = await db.execute(band_query)
        band_rows = band_result.all()
    except Exception as e:
        logger.error(f"Error fetching band data: {e}")
        band_rows = []

    band_statistics = []
    total_count = 0
    all_rssi = []

    for row in band_rows:
        count = row.count or 0
        total_count += count
        if row.avg_rssi:
            all_rssi.extend([row.avg_rssi] * min(count, 100))

        band_statistics.append({
            "band": row.distance_band,
            "count": count,
            "avg_rssi": round(row.avg_rssi, 1) if row.avg_rssi else None,
            "min_rssi": round(row.min_rssi, 1) if row.min_rssi else None,
            "max_rssi": round(row.max_rssi, 1) if row.max_rssi else None,
            "avg_distance_nm": round(row.avg_distance, 1) if row.avg_distance else None,
        })

    # Sort bands in order
    band_order = ['0-25nm', '25-50nm', '50-75nm', '75-100nm', '100-150nm', '150+nm']
    band_statistics.sort(
        key=lambda x: band_order.index(x['band']) if x['band'] in band_order else 99
    )

    # Calculate overall statistics
    overall_stats = {}
    if all_rssi:
        overall_stats = {
            "count": total_count,
            "avg_rssi": round(statistics.mean(all_rssi), 1),
            "median_rssi": round(statistics.median(all_rssi), 1),
        }

    # Calculate linear regression trend line
    trend_line = None
    if len(scatter_data) > 10:
        distances = [d['distance_nm'] for d in scatter_data]
        rssis = [d['rssi'] for d in scatter_data]
        n = len(distances)
        sum_x = sum(distances)
        sum_y = sum(rssis)
        sum_xy = sum(d * r for d, r in zip(distances, rssis))
        sum_x2 = sum(d ** 2 for d in distances)

        denom = n * sum_x2 - sum_x ** 2
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
                )
            }

    return {
        "scatter_data": scatter_data,
        "band_statistics": band_statistics,
        "overall_statistics": overall_stats,
        "trend_line": trend_line,
        "time_range_hours": hours,
        "sample_size": len(scatter_data),
    }


async def calculate_summary(db: AsyncSession, hours: int = 24) -> dict:
    """Calculate antenna performance summary."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    conditions = [
        AircraftSighting.timestamp > cutoff,
        AircraftSighting.distance_nm.isnot(None),
    ]

    # Get range statistics
    range_query = (
        select(
            func.count(AircraftSighting.id).label('total_sightings'),
            func.count(func.distinct(AircraftSighting.icao_hex)).label('unique_aircraft'),
            func.avg(AircraftSighting.distance_nm).label('avg_distance'),
            func.max(AircraftSighting.distance_nm).label('max_distance'),
            func.min(AircraftSighting.distance_nm).label('min_distance'),
        )
        .where(and_(*conditions))
    )

    try:
        range_result = await db.execute(range_query)
        range_stats = range_result.first()
    except Exception as e:
        logger.error(f"Error fetching range stats: {e}")
        range_stats = None

    # Get RSSI statistics
    rssi_conditions = conditions + [AircraftSighting.rssi.isnot(None)]
    rssi_query = (
        select(
            func.avg(AircraftSighting.rssi).label('avg_rssi'),
            func.min(AircraftSighting.rssi).label('min_rssi'),
            func.max(AircraftSighting.rssi).label('max_rssi'),
        )
        .where(and_(*rssi_conditions))
    )

    try:
        rssi_result = await db.execute(rssi_query)
        rssi_stats = rssi_result.first()
    except Exception as e:
        logger.error(f"Error fetching RSSI stats: {e}")
        rssi_stats = None

    # Get coverage by bearing
    coverage_query = (
        select(
            func.count(
                func.distinct(func.floor(AircraftSighting.track / 10))
            ).label('sectors_with_data')
        )
        .where(and_(*conditions, AircraftSighting.track.isnot(None)))
    )

    try:
        coverage_result = await db.execute(coverage_query)
        coverage_data = coverage_result.scalar() or 0
    except Exception as e:
        logger.error(f"Error fetching coverage: {e}")
        coverage_data = 0

    # Get distance percentiles
    dist_query = (
        select(AircraftSighting.distance_nm)
        .where(and_(*conditions))
        .order_by(AircraftSighting.distance_nm)
        .limit(10000)
    )

    percentiles = {}
    try:
        dist_result = await db.execute(dist_query)
        distances = [row.distance_nm for row in dist_result if row.distance_nm]
        if distances:
            sorted_dist = sorted(distances)
            n = len(sorted_dist)
            percentiles = {
                "p50": round(sorted_dist[n // 2], 1),
                "p75": round(sorted_dist[int(n * 0.75)], 1),
                "p90": round(sorted_dist[int(n * 0.90)], 1),
                "p95": round(sorted_dist[int(n * 0.95)], 1),
            }
    except Exception as e:
        logger.error(f"Error calculating percentiles: {e}")

    return {
        "range": {
            "total_sightings": range_stats.total_sightings if range_stats else 0,
            "unique_aircraft": range_stats.unique_aircraft if range_stats else 0,
            "avg_nm": (
                round(range_stats.avg_distance, 1)
                if range_stats and range_stats.avg_distance else None
            ),
            "max_nm": (
                round(range_stats.max_distance, 1)
                if range_stats and range_stats.max_distance else None
            ),
            "min_nm": (
                round(range_stats.min_distance, 1)
                if range_stats and range_stats.min_distance else None
            ),
            **percentiles,
        },
        "signal": {
            "avg_rssi": (
                round(rssi_stats.avg_rssi, 1)
                if rssi_stats and rssi_stats.avg_rssi else None
            ),
            "best_rssi": (
                round(rssi_stats.max_rssi, 1)
                if rssi_stats and rssi_stats.max_rssi else None
            ),
            "worst_rssi": (
                round(rssi_stats.min_rssi, 1)
                if rssi_stats and rssi_stats.min_rssi else None
            ),
        },
        "coverage": {
            "sectors_active": coverage_data or 0,
            "total_sectors": 36,
            "coverage_pct": round((coverage_data or 0) / 36 * 100, 1),
        },
        "time_range_hours": hours,
    }


async def refresh_cache(session_factory) -> None:
    """Refresh all antenna analytics cache."""
    logger.debug("Refreshing antenna analytics cache...")
    start = datetime.utcnow()

    try:
        async with session_factory() as db:
            # Calculate all metrics
            polar = await calculate_polar_data(db)
            rssi = await calculate_rssi_data(db)
            summary = await calculate_summary(db)

            # Update cache
            _antenna_cache["polar"] = polar
            _antenna_cache["rssi"] = rssi
            _antenna_cache["summary"] = summary
            _antenna_cache["last_updated"] = datetime.utcnow().isoformat() + "Z"

        duration = (datetime.utcnow() - start).total_seconds()
        logger.debug(f"Antenna analytics cache refreshed in {duration:.2f}s")

        # Broadcast update via Socket.IO
        await broadcast_antenna_update()

    except Exception as e:
        logger.error(f"Error refreshing antenna cache: {e}")


async def broadcast_antenna_update():
    """Broadcast antenna analytics update via Socket.IO."""
    try:
        from app.services.socketio_manager import get_socketio_manager

        sio_manager = get_socketio_manager()
        if sio_manager:
            await sio_manager.broadcast_antenna_analytics(get_cached_data())
            logger.debug("Antenna analytics broadcast sent")
    except Exception as e:
        logger.error(f"Error broadcasting antenna analytics: {e}")


def get_cached_data() -> dict:
    """Get all cached antenna analytics data."""
    return {
        "polar": _antenna_cache.get("polar"),
        "rssi": _antenna_cache.get("rssi"),
        "summary": _antenna_cache.get("summary"),
        "last_updated": _antenna_cache.get("last_updated"),
    }


def get_cached_polar() -> Optional[dict]:
    """Get cached polar data."""
    return _antenna_cache.get("polar")


def get_cached_rssi() -> Optional[dict]:
    """Get cached RSSI data."""
    return _antenna_cache.get("rssi")


def get_cached_summary() -> Optional[dict]:
    """Get cached summary."""
    return _antenna_cache.get("summary")


async def _refresh_loop(session_factory):
    """Background task to periodically refresh antenna analytics."""
    logger.info(f"Antenna analytics refresh loop started (interval: {UPDATE_INTERVAL}s)")

    while True:
        try:
            await refresh_cache(session_factory)
        except asyncio.CancelledError:
            logger.info("Antenna analytics refresh loop cancelled")
            raise
        except Exception as e:
            logger.error(f"Error in antenna analytics refresh: {e}")

        await asyncio.sleep(UPDATE_INTERVAL)


async def start_refresh_task(session_factory) -> asyncio.Task:
    """Start the background refresh task."""
    global _refresh_task

    # Do an initial refresh
    await refresh_cache(session_factory)

    # Start periodic refresh
    _refresh_task = asyncio.create_task(_refresh_loop(session_factory))
    return _refresh_task


async def stop_refresh_task():
    """Stop the background refresh task."""
    global _refresh_task

    if _refresh_task:
        _refresh_task.cancel()
        try:
            await _refresh_task
        except asyncio.CancelledError:
            pass
        _refresh_task = None
        logger.info("Antenna analytics refresh task stopped")
