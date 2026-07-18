"""
Read-only tools the assistant agent can call.

Each tool is a plain function returning a compact JSON string — thin wrappers
over the existing analytics/search services (called in-process, no HTTP). The
docstrings ARE the tool descriptions the model sees, so keep them action-oriented.

There is deliberately NO top-level LangChain import here: the plain functions are
directly callable/testable, and ``get_tools()`` lazily wraps them for the agent.
All tools are read-only — no mutation surface is exposed to the model.
"""

import functools
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Hard cap on any single tool result so a big analytics dict can't blow the
# model's context window. Overridable via ASSISTANT_MAX_RESULT_CHARS (raise for
# large-context models); this is the fallback when settings are unavailable.
_MAX_RESULT_CHARS = 6000


def _max_result_chars() -> int:
    try:
        from django.conf import settings

        return int(getattr(settings, "ASSISTANT_MAX_RESULT_CHARS", _MAX_RESULT_CHARS))
    except Exception:  # broad: settings unconfigured (bare import/test) → safe default
        return _MAX_RESULT_CHARS


def _guarded(fn):
    """Wrap a tool so it always returns a string — a raising tool would break the
    agent loop. functools.wraps preserves name/docstring/signature, which
    StructuredTool.from_function reads to build the tool schema."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as e:  # broad: any tool failure becomes a result the model can react to
            logger.warning(f"assistant tool {fn.__name__} failed: {type(e).__name__}: {e}")
            return _json({"error": f"{type(e).__name__}: {e}", "tool": fn.__name__})

    return wrapper


def _json(obj: Any) -> str:
    """Serialize a tool result compactly, trimming if oversized."""
    try:
        text = json.dumps(obj, default=str, separators=(",", ":"))
    except (TypeError, ValueError) as e:
        return json.dumps({"error": f"unserializable result: {e}"})
    cap = _max_result_chars()
    if len(text) > cap:
        text = text[:cap] + '…","_truncated":true}'
    return text


def _clamp_hours(hours: int, lo: int = 1, hi: int = 720) -> int:
    try:
        return max(lo, min(hi, int(hours)))
    except (TypeError, ValueError):
        return 24


# =============================================================================
# Analytics tools
# =============================================================================


@_guarded
def platform_activity(hours: int = 24) -> str:
    """Overall tracking activity for the last N hours: total sightings/sessions,
    unique aircraft, military count, average/max altitude, distance and speed."""
    from skyspy.services import stats_cache

    return _json(stats_cache.calculate_history_stats(_clamp_hours(hours)))


@_guarded
def safety_summary(hours: int = 24) -> str:
    """Safety/emergency events in the last N hours: counts by type (TCAS,
    proximity, emergency squawk, extreme vertical rate...) and severity, event
    rate per hour, and the aircraft with the most events."""
    from skyspy.services import stats_cache

    return _json(stats_cache.calculate_safety_stats(_clamp_hours(hours)))


@_guarded
def flight_patterns(hours: int = 24) -> str:
    """Flight-pattern analytics for the last N hours: busiest hours, peak hour,
    most common aircraft types, average session duration by type, frequent routes."""
    from skyspy.services import flight_pattern_stats

    return _json(flight_pattern_stats.calculate_flight_pattern_stats(_clamp_hours(hours)))


@_guarded
def geographic_breakdown(hours: int = 24) -> str:
    """Geographic analytics for the last N hours: breakdown by registration
    country, top operators, most-connected airports, and military vs civilian by country."""
    from skyspy.services import flight_pattern_stats

    return _json(flight_pattern_stats.calculate_geographic_stats(_clamp_hours(hours)))


@_guarded
def time_comparison() -> str:
    """Longer-term trend comparisons: week-over-week change, seasonal trends,
    day/night ratio, weekend vs weekday, and daily/weekly/monthly totals."""
    from skyspy.services import time_comparison_stats

    return _json(time_comparison_stats.get_all_time_comparison_stats())


@_guarded
def antenna_coverage(hours: int = 24) -> str:
    """Receiver/antenna performance for the last N hours: range percentiles,
    signal (RSSI) stats, and directional coverage percentage."""
    from skyspy.services import antenna_analytics

    return _json(antenna_analytics.get_or_calculate_summary(_clamp_hours(hours, hi=24)))


@_guarded
def acars_summary(hours: int = 24) -> str:
    """ACARS/VDL2 message activity for the last N hours: totals, by source,
    unique aircraft/flights, messages per hour, and the top message label with
    its decoded name/description/category (use those — do NOT guess what a label
    code like 'H1' means)."""
    from skyspy.services import acars_stats

    return _json(acars_stats.get_acars_summary_stats(_clamp_hours(hours)))


@_guarded
def collection_stats() -> str:
    """Lifetime spotting collection: total unique aircraft ever seen, unique
    types/operators/countries, military count, and all-time records."""
    from skyspy.services.gamification import gamification_service

    return _json(
        {
            "collection": gamification_service.get_collection_stats(),
            "lifetime": gamification_service.get_lifetime_stats(),
        }
    )


@_guarded
def live_traffic_summary() -> str:
    """Right-now live traffic: current aircraft count, how many with position,
    military/emergency counts, category breakdown, and the closest/highest/fastest."""
    from skyspy.services import stats_cache

    return _json(
        {
            "stats": stats_cache.get_aircraft_stats(),
            "top": stats_cache.get_top_aircraft(),
        }
    )


# =============================================================================
# Weather / aviation reference tools
# =============================================================================


@_guarded
def airport_weather(icao: str) -> str:
    """Current weather for an airport by ICAO code (e.g. 'KSEA'): the latest
    METAR observation(s) with decoded fields (wind, visibility, ceiling, temp,
    flight category). Use for 'what's the weather at ...' questions."""
    from skyspy.services import weather_cache

    station = (icao or "").strip().upper()
    if not station:
        return _json({"error": "icao required"})
    metars = weather_cache.fetch_metar_by_station(station, hours=3) or []
    return _json({"icao": station, "count": len(metars), "metars": metars[:5]})


