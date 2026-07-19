"""
Geographic data caching service.

Fetches and caches long-term geographic data:
- Airports from Aviation Weather Center
- Navaids (VOR, NDB, etc.) from Aviation Weather Center
- GeoJSON boundaries (states, countries, water bodies)

Data is refreshed daily and stored in the database for fast local queries.
"""

import logging
from datetime import datetime
from math import atan2, cos, radians, sin, sqrt

import httpx
from django.conf import settings
from django.db import transaction
from django.db.models import Max
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from skyspy.models import CachedAirport, CachedGeoJSON, CachedNavaid

logger = logging.getLogger(__name__)

# API endpoint
AWC_BASE = "https://aviationweather.gov/api/data"

# Default bbox when no feeder location is configured (CONUS, majors only).
CONUS_BBOX = "24,-130,50,-60"


def _feeder_bbox(radius_nm: float | None = None) -> str:
    """
    AWC bbox ("latMin,lonMin,latMax,lonMax") centered on the feeder antenna.

    The old code always queried the whole CONUS at a low density, so airports/
    navaids near a given feeder were sparse or absent. Querying a box around
    FEEDER_LAT/LON returns dense local coverage (and lets us drop the density
    cap so small fields show up). Falls back to CONUS when no feeder is set.
    """
    lat = float(getattr(settings, "FEEDER_LAT", 0) or 0)
    lon = float(getattr(settings, "FEEDER_LON", 0) or 0)
    if not lat and not lon:
        return CONUS_BBOX
    r = float(radius_nm or getattr(settings, "GEODATA_FETCH_RADIUS_NM", 250) or 250)
    d_lat = r / 60.0
    d_lon = r / (60.0 * max(cos(radians(lat)), 0.1))
    return f"{lat - d_lat:.4f},{lon - d_lon:.4f},{lat + d_lat:.4f},{lon + d_lon:.4f}"


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
_last_refresh: datetime | None = None


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles between two points."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


