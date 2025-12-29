"""
Aircraft API endpoints for real-time ADS-B tracking.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import JSONResponse

from app.core import (
    get_settings, cached, safe_request, calculate_distance_nm,
    is_valid_position, simplify_aircraft
)
from app.schemas import (
    AircraftListResponse, TopAircraftResponse, AircraftStatsResponse,
    AircraftBase, ErrorResponse
)

router = APIRouter(prefix="/api/v1", tags=["Aircraft"])
settings = get_settings()


@router.get(
    "/aircraft",
    response_model=AircraftListResponse,
    summary="Get All Tracked Aircraft",
    description="""
Retrieve all aircraft currently being tracked by the ADS-B receiver.

Each aircraft includes:
- **hex**: ICAO 24-bit address (unique identifier)
- **flight**: Callsign/flight number
- **lat/lon**: Position coordinates
- **alt_baro**: Barometric altitude in feet
- **gs**: Ground speed in knots
- **track**: Ground track in degrees
- **baro_rate**: Vertical rate in feet/minute
- **squawk**: Transponder code
- **category**: Aircraft wake category
- **distance_nm**: Calculated distance from feeder

Data is refreshed every 2 seconds.
    """,
    responses={
        200: {
            "description": "List of tracked aircraft",
            "content": {
                "application/json": {
                    "example": {
                        "aircraft": [
                            {
                                "hex": "A12345",
                                "flight": "UAL123",
                                "lat": 47.6062,
                                "lon": -122.3321,
                                "alt_baro": 35000,
                                "gs": 450,
                                "track": 270,
                                "distance_nm": 15.2
                            }
                        ],
                        "count": 1,
                        "now": 1703123456.789,
                        "messages": 152340,
                        "timestamp": "2024-12-21T12:00:00Z"
                    }
                }
            }
        },
        503: {"model": ErrorResponse, "description": "ADS-B data source unavailable"}
    }
)
@cached(ttl_seconds=2)
async def get_aircraft():
    """Get all currently tracked aircraft with calculated distance from feeder."""
    url = f"{settings.ultrafeeder_url}/data/aircraft.json"
    data = await safe_request(url)
    
    if not data:
        return AircraftListResponse(
            aircraft=[],
            count=0,
            timestamp=datetime.utcnow().isoformat() + "Z"
        )
    
    aircraft = data.get("aircraft", [])
    
    for ac in aircraft:
        lat, lon = ac.get("lat"), ac.get("lon")
        if is_valid_position(lat, lon):
            ac["distance_nm"] = round(
                calculate_distance_nm(settings.feeder_lat, settings.feeder_lon, lat, lon), 1
            )
    
    return AircraftListResponse(
        aircraft=aircraft,
        count=len(aircraft),
        now=data.get("now"),
        messages=data.get("messages", 0),
        timestamp=datetime.utcnow().isoformat() + "Z"
    )


@router.get(
    "/aircraft/top",
    response_model=TopAircraftResponse,
    summary="Get Top Aircraft by Category",
    description="""
Get the top 5 aircraft in various categories:

- **closest**: Aircraft nearest to the feeder location
- **highest**: Aircraft at highest altitude
- **fastest**: Aircraft with highest ground speed
- **climbing**: Aircraft with highest vertical rate (climb or descent)
- **military**: Military aircraft currently tracked

