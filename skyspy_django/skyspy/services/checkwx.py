"""
CheckWX weather API service.

Provides decoded METAR/TAF data with flight category calculation.
CheckWX API: https://www.checkwxapi.com/

Free tier: 3,000 requests/day
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

# API configuration
CHECKWX_API_BASE = "https://api.checkwxapi.com"

# Cache settings
METAR_CACHE_TTL = 300  # 5 minutes
TAF_CACHE_TTL = 1800  # 30 minutes

# Flight categories
FLIGHT_CATEGORIES = {
    'VFR': {'ceiling': 3000, 'visibility': 5},   # >3000ft AGL, >5SM
    'MVFR': {'ceiling': 1000, 'visibility': 3},  # 1000-3000ft, 3-5SM
    'IFR': {'ceiling': 500, 'visibility': 1},    # 500-1000ft, 1-3SM
    'LIFR': {'ceiling': 0, 'visibility': 0},     # <500ft, <1SM
}


def _get_api_key() -> Optional[str]:
    """Get CheckWX API key from settings."""
    return getattr(settings, 'CHECKWX_API_KEY', None)


def _is_enabled() -> bool:
    """Check if CheckWX is enabled."""
    return getattr(settings, 'CHECKWX_ENABLED', False) and _get_api_key()


def _make_request(endpoint: str, params: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
    """
    Make a request to the CheckWX API.

    Args:
        endpoint: API endpoint path
        params: Optional query parameters

    Returns:
        API response data or None if failed
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("CheckWX API key not configured")
        return None

    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(
                f"{CHECKWX_API_BASE}/{endpoint}",
                params=params,
                headers={
                    "X-API-Key": api_key,
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("CheckWX rate limit exceeded")
        else:
            logger.error(f"CheckWX API error: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"CheckWX API request failed: {e}")
        return None


def get_metar(icao: str, decoded: bool = True) -> Optional[Dict[str, Any]]:
    """
    Get METAR data for an airport.

    Args:
        icao: Airport ICAO code (e.g., 'KSEA')
        decoded: Whether to return decoded data (default: True)

    Returns:
        METAR data dictionary or None if failed
    """
    if not _is_enabled():
        return None

    icao = icao.upper()
    cache_key = f"checkwx_metar_{icao}"

    # Check cache
    cached = cache.get(cache_key)
    if cached:
        return cached

    endpoint = f"metar/{icao}/decoded" if decoded else f"metar/{icao}"
    result = _make_request(endpoint)

    if result and result.get('results', 0) > 0:
        data = result.get('data', [])
        if data:
            metar = data[0] if isinstance(data, list) else data
            metar['source'] = 'checkwx'
            metar['fetched_at'] = datetime.utcnow().isoformat() + 'Z'
            cache.set(cache_key, metar, METAR_CACHE_TTL)
            return metar

    return None


def get_metar_bulk(icao_list: List[str], decoded: bool = True) -> Dict[str, Dict[str, Any]]:
    """
    Get METAR data for multiple airports.

    Args:
        icao_list: List of airport ICAO codes
        decoded: Whether to return decoded data

    Returns:
        Dictionary mapping ICAO codes to METAR data
    """
    if not _is_enabled():
        return {}

    results = {}
    uncached = []

    # Check cache first
    for icao in icao_list:
        icao = icao.upper()
        cache_key = f"checkwx_metar_{icao}"
        cached = cache.get(cache_key)
        if cached:
            results[icao] = cached
        else:
            uncached.append(icao)

    # Fetch uncached in batches (CheckWX allows comma-separated ICAOs)
    if uncached:
        batch_size = 10  # Limit batch size
        for i in range(0, len(uncached), batch_size):
            batch = uncached[i:i + batch_size]
            icao_str = ','.join(batch)

            endpoint = f"metar/{icao_str}/decoded" if decoded else f"metar/{icao_str}"
            result = _make_request(endpoint)

            if result and result.get('results', 0) > 0:
                data = result.get('data', [])
                if isinstance(data, list):
                    for metar in data:
                        icao = metar.get('icao', '').upper()
                        if icao:
                            metar['source'] = 'checkwx'
                            metar['fetched_at'] = datetime.utcnow().isoformat() + 'Z'
                            results[icao] = metar
                            cache.set(f"checkwx_metar_{icao}", metar, METAR_CACHE_TTL)

    return results


def get_taf(icao: str, decoded: bool = True) -> Optional[Dict[str, Any]]:
    """
    Get TAF forecast for an airport.

    Args:
        icao: Airport ICAO code
        decoded: Whether to return decoded data

    Returns:
        TAF data dictionary or None if failed
    """
    if not _is_enabled():
        return None

    icao = icao.upper()
    cache_key = f"checkwx_taf_{icao}"

    # Check cache
    cached = cache.get(cache_key)
    if cached:
        return cached

    endpoint = f"taf/{icao}/decoded" if decoded else f"taf/{icao}"
    result = _make_request(endpoint)

    if result and result.get('results', 0) > 0:
        data = result.get('data', [])
        if data:
            taf = data[0] if isinstance(data, list) else data
            taf['source'] = 'checkwx'
            taf['fetched_at'] = datetime.utcnow().isoformat() + 'Z'
            cache.set(cache_key, taf, TAF_CACHE_TTL)
            return taf

    return None


def get_station(icao: str) -> Optional[Dict[str, Any]]:
    """
    Get station/airport information.

    Args:
        icao: Airport ICAO code

    Returns:
        Station data dictionary or None if failed
    """
    if not _is_enabled():
        return None

    icao = icao.upper()
    cache_key = f"checkwx_station_{icao}"

    # Check cache (longer TTL for station data)
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f"station/{icao}")

    if result and result.get('results', 0) > 0:
        data = result.get('data', [])
        if data:
            station = data[0] if isinstance(data, list) else data
            station['source'] = 'checkwx'
            cache.set(cache_key, station, 86400)  # 24 hour cache
            return station

    return None


def calculate_flight_category(
    ceiling_ft: Optional[int],
    visibility_sm: Optional[float]
) -> str:
    """
    Calculate flight category based on ceiling and visibility.

    Args:
        ceiling_ft: Ceiling in feet AGL
        visibility_sm: Visibility in statute miles

    Returns:
        Flight category string (VFR, MVFR, IFR, LIFR)
    """
    # Default to VFR if no data
    if ceiling_ft is None and visibility_sm is None:
        return 'VFR'

    # Assume unlimited if not specified
    ceiling = ceiling_ft if ceiling_ft is not None else 99999
    visibility = visibility_sm if visibility_sm is not None else 99

    if ceiling < 500 or visibility < 1:
        return 'LIFR'
    elif ceiling < 1000 or visibility < 3:
        return 'IFR'
    elif ceiling < 3000 or visibility < 5:
        return 'MVFR'
    else:
        return 'VFR'


def parse_decoded_metar(metar: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse decoded METAR into normalized format.

    Args:
        metar: Decoded METAR from CheckWX

    Returns:
        Normalized weather data dictionary
    """
    result = {
        'icao': metar.get('icao', ''),
        'observed': metar.get('observed'),
        'raw_text': metar.get('raw_text', ''),
        'source': 'checkwx',
    }

    # Temperature and dewpoint
    temp = metar.get('temperature', {})
    if isinstance(temp, dict):
        result['temperature_c'] = temp.get('celsius')
        result['temperature_f'] = temp.get('fahrenheit')

    dewpoint = metar.get('dewpoint', {})
    if isinstance(dewpoint, dict):
        result['dewpoint_c'] = dewpoint.get('celsius')
        result['dewpoint_f'] = dewpoint.get('fahrenheit')

    # Wind
    wind = metar.get('wind', {})
    if isinstance(wind, dict):
        result['wind_direction'] = wind.get('degrees')
        result['wind_speed_kt'] = wind.get('speed_kts')
        result['wind_gust_kt'] = wind.get('gust_kts')

    # Visibility
    visibility = metar.get('visibility', {})
    if isinstance(visibility, dict):
        result['visibility_sm'] = visibility.get('miles')
        result['visibility_meters'] = visibility.get('meters')
    elif isinstance(visibility, (int, float)):
        result['visibility_sm'] = visibility

    # Ceiling
    clouds = metar.get('clouds', [])
    ceiling = None
    if isinstance(clouds, list):
        for cloud in clouds:
            if isinstance(cloud, dict):
                code = cloud.get('code', '').upper()
                if code in ('BKN', 'OVC', 'VV'):
                    base = cloud.get('base_feet_agl')
                    if base is not None and (ceiling is None or base < ceiling):
                        ceiling = base
        result['ceiling_ft'] = ceiling
        result['clouds'] = clouds

    # Flight category
    flight_cat = metar.get('flight_category')
    if not flight_cat:
        flight_cat = calculate_flight_category(
            result.get('ceiling_ft'),
            result.get('visibility_sm')
        )
    result['flight_category'] = flight_cat

    # Barometer
    barometer = metar.get('barometer', {})
    if isinstance(barometer, dict):
        result['altimeter_hg'] = barometer.get('hg')
        result['altimeter_mb'] = barometer.get('mb')

    # Humidity
    result['humidity_percent'] = metar.get('humidity', {}).get('percent')

    # Conditions/weather
    conditions = metar.get('conditions', [])
    if conditions:
        result['conditions'] = conditions
        result['weather'] = ', '.join(
            c.get('text', '') for c in conditions if isinstance(c, dict)
        )

    return result


def get_weather_for_aircraft(
    lat: float,
    lon: float,
    radius_nm: float = 50
) -> Dict[str, Any]:
    """
    Get weather data for aircraft location.

    Finds nearest airport and returns weather data.

    Args:
        lat: Aircraft latitude
        lon: Aircraft longitude
        radius_nm: Search radius in nautical miles

    Returns:
        Weather data dictionary
    """
    # This would typically query for nearby airports and get their METAR
    # For now, return empty as we'd need airport lookup
    return {
        'source': 'checkwx',
        'enabled': _is_enabled(),
        'nearby_stations': [],
    }


def get_api_status() -> Dict[str, Any]:
    """
    Get CheckWX API status and usage info.

    Returns:
        API status dictionary
    """
    return {
        'enabled': _is_enabled(),
        'api_key_configured': bool(_get_api_key()),
        'cache_ttl_metar': METAR_CACHE_TTL,
        'cache_ttl_taf': TAF_CACHE_TTL,
        'daily_limit': 3000,
    }
