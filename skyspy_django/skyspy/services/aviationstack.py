"""
Aviationstack flight schedule API service.

Provides flight schedule and route data.
Aviationstack: https://aviationstack.com/

Free tier: 100 requests/month
"""
import logging
from datetime import datetime, date
from typing import Optional, Dict, Any, List

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

# API configuration
AVIATIONSTACK_API_BASE = "http://api.aviationstack.com/v1"

# Cache settings (aggressive caching due to low request limit)
FLIGHTS_CACHE_TTL = 3600  # 1 hour
SCHEDULES_CACHE_TTL = 7200  # 2 hours


def _get_api_key() -> Optional[str]:
    """Get Aviationstack API key from settings."""
    return getattr(settings, 'AVIATIONSTACK_API_KEY', None)


def _is_enabled() -> bool:
    """Check if Aviationstack is enabled."""
    return getattr(settings, 'AVIATIONSTACK_ENABLED', False) and _get_api_key()


def _make_request(
    endpoint: str,
    params: Optional[Dict] = None,
    timeout: int = 30
) -> Optional[Dict[str, Any]]:
    """
    Make a request to the Aviationstack API.

    Args:
        endpoint: API endpoint path
        params: Optional query parameters
        timeout: Request timeout in seconds

    Returns:
        API response data or None if failed
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("Aviationstack API key not configured")
        return None

    # Add API key to params
    params = params or {}
    params['access_key'] = api_key

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                f"{AVIATIONSTACK_API_BASE}/{endpoint}",
                params=params,
            )
            response.raise_for_status()

            data = response.json()

            # Check for API errors
            if 'error' in data:
                error = data['error']
                logger.error(f"Aviationstack API error: {error.get('message', error)}")
                return None

            return data

    except httpx.HTTPStatusError as e:
        logger.error(f"Aviationstack API error: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"Aviationstack API request failed: {e}")
        return None


def get_flight_by_callsign(
    flight_iata: Optional[str] = None,
    flight_icao: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Get flight information by callsign.

    Args:
        flight_iata: Flight IATA code (e.g., AA123)
        flight_icao: Flight ICAO code (e.g., AAL123)

    Returns:
        Flight data dictionary or None if not found
    """
    if not _is_enabled():
        return None

    cache_key = f"aviationstack_flight_{flight_iata or flight_icao}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    params = {}
    if flight_iata:
        params['flight_iata'] = flight_iata
    elif flight_icao:
        params['flight_icao'] = flight_icao
    else:
        return None

    result = _make_request('flights', params)

    if not result:
        return None

    flights = result.get('data', [])
    if not flights:
        return None

    # Return the first (current) flight
    flight = _parse_flight(flights[0])
    if flight:
        cache.set(cache_key, flight, FLIGHTS_CACHE_TTL)

    return flight


def get_flights_for_route(
    departure_iata: str,
    arrival_iata: str,
    flight_date: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """
    Get flights for a specific route.

    Args:
        departure_iata: Departure airport IATA code
        arrival_iata: Arrival airport IATA code
        flight_date: Optional flight date

    Returns:
        List of flight dictionaries
    """
    if not _is_enabled():
        return []

    date_str = flight_date.isoformat() if flight_date else date.today().isoformat()
    cache_key = f"aviationstack_route_{departure_iata}_{arrival_iata}_{date_str}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    params = {
        'dep_iata': departure_iata,
        'arr_iata': arrival_iata,
    }
    if flight_date:
        params['flight_date'] = date_str

    result = _make_request('flights', params)

    if not result:
        return []

    flights = []
    for flight_data in result.get('data', []):
        parsed = _parse_flight(flight_data)
        if parsed:
            flights.append(parsed)

    cache.set(cache_key, flights, FLIGHTS_CACHE_TTL)
    return flights


