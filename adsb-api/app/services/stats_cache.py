"""
Stats Cache Service.

Provides cached statistics that are calculated periodically in background jobs
and served immediately to clients. Stats are broadcast via Socket.IO when updated.

Cached Stats:
- Aircraft stats (current aircraft breakdown)
- Top aircraft (closest, highest, fastest, etc.)
- History stats (aggregate historical data)
- History trends (time-series data)
- Safety stats (event summaries)

Update Intervals:
- Aircraft stats: 5 seconds (synced with polling)
- History stats: 60 seconds
- Safety stats: 30 seconds
"""
import asyncio
import logging
import statistics as pystats
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_, case, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import (
    get_settings, calculate_distance_nm, is_valid_position, simplify_aircraft,
    db_execute_safe
)
from app.models import AircraftSighting, AircraftSession, SafetyEvent
from app.services.safety import safety_monitor

logger = logging.getLogger(__name__)
settings = get_settings()

# Cache storage
_stats_cache = {
    # Aircraft stats (real-time)
    "aircraft_stats": None,
    "aircraft_stats_updated": None,

    # Top aircraft (real-time)
    "top_aircraft": None,
    "top_aircraft_updated": None,

    # History stats (less frequent)
    "history_stats": None,
    "history_stats_updated": None,

    # History trends (less frequent)
    "history_trends": None,
    "history_trends_updated": None,

    # History top performers
    "history_top": None,
    "history_top_updated": None,

    # Safety stats
    "safety_stats": None,
    "safety_stats_updated": None,
}

# Background task handles
_refresh_tasks: dict[str, Optional[asyncio.Task]] = {
    "aircraft": None,
    "history": None,
    "safety": None,
}

# Update intervals in seconds
AIRCRAFT_STATS_INTERVAL = 5  # Match polling frequency
HISTORY_STATS_INTERVAL = 60  # Once per minute
SAFETY_STATS_INTERVAL = 30   # Every 30 seconds


# =============================================================================
# Aircraft Stats Calculation
# =============================================================================

def calculate_aircraft_stats(aircraft_list: list[dict]) -> dict:
    """Calculate aircraft stats from in-memory aircraft list.

    This is called from the main polling loop to avoid extra DB queries.
    """
    now = datetime.utcnow()

    with_pos = sum(1 for a in aircraft_list if is_valid_position(a.get("lat"), a.get("lon")))
    military_count = sum(1 for a in aircraft_list if a.get("dbFlags", 0) & 1)
    emergency = [
        {"hex": a.get("hex"), "flight": a.get("flight"), "squawk": a.get("squawk")}
        for a in aircraft_list if a.get("squawk") in ["7500", "7600", "7700"]
    ]

    # Category breakdown
    categories_count = {}
    for a in aircraft_list:
        cat = a.get("category", "unknown")
        categories_count[cat] = categories_count.get(cat, 0) + 1

    # Altitude breakdown
    alt_ground = sum(
        1 for a in aircraft_list
        if a.get("alt_baro") == "ground" or
        (isinstance(a.get("alt_baro"), (int, float)) and a.get("alt_baro", 99999) <= 0)
    )
    alt_low = sum(
        1 for a in aircraft_list
        if isinstance(a.get("alt_baro"), (int, float)) and 0 < a["alt_baro"] < 10000
    )
    alt_med = sum(
        1 for a in aircraft_list
        if isinstance(a.get("alt_baro"), (int, float)) and 10000 <= a["alt_baro"] < 30000
    )
    alt_high = sum(
        1 for a in aircraft_list
        if isinstance(a.get("alt_baro"), (int, float)) and a["alt_baro"] >= 30000
    )

    # Distance breakdown
    dist_close = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and a["distance_nm"] < 25)
    dist_near = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and 25 <= a["distance_nm"] < 50)
    dist_mid = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and 50 <= a["distance_nm"] < 100)
    dist_far = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and a["distance_nm"] >= 100)

    # Speed breakdown
    speed_slow = sum(1 for a in aircraft_list if a.get("gs") and a["gs"] < 200)
    speed_med = sum(1 for a in aircraft_list if a.get("gs") and 200 <= a["gs"] < 400)
    speed_fast = sum(1 for a in aircraft_list if a.get("gs") and a["gs"] >= 400)

    return {
        "total": len(aircraft_list),
        "with_position": with_pos,
        "military": military_count,
        "emergency": emergency,
        "categories": categories_count,
        "altitude": {"ground": alt_ground, "low": alt_low, "medium": alt_med, "high": alt_high},
        "distance": {"close": dist_close, "near": dist_near, "mid": dist_mid, "far": dist_far},
        "speed": {"slow": speed_slow, "medium": speed_med, "fast": speed_fast},
        "messages": 0,
        "filters_applied": None,
        "timestamp": now.isoformat() + "Z"
    }


