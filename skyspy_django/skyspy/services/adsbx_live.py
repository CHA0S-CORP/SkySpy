"""
ADS-B Exchange Live API service.

Provides unfiltered real-time aircraft data from ADS-B Exchange.
ADS-B Exchange: https://www.adsbexchange.com/

Access via RapidAPI with various tier options.
Advantage: Unfiltered data (no LADD/PIA blocking)
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

# API configuration (RapidAPI)
ADSBX_RAPIDAPI_HOST = "adsbexchange-com1.p.rapidapi.com"
ADSBX_RAPIDAPI_BASE = f"https://{ADSBX_RAPIDAPI_HOST}"

# Cache settings
AIRCRAFT_CACHE_TTL = 5  # 5 seconds


def _get_api_key() -> Optional[str]:
    """Get ADS-B Exchange RapidAPI key from settings."""
    return getattr(settings, 'ADSBX_RAPIDAPI_KEY', None)


def _is_enabled() -> bool:
    """Check if ADS-B Exchange Live API is enabled."""
    return getattr(settings, 'ADSBX_LIVE_ENABLED', False) and _get_api_key()


def _make_request(
    endpoint: str,
    params: Optional[Dict] = None,
    timeout: int = 15
) -> Optional[Dict[str, Any]]:
    """
    Make a request to the ADS-B Exchange API via RapidAPI.

    Args:
        endpoint: API endpoint path
        params: Optional query parameters
        timeout: Request timeout in seconds

    Returns:
        API response data or None if failed
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("ADS-B Exchange API key not configured")
        return None

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                f"{ADSBX_RAPIDAPI_BASE}/{endpoint}",
                params=params,
                headers={
                    "X-RapidAPI-Key": api_key,
                    "X-RapidAPI-Host": ADSBX_RAPIDAPI_HOST,
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("ADS-B Exchange rate limit exceeded")
        elif e.response.status_code == 401:
            logger.error("ADS-B Exchange authentication failed - check API key")
        elif e.response.status_code == 403:
            logger.error("ADS-B Exchange access forbidden - check subscription")
        else:
            logger.error(f"ADS-B Exchange API error: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"ADS-B Exchange API request failed: {e}")
        return None


def get_aircraft_by_icao(icao_hex: str) -> Optional[Dict[str, Any]]:
    """
    Get current position for a specific aircraft.

    Args:
        icao_hex: Aircraft ICAO hex code (6 characters)

    Returns:
        Aircraft data dictionary or None if not found
    """
    if not _is_enabled():
        return None

    icao_hex = icao_hex.upper()
    cache_key = f"adsbx_aircraft_{icao_hex}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'v2/icao/{icao_hex}/')

    if not result:
        return None

    aircraft_list = result.get('ac', [])
    if not aircraft_list:
        return None

    parsed = _parse_aircraft(aircraft_list[0])
    if parsed:
        cache.set(cache_key, parsed, AIRCRAFT_CACHE_TTL)

    return parsed


def get_aircraft_by_callsign(callsign: str) -> List[Dict[str, Any]]:
    """
    Get aircraft by callsign.

    Args:
        callsign: Aircraft callsign

    Returns:
        List of matching aircraft
    """
    if not _is_enabled():
        return []

    callsign = callsign.upper().strip()
    cache_key = f"adsbx_callsign_{callsign}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'v2/callsign/{callsign}/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def get_aircraft_by_registration(registration: str) -> Optional[Dict[str, Any]]:
    """
    Get aircraft by registration number.

    Args:
        registration: Aircraft registration (e.g., N12345)

    Returns:
        Aircraft data dictionary or None if not found
    """
    if not _is_enabled():
        return None

    registration = registration.upper().strip()
    cache_key = f"adsbx_reg_{registration}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'v2/registration/{registration}/')

    if not result:
        return None

    aircraft_list = result.get('ac', [])
    if not aircraft_list:
        return None

    parsed = _parse_aircraft(aircraft_list[0])
    if parsed:
        cache.set(cache_key, parsed, AIRCRAFT_CACHE_TTL)

    return parsed


def get_aircraft_by_squawk(squawk: str) -> List[Dict[str, Any]]:
    """
    Get aircraft by squawk code.

    Args:
        squawk: Squawk code (4 digits)

    Returns:
        List of matching aircraft
    """
    if not _is_enabled():
        return []

    cache_key = f"adsbx_squawk_{squawk}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'v2/sqk/{squawk}/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def get_aircraft_by_type(type_code: str) -> List[Dict[str, Any]]:
    """
    Get all aircraft of a specific type.

    Args:
        type_code: Aircraft type ICAO code (e.g., B738)

    Returns:
        List of matching aircraft
    """
    if not _is_enabled():
        return []

    type_code = type_code.upper().strip()
    cache_key = f"adsbx_type_{type_code}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'v2/type/{type_code}/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def get_aircraft_in_area(
    lat: float,
    lon: float,
    radius_nm: float = 100
) -> List[Dict[str, Any]]:
    """
    Get aircraft within a radius of a point.

    Args:
        lat: Center latitude
        lon: Center longitude
        radius_nm: Search radius in nautical miles

    Returns:
        List of aircraft in area
    """
    if not _is_enabled():
        return []

    cache_key = f"adsbx_area_{lat:.2f}_{lon:.2f}_{radius_nm}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'v2/lat/{lat}/lon/{lon}/dist/{int(radius_nm)}/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def get_military_aircraft() -> List[Dict[str, Any]]:
    """
    Get all military aircraft currently tracked.

    Returns:
        List of military aircraft
    """
    if not _is_enabled():
        return []

    cache_key = "adsbx_military"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request('v2/mil/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed['is_military'] = True
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def get_ladd_aircraft() -> List[Dict[str, Any]]:
    """
    Get aircraft on the LADD (Limiting Aircraft Data Displayed) list.

    These aircraft have requested privacy and are typically blocked
    from other services. ADS-B Exchange shows them unfiltered.

    Returns:
        List of LADD aircraft
    """
    if not _is_enabled():
        return []

    cache_key = "adsbx_ladd"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request('v2/ladd/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed['is_ladd'] = True
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def get_pia_aircraft() -> List[Dict[str, Any]]:
    """
    Get aircraft using PIA (Privacy ICAO Address).

    These aircraft have temporary ICAO addresses for privacy.
    ADS-B Exchange shows them unfiltered.

    Returns:
        List of PIA aircraft
    """
    if not _is_enabled():
        return []

    cache_key = "adsbx_pia"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request('v2/pia/')

    if not result:
        return []

    aircraft_list = result.get('ac', [])
    parsed_list = []

    for ac in aircraft_list:
        parsed = _parse_aircraft(ac)
        if parsed:
            parsed['is_pia'] = True
            parsed_list.append(parsed)

    cache.set(cache_key, parsed_list, AIRCRAFT_CACHE_TTL)
    return parsed_list


def _parse_aircraft(ac: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse an ADS-B Exchange aircraft record.

    Args:
        ac: Raw aircraft data from API

    Returns:
        Parsed aircraft dictionary or None if invalid
    """
    try:
        icao_hex = ac.get('hex', ac.get('icao', ''))
        if not icao_hex:
            return None

        lat = ac.get('lat')
        lon = ac.get('lon')

        return {
            'icao_hex': icao_hex.upper(),
            'callsign': ac.get('flight', '').strip() if ac.get('flight') else None,
            'registration': ac.get('r'),
            'aircraft_type': ac.get('t'),
            'latitude': lat,
            'longitude': lon,
            'altitude_baro_ft': ac.get('alt_baro'),
            'altitude_geo_ft': ac.get('alt_geom'),
            'ground_speed_kt': ac.get('gs'),
            'track': ac.get('track'),
            'vertical_rate_fpm': ac.get('baro_rate'),
            'squawk': ac.get('squawk'),
            'emergency': ac.get('emergency'),
            'category': ac.get('category'),
            'nav_modes': ac.get('nav_modes'),
            'nav_altitude_fms': ac.get('nav_altitude_fms'),
            'nav_altitude_mcp': ac.get('nav_altitude_mcp'),
            'nav_heading': ac.get('nav_heading'),
            'on_ground': ac.get('alt_baro') == 'ground',
            'seen': ac.get('seen'),
            'seen_pos': ac.get('seen_pos'),
            'rssi': ac.get('rssi'),
            'source': 'adsbexchange',
            'is_military': ac.get('mil', False),
            'is_ladd': ac.get('ladd', False),
            'is_pia': ac.get('pia', False),
        }

    except Exception as e:
        logger.warning(f"Failed to parse ADS-B Exchange aircraft: {e}")
        return None


def track_aircraft_globally(icao_hex: str) -> Optional[Dict[str, Any]]:
    """
    Track an aircraft globally via ADS-B Exchange.

    Useful for "follow" functionality when aircraft leaves local range.

    Args:
        icao_hex: Aircraft ICAO hex code

    Returns:
        Latest aircraft position or None if not found
    """
    return get_aircraft_by_icao(icao_hex)


def get_api_status() -> Dict[str, Any]:
    """
    Get ADS-B Exchange API status and configuration.

    Returns:
        API status dictionary
    """
    return {
        'enabled': _is_enabled(),
        'api_key_configured': bool(_get_api_key()),
        'cache_ttl': AIRCRAFT_CACHE_TTL,
        'features': [
            'unfiltered_data',
            'ladd_aircraft',
            'pia_aircraft',
            'military_filter',
        ],
    }
