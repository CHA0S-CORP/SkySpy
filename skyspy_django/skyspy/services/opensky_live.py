"""
OpenSky Network Live API service.

Provides real-time aircraft position data from OpenSky Network.
OpenSky Network: https://opensky-network.org/

Free tier: 4,000 credits/day (8,000 for contributors)
Resolution: 5-second updates
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

# API configuration
OPENSKY_API_BASE = "https://opensky-network.org/api"

# Cache settings
STATES_CACHE_TTL = 10  # 10 seconds (slightly longer than update interval)
FLIGHTS_CACHE_TTL = 60  # 1 minute

# Rate limiting
MAX_REQUESTS_PER_MINUTE = 10


def _get_credentials() -> Tuple[Optional[str], Optional[str]]:
    """Get OpenSky credentials from settings."""
    username = getattr(settings, 'OPENSKY_USERNAME', None)
    password = getattr(settings, 'OPENSKY_PASSWORD', None)
    return username, password


def _is_enabled() -> bool:
    """Check if OpenSky Live API is enabled."""
    return getattr(settings, 'OPENSKY_LIVE_ENABLED', False)


def _make_request(
    endpoint: str,
    params: Optional[Dict] = None,
    timeout: int = 30
) -> Optional[Dict[str, Any]]:
    """
    Make a request to the OpenSky Network API.

    Args:
        endpoint: API endpoint path
        params: Optional query parameters
        timeout: Request timeout in seconds

    Returns:
        API response data or None if failed
    """
    if not _is_enabled():
        return None

    # Check rate limit
    rate_key = "opensky_rate_limit"
    rate_count = cache.get(rate_key, 0)
    if rate_count >= MAX_REQUESTS_PER_MINUTE:
        logger.warning("OpenSky rate limit exceeded")
        return None

    username, password = _get_credentials()
    auth = (username, password) if username and password else None

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                f"{OPENSKY_API_BASE}/{endpoint}",
                params=params,
                auth=auth,
                headers={"Accept": "application/json"}
            )
            response.raise_for_status()

            # Update rate limit counter
            cache.set(rate_key, rate_count + 1, 60)

            return response.json()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("OpenSky rate limit exceeded (HTTP 429)")
        elif e.response.status_code == 401:
            logger.warning("OpenSky authentication failed")
        else:
            logger.error(f"OpenSky API error: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"OpenSky API request failed: {e}")
        return None


def get_all_states(
    bbox: Optional[Tuple[float, float, float, float]] = None,
) -> List[Dict[str, Any]]:
    """
    Get all aircraft state vectors.

    Args:
        bbox: Optional bounding box (min_lat, max_lat, min_lon, max_lon)

    Returns:
        List of aircraft state dictionaries
    """
    if not _is_enabled():
        return []

    params = {}
    if bbox:
        params['lamin'] = bbox[0]
        params['lamax'] = bbox[1]
        params['lomin'] = bbox[2]
        params['lomax'] = bbox[3]

    cache_key = f"opensky_states_{bbox}" if bbox else "opensky_states_all"
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request('states/all', params)

    if not result:
        return []

    states = result.get('states', [])
    if not states:
        return []

    # Parse state vectors
    aircraft = []
    for state in states:
        parsed = _parse_state_vector(state)
        if parsed:
            aircraft.append(parsed)

    cache.set(cache_key, aircraft, STATES_CACHE_TTL)
    return aircraft


def _parse_state_vector(state: List) -> Optional[Dict[str, Any]]:
    """
    Parse an OpenSky state vector into a dictionary.

    State vector indices:
    0: icao24 (unique ICAO 24-bit address)
    1: callsign
    2: origin_country
    3: time_position
    4: last_contact
    5: longitude
    6: latitude
    7: baro_altitude (meters)
    8: on_ground
    9: velocity (m/s)
    10: true_track (degrees)
    11: vertical_rate (m/s)
    12: sensors
    13: geo_altitude (meters)
    14: squawk
    15: spi (special position indicator)
    16: position_source (0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM)

    Args:
        state: Raw state vector array

    Returns:
        Parsed aircraft dictionary or None if invalid
    """
    if not state or len(state) < 17:
        return None

    try:
        icao_hex = state[0]
        if not icao_hex:
            return None

        lat = state[6]
        lon = state[5]
        if lat is None or lon is None:
            return None

        # Convert m/s to knots for velocity
        velocity_ms = state[9]
        velocity_kt = round(velocity_ms * 1.944, 1) if velocity_ms else None

        # Convert m/s to ft/min for vertical rate
        vert_rate_ms = state[11]
        vert_rate_fpm = round(vert_rate_ms * 196.85, 0) if vert_rate_ms else None

        # Convert meters to feet for altitude
        baro_alt_m = state[7]
        baro_alt_ft = round(baro_alt_m * 3.281, 0) if baro_alt_m else None

        geo_alt_m = state[13]
        geo_alt_ft = round(geo_alt_m * 3.281, 0) if geo_alt_m else None

        position_sources = {
            0: 'ADS-B',
            1: 'ASTERIX',
            2: 'MLAT',
            3: 'FLARM',
        }

        return {
            'icao_hex': icao_hex.upper(),
            'callsign': state[1].strip() if state[1] else None,
            'origin_country': state[2],
            'latitude': lat,
            'longitude': lon,
            'altitude_baro_ft': baro_alt_ft,
            'altitude_geo_ft': geo_alt_ft,
            'on_ground': state[8],
            'velocity_kt': velocity_kt,
            'track': state[10],
            'vertical_rate_fpm': vert_rate_fpm,
            'squawk': state[14],
            'position_source': position_sources.get(state[16], 'Unknown'),
            'last_contact': state[4],
            'time_position': state[3],
            'source': 'opensky',
        }

    except (IndexError, TypeError, ValueError) as e:
        logger.warning(f"Failed to parse OpenSky state: {e}")
        return None


def get_aircraft_by_icao(icao_hex: str) -> Optional[Dict[str, Any]]:
    """
    Get current state for a specific aircraft.

    Args:
        icao_hex: Aircraft ICAO hex code

    Returns:
        Aircraft state dictionary or None if not found
    """
    if not _is_enabled():
        return None

    icao_hex = icao_hex.lower()
    cache_key = f"opensky_aircraft_{icao_hex}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request('states/all', {'icao24': icao_hex})

    if not result:
        return None

    states = result.get('states', [])
    if not states:
        return None

    parsed = _parse_state_vector(states[0])
    if parsed:
        cache.set(cache_key, parsed, STATES_CACHE_TTL)

    return parsed


def get_aircraft_track(
    icao_hex: str,
    time: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Get flight track for an aircraft.

    Args:
        icao_hex: Aircraft ICAO hex code
        time: Unix timestamp for historical track (default: current)

    Returns:
        List of track points
    """
    if not _is_enabled():
        return []

    icao_hex = icao_hex.lower()
    params = {'icao24': icao_hex}
    if time:
        params['time'] = time

    result = _make_request('tracks/all', params)

    if not result:
        return []

    path = result.get('path', [])
    track_points = []

    for point in path:
        if len(point) >= 6:
            track_points.append({
                'time': point[0],
                'latitude': point[1],
                'longitude': point[2],
                'altitude_baro_ft': round(point[3] * 3.281, 0) if point[3] else None,
                'track': point[4],
                'on_ground': point[5],
            })

    return track_points


