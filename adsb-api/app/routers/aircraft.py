"""
Aircraft API endpoints for real-time ADS-B tracking.
"""
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Path, Query, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import (
    get_settings, get_db, calculate_distance_nm,
    is_valid_position, simplify_aircraft
)
from app.models import AircraftSighting, AircraftInfo
from app.schemas import (
    AircraftListResponse, TopAircraftResponse, AircraftStatsResponse,
    AircraftBase, ErrorResponse
)

router = APIRouter(prefix="/api/v1", tags=["Aircraft"])
settings = get_settings()


def _convert_to_dict(sighting: AircraftSighting, info: Optional[AircraftInfo] = None) -> dict:
    """
    Convert AircraftSighting model to dictionary format expected by frontend.
    Enrich with AircraftInfo (cached external data) if available.
    """
    ac_data = {
        "hex": sighting.icao_hex,
        "flight": sighting.callsign,
        "lat": sighting.latitude,
        "lon": sighting.longitude,
        "alt_baro": sighting.altitude_baro,
        "alt_geom": sighting.altitude_geom,
        "gs": sighting.ground_speed,
        "track": sighting.track,
        "baro_rate": sighting.vertical_rate,
        "squawk": sighting.squawk,
        "category": sighting.category,
        "distance_nm": sighting.distance_nm,
        "rssi": sighting.rssi,
        "t": sighting.aircraft_type,
        "dbFlags": 1 if sighting.is_military else 0,
        "seen": (datetime.utcnow() - sighting.timestamp).total_seconds(),
        "messages": 0, # Legacy field
        "source": sighting.source
    }

    # Enrich with external DB info if available
    if info:
        # Standard keys often used by readsb/tar1090 frontends
        ac_data.update({
            "r": info.registration,
            "t": info.type_code or sighting.aircraft_type,
            "desc": info.type_name or f"{info.manufacturer or ''} {info.model or ''}".strip(),
            "ownOp": info.operator,
            "year": info.year_built,
        })
        
        # Verbose keys for our UI
        ac_data.update({
            "registration": info.registration,
            "type_code": info.type_code,
            "type_description": info.type_name,
            "manufacturer": info.manufacturer,
            "model": info.model,
            "operator": info.operator,
            "photo_url": info.photo_url,
            "photo_thumbnail_url": info.photo_thumbnail_url,
            "has_photo": bool(info.photo_url)
        })

    return ac_data


async def _get_current_aircraft(db: AsyncSession, source: Optional[str] = None) -> List[dict]:
    """
    Helper to fetch currently active aircraft from DB.
    Joins AircraftSighting (live) with AircraftInfo (cached metadata).
    """
    # Fetch distinct aircraft seen in the last 2 minutes
    cutoff = datetime.utcnow() - timedelta(minutes=2)
    
    # Query: Select latest Sighting joined with Info
    # DISTINCT ON (icao_hex) ensures we get the single latest sighting per aircraft
    query = (
        select(AircraftSighting, AircraftInfo)
        .outerjoin(AircraftInfo, AircraftSighting.icao_hex == AircraftInfo.icao_hex)
        .distinct(AircraftSighting.icao_hex)
        .order_by(AircraftSighting.icao_hex, AircraftSighting.timestamp.desc())
        .where(AircraftSighting.timestamp > cutoff)
    )
    
    if source:
        query = query.where(AircraftSighting.source == source)
        
    result = await db.execute(query)
    rows = result.all()
    
    # Convert tuples (Sighting, Info) to dicts
    return [_convert_to_dict(sighting, info) for sighting, info in rows]