Each category returns simplified aircraft data for quick overview.
    """,
    responses={
        200: {
            "description": "Top aircraft by category",
            "content": {
                "application/json": {
                    "example": {
                        "closest": [{"hex": "A12345", "flight": "UAL123", "distance_nm": 2.5}],
                        "highest": [{"hex": "B67890", "flight": "DAL456", "alt": 45000}],
                        "fastest": [{"hex": "C11111", "flight": "AAL789", "gs": 550}],
                        "climbing": [{"hex": "D22222", "flight": "SWA321", "vr": 4500}],
                        "military": [{"hex": "AE1234", "flight": "EVAC01", "military": True}],
                        "total": 45,
                        "timestamp": "2024-12-21T12:00:00Z"
                    }
                }
            }
        },
        503: {"model": ErrorResponse, "description": "ADS-B data source unavailable"}
    }
)
@cached(ttl_seconds=5)
async def get_top_aircraft():
    """Get top aircraft by various criteria (closest, highest, fastest, climbing, military)."""
    url = f"{settings.ultrafeeder_url}/data/aircraft.json"
    data = await safe_request(url)
    
    if not data:
        raise HTTPException(status_code=503, detail="Unable to fetch aircraft data")
    
    aircraft = data.get("aircraft", [])
    
    # Add distance to all
    for ac in aircraft:
        lat, lon = ac.get("lat"), ac.get("lon")
        if is_valid_position(lat, lon):
            ac["distance_nm"] = calculate_distance_nm(
                settings.feeder_lat, settings.feeder_lon, lat, lon
            )
        else:
            ac["distance_nm"] = 99999
    
    # Top 5 by closest
    closest = sorted(
        [a for a in aircraft if is_valid_position(a.get("lat"), a.get("lon"))],
        key=lambda x: x["distance_nm"]
    )[:5]
    
    # Top 5 by altitude
    highest = sorted(
        [a for a in aircraft if isinstance(a.get("alt_baro"), int)],
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


@router.get(
    "/aircraft/stats",
    response_model=AircraftStatsResponse,
    summary="Get Aircraft Statistics",
    description="""
Get aggregate statistics about currently tracked aircraft.

Returns:
- **total**: Total aircraft count
- **with_position**: Aircraft with valid GPS position
- **military**: Military aircraft count
- **emergency**: Aircraft squawking emergency codes (7500/7600/7700)
- **categories**: Count by aircraft category (A0-D7)
- **altitude**: Count by altitude band (ground, low, medium, high)
- **messages**: Total messages received by feeder

Altitude bands:
- Ground: On ground or ≤0 ft
- Low: 1-9,999 ft
- Medium: 10,000-29,999 ft
- High: ≥30,000 ft
    """,
    responses={
        200: {
            "description": "Aircraft statistics",
            "content": {
                "application/json": {
                    "example": {
                        "total": 45,
                        "with_position": 42,
                        "military": 2,
                        "emergency": [],
                        "categories": {"A3": 25, "A5": 10, "A1": 5, "unknown": 5},
                        "altitude": {"ground": 3, "low": 5, "medium": 12, "high": 25},
                        "messages": 152340,
                        "timestamp": "2024-12-21T12:00:00Z"
                    }
                }
            }
        },
        503: {"model": ErrorResponse, "description": "ADS-B data source unavailable"}
    }
)
@cached(ttl_seconds=5)
async def get_aircraft_stats():
    """Get aggregate statistics about currently tracked aircraft."""
    url = f"{settings.ultrafeeder_url}/data/aircraft.json"
    data = await safe_request(url)
    
    if not data:
        raise HTTPException(status_code=503, detail="Unable to fetch aircraft data")
    
    aircraft = data.get("aircraft", [])
    
    with_pos = sum(1 for a in aircraft if is_valid_position(a.get("lat"), a.get("lon")))
    military = sum(1 for a in aircraft if a.get("dbFlags", 0) & 1)
    emergency = [
        {"hex": a.get("hex"), "flight": a.get("flight"), "squawk": a.get("squawk")}
        for a in aircraft if a.get("squawk") in ["7500", "7600", "7700"]
    ]
    
    # Category breakdown
    categories = {}
    for a in aircraft:
        cat = a.get("category", "unknown")
        categories[cat] = categories.get(cat, 0) + 1
    
    # Altitude breakdown
    alt_ground = sum(
        1 for a in aircraft
        if a.get("alt_baro") == "ground" or
        (isinstance(a.get("alt_baro"), int) and a.get("alt_baro", 99999) <= 0)
    )
    alt_low = sum(
        1 for a in aircraft
        if isinstance(a.get("alt_baro"), int) and 0 < a["alt_baro"] < 10000
    )
    alt_med = sum(
        1 for a in aircraft
        if isinstance(a.get("alt_baro"), int) and 10000 <= a["alt_baro"] < 30000
    )
    alt_high = sum(
        1 for a in aircraft
        if isinstance(a.get("alt_baro"), int) and a["alt_baro"] >= 30000
    )
    
    return AircraftStatsResponse(
        total=len(aircraft),
        with_position=with_pos,
        military=military,
        emergency=emergency,
        categories=categories,
        altitude={"ground": alt_ground, "low": alt_low, "medium": alt_med, "high": alt_high},
        messages=data.get("messages", 0),
        timestamp=datetime.utcnow().isoformat() + "Z"
    )


@router.get(
    "/aircraft/{hex_code}",
    summary="Get Aircraft by ICAO Hex",
    description="""
