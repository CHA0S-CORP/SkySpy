"""
Read-only tools the assistant agent can call.

Each tool is a plain function returning a compact JSON string — thin wrappers
over the existing analytics/search services (called in-process, no HTTP). The
docstrings ARE the tool descriptions the model sees, so keep them action-oriented.

There is deliberately NO top-level LangChain import here: the plain functions are
directly callable/testable, and ``get_tools()`` lazily wraps them for the agent.
All tools are read-only — no mutation surface is exposed to the model.
"""

import contextvars
import functools
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# The authenticated user driving the current request, set by the agent before it
# invokes the graph (reset after). Owner-scoped tools (e.g. my_alert_rules) read
# it. A ContextVar keeps it correct under concurrent async requests without
# threading a user argument through every tool signature. None = anonymous.
_current_user: contextvars.ContextVar = contextvars.ContextVar("assistant_current_user", default=None)


def set_current_user(user):
    """Bind the request user for owner-scoped tools; returns the token to reset."""
    return _current_user.set(user)


def reset_current_user(token) -> None:
    if token is not None:
        _current_user.reset(token)


def _get_user():
    """The current authenticated user, or None if anonymous/unset."""
    user = _current_user.get()
    return user if (user is not None and getattr(user, "is_authenticated", False)) else None


# Hard cap on any single tool result so a big analytics dict can't blow the
# model's context window. Overridable via ASSISTANT_MAX_RESULT_CHARS (raise for
# large-context models); this is the fallback when settings are unavailable.
_MAX_RESULT_CHARS = 6000


# On small context windows a single 6000-char tool result (~1500 tokens) is too
# big — several tool rounds accumulate and overflow. Cap results harder there.
_COMPACT_WINDOW_THRESHOLD = 16000
_COMPACT_RESULT_CHARS = 1200


def _max_result_chars() -> int:
    try:
        from django.conf import settings

        configured = int(getattr(settings, "ASSISTANT_MAX_RESULT_CHARS", _MAX_RESULT_CHARS))
        window = int(getattr(settings, "ASSISTANT_CONTEXT_WINDOW", 0) or 0)
        if 0 < window <= _COMPACT_WINDOW_THRESHOLD:
            return min(configured, _COMPACT_RESULT_CHARS)
        return configured
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
        # Wrap the trimmed content as a JSON *string* so the result stays valid
        # JSON (the old sentinel append produced un-parseable output, which the
        # model — and json.loads — choked on). Shave the preview until the whole
        # object fits the cap even after escaping expands it.
        preview = text[:cap]
        out = json.dumps({"_truncated": True, "preview": preview}, separators=(",", ":"))
        while len(out) > cap and preview:
            preview = preview[: -(len(out) - cap) - 1]
            out = json.dumps({"_truncated": True, "preview": preview}, separators=(",", ":"))
        return out
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
def nearby_wildfires(radius_nm: float = 100.0, limit: int = 15) -> str:
    """Active wildfires near the feeder from Watch Duty, ranked by threat: name,
    location, acreage, containment %, threat score, and any evacuation orders/
    warnings. Use for 'any wildfires nearby', 'is there a fire near me', or fire
    situational-awareness questions. Empty when wildfires are disabled or the
    feeder is outside Watch Duty's US/CA coverage."""
    from django.conf import settings

    from skyspy.services import wildfires

    if not getattr(settings, "WILDFIRES_ENABLED", False):
        return _json({"enabled": False, "wildfires": [], "count": 0})

    lat = float(getattr(settings, "FEEDER_LAT", 0) or 0)
    lon = float(getattr(settings, "FEEDER_LON", 0) or 0)
    try:
        radius = max(1.0, min(250.0, float(radius_nm)))
    except (TypeError, ValueError):
        radius = 100.0
    n = max(1, min(50, int(limit or 15)))

    fires = wildfires.get_cached_wildfires(lat, lon, radius)
    # Highest threat first; None scores sort last.
    fires.sort(key=lambda f: (f.get("threat_score") is None, -(f.get("threat_score") or 0)))
    return _json({"enabled": True, "radius_nm": radius, "count": len(fires), "wildfires": fires[:n]})


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


# ADS-B emitter categories treated as "general aviation" (light/small fixed-wing,
# rotorcraft, gliders/balloons/ultralights) — excludes airliners (A3/A4/A5).
_GA_CATEGORIES = {"A1", "A2", "A7", "B1", "B2", "B4"}
_EMERGENCY_SQUAWKS = {"7500", "7600", "7700"}

# Fuzzy aircraft CLASSES → an OR-list of match conditions. ADS-B transmits
# variant type designators (B77W, A359, B789…), so a class matches by emitter
# category (reliable for size) OR a type-code prefix (catches every variant).
# {"cat": "A5"} matches ac.category=="A5"; {"tp": "B77"} matches ac.t startswith "B77".
_WIDEBODY_TYPE_PREFIXES = ["B74", "B76", "B77", "B78", "A30", "A31", "A33", "A34", "A35", "A38", "MD11", "IL96", "B78"]
_CLASS_MAP: dict[str, list[dict]] = {
    "widebody": [{"cat": "A5"}, *({"tp": p} for p in _WIDEBODY_TYPE_PREFIXES)],
    "heavy": [{"cat": "A5"}, *({"tp": p} for p in _WIDEBODY_TYPE_PREFIXES)],
    "airliner": [{"cat": "A3"}, {"cat": "A4"}, {"cat": "A5"}],
    "jet": [{"cat": "A3"}, {"cat": "A4"}, {"cat": "A5"}],
    "large": [{"cat": "A4"}, {"cat": "A5"}],
    "narrowbody": [{"cat": "A3"}],
    "regional": [{"cat": "A3"}],
    "light": [{"cat": "A1"}, {"cat": "A2"}],
    "small": [{"cat": "A1"}, {"cat": "A2"}],
    "helicopter": [{"cat": "A7"}],
    "rotorcraft": [{"cat": "A7"}],
    "heli": [{"cat": "A7"}],
    "glider": [{"cat": "B1"}],
    "sailplane": [{"cat": "B1"}],
    "balloon": [{"cat": "B2"}],
    "ultralight": [{"cat": "B4"}],
    "drone": [{"cat": "B6"}],
    "uav": [{"cat": "B6"}],
}