@_guarded
def recent_pireps(hours: int = 6, limit: int = 15) -> str:
    """Recent pilot reports (PIREPs) from the last N hours, decoded to plain
    language: location, altitude, aircraft type, severity, hazards (turbulence/
    icing/wind shear) and a human summary. Use for in-flight weather conditions."""
    from django.utils import timezone

    from skyspy.models import CachedPirep
    from skyspy.services import pirep_decoder

    since = timezone.now() - timezone.timedelta(hours=_clamp_hours(hours, hi=48))
    n = max(1, min(50, int(limit or 15)))
    rows = []
    for p in CachedPirep.objects.filter(observation_time__gte=since).order_by("-observation_time")[:n]:
        decoded = pirep_decoder.decode_pirep(p)
        rows.append(
            {
                "location": p.location,
                "lat": p.latitude,
                "lon": p.longitude,
                "observation_time": p.observation_time,
                "report_type": p.report_type,
                "flight_level": p.flight_level,
                "aircraft_type": p.aircraft_type,
                "severity": decoded.get("severity"),
                "hazards": decoded.get("hazards"),
                "summary": decoded.get("human_summary"),
            }
        )
    return _json({"hours": _clamp_hours(hours, hi=48), "count": len(rows), "pireps": rows})


@_guarded
def airport_notams(icao: str) -> str:
    """Active NOTAMs (Notices to Air Missions) for an airport by ICAO code:
    closed runways/taxiways, unserviceable navaids, obstacles, and restrictions
    with their effective windows. Use for 'any NOTAMs at ...' questions."""
    from skyspy.services import notams

    station = (icao or "").strip().upper()
    if not station:
        return _json({"error": "icao required"})
    rows = notams.get_notams_for_airport(icao=station, active_only=True) or []
    return _json({"icao": station, "count": len(rows), "notams": rows[:25]})


