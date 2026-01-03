"""
Geographic data caching service.

Fetches and caches long-term geographic data:
- Airports from Aviation Weather Center
- Navaids (VOR, NDB, etc.) from Aviation Weather Center
- GeoJSON boundaries (states, countries, water bodies)

Data is refreshed daily and stored in the database for fast local queries.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from math import radians, cos
from typing import Optional

import httpx
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import get_settings
from app.models import CachedAirport, CachedNavaid, CachedGeoJSON

logger = logging.getLogger(__name__)
settings = get_settings()

# API endpoint
AWC_BASE = "https://aviationweather.gov/api/data"

# GeoJSON data sources (Natural Earth via GitHub)
GEOJSON_SOURCES = {
    "countries": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    "states": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_1_states_provinces.geojson",
    "water": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_lakes.geojson",
}

# Refresh interval (24 hours)
REFRESH_INTERVAL = 86400

# In-memory cache metadata
_last_refresh: Optional[datetime] = None
_refresh_task: Optional[asyncio.Task] = None


async def fetch_awc_data(endpoint: str, params: dict) -> dict | list:
    """Fetch data from Aviation Weather Center API."""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.get(
                f"{AWC_BASE}/{endpoint}",
                params=params,
                headers={
                    "User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)",
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json() if response.text else []
        except httpx.HTTPStatusError as e:
            logger.error(f"AWC API error for {endpoint}: {e.response.status_code}")
            return {"error": str(e), "status": e.response.status_code}
        except Exception as e:
            logger.error(f"AWC API request failed for {endpoint}: {e}")
            return {"error": str(e)}


async def fetch_geojson(url: str) -> Optional[dict]:
    """Fetch GeoJSON data from a URL."""
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            response = await client.get(
                url,
                headers={"User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)"}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to fetch GeoJSON from {url}: {e}")
            return None


def calculate_bbox(geometry: dict) -> tuple[float, float, float, float]:
    """Calculate bounding box from GeoJSON geometry."""
    coords = []

    def extract_coords(geom):
        if geom["type"] == "Point":
            coords.append(geom["coordinates"])
        elif geom["type"] in ("LineString", "MultiPoint"):
            coords.extend(geom["coordinates"])
        elif geom["type"] in ("Polygon", "MultiLineString"):
            for ring in geom["coordinates"]:
                coords.extend(ring)
        elif geom["type"] == "MultiPolygon":
            for polygon in geom["coordinates"]:
                for ring in polygon:
                    coords.extend(ring)
        elif geom["type"] == "GeometryCollection":
            for g in geom.get("geometries", []):
                extract_coords(g)

    extract_coords(geometry)

    if not coords:
        return (0, 0, 0, 0)

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return (min(lats), max(lats), min(lons), max(lons))


async def refresh_airports(db: AsyncSession) -> int:
    """Fetch and cache airport data for a large area (CONUS + nearby)."""
    logger.info("Refreshing cached airports...")
    now = datetime.utcnow()

    # Fetch airports for continental US + nearby areas
    # Using a large bounding box
    bbox = "24,-130,50,-60"  # CONUS roughly

    data = await fetch_awc_data("airport", {
        "bbox": bbox,
        "zoom": 5,
        "density": 5,
        "format": "json"
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch airports: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected airport data format: {type(data)}")
        return 0

    # Clear old data and insert new
    await db.execute(delete(CachedAirport))

    airports = []
    for apt in data:
        icao = apt.get("icaoId")
        if not icao or len(icao) != 4:
            continue

        lat = apt.get("lat")
        lon = apt.get("lon")
        if lat is None or lon is None:
            continue

        airport = CachedAirport(
            fetched_at=now,
            icao_id=icao,
            name=apt.get("name"),
            latitude=lat,
            longitude=lon,
            elevation_ft=apt.get("elev"),
            airport_type=apt.get("type"),
            country=apt.get("country"),
            region=apt.get("state"),
            source_data=apt,
        )
        airports.append(airport)

    if airports:
        db.add_all(airports)
        await db.commit()
        logger.info(f"Cached {len(airports)} airports")

    return len(airports)


async def refresh_navaids(db: AsyncSession) -> int:
    """Fetch and cache navaid data for a large area."""
    logger.info("Refreshing cached navaids...")
    now = datetime.utcnow()

    # Fetch navaids for continental US
    bbox = "24,-130,50,-60"

    data = await fetch_awc_data("navaid", {
        "bbox": bbox,
        "format": "json"
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch navaids: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected navaid data format: {type(data)}")
        return 0

    # Clear old data and insert new
    await db.execute(delete(CachedNavaid))

    navaids = []
    for nav in data:
        ident = nav.get("id") or nav.get("ident")
        if not ident:
            continue

        lat = nav.get("lat")
        lon = nav.get("lon")
        if lat is None or lon is None:
            continue

        navaid = CachedNavaid(
            fetched_at=now,
            ident=ident,
            name=nav.get("name"),
            navaid_type=nav.get("type"),
            latitude=lat,
            longitude=lon,
            frequency=nav.get("freq"),
            channel=nav.get("channel"),
            source_data=nav,
        )
        navaids.append(navaid)

    if navaids:
        db.add_all(navaids)
        await db.commit()
        logger.info(f"Cached {len(navaids)} navaids")

    return len(navaids)


async def refresh_geojson(db: AsyncSession) -> int:
    """Fetch and cache GeoJSON boundary data."""
    logger.info("Refreshing cached GeoJSON boundaries...")
    now = datetime.utcnow()
    total = 0

    for data_type, url in GEOJSON_SOURCES.items():
        logger.debug(f"Fetching {data_type} GeoJSON...")
        geojson = await fetch_geojson(url)

        if not geojson or "features" not in geojson:
            logger.warning(f"Failed to fetch {data_type} GeoJSON")
            continue

        # Clear old data for this type
        await db.execute(
            delete(CachedGeoJSON).where(CachedGeoJSON.data_type == data_type)
        )

        features = []
        for feature in geojson["features"]:
            geometry = feature.get("geometry")
            properties = feature.get("properties", {})

            if not geometry:
                continue

            # Get name and code based on data type
            if data_type == "countries":
                name = properties.get("NAME", properties.get("ADMIN", "Unknown"))
                code = properties.get("ISO_A2") or properties.get("ISO_A3")
            elif data_type == "states":
                name = properties.get("name", properties.get("NAME", "Unknown"))
                code = properties.get("iso_3166_2") or properties.get("postal")
            else:  # water
                name = properties.get("name", properties.get("NAME", "Unknown"))
                code = None

            # Calculate bounding box
            bbox = calculate_bbox(geometry)

            cached = CachedGeoJSON(
                fetched_at=now,
                data_type=data_type,
                name=name,
                code=code,
                bbox_min_lat=bbox[0],
                bbox_max_lat=bbox[1],
                bbox_min_lon=bbox[2],
                bbox_max_lon=bbox[3],
                geometry=geometry,
                properties=properties,
            )
            features.append(cached)

        if features:
            db.add_all(features)
            await db.commit()
            logger.info(f"Cached {len(features)} {data_type} features")
            total += len(features)

    return total


async def refresh_all_geodata(session_factory: async_sessionmaker) -> dict:
    """Refresh all geographic data."""
    global _last_refresh

    results = {"airports": 0, "navaids": 0, "geojson": 0}

    async with session_factory() as db:
        results["airports"] = await refresh_airports(db)
        results["navaids"] = await refresh_navaids(db)
        results["geojson"] = await refresh_geojson(db)

    _last_refresh = datetime.utcnow()
    logger.info(f"Geographic data refresh complete: {results}")
    return results


async def geodata_refresh_task(session_factory: async_sessionmaker) -> None:
    """Background task to refresh geographic data daily."""
    logger.info("Geographic data refresh task started")

    while True:
        try:
            # Check if refresh is needed
            now = datetime.utcnow()
            if _last_refresh is None or (now - _last_refresh).total_seconds() >= REFRESH_INTERVAL:
                await refresh_all_geodata(session_factory)
        except Exception as e:
            logger.error(f"Error in geodata refresh task: {e}")

        # Sleep for 1 hour, then check again
        await asyncio.sleep(3600)


async def get_cached_airports(
    db: AsyncSession,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 50,
    limit: int = 20,
) -> list[dict]:
    """Get cached airports, optionally filtered by location."""
    query = select(CachedAirport)

    if lat is not None and lon is not None:
        # Approximate degrees per NM
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        query = query.where(
            CachedAirport.latitude.between(lat - lat_range, lat + lat_range),
            CachedAirport.longitude.between(lon - lon_range, lon + lon_range),
        )

    result = await db.execute(query.limit(limit * 2))  # Get extra for distance filtering
    airports = result.scalars().all()

    # Convert to dicts and calculate distance
    results = []
    for apt in airports:
        data = apt.source_data or {}
        data["icaoId"] = apt.icao_id
        data["name"] = apt.name
        data["lat"] = apt.latitude
        data["lon"] = apt.longitude
        data["elev"] = apt.elevation_ft
        data["type"] = apt.airport_type

        if lat is not None and lon is not None:
            from app.routers.aviation import haversine_nm
            data["distance_nm"] = round(haversine_nm(lat, lon, apt.latitude, apt.longitude), 1)
        results.append(data)

    # Sort by distance and limit
    if lat is not None and lon is not None:
        results = [r for r in results if r.get("distance_nm", 9999) <= radius_nm]
        results.sort(key=lambda x: x.get("distance_nm", 9999))

    return results[:limit]


async def get_cached_navaids(
    db: AsyncSession,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 50,
    navaid_type: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    """Get cached navaids, optionally filtered by location and type."""
    query = select(CachedNavaid)

    if navaid_type:
        query = query.where(CachedNavaid.navaid_type == navaid_type.upper())

    if lat is not None and lon is not None:
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        query = query.where(
            CachedNavaid.latitude.between(lat - lat_range, lat + lat_range),
            CachedNavaid.longitude.between(lon - lon_range, lon + lon_range),
        )

    result = await db.execute(query.limit(limit * 2))
    navaids = result.scalars().all()

    results = []
    for nav in navaids:
        data = nav.source_data or {}
        data["id"] = nav.ident
        data["name"] = nav.name
        data["type"] = nav.navaid_type
        data["lat"] = nav.latitude
        data["lon"] = nav.longitude
        data["freq"] = nav.frequency

        if lat is not None and lon is not None:
            from app.routers.aviation import haversine_nm
            data["distance_nm"] = round(haversine_nm(lat, lon, nav.latitude, nav.longitude), 1)
        results.append(data)

    if lat is not None and lon is not None:
        results = [r for r in results if r.get("distance_nm", 9999) <= radius_nm]
        results.sort(key=lambda x: x.get("distance_nm", 9999))

    return results[:limit]


async def get_cached_geojson(
    db: AsyncSession,
    data_type: str,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 500,
) -> list[dict]:
    """Get cached GeoJSON features, optionally filtered by location."""
    query = select(CachedGeoJSON).where(CachedGeoJSON.data_type == data_type)

    if lat is not None and lon is not None:
        # Filter by bounding box intersection
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        query = query.where(
            CachedGeoJSON.bbox_max_lat >= lat - lat_range,
            CachedGeoJSON.bbox_min_lat <= lat + lat_range,
            CachedGeoJSON.bbox_max_lon >= lon - lon_range,
            CachedGeoJSON.bbox_min_lon <= lon + lon_range,
        )

    result = await db.execute(query)
    features = result.scalars().all()

    return [
        {
            "type": "Feature",
            "id": f.code or f.name,
            "properties": {
                "name": f.name,
                "code": f.code,
                **(f.properties or {}),
            },
            "geometry": f.geometry,
        }
        for f in features
    ]


async def get_cache_stats(db: AsyncSession) -> dict:
    """Get statistics about cached geographic data."""
    airport_count = (await db.execute(select(func.count(CachedAirport.id)))).scalar() or 0
    navaid_count = (await db.execute(select(func.count(CachedNavaid.id)))).scalar() or 0
    geojson_count = (await db.execute(select(func.count(CachedGeoJSON.id)))).scalar() or 0

    # Get last fetch time
    airport_last = (await db.execute(
        select(CachedAirport.fetched_at).order_by(CachedAirport.fetched_at.desc()).limit(1)
    )).scalar()
    navaid_last = (await db.execute(
        select(CachedNavaid.fetched_at).order_by(CachedNavaid.fetched_at.desc()).limit(1)
    )).scalar()
    geojson_last = (await db.execute(
        select(CachedGeoJSON.fetched_at).order_by(CachedGeoJSON.fetched_at.desc()).limit(1)
    )).scalar()

    return {
        "airports": {
            "count": airport_count,
            "last_refresh": airport_last.isoformat() if airport_last else None,
        },
        "navaids": {
            "count": navaid_count,
            "last_refresh": navaid_last.isoformat() if navaid_last else None,
        },
        "geojson": {
            "count": geojson_count,
            "last_refresh": geojson_last.isoformat() if geojson_last else None,
        },
        "refresh_interval_hours": REFRESH_INTERVAL // 3600,
    }


async def start_refresh_task(session_factory: async_sessionmaker) -> asyncio.Task:
    """Start the background refresh task."""
    global _refresh_task

    # Check if we need initial data load
    async with session_factory() as db:
        stats = await get_cache_stats(db)

        # If no data or data is stale, refresh now
        if stats["airports"]["count"] == 0 or stats["navaids"]["count"] == 0:
            logger.info("Loading initial geographic data...")
            await refresh_all_geodata(session_factory)

    # Start background task
    _refresh_task = asyncio.create_task(geodata_refresh_task(session_factory))
    return _refresh_task


async def stop_refresh_task() -> None:
    """Stop the background refresh task."""
    global _refresh_task
    if _refresh_task:
        _refresh_task.cancel()
        try:
            await _refresh_task
        except asyncio.CancelledError:
            pass
        _refresh_task = None
        logger.info("Geographic data refresh task stopped")
