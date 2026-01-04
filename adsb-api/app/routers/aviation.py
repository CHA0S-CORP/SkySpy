"""
Aviation data API endpoints.

Provides access to aviation weather (METAR/TAF), airports, navaids,
and other aviation reference data from aviationweather.gov.
"""
from datetime import datetime, timedelta
from math import radians, sin, cos, sqrt, atan2
from typing import Optional

from fastapi import APIRouter, Query, Path, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.core import get_settings, cached, get_db
from app.schemas import AviationDataResponse, ErrorResponse
from app.services import airspace as airspace_service
from app.services import geodata as geodata_service
from app.services import weather_cache

router = APIRouter(prefix="/api/v1/aviation", tags=["Aviation"])
settings = get_settings()

AWC_BASE = "https://aviationweather.gov/api/data"


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles between two points."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    return 2 * R * atan2(sqrt(a), sqrt(1-a))


async def fetch_awc_data(endpoint: str, params: dict) -> dict:
    """Fetch data from Aviation Weather Center API."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.get(
                f"{AWC_BASE}/{endpoint}",
                params=params,
                headers={
                    "User-Agent": "ADS-B-API/2.6 (aircraft-tracker)",
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json() if response.text else []
        except httpx.HTTPStatusError as e:
            try:
                error_body = e.response.json() if e.response.text else {}
                return {"error": error_body.get("error", str(e)), "status": e.response.status_code}
            except Exception:
                return {"error": str(e), "status": e.response.status_code}
        except Exception as e:
            return {"error": str(e)}


# =============================================================================
# List Endpoints (by location)
# =============================================================================

@router.get(
    "/metars",
    summary="Get METARs by Location",
    description="""
Get METAR observations within a geographic area.

Returns current weather observations from airports sorted by distance.

**Response includes:**
- Raw METAR text
- Decoded values (temp, wind, visibility, etc.)
- Flight category (VFR/MVFR/IFR/LIFR)
- Distance from center point

**Data Source:** Uses Redis cache when available (5-minute TTL).
Falls back to Aviation Weather Center API.

**Parameters:**
- `lat`, `lon` - Center point coordinates
- `radius` - Search radius in nautical miles (default 100)
- `limit` - Maximum results (default 20)
- `hours` - Hours of observations (default 2)
    """,
    responses={
        200: {
            "description": "METAR observations",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {
                                "icaoId": "KSEA",
                                "rawOb": "KSEA 211256Z 18008KT 10SM FEW045 12/06 A3012",
                                "temp": 12,
                                "fltcat": "VFR",
                                "distance_nm": 5.2
                            }
                        ],
                        "count": 1,
                        "center": {"lat": 47.5, "lon": -122.3},
                        "radius_nm": 100,
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
async def get_metars_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(100, ge=10, le=500, description="Search radius in nautical miles"),
    limit: int = Query(20, ge=1, le=100, description="Maximum results"),
    hours: int = Query(2, ge=1, le=24, description="Hours of observations")
):
    """Get METAR observations within a geographic area."""
    # Convert radius to bounding box
    deg_offset = radius / 60.0
    bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

    # Try Redis cache first
    cached_data = await weather_cache.get_cached_metars_bbox(bbox, hours)
    if cached_data:
        # Calculate distances for cached data
        for m in cached_data:
            m_lat = m.get("lat", 0)
            m_lon = m.get("lon", 0)
            m["distance_nm"] = round(haversine_nm(lat, lon, m_lat, m_lon), 1)

        metars = [m for m in cached_data if m.get("distance_nm", 9999) <= radius]
        metars.sort(key=lambda x: x.get("distance_nm", 9999))

        return {
            "data": metars[:limit],
            "count": min(len(metars), limit),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "redis",
            "cached": True
        }

    # Fetch from API
    data = await fetch_awc_data("metar", {
        "bbox": bbox,
        "format": "json",
        "hours": hours
    })

    if isinstance(data, dict) and "error" in data:
        weather_cache.record_metar_api_request(success=False)
        return {
            "data": [],
            "count": 0,
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "aviationweather.gov",
            "error": data["error"]
        }

    weather_cache.record_metar_api_request(success=True)
    metars = data if isinstance(data, list) else []

    # Cache the raw API response in Redis (before filtering)
    if metars:
        await weather_cache.cache_metars_bbox(bbox, metars, hours, ttl=300)

    # Calculate distances
    for m in metars:
        m_lat = m.get("lat", 0)
        m_lon = m.get("lon", 0)
        m["distance_nm"] = round(haversine_nm(lat, lon, m_lat, m_lon), 1)

    # Filter by actual radius and sort by distance
    metars = [m for m in metars if m.get("distance_nm", 9999) <= radius]
    metars.sort(key=lambda x: x.get("distance_nm", 9999))

    return {
        "data": metars[:limit],
        "count": min(len(metars), limit),
        "center": {"lat": lat, "lon": lon},
        "radius_nm": radius,
        "source": "aviationweather.gov",
        "cached": False
    }


@router.get(
    "/airports",
    summary="Get Airports by Location",
    description="""
