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
from typing import Any

logger = logging.getLogger(__name__)

# Hard cap on any single tool result so a big analytics dict can't blow the
# model's context window.
_MAX_RESULT_CHARS = 6000


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
    if len(text) > _MAX_RESULT_CHARS:
        text = text[:_MAX_RESULT_CHARS] + '…","_truncated":true}'
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
    unique aircraft/flights, messages per hour, and the top message label."""
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
    collection_stats,
    live_traffic_summary,
    lookup_airframe,
    lookup_route,
    find_sightings,
    find_safety_events,
    find_incidents,
    semantic_airframe_search,
]


def get_tools() -> list:
    """Wrap the plain functions as LangChain StructuredTools (lazy import so this
    module stays importable/testable without LangChain installed)."""
    from langchain_core.tools import StructuredTool

    return [StructuredTool.from_function(fn) for fn in TOOL_FUNCS]
