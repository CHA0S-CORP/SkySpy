"""Watch Duty wildfire service.

Fetches active wildfires near the feeder from the public api.watchduty.org
geo_events feed (via the libwatchduty client), threat-scores them, and caches
them in ``CachedWildfire`` for the map "Wildfires" overlay and the assistant.

Watch Duty geo_events are POINTS (no perimeter polygons) and the API has no
server-side bbox filter, so ``refresh_wildfires`` fetches the active-wildfire
list and filters client-side by haversine distance around ``FEEDER_LAT/LON``
(mirrors ``libwatchduty/examples/nearest_fires.py``). Per-fire detail
(reports/cameras/scanner feeds) is fetched on demand via ``get_fire_bundle``.

Gated on ``WILDFIRES_ENABLED``; read endpoints are public so no key is needed
(``WATCHDUTY_API_TOKEN`` only raises the feeder rate limit).
"""

import logging
import re
from datetime import datetime
from math import asin, cos, radians, sin, sqrt

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils.dateparse import parse_datetime

from skyspy.models import CachedWildfire

logger = logging.getLogger(__name__)

# NM per degree of latitude (also the great-circle scale below uses km).
_EARTH_RADIUS_KM = 6371.0088
_NM_PER_KM = 0.539957

# get_fire_bundle is a fan-out of several per-fire endpoints; cache the trimmed
# result briefly so opening/reopening a detail panel doesn't re-hit the API.
_BUNDLE_CACHE_TTL = 120
_BUNDLE_CACHE_KEY = "wildfire_bundle_{event_id}"
# The raw Watch Duty bundle can carry thousands of cameras (it is NOT fire-scoped),
# so cap the lists. Cameras are ranked by proximity to the fire and capped tight
# — only the few closest are useful for watching this fire.
_BUNDLE_MAX_REPORTS = 25
_BUNDLE_MAX_CAMERAS = 4
_BUNDLE_MAX_FEEDS = 10
# Cameras farther than this from the fire are dropped. Watch Duty's /cameras/ is
# the whole (western-US-wide) network, so "nearest 4" with no cap can surface a
# lookout hundreds of km away pointed at unrelated terrain — the user reads that
# as the panel showing the "wrong location". Better to show no camera than a
# misleading one. Tunable via WILDFIRES_CAMERA_RADIUS_NM.
_CAMERA_MAX_NM_DEFAULT = 50

# Camera classification for _best_cameras. Watch Duty's camera set mixes purpose-
# built wildfire-detection lookouts (AlertWest / AlertCalifornia / AlertWildfire /
# UCSD — PTZ, aimed at ridgelines) with roadway/traffic cameras (Caltrans etc.,
# pointed at freeways). Picking purely by distance lets dense roadside traffic
# cams win and show freeway views instead of the fire. We rank wildfire cams
# first and treat traffic cams as a last resort.
_FIRE_CAM_PROVIDERS = {
    "alertwest",
    "awf",
    "alertwildfire",
    "alertca",
    "alertcalifornia",
    "ucsd",
    "hpwren",
}
# Substrings in image_url host that mark a purpose-built wildfire camera.
_FIRE_CAM_HOST_HINTS = (
    "alertwest.com",
    "alertcalifornia.org",
    "alertwildfire",
    "hpwren",
    "watchduty.org",
)
# Signals of a roadway/traffic camera (deprioritized): known DOT providers,
# traffic image hosts, and Caltrans-style names like "KER-99-AT 11TH AVE".
_TRAFFIC_CAM_PROVIDERS = {"caltrans", "cctv", "dot", "wsdot", "nvroads", "gotraffic", "traffic"}
_TRAFFIC_CAM_HOST_HINTS = ("caltrans", "dot.ca.gov", "cctv", "/traffic", "wsdot", "gotraffic", "nvroads")
_TRAFFIC_CAM_NAME_RE = re.compile(r"[A-Za-z]{2,3}-\d+-AT\b|\bRTE\s*\d|\bHWY\b|CALTRANS", re.IGNORECASE)