Get detailed information about a specific aircraft by its ICAO 24-bit hex address.

The ICAO hex is a unique identifier assigned to each aircraft transponder.
Examples: A12345, 4B1234, 80ABCD

Returns full aircraft data including all available fields from the transponder.
    """,
    responses={
        200: {
            "description": "Aircraft found",
            "content": {
                "application/json": {
                    "example": {
                        "aircraft": {
                            "hex": "A12345",
                            "flight": "UAL123",
                            "lat": 47.6062,
                            "lon": -122.3321,
                            "alt_baro": 35000,
                            "alt_geom": 35100,
                            "gs": 450,
                            "track": 270,
                            "baro_rate": 0,
                            "squawk": "1200",
                            "category": "A3",
                            "distance_nm": 15.2,
                            "messages": 1523,
                            "seen": 0.1,
                            "rssi": -8.5
                        },
                        "found": True
                    }
                }
            }
        },
        404: {"model": ErrorResponse, "description": "Aircraft not found"},
        503: {"model": ErrorResponse, "description": "ADS-B data source unavailable"}
    }
)
async def get_aircraft_by_hex(
    hex_code: str = Path(
        ...,
        description="ICAO 24-bit hex address",
        example="A12345",
        min_length=6,
        max_length=10
    )
):
    """Get specific aircraft by ICAO hex code."""
    url = f"{settings.ultrafeeder_url}/data/aircraft.json"
    data = await safe_request(url)
    
    if not data:
        raise HTTPException(status_code=503, detail="Unable to fetch aircraft data")
    
    for ac in data.get("aircraft", []):
        if ac.get("hex", "").upper() == hex_code.upper():
            lat, lon = ac.get("lat"), ac.get("lon")
            if is_valid_position(lat, lon):
                ac["distance_nm"] = round(
                    calculate_distance_nm(settings.feeder_lat, settings.feeder_lon, lat, lon), 1
                )
            return {"aircraft": ac, "found": True}
    
    raise HTTPException(status_code=404, detail="Aircraft not found")


@router.get(
    "/uat/aircraft",
    response_model=AircraftListResponse,
    summary="Get UAT Aircraft (978 MHz)",
    description="""
Get aircraft from the 978 MHz UAT (Universal Access Transceiver) receiver.

UAT is used primarily in the United States for:
- General aviation below 18,000 feet
- Aircraft without Mode S transponders
- ADS-B Out compliance at lower cost

Requires a separate 978 MHz SDR receiver (dump978).
    """,
    responses={
        200: {
            "description": "UAT aircraft list",
            "content": {
                "application/json": {
                    "example": {
                        "aircraft": [
                            {"hex": "A12345", "flight": "N12345", "alt_baro": 5500}
                        ],
                        "count": 1
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=2)
async def get_uat_aircraft():
    """Get aircraft from 978MHz UAT receiver (US general aviation)."""
    url = f"{settings.dump978_url}/skyaware978/data/aircraft.json"
    data = await safe_request(url)
    
    if not data:
        return {"aircraft": [], "count": 0, "timestamp": datetime.utcnow().isoformat() + "Z"}
    
    return {
        "aircraft": data.get("aircraft", []),
        "count": len(data.get("aircraft", [])),
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