Find airports within a geographic area.

Returns airports sorted by distance from the specified coordinates.
Useful for finding alternates or nearby airfields.

**Data Source:** Uses locally cached data (refreshed daily) for fast responses.
Falls back to Aviation Weather Center API if cache is empty.

**Parameters:**
- `lat`, `lon` - Center point coordinates
- `radius` - Search radius in nautical miles (default 50)
- `limit` - Maximum results (default 20)
    """,
    responses={
        200: {
            "description": "Nearby airports",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {"icaoId": "KSEA", "name": "Seattle-Tacoma Intl", "distance_nm": 5.2},
                            {"icaoId": "KBFI", "name": "Boeing Field", "distance_nm": 8.1}
                        ],
                        "count": 2,
                        "center": {"lat": 47.5, "lon": -122.3},
                        "radius_nm": 50,
                        "source": "database"
                    }
                }
            }
        }
    }
)
async def get_airports_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(50, ge=5, le=500, description="Search radius in nautical miles"),
    limit: int = Query(20, ge=1, le=100, description="Maximum results"),
    db: AsyncSession = Depends(get_db)
):
    """Find airports within a geographic area using cached data."""
    # Try cached data first
    airports = await geodata_service.get_cached_airports(
        db, lat=lat, lon=lon, radius_nm=radius, limit=limit
    )

    if airports:
        return {
            "data": airports,
            "count": len(airports),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "database",
            "cached": True
        }

    # Fallback to API if cache is empty
    deg_offset = radius / 60.0
    bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

    data = await fetch_awc_data("airport", {
        "bbox": bbox,
        "zoom": 8,
        "density": 3,
        "format": "json"
    })

    if isinstance(data, dict) and "error" in data:
        return {
            "data": [],
            "count": 0,
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "aviationweather.gov",
            "error": data["error"]
        }

    airports = data if isinstance(data, list) else []

    # Calculate distances
    for apt in airports:
        apt_lat = apt.get("lat", 0)
        apt_lon = apt.get("lon", 0)
        apt["distance_nm"] = round(haversine_nm(lat, lon, apt_lat, apt_lon), 1)

    # Filter and sort
    airports = [a for a in airports if a.get("distance_nm", 9999) <= radius]
    airports.sort(key=lambda x: x.get("distance_nm", 9999))

    return {
        "data": airports[:limit],
        "count": min(len(airports), limit),
        "center": {"lat": lat, "lon": lon},
        "radius_nm": radius,
        "source": "aviationweather.gov",
        "cached": False
    }


@router.get(
    "/navaids",
    summary="Get Navaids by Location",
    description="""
Find navigation aids within a geographic area.

Returns VORs, VORTACs, NDBs, and other navaids sorted by distance.
Useful for flight planning and navigation.

**Data Source:** Uses locally cached data (refreshed daily) for fast responses.
Falls back to Aviation Weather Center API if cache is empty.

**Navaid Types:**
- VOR - VHF Omnidirectional Range
- VORTAC - VOR with TACAN (military DME)
- VOR-DME - VOR with Distance Measuring Equipment
- NDB - Non-Directional Beacon
- TACAN - Tactical Air Navigation (military)
- DME - Distance Measuring Equipment

**Parameters:**
- `lat`, `lon` - Center point coordinates
- `radius` - Search radius in nautical miles (default 50)
- `limit` - Maximum results (default 20)
- `type` - Filter by navaid type (optional)
    """,
    responses={
        200: {
            "description": "Nearby navaids",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {
                                "id": "SEA",
                                "name": "SEATTLE",
                                "type": "VORTAC",
                                "freq": "116.80",
                                "distance_nm": 5.2
                            }
                        ],
                        "count": 1,
                        "center": {"lat": 47.5, "lon": -122.3},
                        "radius_nm": 50,
                        "source": "database"
                    }
                }
            }
        }
    }
)
async def get_navaids_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(50, ge=5, le=500, description="Search radius in nautical miles"),
    limit: int = Query(20, ge=1, le=100, description="Maximum results"),
    navaid_type: Optional[str] = Query(
        None,
        alias="type",
        description="Filter by navaid type",
        enum=["VOR", "VORTAC", "VOR-DME", "NDB", "TACAN", "DME"]
    ),
    db: AsyncSession = Depends(get_db)
):
    """Find navaids within a geographic area using cached data."""
    # Try cached data first
    navaids = await geodata_service.get_cached_navaids(
        db, lat=lat, lon=lon, radius_nm=radius, navaid_type=navaid_type, limit=limit
    )

    if navaids:
        return {
            "data": navaids,
            "count": len(navaids),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "database",
            "cached": True
        }

    # Fallback to API if cache is empty
    deg_offset = radius / 60.0
    bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

    data = await fetch_awc_data("navaid", {
        "bbox": bbox,
        "format": "json"
    })

    if isinstance(data, dict) and "error" in data:
        return {
            "data": [],
            "count": 0,
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "aviationweather.gov",
            "error": data["error"]
        }

    navaids = data if isinstance(data, list) else []

    # Filter by type if specified
    if navaid_type:
        navaids = [n for n in navaids if n.get("type", "").upper() == navaid_type.upper()]

    # Calculate distances
    for nav in navaids:
        nav_lat = nav.get("lat", 0)
        nav_lon = nav.get("lon", 0)
        nav["distance_nm"] = round(haversine_nm(lat, lon, nav_lat, nav_lon), 1)

    # Filter and sort
    navaids = [n for n in navaids if n.get("distance_nm", 9999) <= radius]
    navaids.sort(key=lambda x: x.get("distance_nm", 9999))

    return {
        "data": navaids[:limit],
        "count": min(len(navaids), limit),
        "center": {"lat": lat, "lon": lon},
        "radius_nm": radius,
        "source": "aviationweather.gov",
        "cached": False
    }


@router.get(
    "/pireps",
    summary="Get PIREPs by Location",
    description="""