@_guarded
def live_aircraft_map(limit: int = 60, military_only: bool = False, callsigns: str = "", hexes: str = "") -> str:
    """Current live aircraft that have a known position, for plotting on a MAP:
    each with icao hex, callsign, lat, lon, altitude, type, distance and military
    flag. Use this to answer 'show me on a map' / 'where are the aircraft' and to
    build a ```map block. Set military_only=true to restrict to military traffic.
    To focus on specific aircraft, pass callsigns and/or hexes as comma-separated
    lists (e.g. callsigns='UAL123,SWA88' or hexes='A9A397,AE1234') — only those
    are returned (matched on either field)."""
    from django.core.cache import cache

    call_set = {c for c in re.split(r"[,\s]+", (callsigns or "").upper()) if c}
    hex_set = {h for h in re.split(r"[,\s]+", (hexes or "").upper()) if h}
    filtering = bool(call_set or hex_set)

    aircraft = cache.get("current_aircraft", []) or []
    n = max(1, min(200, int(limit or 60)))
    points = []
    for ac in aircraft:
        lat, lon = ac.get("lat"), ac.get("lon")
        if lat is None or lon is None:
            continue
        callsign = (ac.get("flight") or "").strip()
        hex_code = (ac.get("hex") or "").strip()
        if filtering and callsign.upper() not in call_set and hex_code.upper() not in hex_set:
            continue
        if military_only and not ac.get("military"):
            continue
        points.append(
            {
                "hex": hex_code,
                "callsign": callsign,
                "lat": lat,
                "lon": lon,
                "track": ac.get("track"),
                "altitude": ac.get("alt_baro"),
                "type": ac.get("t"),
                "distance_nm": ac.get("distance_nm"),
                "military": bool(ac.get("military")),
                "squawk": ac.get("squawk"),
            }
        )
    # Closest first so a truncated list keeps the most relevant aircraft.
    points.sort(key=lambda p: (p["distance_nm"] is None, p["distance_nm"] or 0))
    result = {"count": len(points), "military_only": bool(military_only), "aircraft": points[:n]}
    if filtering:
        # Report which requested identifiers weren't currently airborne/positioned.
        found = {p["callsign"].upper() for p in points} | {p["hex"].upper() for p in points}
        missing = sorted((call_set | hex_set) - found)
        result["filtered"] = True
        if missing:
            result["not_found"] = missing
    return _json(result)


@_guarded
def acars_timeline(hours: int = 24, interval: str = "hour") -> str:
    """ACARS/VDL2 message volume as a TIME SERIES over the last N hours, bucketed
    by interval ('hour' or 'day'), with per-bucket counts and source split. Ideal
    for plotting a line/area chart of datalink activity over time."""
    from skyspy.services import acars_stats

    interval = "day" if str(interval).lower().startswith("d") else "hour"
    return _json(acars_stats.calculate_acars_trends(hours=_clamp_hours(hours), interval=interval))


# =============================================================================
# Search / lookup tools
# =============================================================================


@_guarded
def lookup_airframe(icao_hex: str) -> str:
    """Look up everything known about one airframe by its 6-char ICAO hex:
    registration, type, manufacturer, operator, owner + ownership-risk signals,
    per-field provenance, country, and photo. Returns {} if unknown."""
    from skyspy.services import aircraft_info

    return _json(aircraft_info.get_aircraft_info((icao_hex or "").strip()) or {})


@_guarded
def _resolve_to_hex(identifier: str) -> str | None:
    """Resolve an ICAO hex, live callsign/flight number, or tail number to a hex.

    - A 6-char hex is returned as-is.
    - Otherwise matched against the live-aircraft cache on callsign OR
      registration (e.g. 'ASA111' or 'N842UA' -> 'A1B2C3').
    - A tail number not currently airborne falls back to the airframe DB.
    """
    ident = (identifier or "").strip().upper()
    if not ident:
        return None
    if re.fullmatch(r"[0-9A-F]{6}", ident):
        return ident
    from django.core.cache import cache

    for ac in cache.get("current_aircraft", []) or []:
        call = (ac.get("flight") or "").strip().upper()
        reg = (ac.get("r") or ac.get("registration") or "").strip().upper()
        if ident in (call, reg):
            hex_code = (ac.get("hex") or "").strip().upper()
            if hex_code:
                return hex_code

    # Registration not currently airborne — look it up in the airframe DB.
    from skyspy.models import AircraftInfo

    hex_code = AircraftInfo.objects.filter(registration__iexact=ident).values_list("icao_hex", flat=True).first()
    return hex_code.upper() if hex_code else None


