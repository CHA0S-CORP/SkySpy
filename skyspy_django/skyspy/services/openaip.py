"""
OpenAIP airspace data service.

Provides global airspace boundaries, airports, and navaids from OpenAIP.
OpenAIP API: https://www.openaip.net/

Free tier: Unlimited with API key registration
"""

import logging
from typing import Any

import httpx
from django.conf import settings
from django.core.cache import cache
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

# API configuration
OPENAIP_API_BASE = "https://api.core.openaip.net/api"

# Cache settings
AIRSPACE_CACHE_TTL = 3600  # 1 hour
AIRPORTS_CACHE_TTL = 86400  # 24 hours

# OpenAIP geo-search `dist` ceiling in meters — the Core API rejects larger
# radii with HTTP 400. Verified empirically: 50 km returns 200 with data, 90 km+
# returns 400 (the true cap sits between, but is not documented). Requests are
# clamped to this proven-good value before hitting the wire. NOTE: 50 km ≈ 27 nm,
# so a single fetch only covers ~27 nm around each region center; wider coverage
# needs multiple AIRSPACE_EXTRA_REGIONS (tiling), not a larger radius.
OPENAIP_MAX_DIST_M = 50000

# Airspace types mapping
AIRSPACE_TYPES = {
    0: "OTHER",
    1: "RESTRICTED",
    2: "DANGER",
    3: "PROHIBITED",
    4: "CTR",
    5: "TMZ",
    6: "RMZ",
    7: "TMA",
    8: "TRA",
    9: "TSA",
    10: "FIR",
    11: "UIR",
    12: "ADIZ",
    13: "ATZ",
    14: "MATZ",
    15: "AIRWAY",
    16: "MTR",
    17: "ALERT",
    18: "WARNING",
    19: "PROTECTED",
    20: "HTZ",
    21: "GLIDING",
    22: "TRP",
    23: "TIZ",
    24: "TIA",
    25: "MTA",
    26: "CTA",
    27: "ACC",
    28: "SECTOR",
    29: "OCA",
    30: "MORA",
    31: "PARACHUTE",
    32: "WILDLIFE",
    33: "LMA",
}

# OpenAIP vertical limit unit enums (per Core API airspace schema):
# 0 = Meter, 1 = Feet, 6 = Flight Level
ALTITUDE_UNITS = {0: "m", 1: "ft", 6: "fl"}

# OpenAIP reference datum enums: 0 = GND, 1 = MSL, 2 = STD
REFERENCE_DATUMS = {0: "GND", 1: "MSL", 2: "STD"}


def _limit_to_ft(limit: dict) -> int | None:
    """Convert an OpenAIP vertical limit ({value, unit, referenceDatum}) to feet."""
    value = limit.get("value", 0)
    unit = limit.get("unit", "ft")
    # Map numeric enum to unit string (API returns integers; strings kept for compat)
    if isinstance(unit, int):
        unit = ALTITUDE_UNITS.get(unit, "ft")
    unit = str(unit).lower()

    if unit == "m":
        return int(value * 3.281)
    if unit == "fl":
        return int(value * 100)  # Flight level = hundreds of feet
    return int(value)


def _limit_reference(limit: dict) -> str:
    """Get the reference datum string (GND/MSL/STD) for an OpenAIP vertical limit."""
    ref = limit.get("referenceDatum", "MSL")
    if isinstance(ref, int):
        return REFERENCE_DATUMS.get(ref, "MSL")
    return ref


def _get_api_key() -> str | None:
    """Get OpenAIP API key from settings."""
    return getattr(settings, "OPENAIP_API_KEY", None)


def _is_enabled() -> bool:
    """Check if OpenAIP is enabled."""
    return bool(getattr(settings, "OPENAIP_ENABLED", False) and _get_api_key())