def get_departures(
    airport_icao: str,
    begin: Optional[int] = None,
    end: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Get departures from an airport.

    Args:
        airport_icao: Airport ICAO code
        begin: Start time (Unix timestamp)
        end: End time (Unix timestamp)

    Returns:
        List of departure dictionaries
    """
    if not _is_enabled():
        return []

    now = int(datetime.utcnow().timestamp())
    begin = begin or (now - 86400)  # Default: last 24 hours
    end = end or now

    cache_key = f"opensky_departures_{airport_icao}_{begin}_{end}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'flights/departure', {
        'airport': airport_icao,
        'begin': begin,
        'end': end,
    })

    if not result:
        return []

    flights = []
    for flight in result:
        flights.append({
            'icao_hex': flight.get('icao24', '').upper(),
            'callsign': flight.get('callsign', '').strip() if flight.get('callsign') else None,
            'departure_airport': flight.get('estDepartureAirport'),
            'arrival_airport': flight.get('estArrivalAirport'),
            'first_seen': flight.get('firstSeen'),
            'last_seen': flight.get('lastSeen'),
            'source': 'opensky',
        })

    cache.set(cache_key, flights, FLIGHTS_CACHE_TTL)
    return flights


def get_arrivals(
    airport_icao: str,
    begin: Optional[int] = None,
    end: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Get arrivals at an airport.

    Args:
        airport_icao: Airport ICAO code
        begin: Start time (Unix timestamp)
        end: End time (Unix timestamp)

    Returns:
        List of arrival dictionaries
    """
    if not _is_enabled():
        return []

    now = int(datetime.utcnow().timestamp())
    begin = begin or (now - 86400)
    end = end or now

    cache_key = f"opensky_arrivals_{airport_icao}_{begin}_{end}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    result = _make_request(f'flights/arrival', {
        'airport': airport_icao,
        'begin': begin,
        'end': end,
    })

    if not result:
        return []

    flights = []
    for flight in result:
        flights.append({
            'icao_hex': flight.get('icao24', '').upper(),
            'callsign': flight.get('callsign', '').strip() if flight.get('callsign') else None,
            'departure_airport': flight.get('estDepartureAirport'),
            'arrival_airport': flight.get('estArrivalAirport'),
            'first_seen': flight.get('firstSeen'),
            'last_seen': flight.get('lastSeen'),
            'source': 'opensky',
        })

    cache.set(cache_key, flights, FLIGHTS_CACHE_TTL)
    return flights


def track_aircraft_globally(icao_hex: str) -> Optional[Dict[str, Any]]:
    """
    Track an aircraft that may have left local receiver range.

    This is useful for "follow" functionality when an aircraft
    leaves your local ADS-B coverage area.

    Args:
        icao_hex: Aircraft ICAO hex code

    Returns:
        Latest aircraft state or None if not found
    """
    return get_aircraft_by_icao(icao_hex)


def get_api_status() -> Dict[str, Any]:
    """
    Get OpenSky API status and configuration.

    Returns:
        API status dictionary
    """
    username, password = _get_credentials()

    return {
        'enabled': _is_enabled(),
        'authenticated': bool(username and password),
        'cache_ttl_states': STATES_CACHE_TTL,
        'cache_ttl_flights': FLIGHTS_CACHE_TTL,
        'max_requests_per_minute': MAX_REQUESTS_PER_MINUTE,
        'daily_limit_basic': 4000,
        'daily_limit_contributor': 8000,
    }
