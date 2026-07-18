"""
Flight-pattern anomaly detection.

Classifies an aircraft's flown path (an ordered list of positions) into a
behavior pattern and scores how *unusual* it is, then scans recent tracks to
surface the strangest ones. This finds geometry the per-track orbit flag in
``assistant/tools.py`` misses — notably the "multi-orbit survey" shape (several
tight orbits joined by long transit legs), where net displacement is large so a
simple path-vs-displacement ratio never trips.

Pure geometry, no Django imports at module top level (the scanner imports the
model lazily) so ``analyze_track`` stays trivially unit-testable.
"""

from __future__ import annotations

import math
from typing import Any

# Two positions within this radius are treated as part of the same "place" — a
# loiter cluster forms when the aircraft winds up a lot of path while staying
# inside one. ~4 nm comfortably contains a holding pattern / survey orbit.
LOITER_RADIUS_NM = 4.0
# A cluster only counts as a real orbit/loiter (not a slow straight crawl) once
# the path flown *inside* it is at least this multiple of the cluster radius.
LOITER_PATH_FACTOR = 2.0
# Minimum positions inside a cluster before it's considered deliberate.
LOITER_MIN_POINTS = 4
# A track shorter than this (nm of path) is too short to classify.
MIN_PATH_NM = 2.0
# A loiter cluster must spread at least this far from its centroid to be a real
# orbit — kills GPS jitter at a parked/taxiing position (huge winding, ~0 spread).
MIN_ORBIT_SPREAD_NM = 0.4
# ...and must actually loop: at least this much total turning (1 full circle).
MIN_ORBIT_REVOLUTIONS = 1.0
# Positions more than this far apart in time belong to SEPARATE flights (the
# aircraft landed/parked and flew again); the scanner splits on the gap so two
# unrelated legs don't merge into a bogus "survey".
TIME_GAP_SPLIT_S = 900


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r_nm = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r_nm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(math.radians(lat1)) * math.cos(
        math.radians(lat2)
    ) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _norm_deg(d: float) -> float:
    """Fold a heading change into [-180, 180]."""
    return (d + 180.0) % 360.0 - 180.0


def _coords(points: list[dict]) -> list[tuple[float, float]]:
    out = []
    for p in points:
        lat = p.get("lat", p.get("latitude"))
        lon = p.get("lon", p.get("longitude"))
        if lat is not None and lon is not None:
            out.append((float(lat), float(lon)))
    return out


def _loiter_clusters(coords: list[tuple[float, float]]) -> list[dict]:
    """Find places where the aircraft wound up a lot of path inside a small area.

    Greedy single pass: extend the current cluster while each new point stays
    within LOITER_RADIUS_NM of the cluster's anchor; when a point leaves, close
    the cluster and start fresh from it. A closed cluster is kept only if it has
    enough points AND its internal path is long relative to its radius (so a slow
    straight pass-through doesn't register as an orbit).
    """
    clusters: list[dict] = []
    if len(coords) < LOITER_MIN_POINTS:
        return clusters

    start = 0

    def _close(lo: int, hi: int) -> None:
        seg = coords[lo : hi + 1]
        if len(seg) < LOITER_MIN_POINTS:
            return
        path = sum(_haversine_nm(*seg[i], *seg[i + 1]) for i in range(len(seg) - 1))
        if path < LOITER_RADIUS_NM * LOITER_PATH_FACTOR:
            return
        clat = sum(c[0] for c in seg) / len(seg)
        clon = sum(c[1] for c in seg) / len(seg)
        # Spread guard: a real orbit swings well away from its center; parked GPS
        # jitter winds up path without ever leaving a few hundred metres.
        spread = max(_haversine_nm(clat, clon, *c) for c in seg)
        if spread < MIN_ORBIT_SPREAD_NM:
            return
        turning = 0.0
        for i in range(len(seg) - 2):
            b1 = _bearing(*seg[i], *seg[i + 1])
            b2 = _bearing(*seg[i + 1], *seg[i + 2])
            turning += abs(_norm_deg(b2 - b1))
        if turning / 360.0 < MIN_ORBIT_REVOLUTIONS:
            return
        clusters.append(
            {
                "lat": round(clat, 4),
                "lon": round(clon, 4),
                "points": len(seg),
                "path_nm": round(path, 1),
                "revolutions": round(turning / 360.0, 1),
            }
        )

    anchor = coords[0]
    for i in range(1, len(coords)):
        if _haversine_nm(*anchor, *coords[i]) <= LOITER_RADIUS_NM:
            continue
        # Point left the current cluster's neighborhood: close [start, i-1].
        _close(start, i - 1)
        start = i
        anchor = coords[i]
    _close(start, len(coords) - 1)
    return clusters


