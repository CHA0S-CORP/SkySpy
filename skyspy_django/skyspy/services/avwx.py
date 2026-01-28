"""
AVWX weather API service.

Provides decoded METAR/TAF data as a fallback/secondary source.
AVWX API: https://avwx.rest/

Free tier: Unlimited basic requests
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

# API configuration
AVWX_API_BASE = "https://avwx.rest/api"

# Cache settings
METAR_CACHE_TTL = 300  # 5 minutes
TAF_CACHE_TTL = 1800  # 30 minutes


def _get_api_key() -> Optional[str]:
    """Get AVWX API key from settings (optional for basic access)."""
    return getattr(settings, 'AVWX_API_KEY', None)


def _is_enabled() -> bool:
    """Check if AVWX is enabled."""
    return getattr(settings, 'AVWX_ENABLED', True)  # Enabled by default


def _make_request(endpoint: str, params: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
    """
    Make a request to the AVWX API.

    Args:
        endpoint: API endpoint path
        params: Optional query parameters

    Returns:
        API response data or None if failed
    """
    if not _is_enabled():
        return None

    headers = {
        "Accept": "application/json",
    }

    api_key = _get_api_key()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(
                f"{AVWX_API_BASE}/{endpoint}",
                params=params,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("AVWX rate limit exceeded")
        elif e.response.status_code == 401:
            logger.warning("AVWX authentication failed")
        else:
            logger.error(f"AVWX API error: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"AVWX API request failed: {e}")
        return None


def get_metar(icao: str) -> Optional[Dict[str, Any]]:
    """
    Get decoded METAR data for an airport.

    Args:
        icao: Airport ICAO code (e.g., 'KSEA')

    Returns:
        METAR data dictionary or None if failed
    """
    icao = icao.upper()
    cache_key = f"avwx_metar_{icao}"

    # Check cache
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f"metar/{icao}")

    if result:
        result['source'] = 'avwx'
        result['fetched_at'] = datetime.utcnow().isoformat() + 'Z'

        # Normalize the response
        normalized = _normalize_metar(result)
        cache.set(cache_key, normalized, METAR_CACHE_TTL)
        return normalized

    return None


def get_taf(icao: str) -> Optional[Dict[str, Any]]:
    """
    Get decoded TAF forecast for an airport.

    Args:
        icao: Airport ICAO code

    Returns:
        TAF data dictionary or None if failed
    """
    icao = icao.upper()
    cache_key = f"avwx_taf_{icao}"

    # Check cache
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f"taf/{icao}")

    if result:
        result['source'] = 'avwx'
        result['fetched_at'] = datetime.utcnow().isoformat() + 'Z'
        cache.set(cache_key, result, TAF_CACHE_TTL)
        return result

    return None


def get_station(icao: str) -> Optional[Dict[str, Any]]:
    """
    Get station/airport information.

    Args:
        icao: Airport ICAO code

    Returns:
        Station data dictionary or None if failed
    """
    icao = icao.upper()
    cache_key = f"avwx_station_{icao}"

    # Check cache (longer TTL for station data)
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f"station/{icao}")

    if result:
        result['source'] = 'avwx'
        cache.set(cache_key, result, 86400)  # 24 hour cache
        return result

    return None


def _normalize_metar(metar: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize AVWX METAR response to standard format.

    Args:
        metar: Raw AVWX METAR response

    Returns:
        Normalized weather data dictionary
    """
    result = {
        'icao': metar.get('station', ''),
        'raw_text': metar.get('raw', ''),
        'source': 'avwx',
        'fetched_at': metar.get('fetched_at'),
    }

    # Time
    time_data = metar.get('time', {})
    if isinstance(time_data, dict):
        result['observed'] = time_data.get('dt')

    # Temperature
    temp = metar.get('temperature', {})
    if isinstance(temp, dict):
        result['temperature_c'] = temp.get('value')

    dewpoint = metar.get('dewpoint', {})
    if isinstance(dewpoint, dict):
        result['dewpoint_c'] = dewpoint.get('value')

    # Wind
    wind_dir = metar.get('wind_direction', {})
    wind_speed = metar.get('wind_speed', {})
    wind_gust = metar.get('wind_gust', {})

    if isinstance(wind_dir, dict):
        result['wind_direction'] = wind_dir.get('value')
    if isinstance(wind_speed, dict):
        result['wind_speed_kt'] = wind_speed.get('value')
    if isinstance(wind_gust, dict):
        result['wind_gust_kt'] = wind_gust.get('value')

    # Visibility
    visibility = metar.get('visibility', {})
    if isinstance(visibility, dict):
        vis_value = visibility.get('value')
        if vis_value is not None:
            # AVWX returns visibility in meters by default
            result['visibility_meters'] = vis_value
            # Convert to statute miles
            if vis_value >= 9999:
                result['visibility_sm'] = 10
            else:
                result['visibility_sm'] = round(vis_value / 1609.34, 1)

    # Clouds and ceiling
    clouds = metar.get('clouds', [])
    ceiling = None
    cloud_list = []

    if isinstance(clouds, list):
        for cloud in clouds:
            if isinstance(cloud, dict):
                cloud_type = cloud.get('type', '')
                altitude = cloud.get('altitude')
                if altitude is not None:
                    cloud_entry = {
                        'code': cloud_type,
                        'base_feet_agl': altitude * 100 if altitude else None,
                    }
                    cloud_list.append(cloud_entry)

                    if cloud_type in ('BKN', 'OVC', 'VV'):
                        base_ft = altitude * 100 if altitude else 0
                        if ceiling is None or base_ft < ceiling:
                            ceiling = base_ft

    result['clouds'] = cloud_list
    result['ceiling_ft'] = ceiling

    # Flight category
    flight_cat = metar.get('flight_rules')
    if not flight_cat:
        flight_cat = _calculate_flight_category(
            result.get('ceiling_ft'),
            result.get('visibility_sm')
        )
    result['flight_category'] = flight_cat

    # Altimeter
    altimeter = metar.get('altimeter', {})
    if isinstance(altimeter, dict):
        result['altimeter_hg'] = altimeter.get('value')

    # Humidity (calculate if we have temp and dewpoint)
    if result.get('temperature_c') is not None and result.get('dewpoint_c') is not None:
        temp_c = result['temperature_c']
        dewpoint_c = result['dewpoint_c']
        # Magnus formula approximation
        try:
            import math
            rh = 100 * math.exp((17.625 * dewpoint_c) / (243.04 + dewpoint_c)) / \
                 math.exp((17.625 * temp_c) / (243.04 + temp_c))
            result['humidity_percent'] = round(rh, 1)
        except (ValueError, ZeroDivisionError):
            pass

    # Weather conditions
    wx_codes = metar.get('wx_codes', [])
    if wx_codes:
        conditions = []
        for wx in wx_codes:
            if isinstance(wx, dict):
                conditions.append({
                    'code': wx.get('repr', ''),
                    'text': wx.get('value', ''),
                })
        result['conditions'] = conditions
        result['weather'] = ', '.join(
            c.get('text', c.get('code', '')) for c in conditions
        )

    return result


def _calculate_flight_category(
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


def get_api_status() -> Dict[str, Any]:
    """
    Get AVWX API status and configuration.

    Returns:
        API status dictionary
    """
    return {
        'enabled': _is_enabled(),
        'api_key_configured': bool(_get_api_key()),
        'cache_ttl_metar': METAR_CACHE_TTL,
        'cache_ttl_taf': TAF_CACHE_TTL,
    }