Get Pilot Reports (PIREPs) within a geographic area.

PIREPs are reports from pilots about actual conditions:
- Turbulence intensity and altitude
- Icing conditions
- Cloud tops/bases
- Visibility
- Other significant weather

Useful for understanding real conditions aloft.

**Data Source:** Uses database cache for recent PIREPs.
Fetches from Aviation Weather Center API and stores new reports.

**Parameters:**
- `lat`, `lon` - Center point coordinates
- `radius` - Search radius in nautical miles (default 100)
- `limit` - Maximum results (default 50)
- `hours` - Hours of reports to include (default 2)
    """,
    responses={
        200: {
            "description": "Pilot reports",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "rawOb": "KSEA UA /OV SEA/TM 1230/FL350/TP B738/TB LGT",
                            "acType": "B738",
                            "fltlvl": 350,
                            "turbType": "LGT",
                            "distance_nm": 15.3
                        }],
                        "count": 1,
                        "center": {"lat": 47.5, "lon": -122.3},
                        "radius_nm": 100,
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
async def get_pireps_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(100, ge=10, le=500, description="Search radius in nautical miles"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results"),
    hours: int = Query(2, ge=1, le=12, description="Hours of reports"),
    db: AsyncSession = Depends(get_db)
):
    """Get pilot reports within a geographic area."""
    # Try database cache first
    cached_pireps = await weather_cache.get_cached_pireps(
        db, lat=lat, lon=lon, radius_nm=radius, hours=hours, limit=limit
    )

    # Fetch from API to get any new reports
    deg_offset = radius / 60.0
    bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

    data = await fetch_awc_data("pirep", {
        "format": "json",
        "age": hours,
        "bbox": bbox
    })

    if isinstance(data, dict) and "error" in data:
        # Return cached data if API fails
        if cached_pireps:
            return {
                "data": cached_pireps[:limit],
                "count": min(len(cached_pireps), limit),
                "center": {"lat": lat, "lon": lon},
                "radius_nm": radius,
                "source": "database",
                "cached": True,
                "api_error": data["error"]
            }
        return {
            "data": [],
            "count": 0,
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": "aviationweather.gov",
            "error": data["error"]
        }

    pireps = data if isinstance(data, list) else []

    # Store new PIREPs in the database
    if pireps:
        stored = await weather_cache.store_pireps(db, pireps)
        if stored > 0:
            # Re-fetch from database to get the updated set
            cached_pireps = await weather_cache.get_cached_pireps(
                db, lat=lat, lon=lon, radius_nm=radius, hours=hours, limit=limit
            )

    # Calculate distances for API data
    for p in pireps:
        p_lat = p.get("lat", 0)
        p_lon = p.get("lon", 0)
        if p_lat and p_lon:
            p["distance_nm"] = round(haversine_nm(lat, lon, p_lat, p_lon), 1)
        else:
            p["distance_nm"] = None

    # Filter by actual radius (bbox is square approximation) and sort
    pireps = [p for p in pireps if p.get("distance_nm") is not None and p["distance_nm"] <= radius]
    pireps.sort(key=lambda x: x.get("distance_nm") or 9999)

    return {
        "data": pireps[:limit],
        "count": min(len(pireps), limit),
        "center": {"lat": lat, "lon": lon},
        "radius_nm": radius,
        "source": "aviationweather.gov",
        "cached": False,
        "stored_new": len(pireps) > 0
    }


@router.get(
    "/pireps/history",
    summary="Get Historical PIREPs",
    description="""
Get historical Pilot Reports (PIREPs) from the database.

Query stored PIREPs by time range with optional location and condition filters.

**Parameters:**
- `start` - Start time (ISO 8601 format, default: 24 hours ago)
- `end` - End time (ISO 8601 format, default: now)
- `lat`, `lon` - Center point for location filter (optional)
- `radius` - Search radius in nautical miles (default 100)
- `turbulence` - Filter to only turbulence reports
- `icing` - Filter to only icing reports
- `limit` - Maximum results (default 200)

