"""
Geographic data caching service.

Fetches and caches long-term geographic data:
- Airports from Aviation Weather Center
- Navaids (VOR, NDB, etc.) from Aviation Weather Center
- GeoJSON boundaries (states, countries, water bodies)

Data is refreshed daily and stored in the database for fast local queries.
"""
import logging
from datetime import datetime, timedelta
from math import radians, cos, sin, sqrt, atan2
from typing import Optional, List

import httpx
from django.db import transaction
from django.db.models import Max, Count

from skyspy.models import CachedAirport, CachedNavaid, CachedGeoJSON, CachedPirep

logger = logging.getLogger(__name__)

# API endpoint
AWC_BASE = "https://aviationweather.gov/api/data"

# GeoJSON data sources (Natural Earth via GitHub)
GEOJSON_SOURCES = {
    "countries": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    "states": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_1_states_provinces.geojson",
    "water": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_lakes.geojson",
}

# tar1090 aviation GeoJSON sources (military/aviation overlays)
TAR1090_BASE = "https://raw.githubusercontent.com/wiedehopf/tar1090/master/html/geojson"
TAR1090_GEOJSON_SOURCES = {
    # Military AWACS orbits
    "de_mil_awacs": f"{TAR1090_BASE}/DE_Mil_AWACS_Orbits.geojson",
    "nl_mil_awacs": f"{TAR1090_BASE}/NL_Mil_AWACS_Orbits.geojson",
    "pl_mil_awacs": f"{TAR1090_BASE}/PL_Mil_AWACS_Orbits.geojson",
    "uk_mil_awacs": f"{TAR1090_BASE}/UK_Mil_AWACS_Orbits.geojson",
    # UK Military zones
    "uk_mil_aar": f"{TAR1090_BASE}/UK_Mil_AAR_Zones.geojson",
    "uk_mil_rc": f"{TAR1090_BASE}/UK_Mil_RC.geojson",
    # US zones
    "us_a2a_refueling": f"{TAR1090_BASE}/US_A2A_refueling.geojson",
    "us_artcc": f"{TAR1090_BASE}/US_ARTCC_boundaries.geojson",
    # IFT training areas
    "ift_nav_routes": f"{TAR1090_BASE}/IFT/IFT_NAV_Routes.geojson",
    "ift_training_areas": f"{TAR1090_BASE}/IFT/IFT_Training_Areas.geojson",
    "usafa_training_areas": f"{TAR1090_BASE}/IFT/USAFA_Training_Areas.geojson",
    # UK advisory
    "uk_airports": f"{TAR1090_BASE}/uk_advisory/airports.geojson",
    "uk_runways": f"{TAR1090_BASE}/uk_advisory/runways.geojson",
    "uk_shoreham": f"{TAR1090_BASE}/uk_advisory/shoreham.geojson",
}

# Refresh interval (24 hours)
REFRESH_INTERVAL = 86400