def analyze_track(points: list[dict]) -> dict[str, Any]:
    """Classify one ordered position list into a flight pattern + unusualness score.

    ``points`` are dicts with lat/lon (``lat``/``lon`` or ``latitude``/``longitude``).
    Returns a dict with the pattern label, a numeric ``score`` (higher = stranger),
    the loiter clusters found, and the geometry features behind the call.
    """
    coords = _coords(points)
    if len(coords) < LOITER_MIN_POINTS:
        return {"pattern": "insufficient_data", "score": 0.0, "is_unusual": False, "point_count": len(coords)}

    path = sum(_haversine_nm(*coords[i], *coords[i + 1]) for i in range(len(coords) - 1))
    net = _haversine_nm(*coords[0], *coords[-1])
    if path < MIN_PATH_NM:
        return {"pattern": "stationary", "score": 0.0, "is_unusual": False, "path_nm": round(path, 1)}

    tortuosity = path / max(net, 0.1)

    # Total absolute turning and heading reversals (sign flips in turn direction).
    turning = 0.0
    reversals = 0
    prev_turn = 0.0
    for i in range(len(coords) - 2):
        b1 = _bearing(*coords[i], *coords[i + 1])
        b2 = _bearing(*coords[i + 1], *coords[i + 2])
        turn = _norm_deg(b2 - b1)
        turning += abs(turn)
        if turn * prev_turn < 0 and abs(turn) > 10:
            reversals += 1
        if abs(turn) > 10:
            prev_turn = turn
    revolutions = turning / 360.0

    clusters = _loiter_clusters(coords)
    n_clusters = len(clusters)

    # Classification, most-specific first.
    if n_clusters >= 3:
        pattern, tone = "multi_orbit_survey", "danger"
    elif n_clusters == 2:
        pattern, tone = "repositioned_orbit", "warn"
    elif n_clusters == 1 and net <= max(LOITER_RADIUS_NM, 0.3 * path):
        pattern, tone = "orbit_loiter", "warn"
    elif n_clusters == 1:
        pattern, tone = "orbit_then_transit", "warn"
    elif reversals >= 4 and tortuosity >= 1.4:
        pattern, tone = "grid_or_zigzag", "warn"
    elif tortuosity >= 3.0:
        pattern, tone = "meandering", "info"
    elif revolutions >= 1.0 and tortuosity >= 1.5:
        pattern, tone = "circling", "warn"
    else:
        pattern, tone = "transit", "ok"

    # Unusualness score: orbits dominate, then winding/reversals/tortuosity.
    score = 3.0 * n_clusters + 1.0 * min(revolutions, 8.0) + 0.5 * min(reversals, 10) + min(tortuosity, 6.0)
    is_unusual = pattern not in ("transit", "stationary", "insufficient_data")

    return {
        "pattern": pattern,
        "tone": tone,
        "score": round(score, 1),
        "is_unusual": is_unusual,
        "loiter_count": n_clusters,
        "loiter_clusters": clusters,
        "revolutions": round(revolutions, 1),
        "reversals": reversals,
        "tortuosity": round(tortuosity, 1),
        "path_nm": round(path, 1),
        "net_displacement_nm": round(net, 1),
        "point_count": len(coords),
    }


# Cap on how many aircraft the scanner will reconstruct a full track for, so a
# busy window can't turn one question into thousands of per-hex queries.
_SCAN_AIRCRAFT_CAP = 150


def _split_flights(pts: list[dict]) -> list[list[dict]]:
    """Split a timestamp-ordered sighting list into separate flights on time gaps."""
    if not pts:
        return []
    legs: list[list[dict]] = [[pts[0]]]
    for prev, cur in zip(pts, pts[1:], strict=False):
        gap = (cur["timestamp"] - prev["timestamp"]).total_seconds()
        if gap > TIME_GAP_SPLIT_S:
            legs.append([])
        legs[-1].append(cur)
    return legs


def scan_unusual_patterns(hours: int = 6, limit: int = 15, min_points: int = 12) -> dict[str, Any]:
    """Scan recent tracks and return aircraft flying unusual geometry, ranked.

    Loads the most position-rich aircraft in the window (capped), reconstructs
    each flown path, runs ``analyze_track``, keeps the unusual ones and sorts by
    score. Each result carries the pattern, its metrics, a map-able centroid, and
    identity fields so the caller can drill in with ``aircraft_track``.
    """
    from django.db.models import Count
    from django.utils import timezone

    from skyspy.models import AircraftSighting

    hours = max(1, min(168, int(hours or 6)))
    limit = max(1, min(50, int(limit or 15)))
    min_points = max(LOITER_MIN_POINTS, min(200, int(min_points or 12)))
    since = timezone.now() - timezone.timedelta(hours=hours)

    base = AircraftSighting.objects.filter(timestamp__gte=since, latitude__isnull=False)
    hex_counts = (
        base.values("icao_hex").annotate(n=Count("id")).filter(n__gte=min_points).order_by("-n")[:_SCAN_AIRCRAFT_CAP]
    )

    results = []
    for row in hex_counts:
        hex_code = row["icao_hex"]
        pts = list(
            base.filter(icao_hex=hex_code)
            .order_by("timestamp")
            .values("latitude", "longitude", "callsign", "is_military", "aircraft_type", "timestamp")
        )
        # Split into separate flights on long time gaps, then analyze each leg and
        # keep the strangest — so a park-and-refly doesn't fake a survey, and a
        # genuinely odd leg isn't diluted by hours of straight cruise.
        best = None
        for leg in _split_flights(pts):
            if len(leg) < LOITER_MIN_POINTS:
                continue
            step = max(1, len(leg) // 200)
            track = [{"lat": p["latitude"], "lon": p["longitude"]} for p in leg[::step]]
            analysis = analyze_track(track)
            if analysis.get("is_unusual") and (best is None or analysis["score"] > best[0]["score"]):
                best = (analysis, track)
        if best is None:
            continue
        analysis, track = best
        last = pts[-1]
        clusters = analysis.get("loiter_clusters") or []
        results.append(
            {
                "icao_hex": hex_code,
                "callsign": (last.get("callsign") or "").strip() or None,
                "aircraft_type": last.get("aircraft_type"),
                "is_military": bool(last.get("is_military")),
                "center": {"lat": clusters[0]["lat"], "lon": clusters[0]["lon"]}
                if clusters
                else {"lat": track[len(track) // 2]["lat"], "lon": track[len(track) // 2]["lon"]},
                **analysis,
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return {
        "hours": hours,
        "scanned": len(hex_counts),
        "count": len(results),
        "results": results[:limit],
    }