**Data Source:** Database (PIREPs are stored from API calls)
    """,
    responses={
        200: {
            "description": "Historical pilot reports",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "pirep_id": "abc123",
                            "rawOb": "KSEA UA /OV SEA/TM 1230/FL350/TP B738/TB MOD",
                            "acType": "B738",
                            "fltlvl": 350,
                            "turbType": "MOD",
                            "obsTime": "2024-01-15T12:30:00"
                        }],
                        "count": 1,
                        "time_range": {
                            "start": "2024-01-14T12:00:00",
                            "end": "2024-01-15T12:00:00"
                        },
                        "source": "database"
                    }
                }
            }
        }
    }
)
async def get_pireps_history(
    start: Optional[str] = Query(None, description="Start time (ISO 8601)"),
    end: Optional[str] = Query(None, description="End time (ISO 8601)"),
    lat: Optional[float] = Query(None, ge=-90, le=90, description="Center latitude (optional)"),
    lon: Optional[float] = Query(None, ge=-180, le=180, description="Center longitude (optional)"),
    radius: float = Query(100, ge=10, le=500, description="Search radius in nautical miles"),
    turbulence: bool = Query(False, description="Filter to turbulence reports only"),
    icing: bool = Query(False, description="Filter to icing reports only"),
    limit: int = Query(200, ge=1, le=1000, description="Maximum results"),
    db: AsyncSession = Depends(get_db)
):
    """Get historical PIREPs from the database."""
    # Parse time range
    now = datetime.utcnow()
    start_time = now - timedelta(hours=24)
    end_time = now

    if start:
        try:
            start_time = datetime.fromisoformat(start.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start time format")

    if end:
        try:
            end_time = datetime.fromisoformat(end.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end time format")

    pireps = await weather_cache.get_historical_pireps(
        db,
        start_time=start_time,
        end_time=end_time,
        lat=lat,
        lon=lon,
        radius_nm=radius,
        turbulence_only=turbulence,
        icing_only=icing,
        limit=limit
    )

    response = {
        "data": pireps,
        "count": len(pireps),
        "time_range": {
            "start": start_time.isoformat(),
            "end": end_time.isoformat()
        },
        "source": "database"
    }

    if lat is not None and lon is not None:
        response["center"] = {"lat": lat, "lon": lon}
        response["radius_nm"] = radius

    if turbulence:
        response["filter"] = "turbulence"
    elif icing:
        response["filter"] = "icing"

    return response


@router.get(
    "/sigmets",
    summary="Get Active SIGMETs",
    description="""
Get active SIGMETs (Significant Meteorological Information).

SIGMETs warn of significant weather hazards:
- Severe turbulence
- Severe icing
- Volcanic ash
- Tropical cyclones
- Thunderstorms (convective)

These are important for flight planning and safety.

**Parameters:**
- `hazard` - Filter by hazard type (optional)
- `lat`, `lon`, `radius` - Filter by location (optional)
    """,
    responses={
        200: {
            "description": "Active SIGMETs",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "airSigmetType": "SIGMET",
                            "hazard": "TURB",
                            "severity": "SEV",
                            "validTimeFrom": 1703160000,
                            "validTimeTo": 1703174400
                        }],
                        "count": 1,
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=300)
async def get_sigmets(
    hazard: Optional[str] = Query(
        None,
        description="Filter by hazard type",
        enum=["CONVECTIVE", "TURB", "ICE", "IFR", "MTN OBSCN", "ASH"]
    ),
    lat: Optional[float] = Query(None, ge=-90, le=90, description="Center latitude (optional)"),
    lon: Optional[float] = Query(None, ge=-180, le=180, description="Center longitude (optional)"),
    radius: Optional[float] = Query(None, ge=10, le=1000, description="Radius in NM (optional)")
):
    """Get active SIGMETs."""
    params = {"format": "json"}
    if hazard:
        params["hazard"] = hazard
    
    data = await fetch_awc_data("airsigmet", params)
    
    if isinstance(data, dict) and "error" in data:
        return {"data": [], "count": 0, "source": "aviationweather.gov", "error": data["error"]}
    
    sigmets = data if isinstance(data, list) else []
    
    # If location specified, calculate distances and filter
    if lat is not None and lon is not None:
        for s in sigmets:
            # Try to get center point of SIGMET
            s_lat = s.get("lat")
            s_lon = s.get("lon")
            if s_lat and s_lon:
                s["distance_nm"] = round(haversine_nm(lat, lon, s_lat, s_lon), 1)
        
        if radius:
            sigmets = [s for s in sigmets if s.get("distance_nm", 0) <= radius]
        sigmets.sort(key=lambda x: x.get("distance_nm", 9999))
    
    return {
        "data": sigmets,
        "count": len(sigmets),
        "source": "aviationweather.gov",
        "cached": False
    }


# =============================================================================
# Single Item Endpoints (by identifier)
# =============================================================================

@router.get(
    "/metar/{station}",
    summary="Get METAR for Station",
    description="""