def _build_radar_match(
    *,
    military,
    law_enforcement,
    emergency,
    general_aviation,
    classes,
    categories,
    types,
    type_prefix,
    callsigns,
    hexes,
    callsign_prefix,
    alt_min,
    alt_max,
    dist_max,
) -> dict:
    """Assemble a radar-filter match spec from tool args (only set keys included).

    Shared shape with the frontend radar predicate (LiveMapView): every present
    key is an AND condition. Law-enforcement is resolved here to a hex allowlist
    (there is no per-aircraft LE flag in the live feed); everything else is a
    plain attribute the client can also re-evaluate live.
    """
    from django.core.cache import cache

    def _csv(s):
        return [x for x in re.split(r"[,\s]+", (s or "").upper()) if x]

    match: dict[str, Any] = {}
    if military:
        match["military"] = True
    if emergency:
        match["emergency"] = True
    if general_aviation:
        match["ga"] = True
    cats = _csv(categories)
    if cats:
        match["categories"] = cats
    tps = _csv(types)
    if tps:
        match["types"] = tps
    tprefix = _csv(type_prefix)
    if tprefix:
        match["typePrefixes"] = tprefix
    # Fuzzy classes (widebody/helicopter/airliner/…) → an OR-list of conditions.
    any_of: list[dict] = []
    for cname in _csv(classes):
        any_of.extend(_CLASS_MAP.get(cname.lower(), []))
    if any_of:
        # Dedup while preserving order.
        seen = set()
        match["anyOf"] = [
            c for c in any_of if not (repr(sorted(c.items())) in seen or seen.add(repr(sorted(c.items()))))
        ]
    cs = _csv(callsigns)
    if cs:
        match["callsigns"] = cs
    pref = _csv(callsign_prefix)
    if pref:
        match["callsignPrefix"] = pref
    hx = _csv(hexes)
    if hx:
        match["hexes"] = hx
    if alt_min:
        match["altMin"] = int(alt_min)
    if alt_max:
        match["altMax"] = int(alt_max)
    if dist_max:
        match["distMax"] = float(dist_max)

    if law_enforcement:
        # Resolve which currently-live aircraft are law enforcement (no live flag).
        from skyspy.services import law_enforcement_db

        le_hexes = []
        for ac in cache.get("current_aircraft", []) or []:
            hx_code = (ac.get("hex") or "").strip()
            if not hx_code:
                continue
            res = law_enforcement_db.identify_law_enforcement(
                hex_code=hx_code,
                callsign=(ac.get("flight") or "").strip() or None,
                registration=ac.get("r") or None,
                category=ac.get("category"),
                type_code=ac.get("t"),
            )
            # Confirmed LE, or a strong "of interest" signal. Bare surveillance-type /
            # helicopter matches (confidence low/none) flood the list with plain GA
            # (Cessna 172s, Robinson R44s), so require medium+ confidence for is_interest.
            if res.get("is_law_enforcement") or (
                res.get("is_interest") and res.get("confidence") in ("medium", "high", "very_high")
            ):
                le_hexes.append(hx_code.upper())
        # Intersect with any explicit hex list, else set it.
        if "hexes" in match:
            match["hexes"] = [h for h in match["hexes"] if h in set(le_hexes)]
        else:
            match["hexes"] = le_hexes
    return match


def _match_live_aircraft(ac: dict, m: dict) -> bool:
    """Evaluate a radar match spec against one live aircraft object."""
    hexes = m.get("hexes")
    if hexes is not None and (ac.get("hex") or "").upper() not in set(hexes):
        return False
    if "military" in m and bool(ac.get("military")) != m["military"]:
        return False
    if m.get("emergency"):
        sq = str(ac.get("squawk") or "")
        if not (ac.get("emergency") or sq in _EMERGENCY_SQUAWKS):
            return False
    if m.get("ga") and (ac.get("military") or (ac.get("category") or "").upper() not in _GA_CATEGORIES):
        return False
    cats = m.get("categories")
    if cats and (ac.get("category") or "").upper() not in set(cats):
        return False
    types_ = m.get("types")
    if types_ and (ac.get("t") or "").upper() not in set(types_):
        return False
    tprefix = m.get("typePrefixes")
    if tprefix and not any((ac.get("t") or "").upper().startswith(p) for p in tprefix):
        return False
    any_of = m.get("anyOf")
    if any_of:
        cat = (ac.get("category") or "").upper()
        typ = (ac.get("t") or "").upper()
        if not any((("cat" in c and cat == c["cat"]) or ("tp" in c and typ.startswith(c["tp"]))) for c in any_of):
            return False
    cs = m.get("callsigns")
    if cs and (ac.get("flight") or "").strip().upper() not in set(cs):
        return False
    pref = m.get("callsignPrefix")
    if pref and not any((ac.get("flight") or "").strip().upper().startswith(p) for p in pref):
        return False
    if m.get("altMax") and (ac.get("alt_baro") or 0) > m["altMax"]:
        return False
    if m.get("altMin") and (ac.get("alt_baro") or 0) < m["altMin"]:
        return False
    if m.get("distMax") is not None:
        dist = ac.get("distance_nm")
        if dist is None or dist > m["distMax"]:
            return False
    return True


