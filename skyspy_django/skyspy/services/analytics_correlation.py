"""Cross-correlation analytics over AircraftSighting telemetry and per-aircraft
cross-domain activity.

Powers the Advanced Analytics screen:
- build-your-own scatter: any numeric field pair -> plotted points + Pearson r
  + least-squares regression line
- correlation matrix: pairwise Pearson r across all numeric fields
- cross-domain rollup: per-aircraft counts linking sightings <-> alerts <->
  safety events <-> ACARS, enriched with AircraftInfo (type/operator)

Reuses the RPi sampling knobs (RPI_LITE_MODE / MAX_STATS_SAMPLE_SIZE) from
stats_cache to keep big AircraftSighting scans bounded, and caches results in
Redis (Django cache) like the other stats services.
"""

import logging
import math
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError
from django.db.models import Count
from django.db.models.functions import ExtractHour
from django.utils import timezone

from skyspy.models import (
    AcarsMessage,
    AircraftInfo,
    AircraftSighting,
    AlertHistory,
    SafetyEvent,
)

logger = logging.getLogger(__name__)

RPI_LITE_MODE = getattr(settings, "RPI_LITE_MODE", False)
MAX_STATS_SAMPLE_SIZE = getattr(settings, "MAX_STATS_SAMPLE_SIZE", 5000)

# Hard cap on rows pulled for a scatter/matrix computation, independent of lite
# mode, so a busy feeder can never OOM the worker.
ANALYTICS_MAX_ROWS = getattr(settings, "ANALYTICS_MAX_ROWS", 20000)
# Max points serialized back to the client for a scatter plot.
ANALYTICS_MAX_POINTS = 200

CACHE_TTL = 180  # seconds

# Correlatable numeric fields. "hour" is derived from timestamp via ExtractHour;
# the rest are direct AircraftSighting columns. Field keys are the ONLY values
# accepted from the client -- unknown keys are rejected (no arbitrary column access).
CORRELATABLE_FIELDS = {
    "altitude_baro": {"label": "Altitude", "unit": "ft"},
    "ground_speed": {"label": "Ground Speed", "unit": "kts"},
    "distance_nm": {"label": "Distance", "unit": "nm"},
    "rssi": {"label": "Signal (RSSI)", "unit": "dBFS"},
    "vertical_rate": {"label": "Vertical Rate", "unit": "ft/min"},
    "hour": {"label": "Hour of Day", "unit": "h"},
}


def field_labels():
    """List of {key, label, unit} for every correlatable field (UI dropdowns)."""
    return [{"key": k, "label": v["label"], "unit": v["unit"]} for k, v in CORRELATABLE_FIELDS.items()]


def is_valid_field(field):
    """True if ``field`` is a known correlatable field key."""
    return field in CORRELATABLE_FIELDS


def _row_cap():
    return MAX_STATS_SAMPLE_SIZE if RPI_LITE_MODE else ANALYTICS_MAX_ROWS


def _cache_key(prefix, **kw):
    parts = ":".join(f"{k}={kw[k]}" for k in sorted(kw))
    return f"analytics:{prefix}:{parts}"


def _base_queryset(hours, *, military=None, category=None):
    cutoff = timezone.now() - timedelta(hours=hours)
    qs = AircraftSighting.objects.filter(timestamp__gte=cutoff)
    if military is not None:
        qs = qs.filter(is_military=military)
    if category:
        qs = qs.filter(category=category)
    return qs


def _values_for(fields, hours, *, military=None, category=None):
    """Recent, bounded rows projecting the requested field keys (nulls kept;
    callers clean pairwise)."""
    qs = _base_queryset(hours, military=military, category=category)
    if "hour" in fields:
        qs = qs.annotate(hour=ExtractHour("timestamp"))
    return list(qs.order_by("-timestamp").values(*fields)[: _row_cap()])


def _clean_pair(rows, fx, fy):
    """Extract two aligned numeric series, dropping rows where either is null."""
    xs, ys = [], []
    for r in rows:
        a, b = r.get(fx), r.get(fy)
        if a is not None and b is not None:
            xs.append(a)
            ys.append(b)
    return xs, ys


def _pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    syy = sum(y * y for y in ys)
    sxy = sum(x * y for x, y in zip(xs, ys, strict=True))
    denom = math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
    if denom == 0:
        return None
    return (n * sxy - sx * sy) / denom


def _linregress(xs, ys):
    n = len(xs)
    if n < 2:
        return None, None
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys, strict=True))
    denom = n * sxx - sx * sx
    if denom == 0:
        return None, None
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def _downsample(pairs, limit):
    """Evenly thin a list of (x, y) tuples down to at most ``limit`` points."""
    if len(pairs) <= limit:
        return [{"x": x, "y": y} for x, y in pairs]
    step = len(pairs) // limit + 1
    return [{"x": pairs[i][0], "y": pairs[i][1]} for i in range(0, len(pairs), step)][:limit]