def calculate_top_aircraft(aircraft_list: list[dict]) -> dict:
    """Calculate top aircraft from in-memory aircraft list."""
    now = datetime.utcnow()

    # Top 5 by closest
    closest = sorted(
        [a for a in aircraft_list if is_valid_position(a.get("lat"), a.get("lon"))],
        key=lambda x: x.get("distance_nm") if x.get("distance_nm") is not None else 99999
    )[:5]

    # Top 5 by altitude
    highest = sorted(
        [a for a in aircraft_list if isinstance(a.get("alt_baro"), (int, float))],
        key=lambda x: x["alt_baro"],
        reverse=True
    )[:5]

    # Top 5 by speed
    fastest = sorted(
        [a for a in aircraft_list if a.get("gs")],
        key=lambda x: x["gs"],
        reverse=True
    )[:5]

    # Top 5 by vertical rate
    climbing = sorted(
        [a for a in aircraft_list if a.get("baro_rate")],
        key=lambda x: abs(x.get("baro_rate", 0)),
        reverse=True
    )[:5]

    # Military
    military = [a for a in aircraft_list if a.get("dbFlags", 0) & 1][:5]

    return {
        "closest": [simplify_aircraft(a, a.get("distance_nm")) for a in closest],
        "highest": [simplify_aircraft(a, a.get("distance_nm")) for a in highest],
        "fastest": [simplify_aircraft(a, a.get("distance_nm")) for a in fastest],
        "climbing": [simplify_aircraft(a, a.get("distance_nm")) for a in climbing],
        "military": [simplify_aircraft(a, a.get("distance_nm")) for a in military],
        "total": len(aircraft_list),
        "timestamp": now.isoformat() + "Z"
    }


def update_aircraft_stats_cache(aircraft_list: list[dict]):
    """Update aircraft stats cache from polling loop (synchronous, fast)."""
    now = datetime.utcnow()

    _stats_cache["aircraft_stats"] = calculate_aircraft_stats(aircraft_list)
    _stats_cache["aircraft_stats_updated"] = now.isoformat() + "Z"

    _stats_cache["top_aircraft"] = calculate_top_aircraft(aircraft_list)
    _stats_cache["top_aircraft_updated"] = now.isoformat() + "Z"


# =============================================================================
# History Stats Calculation (DB queries)
# =============================================================================

