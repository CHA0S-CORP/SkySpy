"""
Historical data API endpoints.

Query and analyze historical aircraft sightings and tracking sessions
stored in the PostgreSQL database.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Path
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models import AircraftSighting, AircraftSession, SafetyEvent
from app.schemas import (
    SightingsListResponse, SessionsListResponse, HistoryStatsResponse
)

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
    
    result = await db.execute(query)
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
        safety_result = await db.execute(safety_query)
        safety_events = safety_result.all()

        # Count safety events for each session
        for s in session_list:
            count = 0
            for event in safety_events:
                # Check if event involves this aircraft and falls within session time
                if (event.icao_hex == s.icao_hex or event.icao_hex_2 == s.icao_hex):
                    if s.first_seen <= event.timestamp <= s.last_seen:
                        count += 1
            safety_counts[s.id] = count

    for s in session_list:
        duration = (s.last_seen - s.first_seen).total_seconds() / 60
        sessions.append({
            "icao_hex": s.icao_hex,
            "callsign": s.callsign,
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

Returns:
- Total sightings and sessions
- Unique aircraft count
- Military session count
- Time range covered
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
                        "time_range_hours": 24
                    }
                }
            }
        }
    }
)
async def get_stats(
    hours: int = Query(24, ge=1, le=168, description="Time range for statistics"),
    db: AsyncSession = Depends(get_db)
):
    """Get historical data statistics."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    sightings_count = (await db.execute(
        select(func.count(AircraftSighting.id)).where(AircraftSighting.timestamp > cutoff)
    )).scalar()
    
    sessions_count = (await db.execute(
        select(func.count(AircraftSession.id)).where(AircraftSession.last_seen > cutoff)
    )).scalar()
    
    unique_aircraft = (await db.execute(
        select(func.count(func.distinct(AircraftSession.icao_hex)))
        .where(AircraftSession.last_seen > cutoff)
    )).scalar()
    
    military_sessions = (await db.execute(
        select(func.count(AircraftSession.id))
        .where(and_(AircraftSession.last_seen > cutoff, AircraftSession.is_military == True))
    )).scalar()
    
    return {
        "total_sightings": sightings_count,
        "total_sessions": sessions_count,
        "unique_aircraft": unique_aircraft,
        "military_sessions": military_sessions,
        "time_range_hours": hours,
    }