# Camera-kind ranks (lower = preferred). Wildfire lookouts first, unknown next,
# traffic last so a freeway cam only appears when a fire has nothing better.
_CAM_KIND_FIRE = 0
_CAM_KIND_UNKNOWN = 1
_CAM_KIND_TRAFFIC = 2


def _camera_kind(cam: dict) -> int:
    """Classify a Watch Duty camera as wildfire (0), unknown (1), or traffic (2)."""
    provider = (cam.get("provider") or "").strip().lower()
    url = (cam.get("image_url") or "").lower()
    name = cam.get("name") or ""

    if provider in _FIRE_CAM_PROVIDERS or any(h in url for h in _FIRE_CAM_HOST_HINTS):
        return _CAM_KIND_FIRE
    if (
        provider in _TRAFFIC_CAM_PROVIDERS
        or any(h in url for h in _TRAFFIC_CAM_HOST_HINTS)
        or _TRAFFIC_CAM_NAME_RE.search(name)
    ):
        return _CAM_KIND_TRAFFIC
    return _CAM_KIND_UNKNOWN


# Cache the DRF token from a username/password login so we don't re-auth on every
# client build (the token is long-lived; a short-ish TTL bounds staleness).
_TOKEN_CACHE_KEY = "watchduty_auth_token"
_TOKEN_TTL = 6 * 60 * 60


def _is_enabled() -> bool:
    return bool(getattr(settings, "WILDFIRES_ENABLED", False))


def _base_url() -> str:
    return getattr(settings, "WATCHDUTY_BASE_URL", None) or "https://api.watchduty.org/api/v1"


def _login_token(base_url: str) -> str | None:
    """Log in with WATCHDUTY_USERNAME/PASSWORD and return the DRF token (cached).

    Returns None when no credentials are configured or the login fails."""
    username = getattr(settings, "WATCHDUTY_USERNAME", "") or ""
    password = getattr(settings, "WATCHDUTY_PASSWORD", "") or ""
    if not username or not password:
        return None

    cached = cache.get(_TOKEN_CACHE_KEY)
    if cached:
        return cached

    try:
        from libwatchduty import WatchDutyClient, WatchDutyError

        resp = WatchDutyClient(base_url=base_url).login(username, password)
    except WatchDutyError as e:
        logger.warning("Watch Duty login failed: %s", e)
        return None
    except (OSError, ConnectionError) as e:
        logger.warning("Watch Duty login network error: %s", e)
        return None

    token = (resp or {}).get("key") or (resp or {}).get("token") or (resp or {}).get("auth_token")
    if token:
        cache.set(_TOKEN_CACHE_KEY, token, _TOKEN_TTL)
    return token


