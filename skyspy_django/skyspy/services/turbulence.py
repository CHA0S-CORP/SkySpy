"""
Per-aircraft turbulence risk synthesis.

Stateless service that combines three data sources already flowing through the
backend into a single turbulence risk score for a point in space (an aircraft's
lat/lon/altitude):

1. G-AIRMET turbulence forecast polygons (``AirspaceAdvisory``, hazard TURB*),
   read via :func:`skyspy.services.airspace.get_advisories`.
2. PIREP turbulence pilot reports (``CachedPirep``), read via
   :func:`skyspy.services.weather_cache.get_cached_pireps`.
3. Winds-aloft vertical wind shear (best-effort; AWC frequently serves raw FB
   text with no JSON, so :func:`weather_cache.fetch_winds_aloft` usually returns
   an empty list — the shear component then contributes nothing rather than
   penalizing the score).

No shapely (unavailable in this env); point-in-polygon is a hand-rolled
ray-cast with a bounding-box fast-path reusing ``airspace._polygon_bounds``.

Results are cached in Redis on a coarse lat/lon/altitude grid so many aircraft
in the same area share one computation (the periodic scorer in
``tasks/turbulence.py`` relies on this to stay cheap).
"""

import logging

from django.conf import settings
from django.core.cache import cache

from skyspy.services import airspace
from skyspy.services.pirep_decoder import TURBULENCE_CODES
from skyspy.services.weather_cache import fetch_winds_aloft, get_cached_pireps

logger = logging.getLogger(__name__)

# Grid-cache rounding. Aircraft within ~0.1 deg (~6nm) and the same 5000ft
# altitude band share a cached assessment. The TTL is configurable
# (TURB_GRID_TTL) since it bounds how long an expired G-AIRMET keeps scoring.
_GRID_LATLON_ROUND = 1  # decimal places
_ALT_BAND_FT = 5000


def _cfg(name: str, default):
    return getattr(settings, name, default)


def _grid_ttl() -> int:
    return int(_cfg("TURB_GRID_TTL", 120))


# --- geometry ---------------------------------------------------------------


def _point_in_polygon(lon: float, lat: float, polygon) -> bool:
    """Ray-casting point-in-polygon test against a GeoJSON Polygon dict.

    ``polygon`` is ``{"type": "Polygon", "coordinates": [ring, ...]}`` with each
    ring a list of ``[lon, lat]`` pairs (the shape G-AIRMET advisories are
    stored in). A cheap bounding-box rejection runs first. Advisories with no
    usable geometry return ``False`` here (callers decide how to treat them).
    """
    bounds = airspace._polygon_bounds(polygon)
    if bounds is None:
        return False
    min_lon, min_lat, max_lon, max_lat = bounds
    if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
        return False

    if not isinstance(polygon, dict):
        return False
    rings = polygon.get("coordinates") or []
    if not rings:
        return False
    ring = rings[0]  # exterior ring; G-AIRMET areas are simple polygons
    # Guard against a non-Polygon geometry (e.g. a LineString stored with a flat
    # [[lon,lat], ...] coordinate list): rings[0] would then be a single [lon,lat]
    # pair of floats, and ring[i][0] below would raise TypeError — and since
    # _score_gairmet has no per-advisory try/except, one malformed advisory would
    # kill the whole turbulence assessment. Require a ring of coordinate pairs.
    if (
        not isinstance(ring, (list, tuple))
        or len(ring) < 3
        or not all(isinstance(pt, (list, tuple)) and len(pt) >= 2 for pt in ring)
    ):
        return False
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _altitude_overlaps(alt_ft, lower_ft, upper_ft, pad_ft=2000) -> bool:
    """Whether ``alt_ft`` falls within [lower, upper] (padded). Missing bounds
    are treated as open (an advisory without an altitude band applies)."""
    if alt_ft is None:
        return True
    lo = (lower_ft if lower_ft is not None else 0) - pad_ft
    hi = (upper_ft if upper_ft is not None else 60000) + pad_ft
    return lo <= alt_ft <= hi


# --- component scorers ------------------------------------------------------

# G-AIRMET severity string -> score contribution
_GAIRMET_SEVERITY_SCORE = {
    "SEV": 90,
    "MOD-SEV": 78,
    "MOD": 60,
    "LGT-MOD": 45,
    "LGT": 32,
}
# Score for a TURB advisory that carries no severity string. Kept below the
# moderate band threshold (TURB_LEVEL_MODERATE default 45) so an unqualified
# advisory reads as "light" rather than auto-flagging every point as moderate.
_GAIRMET_SEVERITY_DEFAULT = 40