def fetch_airframe_photo(aircraft: str, force: bool = False) -> str:
    """Fetch a photo of an airframe by its 6-char ICAO hex OR a live callsign /
    flight number (e.g. 'ASA111' or 'A1B2C3'); callsigns are resolved against
    currently-tracked aircraft. The app displays the photo automatically from
    this tool call — do NOT write an image URL or a Markdown image yourself; just
    say the photo is shown and credit the photographer/source if returned. Set
    force=true to bypass the cache and re-download the image. Returns
    {"error": ...} if the aircraft can't be resolved, no photo is available, or
    the fetch fails."""
    from skyspy.services import aircraft_info, photo_cache

    hex_code = _resolve_to_hex(aircraft)
    if not hex_code:
        return _json({"error": f"could not resolve '{aircraft}' to an aircraft", "aircraft": aircraft})

    info = aircraft_info.get_aircraft_info(hex_code, include_photo=True) or {}
    photo_url = info.get("photo_url")

    # A photo counts as available if it's ALREADY cached (S3/disk) — the airframe
    # page renders that cached copy even when the remote photo_url is empty, so
    # requiring photo_url here wrongly reported "no photo". Only need a remote URL
    # when nothing is cached yet (first fetch) or on a forced re-download.
    cached = photo_cache.is_photo_cached(hex_code)
    if force or not cached:
        if not photo_url:
            return _json({"error": f"no photo available for {hex_code}", "icao_hex": hex_code})
        # Pull it now and wait so the served URL has bytes when the frontend renders.
        photo_path, _thumb_path = photo_cache.cache_aircraft_photos(
            hex_code,
            photo_url=photo_url,
            thumbnail_url=info.get("photo_thumbnail_url"),
            photo_page_link=info.get("photo_page_link"),
            force=True,
        )
        cached = bool(photo_path) or photo_cache.is_photo_cached(hex_code)

    if not cached:
        return _json({"error": f"photo fetch failed for {hex_code}", "icao_hex": hex_code})

    # Deliberately no image URL here: the frontend renders the <img> from this
    # tool call with a server-templated src (see agent.astream / _photo_src), so
    # the model never gets a URL to embed or hallucinate.
    ident = (aircraft or "").strip().upper()
    return _json(
        {
            "icao_hex": hex_code,
            "registration": info.get("registration"),
            # Echo the identifier the user gave (callsign or tail) for the alt/caption.
            "label": ident if ident != hex_code else None,
            "photographer": info.get("photo_photographer"),
            "source": info.get("photo_source"),
            "photo_available": True,
            "forced_refetch": force,
        }
    )


@_guarded
def lookup_route(callsign: str) -> str:
    """Look up the flight route (origin and destination airports) for a callsign
    / flight number, e.g. 'AAL100'. Returns {} if no route is known."""
    from skyspy.services import external_db

    return _json(external_db.fetch_route((callsign or "").strip()) or {})


@_guarded
def find_sightings(identifier: str, hours: int = 24) -> str:
    """Find recent sightings of an aircraft by ICAO hex OR callsign in the last N
    hours: count, first/last seen, and altitude/distance extremes."""
    from django.db.models import Count, Max, Min
    from django.utils import timezone

    from skyspy.models import AircraftSighting

    ident = (identifier or "").strip().upper()
    if not ident:
        return _json({"error": "identifier required"})
    since = timezone.now() - timezone.timedelta(hours=_clamp_hours(hours, hi=168))
    qs = AircraftSighting.objects.filter(timestamp__gte=since)
    qs = qs.filter(icao_hex=ident) if len(ident) == 6 and " " not in ident else qs.filter(callsign=ident)
    agg = qs.aggregate(
        count=Count("id"),
        first_seen=Min("timestamp"),
        last_seen=Max("timestamp"),
        max_alt=Max("altitude_baro"),
        min_dist=Min("distance_nm"),
    )
    return _json({"identifier": ident, "hours": _clamp_hours(hours, hi=168), **agg})


@_guarded
def find_safety_events(hours: int = 24, event_type: str = "", severity: str = "") -> str:
    """Find recent safety events, optionally filtered by event_type (e.g.
    'proximity', 'tcas_warning', 'emergency_squawk') and/or severity
    ('info'/'warning'/'critical'). Returns up to 25 most recent."""
    from django.utils import timezone

    from skyspy.models import SafetyEvent

    since = timezone.now() - timezone.timedelta(hours=_clamp_hours(hours, hi=720))
    qs = SafetyEvent.objects.filter(timestamp__gte=since)
    if event_type:
        qs = qs.filter(event_type=event_type)
    if severity:
        qs = qs.filter(severity=severity)
    rows = list(
        qs.order_by("-timestamp").values("event_type", "severity", "icao_hex", "callsign", "message", "timestamp")[:25]
    )
    return _json({"count": qs.count(), "events": rows})