# Ceiling (seconds) for a single backoff wait, including a server-sent
# Retry-After. Keeps the daily boundary task from stalling a worker for minutes
# when OpenAIP's free-tier limiter locks the key.
OPENAIP_RETRY_MAX_WAIT = 30


def _is_retryable_http_error(exc: BaseException) -> bool:
    """Retry on network/timeout errors, 5xx responses, and 429 (rate limit).

    429 is retried with backoff (honoring Retry-After); other 4xx (400 bad
    request, 401 auth) are not — they won't succeed on retry.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        return code == 429 or code >= 500
    return isinstance(exc, (httpx.HTTPError, httpx.TimeoutException))


def _retry_wait(retry_state) -> float:
    """Exponential backoff, but honor a 429 `Retry-After` header when present.

    OpenAIP's free tier rate-limits aggressively; retrying immediately just
    burns attempts. A server-sent Retry-After (seconds, or an HTTP date) is
    respected up to OPENAIP_RETRY_MAX_WAIT; otherwise fall back to exponential.
    """
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
        retry_after = exc.response.headers.get("Retry-After")
        if retry_after:
            try:
                return min(float(retry_after), OPENAIP_RETRY_MAX_WAIT)
            except (TypeError, ValueError):
                # Retry-After may be an HTTP-date rather than a delta-seconds int.
                from email.utils import parsedate_to_datetime

                try:
                    from datetime import datetime, timezone

                    delta = (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds()
                    return max(1.0, min(delta, OPENAIP_RETRY_MAX_WAIT))
                except (TypeError, ValueError):
                    pass
    return wait_exponential(multiplier=1, min=1, max=OPENAIP_RETRY_MAX_WAIT)(retry_state)


@retry(
    stop=stop_after_attempt(4),
    wait=_retry_wait,
    retry=retry_if_exception(_is_retryable_http_error),
    reraise=True,
)
def _http_get_openaip(url: str, params: dict | None, api_key: str, timeout: float = 15.0) -> httpx.Response:
    """HTTP GET with retry logic for OpenAIP API."""
    with httpx.Client(timeout=timeout) as client:
        response = client.get(
            url,
            params=params,
            headers={
                "x-openaip-api-key": api_key,
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        return response


def _make_request(endpoint: str, params: dict | None = None, timeout: int = 15) -> dict[str, Any] | None:
    """
    Make a request to the OpenAIP API with retry logic.

    Args:
        endpoint: API endpoint path
        params: Optional query parameters
        timeout: Request timeout in seconds

    Returns:
        API response data or None if failed
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("OpenAIP API key not configured")
        return None

    try:
        response = _http_get_openaip(f"{OPENAIP_API_BASE}/{endpoint}", params, api_key, timeout=float(timeout))
        return response.json()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("OpenAIP rate limit exceeded (retries with backoff exhausted)")
        elif e.response.status_code == 401:
            logger.error("OpenAIP authentication failed - check API key")
        else:
            logger.error(f"OpenAIP API error: {e.response.status_code}")
        return None
    except (httpx.HTTPError, ConnectionError, OSError, ValueError) as e:
        logger.error(f"OpenAIP API request failed: {e}")
        return None