# =============================================================================
# Retry Helpers for External API Calls
# =============================================================================


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
def _http_get_awc(url: str, params: dict, timeout: float = 15.0) -> httpx.Response:
    """HTTP GET with retry logic for AWC API."""
    with httpx.Client(timeout=timeout) as client:
        response = client.get(
            url,
            params=params,
            headers={
                "User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        return response


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
def _http_get_geojson(url: str, timeout: float = 15.0) -> httpx.Response:
    """HTTP GET with retry logic for GeoJSON fetches."""
    with httpx.Client(timeout=timeout) as client:
        response = client.get(url, headers={"User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)"})
        response.raise_for_status()
        return response


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
)
def _http_get_faa(url: str, params: dict, timeout: float = 20.0) -> httpx.Response:
    """HTTP GET with retry logic for FAA ArcGIS FeatureServer queries."""
    with httpx.Client(timeout=timeout) as client:
        response = client.get(url, params=params, headers={"User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)"})
        response.raise_for_status()
        return response


def fetch_awc_data(endpoint: str, params: dict) -> dict | list:
    """Fetch data from Aviation Weather Center API with retry logic."""
    try:
        response = _http_get_awc(f"{AWC_BASE}/{endpoint}", params, timeout=15.0)
        return response.json() if response.text else []
    except httpx.HTTPStatusError as e:
        logger.error(f"AWC API error for {endpoint}: {e.response.status_code}")
        return {"error": str(e), "status": e.response.status_code}
    except Exception as e:  # broad: AWC fetch must degrade to an error dict on any failure (tested)
        logger.error(f"AWC API request failed for {endpoint}: {e}")
        return {"error": str(e)}


def fetch_geojson(url: str) -> dict | None:
    """Fetch GeoJSON data from a URL with retry logic."""
    try:
        response = _http_get_geojson(url, timeout=15.0)
        return response.json()
    except Exception as e:  # broad: GeoJSON fetch returns None on any failure (tested)
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

    # Filter out empty coordinate entries
    coords = [c for c in coords if c]

    if not coords:
        return (0, 0, 0, 0)

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return (min(lats), max(lats), min(lons), max(lons))


# OpenAIP airport `type` enum → CachedAirport.airport_type label (best-effort;
# only used for the map icon/label, not for filtering).
_OPENAIP_AIRPORT_TYPE = {
    0: "medium_airport",  # Airport (civil/military, resolved lower)
    1: "small_airport",  # Glider site
    2: "small_airport",  # Airfield (civil)
    3: "large_airport",  # International airport
    4: "heliport",  # Heliport (military)
    5: "medium_airport",  # Military aerodrome
    6: "small_airport",  # Ultralight
    7: "heliport",  # Heliport (civil)
    8: "closed",  # Aerodrome closed
    9: "medium_airport",  # Airport (IFR)
    10: "seaplane_base",  # Landing strip / water
    11: "small_airport",  # Altiport
}


def _openaip_regions(default_radius_nm: float) -> list[tuple[float, float, float]]:
    """Feeder + AIRSPACE_EXTRA_REGIONS as (lat, lon, radius_nm) fetch centers.

    Mirrors the airspace boundary task: OpenAIP caps each geo-search at ~27 nm,
    so multi-site coverage comes from AIRSPACE_EXTRA_REGIONS, not a wider radius.
    """
    regions: list[tuple[float, float, float]] = []
    lat = float(getattr(settings, "FEEDER_LAT", 0) or 0)
    lon = float(getattr(settings, "FEEDER_LON", 0) or 0)
    if lat or lon:
        regions.append((lat, lon, default_radius_nm))
    for extra in getattr(settings, "AIRSPACE_EXTRA_REGIONS", None) or []:
        try:
            elat, elon = float(extra[0]), float(extra[1])
            eradius = float(extra[2]) if len(extra) > 2 else default_radius_nm
            regions.append((elat, elon, eradius))
        except (TypeError, ValueError, IndexError):
            continue
    return regions


def _as_int(value) -> int | None:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _as_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _refresh_airports_openaip(now: datetime) -> dict:
    """Build CachedAirport rows from OpenAIP (keyed by ICAO). Empty dict if disabled."""
    from skyspy.services import openaip

    if not openaip._is_enabled():
        return {}

    radius = float(getattr(settings, "GEODATA_FETCH_RADIUS_NM", 250) or 250)
    unique_airports: dict[str, CachedAirport] = {}

    for lat, lon, region_radius in _openaip_regions(radius):
        for apt in openaip.get_airports(lat, lon, region_radius):
            icao = (apt.get("icao") or "").strip().upper()
            # CachedAirport.icao_id is a unique 4-char key; OpenAIP returns many
            # heliports/hospitals with no ICAO — skip those (map wants real fields).
            if not icao or len(icao) > 4:
                continue
            la, lo = apt.get("latitude"), apt.get("longitude")
            if la is None or lo is None:
                continue
            unique_airports[icao] = CachedAirport(
                fetched_at=now,
                icao_id=icao,
                name=(apt.get("name") or "")[:200],
                latitude=la,
                longitude=lo,
                elevation_ft=_as_int(apt.get("elevation_ft")),
                airport_type=_OPENAIP_AIRPORT_TYPE.get(apt.get("type"), "medium_airport"),
                country=(apt.get("country") or "")[:100] or None,
                region=None,
                source_data=apt,
            )
    return unique_airports


def refresh_airports() -> int:
    """Fetch and cache airport data using UPSERT.

    Primary source is OpenAIP (keyed, unlimited, dense GA coverage). Falls back
    to the AWC airport endpoint only when OpenAIP is disabled or returns nothing
    — AWC's weather-station airport feed returns only a handful of major fields.
    """
    logger.info("Refreshing cached airports...")
    now = datetime.utcnow()

    unique_airports = _refresh_airports_openaip(now)
    if unique_airports:
        with transaction.atomic():
            CachedAirport.objects.all().delete()
            CachedAirport.objects.bulk_create(unique_airports.values())
        logger.info(f"Cached {len(unique_airports)} airports (openaip)")
        return len(unique_airports)

    bbox = _feeder_bbox()  # local box around the feeder (CONUS fallback)

    # density=12 pulls small/GA fields too (the old density=5 only returned
    # majors, so a feeder ringed by small airports saw almost nothing).
    data = fetch_awc_data("airport", {"bbox": bbox, "zoom": 5, "density": 12, "format": "json"})

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch airports: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected airport data format: {type(data)}")
        return 0

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

    if not unique_airports:
        # Empty (but 200 OK) responses happen during AWC maintenance windows -
        # keep serving the previous data instead of wiping the table.
        logger.warning("AWC airport response contained no usable rows; keeping existing cache")
        return 0

    # Short transaction: all fetching/parsing happened above, so the swap
    # never holds a DB transaction open across slow HTTP calls (PgBouncer).
    with transaction.atomic():
        CachedAirport.objects.all().delete()
        CachedAirport.objects.bulk_create(unique_airports.values())
    logger.info(f"Cached {len(unique_airports)} airports")

    return len(unique_airports)


def _refresh_navaids_openaip(now: datetime) -> dict:
    """Build CachedNavaid rows from OpenAIP. Empty dict if disabled."""
    from skyspy.services import openaip

    if not openaip._is_enabled():
        return {}

    radius = float(getattr(settings, "GEODATA_FETCH_RADIUS_NM", 250) or 250)
    unique_navaids: dict = {}

    for lat, lon, region_radius in _openaip_regions(radius):
        for nav in openaip.get_navaids(lat, lon, region_radius):
            ident = (nav.get("ident") or "").strip().upper()
            la, lo = nav.get("latitude"), nav.get("longitude")
            if not ident or la is None or lo is None:
                continue
            unique_navaids[(ident, round(la, 4), round(lo, 4))] = CachedNavaid(
                fetched_at=now,
                ident=ident[:10],
                name=(nav.get("name") or "")[:100],
                navaid_type=(nav.get("type") or "")[:20] or None,
                latitude=la,
                longitude=lo,
                frequency=_as_float(nav.get("frequency")),
                channel=None,
                source_data=nav,
            )
    return unique_navaids


def refresh_navaids() -> int:
    """Fetch and cache navaid data.

    Primary source is OpenAIP; falls back to AWC only when OpenAIP is disabled or
    empty. (The AWC navaid endpoint currently returns [] for any bbox.)
    """
    logger.info("Refreshing cached navaids...")
    now = datetime.utcnow()

    unique_navaids = _refresh_navaids_openaip(now)
    if unique_navaids:
        with transaction.atomic():
            CachedNavaid.objects.all().delete()
            CachedNavaid.objects.bulk_create(unique_navaids.values())
        logger.info(f"Cached {len(unique_navaids)} navaids (openaip)")
        return len(unique_navaids)

    bbox = _feeder_bbox()

    data = fetch_awc_data("navaid", {"bbox": bbox, "format": "json"})

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch navaids: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected navaid data format: {type(data)}")
        return 0

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

    if not unique_navaids:
        logger.warning("AWC navaid response contained no usable rows; keeping existing cache")
        return 0

    with transaction.atomic():
        CachedNavaid.objects.all().delete()
        CachedNavaid.objects.bulk_create(unique_navaids.values())
    logger.info(f"Cached {len(unique_navaids)} navaids")

    return len(unique_navaids)


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
                    properties.get("name")
                    or properties.get("NAME")
                    or properties.get("id")
                    or properties.get("ID")
                    or properties.get("title")
                    or properties.get("designator")
                    or feature.get("id")
                    or f"{data_type}_{idx}"
                )
                code = (
                    properties.get("id")
                    or properties.get("ID")
                    or properties.get("icao")
                    or properties.get("designator")
                )
                unique_key = f"{name}_{idx}"

            # Deduplicate
            if unique_key in seen_items:
                continue
            if unique_key:
                seen_items.add(unique_key)

            # Calculate bounding box
            bbox = calculate_bbox(geometry)

            features.append(
                CachedGeoJSON(
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
                )
            )

        if features:
            # Short per-type transaction: swap old rows for new without holding
            # a transaction across the remaining HTTP fetches (PgBouncer).
            with transaction.atomic():
                CachedGeoJSON.objects.filter(data_type=data_type).delete()
                CachedGeoJSON.objects.bulk_create(features)
            logger.info(f"Cached {len(features)} {data_type} features")
            total += len(features)

    return total


