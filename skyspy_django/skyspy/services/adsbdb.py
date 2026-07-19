"""
ADSBdb (adsbdb.com) integration — free, keyless community aircraft database.

Provides two lookups that complement the existing fan-out:

- ``get_aircraft_by_icao`` — airframe + owner + photo, a fallback after the
  bulk DBs / HexDB / adsb.lol / ADS-B Exchange chain in ``aircraft_info``.
- ``get_route_by_callsign`` — origin/destination airports, a fallback for
  ``external_db.fetch_route`` when adsb.im has no match.

Both normalize to the same shapes the rest of the codebase already consumes
(see ``external_db._airport_brief`` for the route shape) so callers never
depend on ADSBdb's payload structure. Results are cached; the shared
``http_client`` supplies retry + circuit breaker.

API: https://api.adsbdb.com  (no key, please be gentle — community funded)
"""

import logging

from django.core.cache import cache

from skyspy.services import http_client

logger = logging.getLogger(__name__)

SOURCE = "adsbdb"
_API_BASE = "https://api.adsbdb.com/v0"
_AIRCRAFT_TTL = 60 * 60 * 24 * 7  # airframe facts are stable — 7 days
_ROUTE_TTL = 60 * 60 * 24  # routes drift more (schedule changes) — 1 day
# adsbdb is a single free community host: cap our aggregate call rate.
_RATE = (60, 60)  # 60 requests / minute


def _get(path: str) -> dict | None:
    payload = http_client.get_json(f"{_API_BASE}/{path}", source=SOURCE, rate=_RATE, timeout=12.0)
    if not isinstance(payload, dict):
        return None
    # adsbdb wraps hits in {"response": ...} and misses as {"response": "unknown ..."}.
    response = payload.get("response")
    return response if isinstance(response, dict) else None


def get_aircraft_by_icao(icao_hex: str) -> dict | None:
    """
    Airframe + owner + photo for an ICAO hex, or None if unknown.

    Returns a dict aligned with ``AircraftInfo`` fields: registration,
    type_code, model, manufacturer, owner, country, country_code, photo_url,
    photo_thumbnail_url, photo_source.
    """
    icao_hex = (icao_hex or "").upper().strip()
    if not icao_hex:
        return None

    cache_key = f"adsbdb_ac_{icao_hex}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached or None  # empty dict cached as a negative result

    response = _get(f"aircraft/{icao_hex}")
    aircraft = response.get("aircraft") if response else None
    if not isinstance(aircraft, dict):
        cache.set(cache_key, {}, _AIRCRAFT_TTL)  # negative cache
        return None

    photo = aircraft.get("url_photo")
    info = {
        "icao_hex": icao_hex,
        "registration": aircraft.get("registration"),
        "type_code": aircraft.get("icao_type"),
        "model": aircraft.get("type"),
        "manufacturer": aircraft.get("manufacturer"),
        "owner": aircraft.get("registered_owner"),
        "country": aircraft.get("registered_owner_country_name"),
        "country_code": aircraft.get("registered_owner_country_iso_name"),
    }
    if photo:
        info["photo_url"] = photo
        info["photo_thumbnail_url"] = aircraft.get("url_photo_thumbnail")
        info["photo_source"] = "adsbdb"
    # Drop keys with no value so this merges cleanly (fill-if-empty semantics).
    info = {k: v for k, v in info.items() if v not in (None, "")}
    cache.set(cache_key, info, _AIRCRAFT_TTL)
    return info


def get_route_by_callsign(callsign: str) -> dict | None:
    """
    Origin/destination for a callsign, normalized to the adsb.im route shape.

    Returns the same dict structure as ``external_db._parse_route_response`` so
    it is a drop-in fallback: {callsign, airline_code, origin, destination, ...}.
    """
    callsign = (callsign or "").upper().strip()
    if not callsign:
        return None

    cache_key = f"adsbdb_route_{callsign}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached or None

    response = _get(f"callsign/{callsign}")
    route = response.get("flightroute") if response else None
    if not isinstance(route, dict):
        cache.set(cache_key, {}, _ROUTE_TTL)
        return None

    origin = route.get("origin")
    destination = route.get("destination")
    if not isinstance(origin, dict) or not isinstance(destination, dict):
        cache.set(cache_key, {}, _ROUTE_TTL)
        return None

    airline = route.get("airline") if isinstance(route.get("airline"), dict) else {}
    # adsbdb carries an optional ``midpoint`` for a minority of routes. Build the
    # ordered waypoint chain (origin -> [midpoint] -> destination) so the shape
    # matches external_db's route dict and the UI can draw the leg polyline.
    waypoints = [_airport_brief(origin)]
    midpoint = route.get("midpoint")
    if isinstance(midpoint, dict):
        waypoints.append(_airport_brief(midpoint))
    waypoints.append(_airport_brief(destination))
    result = {
        "callsign": route.get("callsign_icao") or callsign,
        "airline_code": airline.get("icao"),
        "flight_number": route.get("callsign_iata"),
        "airport_codes": None,
        "plausible": None,
        "origin": waypoints[0],
        "destination": waypoints[-1],
        "waypoints": waypoints,
    }
    cache.set(cache_key, result, _ROUTE_TTL)
    return result


def _airport_brief(ap: dict) -> dict:
    """Condense an adsbdb airport entry to the shared route-airport shape."""
    return {
        "iata": ap.get("iata_code"),
        "icao": ap.get("icao_code"),
        "name": ap.get("name"),
        "city": ap.get("municipality"),
        "country": ap.get("country_iso_name"),
        "lat": ap.get("latitude"),
        "lon": ap.get("longitude"),
    }