Get current METAR (Meteorological Aerodrome Report) for a specific airport.

METAR provides current weather conditions including:
- Wind direction and speed
- Visibility
- Cloud coverage and ceiling
- Temperature and dewpoint
- Altimeter setting
- Flight category (VFR/MVFR/IFR/LIFR)

**Data Source:** Uses Redis cache when available (5-minute TTL).
Falls back to Aviation Weather Center API.

Station IDs are 4-letter ICAO codes (e.g., KSEA, KJFK, EGLL).
    """,
    responses={
        200: {
            "description": "METAR observation",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "icaoId": "KSEA",
                            "rawOb": "KSEA 211256Z 18008KT 10SM FEW045 12/06 A3012",
                            "temp": 12,
                            "dewp": 6,
                            "wdir": 180,
                            "wspd": 8,
                            "visib": 10,
                            "altim": 30.12,
                            "fltcat": "VFR"
                        }],
                        "count": 1,
                        "source": "aviationweather.gov"
                    }
                }
            }
        },
        404: {"model": ErrorResponse, "description": "Station not found"}
    }
)
async def get_metar(
    station: str = Path(
        ...,
        description="ICAO airport identifier (4 letters)",
        example="KSEA",
        min_length=4,
        max_length=4
    ),
    hours: int = Query(
        2,
        ge=1,
        le=24,
        description="Hours of observations to retrieve"
    )
):
    """Get METAR weather observation for an airport."""
    station_upper = station.upper()

    # Try Redis cache first
    cached_data = await weather_cache.get_cached_metar(station_upper, hours)
    if cached_data:
        return {
            "data": cached_data,
            "count": len(cached_data) if isinstance(cached_data, list) else 1,
            "source": "redis",
            "cached": True
        }

    # Fetch from API
    data = await fetch_awc_data("metar", {
        "ids": station_upper,
        "format": "json",
        "hours": hours
    })

    if isinstance(data, dict) and "error" in data:
        weather_cache.record_metar_api_request(success=False)
        raise HTTPException(status_code=503, detail=f"Weather service error: {data['error']}")

    if not data:
        weather_cache.record_metar_api_request(success=True)
        raise HTTPException(status_code=404, detail=f"No METAR found for {station_upper}")

    weather_cache.record_metar_api_request(success=True)

    # Cache in Redis
    if data:
        await weather_cache.cache_metar(station_upper, data, hours, ttl=300)

    return {
        "data": data,
        "count": len(data) if isinstance(data, list) else 1,
        "source": "aviationweather.gov",
        "cached": False
    }


@router.get(
    "/taf/{station}",
    summary="Get TAF for Station",
    description="""
Get TAF (Terminal Aerodrome Forecast) for an airport.

TAF provides weather forecasts for the next 24-30 hours including:
- Expected wind conditions
- Visibility forecasts
- Cloud coverage predictions
- Significant weather phenomena
- Temporary conditions (TEMPO)
- Expected changes (BECMG)

Station IDs are 4-letter ICAO codes.
    """,
    responses={
        200: {
            "description": "TAF forecast",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "icaoId": "KSEA",
                            "rawTAF": "TAF KSEA 211130Z 2112/2212 18010KT P6SM FEW050...",
                            "validTimeFrom": 1703160000,
                            "validTimeTo": 1703246400
                        }],
                        "count": 1,
                        "source": "aviationweather.gov"
                    }
                }
            }
        },
        404: {"model": ErrorResponse, "description": "Station not found"}
    }
)
@cached(ttl_seconds=600)
async def get_taf(
    station: str = Path(
        ...,
        description="ICAO airport identifier",
        example="KSEA",
        min_length=4,
        max_length=4
    )
):
    """Get TAF forecast for an airport."""
    data = await fetch_awc_data("taf", {
        "ids": station.upper(),
        "format": "json"
    })
    
    if isinstance(data, dict) and "error" in data:
        raise HTTPException(status_code=503, detail=f"Weather service error: {data['error']}")
    
    if not data:
        raise HTTPException(status_code=404, detail=f"No TAF found for {station.upper()}")
    
    return {
        "data": data,
        "count": len(data) if isinstance(data, list) else 1,
        "source": "aviationweather.gov",
        "cached": False
    }


@router.get(
    "/airport/{icao}",
    summary="Get Airport Information",
    description="""
Get information about an airport by ICAO code.