def _score_gairmet(lat: float, lon: float, alt_ft) -> tuple[int, list[dict]]:
    """Max score from any active G-AIRMET TURB polygon containing the point."""
    advisories = airspace.get_advisories(lat=lat, lon=lon)
    best = 0
    hits: list[dict] = []
    for adv in advisories:
        hazard = (adv.get("hazard") or "").upper()
        if not hazard.startswith("TURB"):
            continue
        if not _altitude_overlaps(alt_ft, adv.get("lower_alt_ft"), adv.get("upper_alt_ft")):
            continue
        if not _point_in_polygon(lon, lat, adv.get("polygon")):
            continue
        severity = (adv.get("severity") or "").upper()
        base = _GAIRMET_SEVERITY_SCORE.get(severity, _GAIRMET_SEVERITY_DEFAULT)
        if hazard == "TURB-HI":
            base = min(100, base + 8)
        best = max(best, base)
        hits.append(
            {
                "advisory_id": adv.get("advisory_id"),
                "hazard": hazard,
                "severity": severity or None,
                "lower_alt_ft": adv.get("lower_alt_ft"),
                "upper_alt_ft": adv.get("upper_alt_ft"),
            }
        )
    return best, hits


def _score_pireps(lat: float, lon: float, alt_ft) -> tuple[int, list[dict]]:
    """Distance/recency/altitude-weighted score from nearby turbulence PIREPs."""
    radius = float(_cfg("TURB_PIREP_RADIUS_NM", 150))
    hours = int(_cfg("TURB_PIREP_HOURS", 3))
    pireps = get_cached_pireps(lat=lat, lon=lon, radius_nm=radius, hours=hours, limit=50)

    best = 0.0
    hits: list[dict] = []
    for p in pireps:
        turb_type = (p.get("turbType") or "").upper()
        info = TURBULENCE_CODES.get(turb_type)
        if not info or info["level"] <= 0:
            continue
        # Base by reported intensity level (0-6) -> 0-100.
        base = min(100.0, info["level"] / 6.0 * 100.0)

        # Distance falloff (linear to zero at radius).
        dist = p.get("distance_nm")
        if dist is None:
            dist = radius
        dist_w = max(0.0, 1.0 - (dist / radius))

        # Altitude proximity: full weight within band, tapering to 0.4 at 6000ft.
        alt_w = 1.0
        if alt_ft is not None:
            base_ft = p.get("turbulence_base_ft")
            top_ft = p.get("turbulence_top_ft")
            pa = p.get("altFt")
            ref_lo = base_ft if base_ft is not None else (pa if pa is not None else None)
            ref_hi = top_ft if top_ft is not None else (pa if pa is not None else None)
            if ref_lo is not None and ref_hi is not None:
                if ref_lo <= alt_ft <= ref_hi:
                    alt_w = 1.0
                else:
                    gap = min(abs(alt_ft - ref_lo), abs(alt_ft - ref_hi))
                    alt_w = max(0.4, 1.0 - gap / 6000.0)

        contribution = base * dist_w * alt_w
        if contribution > best:
            best = contribution
        # List every PIREP that actually contributed to the score (level >= 1,
        # matching the scoring gate above) so the "why" panel explains the value
        # instead of silently omitting a light report that raised it.
        if dist_w > 0 and info["level"] >= 1:
            hits.append(
                {
                    "pirep_id": p.get("pirep_id"),
                    "turbType": turb_type,
                    "level": info["level"],
                    "label": info["label"],
                    "distance_nm": p.get("distance_nm"),
                    "altFt": p.get("altFt"),
                }
            )
    return int(round(best)), hits


