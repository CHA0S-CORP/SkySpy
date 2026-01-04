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
    """,
    responses={
        200: {
            "description": "Top aircraft by category",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"}
    }
)
async def get_top_aircraft(db: AsyncSession = Depends(get_db)):
    """Get top aircraft by various criteria (closest, highest, fastest, climbing, military)."""
    try:
        aircraft = await _get_current_aircraft(db)
        
        # We process in memory because N is small (<1000) and it's cleaner than 5 complex DB queries
        
        # Top 5 by closest
        closest = sorted(
            [a for a in aircraft if is_valid_position(a.get("lat"), a.get("lon"))],
            key=lambda x: x.get("distance_nm") if x.get("distance_nm") is not None else 99999
        )[:5]
        
        # Top 5 by altitude
        highest = sorted(
            [a for a in aircraft if isinstance(a.get("alt_baro"), (int, float))],
            key=lambda x: x["alt_baro"],
            reverse=True
        )[:5]
        
        # Top 5 by speed
        fastest = sorted(
            [a for a in aircraft if a.get("gs")],
            key=lambda x: x["gs"],
            reverse=True
        )[:5]
        
        # Top 5 by vertical rate
        climbing = sorted(
            [a for a in aircraft if a.get("baro_rate")],
            key=lambda x: abs(x.get("baro_rate", 0)),
            reverse=True
        )[:5]
        
        # Military
        military = [a for a in aircraft if a.get("dbFlags", 0) & 1][:5]
        
        return {
            "closest": [simplify_aircraft(a, a.get("distance_nm")) for a in closest],
            "highest": [simplify_aircraft(a, a.get("distance_nm")) for a in highest],
            "fastest": [simplify_aircraft(a, a.get("distance_nm")) for a in fastest],
            "climbing": [simplify_aircraft(a, a.get("distance_nm")) for a in climbing],
            "military": [simplify_aircraft(a, a.get("distance_nm")) for a in military],
            "total": len(aircraft),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error fetching aircraft data: {str(e)}")


@router.get(
    "/aircraft/stats",
    response_model=AircraftStatsResponse,
    summary="Get Aircraft Statistics",
    description="Get aggregate statistics about currently tracked aircraft.",
    responses={
        200: {"description": "Aircraft statistics"},
        503: {"model": ErrorResponse, "description": "Database unavailable"}
    }
)
async def get_aircraft_stats(
    category: Optional[str] = Query(None, description="Filter by aircraft category"),
    military_only: bool = Query(False, description="Only include military aircraft"),
    min_altitude: Optional[int] = Query(None, description="Minimum altitude in feet"),
    max_altitude: Optional[int] = Query(None, description="Maximum altitude in feet"),
    min_distance: Optional[float] = Query(None, description="Minimum distance from feeder"),
    max_distance: Optional[float] = Query(None, description="Maximum distance from feeder"),
    db: AsyncSession = Depends(get_db)
):
    """Get aggregate statistics about currently tracked aircraft with optional filters."""
    try:
        aircraft = await _get_current_aircraft(db)
        
        # Build filters applied tracking
        filters_applied = {}

        # Apply filters
        if category:
            categories_list = [c.strip().upper() for c in category.split(",")]
            aircraft = [a for a in aircraft if a.get("category", "").upper() in categories_list]
            filters_applied["category"] = categories_list

        if military_only:
            aircraft = [a for a in aircraft if a.get("dbFlags", 0) & 1]
            filters_applied["military_only"] = True

        if min_altitude is not None:
            aircraft = [
                a for a in aircraft
                if isinstance(a.get("alt_baro"), (int, float)) and a["alt_baro"] >= min_altitude
            ]
            filters_applied["min_altitude"] = min_altitude

        if max_altitude is not None:
            aircraft = [
                a for a in aircraft
                if isinstance(a.get("alt_baro"), (int, float)) and a["alt_baro"] <= max_altitude
            ]
            filters_applied["max_altitude"] = max_altitude

        if min_distance is not None:
            aircraft = [
                a for a in aircraft
                if a.get("distance_nm") is not None and a["distance_nm"] >= min_distance
            ]
            filters_applied["min_distance"] = min_distance

        if max_distance is not None:
            aircraft = [
                a for a in aircraft
                if a.get("distance_nm") is not None and a["distance_nm"] <= max_distance
            ]
            filters_applied["max_distance"] = max_distance

        with_pos = sum(1 for a in aircraft if is_valid_position(a.get("lat"), a.get("lon")))
        military_count = sum(1 for a in aircraft if a.get("dbFlags", 0) & 1)
        emergency = [
            {"hex": a.get("hex"), "flight": a.get("flight"), "squawk": a.get("squawk")}
            for a in aircraft if a.get("squawk") in ["7500", "7600", "7700"]
        ]

        # Category breakdown
        categories_count = {}
        for a in aircraft:
            cat = a.get("category", "unknown")
            categories_count[cat] = categories_count.get(cat, 0) + 1

        # Altitude breakdown
        alt_ground = sum(
            1 for a in aircraft
            if a.get("alt_baro") == "ground" or
            (isinstance(a.get("alt_baro"), (int, float)) and a.get("alt_baro", 99999) <= 0)
        )
        alt_low = sum(
            1 for a in aircraft
            if isinstance(a.get("alt_baro"), (int, float)) and 0 < a["alt_baro"] < 10000
        )
        alt_med = sum(
            1 for a in aircraft
            if isinstance(a.get("alt_baro"), (int, float)) and 10000 <= a["alt_baro"] < 30000
        )
        alt_high = sum(
            1 for a in aircraft
            if isinstance(a.get("alt_baro"), (int, float)) and a["alt_baro"] >= 30000
        )

        # Distance breakdown
        dist_close = sum(1 for a in aircraft if a.get("distance_nm") is not None and a["distance_nm"] < 25)
        dist_near = sum(1 for a in aircraft if a.get("distance_nm") is not None and 25 <= a["distance_nm"] < 50)
        dist_mid = sum(1 for a in aircraft if a.get("distance_nm") is not None and 50 <= a["distance_nm"] < 100)
        dist_far = sum(1 for a in aircraft if a.get("distance_nm") is not None and a["distance_nm"] >= 100)

        # Speed breakdown
        speed_slow = sum(1 for a in aircraft if a.get("gs") and a["gs"] < 200)
        speed_med = sum(1 for a in aircraft if a.get("gs") and 200 <= a["gs"] < 400)
        speed_fast = sum(1 for a in aircraft if a.get("gs") and a["gs"] >= 400)

        return {
            "total": len(aircraft),
            "with_position": with_pos,
            "military": military_count,
            "emergency": emergency,
            "categories": categories_count,
            "altitude": {"ground": alt_ground, "low": alt_low, "medium": alt_med, "high": alt_high},
            "distance": {"close": dist_close, "near": dist_near, "mid": dist_mid, "far": dist_far},
            "speed": {"slow": speed_slow, "medium": speed_med, "fast": speed_fast},
            "messages": 0,
            "filters_applied": filters_applied if filters_applied else None,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error fetching stats: {str(e)}")


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