def get_airspaces(
    lat: float,
    lon: float,
    radius_nm: float = 100,
    airspace_types: list[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Get airspace data for a region.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Search radius in nautical miles
        airspace_types: Optional list of airspace type IDs to filter

    Returns:
        List of airspace dictionaries with GeoJSON geometry
    """
    if not _is_enabled():
        return []

    cache_key = f"openaip_airspace_{lat:.2f}_{lon:.2f}_{radius_nm}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    # Convert nm to meters for the API, clamped to OpenAIP's max `dist`
    # (requests above ~200 km return HTTP 400). A larger requested radius is
    # silently reduced to the ceiling rather than failing the whole fetch.
    dist_m = min(int(radius_nm * 1852), OPENAIP_MAX_DIST_M)

    params = {
        "pos": f"{lat},{lon}",
        "dist": dist_m,
        "limit": 200,
    }

    if airspace_types:
        params["type"] = ",".join(str(t) for t in airspace_types)

    result = _make_request("airspaces", params)

    if not result:
        return []

    items = result.get("items", [])
    airspaces = []

    for item in items:
        airspace = _parse_airspace(item)
        if airspace:
            airspaces.append(airspace)

    cache.set(cache_key, airspaces, AIRSPACE_CACHE_TTL)
    return airspaces


def _parse_airspace(item: dict[str, Any]) -> dict[str, Any] | None:
    """
    Parse an airspace item from the API response.

    Args:
        item: Raw airspace data from API

    Returns:
        Parsed airspace dictionary or None if invalid
    """
    try:
        airspace_type_id = item.get("type", 0)
        airspace_type = AIRSPACE_TYPES.get(airspace_type_id, "OTHER")

        # Parse altitude limits
        lower_limit = item.get("lowerLimit", {})
        upper_limit = item.get("upperLimit", {})

        floor_ft = None
        ceiling_ft = None

        if isinstance(lower_limit, dict):
            floor_ft = _limit_to_ft(lower_limit)

        if isinstance(upper_limit, dict):
            ceiling_ft = _limit_to_ft(upper_limit)

        # Parse geometry
        geometry = item.get("geometry")
        if not geometry:
            return None

        return {
            "id": item.get("_id", ""),
            "name": item.get("name", "Unknown"),
            "type": airspace_type,
            "type_id": airspace_type_id,
            "country": item.get("country", ""),
            "floor_ft": floor_ft,
            "ceiling_ft": ceiling_ft,
            "floor_ref": _limit_reference(lower_limit) if isinstance(lower_limit, dict) else "MSL",
            "ceiling_ref": _limit_reference(upper_limit) if isinstance(upper_limit, dict) else "MSL",
            "geometry": geometry,
            "source": "openaip",
        }

    except (ValueError, KeyError, TypeError, AttributeError) as e:
        logger.warning(f"Failed to parse airspace: {e}")
        return None


def get_airports(
    lat: float,
    lon: float,
    radius_nm: float = 100,
    airport_types: list[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Get airport data for a region.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Search radius in nautical miles
        airport_types: Optional list of airport type IDs

    Returns:
        List of airport dictionaries
    """
    if not _is_enabled():
        return []

    cache_key = f"openaip_airports_{lat:.2f}_{lon:.2f}_{radius_nm}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    radius_km = radius_nm * 1.852

    params = {
        "pos": f"{lat},{lon}",
        "dist": int(radius_km * 1000),
        "limit": 200,
    }

    if airport_types:
        params["type"] = ",".join(str(t) for t in airport_types)

    result = _make_request("airports", params)

    if not result:
        return []

    items = result.get("items", [])
    airports = []

    for item in items:
        airport = _parse_airport(item)
        if airport:
            airports.append(airport)

    cache.set(cache_key, airports, AIRPORTS_CACHE_TTL)
    return airports


def _parse_airport(item: dict[str, Any]) -> dict[str, Any] | None:
    """
    Parse an airport item from the API response.

    Args:
        item: Raw airport data from API

    Returns:
        Parsed airport dictionary or None if invalid
    """
    try:
        # Parse location
        geometry = item.get("geometry", {})
        coordinates = geometry.get("coordinates", [])

        if len(coordinates) < 2:
            return None

        lon, lat = coordinates[0], coordinates[1]

        return {
            "id": item.get("_id", ""),
            "name": item.get("name", "Unknown"),
            "icao": item.get("icaoCode", ""),
            "iata": item.get("iataCode", ""),
            "country": item.get("country", ""),
            "latitude": lat,
            "longitude": lon,
            "elevation_ft": item.get("elevation", {}).get("value"),
            "type": item.get("type", 0),
            "runways": item.get("runways", []),
            "frequencies": item.get("frequencies", []),
            "source": "openaip",
        }

    except (ValueError, KeyError, TypeError, AttributeError) as e:
        logger.warning(f"Failed to parse airport: {e}")
        return None


def get_navaids(
    lat: float,
    lon: float,
    radius_nm: float = 100,
) -> list[dict[str, Any]]:
    """
    Get navaid data for a region.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Search radius in nautical miles

    Returns:
        List of navaid dictionaries
    """
    if not _is_enabled():
        return []

    cache_key = f"openaip_navaids_{lat:.2f}_{lon:.2f}_{radius_nm}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    radius_km = radius_nm * 1.852

    params = {
        "pos": f"{lat},{lon}",
        "dist": int(radius_km * 1000),
        "limit": 200,
    }

    result = _make_request("navaids", params)

    if not result:
        return []

    items = result.get("items", [])
    navaids = []

    for item in items:
        navaid = _parse_navaid(item)
        if navaid:
            navaids.append(navaid)

    cache.set(cache_key, navaids, AIRPORTS_CACHE_TTL)
    return navaids


def _parse_navaid(item: dict[str, Any]) -> dict[str, Any] | None:
    """
    Parse a navaid item from the API response.

    Args:
        item: Raw navaid data from API

    Returns:
        Parsed navaid dictionary or None if invalid
    """
    try:
        geometry = item.get("geometry", {})
        coordinates = geometry.get("coordinates", [])

        if len(coordinates) < 2:
            return None

        lon, lat = coordinates[0], coordinates[1]

        navaid_types = {
            0: "OTHER",
            1: "NDB",
            2: "VOR",
            3: "VOR-DME",
            4: "VORTAC",
            5: "TACAN",
            6: "DME",
            7: "NDB-DME",
        }

        type_id = item.get("type", 0)

        return {
            "id": item.get("_id", ""),
            "ident": item.get("identifier", ""),
            "name": item.get("name", "Unknown"),
            "type": navaid_types.get(type_id, "OTHER"),
            "type_id": type_id,
            "latitude": lat,
            "longitude": lon,
            "frequency": item.get("frequency", {}).get("value"),
            "country": item.get("country", ""),
            "source": "openaip",
        }

    except (ValueError, KeyError, TypeError, AttributeError) as e:
        logger.warning(f"Failed to parse navaid: {e}")
        return None


def get_reporting_points(
    lat: float,
    lon: float,
    radius_nm: float = 100,
) -> list[dict[str, Any]]:
    """
    Get reporting points for a region.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Search radius in nautical miles

    Returns:
        List of reporting point dictionaries
    """
    if not _is_enabled():
        return []

    cache_key = f"openaip_reporting_{lat:.2f}_{lon:.2f}_{radius_nm}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    radius_km = radius_nm * 1.852

    params = {
        "pos": f"{lat},{lon}",
        "dist": int(radius_km * 1000),
        "limit": 200,
    }

    result = _make_request("reporting-points", params)

    if not result:
        return []

    items = result.get("items", [])
    points = []

    for item in items:
        geometry = item.get("geometry", {})
        coordinates = geometry.get("coordinates", [])

        if len(coordinates) >= 2:
            points.append(
                {
                    "id": item.get("_id", ""),
                    "ident": item.get("identifier", ""),
                    "name": item.get("name", "Unknown"),
                    "latitude": coordinates[1],
                    "longitude": coordinates[0],
                    "country": item.get("country", ""),
                    "source": "openaip",
                }
            )

    cache.set(cache_key, points, AIRPORTS_CACHE_TTL)
    return points


def get_api_status() -> dict[str, Any]:
    """
    Get OpenAIP API status and configuration.

    Returns:
        API status dictionary
    """
    return {
        "enabled": _is_enabled(),
        "api_key_configured": bool(_get_api_key()),
        "cache_ttl_airspace": AIRSPACE_CACHE_TTL,
        "cache_ttl_airports": AIRPORTS_CACHE_TTL,
    }
