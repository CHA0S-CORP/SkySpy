"""
Aviation data API endpoints.

Provides access to aviation weather (METAR/TAF), airports, navaids,
and other aviation reference data from aviationweather.gov.
"""
from math import radians, sin, cos, sqrt, atan2
from typing import Optional

from fastapi import APIRouter, Query, Path, HTTPException
import httpx

from app.core import get_settings, cached
from app.schemas import AviationDataResponse, ErrorResponse

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
@cached(ttl_seconds=300)
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
    
    data = await fetch_awc_data("metar", {
        "bbox": bbox,
        "format": "json",
        "hours": hours
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
    
    metars = data if isinstance(data, list) else []
    
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
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=3600)
async def get_airports_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(50, ge=5, le=500, description="Search radius in nautical miles"),
    limit: int = Query(20, ge=1, le=100, description="Maximum results")
):
    """Find airports within a geographic area."""
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
                        "source": "aviationweather.gov"
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=3600)
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
    )
):
    """Find navaids within a geographic area."""
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
@cached(ttl_seconds=300)
async def get_pireps_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(100, ge=10, le=500, description="Search radius in nautical miles"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results"),
    hours: int = Query(2, ge=1, le=12, description="Hours of reports")
):
    """Get pilot reports within a geographic area."""
    # Convert radius to bounding box (AWC API now requires bbox or station+distance)
    deg_offset = radius / 60.0
    bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"
    
    data = await fetch_awc_data("pirep", {
        "format": "json",
        "age": hours,
        "bbox": bbox
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
    
    pireps = data if isinstance(data, list) else []
    
    # Calculate distances
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
        "cached": False
    }


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
@cached(ttl_seconds=300)
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
    data = await fetch_awc_data("metar", {
        "ids": station.upper(),
        "format": "json",
        "hours": hours
    })
    
    if isinstance(data, dict) and "error" in data:
        raise HTTPException(status_code=503, detail=f"Weather service error: {data['error']}")
    
    if not data:
        raise HTTPException(status_code=404, detail=f"No METAR found for {station.upper()}")
    
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
# FAA Airspace Endpoints (via ArcGIS)
# =============================================================================

# FAA ArcGIS Feature Service URLs - these may need verification
# Primary source: https://adds-faa.opendata.arcgis.com/
# Alternate: https://ais-faa.opendata.arcgis.com/
FAA_AIRSPACE_SERVICES = {
    # These URLs are constructed based on FAA AIS data patterns
    # They query the FAA's published airspace data
    "sua": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Special_Use_Airspace/FeatureServer/0",
    "class_b": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Class_Airspace_B/FeatureServer/0",
    "class_c": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Class_Airspace_C/FeatureServer/0",
    "class_d": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Class_Airspace_D/FeatureServer/0",
}


async def fetch_faa_airspace(service_url: str, bbox: str, limit: int = 100) -> list:
    """Fetch airspace data from FAA ArcGIS Feature Service."""
    import httpx
    
    # Convert bbox from "minLat,minLon,maxLat,maxLon" to ArcGIS format "minLon,minLat,maxLon,maxLat"
    parts = bbox.split(",")
    if len(parts) == 4:
        min_lat, min_lon, max_lat, max_lon = parts
        arcgis_bbox = f"{min_lon},{min_lat},{max_lon},{max_lat}"
    else:
        arcgis_bbox = bbox
    
    params = {
        "where": "1=1",
        "geometry": arcgis_bbox,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "false",
        "outSR": "4326",
        "f": "json",
        "resultRecordCount": limit,
    }
    
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{service_url}/query",
                params=params,
                headers={
                    "User-Agent": "ADS-B-API/2.6 (aircraft-tracker)",
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            data = response.json()
            
            if "error" in data:
                return []
            
            features = data.get("features", [])
            return [f.get("attributes", {}) for f in features]
    except Exception as e:
        return []


@router.get(
    "/airspace",
    summary="Get Airspaces by Location",
    description="""
Find airspaces within a geographic area.

Returns various types of airspace that intersect with the search area.

**Airspace Classes:**
- Class B - Major airports (busiest)
- Class C - Busy airports with control tower
- Class D - Airports with control tower

**Special Use Airspace (SUA):**
- MOA - Military Operations Area
- RESTRICTED - Restricted airspace
- WARNING - Warning areas (over water)
- PROHIBITED - Prohibited areas
- ALERT - Alert areas

**Also includes G-AIRMET data from Aviation Weather Center**

**Parameters:**
- `lat`, `lon` - Center point coordinates
- `radius` - Search radius in nautical miles (default 50)
- `limit` - Maximum results (default 50)
- `type` - Filter by airspace type (optional)

**Data Sources:** FAA AIS, aviationweather.gov
    """,
    responses={
        200: {
            "description": "Nearby airspaces",
            "content": {
                "application/json": {
                    "example": {
                        "data": [
                            {
                                "name": "SEATTLE CLASS B",
                                "type": "CLASS_B",
                                "lower_alt": 0,
                                "upper_alt": 10000
                            },
                            {
                                "name": "R-6703A YAKIMA",
                                "type": "RESTRICTED",
                                "lower_alt": 0,
                                "upper_alt": 17999
                            }
                        ],
                        "count": 2,
                        "center": {"lat": 47.5, "lon": -122.3},
                        "radius_nm": 50,
                        "source": "faa.gov/aviationweather.gov"
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=3600)
async def get_airspaces_by_location(
    lat: float = Query(..., ge=-90, le=90, description="Center latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Center longitude"),
    radius: float = Query(50, ge=5, le=500, description="Search radius in nautical miles"),
    limit: int = Query(50, ge=1, le=200, description="Maximum results"),
    airspace_type: Optional[str] = Query(
        None,
        alias="type",
        description="Filter by airspace type",
        enum=["CLASS_B", "CLASS_C", "CLASS_D", "SUA", "MOA", "RESTRICTED", "WARNING", "PROHIBITED", "ALERT", "GAIRMET"]
    )
):
    """Find airspaces within a geographic area."""
    # Convert radius to bounding box
    deg_offset = radius / 60.0
    bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"
    
    all_airspaces = []
    errors = []
    
    # Try to get G-AIRMET data from AWC (always available)
    if airspace_type is None or airspace_type == "GAIRMET":
        gairmet_data = await fetch_awc_data("gairmet", {"format": "json"})
        if isinstance(gairmet_data, list):
            for g in gairmet_data:
                # G-AIRMETs have hazard info
                airspace = {
                    "name": g.get("tag") or g.get("hazard") or "G-AIRMET",
                    "type": "GAIRMET",
                    "hazard": g.get("hazard"),
                    "severity": g.get("severity"),
                    "lower_alt": g.get("base") or g.get("altLow") or 0,
                    "upper_alt": g.get("top") or g.get("altHi") or 0,
                    "valid_from": g.get("validTimeFrom"),
                    "valid_to": g.get("validTimeTo"),
                    "source": "aviationweather.gov"
                }
                all_airspaces.append(airspace)
    
    # Try FAA ArcGIS services for Class airspace
    services_to_query = []
    
    if airspace_type is None:
        services_to_query = [
            ("sua", "SUA"),
            ("class_b", "CLASS_B"),
            ("class_c", "CLASS_C"),
            ("class_d", "CLASS_D"),
        ]
    elif airspace_type == "SUA" or airspace_type in ["MOA", "RESTRICTED", "WARNING", "PROHIBITED", "ALERT"]:
        services_to_query = [("sua", "SUA")]
    elif airspace_type.startswith("CLASS_"):
        class_letter = airspace_type.replace("CLASS_", "").lower()
        if f"class_{class_letter}" in FAA_AIRSPACE_SERVICES:
            services_to_query = [(f"class_{class_letter}", airspace_type)]
    
    for service_key, type_label in services_to_query:
        service_url = FAA_AIRSPACE_SERVICES.get(service_key)
        if not service_url:
            continue
        
        features = await fetch_faa_airspace(service_url, bbox, limit)
        
        if not features:
            # Service might not be available, add to errors
            errors.append(f"FAA {type_label} service unavailable")
            continue
        
        for feat in features:
            airspace = {
                "name": feat.get("NAME") or feat.get("IDENT") or feat.get("AIRSPACE") or "Unknown",
                "type": type_label if service_key != "sua" else (feat.get("TYPE_CODE") or feat.get("TYPE") or "SUA"),
                "class": feat.get("CLASS") or feat.get("LOCAL_TYPE") or type_label.replace("CLASS_", ""),
                "lower_alt": feat.get("LOWER_VAL") or feat.get("LOWER_ALT") or feat.get("LOW_ALT") or 0,
                "upper_alt": feat.get("UPPER_VAL") or feat.get("UPPER_ALT") or feat.get("HIGH_ALT") or 0,
                "city": feat.get("CITY") or None,
                "state": feat.get("STATE") or feat.get("STATE_NAME") or None,
                "icao": feat.get("ICAO") or feat.get("IDENT") or None,
                "source": "faa.gov"
            }
            
            # Filter SUA by specific type if requested
            if airspace_type in ["MOA", "RESTRICTED", "WARNING", "PROHIBITED", "ALERT"]:
                sua_type = str(airspace.get("type", "")).upper()
                airspace_name = str(airspace.get("name", "")).upper()
                if airspace_type not in sua_type and airspace_type[0] not in airspace_name[:2]:
                    continue
            
            all_airspaces.append(airspace)
    
    # Sort by type then name
    all_airspaces.sort(key=lambda x: (x.get("type", ""), x.get("name", "")))
    
    result = {
        "data": all_airspaces[:limit],
        "count": min(len(all_airspaces), limit),
        "center": {"lat": lat, "lon": lon},
        "radius_nm": radius,
        "source": "faa.gov/aviationweather.gov",
        "cached": False
    }
    
    if errors:
        result["warnings"] = errors
        result["note"] = "Some FAA airspace services may be unavailable. G-AIRMET data from AWC is included."
    
    return result