Returns:
- Airport name and location
- Elevation
- Type (large_airport, medium_airport, small_airport, etc.)
    """,
    responses={
        200: {
            "description": "Airport information",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "icaoId": "KSEA",
                            "name": "Seattle-Tacoma International",
                            "lat": 47.449,
                            "lon": -122.309,
                            "elev": 433,
                            "type": "large_airport"
                        }],
                        "count": 1,
                        "source": "aviationweather.gov"
                    }
                }
            }
        },
        404: {"model": ErrorResponse, "description": "Airport not found"}
    }
)
@cached(ttl_seconds=3600)
async def get_airport(
    icao: str = Path(
        ...,
        description="ICAO airport identifier",
        example="KSEA",
        min_length=4,
        max_length=4
    )
):
    """Get airport information."""
    data = await fetch_awc_data("stationinfo", {
        "ids": icao.upper(),
        "format": "json"
    })
    
    if isinstance(data, dict) and "error" in data:
        raise HTTPException(status_code=503, detail=f"Service error: {data['error']}")
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Airport {icao.upper()} not found")
    
    return {
        "data": data,
        "count": len(data) if isinstance(data, list) else 1,
        "source": "aviationweather.gov",
        "cached": False
    }


@router.get(
    "/navaid/{ident}",
    summary="Get Navaid Information",
    description="""
Get information about a navigation aid (VOR, NDB, etc.).

Returns:
- Navaid type (VOR, VORTAC, NDB, etc.)
- Location coordinates
- Frequency
- Identifier and name
    """,
    responses={
        200: {
            "description": "Navaid information",
            "content": {
                "application/json": {
                    "example": {
                        "data": [{
                            "ident": "SEA",
                            "name": "Seattle",
                            "type": "VORTAC",
                            "lat": 47.435,
                            "lon": -122.310,
                            "freq": 116.8
                        }],
                        "count": 1,
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=3600)
async def get_navaid(
    ident: str = Path(
        ...,
        description="Navaid identifier",
        example="SEA",
        min_length=2,
        max_length=5
    )
):
    """Get navigation aid information."""
    data = await fetch_awc_data("navaid", {
        "ids": ident.upper(),
        "format": "json"
    })
    
    if isinstance(data, dict) and "error" in data:
        return {"data": [], "count": 0, "source": "aviationweather.gov", "error": data["error"]}
    
    return {
        "data": data if isinstance(data, list) else [],
        "count": len(data) if isinstance(data, list) else 0,
        "source": "aviationweather.gov",
        "cached": False
    }


# =============================================================================
# Airspace Endpoints (AWC data)
# =============================================================================

@router.get(
    "/airspaces",
    summary="Get Airspace Advisories by Location",
    description="""
Get active airspace advisories (G-AIRMETs) within a geographic area.

G-AIRMETs provide graphical depictions of en route aviation weather hazards:
- IFR conditions (low ceilings/visibility)
- Mountain obscuration
- Turbulence (low, moderate, high level)
- Icing (low, moderate, high level)
- Freezing level
- Strong surface winds

**Note:** This endpoint returns active G-AIRMET advisories from Aviation Weather Center.
For static airspace boundaries (Class B/C/D, MOAs, Restricted areas), consult 
FAA sectional charts or the FAA UAS Data Delivery System at 
https://udds-faa.opendata.arcgis.com/

**Parameters:**
- `lat`, `lon` - Center point coordinates (for distance calculation)
- `hazard` - Filter by hazard type (optional)

**Data Source:** aviationweather.gov
    """,
    responses={
        200: {
            "description": "Active airspace advisories",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {
                                "name": "GAIRMET-SIERRA-3",
                                "type": "GAIRMET",
                                "hazard": "IFR",
                                "severity": "LIFR",
                                "lower_alt": 0,
                                "upper_alt": 8000,
                                "valid_from": "2024-01-15T12:00:00Z",
                                "valid_to": "2024-01-15T18:00:00Z"
                            }
                        ],
                        "count": 1,
                        "center": {"lat": 47.5, "lon": -122.3},
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
async def get_airspaces_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    hazard: Optional[str] = Query(
        None,
        description="Filter by hazard type",
        enum=["IFR", "MT_OBSC", "TURB-LO", "TURB-HI", "ICE", "FZLVL", "SFC_WND", "LLWS"]
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get active airspace advisories (G-AIRMETs) from database."""
    advisories = await airspace_service.get_advisories(db, lat=lat, lon=lon, hazard=hazard)

    # Sort by hazard type then validity
    advisories.sort(key=lambda x: (x.get("hazard", ""), x.get("valid_from", "")))

    return {
        "data": advisories,
        "count": len(advisories),
        "center": {"lat": lat, "lon": lon},
        "source": "database",
        "note": "For static airspace boundaries, see /api/v1/aviation/airspace-boundaries",
    }