def scatter_correlation(x_field, y_field, hours=24, *, military=None, category=None):
    """Scatter points + Pearson r + regression for a numeric field pair.

    Raises ValueError on an unknown field key.
    """
    if not is_valid_field(x_field) or not is_valid_field(y_field):
        raise ValueError(f"unknown correlation field: {x_field!r}/{y_field!r}")

    key = _cache_key("scatter", x=x_field, y=y_field, h=hours, mil=military, cat=category or "")
    cached = cache.get(key)
    if cached is not None:
        return cached

    meta = {
        "x_field": x_field,
        "y_field": y_field,
        "x_label": CORRELATABLE_FIELDS[x_field]["label"],
        "y_label": CORRELATABLE_FIELDS[y_field]["label"],
        "x_unit": CORRELATABLE_FIELDS[x_field]["unit"],
        "y_unit": CORRELATABLE_FIELDS[y_field]["unit"],
        "time_range_hours": hours,
    }
    try:
        rows = _values_for([x_field, y_field], hours, military=military, category=category)
    except DatabaseError:
        logger.warning("scatter_correlation query failed", exc_info=True)
        return {**meta, "points": [], "r": None, "slope": None, "intercept": None, "n": 0, "sampled": False}

    xs, ys = _clean_pair(rows, x_field, y_field)
    r = _pearson(xs, ys)
    slope, intercept = _linregress(xs, ys)
    result = {
        **meta,
        "points": _downsample(list(zip(xs, ys, strict=True)), ANALYTICS_MAX_POINTS),
        "r": round(r, 3) if r is not None else None,
        "slope": round(slope, 6) if slope is not None else None,
        "intercept": round(intercept, 3) if intercept is not None else None,
        "n": len(xs),
        "sampled": len(rows) >= _row_cap(),
    }
    cache.set(key, result, CACHE_TTL)
    return result


def correlation_matrix(hours=24, *, military=None, category=None):
    """Pairwise Pearson r across every numeric field (listwise-clean per cell)."""
    key = _cache_key("matrix", h=hours, mil=military, cat=category or "")
    cached = cache.get(key)
    if cached is not None:
        return cached

    fields = list(CORRELATABLE_FIELDS.keys())
    try:
        rows = _values_for(fields, hours, military=military, category=category)
    except DatabaseError:
        logger.warning("correlation_matrix query failed", exc_info=True)
        return {"fields": field_labels(), "matrix": [], "n": 0, "time_range_hours": hours}

    matrix = []
    for fx in fields:
        line = []
        for fy in fields:
            if fx == fy:
                line.append(1.0)
                continue
            xs, ys = _clean_pair(rows, fx, fy)
            r = _pearson(xs, ys)
            line.append(round(r, 3) if r is not None else None)
        matrix.append(line)

    result = {
        "fields": field_labels(),
        "matrix": matrix,
        "n": len(rows),
        "sampled": len(rows) >= _row_cap(),
        "time_range_hours": hours,
    }
    cache.set(key, result, CACHE_TTL)
    return result


def _counts_by_hex(qs, field="icao_hex"):
    return {row[field]: row["c"] for row in qs.values(field).annotate(c=Count("id")) if row[field]}


def cross_domain_by_aircraft(hours=24, *, limit=25):
    """Per-aircraft rollup joining sightings/alerts/safety/ACARS, ranked by
    cross-domain activity, enriched with AircraftInfo. Returns top ``limit``."""
    key = _cache_key("cross_domain", h=hours, limit=limit)
    cached = cache.get(key)
    if cached is not None:
        return cached

    empty = {"aircraft": [], "total": 0, "time_range_hours": hours}
    cutoff = timezone.now() - timedelta(hours=hours)
    try:
        alerts = _counts_by_hex(AlertHistory.objects.filter(triggered_at__gte=cutoff))
        acars = _counts_by_hex(AcarsMessage.objects.filter(timestamp__gte=cutoff))

        # Safety events reference two aircraft (proximity conflicts); count both.
        safety = _counts_by_hex(SafetyEvent.objects.filter(timestamp__gte=cutoff))
        for hex_, c in _counts_by_hex(
            SafetyEvent.objects.filter(timestamp__gte=cutoff).exclude(icao_hex_2__isnull=True).exclude(icao_hex_2=""),
            field="icao_hex_2",
        ).items():
            safety[hex_] = safety.get(hex_, 0) + c

        # Rank candidates by weighted cross-domain activity, then take the top N
        # before the (more expensive) sightings + info enrichment.
        candidates = set(alerts) | set(acars) | set(safety)
        shortlist = sorted(
            candidates,
            key=lambda h: safety.get(h, 0) * 3 + alerts.get(h, 0) * 2 + acars.get(h, 0),
            reverse=True,
        )[:limit]

        sightings = _counts_by_hex(AircraftSighting.objects.filter(timestamp__gte=cutoff, icao_hex__in=shortlist))
        info = {i.icao_hex: i for i in AircraftInfo.objects.filter(icao_hex__in=shortlist)}
    except DatabaseError:
        logger.warning("cross_domain_by_aircraft query failed", exc_info=True)
        return empty

    rows = []
    for hex_ in shortlist:
        meta = info.get(hex_)
        rows.append(
            {
                "icao_hex": hex_,
                "registration": getattr(meta, "registration", None),
                "type_code": getattr(meta, "type_code", None),
                "operator": getattr(meta, "operator", None),
                "is_military": bool(getattr(meta, "is_military", False)),
                "sightings": sightings.get(hex_, 0),
                "alerts": alerts.get(hex_, 0),
                "safety_events": safety.get(hex_, 0),
                "acars": acars.get(hex_, 0),
            }
        )

    result = {"aircraft": rows, "total": len(rows), "time_range_hours": hours}
    cache.set(key, result, CACHE_TTL)
    return result