@_guarded
def find_incidents(registration: str) -> str:
    """Find recorded NTSB accident/incident history for an aircraft registration
    (tail number), e.g. 'N772SW'. Returns the events with dates and locations."""
    from skyspy.models import AircraftIncident

    reg = (registration or "").strip().upper()
    if not reg:
        return _json({"error": "registration required"})
    rows = list(
        AircraftIncident.objects.filter(registration=reg)
        .order_by("-event_date")
        .values("source", "external_id", "event_type", "event_date", "city", "state", "severity", "url")[:20]
    )
    return _json({"registration": reg, "count": len(rows), "incidents": rows})


@_guarded
def semantic_airframe_search(query: str, k: int = 5) -> str:
    """Semantic (vector) search over airframe dossiers — use for fuzzy questions
    like 'aircraft registered to a trust' or 'business jets owned by shell LLCs'.
    Returns the k most relevant airframes with a short dossier and similarity."""
    from skyspy.services import airframe_rag

    hits = airframe_rag.search((query or "").strip(), k=max(1, min(10, int(k or 5))))
    return _json({"query": query, "results": hits})


def _semantic_search(query: str, kind: str, k: int) -> str:
    from skyspy.services import rag

    hits = rag.search((query or "").strip(), kind=kind, k=max(1, min(10, int(k or 5))))
    return _json({"query": query, "kind": kind, "count": len(hits), "results": hits})


@_guarded
def notable_acars_messages(hours: int = 24, limit: int = 15) -> str:
    """Surface the most INTERESTING ACARS/VDL2 messages in the last N hours when
    there is NO specific search term — answers open-ended asks like 'find some
    interesting ACARS messages', 'anything unusual on the datalink', or 'notable
    ACARS today'. Ranks by anomaly/emergency keywords (diversions, faults,
    medical, emergencies), amount of human free-text, and label rarity, while
    ignoring routine telemetry (position/OOOI/squitters). Each result includes a
    score and the reasons it was flagged. Use semantic_acars_search instead when
    the user names a specific topic to search for."""
    from skyspy.services import acars_stats

    return _json(acars_stats.find_notable_messages(hours=_clamp_hours(hours), limit=max(1, min(30, int(limit or 15)))))


@_guarded
def semantic_acars_search(query: str, k: int = 5) -> str:
    """Semantic (vector) search over received ACARS/VDL2 message text — use for
    fuzzy datalink questions like 'messages about a medical diversion', 'engine
    fault reports', or 'free-text position/weather messages'. Returns the k most
    relevant messages with their text, aircraft (icao/callsign/registration),
    label and timestamp. Use acars_summary/acars_timeline for counts/trends
    instead; use this to FIND specific message content."""
    return _semantic_search(query, "acars", k)


@_guarded
def semantic_notam_search(query: str, k: int = 5) -> str:
    """Semantic (vector) search over cached NOTAMs (Notices to Air Missions) —
    use for fuzzy questions like 'runway closures near the coast', 'GPS/RAIM
    outages', 'drone/UAS restrictions', or 'VIP TFRs'. Returns the k most
    relevant NOTAMs with their text, type, location and effective window. Use
    airport_notams when you already know the airport ICAO; use this for
    content/topic searches across all cached NOTAMs."""
    return _semantic_search(query, "notam", k)


@_guarded
def semantic_pirep_search(query: str, k: int = 5) -> str:
    """Semantic (vector) search over pilot reports (PIREPs) — use for fuzzy
    questions like 'severe turbulence at altitude', 'icing reports near Seattle',
    or 'wind shear on approach'. Returns the k most relevant PIREPs with their
    decoded summary, hazards, location and time. Use recent_pireps for a plain
    recency list; use this to search by conditions/topic."""
    return _semantic_search(query, "pirep", k)


