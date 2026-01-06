"""
Historical data API endpoints.

Query and analyze historical aircraft sightings and tracking sessions
stored in the PostgreSQL database.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Path
from sqlalchemy import select, func, and_, or_, case, literal_column, text
from sqlalchemy.ext.asyncio import AsyncSession
import statistics

from app.core import get_db, db_execute_safe
from app.models import AircraftSighting, AircraftSession, SafetyEvent
from app.schemas import (
    SightingsListResponse, SessionsListResponse, HistoryStatsResponse
)
from app.services.external_db import lookup_opensky as opensky_lookup

router = APIRouter(prefix="/api/v1/history", tags=["History"])


@router.get(
    "/sightings",
    response_model=SightingsListResponse,
    summary="Query Aircraft Sightings",
    description="""
Query historical aircraft position reports (sightings).

Each sighting represents a single position report from an aircraft,
stored every 10 seconds while the aircraft is in range.

Filters:
- **icao_hex**: Filter by aircraft ICAO address
- **callsign**: Filter by callsign (partial match)
- **military_only**: Only military aircraft
- **hours**: Time range to query
- **min_altitude/max_altitude**: Altitude range filter

Results are returned newest first, limited to prevent large responses.
    """,
    responses={
        200: {
            "description": "List of sightings",
            "content": {
                "application/json": {
                    "example": {
                        "sightings": [
                            {
                                "timestamp": "2024-12-21T12:00:00Z",
                                "icao_hex": "A12345",
                                "callsign": "UAL123",
                                "lat": 47.6062,
                                "lon": -122.3321,
                                "altitude": 35000,
                                "gs": 450,
                                "distance_nm": 15.2
                            }
                        ],
                        "count": 1,
                        "total": 1523
                    }
                }
            }
        }
    }
)
async def get_sightings(
    icao_hex: Optional[str] = Query(None, description="Filter by ICAO hex address", example="A12345"),
    callsign: Optional[str] = Query(None, description="Filter by callsign (partial match)", example="UAL"),
    military_only: bool = Query(False, description="Only return military aircraft"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history to query"),
    min_altitude: Optional[int] = Query(None, description="Minimum altitude in feet"),
    max_altitude: Optional[int] = Query(None, description="Maximum altitude in feet"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum sightings to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    db: AsyncSession = Depends(get_db)
):
    """Query historical aircraft sightings with filters."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    conditions = [AircraftSighting.timestamp > cutoff]
    
    if icao_hex:
        conditions.append(AircraftSighting.icao_hex == icao_hex.upper())
    if callsign:
        conditions.append(AircraftSighting.callsign.ilike(f"%{callsign}%"))
    if military_only:
        conditions.append(AircraftSighting.is_military == True)
    if min_altitude is not None:
        conditions.append(AircraftSighting.altitude_baro >= min_altitude)
    if max_altitude is not None:
        conditions.append(AircraftSighting.altitude_baro <= max_altitude)
    
    # Get total count
    count_query = select(func.count(AircraftSighting.id)).where(and_(*conditions))
    total = (await db.execute(count_query)).scalar()
    
    # Get sightings
    query = (
        select(AircraftSighting)
        .where(and_(*conditions))
        .order_by(AircraftSighting.timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    
    result = await db.execute(query)
    sightings = []
    
    for s in result.scalars():
        sightings.append({
            "timestamp": s.timestamp.isoformat() + "Z",
            "icao_hex": s.icao_hex,
            "callsign": s.callsign,
            "lat": s.latitude,
            "lon": s.longitude,
            "altitude": s.altitude_baro,
            "gs": s.ground_speed,
            "vr": s.vertical_rate,
            "distance_nm": s.distance_nm,
            "is_military": s.is_military,
            "squawk": s.squawk,
            "rssi": round(s.rssi, 1) if s.rssi else None,
        })

    return {"sightings": sightings, "count": len(sightings), "total": total}


@router.get(
    "/sightings/{icao_hex}",
    summary="Get Sightings for Aircraft",
    description="""
Get all sightings for a specific aircraft.

Returns the flight path data including all position reports
for the given ICAO hex address within the time range.
    """,
    responses={
        200: {
            "description": "Sightings for aircraft",
            "content": {
                "application/json": {
                    "example": {
                        "icao_hex": "A12345",
                        "sightings": [
                            {"timestamp": "2024-12-21T12:00:00Z", "lat": 47.6, "lon": -122.3}
                        ],
                        "count": 45
                    }
                }
            }
        }
    }
)
async def get_aircraft_sightings(
    icao_hex: str = Path(..., description="ICAO hex address", example="A12345"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history"),
    limit: int = Query(500, ge=1, le=2000, description="Maximum sightings"),
    db: AsyncSession = Depends(get_db)
):
    """Get sightings for a specific aircraft."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    query = (
        select(AircraftSighting)
        .where(
            and_(
                AircraftSighting.icao_hex == icao_hex.upper(),
                AircraftSighting.timestamp > cutoff
            )
        )
        .order_by(AircraftSighting.timestamp.desc())
        .limit(limit)
    )
    
    result = await db.execute(query)
    sightings = []
    
    for s in result.scalars():
        sightings.append({
            "timestamp": s.timestamp.isoformat() + "Z",
            "lat": s.latitude,
            "lon": s.longitude,
            "altitude": s.altitude_baro,
            "gs": s.ground_speed,
            "vr": s.vertical_rate,
            "track": s.track,
            "distance_nm": s.distance_nm,
            "rssi": round(s.rssi, 1) if s.rssi else None,
            "callsign": s.callsign,
        })

    return {
        "icao_hex": icao_hex.upper(),
        "sightings": sightings,
        "count": len(sightings)
    }


@router.get(
    "/sessions",
    response_model=SessionsListResponse,
    summary="Query Tracking Sessions",
    description="""
Query aircraft tracking sessions.

A session represents a continuous period of tracking an aircraft,
from first detection to last signal. Sessions aggregate multiple
sightings into summary statistics.

Session data includes:
- Duration and position count
- Closest approach distance
- Altitude range (min/max)
- Maximum vertical rate
- Aircraft type and military flag
    """,
    responses={
        200: {
            "description": "List of sessions",
            "content": {
                "application/json": {
                    "example": {
                        "sessions": [
                            {
                                "icao_hex": "A12345",
                                "callsign": "UAL123",
                                "first_seen": "2024-12-21T11:30:00Z",
                                "last_seen": "2024-12-21T12:15:00Z",
                                "duration_min": 45,
                                "positions": 135,
                                "min_distance_nm": 5.2,
                                "type": "B738"
                            }
                        ],
                        "count": 1
                    }
                }
            }
        }
    }
)
async def get_sessions(
    icao_hex: Optional[str] = Query(None, description="Filter by ICAO hex"),
    callsign: Optional[str] = Query(None, description="Filter by callsign"),
    military_only: bool = Query(False, description="Only military aircraft"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history"),
    min_duration: Optional[int] = Query(None, description="Minimum duration in minutes"),
    limit: int = Query(100, ge=1, le=500, description="Maximum sessions"),
    db: AsyncSession = Depends(get_db)
):
    """Query aircraft tracking sessions."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    conditions = [AircraftSession.last_seen > cutoff]
    
    if icao_hex:
        conditions.append(AircraftSession.icao_hex == icao_hex.upper())
    if callsign:
        conditions.append(AircraftSession.callsign.ilike(f"%{callsign}%"))
    if military_only:
        conditions.append(AircraftSession.is_military == True)
    
    query = (
        select(AircraftSession)
        .where(and_(*conditions))
        .order_by(AircraftSession.last_seen.desc())
        .limit(limit)
    )

    result = await db_execute_safe(db, query)
    if not result:
        return {"sessions": [], "count": 0, "time_range_hours": hours}

    sessions = []

    # Collect all session icao_hex values and time ranges for batch safety event lookup
    session_list = []
    for s in result.scalars():
        duration = (s.last_seen - s.first_seen).total_seconds() / 60
        if min_duration and duration < min_duration:
            continue
        session_list.append(s)

    # Build a map of icao_hex to safety event counts within session time ranges
    safety_counts = {}
    if session_list:
        # Get all relevant safety events in one query
        icao_hexes = list(set(s.icao_hex for s in session_list))
        safety_query = select(
            SafetyEvent.icao_hex,
            SafetyEvent.icao_hex_2,
            SafetyEvent.timestamp
        ).where(
            and_(
                SafetyEvent.timestamp > cutoff,
                or_(
                    SafetyEvent.icao_hex.in_(icao_hexes),
                    SafetyEvent.icao_hex_2.in_(icao_hexes)
                )
            )
        )
        safety_result = await db_execute_safe(db, safety_query)
        safety_events = safety_result.all() if safety_result else []

        # Count safety events for each session
        for s in session_list:
            count = 0
            for event in safety_events:
                # Check if event involves this aircraft and falls within session time
                if (event.icao_hex == s.icao_hex or event.icao_hex_2 == s.icao_hex):
                    if s.first_seen <= event.timestamp <= s.last_seen:
                        count += 1
            safety_counts[s.id] = count

    # Batch lookup aircraft info for registration data
    aircraft_info_cache = {}
    unique_icaos = list(set(s.icao_hex for s in session_list))
    for icao in unique_icaos:
        info = opensky_lookup(icao)
        if info:
            aircraft_info_cache[icao] = info

    for s in session_list:
        duration = (s.last_seen - s.first_seen).total_seconds() / 60
        info = aircraft_info_cache.get(s.icao_hex, {})
        sessions.append({
            "icao_hex": s.icao_hex,
            "callsign": s.callsign,
            "registration": info.get("registration"),
            "country": info.get("country"),
            "first_seen": s.first_seen.isoformat() + "Z",
            "last_seen": s.last_seen.isoformat() + "Z",
            "duration_min": round(duration, 1),
            "positions": s.total_positions,
            "min_distance_nm": round(s.min_distance_nm, 1) if s.min_distance_nm else None,
            "max_distance_nm": round(s.max_distance_nm, 1) if s.max_distance_nm else None,
            "min_alt": s.min_altitude,
            "max_alt": s.max_altitude,
            "max_vr": s.max_vertical_rate,
            "min_rssi": round(s.min_rssi, 1) if s.min_rssi else None,
            "max_rssi": round(s.max_rssi, 1) if s.max_rssi else None,
            "is_military": s.is_military,
            "type": s.aircraft_type,
            "safety_event_count": safety_counts.get(s.id, 0),
        })

    return {"sessions": sessions, "count": len(sessions)}


@router.get(
    "/stats",
    response_model=HistoryStatsResponse,
    summary="Get Historical Statistics",
    description="""
Get aggregate statistics about historical data.

Data is pre-computed every 60 seconds and served from cache for fast response.

Returns:
- Total sightings and sessions
- Unique aircraft count
- Military session count
- Time range covered (24 hours)
- Altitude and distance statistics
    """,
    responses={
        200: {
            "description": "Historical statistics",
            "content": {
                "application/json": {
                    "example": {
                        "total_sightings": 152340,
                        "total_sessions": 4567,
                        "unique_aircraft": 1234,
                        "military_sessions": 89,
                        "time_range_hours": 24,
                        "avg_altitude": 28500,
                        "max_altitude": 45000,
                        "avg_distance_nm": 52.3,
                        "max_distance_nm": 185.0,
                        "filters_applied": {}
                    }
                }
            }
        },
        503: {"description": "Stats not yet available"}
    }
)
async def get_stats():
    """Get historical data statistics from cache."""
    from fastapi import HTTPException
    from app.services.stats_cache import get_history_stats

    cached = get_history_stats()
    if cached is None:
        raise HTTPException(status_code=503, detail="Stats not yet available, please retry in a few seconds")
    return cached


# ============================================================================
# Trends Endpoint - Hourly/interval-based metrics over time
# ============================================================================

@router.get(
    "/trends",
    summary="Get Historical Trends",
    description="""
Get time-series data for aircraft metrics over the last 24 hours.

Data is pre-computed every 60 seconds and served from cache for fast response.

Returns metrics per hour interval:
- Aircraft count and unique aircraft
- Average/max altitude, distance, speed
- Position count
    """,
    responses={
        200: {
            "description": "Trend data",
            "content": {
                "application/json": {
                    "example": {
                        "intervals": [
                            {
                                "timestamp": "2024-01-01T12:00:00Z",
                                "aircraft_count": 45,
                                "unique_aircraft": 38,
                                "military_count": 3,
                                "avg_altitude": 28500,
                                "max_altitude": 43000,
                                "avg_distance_nm": 45.2,
                                "max_distance_nm": 185.3
                            }
                        ],
                        "summary": {
                            "total_unique_aircraft": 156,
                            "peak_concurrent": 52,
                            "peak_interval": "2024-01-01T14:00:00Z"
                        }
                    }
                }
            }
        },
        503: {"description": "Stats not yet available"}
    }
)
async def get_trends():
    """Get time-series trend data for aircraft metrics from cache."""
    from fastapi import HTTPException
    from app.services.stats_cache import get_history_trends

    cached = get_history_trends()
    if cached is None:
        raise HTTPException(status_code=503, detail="Stats not yet available, please retry in a few seconds")
    return cached


# ============================================================================
# Top Performers Endpoint
# ============================================================================

@router.get(
    "/top",
    summary="Get Top Performing Aircraft",
    description="""
Get top aircraft by various metrics:
- **longest_tracked**: Sessions with longest duration
- **furthest_distance**: Aircraft seen at greatest distance
- **highest_altitude**: Aircraft at highest altitude
- **most_positions**: Most position reports (best tracked)
- **closest_approach**: Aircraft with closest approach distance

Data is pre-computed every 60 seconds and served from cache for fast response.
    """,
    responses={
        200: {
            "description": "Top performers by category",
            "content": {
                "application/json": {
                    "example": {
                        "longest_tracked": [
                            {"icao_hex": "A12345", "callsign": "UAL123", "duration_min": 125.5}
                        ],
                        "furthest_distance": [
                            {"icao_hex": "B67890", "max_distance_nm": 245.3}
                        ]
                    }
                }
            }
        },
        503: {"description": "Stats not yet available"}
    }
)
async def get_top_performers():
    """Get top performing aircraft by various metrics from cache."""
    from fastapi import HTTPException
    from app.services.stats_cache import get_history_top

    cached = get_history_top()
    if cached is None:
        raise HTTPException(status_code=503, detail="Stats not yet available, please retry in a few seconds")
    return cached


# ============================================================================
# Distance Analytics Endpoint
# ============================================================================

@router.get(
    "/analytics/distance",
    summary="Get Distance Analytics",
    description="""
Get detailed distance statistics and distribution.

Returns:
- **distribution**: Count by distance bands
- **statistics**: Mean, median, percentiles
- **by_type**: Breakdown by aircraft type
- **by_hour**: Peak distances by hour
    """,
    responses={
        200: {
            "description": "Distance analytics",
            "content": {
                "application/json": {
                    "example": {
                        "distribution": {"0-25nm": 234, "25-50nm": 156},
                        "statistics": {"mean_nm": 52.3, "max_nm": 245.3}
                    }
                }
            }
        }
    }
)
async def get_distance_analytics(
    hours: int = Query(24, ge=1, le=168, description="Time range in hours"),
    military_only: bool = Query(False, description="Only military aircraft"),
    aircraft_type: Optional[str] = Query(None, description="Filter by aircraft type codes"),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed distance analytics."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Build conditions
    conditions = [
        AircraftSession.last_seen > cutoff,
        AircraftSession.max_distance_nm.isnot(None)
    ]
    if military_only:
        conditions.append(AircraftSession.is_military == True)
    if aircraft_type:
        types = [t.strip().upper() for t in aircraft_type.split(",")]
        conditions.append(AircraftSession.aircraft_type.in_(types))

    # Get all distances for statistics
    distances_query = (
        select(AircraftSession.max_distance_nm, AircraftSession.aircraft_type)
        .where(and_(*conditions))
    )
    distances_result = await db_execute_safe(db, distances_query)

    distances = []
    type_distances = {}

    if distances_result:
        for row in distances_result:
            if row.max_distance_nm:
                distances.append(row.max_distance_nm)
                ac_type = row.aircraft_type or "Unknown"
                if ac_type not in type_distances:
                    type_distances[ac_type] = []
                type_distances[ac_type].append(row.max_distance_nm)

    # Calculate distribution buckets
    distribution = {
        "0-25nm": sum(1 for d in distances if d < 25),
        "25-50nm": sum(1 for d in distances if 25 <= d < 50),
        "50-100nm": sum(1 for d in distances if 50 <= d < 100),
        "100-150nm": sum(1 for d in distances if 100 <= d < 150),
        "150-200nm": sum(1 for d in distances if 150 <= d < 200),
        "200+nm": sum(1 for d in distances if d >= 200),
    }

    # Calculate statistics
    stats = {}
    if distances:
        sorted_distances = sorted(distances)
        stats = {
            "count": len(distances),
            "mean_nm": round(statistics.mean(distances), 1),
            "median_nm": round(statistics.median(distances), 1),
            "std_dev_nm": round(statistics.stdev(distances), 1) if len(distances) > 1 else 0,
            "min_nm": round(min(distances), 1),
            "max_nm": round(max(distances), 1),
            "percentile_25": round(sorted_distances[len(sorted_distances) // 4], 1),
            "percentile_75": round(sorted_distances[3 * len(sorted_distances) // 4], 1),
            "percentile_90": round(sorted_distances[int(len(sorted_distances) * 0.9)], 1),
            "percentile_95": round(sorted_distances[int(len(sorted_distances) * 0.95)], 1),
        }

    # By aircraft type
    by_type = []
    for ac_type, dists in sorted(type_distances.items(), key=lambda x: max(x[1]) if x[1] else 0, reverse=True)[:10]:
        if dists:
            by_type.append({
                "type": ac_type,
                "count": len(dists),
                "mean_nm": round(statistics.mean(dists), 1),
                "max_nm": round(max(dists), 1),
            })

    return {
        "distribution": distribution,
        "statistics": stats,
        "by_type": by_type,
        "time_range_hours": hours,
    }


# ============================================================================
# Speed Analytics Endpoint
# ============================================================================

@router.get(
    "/analytics/speed",
    summary="Get Speed Analytics",
    description="""
Get detailed ground speed statistics and distribution.

Returns:
- **distribution**: Count by speed bands
- **statistics**: Mean, max, percentiles
- **by_type**: Speed breakdown by aircraft type
- **fastest_sessions**: Fastest recorded sessions
    """,
    responses={
        200: {
            "description": "Speed analytics",
            "content": {
                "application/json": {
                    "example": {
                        "distribution": {"0-200kt": 45, "200-400kt": 156},
                        "statistics": {"mean_kt": 385, "max_kt": 580}
                    }
                }
            }
        }
    }
)
async def get_speed_analytics(
    hours: int = Query(24, ge=1, le=168, description="Time range in hours"),
    military_only: bool = Query(False, description="Only military aircraft"),
    min_altitude: Optional[int] = Query(None, description="Minimum altitude to filter out ground traffic"),
    aircraft_type: Optional[str] = Query(None, description="Filter by aircraft type codes"),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed speed analytics."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Build conditions - use sightings for more granular speed data
    conditions = [
        AircraftSighting.timestamp > cutoff,
        AircraftSighting.ground_speed.isnot(None),
        AircraftSighting.ground_speed > 0
    ]
    if military_only:
        conditions.append(AircraftSighting.is_military == True)
    if min_altitude:
        conditions.append(AircraftSighting.altitude_baro >= min_altitude)

    # Get speed data grouped by aircraft
    speed_query = (
        select(
            AircraftSighting.icao_hex,
            AircraftSighting.callsign,
            func.max(AircraftSighting.ground_speed).label('max_speed'),
            func.avg(AircraftSighting.ground_speed).label('avg_speed'),
            func.count(AircraftSighting.id).label('sample_count')
        )
        .where(and_(*conditions))
        .group_by(AircraftSighting.icao_hex, AircraftSighting.callsign)
    )

    speed_result = await db_execute_safe(db, speed_query)

    all_speeds = []
    aircraft_speeds = []

    if speed_result:
        for row in speed_result:
            if row.max_speed:
                all_speeds.append(row.max_speed)
                aircraft_speeds.append({
                    "icao_hex": row.icao_hex,
                    "callsign": row.callsign,
                    "max_speed": round(row.max_speed),
                    "avg_speed": round(row.avg_speed) if row.avg_speed else None,
                    "samples": row.sample_count
                })

    # Calculate distribution buckets
    distribution = {
        "0-100kt": sum(1 for s in all_speeds if s < 100),
        "100-200kt": sum(1 for s in all_speeds if 100 <= s < 200),
        "200-300kt": sum(1 for s in all_speeds if 200 <= s < 300),
        "300-400kt": sum(1 for s in all_speeds if 300 <= s < 400),
        "400-500kt": sum(1 for s in all_speeds if 400 <= s < 500),
        "500+kt": sum(1 for s in all_speeds if s >= 500),
    }

    # Calculate statistics
    stats = {}
    if all_speeds:
        sorted_speeds = sorted(all_speeds)
        stats = {
            "count": len(all_speeds),
            "mean_kt": round(statistics.mean(all_speeds)),
            "median_kt": round(statistics.median(all_speeds)),
            "max_kt": round(max(all_speeds)),
            "percentile_90": round(sorted_speeds[int(len(sorted_speeds) * 0.9)]),
        }

    # Fastest sessions
    fastest_sessions = sorted(aircraft_speeds, key=lambda x: x['max_speed'], reverse=True)[:10]

    # Get speed by aircraft type from sightings
    type_speed_query = (
        select(
            AircraftSighting.aircraft_type,
            func.avg(AircraftSighting.ground_speed).label('avg_max_speed'),
            func.max(AircraftSighting.ground_speed).label('peak_speed'),
            func.count(AircraftSighting.id).label('count')
        )
        .where(and_(
            AircraftSighting.timestamp > cutoff,
            AircraftSighting.ground_speed.isnot(None),
            AircraftSighting.aircraft_type.isnot(None)
        ))
        .group_by(AircraftSighting.aircraft_type)
        .order_by(func.max(AircraftSighting.ground_speed).desc())
        .limit(15)
    )

    type_result = await db_execute_safe(db, type_speed_query)
    by_type = []
    if type_result:
        for row in type_result:
            by_type.append({
                "type": row.aircraft_type,
                "avg_max_speed": round(row.avg_max_speed) if row.avg_max_speed else None,
                "peak_speed": round(row.peak_speed) if row.peak_speed else None,
                "count": row.count
            })

    return {
        "distribution": distribution,
        "statistics": stats,
        "fastest_sessions": fastest_sessions,
        "by_type": by_type,
        "time_range_hours": hours,
    }


# ============================================================================
# Correlation Analytics Endpoint
# ============================================================================

@router.get(
    "/analytics/correlation",
    summary="Get Correlation Analytics",
    description="""
Get correlation and pattern analysis:
- **altitude_vs_speed**: How speed varies with altitude
- **time_of_day_patterns**: Aircraft activity by hour
- **type_distribution**: Aircraft type patterns over time
    """,
    responses={
        200: {
            "description": "Correlation analytics",
            "content": {
                "application/json": {
                    "example": {
                        "altitude_vs_speed": [
                            {"altitude_band": "0-10k", "avg_speed": 180}
                        ],
                        "time_of_day_patterns": {
                            "hourly_counts": [{"hour": 0, "count": 45}]
                        }
                    }
                }
            }
        }
    }
)
async def get_correlation_analytics(
    hours: int = Query(24, ge=1, le=168, description="Time range in hours"),
    military_only: bool = Query(False, description="Only military aircraft"),
    db: AsyncSession = Depends(get_db)
):
    """Get correlation and pattern analytics."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Build conditions
    conditions = [AircraftSighting.timestamp > cutoff]
    if military_only:
        conditions.append(AircraftSighting.is_military == True)

    # Altitude vs Speed correlation
    alt_speed_query = (
        select(
            case(
                (AircraftSighting.altitude_baro < 10000, '0-10k'),
                (AircraftSighting.altitude_baro < 20000, '10-20k'),
                (AircraftSighting.altitude_baro < 30000, '20-30k'),
                (AircraftSighting.altitude_baro < 40000, '30-40k'),
                else_='40k+'
            ).label('altitude_band'),
            func.avg(AircraftSighting.ground_speed).label('avg_speed'),
            func.count(AircraftSighting.id).label('sample_count')
        )
        .where(and_(*conditions, AircraftSighting.altitude_baro.isnot(None), AircraftSighting.ground_speed.isnot(None)))
        .group_by('altitude_band')
        .order_by('altitude_band')
    )

    alt_speed_result = await db_execute_safe(db, alt_speed_query)
    altitude_vs_speed = []
    if alt_speed_result:
        for row in alt_speed_result:
            altitude_vs_speed.append({
                "altitude_band": row.altitude_band,
                "avg_speed": round(row.avg_speed) if row.avg_speed else None,
                "sample_count": row.sample_count
            })

    # Time of day patterns (hourly)
    hour_pattern_query = (
        select(
            func.extract('hour', AircraftSighting.timestamp).label('hour'),
            func.count(func.distinct(AircraftSighting.icao_hex)).label('unique_aircraft'),
            func.count(AircraftSighting.id).label('position_count'),
            func.sum(case((AircraftSighting.is_military == True, 1), else_=0)).label('military_count')
        )
        .where(and_(*conditions))
        .group_by(func.extract('hour', AircraftSighting.timestamp))
        .order_by(func.extract('hour', AircraftSighting.timestamp))
    )

    hour_result = await db_execute_safe(db, hour_pattern_query)
    hourly_counts = []
    peak_hour = None
    peak_count = 0

    if hour_result:
        for row in hour_result:
            count = row.unique_aircraft or 0
            if count > peak_count:
                peak_count = count
                peak_hour = int(row.hour)

            hourly_counts.append({
                "hour": int(row.hour),
                "unique_aircraft": count,
                "position_count": row.position_count or 0,
                "military_count": row.military_count or 0,
                "military_pct": round((row.military_count or 0) / count * 100, 1) if count > 0 else 0
            })

    # Distance vs Altitude correlation
    dist_alt_query = (
        select(
            case(
                (AircraftSighting.distance_nm < 25, '0-25nm'),
                (AircraftSighting.distance_nm < 50, '25-50nm'),
                (AircraftSighting.distance_nm < 100, '50-100nm'),
                else_='100+nm'
            ).label('distance_band'),
            func.avg(AircraftSighting.altitude_baro).label('avg_altitude'),
            func.count(AircraftSighting.id).label('sample_count')
        )
        .where(and_(*conditions, AircraftSighting.distance_nm.isnot(None), AircraftSighting.altitude_baro.isnot(None)))
        .group_by('distance_band')
    )

    dist_alt_result = await db_execute_safe(db, dist_alt_query)
    distance_vs_altitude = []
    if dist_alt_result:
        for row in dist_alt_result:
            distance_vs_altitude.append({
                "distance_band": row.distance_band,
                "avg_altitude": round(row.avg_altitude) if row.avg_altitude else None,
                "sample_count": row.sample_count
            })

    return {
        "altitude_vs_speed": altitude_vs_speed,
        "distance_vs_altitude": distance_vs_altitude,
        "time_of_day_patterns": {
            "hourly_counts": hourly_counts,
            "peak_hour": peak_hour,
            "peak_aircraft_count": peak_count
        },
        "time_range_hours": hours,
    }


# ============================================================================
# Antenna Analytics Endpoints
# ============================================================================

@router.get(
    "/analytics/antenna/polar",
    summary="Get Antenna Polar Coverage Data",
    description="""
Get antenna reception coverage by bearing (polar diagram data).

Returns signal strength and reception counts grouped by bearing (0-360 degrees),
allowing visualization of antenna directionality and reception patterns.

**Data:**
- **bearing_data**: Reception statistics per bearing sector (36 sectors of 10° each)
- **max_distance_by_bearing**: Furthest reception by bearing
- **avg_rssi_by_bearing**: Average signal strength by bearing
    """,
    responses={
        200: {
            "description": "Polar coverage data",
            "content": {
                "application/json": {
                    "example": {
                        "bearing_data": [
                            {"bearing_start": 0, "bearing_end": 10, "count": 150, "avg_rssi": -12.5, "max_distance_nm": 125.3}
                        ],
                        "summary": {"total_sightings": 5000, "coverage_pct": 95.5}
                    }
                }
            }
        }
    }
)
async def get_antenna_polar_data(
    hours: int = Query(24, ge=1, le=168, description="Time range in hours"),
    min_distance: Optional[float] = Query(None, description="Minimum distance filter (nm)"),
    db: AsyncSession = Depends(get_db)
):
    """Get antenna polar coverage data for polar diagram visualization."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Query for bearing-grouped data (36 sectors of 10 degrees each)
    # Track represents the bearing FROM the receiver TO the aircraft
    # Use raw SQL to avoid PostgreSQL GROUP BY expression parameter issues
    if min_distance:
        bearing_sql = text("""
            SELECT
                floor(track / 10) * 10 AS bearing_sector,
                count(id) AS count,
                avg(rssi) AS avg_rssi,
                min(rssi) AS min_rssi,
                max(rssi) AS max_rssi,
                avg(distance_nm) AS avg_distance,
                max(distance_nm) AS max_distance,
                count(distinct icao_hex) AS unique_aircraft
            FROM aircraft_sightings
            WHERE timestamp > :cutoff
                AND track IS NOT NULL
                AND distance_nm IS NOT NULL
                AND distance_nm >= :min_distance
            GROUP BY floor(track / 10) * 10
            ORDER BY bearing_sector
        """)
        bearing_query = bearing_sql.bindparams(cutoff=cutoff, min_distance=min_distance)
    else:
        bearing_sql = text("""
            SELECT
                floor(track / 10) * 10 AS bearing_sector,
                count(id) AS count,
                avg(rssi) AS avg_rssi,
                min(rssi) AS min_rssi,
                max(rssi) AS max_rssi,
                avg(distance_nm) AS avg_distance,
                max(distance_nm) AS max_distance,
                count(distinct icao_hex) AS unique_aircraft
            FROM aircraft_sightings
            WHERE timestamp > :cutoff
                AND track IS NOT NULL
                AND distance_nm IS NOT NULL
            GROUP BY floor(track / 10) * 10
            ORDER BY bearing_sector
        """)
        bearing_query = bearing_sql.bindparams(cutoff=cutoff)

    result = await db_execute_safe(db, bearing_query)

    bearing_data = []
    total_count = 0
    sectors_with_data = 0

    if result:
        for row in result.mappings():
            sector = int(row['bearing_sector']) if row['bearing_sector'] is not None else 0
            count = row['count'] or 0
            total_count += count
            if count > 0:
                sectors_with_data += 1

            bearing_data.append({
                "bearing_start": sector,
                "bearing_end": (sector + 10) % 360,
                "count": count,
                "avg_rssi": round(float(row['avg_rssi']), 1) if row['avg_rssi'] else None,
                "min_rssi": round(float(row['min_rssi']), 1) if row['min_rssi'] else None,
                "max_rssi": round(float(row['max_rssi']), 1) if row['max_rssi'] else None,
                "avg_distance_nm": round(float(row['avg_distance']), 1) if row['avg_distance'] else None,
                "max_distance_nm": round(float(row['max_distance']), 1) if row['max_distance'] else None,
                "unique_aircraft": row['unique_aircraft'] or 0,
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


@router.get(
    "/analytics/antenna/rssi",
    summary="Get RSSI vs Distance Data",
    description="""
Get signal strength (RSSI) correlation with distance.

Returns data points showing how signal strength varies with distance,
useful for diagnosing antenna and SDR performance.

**Data:**
- **scatter_data**: Individual data points (sampled for performance)
- **band_statistics**: Aggregated statistics by distance bands
- **overall_statistics**: Overall RSSI statistics
    """,
    responses={
        200: {
            "description": "RSSI vs distance data",
            "content": {
                "application/json": {
                    "example": {
                        "scatter_data": [
                            {"distance_nm": 25.3, "rssi": -8.5, "altitude": 35000}
                        ],
                        "band_statistics": [
                            {"band": "0-25nm", "avg_rssi": -5.2, "count": 500}
                        ]
                    }
                }
            }
        }
    }
)
async def get_rssi_distance_data(
    hours: int = Query(24, ge=1, le=168, description="Time range in hours"),
    sample_size: int = Query(500, ge=100, le=2000, description="Max scatter points to return"),
    db: AsyncSession = Depends(get_db)
):
    """Get RSSI vs distance correlation data for scatter plot visualization."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Build conditions
    conditions = [
        AircraftSighting.timestamp > cutoff,
        AircraftSighting.rssi.isnot(None),
        AircraftSighting.distance_nm.isnot(None),
        AircraftSighting.distance_nm > 0,
    ]

    # Get sampled scatter data points
    # Using a simple sampling approach: order by id and take every Nth record
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

    scatter_result = await db_execute_safe(db, scatter_query)

    scatter_data = []
    if scatter_result:
        for row in scatter_result:
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

    band_result = await db_execute_safe(db, band_query)

    band_statistics = []
    total_count = 0
    all_rssi = []

    if band_result:
        for row in band_result:
            count = row.count or 0
            total_count += count
            if row.avg_rssi:
                all_rssi.extend([row.avg_rssi] * min(count, 100))  # Weighted approx

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
    band_statistics.sort(key=lambda x: band_order.index(x['band']) if x['band'] in band_order else 99)

    # Calculate overall statistics
    overall_stats = {}
    if all_rssi:
        overall_stats = {
            "count": total_count,
            "avg_rssi": round(statistics.mean(all_rssi), 1),
            "median_rssi": round(statistics.median(all_rssi), 1),
        }

    # Calculate linear regression trend line (simple least squares)
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
                "interpretation": f"RSSI decreases by {abs(round(slope * 10, 2))} dB per 10nm" if slope < 0 else f"RSSI increases by {round(slope * 10, 2)} dB per 10nm"
            }

    return {
        "scatter_data": scatter_data,
        "band_statistics": band_statistics,
        "overall_statistics": overall_stats,
        "trend_line": trend_line,
        "time_range_hours": hours,
        "sample_size": len(scatter_data),
    }


@router.get(
    "/analytics/antenna/summary",
    summary="Get Antenna Performance Summary",
    description="""
Get overall antenna performance summary statistics.

Returns key metrics for antenna diagnostics:
- Reception range statistics
- Signal strength statistics
- Coverage analysis
- Performance over time
    """,
    responses={
        200: {
            "description": "Antenna performance summary",
            "content": {
                "application/json": {
                    "example": {
                        "range": {"max_nm": 250.0, "avg_nm": 85.3, "percentile_90": 180.5},
                        "signal": {"avg_rssi": -10.5, "best_rssi": -2.1},
                        "coverage": {"sectors_active": 35, "coverage_pct": 97.2}
                    }
                }
            }
        }
    }
)
async def get_antenna_summary(
    hours: int = Query(24, ge=1, le=168, description="Time range in hours"),
    db: AsyncSession = Depends(get_db)
):
    """Get antenna performance summary statistics."""
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

    range_result = await db_execute_safe(db, range_query)
    range_stats = range_result.first() if range_result else None

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

    rssi_result = await db_execute_safe(db, rssi_query)
    rssi_stats = rssi_result.first() if rssi_result else None

    # Get coverage by bearing (count of unique sectors with data)
    coverage_query = (
        select(
            func.count(func.distinct(func.floor(AircraftSighting.track / 10))).label('sectors_with_data')
        )
        .where(and_(*conditions, AircraftSighting.track.isnot(None)))
    )

    coverage_result = await db_execute_safe(db, coverage_query)
    coverage_data = coverage_result.scalar() if coverage_result else 0

    # Get distance percentiles (approximation using subquery)
    distances = []
    dist_query = (
        select(AircraftSighting.distance_nm)
        .where(and_(*conditions))
        .order_by(AircraftSighting.distance_nm)
        .limit(10000)
    )
    dist_result = await db_execute_safe(db, dist_query)
    if dist_result:
        distances = [row.distance_nm for row in dist_result if row.distance_nm]

    percentiles = {}
    if distances:
        sorted_dist = sorted(distances)
        n = len(sorted_dist)
        percentiles = {
            "p50": round(sorted_dist[n // 2], 1),
            "p75": round(sorted_dist[int(n * 0.75)], 1),
            "p90": round(sorted_dist[int(n * 0.90)], 1),
            "p95": round(sorted_dist[int(n * 0.95)], 1),
        }

    return {
        "range": {
            "total_sightings": range_stats.total_sightings if range_stats else 0,
            "unique_aircraft": range_stats.unique_aircraft if range_stats else 0,
            "avg_nm": round(range_stats.avg_distance, 1) if range_stats and range_stats.avg_distance else None,
            "max_nm": round(range_stats.max_distance, 1) if range_stats and range_stats.max_distance else None,
            "min_nm": round(range_stats.min_distance, 1) if range_stats and range_stats.min_distance else None,
            **percentiles,
        },
        "signal": {
            "avg_rssi": round(rssi_stats.avg_rssi, 1) if rssi_stats and rssi_stats.avg_rssi else None,
            "best_rssi": round(rssi_stats.max_rssi, 1) if rssi_stats and rssi_stats.max_rssi else None,
            "worst_rssi": round(rssi_stats.min_rssi, 1) if rssi_stats and rssi_stats.min_rssi else None,
        },
        "coverage": {
            "sectors_active": coverage_data or 0,
            "total_sectors": 36,
            "coverage_pct": round((coverage_data or 0) / 36 * 100, 1),
        },
        "time_range_hours": hours,
    }