def _client():
    """Build a WatchDutyClient from settings. Import is local so the dependency
    is only required when the feature is used.

    Auth precedence: an explicit WATCHDUTY_API_TOKEN wins; otherwise, if a
    username/password is set, log in (cached) so authenticated endpoints — the
    global aircraft catalog in particular — work."""
    from libwatchduty import WatchDutyClient

    base_url = _base_url()
    token = getattr(settings, "WATCHDUTY_API_TOKEN", "") or None
    if not token:
        token = _login_token(base_url)
    return WatchDutyClient(base_url=base_url, token=token)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two (lat, lon) points."""
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    h = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * asin(sqrt(h))


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _feeder() -> tuple[float, float]:
    return (
        float(getattr(settings, "FEEDER_LAT", 0) or 0),
        float(getattr(settings, "FEEDER_LON", 0) or 0),
    )


def refresh_wildfires() -> int:
    """Fetch active wildfires near the feeder, threat-score them, and UPSERT the
    ``CachedWildfire`` table. Returns the number of rows cached (0 when disabled,
    no feeder configured, or the feed is empty/unreachable)."""
    if not _is_enabled():
        logger.debug("Wildfires disabled; skipping refresh")
        return 0

    feeder_lat, feeder_lon = _feeder()
    if not feeder_lat and not feeder_lon:
        logger.info("No feeder location configured; skipping wildfire refresh")
        return 0

    radius_nm = float(getattr(settings, "WILDFIRES_RADIUS_NM", 250) or 250)
    radius_km = radius_nm / _NM_PER_KM

    try:
        from libwatchduty import WatchDutyError

        client = _client()
        fires = client.list_geo_events(types=["wildfire"], active_only=True)
    except WatchDutyError as e:
        logger.warning("Watch Duty geo_events fetch failed: %s", e)
        return 0
    except (OSError, ConnectionError) as e:
        logger.warning("Watch Duty network error: %s", e)
        return 0

    now = datetime.utcnow()
    rows: list[CachedWildfire] = []
    for fire in fires:
        lat = _as_float(fire.get("lat"))
        lon = _as_float(fire.get("lng"))
        if lat is None or lon is None:
            continue
        dist_km = _haversine_km(feeder_lat, feeder_lon, lat, lon)
        if dist_km > radius_km:
            continue

        data = fire.get("data") or {}
        threat = _threat_score(fire, dist_km, radius_km)
        rows.append(
            CachedWildfire(
                fetched_at=now,
                event_id=int(fire["id"]),
                name=(fire.get("name") or "")[:200] or None,
                is_active=bool(fire.get("is_active", True)),
                latitude=lat,
                longitude=lon,
                address=(fire.get("address") or "")[:300] or None,
                acreage=_as_float(data.get("acreage")),
                containment=_as_float(data.get("containment")),
                is_prescribed=bool(data.get("is_prescribed", False)),
                evacuation_orders=data.get("evacuation_orders") or None,
                evacuation_warnings=data.get("evacuation_warnings") or None,
                evacuation_advisories=data.get("evacuation_advisories") or None,
                threat_score=threat,
                date_modified=parse_datetime(fire.get("date_modified") or "") or None,
                source_data=fire,
            )
        )

    # Short transaction: all fetching/scoring is done above, so the swap never
    # holds a DB transaction open across slow HTTP calls (PgBouncer-friendly).
    with transaction.atomic():
        CachedWildfire.objects.all().delete()
        if rows:
            CachedWildfire.objects.bulk_create(rows)
    logger.info("Cached %d wildfires within %.0f nm of feeder", len(rows), radius_nm)
    return len(rows)


def _threat_score(fire: dict, dist_km: float, radius_km: float) -> float | None:
    """libwatchduty composite threat score [0, 100], or None if unavailable."""
    try:
        from libwatchduty import compute_threat

        return compute_threat(fire, distance_km=dist_km, within_km=radius_km).score
    except (ValueError, TypeError, KeyError) as e:
        logger.debug("Threat scoring failed for fire %s: %s", fire.get("id"), e)
        return None


def _row_to_marker(row: CachedWildfire) -> dict:
    return {
        "id": row.event_id,
        "name": row.name,
        "lat": row.latitude,
        "lon": row.longitude,
        "acreage": row.acreage,
        "containment": row.containment,
        "threat_score": row.threat_score,
        "is_prescribed": row.is_prescribed,
        "evac_orders": row.evacuation_orders,
        "evac_warnings": row.evacuation_warnings,
        "evac_advisories": row.evacuation_advisories,
        "address": row.address,
        "date_modified": row.date_modified.isoformat() if row.date_modified else None,
    }


def get_cached_wildfires(lat: float, lon: float, radius_nm: float) -> list[dict]:
    """Return cached wildfire markers within ``radius_nm`` of (lat, lon).

    Uses a cheap bounding-box prefilter in the DB (matching the airports/navaids
    pattern) — exact enough at display scale for point markers."""
    lat_delta = radius_nm / 60.0
    lon_delta = radius_nm / (60.0 * max(cos(radians(lat)), 0.1))
    queryset = CachedWildfire.objects.filter(
        latitude__gte=lat - lat_delta,
        latitude__lte=lat + lat_delta,
        longitude__gte=lon - lon_delta,
        longitude__lte=lon + lon_delta,
    )
    return [_row_to_marker(row) for row in queryset]


def get_fire_bundle(event_id: int) -> dict | None:
    """Fetch the per-fire bundle (event, reports, cameras, scanner feeds) for the
    detail panel. Cached ~120s. Returns None when disabled or unreachable."""
    if not _is_enabled():
        return None

    key = _BUNDLE_CACHE_KEY.format(event_id=event_id)
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        from libwatchduty import WatchDutyError

        client = _client()
        bundle = client.get_fire_bundle(int(event_id))
    except WatchDutyError as e:
        logger.warning("Watch Duty bundle fetch failed for %s: %s", event_id, e)
        return None
    except (OSError, ConnectionError) as e:
        logger.warning("Watch Duty network error fetching bundle %s: %s", event_id, e)
        return None

    # Trim to what the panel renders — drop the heavy fire-progression sim runs
    # and cap the lists. The bundle's cameras are the whole network (not scoped to
    # the fire), so pick the closest few to the fire's location.
    event = bundle.get("event") or {}
    trimmed = {
        "event": event,
        "reports": (bundle.get("reports") or [])[:_BUNDLE_MAX_REPORTS],
        "cameras": _best_cameras(bundle.get("cameras") or [], event.get("lat"), event.get("lng")),
        "radio_feeds": (bundle.get("radio_feeds") or [])[:_BUNDLE_MAX_FEEDS],
    }
    cache.set(key, trimmed, _BUNDLE_CACHE_TTL)
    return trimmed


def _best_cameras(cameras: list[dict], fire_lat, fire_lon, limit: int = _BUNDLE_MAX_CAMERAS) -> list[dict]:
    """Pick the ``limit`` cameras best suited to watch this fire.

    Ranking (best first): purpose-built wildfire lookouts over roadway/traffic
    cameras, then online over offline, then nearest. Cameras beyond
    ``WILDFIRES_CAMERA_RADIUS_NM`` of the fire are dropped, and traffic cameras
    are only included when the fire has no wildfire/unknown camera to show — this
    stops dense roadside Caltrans cams from crowding out the actual fire view.
    Each returned camera carries ``distance_km`` (fire → camera). Falls back to
    the raw order when the fire has no coordinates.
    """
    flat = _as_float(fire_lat)
    flon = _as_float(fire_lon)
    if flat is None or flon is None:
        return cameras[:limit]

    max_km = (
        float(getattr(settings, "WILDFIRES_CAMERA_RADIUS_NM", _CAMERA_MAX_NM_DEFAULT) or _CAMERA_MAX_NM_DEFAULT)
        / _NM_PER_KM
    )
    scored = []
    for cam in cameras:
        latlng = cam.get("latlng") or {}
        clat = _as_float(latlng.get("lat"))
        clon = _as_float(latlng.get("lng"))
        if clat is None or clon is None:
            continue
        dist = _haversine_km(flat, flon, clat, clon)
        if dist > max_km:
            # Too far to actually show this fire — drop it rather than mislead.
            continue
        kind = _camera_kind(cam)
        offline = 1 if cam.get("is_offline") else 0
        scored.append((kind, offline, dist, cam))

    # Prefer wildfire + unknown cams; only fall back to traffic cams if that's
    # all this fire has (better a smoke-showing freeway cam than nothing).
    preferred = [s for s in scored if s[0] != _CAM_KIND_TRAFFIC]
    pool = preferred or scored
    pool.sort(key=lambda s: (s[0], s[1], s[2]))
    return [{**cam, "distance_km": round(dist, 1)} for _, _, dist, cam in pool[:limit]]


_AIRCRAFT_CACHE_KEY = "watchduty_aircraft_catalog"
_AIRCRAFT_CACHE_TTL = 24 * 60 * 60


def list_aircraft() -> list[dict]:
    """Watch Duty global aircraft catalog (hex_code, type, classification, name,
    model, tail_num, short_callsign). Requires auth — a token or username/password
    must be configured. Cached 24h. Returns [] when disabled or unavailable."""
    if not _is_enabled():
        return []

    cached = cache.get(_AIRCRAFT_CACHE_KEY)
    if cached is not None:
        return cached

    try:
        from libwatchduty import WatchDutyError

        aircraft = _client().list_aircraft() or []
    except WatchDutyError as e:
        logger.warning("Watch Duty aircraft fetch failed: %s", e)
        return []
    except (OSError, ConnectionError) as e:
        logger.warning("Watch Duty aircraft network error: %s", e)
        return []

    cache.set(_AIRCRAFT_CACHE_KEY, aircraft, _AIRCRAFT_CACHE_TTL)
    return aircraft