def get_departures(
    airport_iata: str,
    flight_date: Optional[date] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Get departures from an airport.

    Args:
        airport_iata: Airport IATA code
        flight_date: Optional flight date
        limit: Maximum number of results

    Returns:
        List of departure dictionaries
    """
    if not _is_enabled():
        return []

    date_str = flight_date.isoformat() if flight_date else date.today().isoformat()
    cache_key = f"aviationstack_dep_{airport_iata}_{date_str}"

    cached = cache.get(cache_key)
    if cached:
        return cached[:limit]

    params = {
        'dep_iata': airport_iata,
        'limit': limit,
    }
    if flight_date:
        params['flight_date'] = date_str

    result = _make_request('flights', params)

    if not result:
        return []

    flights = []
    for flight_data in result.get('data', []):
        parsed = _parse_flight(flight_data)
        if parsed:
            flights.append(parsed)

    cache.set(cache_key, flights, SCHEDULES_CACHE_TTL)
    return flights


def get_arrivals(
    airport_iata: str,
    flight_date: Optional[date] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Get arrivals at an airport.

    Args:
        airport_iata: Airport IATA code
        flight_date: Optional flight date
        limit: Maximum number of results

    Returns:
        List of arrival dictionaries
    """
    if not _is_enabled():
        return []

    date_str = flight_date.isoformat() if flight_date else date.today().isoformat()
    cache_key = f"aviationstack_arr_{airport_iata}_{date_str}"

    cached = cache.get(cache_key)
    if cached:
        return cached[:limit]

    params = {
        'arr_iata': airport_iata,
        'limit': limit,
    }
    if flight_date:
        params['flight_date'] = date_str

    result = _make_request('flights', params)

    if not result:
        return []

    flights = []
    for flight_data in result.get('data', []):
        parsed = _parse_flight(flight_data)
        if parsed:
            flights.append(parsed)

    cache.set(cache_key, flights, SCHEDULES_CACHE_TTL)
    return flights


def get_airline_info(
    airline_iata: Optional[str] = None,
    airline_icao: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Get airline information.

    Args:
        airline_iata: Airline IATA code
        airline_icao: Airline ICAO code

    Returns:
        Airline data dictionary or None if not found
    """
    if not _is_enabled():
        return None

    cache_key = f"aviationstack_airline_{airline_iata or airline_icao}"

    cached = cache.get(cache_key)
    if cached:
        return cached

    params = {}
    if airline_iata:
        params['airline_iata'] = airline_iata
    elif airline_icao:
        params['airline_icao'] = airline_icao
    else:
        return None

    result = _make_request('airlines', params)

    if not result:
        return None

    airlines = result.get('data', [])
    if not airlines:
        return None

    airline = airlines[0]
    parsed = {
        'name': airline.get('airline_name'),
        'iata_code': airline.get('iata_code'),
        'icao_code': airline.get('icao_code'),
        'callsign': airline.get('callsign'),
        'country': airline.get('country_name'),
        'country_iso': airline.get('country_iso2'),
        'is_active': airline.get('status') == 'active',
        'fleet_size': airline.get('fleet_size'),
        'fleet_average_age': airline.get('fleet_average_age'),
        'hub_code': airline.get('hub_code'),
        'source': 'aviationstack',
    }

    cache.set(cache_key, parsed, 86400)  # 24 hour cache for airline data
    return parsed


def _parse_flight(flight_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse an Aviationstack flight record.

    Args:
        flight_data: Raw flight data from API

    Returns:
        Parsed flight dictionary or None if invalid
    """
    try:
        flight = flight_data.get('flight', {})
        departure = flight_data.get('departure', {})
        arrival = flight_data.get('arrival', {})
        airline = flight_data.get('airline', {})
        aircraft = flight_data.get('aircraft', {})

        return {
            'flight_number': flight.get('number'),
            'flight_iata': flight.get('iata'),
            'flight_icao': flight.get('icao'),

            'airline_name': airline.get('name'),
            'airline_iata': airline.get('iata'),
            'airline_icao': airline.get('icao'),

            'departure_airport': departure.get('airport'),
            'departure_iata': departure.get('iata'),
            'departure_icao': departure.get('icao'),
            'departure_scheduled': departure.get('scheduled'),
            'departure_estimated': departure.get('estimated'),
            'departure_actual': departure.get('actual'),
            'departure_delay': departure.get('delay'),
            'departure_terminal': departure.get('terminal'),
            'departure_gate': departure.get('gate'),

            'arrival_airport': arrival.get('airport'),
            'arrival_iata': arrival.get('iata'),
            'arrival_icao': arrival.get('icao'),
            'arrival_scheduled': arrival.get('scheduled'),
            'arrival_estimated': arrival.get('estimated'),
            'arrival_actual': arrival.get('actual'),
            'arrival_delay': arrival.get('delay'),
            'arrival_terminal': arrival.get('terminal'),
            'arrival_gate': arrival.get('gate'),
            'arrival_baggage': arrival.get('baggage'),

            'aircraft_registration': aircraft.get('registration'),
            'aircraft_iata': aircraft.get('iata'),
            'aircraft_icao': aircraft.get('icao'),
            'aircraft_icao24': aircraft.get('icao24'),

            'flight_status': flight_data.get('flight_status'),
            'flight_date': flight_data.get('flight_date'),

            'source': 'aviationstack',
        }

    except Exception as e:
        logger.warning(f"Failed to parse Aviationstack flight: {e}")
        return None


def correlate_with_live_aircraft(
    callsign: str,
    aircraft_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Correlate observed aircraft with scheduled flight data.

    Args:
        callsign: Aircraft callsign (e.g., AAL123 or AA123)
        aircraft_type: Optional aircraft type for validation

    Returns:
        Matched schedule data or None if no match
    """
    if not _is_enabled():
        return None

    # Try ICAO callsign first (AAL123 format)
    if len(callsign) >= 4 and callsign[:3].isalpha():
        result = get_flight_by_callsign(flight_icao=callsign)
        if result:
            return result

    # Try IATA format (AA123)
    if len(callsign) >= 3:
        # Try with first 2 chars as airline code
        iata_callsign = callsign[:2] + callsign[3:] if len(callsign) > 3 else callsign
        result = get_flight_by_callsign(flight_iata=iata_callsign)
        if result:
            return result

    return None


def get_api_status() -> Dict[str, Any]:
    """
    Get Aviationstack API status and configuration.

    Returns:
        API status dictionary
    """
    return {
        'enabled': _is_enabled(),
        'api_key_configured': bool(_get_api_key()),
        'cache_ttl_flights': FLIGHTS_CACHE_TTL,
        'cache_ttl_schedules': SCHEDULES_CACHE_TTL,
        'monthly_limit': 100,  # Free tier
        'note': 'Aggressive caching enabled due to low request limit',
    }
