"""
Aviationstack flight schedule API service.

Provides flight schedule and route data.
Aviationstack: https://aviationstack.com/

Free tier: 100 requests/month
"""

import logging
from datetime import date
from typing import Any

from django.conf import settings
from django.core.cache import cache

from skyspy.services import http_client

logger = logging.getLogger(__name__)

# API configuration
AVIATIONSTACK_API_BASE = "http://api.aviationstack.com/v1"

# Cache settings (aggressive caching due to low request limit)
FLIGHTS_CACHE_TTL = 3600  # 1 hour
SCHEDULES_CACHE_TTL = 7200  # 2 hours
# Negative results (no match / not found) are cached too so repeat lookups for an
# unmatched callsign or airline don't each burn a request from the 100/month quota.
NEGATIVE_CACHE_TTL = 3600  # 1 hour

# Sentinel stored for a cached miss (distinguishes "known no result" from a cache
# miss, since cache.get returns None for both).
_NEGATIVE = "__aviationstack_none__"


def _get_api_key() -> str | None:
    """Get Aviationstack API key from settings."""
    return getattr(settings, "AVIATIONSTACK_API_KEY", None)


def _is_enabled() -> bool:
    """Check if Aviationstack is enabled."""
    return bool(getattr(settings, "AVIATIONSTACK_ENABLED", False) and _get_api_key())


def _make_request(endpoint: str, params: dict | None = None, timeout: int = 30) -> dict[str, Any] | None:
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
    params["access_key"] = api_key

    # Shared client adds retry-on-transient + a circuit breaker so a hard-down
    # Aviationstack fails fast instead of wasting the 100-req/month quota.
    data = http_client.get_json(
        f"{AVIATIONSTACK_API_BASE}/{endpoint}",
        params=params,
        source="aviationstack",
        timeout=timeout,
    )
    if data is None:
        return None

    # Check for API errors
    if "error" in data:
        error = data["error"]
        logger.error(f"Aviationstack API error: {error.get('message', error)}")
        return None

    return data


def get_flight_by_callsign(
    flight_iata: str | None = None,
    flight_icao: str | None = None,
) -> dict[str, Any] | None:
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
    if cached is not None:
        return None if cached == _NEGATIVE else cached

    params = {}
    if flight_iata:
        params["flight_iata"] = flight_iata
    elif flight_icao:
        params["flight_icao"] = flight_icao
    else:
        return None

    result = _make_request("flights", params)

    # Don't cache a transient API failure (None) — only cache a definitive answer.
    if result is None:
        return None

    flights = result.get("data", [])
    flight = _parse_flight(flights[0]) if flights else None

    cache.set(cache_key, flight if flight else _NEGATIVE, FLIGHTS_CACHE_TTL if flight else NEGATIVE_CACHE_TTL)
    return flight


def get_flights_for_route(
    departure_iata: str,
    arrival_iata: str,
    flight_date: date | None = None,
) -> list[dict[str, Any]]:
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
    if cached is not None:
        return cached

    params = {
        "dep_iata": departure_iata,
        "arr_iata": arrival_iata,
    }
    if flight_date:
        params["flight_date"] = date_str

    result = _make_request("flights", params)

    if not result:
        return []

    flights = []
    for flight_data in result.get("data", []):
        parsed = _parse_flight(flight_data)
        if parsed:
            flights.append(parsed)

    cache.set(cache_key, flights, FLIGHTS_CACHE_TTL)
    return flights