@_guarded
def semantic_event_search(query: str, k: int = 5) -> str:
    """Semantic (vector) search over recorded safety events AND NTSB accident/
    incident history — use to find PAST occurrences by meaning: 'have we seen a
    close-proximity conflict like this before', 'emergency squawks near the
    coast', or 'prior accidents involving this aircraft type'. Returns the k most
    relevant events/incidents with their summary, type, severity, aircraft and
    date. Use find_safety_events/find_incidents when you have an exact
    type/registration; use this to search by description across history."""
    return _semantic_search(query, "safety,incident", k)


# =============================================================================
# Correlation / behavior / detection tools
# =============================================================================


@_guarded
def metric_correlations(x_field: str = "", y_field: str = "", hours: int = 24) -> str:
    """Find statistical relationships in tracked-aircraft telemetry over the last
    N hours — the 'is X related to Y?' engine no fixed panel shows. Correlatable
    fields: altitude_baro, ground_speed, distance_nm, rssi, vertical_rate, hour
    (hour-of-day). Give BOTH x_field and y_field for a single pairing (returns
    Pearson r, regression slope, sample size) — e.g. distance_nm vs rssi, or
    altitude_baro vs ground_speed. Leave them empty to get the FULL pairwise
    correlation matrix so you can spot the strongest relationship yourself. Cite
    r values (|r|>0.5 notable, >0.8 strong) and always report n."""
    from skyspy.services import analytics_correlation as ac

    hours = _clamp_hours(hours)
    x, y = (x_field or "").strip(), (y_field or "").strip()
    if x and y:
        if not ac.is_valid_field(x) or not ac.is_valid_field(y):
            return _json({"error": f"unknown field(s) {x!r}/{y!r}", "valid_fields": ac.field_labels()})
        res = ac.scatter_correlation(x, y, hours=hours)
        # Drop the raw scatter points — the model wants r/slope/n, not 200 coords.
        res.pop("points", None)
        return _json(res)
    # No specific pair → hand back the whole matrix to reason over.
    return _json(ac.correlation_matrix(hours=hours))


def _haversine_nm(lat1, lon1, lat2, lon2) -> float:
    from skyspy.services.law_enforcement_db import haversine_distance

    return haversine_distance(lat1, lon1, lat2, lon2)


def _track_pattern(pts: list[dict]) -> dict:
    """Cheap behavior flags from an ordered position list: orbit/loiter (long
    path, little net displacement), plus climb/descent extremes."""
    coords = [(p["lat"], p["lon"]) for p in pts if p.get("lat") is not None and p.get("lon") is not None]
    flags = {"orbit_or_loiter": False, "rapid_climb": False, "rapid_descent": False}
    if len(coords) >= 4:
        path = sum(_haversine_nm(*coords[i], *coords[i + 1]) for i in range(len(coords) - 1))
        net = _haversine_nm(*coords[0], *coords[-1])
        # Long flown path that returns near its start = circling/holding/survey.
        flags["orbit_or_loiter"] = path >= 3.0 and net <= max(1.5, 0.25 * path)
        flags["path_nm"] = round(path, 1)
        flags["net_displacement_nm"] = round(net, 1)
    vs = [p.get("vertical_rate") for p in pts if p.get("vertical_rate") is not None]
    if vs:
        flags["rapid_climb"] = max(vs) >= 3000
        flags["rapid_descent"] = min(vs) <= -3000
        flags["max_vertical_rate"] = max(vs, key=abs)
    return flags