# FAA Aeronautical Information Services enroute structure (keyless ArcGIS
# FeatureServer, GeoJSON). US airways (ATS_Route lines) + named waypoints/fixes
# (Designated_Point points) near the feeder — see settings FAA_ENROUTE_*. Stored
# in CachedGeoJSON as data_type us_airways / us_fixes and served by the generic
# /aviation/geojson/<type>/ endpoint. Each entry is (data_type, url_setting,
# outFields, page_size); the ArcGIS layers cap at 2000 / 1000 rows per request.
_FAA_ENROUTE_LAYERS = (
    ("us_airways", "FAA_AIRWAYS_URL", "IDENT,TYPE_CODE,LEVEL_", 2000),
    ("us_fixes", "FAA_FIXES_URL", "IDENT,TYPE_CODE,STATE", 1000),
)


def _faa_envelope(lat: float, lon: float, radius_nm: float) -> str:
    """ArcGIS esriGeometryEnvelope ("xmin,ymin,xmax,ymax" = lon/lat) around a point."""
    d_lat = radius_nm / 60.0
    d_lon = radius_nm / (60.0 * max(cos(radians(lat)), 0.1))
    return f"{lon - d_lon:.4f},{lat - d_lat:.4f},{lon + d_lon:.4f},{lat + d_lat:.4f}"


def fetch_faa_layer(url: str, envelope: str, out_fields: str, page: int, max_features: int) -> list[dict]:
    """Paginated GeoJSON fetch of one FAA FeatureServer layer within an envelope."""
    features: list[dict] = []
    offset = 0
    while len(features) < max_features:
        params = {
            "where": "1=1",
            "geometry": envelope,
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "outSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "resultOffset": offset,
            "resultRecordCount": page,
            "f": "geojson",
        }
        try:
            data = _http_get_faa(url, params).json()
        except Exception as e:  # broad: FAA fetch degrades to whatever pages we have (tested)
            logger.warning(f"FAA layer fetch failed at offset {offset}: {e}")
            break
        batch = data.get("features") if isinstance(data, dict) else None
        if not batch:
            break
        features.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return features[:max_features]