@_guarded
def radar_filter(
    label: str = "",
    military: bool = False,
    law_enforcement: bool = False,
    emergency: bool = False,
    general_aviation: bool = False,
    classes: str = "",
    categories: str = "",
    types: str = "",
    type_prefix: str = "",
    callsigns: str = "",
    hexes: str = "",
    callsign_prefix: str = "",
    alt_min: int = 0,
    alt_max: int = 0,
    dist_max: float = 0.0,
) -> str:
    """Filter the LIVE RADAR to a subset of current aircraft AND render that subset
    on a map. Use this whenever the user wants to SEE a category/role of live
    traffic — e.g. 'live view of law enforcement aircraft', 'show all GA aircraft',
    'military traffic on the map', 'anything squawking an emergency', 'show 737s
    within 50nm'. It draws an inline map of the matching aircraft and, when the
    user is on the radar page, live-filters the actual radar screen (and fits the
    view to the matches). Compose several conditions for complex filters (they AND
    together). NEVER hand-list aircraft or invent hexes — call this tool so the
    matches come from real live data.

    Args (all optional; combine as needed):
      label: short human name for the filter (e.g. 'Law enforcement'), shown on the radar banner.
      military: only military aircraft.
      law_enforcement: only law-enforcement/government/surveillance aircraft (resolved from the LE database).
      emergency: only aircraft squawking 7500/7600/7700 or flagged emergency.
      general_aviation: only light/small GA + rotorcraft (excludes airliners).
      classes: comma fuzzy aircraft classes — USE THIS for size/body/role words instead of
        guessing type codes: 'widebody','heavy','airliner','jet','narrowbody','regional','light',
        'helicopter','glider','balloon','drone'. (ADS-B sends variant type codes like B77W/A359,
        so a hand-typed list of base codes misses them — classes resolve robustly.)
      categories: comma ADS-B emitter categories if you truly want a raw category (A1 light, A2 small,
        A3 large/narrowbody, A5 heavy/widebody, A7 rotorcraft).
      types: comma EXACT type codes (e.g. 'C172,PA28').
      type_prefix: comma type-code PREFIXES for a family (e.g. 'B73' = all 737s, 'A32,A31,A20,A21' = A320 family).
      callsigns / hexes: comma exact identifiers to restrict to.
      callsign_prefix: comma callsign prefixes (e.g. 'N' for US GA, 'CHP' for CHP).
      alt_min / alt_max: altitude band in feet.
      dist_max: max distance from the receiver in nm.
    """
    from django.core.cache import cache

    match = _build_radar_match(
        military=military,
        law_enforcement=law_enforcement,
        emergency=emergency,
        general_aviation=general_aviation,
        classes=classes,
        categories=categories,
        types=types,
        type_prefix=type_prefix,
        callsigns=callsigns,
        hexes=hexes,
        callsign_prefix=callsign_prefix,
        alt_min=alt_min,
        alt_max=alt_max,
        dist_max=dist_max,
    )

    aircraft = cache.get("current_aircraft", []) or []
    matched = [ac for ac in aircraft if _match_live_aircraft(ac, match)]
    positioned = []
    for ac in matched:
        lat, lon = ac.get("lat"), ac.get("lon")
        if lat is None or lon is None:
            continue
        # Compact point (rounded coords, drop empty fields) so many fit the cap.
        pt = {
            "hex": (ac.get("hex") or "").strip(),
            "callsign": (ac.get("flight") or "").strip(),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "distance_nm": ac.get("distance_nm"),
            "military": bool(ac.get("military")),
        }
        for k, v in (("track", ac.get("track")), ("altitude", ac.get("alt_baro")), ("type", ac.get("t"))):
            if v is not None and v != "":
                pt[k] = v
        positioned.append(pt)
    positioned.sort(key=lambda p: (p["distance_nm"] is None, p["distance_nm"] or 0))

    label = (label or "Filtered aircraft").strip()
    # Cap the inline-map list so the JSON result stays under the tool char cap
    # (the live radar itself shows ALL matches; this is just the chat preview).
    return _json(
        {
            "label": label,
            "count": len(matched),
            "positioned": len(positioned),
            "aircraft": positioned[:20],
            # The command the client applies to the live radar (fit view to matches).
            "radar": {"label": label, "match": match, "view": "fit"},
        }
    )


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
def lookup_airframe(identifier: str) -> str:
    """Look up everything known about one airframe by ICAO hex, tail number
    (registration, e.g. 'N882SD'), OR a live callsign/flight number — the tool
    resolves any of them to the hex itself, so pass whatever the user gave you.
    Returns registration, type, manufacturer, operator, owner + ownership-risk
    signals, per-field provenance, country, and photo. Returns
    {"error": ...} only when the identifier can't be resolved to any aircraft."""
    from skyspy.services import aircraft_info

    ident = (identifier or "").strip()
    hex_code = _resolve_to_hex(ident)
    if not hex_code:
        return _json({"error": f"could not resolve '{identifier}' to an aircraft", "identifier": identifier})
    info = aircraft_info.get_aircraft_info(hex_code) or {}
    # Even with no DB/live record, a resolved US tail still yields hex + reg so the
    # answer is never an empty "unknown" — surface what we do know.
    info.setdefault("icao_hex", hex_code)
    return _json(info)


def _resolve_to_hex(identifier: str) -> str | None:
    """Resolve an ICAO hex, live callsign/flight number, or tail number to a hex.

    - A 6-char hex is returned as-is.
    - Otherwise matched against the live-aircraft cache on callsign OR
      registration (e.g. 'ASA111' or 'N842UA' -> 'A1B2C3').
    - A tail number not currently airborne falls back to the airframe DB.
    - A US N-number is finally converted deterministically (N882SD -> hex), so a
      tail that's never been tracked still resolves.
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
    if hex_code:
        return hex_code.upper()

    # Last resort: US N-numbers map deterministically to an ICAO hex, no data
    # needed. Covers tails never seen by the receiver or stored in any DB.
    from skyspy.services.nnumber import n_to_icao

    n_hex = n_to_icao(ident)
    return n_hex.upper() if n_hex else None


def fetch_airframe_photo(aircraft: str, force: bool = False) -> str:
    """Show/display a photo of an aircraft — call this to let the user SEE a plane,
    given its ICAO hex, tail number, or callsign/flight number (e.g. 'A1B2C3',
    'N882SD', 'ASA111'). This is the only way to display an image; the app renders
    it from this tool call, so do NOT write an image URL or a Markdown image
    yourself — just say the photo is shown and credit the photographer/source if
    returned. Set force=true to bypass the cache and re-download the image. Returns
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
    total = qs.count()
    rows = list(
        qs.order_by("-timestamp").values("event_type", "severity", "icao_hex", "callsign", "message", "timestamp")[:25]
    )
    return _json({"count": len(rows), "total_matching": total, "events": rows})


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


