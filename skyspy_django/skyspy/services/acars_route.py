"""
Resolve decoded ACARS route data into geographic points for map rendering.

Decoded ACARS messages (see ``acars_decoder``) can carry a flight plan
(``origin``/``destination``/``waypoints``) or a position report (``position``).
Those are stored as bare names/codes in ``AcarsMessage.decoded``; to draw them on
a map we resolve each name against the cached airport / navaid databases
(``CachedAirport.icao_id`` and ``CachedNavaid.ident``) to get lat/lon.

This runs at serialize time (read path). Messages without any route keys return
an empty result *without* touching the database, so the common case is cheap.
"""

from __future__ import annotations

from skyspy.models import CachedAirport, CachedNavaid

# Keys in AcarsMessage.decoded that can contribute a geographic point.
_ROUTE_KEYS = ("origin", "destination", "waypoints", "position")


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in nautical miles (kept local to avoid a service dep)."""
    from math import asin, cos, radians, sin, sqrt

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 3440.065 * 2 * asin(sqrt(a))


def _lookup_name(name: str, near: tuple[float, float] | None) -> dict | None:
    """Resolve an airport ICAO or navaid ident to a geo point, or None.

    Airports win over navaids (an ICAO like ``KLAX`` is unambiguous). When a
    navaid ident is shared by several stations, the one nearest ``near`` is
    chosen so the plotted point matches the aircraft's actual region.
    """
    code = (name or "").strip().upper()
    if not code:
        return None

    airport = CachedAirport.objects.filter(icao_id=code).values("latitude", "longitude", "name").first()
    if airport:
        return {
            "lat": airport["latitude"],
            "lon": airport["longitude"],
            "type": "airport",
            "label": airport["name"] or code,
        }

    navaids = list(CachedNavaid.objects.filter(ident=code).values("latitude", "longitude", "name", "navaid_type"))
    if not navaids:
        return None
    if len(navaids) > 1 and near is not None:
        navaids.sort(key=lambda n: _haversine_nm(near[0], near[1], n["latitude"], n["longitude"]))
    nav = navaids[0]
    return {
        "lat": nav["latitude"],
        "lon": nav["longitude"],
        "type": (nav["navaid_type"] or "navaid").lower(),
        "label": nav["name"] or code,
    }


def build_acars_route(decoded: dict | None) -> dict:
    """Build an ordered list of geo points from a decoded ACARS message.

    Args:
        decoded: The ``AcarsMessage.decoded`` dict (may be None/empty).

    Returns:
        ``{"points": [...], "has_route": bool}`` where each point is
        ``{"name", "role", "lat", "lon", "type", "label"}`` and ``role`` is one
        of ``origin`` / ``waypoint`` / ``destination`` / ``position``. Points are
        ordered origin → waypoints → destination, with any position report last.
    """
    empty = {"points": [], "has_route": False}
    if not isinstance(decoded, dict) or not any(decoded.get(k) for k in _ROUTE_KEYS):
        return empty

    # Reported position anchors navaid disambiguation and is plotted as its own
    # marker (the aircraft's actual location at report time).
    pos = decoded.get("position") or {}
    near = None
    if isinstance(pos, dict) and pos.get("lat") is not None and pos.get("lon") is not None:
        near = (pos["lat"], pos["lon"])

    memo: dict[str, dict | None] = {}

    def resolve(name: str) -> dict | None:
        code = (name or "").strip().upper()
        if code not in memo:
            memo[code] = _lookup_name(code, near)
        return memo[code]

    points: list[dict] = []
    seen: set[tuple[str, float, float]] = set()

    def add(name: str, role: str) -> None:
        geo = resolve(name)
        if not geo:
            return
        key = (role, round(geo["lat"], 4), round(geo["lon"], 4))
        if key in seen:
            return
        seen.add(key)
        points.append({"name": (name or "").strip().upper(), "role": role, **geo})

    if decoded.get("origin"):
        add(decoded["origin"], "origin")
    for wpt in decoded.get("waypoints") or []:
        add(wpt, "waypoint")
    if decoded.get("destination"):
        add(decoded["destination"], "destination")

    if near is not None:
        points.append(
            {
                "name": "POS",
                "role": "position",
                "lat": near[0],
                "lon": near[1],
                "type": "position",
                "label": "Reported position",
            }
        )

    return {"points": points, "has_route": len(points) >= 1}