# In-memory cache metadata
_last_refresh: Optional[datetime] = None


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles between two points."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def fetch_awc_data(endpoint: str, params: dict) -> dict | list:
    """Fetch data from Aviation Weather Center API."""
    try:
        with httpx.Client(timeout=30) as client:
            response = client.get(
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


def fetch_geojson(url: str) -> Optional[dict]:
    """Fetch GeoJSON data from a URL."""
    try:
        with httpx.Client(timeout=60) as client:
            response = client.get(
                url,
                headers={"User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)"}
            )
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch GeoJSON from {url}: {e}")
        return None


def calculate_bbox(geometry: dict) -> tuple:
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


@transaction.atomic
def refresh_airports() -> int:
    """Fetch and cache airport data using UPSERT."""
    logger.info("Refreshing cached airports...")
    now = datetime.utcnow()

    bbox = "24,-130,50,-60"  # CONUS roughly

    data = fetch_awc_data("airport", {
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

    # Clear old data
    CachedAirport.objects.all().delete()

    # Deduplicate by ICAO
    unique_airports = {}

    for apt in data:
        icao = apt.get("icaoId")
        if not icao or len(icao) != 4:
            continue

        lat = apt.get("lat")
        lon = apt.get("lon")
        if lat is None or lon is None:
            continue

        unique_airports[icao] = CachedAirport(
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

    if unique_airports:
        CachedAirport.objects.bulk_create(unique_airports.values())
        logger.info(f"Cached {len(unique_airports)} airports")

    return len(unique_airports)


@transaction.atomic
def refresh_navaids() -> int:
    """Fetch and cache navaid data."""
    logger.info("Refreshing cached navaids...")
    now = datetime.utcnow()

    bbox = "24,-130,50,-60"

    data = fetch_awc_data("navaid", {
        "bbox": bbox,
        "format": "json"
    })

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch navaids: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected navaid data format: {type(data)}")
        return 0

    # Clear old data
    CachedNavaid.objects.all().delete()

    # Deduplicate by composite key (ident, lat, lon)
    unique_navaids = {}

    for nav in data:
        ident = nav.get("id") or nav.get("ident")
        if not ident:
            continue

        lat = nav.get("lat")
        lon = nav.get("lon")
        if lat is None or lon is None:
            continue

        unique_key = (ident, lat, lon)

        unique_navaids[unique_key] = CachedNavaid(
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

    if unique_navaids:
        CachedNavaid.objects.bulk_create(unique_navaids.values())
        logger.info(f"Cached {len(unique_navaids)} navaids")

    return len(unique_navaids)


@transaction.atomic
def refresh_geojson() -> int:
    """Fetch and cache GeoJSON boundary data."""
    logger.info("Refreshing cached GeoJSON boundaries...")
    now = datetime.utcnow()
    total = 0

    # Combine all GeoJSON sources
    all_sources = {**GEOJSON_SOURCES, **TAR1090_GEOJSON_SOURCES}

    for data_type, url in all_sources.items():
        logger.debug(f"Fetching {data_type} GeoJSON...")
        geojson = fetch_geojson(url)

        if not geojson:
            logger.warning(f"Failed to fetch {data_type} GeoJSON")
            continue

        # Clear old data for this type
        CachedGeoJSON.objects.filter(data_type=data_type).delete()

        # Handle different GeoJSON formats
        if "features" in geojson:
            raw_features = geojson["features"]
        elif geojson.get("type") == "Feature":
            raw_features = [geojson]
        elif geojson.get("type") in ("Polygon", "MultiPolygon", "LineString", "MultiLineString", "Point"):
            raw_features = [{"type": "Feature", "geometry": geojson, "properties": {}}]
        else:
            logger.warning(f"Unknown GeoJSON format for {data_type}")
            continue

        features = []
        seen_items = set()

        for idx, feature in enumerate(raw_features):
            geometry = feature.get("geometry")
            properties = feature.get("properties", {})

            if not geometry:
                continue

            # Determine identity based on type
            name = "Unknown"
            code = None
            unique_key = None

            if data_type == "countries":
                name = properties.get("NAME", properties.get("ADMIN", "Unknown"))
                code = properties.get("ISO_A2") or properties.get("ISO_A3")
                unique_key = code if code else name
            elif data_type == "states":
                name = properties.get("name", properties.get("NAME", "Unknown"))
                code = properties.get("iso_3166_2") or properties.get("postal")
                unique_key = code if code else name
            elif data_type == "water":
                name = properties.get("name", properties.get("NAME", "Unknown"))
                code = None
                unique_key = name
            else:
                # tar1090 aviation GeoJSON
                name = (
                    properties.get("name") or
                    properties.get("NAME") or
                    properties.get("id") or
                    properties.get("ID") or
                    properties.get("title") or
                    properties.get("designator") or
                    feature.get("id") or
                    f"{data_type}_{idx}"
                )
                code = (
                    properties.get("id") or
                    properties.get("ID") or
                    properties.get("icao") or
                    properties.get("designator")
                )
                unique_key = f"{name}_{idx}"

            # Deduplicate
            if unique_key in seen_items:
                continue
            if unique_key:
                seen_items.add(unique_key)

            # Calculate bounding box
            bbox = calculate_bbox(geometry)

            features.append(CachedGeoJSON(
                fetched_at=now,
                data_type=data_type,
                name=str(name)[:100],
                code=str(code)[:10] if code else None,
                bbox_min_lat=bbox[0],
                bbox_max_lat=bbox[1],
                bbox_min_lon=bbox[2],
                bbox_max_lon=bbox[3],
                geometry=geometry,
                properties=properties,
            ))

        if features:
            CachedGeoJSON.objects.bulk_create(features)
            logger.info(f"Cached {len(features)} {data_type} features")
            total += len(features)

    return total


def refresh_all_geodata() -> dict:
    """Refresh all geographic data."""
    global _last_refresh

    results = {
        "airports": refresh_airports(),
        "navaids": refresh_navaids(),
        "geojson": refresh_geojson(),
    }

    _last_refresh = datetime.utcnow()
    logger.info(f"Geographic data refresh complete: {results}")
    return results


def get_cached_airports(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 50,
    limit: int = 20,
) -> List[dict]:
    """Get cached airports, optionally filtered by location."""
    queryset = CachedAirport.objects.all()

    if lat is not None and lon is not None:
        # Approximate degrees per NM
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        queryset = queryset.filter(
            latitude__range=(lat - lat_range, lat + lat_range),
            longitude__range=(lon - lon_range, lon + lon_range),
        )

    airports = list(queryset[:limit * 2])

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
            data["distance_nm"] = round(haversine_nm(lat, lon, apt.latitude, apt.longitude), 1)
        results.append(data)

    # Sort by distance and filter
    if lat is not None and lon is not None:
        results = [r for r in results if r.get("distance_nm", 9999) <= radius_nm]
        results.sort(key=lambda x: x.get("distance_nm", 9999))

    return results[:limit]


def get_cached_navaids(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 50,
    navaid_type: Optional[str] = None,
    limit: int = 20,
) -> List[dict]:
    """Get cached navaids, optionally filtered by location and type."""
    queryset = CachedNavaid.objects.all()

    if navaid_type:
        queryset = queryset.filter(navaid_type=navaid_type.upper())

    if lat is not None and lon is not None:
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        queryset = queryset.filter(
            latitude__range=(lat - lat_range, lat + lat_range),
            longitude__range=(lon - lon_range, lon + lon_range),
        )

    navaids = list(queryset[:limit * 2])

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
            data["distance_nm"] = round(haversine_nm(lat, lon, nav.latitude, nav.longitude), 1)
        results.append(data)

    if lat is not None and lon is not None:
        results = [r for r in results if r.get("distance_nm", 9999) <= radius_nm]
        results.sort(key=lambda x: x.get("distance_nm", 9999))

    return results[:limit]


def get_cached_geojson(
    data_type: str,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 500,
) -> List[dict]:
    """Get cached GeoJSON features, optionally filtered by location."""
    queryset = CachedGeoJSON.objects.filter(data_type=data_type)

    if lat is not None and lon is not None:
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        queryset = queryset.filter(
            bbox_max_lat__gte=lat - lat_range,
            bbox_min_lat__lte=lat + lat_range,
            bbox_max_lon__gte=lon - lon_range,
            bbox_min_lon__lte=lon + lon_range,
        )

    features = list(queryset)

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


def get_cache_stats() -> dict:
    """Get statistics about cached geographic data."""
    airport_count = CachedAirport.objects.count()
    navaid_count = CachedNavaid.objects.count()
    geojson_count = CachedGeoJSON.objects.count()

    airport_last = CachedAirport.objects.aggregate(Max('fetched_at'))['fetched_at__max']
    navaid_last = CachedNavaid.objects.aggregate(Max('fetched_at'))['fetched_at__max']
    geojson_last = CachedGeoJSON.objects.aggregate(Max('fetched_at'))['fetched_at__max']

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


def should_refresh() -> bool:
    """Check if geodata should be refreshed."""
    stats = get_cache_stats()

    # Refresh if no data
    if stats["airports"]["count"] == 0 or stats["navaids"]["count"] == 0:
        return True

    # Check last refresh time
    last_refresh = stats["airports"].get("last_refresh")
    if not last_refresh:
        return True

    # Parse and check age
    try:
        last_dt = datetime.fromisoformat(last_refresh)
        age = datetime.utcnow() - last_dt
        return age.total_seconds() >= REFRESH_INTERVAL
    except (ValueError, TypeError):
        return True