@_guarded
def aircraft_track(identifier: str, hours: int = 6, points: int = 60) -> str:
    """Reconstruct an aircraft's actual FLOWN PATH over the last N hours by ICAO
    hex, live callsign, or tail number. Returns an ordered, downsampled polyline
    (lat/lon/altitude/track/vertical_rate/time) the app draws on a map, plus
    derived behavior flags: orbit_or_loiter (circling/holding/survey), rapid_climb
    and rapid_descent. Use for 'is anything orbiting / loitering', 'trace this
    aircraft's path', or surveillance/holding-pattern questions. Empty track means
    no stored positions in the window."""
    from django.utils import timezone

    from skyspy.models import AircraftSighting

    hex_code = _resolve_to_hex(identifier)
    if not hex_code:
        return _json({"error": f"could not resolve '{identifier}' to an aircraft", "identifier": identifier})
    hrs = _clamp_hours(hours, hi=168)
    since = timezone.now() - timezone.timedelta(hours=hrs)
    rows = list(
        AircraftSighting.objects.filter(icao_hex=hex_code, timestamp__gte=since, latitude__isnull=False)
        .order_by("timestamp")
        .values("latitude", "longitude", "altitude_baro", "track", "vertical_rate", "timestamp")
    )
    n = max(10, min(200, int(points or 60)))
    step = max(1, len(rows) // n)
    track = [
        {
            "lat": r["latitude"],
            "lon": r["longitude"],
            "altitude": r["altitude_baro"],
            "track": r["track"],
            "vertical_rate": r["vertical_rate"],
            "ts": r["timestamp"],
        }
        for r in rows[::step]
    ]
    return _json(
        {
            "identifier": identifier,
            "icao_hex": hex_code,
            "hours": hrs,
            "point_count": len(rows),
            "pattern": _track_pattern(track),
            "track": track,
        }
    )


@_guarded
def identify_law_enforcement(identifier: str) -> str:
    """Classify an aircraft (by ICAO hex, live callsign, or tail number) as law
    enforcement / government / surveillance. Returns is_law_enforcement,
    is_surveillance_type, is_helicopter, agency category, description and a
    confidence level. Use for 'is this a police/surveillance aircraft', spotting
    LE orbits, or fixed-wing surveillance (e.g. cell-site-simulator platforms)."""
    from skyspy.services import aircraft_info, law_enforcement_db

    hex_code = _resolve_to_hex(identifier)
    if not hex_code:
        return _json({"error": f"could not resolve '{identifier}' to an aircraft", "identifier": identifier})
    info = aircraft_info.get_aircraft_info(hex_code) or {}
    result = law_enforcement_db.identify_law_enforcement(
        hex_code=hex_code,
        callsign=info.get("callsign") or info.get("flight"),
        operator=info.get("operator_icao") or info.get("operator"),
        registration=info.get("registration"),
        category=info.get("category"),
        type_code=info.get("type_code") or info.get("type"),
    )
    return _json({"identifier": identifier, "icao_hex": hex_code, **result})


@_guarded
def threat_assessment(radius_nm: float = 25.0) -> str:
    """Scan CURRENT live traffic near the receiver for 'cannonball' mobile-threat
    patterns — aircraft closing on / pursuing / loitering over the antenna site
    (e.g. police helicopters or surveillance orbits overhead). Returns ranked
    threats with type, urgency, distance and bearing. Use for 'is anything
    watching / following me', 'threats overhead', or 'suspicious aircraft nearby'."""
    from django.conf import settings
    from django.core.cache import cache

    from skyspy.services.cannonball import analyze_threats

    lat = getattr(settings, "FEEDER_LAT", None)
    lon = getattr(settings, "FEEDER_LON", None)
    if lat is None or lon is None:
        return _json({"error": "receiver location (FEEDER_LAT/LON) not configured"})
    aircraft = cache.get("current_aircraft", []) or []
    threats = analyze_threats(aircraft, float(lat), float(lon), radius_nm=max(1.0, min(100.0, float(radius_nm or 25))))
    return _json({"radius_nm": radius_nm, "count": len(threats), "threats": threats[:25]})


# =============================================================================
# Registry
# =============================================================================

# The plain functions, in the order the model sees them. Kept curated (~15) so
# tool selection stays reliable.
TOOL_FUNCS = [
    platform_activity,
    safety_summary,
    flight_patterns,
    geographic_breakdown,
    time_comparison,
    antenna_coverage,
    acars_summary,
    acars_timeline,
    collection_stats,
    live_traffic_summary,
    live_aircraft_map,
    airport_weather,
    recent_pireps,
    airport_notams,
    lookup_airframe,
    fetch_airframe_photo,
    lookup_route,
    find_sightings,
    find_safety_events,
    find_incidents,
    semantic_airframe_search,
    notable_acars_messages,
    semantic_acars_search,
    semantic_notam_search,
    semantic_pirep_search,
    semantic_event_search,
    metric_correlations,
    aircraft_track,
    identify_law_enforcement,
    threat_assessment,
]


def get_tools() -> list:
    """Wrap the plain functions as LangChain StructuredTools (lazy import so this
    module stays importable/testable without LangChain installed)."""
    from langchain_core.tools import StructuredTool

    return [StructuredTool.from_function(fn) for fn in TOOL_FUNCS]