@router.get(
    "/airspace-boundaries",
    summary="Get Static Airspace Boundaries",
    description="""
Get static airspace boundary polygons for controlled airspace areas.

Returns GeoJSON-style polygon data for:
- **Class B** - Major hub airports (LAX, JFK, ORD, etc.)
- **Class C** - Busy airports with radar approach control
- **Class D** - Airports with control towers
- **MOA** - Military Operations Areas
- **Restricted** - Restricted airspace

**Note:** These are approximate boundaries for visualization purposes.
Refer to official FAA sectional charts for precise limits.

**Parameters:**
- `lat`, `lon` - Center point to filter nearby airspaces (optional)
- `radius` - Search radius in nautical miles (default 100, max 500)
- `airspace_class` - Filter by class (B, C, D, MOA, Restricted)

**Data:** Embedded static data covering major US airspaces
    """,
    responses={
        200: {
            "description": "Static airspace boundaries",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {
                                "name": "Los Angeles Class B",
                                "icao": "KLAX",
                                "class": "B",
                                "floor_ft": 0,
                                "ceiling_ft": 10000,
                                "center": {"lat": 33.9425, "lon": -118.4081},
                                "polygon": [[-118.60, 34.10], [-118.20, 34.15]]
                            }
                        ],
                        "count": 1,
                        "source": "embedded"
                    }
                }
            }
        }
    }
)
async def get_airspace_boundaries(
    lat: Optional[float] = Query(None, ge=-90, le=90, description="Center latitude for filtering"),
    lon: Optional[float] = Query(None, ge=-180, le=180, description="Center longitude for filtering"),
    radius: float = Query(100, ge=1, le=500, description="Search radius in nautical miles"),
    airspace_class: Optional[str] = Query(
        None,
        description="Filter by airspace class",
        enum=["B", "C", "D", "MOA", "Restricted"]
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get static airspace boundary polygons from database."""
    airspaces = await airspace_service.get_boundaries(
        db,
        lat=lat,
        lon=lon,
        radius_nm=radius,
        airspace_class=airspace_class
    )

    # Sort by class priority (B, C, D, then others)
    class_order = {"B": 0, "C": 1, "D": 2, "MOA": 3, "Restricted": 4}
    airspaces.sort(key=lambda x: (class_order.get(x.get("class"), 99), x.get("name", "")))

    response = {
        "data": airspaces,
        "count": len(airspaces),
        "source": "database",
        "note": "Approximate boundaries for visualization - refer to FAA charts for precise limits"
    }

    if lat is not None and lon is not None:
        response["center"] = {"lat": lat, "lon": lon}
        response["radius_nm"] = radius

    return response


@router.get(
    "/airspaces/history",
    summary="Get Historical Airspace Advisories",
    description="""
Get historical airspace advisories for a time range.

Returns past G-AIRMET advisories stored in the database.

**Parameters:**
- `start` - Start time (ISO 8601 format, default: 24 hours ago)
- `end` - End time (ISO 8601 format, default: now)
- `hazard` - Filter by hazard type

**Data Source:** Database (refreshed every 5 minutes from aviationweather.gov)
    """,
    responses={
        200: {
            "description": "Historical airspace advisories",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {
                                "name": "GAIRMET-SIERRA-3",
                                "type": "GAIRMET",
                                "hazard": "IFR",
                                "fetched_at": "2024-01-15T12:00:00"
                            }
                        ],
                        "count": 1,
                        "time_range": {
                            "start": "2024-01-14T12:00:00",
                            "end": "2024-01-15T12:00:00"
                        }
                    }
                }
            }
        }
    }
)
async def get_airspace_history(
    start: Optional[str] = Query(None, description="Start time (ISO 8601)"),
    end: Optional[str] = Query(None, description="End time (ISO 8601)"),
    hazard: Optional[str] = Query(
        None,
        description="Filter by hazard type",
        enum=["IFR", "MT_OBSC", "TURB-LO", "TURB-HI", "ICE", "FZLVL", "SFC_WND", "LLWS"]
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get historical airspace advisories."""
    # Parse time range
    now = datetime.utcnow()
    start_time = now - timedelta(hours=24)
    end_time = now

    if start:
        try:
            start_time = datetime.fromisoformat(start.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start time format")

    if end:
        try:
            end_time = datetime.fromisoformat(end.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end time format")

    advisories = await airspace_service.get_advisory_history(
        db,
        start_time=start_time,
        end_time=end_time,
        hazard=hazard
    )

    return {
        "data": advisories,
        "count": len(advisories),
        "time_range": {
            "start": start_time.isoformat(),
            "end": end_time.isoformat()
        },
        "source": "database"
    }


# =============================================================================
# GeoJSON Map Overlay Endpoints
# =============================================================================

# All valid GeoJSON data types (Natural Earth + tar1090)
GEOJSON_DATA_TYPES = [
    # Natural Earth
    "states", "countries", "water",
    # tar1090 Military AWACS
    "de_mil_awacs", "nl_mil_awacs", "pl_mil_awacs", "uk_mil_awacs",
    # tar1090 UK Military
    "uk_mil_aar", "uk_mil_rc",
    # tar1090 US
    "us_a2a_refueling", "us_artcc",
    # tar1090 Training
    "ift_nav_routes", "ift_training_areas", "usafa_training_areas",
    # tar1090 UK Advisory
    "uk_airports", "uk_runways", "uk_shoreham",
]

@router.get(
    "/geojson/{data_type}",
    summary="Get GeoJSON Map Overlays",
    description="""
Get cached GeoJSON boundary data for map overlays.

**Data Types - Natural Earth:**
- `states` - US state and province boundaries
- `countries` - Country boundaries
- `water` - Major lakes and water bodies

**Data Types - Aviation (tar1090):**
- `us_artcc` - US ARTCC (Air Route Traffic Control Center) boundaries
- `us_a2a_refueling` - US air-to-air refueling tracks
- `uk_mil_awacs` - UK military AWACS orbits
- `uk_mil_aar` - UK air-to-air refueling zones
- `uk_mil_rc` - UK military restricted/controlled areas
- `de_mil_awacs`, `nl_mil_awacs`, `pl_mil_awacs` - EU AWACS orbits
- `ift_nav_routes`, `ift_training_areas`, `usafa_training_areas` - Training areas

**Data Source:** Cached from Natural Earth and tar1090 (refreshed daily).

**Caching:** Response includes Cache-Control headers for browser caching (1 hour).

**Parameters:**
- `data_type` - Type of GeoJSON data to retrieve
- `lat`, `lon` - Optional center point to filter nearby features
- `radius` - Search radius in nautical miles (default 500)
    """,
    responses={
        200: {
            "description": "GeoJSON FeatureCollection",
            "content": {
                "application/json": {
                    "example": {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "id": "US-WA",
                                "properties": {"name": "Washington", "code": "US-WA"},
                                "geometry": {"type": "Polygon", "coordinates": []}
                            }
                        ],
                        "count": 1,
                        "source": "database"
                    }
                }
            }
        }
    }
)
async def get_geojson_overlays(
    data_type: str = Path(
        ...,
        description="Type of GeoJSON data",
    ),
    lat: Optional[float] = Query(None, ge=-90, le=90, description="Center latitude for filtering"),
    lon: Optional[float] = Query(None, ge=-180, le=180, description="Center longitude for filtering"),
    radius: float = Query(500, ge=10, le=5000, description="Search radius in nautical miles"),
    db: AsyncSession = Depends(get_db)
):
    """Get cached GeoJSON boundary data for map overlays."""
    # Validate data_type
    if data_type not in GEOJSON_DATA_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid data_type. Must be one of: {', '.join(GEOJSON_DATA_TYPES)}"
        )

    features = await geodata_service.get_cached_geojson(
        db, data_type=data_type, lat=lat, lon=lon, radius_nm=radius
    )

    response_data = {
        "type": "FeatureCollection",
        "features": features,
        "count": len(features),
        "data_type": data_type,
        "source": "database",
        "cached": True
    }

    # Return with cache headers - static data can be cached for 1 hour
    return JSONResponse(
        content=response_data,
        headers={
            "Cache-Control": "public, max-age=3600",  # 1 hour browser cache
            "Vary": "Accept-Encoding",
        }
    )


@router.get(
    "/cache-stats",
    summary="Get Geographic Data Cache Statistics",
    description="""
Get statistics about the cached geographic data.

Returns counts and last refresh times for:
- Airports
- Navaids
- GeoJSON boundaries (states, countries, water)
    """
)
async def get_geodata_cache_stats(db: AsyncSession = Depends(get_db)):
    """Get statistics about cached geographic data."""
    stats = await geodata_service.get_cache_stats(db)
    return {
        "data": stats,
        "source": "database"
    }


@router.get(
    "/pirep-stats",
    summary="Get PIREP Cache Statistics",
    description="""
Get statistics about cached Pilot Reports (PIREPs).

Returns counts and breakdowns for:
- Total PIREPs stored
- PIREPs in the last 6 hours
- Turbulence and icing reports
- Last fetch time
- Runtime statistics (stored, duplicates, queries)
    """
)
async def get_pirep_cache_stats(db: AsyncSession = Depends(get_db)):
    """Get statistics about cached PIREPs."""
    stats = await weather_cache.get_pirep_stats(db)
    return {
        "data": stats,
        "source": "database"
    }


@router.get(
    "/metar-stats",
    summary="Get METAR Cache Statistics",
    description="""
Get statistics about the METAR Redis cache.

Returns:
- Cache hits and misses
- Hit rate percentage
- API request counts and errors
- Last API call timestamp
    """
)
async def get_metar_cache_stats():
    """Get statistics about METAR Redis cache."""
    stats = weather_cache.get_metar_stats()
    return {
        "data": stats,
        "source": "redis"
    }


@router.get(
    "/weather-stats",
    summary="Get Weather Cache Statistics",
    description="""
Get comprehensive statistics about all weather caching.

Includes both METAR (Redis) and PIREP (database) cache statistics.

Returns:
- METAR cache hits, misses, hit rate
- PIREP storage counts and query stats
- API request metrics
- Last fetch/store timestamps
    """
)
async def get_weather_cache_stats(db: AsyncSession = Depends(get_db)):
    """Get comprehensive weather cache statistics."""
    metar_stats = weather_cache.get_metar_stats()
    pirep_stats = await weather_cache.get_pirep_stats(db)

    return {
        "data": {
            "metar": metar_stats,
            "pirep": pirep_stats
        },
        "source": {
            "metar": "redis",
            "pirep": "database"
        }
    }