def get_departures(
    airport_iata: str,
    flight_date: date | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
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
    cache_key = f"aviationstack_dep_{airport_iata}_{date_str}_{limit}"

    cached = cache.get(cache_key)
    if cached is not None:
        return cached[:limit]

    params = {
        "dep_iata": airport_iata,
        "limit": limit,
    }
    if flight_date:
        params["flight_date"] = date_str

    result = _make_request("flights", params)

    if not result:
        return []

    flights = []
    for flight_data in result.get("data", []):
        parsed = _parse_flight(flight_data)
        if parsed:
            flights.append(parsed)

    cache.set(cache_key, flights, SCHEDULES_CACHE_TTL)
    return flights


def get_arrivals(
    airport_iata: str,
    flight_date: date | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
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
    cache_key = f"aviationstack_arr_{airport_iata}_{date_str}_{limit}"

    cached = cache.get(cache_key)
    if cached is not None:
        return cached[:limit]

    params = {
        "arr_iata": airport_iata,
        "limit": limit,
    }
    if flight_date:
        params["flight_date"] = date_str

    result = _make_request("flights", params)

    if not result:
        return []

    flights = []
    for flight_data in result.get("data", []):
        parsed = _parse_flight(flight_data)
        if parsed:
            flights.append(parsed)

    cache.set(cache_key, flights, SCHEDULES_CACHE_TTL)
    return flights


def get_airline_info(
    airline_iata: str | None = None,
    airline_icao: str | None = None,
) -> dict[str, Any] | None:
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
    if cached is not None:
        return None if cached == _NEGATIVE else cached

    params = {}
    if airline_iata:
        params["airline_iata"] = airline_iata
    elif airline_icao:
        params["airline_icao"] = airline_icao
    else:
        return None

    result = _make_request("airlines", params)

    # Transient API failure — leave uncached so a later call can retry.
    if result is None:
        return None

    airlines = result.get("data", [])
    if not airlines:
        cache.set(cache_key, _NEGATIVE, NEGATIVE_CACHE_TTL)
        return None

    airline = airlines[0]
    parsed = {
        "name": airline.get("airline_name"),
        "iata_code": airline.get("iata_code"),
        "icao_code": airline.get("icao_code"),
        "callsign": airline.get("callsign"),
        "country": airline.get("country_name"),
        "country_iso": airline.get("country_iso2"),
        "is_active": airline.get("status") == "active",
        "fleet_size": airline.get("fleet_size"),
        "fleet_average_age": airline.get("fleet_average_age"),
        "hub_code": airline.get("hub_code"),
        "source": "aviationstack",
    }

    cache.set(cache_key, parsed, 86400)  # 24 hour cache for airline data
    return parsed


def _parse_flight(flight_data: dict[str, Any]) -> dict[str, Any] | None:
    """
    Parse an Aviationstack flight record.

    Args:
        flight_data: Raw flight data from API

    Returns:
        Parsed flight dictionary or None if invalid
    """
    try:
        flight = flight_data.get("flight", {})
        departure = flight_data.get("departure", {})
        arrival = flight_data.get("arrival", {})
        airline = flight_data.get("airline", {})
        aircraft = flight_data.get("aircraft", {})

        return {
            "flight_number": flight.get("number"),
            "flight_iata": flight.get("iata"),
            "flight_icao": flight.get("icao"),
            "airline_name": airline.get("name"),
            "airline_iata": airline.get("iata"),
            "airline_icao": airline.get("icao"),
            "departure_airport": departure.get("airport"),
            "departure_iata": departure.get("iata"),
            "departure_icao": departure.get("icao"),
            "departure_scheduled": departure.get("scheduled"),
            "departure_estimated": departure.get("estimated"),
            "departure_actual": departure.get("actual"),
            "departure_delay": departure.get("delay"),
            "departure_terminal": departure.get("terminal"),
            "departure_gate": departure.get("gate"),
            "arrival_airport": arrival.get("airport"),
            "arrival_iata": arrival.get("iata"),
            "arrival_icao": arrival.get("icao"),
            "arrival_scheduled": arrival.get("scheduled"),
            "arrival_estimated": arrival.get("estimated"),
            "arrival_actual": arrival.get("actual"),
            "arrival_delay": arrival.get("delay"),
            "arrival_terminal": arrival.get("terminal"),
            "arrival_gate": arrival.get("gate"),
            "arrival_baggage": arrival.get("baggage"),
            "aircraft_registration": aircraft.get("registration"),
            "aircraft_iata": aircraft.get("iata"),
            "aircraft_icao": aircraft.get("icao"),
            "aircraft_icao24": aircraft.get("icao24"),
            "flight_status": flight_data.get("flight_status"),
            "flight_date": flight_data.get("flight_date"),
            "source": "aviationstack",
        }

    except (AttributeError, TypeError, KeyError, ValueError) as e:
        logger.warning(f"Failed to parse Aviationstack flight: {e}")
        return None


def correlate_with_live_aircraft(
    callsign: str,
    aircraft_type: str | None = None,
) -> dict[str, Any] | None:
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

    # Try IATA format (AA123) - only when the callsign already looks like an
    # IATA flight designator (2-letter airline code + flight number). ICAO
    # airline codes cannot be reliably converted to IATA by dropping letters.
    if len(callsign) >= 3 and callsign[:2].isalpha() and callsign[2].isdigit():
        result = get_flight_by_callsign(flight_iata=callsign)
        if result:
            return result

    return None


def get_api_status() -> dict[str, Any]:
    """
    Get Aviationstack API status and configuration.

    Returns:
        API status dictionary
    """
    return {
        "enabled": _is_enabled(),
        "api_key_configured": bool(_get_api_key()),
        "cache_ttl_flights": FLIGHTS_CACHE_TTL,
        "cache_ttl_schedules": SCHEDULES_CACHE_TTL,
        "monthly_limit": 100,  # Free tier
        "note": "Aggressive caching enabled due to low request limit",
    }