async def calculate_history_stats(db: AsyncSession, hours: int = 24) -> dict:
    """Calculate historical statistics."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    sighting_conditions = [AircraftSighting.timestamp > cutoff]
    session_conditions = [AircraftSession.last_seen > cutoff]

    sightings_count = (await db.execute(
        select(func.count(AircraftSighting.id)).where(and_(*sighting_conditions))
    )).scalar()

    sessions_count = (await db.execute(
        select(func.count(AircraftSession.id)).where(and_(*session_conditions))
    )).scalar()

    unique_aircraft = (await db.execute(
        select(func.count(func.distinct(AircraftSession.icao_hex)))
        .where(and_(*session_conditions))
    )).scalar()

    military_sessions = (await db.execute(
        select(func.count(AircraftSession.id))
        .where(and_(AircraftSession.last_seen > cutoff, AircraftSession.is_military == True))
    )).scalar()

    # Get altitude stats
    alt_stats = (await db.execute(
        select(
            func.avg(AircraftSighting.altitude_baro).label("avg_alt"),
            func.max(AircraftSighting.altitude_baro).label("max_alt"),
            func.min(AircraftSighting.altitude_baro).label("min_alt")
        ).where(and_(*sighting_conditions, AircraftSighting.altitude_baro.isnot(None)))
    )).first()

    # Get distance stats
    dist_stats = (await db.execute(
        select(
            func.avg(AircraftSighting.distance_nm).label("avg_dist"),
            func.max(AircraftSighting.distance_nm).label("max_dist"),
            func.min(AircraftSighting.distance_nm).label("min_dist")
        ).where(and_(*sighting_conditions, AircraftSighting.distance_nm.isnot(None)))
    )).first()

    # Get speed stats
    speed_stats = (await db.execute(
        select(
            func.avg(AircraftSighting.ground_speed).label("avg_speed"),
            func.max(AircraftSighting.ground_speed).label("max_speed")
        ).where(and_(*sighting_conditions, AircraftSighting.ground_speed.isnot(None)))
    )).first()

    return {
        "total_sightings": sightings_count or 0,
        "total_sessions": sessions_count or 0,
        "unique_aircraft": unique_aircraft or 0,
        "military_sessions": military_sessions or 0,
        "time_range_hours": hours,
        "avg_altitude": round(alt_stats.avg_alt) if alt_stats and alt_stats.avg_alt else None,
        "max_altitude": alt_stats.max_alt if alt_stats else None,
        "min_altitude": alt_stats.min_alt if alt_stats else None,
        "avg_distance_nm": round(dist_stats.avg_dist, 1) if dist_stats and dist_stats.avg_dist else None,
        "max_distance_nm": round(dist_stats.max_dist, 1) if dist_stats and dist_stats.max_dist else None,
        "avg_speed": round(speed_stats.avg_speed) if speed_stats and speed_stats.avg_speed else None,
        "max_speed": round(speed_stats.max_speed) if speed_stats and speed_stats.max_speed else None,
        "filters_applied": None,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


async def calculate_history_trends(db: AsyncSession, hours: int = 24, interval: str = "hour") -> dict:
    """Calculate time-series trend data."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    interval_map = {
        "15min": "15 minutes",
        "hour": "hour",
        "day": "day"
    }
    pg_interval = interval_map.get(interval, "hour")

    conditions = [AircraftSighting.timestamp > cutoff]

    if pg_interval == "15 minutes":
        interval_expr = func.date_trunc('hour', AircraftSighting.timestamp) + \
            (func.floor(func.extract('minute', AircraftSighting.timestamp) / 15) * literal_column("interval '15 minutes'"))
    else:
        interval_expr = func.date_trunc(pg_interval, AircraftSighting.timestamp)

    trend_query = (
        select(
            interval_expr.label('interval_start'),
            func.count(AircraftSighting.id).label('position_count'),
            func.count(func.distinct(AircraftSighting.icao_hex)).label('unique_aircraft'),
            func.sum(case((AircraftSighting.is_military == True, 1), else_=0)).label('military_count'),
            func.avg(AircraftSighting.altitude_baro).label('avg_altitude'),
            func.max(AircraftSighting.altitude_baro).label('max_altitude'),
            func.avg(AircraftSighting.distance_nm).label('avg_distance'),
            func.max(AircraftSighting.distance_nm).label('max_distance'),
            func.avg(AircraftSighting.ground_speed).label('avg_speed'),
            func.max(AircraftSighting.ground_speed).label('max_speed')
        )
        .where(and_(*conditions))
        .group_by(interval_expr)
        .order_by(interval_expr)
    )

    result = await db_execute_safe(db, trend_query)
    intervals = []
    peak_concurrent = 0
    peak_interval = None

    if result:
        for row in result:
            unique = row.unique_aircraft or 0
            if unique > peak_concurrent:
                peak_concurrent = unique
                peak_interval = row.interval_start

            intervals.append({
                "timestamp": row.interval_start.isoformat() + "Z" if row.interval_start else None,
                "position_count": row.position_count or 0,
                "unique_aircraft": unique,
                "military_count": row.military_count or 0,
                "avg_altitude": round(row.avg_altitude) if row.avg_altitude else None,
                "max_altitude": row.max_altitude,
                "avg_distance_nm": round(row.avg_distance, 1) if row.avg_distance else None,
                "max_distance_nm": round(row.max_distance, 1) if row.max_distance else None,
                "avg_speed": round(row.avg_speed) if row.avg_speed else None,
                "max_speed": row.max_speed,
            })

    # Get total unique aircraft for the period
    total_unique = (await db.execute(
        select(func.count(func.distinct(AircraftSighting.icao_hex)))
        .where(and_(*conditions))
    )).scalar() or 0

    return {
        "intervals": intervals,
        "interval_type": interval,
        "time_range_hours": hours,
        "summary": {
            "total_unique_aircraft": total_unique,
            "peak_concurrent": peak_concurrent,
            "peak_interval": peak_interval.isoformat() + "Z" if peak_interval else None,
            "total_intervals": len(intervals)
        },
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


async def calculate_history_top(db: AsyncSession, hours: int = 24, limit: int = 10) -> dict:
    """Calculate top performing aircraft."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    session_conditions = [AircraftSession.last_seen > cutoff]

    def format_session(s):
        duration = (s.last_seen - s.first_seen).total_seconds() / 60
        return {
            "icao_hex": s.icao_hex,
            "callsign": s.callsign,
            "aircraft_type": s.aircraft_type,
            "is_military": s.is_military,
            "first_seen": s.first_seen.isoformat() + "Z",
            "last_seen": s.last_seen.isoformat() + "Z",
            "duration_min": round(duration, 1),
            "positions": s.total_positions,
            "min_distance_nm": round(s.min_distance_nm, 1) if s.min_distance_nm else None,
            "max_distance_nm": round(s.max_distance_nm, 1) if s.max_distance_nm else None,
            "min_altitude": s.min_altitude,
            "max_altitude": s.max_altitude,
        }

    # Longest tracked
    duration_expr = func.extract('epoch', AircraftSession.last_seen - AircraftSession.first_seen)
    longest_query = (
        select(AircraftSession)
        .where(and_(*session_conditions))
        .order_by(duration_expr.desc())
        .limit(limit)
    )
    longest_result = await db_execute_safe(db, longest_query)
    longest_tracked = [format_session(s) for s in longest_result.scalars()] if longest_result else []

    # Furthest distance
    furthest_query = (
        select(AircraftSession)
        .where(and_(*session_conditions, AircraftSession.max_distance_nm.isnot(None)))
        .order_by(AircraftSession.max_distance_nm.desc())
        .limit(limit)
    )
    furthest_result = await db_execute_safe(db, furthest_query)
    furthest_distance = [format_session(s) for s in furthest_result.scalars()] if furthest_result else []

    # Highest altitude
    highest_query = (
        select(AircraftSession)
        .where(and_(*session_conditions, AircraftSession.max_altitude.isnot(None)))
        .order_by(AircraftSession.max_altitude.desc())
        .limit(limit)
    )
    highest_result = await db_execute_safe(db, highest_query)
    highest_altitude = [format_session(s) for s in highest_result.scalars()] if highest_result else []

    # Most positions
    most_pos_query = (
        select(AircraftSession)
        .where(and_(*session_conditions))
        .order_by(AircraftSession.total_positions.desc())
        .limit(limit)
    )
    most_pos_result = await db_execute_safe(db, most_pos_query)
    most_positions = [format_session(s) for s in most_pos_result.scalars()] if most_pos_result else []

    # Closest approach
    closest_query = (
        select(AircraftSession)
        .where(and_(*session_conditions, AircraftSession.min_distance_nm.isnot(None)))
        .order_by(AircraftSession.min_distance_nm.asc())
        .limit(limit)
    )
    closest_result = await db_execute_safe(db, closest_query)
    closest_approach = [format_session(s) for s in closest_result.scalars()] if closest_result else []

    return {
        "longest_tracked": longest_tracked,
        "furthest_distance": furthest_distance,
        "highest_altitude": highest_altitude,
        "most_positions": most_positions,
        "closest_approach": closest_approach,
        "time_range_hours": hours,
        "limit": limit,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


# =============================================================================
# Safety Stats Calculation
# =============================================================================

async def calculate_safety_stats(db: AsyncSession, hours: int = 24) -> dict:
    """Calculate safety event statistics."""
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=hours)
    conditions = [SafetyEvent.timestamp > cutoff]

    # Events by type
    type_query = (
        select(SafetyEvent.event_type, func.count(SafetyEvent.id))
        .where(and_(*conditions))
        .group_by(SafetyEvent.event_type)
    )
    type_result = await db_execute_safe(db, type_query)
    events_by_type = {row[0]: row[1] for row in type_result} if type_result else {}

    # Events by severity
    severity_query = (
        select(SafetyEvent.severity, func.count(SafetyEvent.id))
        .where(and_(*conditions))
        .group_by(SafetyEvent.severity)
    )
    severity_result = await db_execute_safe(db, severity_query)
    events_by_severity = {row[0]: row[1] for row in severity_result} if severity_result else {}

    # Events by type AND severity
    type_severity_query = (
        select(SafetyEvent.event_type, SafetyEvent.severity, func.count(SafetyEvent.id))
        .where(and_(*conditions))
        .group_by(SafetyEvent.event_type, SafetyEvent.severity)
    )
    type_severity_result = await db_execute_safe(db, type_severity_query)
    events_by_type_severity = {}
    if type_severity_result:
        for event_type_val, sev, count in type_severity_result:
            if event_type_val not in events_by_type_severity:
                events_by_type_severity[event_type_val] = {}
            events_by_type_severity[event_type_val][sev] = count

    # Unique aircraft count
    unique_query = (
        select(func.count(func.distinct(SafetyEvent.icao_hex)))
        .where(and_(*conditions))
    )
    unique_result = await db_execute_safe(db, unique_query)
    unique_aircraft = unique_result.scalar() if unique_result else 0

    # Hourly distribution
    hour_bucket = func.date_trunc('hour', SafetyEvent.timestamp).label('hour')
    hour_query = (
        select(
            hour_bucket,
            func.count(SafetyEvent.id).label('count'),
            func.sum(case((SafetyEvent.severity == 'critical', 1), else_=0)).label('critical'),
            func.sum(case((SafetyEvent.severity == 'warning', 1), else_=0)).label('warning'),
            func.sum(case((SafetyEvent.severity == 'low', 1), else_=0)).label('low')
        )
        .where(and_(*conditions))
        .group_by(hour_bucket)
        .order_by(hour_bucket)
    )
    hour_result = await db_execute_safe(db, hour_query)
    events_by_hour = []
    if hour_result:
        for row in hour_result:
            events_by_hour.append({
                "hour": row.hour.isoformat() + "Z" if row.hour else None,
                "count": row.count or 0,
                "critical": row.critical or 0,
                "warning": row.warning or 0,
                "low": row.low or 0
            })

    # Top aircraft by event count
    top_aircraft_query = (
        select(
            SafetyEvent.icao_hex,
            SafetyEvent.callsign,
            func.count(SafetyEvent.id).label('count'),
            func.max(SafetyEvent.severity).label('worst_severity')
        )
        .where(and_(*conditions))
        .group_by(SafetyEvent.icao_hex, SafetyEvent.callsign)
        .order_by(func.count(SafetyEvent.id).desc())
        .limit(10)
    )
    top_aircraft_result = await db_execute_safe(db, top_aircraft_query)
    top_aircraft = []
    if top_aircraft_result:
        severity_order = {'critical': 3, 'warning': 2, 'low': 1}
        for row in top_aircraft_result:
            top_aircraft.append({
                "icao": row.icao_hex,
                "callsign": row.callsign,
                "count": row.count,
                "worst_severity": row.worst_severity
            })
        top_aircraft.sort(key=lambda x: (-severity_order.get(x['worst_severity'], 0), -x['count']))

    # Recent events
    recent_query = (
        select(SafetyEvent)
        .where(and_(*conditions))
        .order_by(SafetyEvent.timestamp.desc())
        .limit(10)
    )
    recent_result = await db_execute_safe(db, recent_query)
    recent_events = [
        {
            "id": e.id,
            "event_type": e.event_type,
            "severity": e.severity,
            "icao": e.icao_hex,
            "callsign": e.callsign,
            "message": e.message,
            "timestamp": e.timestamp.isoformat() + "Z",
        }
        for e in recent_result.scalars()
    ] if recent_result else []

    total_events = sum(events_by_type.values())
    event_rate = total_events / hours if hours > 0 else 0

    return {
        "monitoring_enabled": safety_monitor.enabled,
        "thresholds": safety_monitor.get_thresholds(),
        "time_range_hours": hours,
        "events_by_type": events_by_type,
        "events_by_severity": events_by_severity,
        "events_by_type_severity": events_by_type_severity,
        "total_events": total_events,
        "unique_aircraft": unique_aircraft or 0,
        "event_rate_per_hour": round(event_rate, 2),
        "events_by_hour": events_by_hour,
        "top_aircraft": top_aircraft,
        "recent_events": recent_events,
        "monitor_state": safety_monitor.get_state(),
        "timestamp": now.isoformat() + "Z",
    }


# =============================================================================
# Cache Refresh Functions
# =============================================================================

async def refresh_history_cache(session_factory) -> None:
    """Refresh history stats cache."""
    logger.debug("Refreshing history stats cache...")
    start = datetime.utcnow()

    try:
        async with session_factory() as db:
            # Calculate all history stats in parallel
            stats, trends, top = await asyncio.gather(
                calculate_history_stats(db),
                calculate_history_trends(db),
                calculate_history_top(db),
                return_exceptions=True
            )

            now = datetime.utcnow().isoformat() + "Z"

            if not isinstance(stats, Exception):
                _stats_cache["history_stats"] = stats
                _stats_cache["history_stats_updated"] = now
            else:
                logger.error(f"Error calculating history stats: {stats}")

            if not isinstance(trends, Exception):
                _stats_cache["history_trends"] = trends
                _stats_cache["history_trends_updated"] = now
            else:
                logger.error(f"Error calculating history trends: {trends}")

            if not isinstance(top, Exception):
                _stats_cache["history_top"] = top
                _stats_cache["history_top_updated"] = now
            else:
                logger.error(f"Error calculating history top: {top}")

        duration = (datetime.utcnow() - start).total_seconds()
        logger.debug(f"History stats cache refreshed in {duration:.2f}s")

        # Broadcast update via Socket.IO
        await broadcast_stats_update("history")

    except Exception as e:
        logger.error(f"Error refreshing history cache: {e}")


async def refresh_safety_cache(session_factory) -> None:
    """Refresh safety stats cache."""
    logger.debug("Refreshing safety stats cache...")
    start = datetime.utcnow()

    try:
        async with session_factory() as db:
            stats = await calculate_safety_stats(db)

            _stats_cache["safety_stats"] = stats
            _stats_cache["safety_stats_updated"] = datetime.utcnow().isoformat() + "Z"

        duration = (datetime.utcnow() - start).total_seconds()
        logger.debug(f"Safety stats cache refreshed in {duration:.2f}s")

        # Broadcast update via Socket.IO
        await broadcast_stats_update("safety")

    except Exception as e:
        logger.error(f"Error refreshing safety cache: {e}")


async def broadcast_stats_update(stats_type: str):
    """Broadcast stats update via Socket.IO."""
    try:
        from app.services.socketio_manager import get_socketio_manager

        sio_manager = get_socketio_manager()
        if sio_manager:
            if stats_type == "aircraft":
                await sio_manager.broadcast_to_room('stats', 'stats:aircraft', get_aircraft_stats())
                await sio_manager.broadcast_to_room('stats', 'stats:top', get_top_aircraft())
            elif stats_type == "history":
                await sio_manager.broadcast_to_room('stats', 'stats:history', get_history_stats())
                await sio_manager.broadcast_to_room('stats', 'stats:trends', get_history_trends())
            elif stats_type == "safety":
                await sio_manager.broadcast_to_room('stats', 'stats:safety', get_safety_stats())
            logger.debug(f"Stats broadcast sent: {stats_type}")
    except Exception as e:
        logger.error(f"Error broadcasting stats update: {e}")


# =============================================================================
# Background Task Loops
# =============================================================================

async def _history_refresh_loop(session_factory):
    """Background task to periodically refresh history stats."""
    logger.info(f"History stats refresh loop started (interval: {HISTORY_STATS_INTERVAL}s)")

    while True:
        try:
            await refresh_history_cache(session_factory)
        except asyncio.CancelledError:
            logger.info("History stats refresh loop cancelled")
            raise
        except Exception as e:
            logger.error(f"Error in history stats refresh: {e}")

        await asyncio.sleep(HISTORY_STATS_INTERVAL)


async def _safety_refresh_loop(session_factory):
    """Background task to periodically refresh safety stats."""
    logger.info(f"Safety stats refresh loop started (interval: {SAFETY_STATS_INTERVAL}s)")

    while True:
        try:
            await refresh_safety_cache(session_factory)
        except asyncio.CancelledError:
            logger.info("Safety stats refresh loop cancelled")
            raise
        except Exception as e:
            logger.error(f"Error in safety stats refresh: {e}")

        await asyncio.sleep(SAFETY_STATS_INTERVAL)


# =============================================================================
# Public API - Get Cached Data
# =============================================================================

def get_aircraft_stats() -> Optional[dict]:
    """Get cached aircraft stats."""
    return _stats_cache.get("aircraft_stats")


def get_top_aircraft() -> Optional[dict]:
    """Get cached top aircraft."""
    return _stats_cache.get("top_aircraft")


def get_history_stats() -> Optional[dict]:
    """Get cached history stats."""
    return _stats_cache.get("history_stats")


def get_history_trends() -> Optional[dict]:
    """Get cached history trends."""
    return _stats_cache.get("history_trends")


def get_history_top() -> Optional[dict]:
    """Get cached history top performers."""
    return _stats_cache.get("history_top")


def get_safety_stats() -> Optional[dict]:
    """Get cached safety stats."""
    return _stats_cache.get("safety_stats")


def get_all_cached_stats() -> dict:
    """Get all cached stats with metadata."""
    return {
        "aircraft_stats": _stats_cache.get("aircraft_stats"),
        "aircraft_stats_updated": _stats_cache.get("aircraft_stats_updated"),
        "top_aircraft": _stats_cache.get("top_aircraft"),
        "top_aircraft_updated": _stats_cache.get("top_aircraft_updated"),
        "history_stats": _stats_cache.get("history_stats"),
        "history_stats_updated": _stats_cache.get("history_stats_updated"),
        "history_trends": _stats_cache.get("history_trends"),
        "history_trends_updated": _stats_cache.get("history_trends_updated"),
        "history_top": _stats_cache.get("history_top"),
        "history_top_updated": _stats_cache.get("history_top_updated"),
        "safety_stats": _stats_cache.get("safety_stats"),
        "safety_stats_updated": _stats_cache.get("safety_stats_updated"),
    }


# =============================================================================
# Lifecycle Management
# =============================================================================

async def start_refresh_tasks(session_factory) -> list[asyncio.Task]:
    """Start all background refresh tasks."""
    global _refresh_tasks

    # Do initial refresh
    await asyncio.gather(
        refresh_history_cache(session_factory),
        refresh_safety_cache(session_factory),
        return_exceptions=True
    )

    # Start periodic refresh loops
    _refresh_tasks["history"] = asyncio.create_task(_history_refresh_loop(session_factory))
    _refresh_tasks["safety"] = asyncio.create_task(_safety_refresh_loop(session_factory))

    return list(_refresh_tasks.values())


async def stop_refresh_tasks():
    """Stop all background refresh tasks."""
    global _refresh_tasks

    for name, task in _refresh_tasks.items():
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            _refresh_tasks[name] = None
            logger.info(f"Stats cache {name} refresh task stopped")
