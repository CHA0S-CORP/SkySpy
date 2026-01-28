"""
OpenAIP airspace data service.

Provides global airspace boundaries, airports, and navaids from OpenAIP.
OpenAIP API: https://www.openaip.net/

Free tier: Unlimited with API key registration
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import transaction

logger = logging.getLogger(__name__)

# API configuration
OPENAIP_API_BASE = "https://api.core.openaip.net/api"

# Cache settings
AIRSPACE_CACHE_TTL = 3600  # 1 hour
AIRPORTS_CACHE_TTL = 86400  # 24 hours

# Airspace types mapping
AIRSPACE_TYPES = {
    0: 'OTHER',
    1: 'RESTRICTED',
    2: 'DANGER',
    3: 'PROHIBITED',
    4: 'CTR',
    5: 'TMZ',
    6: 'RMZ',
    7: 'TMA',
    8: 'TRA',
    9: 'TSA',
    10: 'FIR',
    11: 'UIR',
    12: 'ADIZ',
    13: 'ATZ',
    14: 'MATZ',
    15: 'AIRWAY',
    16: 'MTR',
    17: 'ALERT',
    18: 'WARNING',
    19: 'PROTECTED',
    20: 'HTZ',
    21: 'GLIDING',
    22: 'TRP',
    23: 'TIZ',
    24: 'TIA',
    25: 'MTA',
    26: 'CTA',
    27: 'ACC',
    28: 'SECTOR',
    29: 'OCA',
    30: 'MORA',
    31: 'PARACHUTE',
    32: 'WILDLIFE',
    33: 'LMA',
}


def _get_api_key() -> Optional[str]:
    """Get OpenAIP API key from settings."""
    return getattr(settings, 'OPENAIP_API_KEY', None)


def _is_enabled() -> bool:
    """Check if OpenAIP is enabled."""
    return getattr(settings, 'OPENAIP_ENABLED', False) and _get_api_key()


def _make_request(
    endpoint: str,
    params: Optional[Dict] = None,
    timeout: int = 30
) -> Optional[Dict[str, Any]]:
    """
    Make a request to the OpenAIP API.

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
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                f"{OPENAIP_API_BASE}/{endpoint}",
                params=params,
                headers={
                    "x-openaip-api-key": api_key,
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("OpenAIP rate limit exceeded")
        elif e.response.status_code == 401:
            logger.error("OpenAIP authentication failed - check API key")
        else:
            logger.error(f"OpenAIP API error: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"OpenAIP API request failed: {e}")
        return None


def get_airspaces(
    lat: float,
    lon: float,
    radius_nm: float = 100,
    airspace_types: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
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

    # Convert nm to km for API
    radius_km = radius_nm * 1.852

    params = {
        'pos': f"{lon},{lat}",
        'dist': int(radius_km * 1000),  # API expects meters
        'limit': 200,
    }

    if airspace_types:
        params['type'] = ','.join(str(t) for t in airspace_types)

    result = _make_request('airspaces', params)

    if not result:
        return []

    items = result.get('items', [])
    airspaces = []

    for item in items:
        airspace = _parse_airspace(item)
        if airspace:
            airspaces.append(airspace)

    cache.set(cache_key, airspaces, AIRSPACE_CACHE_TTL)
    return airspaces


def _parse_airspace(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse an airspace item from the API response.

    Args:
        item: Raw airspace data from API

    Returns:
        Parsed airspace dictionary or None if invalid
    """
    try:
        airspace_type_id = item.get('type', 0)
        airspace_type = AIRSPACE_TYPES.get(airspace_type_id, 'OTHER')

        # Parse altitude limits
        lower_limit = item.get('lowerLimit', {})
        upper_limit = item.get('upperLimit', {})

        floor_ft = None
        ceiling_ft = None

        if isinstance(lower_limit, dict):
            floor_value = lower_limit.get('value', 0)
            floor_unit = lower_limit.get('unit', 'ft')
            if floor_unit == 'm':
                floor_ft = int(floor_value * 3.281)
            else:
                floor_ft = int(floor_value)

        if isinstance(upper_limit, dict):
            ceiling_value = upper_limit.get('value', 0)
            ceiling_unit = upper_limit.get('unit', 'ft')
            if ceiling_unit == 'm':
                ceiling_ft = int(ceiling_value * 3.281)
            else:
                ceiling_ft = int(ceiling_value)

        # Parse geometry
        geometry = item.get('geometry')
        if not geometry:
            return None

        return {
            'id': item.get('_id', ''),
            'name': item.get('name', 'Unknown'),
            'type': airspace_type,
            'type_id': airspace_type_id,
            'country': item.get('country', ''),
            'floor_ft': floor_ft,
            'ceiling_ft': ceiling_ft,
            'floor_ref': lower_limit.get('referenceDatum', 'MSL') if isinstance(lower_limit, dict) else 'MSL',
            'ceiling_ref': upper_limit.get('referenceDatum', 'MSL') if isinstance(upper_limit, dict) else 'MSL',
            'geometry': geometry,
            'source': 'openaip',
        }

    except Exception as e:
        logger.warning(f"Failed to parse airspace: {e}")
        return None


def get_airports(
    lat: float,
    lon: float,
    radius_nm: float = 100,
    airport_types: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
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
        'pos': f"{lon},{lat}",
        'dist': int(radius_km * 1000),
        'limit': 200,
    }

    if airport_types:
        params['type'] = ','.join(str(t) for t in airport_types)

    result = _make_request('airports', params)

    if not result:
        return []

    items = result.get('items', [])
    airports = []

    for item in items:
        airport = _parse_airport(item)
        if airport:
            airports.append(airport)

    cache.set(cache_key, airports, AIRPORTS_CACHE_TTL)
    return airports


def _parse_airport(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse an airport item from the API response.

    Args:
        item: Raw airport data from API

    Returns:
        Parsed airport dictionary or None if invalid
    """
    try:
        # Parse location
        geometry = item.get('geometry', {})
        coordinates = geometry.get('coordinates', [])

        if len(coordinates) < 2:
            return None

        lon, lat = coordinates[0], coordinates[1]

        return {
            'id': item.get('_id', ''),
            'name': item.get('name', 'Unknown'),
            'icao': item.get('icaoCode', ''),
            'iata': item.get('iataCode', ''),
            'country': item.get('country', ''),
            'latitude': lat,
            'longitude': lon,
            'elevation_ft': item.get('elevation', {}).get('value'),
            'type': item.get('type', 0),
            'runways': item.get('runways', []),
            'frequencies': item.get('frequencies', []),
            'source': 'openaip',
        }

    except Exception as e:
        logger.warning(f"Failed to parse airport: {e}")
        return None


def get_navaids(
    lat: float,
    lon: float,
    radius_nm: float = 100,
) -> List[Dict[str, Any]]:
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
        'pos': f"{lon},{lat}",
        'dist': int(radius_km * 1000),
        'limit': 200,
    }

    result = _make_request('navaids', params)

    if not result:
        return []

    items = result.get('items', [])
    navaids = []

    for item in items:
        navaid = _parse_navaid(item)
        if navaid:
            navaids.append(navaid)

    cache.set(cache_key, navaids, AIRPORTS_CACHE_TTL)
    return navaids


def _parse_navaid(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse a navaid item from the API response.

    Args:
        item: Raw navaid data from API

    Returns:
        Parsed navaid dictionary or None if invalid
    """
    try:
        geometry = item.get('geometry', {})
        coordinates = geometry.get('coordinates', [])

        if len(coordinates) < 2:
            return None

        lon, lat = coordinates[0], coordinates[1]

        navaid_types = {
            0: 'OTHER',
            1: 'NDB',
            2: 'VOR',
            3: 'VOR-DME',
            4: 'VORTAC',
            5: 'TACAN',
            6: 'DME',
            7: 'NDB-DME',
        }

        type_id = item.get('type', 0)

        return {
            'id': item.get('_id', ''),
            'ident': item.get('identifier', ''),
            'name': item.get('name', 'Unknown'),
            'type': navaid_types.get(type_id, 'OTHER'),
            'type_id': type_id,
            'latitude': lat,
            'longitude': lon,
            'frequency': item.get('frequency', {}).get('value'),
            'country': item.get('country', ''),
            'source': 'openaip',
        }

    except Exception as e:
        logger.warning(f"Failed to parse navaid: {e}")
        return None


def get_reporting_points(
    lat: float,
    lon: float,
    radius_nm: float = 100,
) -> List[Dict[str, Any]]:
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
        'pos': f"{lon},{lat}",
        'dist': int(radius_km * 1000),
        'limit': 200,
    }

    result = _make_request('reporting-points', params)

    if not result:
        return []

    items = result.get('items', [])
    points = []

    for item in items:
        geometry = item.get('geometry', {})
        coordinates = geometry.get('coordinates', [])

        if len(coordinates) >= 2:
            points.append({
                'id': item.get('_id', ''),
                'ident': item.get('identifier', ''),
                'name': item.get('name', 'Unknown'),
                'latitude': coordinates[1],
                'longitude': coordinates[0],
                'country': item.get('country', ''),
                'source': 'openaip',
            })

    cache.set(cache_key, points, AIRPORTS_CACHE_TTL)
    return points


def get_api_status() -> Dict[str, Any]:
    """
    Get OpenAIP API status and configuration.

    Returns:
        API status dictionary
    """
    return {
        'enabled': _is_enabled(),
        'api_key_configured': bool(_get_api_key()),
        'cache_ttl_airspace': AIRSPACE_CACHE_TTL,
        'cache_ttl_airports': AIRPORTS_CACHE_TTL,
    }