@router.get(
    "/aircraft",
    response_model=AircraftListResponse,
    summary="Get All Tracked Aircraft",
    description="""
Retrieve all aircraft currently being tracked by the ADS-B receiver.
Data is retrieved from the database, populated by the background ingestion task.
Includes cached external data (photos, registration) if available.
    """,
    responses={
        200: {
            "description": "List of tracked aircraft",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"}
    }
)
async def get_aircraft(db: AsyncSession = Depends(get_db)):
    """Get all currently tracked aircraft from database."""
    try:
        aircraft_list = await _get_current_aircraft(db)
        
        return AircraftListResponse(
            aircraft=aircraft_list,
            count=len(aircraft_list),
            now=datetime.utcnow().timestamp(),
            messages=0,
            timestamp=datetime.utcnow().isoformat() + "Z"
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error fetching aircraft data: {str(e)}")


@router.get(
    "/aircraft/top",
    response_model=TopAircraftResponse,
    summary="Get Top Aircraft by Category",
    description="""
Get the top 5 aircraft in various categories.

Data is pre-computed every ~5 seconds and served from cache.
    """,
    responses={
        200: {
            "description": "Top aircraft by category",
        },
        503: {"model": ErrorResponse, "description": "Stats not yet available"}
    }
)
async def get_top_aircraft():
    """Get top aircraft by various criteria (closest, highest, fastest, climbing, military)."""
    from app.services.stats_cache import get_top_aircraft as get_cached_top

    cached = get_cached_top()
    if cached is None:
        raise HTTPException(status_code=503, detail="Stats not yet available, please retry in a few seconds")
    return cached


@router.get(
    "/aircraft/stats",
    response_model=AircraftStatsResponse,
    summary="Get Aircraft Statistics",
    description="""
Get aggregate statistics about currently tracked aircraft.

Data is pre-computed every ~5 seconds and served from cache.
Note: Filters are not supported in cached mode - use Socket.IO subscribe_stats for filtered stats.
    """,
    responses={
        200: {"description": "Aircraft statistics"},
        503: {"model": ErrorResponse, "description": "Stats not yet available"}
    }
)
async def get_aircraft_stats():
    """Get aggregate statistics about currently tracked aircraft."""
    from app.services.stats_cache import get_aircraft_stats as get_cached_stats

    cached = get_cached_stats()
    if cached is None:
        raise HTTPException(status_code=503, detail="Stats not yet available, please retry in a few seconds")
    return cached


@router.get(
    "/aircraft/{hex_code}",
    summary="Get Aircraft by ICAO Hex",
    description="Get detailed information about a specific aircraft from the database.",
    responses={
        200: {"description": "Aircraft found"},
        404: {"model": ErrorResponse, "description": "Aircraft not found"},
        503: {"model": ErrorResponse, "description": "Database unavailable"}
    }
)
async def get_aircraft_by_hex(
    hex_code: str = Path(..., min_length=6, max_length=10),
    db: AsyncSession = Depends(get_db)
):
    """Get specific aircraft by ICAO hex code from database."""
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=10)
        
        # Get latest sighting and info
        query = (
            select(AircraftSighting, AircraftInfo)
            .outerjoin(AircraftInfo, AircraftSighting.icao_hex == AircraftInfo.icao_hex)
            .where(AircraftSighting.icao_hex == hex_code.upper())
            .where(AircraftSighting.timestamp > cutoff)
            .order_by(AircraftSighting.timestamp.desc())
            .limit(1)
        )
        
        result = await db.execute(query)
        row = result.first()
        
        if not row:
            raise HTTPException(status_code=404, detail="Aircraft not found")
        
        sighting, info = row
        ac = _convert_to_dict(sighting, info)
        return {"aircraft": ac, "found": True}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error fetching aircraft: {str(e)}")


@router.get(
    "/uat/aircraft",
    response_model=AircraftListResponse,
    summary="Get UAT Aircraft (978 MHz)",
    description="Get aircraft from the 978 MHz UAT receiver via database.",
    responses={
        200: {"description": "UAT aircraft list"}
    }
)
async def get_uat_aircraft(db: AsyncSession = Depends(get_db)):
    """Get aircraft from 978MHz UAT receiver (US general aviation)."""
    try:
        aircraft_list = await _get_current_aircraft(db, source="978")
        
        return {
            "aircraft": aircraft_list,
            "count": len(aircraft_list),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error fetching UAT data: {str(e)}")