def _score_winds_shear(lat: float, lon: float, alt_ft) -> tuple[int, dict | None]:
    """Best-effort shear score from winds aloft. Contributes 0 when AWC winds
    data is unavailable (the common case) so it never penalizes the score."""
    if alt_ft is None:
        return 0, None
    data = fetch_winds_aloft(lat, lon)
    # Upstream almost always yields [] (raw FB text, no JSON). Only a dict with
    # per-level wind vectors is usable; anything else is a no-op.
    if not isinstance(data, dict):
        return 0, None
    levels = data.get("data") or data.get("levels")
    if not isinstance(levels, list) or len(levels) < 2:
        return 0, None

    # Find the two levels bracketing the aircraft altitude and compute the
    # vector wind difference per 1000ft as a rough shear proxy.
    def _first(entry, *keys):
        # Explicit None checks: a legitimate 0 (calm wind, surface level) must
        # not be skipped the way `a or b` would drop a falsy-but-valid value.
        for k in keys:
            v = entry.get(k)
            if v is not None:
                return v
        return None

    def _lvl(entry):
        alt = _first(entry, "altitude", "alt_ft")
        if alt is None:
            fl = _first(entry, "fl")
            if fl is not None:
                # Flight level is hundreds of feet (FL340 = 34000ft); the rest
                # of this function works in feet, so convert before comparing.
                try:
                    alt = float(fl) * 100.0
                except (TypeError, ValueError):
                    alt = None
        spd = _first(entry, "wind_speed", "wspd", "speed")
        drc = _first(entry, "wind_dir", "wdir", "direction")
        try:
            return float(alt), float(spd), float(drc)
        except (TypeError, ValueError):
            return None

    parsed = [v for v in (_lvl(e) for e in levels) if v is not None]
    if len(parsed) < 2:
        return 0, None
    parsed.sort(key=lambda v: v[0])

    lower = upper = None
    for entry in parsed:
        if entry[0] <= alt_ft:
            lower = entry
        elif upper is None:
            upper = entry
            break
    if lower is None or upper is None:
        return 0, None

    import math

    (a0, s0, d0), (a1, s1, d1) = lower, upper
    u0, v0 = s0 * math.sin(math.radians(d0)), s0 * math.cos(math.radians(d0))
    u1, v1 = s1 * math.sin(math.radians(d1)), s1 * math.cos(math.radians(d1))
    vec = math.hypot(u1 - u0, v1 - v0)
    dz = max(1000.0, a1 - a0)
    shear_per_kft = vec / (dz / 1000.0)

    # ~6kt/1000ft is notable shear; scale to a modest bonus capped at 40.
    score = min(40, int(shear_per_kft / 6.0 * 40))
    return score, {"shear_kt_per_kft": round(shear_per_kft, 1)}


# --- public API -------------------------------------------------------------


def _level_for_score(score: int) -> str:
    light = int(_cfg("TURB_LEVEL_LIGHT", 20))
    moderate = int(_cfg("TURB_LEVEL_MODERATE", 45))
    severe = int(_cfg("TURB_LEVEL_SEVERE", 70))
    if score >= severe:
        return "severe"
    if score >= moderate:
        return "moderate"
    if score >= light:
        return "light"
    return "none"


def assess_turbulence(lat: float, lon: float, altitude_ft=None) -> dict:
    """Assess turbulence risk at a point.

    Returns ``{"score": 0-100, "level": none|light|moderate|severe,
    "sources": {"gairmet": [...], "pireps": [...], "winds": {...}|None}}``.
    """
    if lat is None or lon is None:
        return {"score": 0, "level": "none", "sources": {}}

    # Key the altitude band on None distinctly from band 0 (0-4999ft): a
    # None-altitude assessment disables pirep alt-weighting + shear, so it must
    # not share a grid cell with real low-altitude aircraft (else whoever hits
    # the cell first pins its altitude-specific score onto everyone in the band).
    alt_band = "na" if altitude_ft is None else int(altitude_ft // _ALT_BAND_FT)
    cache_key = f"turb:grid:{round(lat, _GRID_LATLON_ROUND)}:{round(lon, _GRID_LATLON_ROUND)}:{alt_band}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    gairmet_score, gairmet_hits = _score_gairmet(lat, lon, altitude_ft)
    pirep_score, pirep_hits = _score_pireps(lat, lon, altitude_ft)
    shear_score, shear_info = _score_winds_shear(lat, lon, altitude_ft)

    # Take the strongest observational/forecast signal, then add a fraction of
    # the secondary signal plus the shear bonus. Capped at 100.
    primary = max(gairmet_score, pirep_score)
    secondary = min(gairmet_score, pirep_score)
    score = min(100, int(primary + secondary * 0.25 + shear_score * 0.5))

    result = {
        "score": score,
        "level": _level_for_score(score),
        "sources": {
            "gairmet": gairmet_hits,
            "pireps": pirep_hits,
            "winds": shear_info,
        },
    }
    cache.set(cache_key, result, _grid_ttl())
    return result