def _query_track_rows(hex_code: str, hours: int, points: int):
    """Fetch an aircraft's stored positions over the window, ordered oldest→newest
    and downsampled to at most ``points``. Returns (total_row_count, sampled_rows).
    Shared by aircraft_track (single, with behavior flags) and plot_tracks (many)."""
    from django.utils import timezone

    from skyspy.models import AircraftSighting

    since = timezone.now() - timezone.timedelta(hours=hours)
    rows = list(
        AircraftSighting.objects.filter(icao_hex=hex_code, timestamp__gte=since, latitude__isnull=False)
        .order_by("timestamp")
        .values("latitude", "longitude", "altitude_baro", "track", "vertical_rate", "timestamp")
    )
    n = max(10, min(200, int(points or 60)))
    # Ceil division so the downsampled track never exceeds the requested point count
    # (plain floor-div leaves step=1 when len(rows) is just above n, returning all rows).
    step = max(1, -(-len(rows) // n))
    return len(rows), rows[::step]


@_guarded
def aircraft_track(identifier: str, hours: int = 6, points: int = 60) -> str:
    """Reconstruct an aircraft's actual FLOWN PATH over the last N hours by ICAO
    hex, live callsign, or tail number. Returns an ordered, downsampled polyline
    (lat/lon/altitude/track/vertical_rate/time) the app draws on a map, plus
    derived behavior flags: orbit_or_loiter (circling/holding/survey), rapid_climb
    and rapid_descent. Use for 'is anything orbiting / loitering', 'trace this
    aircraft's path', or surveillance/holding-pattern questions. Empty track means
    no stored positions in the window."""
    hex_code = _resolve_to_hex(identifier)
    if not hex_code:
        return _json({"error": f"could not resolve '{identifier}' to an aircraft", "identifier": identifier})
    hrs = _clamp_hours(hours, hi=168)
    total, sampled = _query_track_rows(hex_code, hrs, points)
    track = [
        {
            "lat": r["latitude"],
            "lon": r["longitude"],
            "altitude": r["altitude_baro"],
            "track": r["track"],
            "vertical_rate": r["vertical_rate"],
            "ts": r["timestamp"],
        }
        for r in sampled
    ]
    return _json(
        {
            "identifier": identifier,
            "icao_hex": hex_code,
            "hours": hrs,
            "point_count": total,
            "pattern": _track_pattern(track),
            "track": track,
        }
    )


@_guarded
def plot_tracks(identifiers: str, hours: int = 6) -> str:
    """Plot the historical FLOWN PATHS of one OR MANY aircraft directly on the live
    RADAR SCREEN, over the last N hours. Pass a comma-separated list of ICAO hexes,
    tail numbers, and/or live callsigns (e.g. 'N882SD, A1B2C3, UAL123'). Each
    resolved aircraft's stored positions are drawn as a distinct coloured track on
    the radar, the map zooms to fit them all, and each track is labelled. Use this
    whenever the user wants to SEE where aircraft flew — 'plot N882SD's track',
    'show me the last 3 hours of these planes on the radar', 'draw the paths of
    every military aircraft from this morning', 'overlay their routes on the map'.
    For a single aircraft's path plus behaviour flags in the chat, use
    aircraft_track instead; use plot_tracks to render on the actual radar."""
    from skyspy.services import aircraft_info

    hrs = _clamp_hours(hours, hi=168)
    idents = [s.strip() for s in (identifiers or "").split(",") if s.strip()]
    if not idents:
        return _json({"error": "no identifiers given", "hint": "pass a comma-separated list of hex/tail/callsign"})
    idents = idents[:12]  # bound fan-out and keep the payload under the result cap

    tracks: dict[str, dict] = {}
    unresolved: list[str] = []
    empty: list[str] = []
    # Split a shared point budget across the resolved aircraft so the payload the
    # frontend receives (and the LLM-visible observation) stays under the char cap.
    per_track = max(10, min(80, 180 // max(1, len(idents))))
    for ident in idents:
        hex_code = _resolve_to_hex(ident)
        if not hex_code:
            unresolved.append(ident)
            continue
        _total, sampled = _query_track_rows(hex_code, hrs, per_track)
        pts = [
            [round(r["latitude"], 4), round(r["longitude"], 4), r["altitude_baro"]]
            for r in sampled
            if r["latitude"] is not None and r["longitude"] is not None
        ]
        if len(pts) < 2:
            empty.append(ident)
            continue
        info = aircraft_info.get_aircraft_info(hex_code) or {}
        label = (info.get("registration") or info.get("callsign") or ident).strip()
        tracks[hex_code.upper()] = {"cs": label, "pts": pts}

    if not tracks:
        return _json(
            {
                "error": "no stored positions to plot in the window",
                "hours": hrs,
                "unresolved": unresolved,
                "no_track": empty,
            }
        )
    label = f"Tracks: {', '.join(t['cs'] for t in tracks.values())}"
    return _json(
        {
            "label": label[:120],
            "hours": hrs,
            "count": len(tracks),
            "tracks": tracks,
            "view": "fit",
            "unresolved": unresolved or None,
            "no_track": empty or None,
        }
    )


@_guarded
def busiest_tails(hours: int = 24, limit: int = 15) -> str:
    """Rank the aircraft (tail numbers) that flew the MOST flights over the last N
    hours. "unique_flights" is the number of distinct callsigns/flight numbers that
    tail was seen using (what most people mean by "how many different flights");
    "flight_legs" is the number of separate flights split on >15-minute reception
    gaps (distinct takeoffs/passes over the station). Rows are ranked by
    unique_flights, then flight_legs. Use for 'which tail number has the most
    unique flights', 'busiest aircraft', 'which plane flew the most today'. Each
    row: registration (tail, may be null if unknown), icao_hex, aircraft_type,
    is_military, unique_flights, flight_legs, total_sightings, first_seen,
    last_seen."""
    from django.db.models import Count, Max, Min, Q
    from django.utils import timezone

    from skyspy.models import AircraftInfo, AircraftSighting
    from skyspy.services.flight_anomaly import _split_flights

    hours = _clamp_hours(hours, hi=720)
    limit = max(1, min(50, int(limit or 15)))
    since = timezone.now() - timezone.timedelta(hours=hours)

    # A real flight number is a non-blank callsign; count the distinct ones per tail.
    has_cs = Q(callsign__isnull=False) & ~Q(callsign="")
    ranked = list(
        AircraftSighting.objects.filter(timestamp__gte=since)
        .values("icao_hex")
        .annotate(
            unique_flights=Count("callsign", distinct=True, filter=has_cs),
            total_sightings=Count("id"),
            military_hits=Count("id", filter=Q(is_military=True)),
            aircraft_type=Max("aircraft_type"),
            first_seen=Min("timestamp"),
            last_seen=Max("timestamp"),
        )
        .order_by("-unique_flights", "-total_sightings")[:limit]
    )
    if not ranked:
        return _json({"hours": hours, "count": 0, "results": []})

    hexes = [r["icao_hex"] for r in ranked]
    # Flight legs (separate flights split on >15-min gaps) only for the ranked pool,
    # so the time-gap split stays bounded. One ordered query, grouped in Python.
    legs_by_hex: dict[str, int] = {}
    cur_hex: str | None = None
    buf: list[dict] = []

    def _flush(h: str | None, rows: list[dict]) -> None:
        if h is not None:
            legs_by_hex[h] = sum(1 for leg in _split_flights(rows) if leg)

    for row in (
        AircraftSighting.objects.filter(icao_hex__in=hexes, timestamp__gte=since)
        .order_by("icao_hex", "timestamp")
        .values("icao_hex", "timestamp")
    ):
        if row["icao_hex"] != cur_hex:
            _flush(cur_hex, buf)
            cur_hex, buf = row["icao_hex"], []
        buf.append(row)
    _flush(cur_hex, buf)

    regs = {
        i["icao_hex"]: i["registration"]
        for i in AircraftInfo.objects.filter(icao_hex__in=hexes).values("icao_hex", "registration")
    }
    results = [
        {
            "registration": (regs.get(r["icao_hex"]) or "").strip() or None,
            "icao_hex": r["icao_hex"],
            "aircraft_type": r["aircraft_type"] or None,
            "is_military": r["military_hits"] > 0,
            "unique_flights": r["unique_flights"],
            "flight_legs": legs_by_hex.get(r["icao_hex"], 0),
            "total_sightings": r["total_sightings"],
            "first_seen": r["first_seen"].isoformat() if r["first_seen"] else None,
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
        }
        for r in ranked
    ]
    return _json({"hours": hours, "count": len(results), "results": results})


@_guarded
def detect_unusual_patterns(hours: int = 6, limit: int = 15) -> str:
    """Scan recent flown tracks and return aircraft whose FLIGHT PATH is unusual —
    orbiting/holding, circling, grid or zig-zag survey lines, meandering, and
    especially the multi_orbit_survey shape (several tight orbits joined by long
    transit legs, typical of surveillance/aerial-survey work). Each hit has a
    pattern label, an unusualness score (higher = stranger), geometry metrics
    (loiter_count, revolutions, reversals, tortuosity, path/net nm) and a map-able
    center. Use for 'anything flying a strange/suspicious pattern', 'is anyone
    surveying/orbiting the area', or to explain an odd shape on the map. Drill into
    a specific hit with aircraft_track."""
    from skyspy.services import flight_anomaly

    return _json(flight_anomaly.scan_unusual_patterns(hours=_clamp_hours(hours, hi=168), limit=limit))


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
# Developer / API reference tools
# =============================================================================
#
# These let the assistant answer "how do I pull this data programmatically?" with
# the real REST endpoints and Socket.IO events instead of hallucinating them. The
# REST index is generated live from the OpenAPI schema (always accurate); the
# Socket.IO reference is a curated distillation of docs/SOCKETIO_API.md kept here
# so it ships with the app (the docs/ tree isn't guaranteed in the runtime image).

_REST_INDEX_CACHE_KEY = "assistant:rest_api_index"
_REST_INDEX_TTL = 3600  # URL map is static per deploy; refresh hourly
_REST_MAX_ENDPOINTS = 60  # cap the list so a full dump can't blow the result cap
_RE_NAMED_GROUP = re.compile(r"\(\?P<(\w+)>[^)]+\)")


def _clean_route(route: str) -> str:
    """Turn a Django route/regex into a readable path template:
    '^aircraft/(?P<pk>[^/.]+)/$' -> '/api/v1/aircraft/{pk}/'. Nested regex patterns
    each carry their own ^/$ anchors, so strip every anchor, not just the ends."""
    route = _RE_NAMED_GROUP.sub(lambda m: "{" + m.group(1) + "}", route)
    route = route.replace("^", "").replace("$", "")
    return "/" + route.lstrip("/")


def _rest_index() -> list[dict]:
    """Walk the URL resolver for /api/v1/ endpoints, returning a compact
    [{method, path, summary}] list. Introspects the URLconf directly (robust) so it
    doesn't depend on OpenAPI schema generation, which needs serializer traversal."""
    from django.urls import get_resolver
    from django.urls.resolvers import URLResolver

    out, seen = [], set()

    def walk(resolver, prefix=""):
        for p in resolver.url_patterns:
            route = prefix + str(getattr(p.pattern, "_route", p.pattern))
            if isinstance(p, URLResolver):
                walk(p, route)
                continue
            # Skip non-API routes and the format-suffixed (.json/.api) duplicates.
            if not route.startswith("api/v1/") or "(?P<format>" in route:
                continue
            cb = p.callback
            acts = getattr(cb, "actions", None)  # DRF router: {http_method: action}
            cls = getattr(cb, "cls", None)  # the ViewSet / APIView class
            if acts:
                methods = sorted(m.upper() for m in acts)
                summary = "/".join(sorted(set(acts.values())))
            elif cls:
                methods = sorted(
                    m.upper()
                    for m in getattr(cls, "http_method_names", [])
                    if hasattr(cls, m) and m not in ("options", "head", "trace")
                )
                doc = (cls.__doc__ or cls.__name__).strip().splitlines()
                summary = doc[0].strip()[:100] if doc else cls.__name__
            else:
                continue
            if not methods:
                continue
            path = _clean_route(route)
            key = (path, tuple(methods))
            if key in seen:
                continue
            seen.add(key)
            out.append({"method": ",".join(methods), "path": path, "summary": summary})

    walk(get_resolver())
    out.sort(key=lambda e: e["path"])
    return out


@_guarded
def rest_api_reference(topic: str = "") -> str:
    """Look up SkySpy's REST API so you can tell a developer how to pull data
    programmatically over HTTP. Returns a compact index of /api/v1/ endpoints
    (method, path, and the action/summary) introspected live from the URL map, so
    it's always accurate. Pass a topic keyword (e.g. 'aircraft', 'acars', 'safety',
    'alerts', 'weather', 'stats') to filter; empty returns the index. Use for 'how
    do I get X via the API', 'REST endpoint for X', or 'is there an API for X'."""
    from django.core.cache import cache

    index = cache.get(_REST_INDEX_CACHE_KEY)
    if index is None:
        index = _rest_index()
        cache.set(_REST_INDEX_CACHE_KEY, index, _REST_INDEX_TTL)

    kw = (topic or "").strip().lower()
    matches = [e for e in index if kw in e["path"].lower() or kw in (e.get("summary") or "").lower()] if kw else index
    shown, more = matches[:_REST_MAX_ENDPOINTS], max(0, len(matches) - _REST_MAX_ENDPOINTS)
    return _json(
        {
            "base_url": "/api/v1/",
            "auth": "Bearer JWT or API key per AUTH_MODE (public may allow anon reads)",
            "docs": "OpenAPI schema at /api/schema/; interactive at /api/docs/ (Swagger) and /api/redoc/",
            "topic": topic or None,
            "count": len(matches),
            "endpoints": shown,
            "_more": more or None,
            "hint": "pass a topic keyword to narrow" if more else None,
        }
    )


# Curated Socket.IO reference (distilled from docs/SOCKETIO_API.md). Request-type
# and broadcast-event catalogs are keyed so a topic filter can trim them.
_SOCKETIO_REFERENCE = {
    "url": "wss://<host>/socket.io/ (Socket.IO protocol, not raw WebSocket)",
    "namespaces": ["/ (main)", "/audio", "/cannonball"],
    "auth": "io(url, {auth:{token}}) — JWT, or an API key (sk_-prefixed); anon allowed in AUTH_MODE=public",
    "subscribe": {
        "emit": "subscribe",
        "payload": {"topics": ["aircraft", "safety", "stats"]},
        "or": {"topics": "all"},
        "ack_event": "subscribed -> {topics, joined, denied}",
    },
    "topics": {
        "aircraft": "real-time positions (perm aircraft.view)",
        "safety": "safety alerts/events (safety.view)",
        "stats": "statistics updates (stats.view)",
        "alerts": "custom alert notifications (alerts.view)",
        "acars": "ACARS messages (acars.view)",
        "airspace": "airspace boundaries (airspace.view)",
        "notams": "NOTAMs and TFRs (notams.view)",
    },
    "request_response": {
        "emit": "request",
        "payload": {"type": "aircraft-snapshot", "request_id": "req-1", "params": {}},
        "reply_event": "response -> {request_id, request_type, data}",
        "error_event": "error -> {request_id, message}",
    },
    "request_types": {
        "aircraft": "one aircraft by params.icao",
        "aircraft-snapshot": "all current aircraft {aircraft[], count, timestamp}",
        "aircraft-list": "filtered list (military_only, category, min/max_altitude)",
        "aircraft-info": "detailed info by params.icao (reg, type, operator, owner, photo)",
        "aircraft-info-bulk": "info for params.icaos[] (max 100)",
        "aircraft-stats": "live counts by category/altitude band",
        "sightings": "historical sightings (params.hours)",
        "history-stats": "history statistics",
        "history-trends": "traffic trends over time",
        "notam-snapshot": "full NOTAMs + TFRs + stats",
        "airport": "NOTAMs for params.icao airport",
        "safety-snapshot": "safety events snapshot",
        "alert-snapshot": "alert history snapshot",
        "acars-snapshot": "ACARS messages snapshot",
        "safety-events": "recent safety events (params.hours)",
        "safety-acknowledge": "acknowledge a safety event",
        "airports": "nearby airports",
        "airspace-boundaries": "airspace boundary geometry",
        "airspaces": "advisories (G-AIRMETs, SIGMETs)",
        "pireps": "pilot reports",
        "metar": "single METAR by airport",
        "taf": "single TAF by airport",
        "status": "system status",
        "system-info": "system information",
        "alert-rules": "list/create/update/delete rules (alert-rule-*)",
        "notification-channels": "list/create/test channels (notification-channel-*)",
    },
    "broadcast_events": {
        "positions:update": "aircraft topic — real-time positions (10+ Hz)",
        "aircraft:update": "aircraft — full aircraft state (10 Hz)",
        "aircraft:new": "aircraft — new aircraft appeared",
        "aircraft:remove": "aircraft — aircraft removed",
        "aircraft:heartbeat": "aircraft — periodic count (~5s)",
        "safety:event": "safety — new safety event",
        "safety:event_updated": "safety — event acknowledged/updated",
        "safety:event_resolved": "safety — event cleared",
        "stats:update": "stats — statistics (0.5 Hz)",
        "alert:triggered": "alerts — custom alert fired",
        "acars:message": "acars — new ACARS message",
        "airspace:advisory": "airspace — advisory update",
        "notam:new": "notams — new NOTAM (also notam:tfr_new/update/expired/stats)",
        "antenna:analytics_update": "aircraft — antenna polar/RSSI analytics",
    },
    "example": (
        "const s = io('https://host', {auth:{token}}); "
        "s.on('connect', () => s.emit('subscribe', {topics:['aircraft']})); "
        "s.on('positions:update', d => ...); "
        "s.emit('request', {type:'aircraft-snapshot', request_id:'1', params:{}}); "
        "s.on('response', r => console.log(r.data));"
    ),
}


@_guarded
def socketio_reference(topic: str = "") -> str:
    """Look up SkySpy's real-time Socket.IO API so you can tell a developer how to
    stream/pull live data over WebSocket. Returns the namespaces, auth, subscribe
    topics, the request/response query pattern with its request-type catalog, and
    the server broadcast events. Pass a topic keyword (e.g. 'aircraft', 'acars',
    'safety', 'alerts', 'notam') to filter the request-types/events; empty returns
    the whole reference. Use for 'how do I subscribe to updates', 'websocket/
    Socket.IO format', or 'what does the live feed emit'."""
    ref = dict(_SOCKETIO_REFERENCE)
    kw = (topic or "").strip().lower()
    if kw:
        ref["request_types"] = {k: v for k, v in ref["request_types"].items() if kw in k.lower() or kw in v.lower()}
        ref["broadcast_events"] = {
            k: v for k, v in ref["broadcast_events"].items() if kw in k.lower() or kw in v.lower()
        }
        ref["topic"] = topic
    return _json(ref)


# =============================================================================
# Location / personal / schedule tools
# =============================================================================


@_guarded
def weather_nearby() -> str:
    """Current weather AT THE RECEIVER: finds the nearest airport with a METAR and
    returns its latest observation (wind, visibility, ceiling, temp, flight
    category VFR/MVFR/IFR/LIFR). Use for 'how's the weather', 'is it VFR here', or
    'weather near me' when no airport is named — for a specific airport use
    airport_weather instead."""
    from django.conf import settings

    from skyspy.services import geodata, weather_cache

    lat, lon = getattr(settings, "FEEDER_LAT", None), getattr(settings, "FEEDER_LON", None)
    if lat is None or lon is None:
        return _json({"error": "receiver location (FEEDER_LAT/LON) not configured"})
    airports = geodata.get_cached_airports(float(lat), float(lon), radius_nm=60, limit=200) or []
    # Nearest airport that actually has an ICAO id we can query for a METAR.
    from skyspy.services.geodata import haversine_nm

    airports = [a for a in airports if a.get("icaoId") and a.get("lat") is not None]
    airports.sort(key=lambda a: haversine_nm(float(lat), float(lon), a["lat"], a["lon"]))
    for apt in airports[:5]:
        metars = weather_cache.fetch_metar_by_station(apt["icaoId"], hours=3) or []
        if metars:
            dist = round(haversine_nm(float(lat), float(lon), apt["lat"], apt["lon"]), 1)
            return _json({"station": apt["icaoId"], "name": apt.get("name"), "distance_nm": dist, "metar": metars[0]})
    return _json({"error": "no nearby station with a current METAR", "airports_checked": len(airports[:5])})


@_guarded
def aircraft_dossier(identifier: str) -> str:
    """Full dossier for one aircraft (by ICAO hex, tail number, or live callsign):
    identity (reg, type, manufacturer, model, operator, owner, year), this station's
    sighting history (first/last seen, times seen, closest approach, max altitude),
    and any known incidents/accidents. Richer than lookup_airframe — use it for
    'tell me everything about ...' or a deep profile of a specific aircraft."""
    from skyspy.services.airframe_dossier import build_dossier

    hex_code = _resolve_to_hex(identifier)
    if not hex_code:
        return _json({"error": f"could not resolve '{identifier}' to an aircraft", "identifier": identifier})
    dossier = build_dossier(hex_code)
    if not dossier:
        return _json({"error": f"no dossier for {hex_code} (never tracked, not in any DB)", "icao_hex": hex_code})
    # Current turbulence risk if this aircraft is live and flagged (scorer cache).
    from django.core.cache import cache

    from skyspy.tasks.turbulence import CACHE_KEY_BY_HEX

    turb = (cache.get(CACHE_KEY_BY_HEX) or {}).get(hex_code.upper())
    if turb:
        dossier["turbulence"] = {"score": turb.get("score"), "level": turb.get("level")}
    # Drop the embedding-input blob; keep the structured sections for the model.
    dossier.pop("text", None)
    return _json(dossier)


@_guarded
def nearby_advisories() -> str:
    """Active airspace hazards NEAR THE RECEIVER: temporary flight restrictions
    (TFRs) plus SIGMETs / G-AIRMETs (turbulence, icing, IFR, convective) whose area
    covers the station. Use for 'any TFRs near me', 'flight restrictions nearby', or
    'active weather advisories / SIGMETs in the area'."""
    from django.conf import settings

    from skyspy.services import airspace, notams

    lat, lon = getattr(settings, "FEEDER_LAT", None), getattr(settings, "FEEDER_LON", None)
    if lat is None or lon is None:
        return _json({"error": "receiver location (FEEDER_LAT/LON) not configured"})
    lat, lon = float(lat), float(lon)
    tfrs = notams.get_tfrs(lat=lat, lon=lon, radius_nm=150, active_only=True) or []
    advisories = airspace.get_advisories(lat=lat, lon=lon) or []
    return _json(
        {
            "center": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "tfr_count": len(tfrs),
            "tfrs": [
                {"id": t.get("notam_id") or t.get("id"), "text": (t.get("text") or t.get("description"))}
                for t in tfrs[:10]
            ],
            "advisory_count": len(advisories),
            "advisories": [
                {"type": a.get("advisory_type"), "hazard": a.get("hazard"), "valid_to": a.get("valid_to")}
                for a in advisories[:15]
            ],
        }
    )


@_guarded
def turbulence_forecast(lat: float = 0.0, lon: float = 0.0, altitude_ft: int = 0) -> str:
    """Turbulence risk assessment. With no arguments: the current picture near the
    receiver — a risk score (0-100) + level (none/light/moderate/severe) at the
    station, the active G-AIRMET turbulence advisories, and any live aircraft the
    station is currently tracking that are flagged at moderate+ turbulence risk.
    Pass lat/lon (and optionally altitude_ft) to assess a specific point/flight
    level instead. Synthesizes NWS G-AIRMET forecast polygons, nearby pilot-report
    (PIREP) turbulence, and winds-aloft vertical shear. Use for 'is it bumpy',
    'any turbulence', 'will my flight be rough', or 'which aircraft are in
    turbulence'."""
    from django.conf import settings
    from django.core.cache import cache

    from skyspy.services.turbulence import assess_turbulence
    from skyspy.tasks.turbulence import CACHE_KEY_BY_HEX

    if not lat and not lon:
        lat = getattr(settings, "FEEDER_LAT", None)
        lon = getattr(settings, "FEEDER_LON", None)
        if lat is None or lon is None:
            return _json({"error": "receiver location (FEEDER_LAT/LON) not configured; pass lat/lon"})
    lat, lon = float(lat), float(lon)
    alt = int(altitude_ft) if altitude_ft else None

    assessment = assess_turbulence(lat, lon, alt)

    # Live aircraft currently flagged at moderate+ risk (from the scorer cache).
    by_hex = cache.get(CACHE_KEY_BY_HEX) or {}
    live = {(a.get("hex") or "").upper(): a for a in (cache.get("current_aircraft") or [])}
    at_risk = []
    for hex_code, risk in by_hex.items():
        if risk.get("level") in ("moderate", "severe"):
            ac = live.get(hex_code, {})
            at_risk.append(
                {
                    "hex": hex_code,
                    "callsign": (ac.get("flight") or "").strip() or None,
                    "altitude": ac.get("alt_baro"),
                    "score": risk.get("score"),
                    "level": risk.get("level"),
                }
            )
    at_risk.sort(key=lambda a: a.get("score") or 0, reverse=True)

    return _json(
        {
            "point": {"lat": round(lat, 4), "lon": round(lon, 4), "altitude_ft": alt},
            "assessment": assessment,
            "aircraft_at_risk_count": len(at_risk),
            "aircraft_at_risk": at_risk[:15],
        }
    )


@_guarded
def enroute_structure(lat: float = 0.0, lon: float = 0.0, radius_nm: int = 75) -> str:
    """US enroute structure — published IFR airways plus named waypoints/fixes —
    near a point, defaulting to the receiver. Returns the airway designators (e.g.
    'V23', 'J100') and fix idents (e.g. 'ADAMM') in the area from FAA reference data.
    Use for 'what airways/waypoints are near me', 'which airways cross the area', or
    to explain a flight's routing over named fixes. Pass lat/lon to center elsewhere.
    US-only (empty away from US coverage)."""
    from django.conf import settings

    from skyspy.services import geodata

    if not lat and not lon:
        lat = getattr(settings, "FEEDER_LAT", None)
        lon = getattr(settings, "FEEDER_LON", None)
    if lat is None or lon is None:
        return _json({"error": "receiver location (FEEDER_LAT/LON) not configured"})
    lat, lon = float(lat), float(lon)
    r = max(1, min(250, int(radius_nm or 75)))

    def _ident(f):
        props = f.get("properties") or {}
        return props.get("IDENT") or props.get("name")

    airways = geodata.get_cached_geojson("us_airways", lat=lat, lon=lon, radius_nm=r)
    fixes = geodata.get_cached_geojson("us_fixes", lat=lat, lon=lon, radius_nm=r)
    awy = sorted({i for f in airways if (i := _ident(f))})
    fix = sorted({i for f in fixes if (i := _ident(f))})
    return _json(
        {
            "center": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "radius_nm": r,
            "airway_count": len(awy),
            "airways": awy[:60],
            "fix_count": len(fix),
            "fixes": fix[:80],
        }
    )


@_guarded
def watched_aircraft() -> str:
    """The station's watch list: aircraft flagged to keep an eye on, each with an
    indicator of whether it's LIVE right now (in current traffic). Use for 'what's
    on the watch list', 'any watched aircraft up right now', or 'am I watching
    anything'. This list is station-wide (shared), not per-user."""
    from django.core.cache import cache

    from skyspy.models.watch_list import WatchedAircraft

    watched = list(WatchedAircraft.objects.all().order_by("-added_at")[:100])
    if not watched:
        return _json({"count": 0, "watched": [], "note": "watch list is empty"})
    live_hexes = {(a.get("hex") or "").upper() for a in (cache.get("current_aircraft") or [])}
    rows = [
        {
            "hex": w.hex,
            "callsign": w.callsign or None,
            "registration": w.registration or None,
            "type": w.type_code or None,
            "notes": w.notes or None,
            "live_now": w.hex.upper() in live_hexes,
        }
        for w in watched
    ]
    return _json({"count": len(rows), "live_now": sum(r["live_now"] for r in rows), "watched": rows})


@_guarded
def my_alert_rules() -> str:
    """The CURRENT USER's custom alert rules: what they've configured SkySpy to
    alert on, each with whether it's enabled, its priority, and when it last fired.
    Use for 'what am I alerting on', 'show my alerts', 'are my alerts working', or
    'did any of my alerts trigger'. Requires a signed-in user; returns a note if
    anonymous."""
    user = _get_user()
    if user is None:
        return _json({"error": "no signed-in user; alert rules are per-user", "rules": []})
    from skyspy.models.alerts import AlertRule

    rules = list(AlertRule.objects.filter(owner=user).order_by("-enabled", "name")[:50])
    return _json(
        {
            "count": len(rules),
            "enabled": sum(1 for r in rules if r.enabled),
            "rules": [
                {
                    "name": r.name,
                    "type": r.rule_type,
                    "operator": r.operator,
                    "value": r.value,
                    "priority": r.priority,
                    "enabled": r.enabled,
                    "last_triggered": r.last_triggered.strftime("%Y-%m-%dT%H:%M:%SZ") if r.last_triggered else None,
                }
                for r in rules
            ],
        }
    )


@_guarded
def flight_schedule(callsign: str) -> str:
    """Scheduled airline flight info for a callsign/flight number (e.g. 'UAL123'):
    origin/destination airport, scheduled and estimated departure/arrival times, and
    status. Use for 'when does flight X land', 'is X delayed', or schedule questions.
    Backed by a metered external API (AviationStack) — off unless configured; returns
    a note when unavailable. For the origin/dest of a LIVE aircraft, prefer
    lookup_route (no quota)."""
    from skyspy.services import aviationstack

    cs = (callsign or "").strip().upper()
    if not cs:
        return _json({"error": "callsign required"})
    if not aviationstack._is_enabled():
        return _json({"error": "flight schedules not configured (AVIATIONSTACK_ENABLED off)", "callsign": cs})
    data = aviationstack.get_flight_by_callsign(cs)
    if not data:
        return _json({"callsign": cs, "found": False, "note": "no scheduled flight matched"})
    return _json({"callsign": cs, "found": True, "flight": data})


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
    radar_filter,
    airport_weather,
    recent_pireps,
    nearby_wildfires,
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
    plot_tracks,
    busiest_tails,
    detect_unusual_patterns,
    identify_law_enforcement,
    threat_assessment,
    rest_api_reference,
    socketio_reference,
    weather_nearby,
    aircraft_dossier,
    nearby_advisories,
    turbulence_forecast,
    enroute_structure,
    watched_aircraft,
    my_alert_rules,
    flight_schedule,
]


def _short_description(doc: str | None) -> str:
    """First sentence of a tool docstring, whitespace-collapsed and length-capped —
    the compact-mode tool description, so all tool schemas fit a small window."""
    text = " ".join((doc or "").split())
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    first = m.group(1) if m else text
    return first[:200]


def get_tools(compact: bool = False) -> list:
    """Wrap the plain functions as LangChain StructuredTools (lazy import so this
    module stays importable/testable without LangChain installed).

    In ``compact`` mode each tool's description is trimmed to its first sentence so
    the combined tool schemas don't overflow a small-context model."""
    from langchain_core.tools import StructuredTool

    tools = []
    for fn in TOOL_FUNCS:
        if compact:
            tools.append(StructuredTool.from_function(fn, description=_short_description(fn.__doc__)))
        else:
            tools.append(StructuredTool.from_function(fn))
    return tools