def refresh_faa_enroute() -> int:
    """Fetch FAA airways + fixes near the feeder into CachedGeoJSON.

    Airways -> data_type ``us_airways`` (LineString), fixes -> ``us_fixes``
    (Point). US-only: a non-US feeder returns nothing (cache is then left as-is).
    """
    if not getattr(settings, "FAA_ENROUTE_ENABLED", False):
        return 0

    radius = float(getattr(settings, "AIRSPACE_FETCH_RADIUS_NM", 250) or 250)
    max_features = int(getattr(settings, "FAA_ENROUTE_MAX_FEATURES", 8000) or 8000)
    regions = _openaip_regions(radius)
    if not regions:
        logger.info("FAA enroute refresh skipped: no feeder location configured")
        return 0

    now = datetime.utcnow()
    total = 0

    for data_type, url_setting, out_fields, page in _FAA_ENROUTE_LAYERS:
        url = getattr(settings, url_setting, "")
        if not url:
            continue

        seen: set = set()
        rows: list[CachedGeoJSON] = []
        for lat, lon, region_radius in regions:
            envelope = _faa_envelope(lat, lon, region_radius)
            for feature in fetch_faa_layer(url, envelope, out_fields, page, max_features):
                geometry = feature.get("geometry")
                if not geometry:
                    continue
                props = feature.get("properties") or {}
                ident = (props.get("IDENT") or "").strip()
                bbox = calculate_bbox(geometry)
                # Dedupe overlapping regions by ArcGIS OBJECTID (feature "id"),
                # falling back to ident+bbox when the id is absent.
                key = feature.get("id")
                if key is None:
                    key = (ident, round(bbox[0], 3), round(bbox[2], 3))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(
                    CachedGeoJSON(
                        fetched_at=now,
                        data_type=data_type,
                        name=(ident or "Unknown")[:100],
                        code=(props.get("TYPE_CODE") or None) and str(props.get("TYPE_CODE"))[:10],
                        bbox_min_lat=bbox[0],
                        bbox_max_lat=bbox[1],
                        bbox_min_lon=bbox[2],
                        bbox_max_lon=bbox[3],
                        geometry=geometry,
                        properties=props,
                    )
                )

        if rows:
            with transaction.atomic():
                CachedGeoJSON.objects.filter(data_type=data_type).delete()
                CachedGeoJSON.objects.bulk_create(rows)
            logger.info(f"Cached {len(rows)} {data_type} features (FAA)")
            total += len(rows)
        else:
            logger.warning(f"FAA {data_type} fetch returned no features; keeping existing cache")

    return total


def refresh_all_geodata() -> dict:
    """Refresh all geographic data."""
    global _last_refresh

    results = {
        "airports": refresh_airports(),
        "navaids": refresh_navaids(),
        "geojson": refresh_geojson(),
        "faa_enroute": refresh_faa_enroute(),
    }

    _last_refresh = datetime.utcnow()
    logger.info(f"Geographic data refresh complete: {results}")
    return results


def get_cached_airports(
    lat: float | None = None,
    lon: float | None = None,
    radius_nm: float = 50,
    limit: int = 20,
) -> list[dict]:
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

    # When filtering by location, the bounding-box filter already limits the row count;
    # slicing an unordered queryset here would drop nearby airports nondeterministically.
    airports = list(queryset) if lat is not None and lon is not None else list(queryset[:limit])

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
    lat: float | None = None,
    lon: float | None = None,
    radius_nm: float = 50,
    navaid_type: str | None = None,
    limit: int = 20,
) -> list[dict]:
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

    # When filtering by location, the bounding-box filter already limits the row count;
    # slicing an unordered queryset here would drop nearby navaids nondeterministically.
    navaids = list(queryset) if lat is not None and lon is not None else list(queryset[:limit])

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
    lat: float | None = None,
    lon: float | None = None,
    radius_nm: float = 500,
) -> list[dict]:
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

    airport_last = CachedAirport.objects.aggregate(Max("fetched_at"))["fetched_at__max"]
    navaid_last = CachedNavaid.objects.aggregate(Max("fetched_at"))["fetched_at__max"]
    geojson_last = CachedGeoJSON.objects.aggregate(Max("fetched_at"))["fetched_at__max"]

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
        # Ensure both are naive or both aware for comparison
        if last_dt.tzinfo is not None:
            last_dt = last_dt.replace(tzinfo=None)
        age = datetime.utcnow() - last_dt
        return age.total_seconds() >= REFRESH_INTERVAL
    except (ValueError, TypeError):
        return True
