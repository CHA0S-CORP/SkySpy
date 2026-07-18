"""
Tests for flight-pattern anomaly geometry (services/flight_anomaly.py).

Pure geometry — no DB. Builds synthetic tracks (straight transit, one orbit, and
the multi-orbit survey shape) and asserts the classifier labels each correctly.
"""

import math

from skyspy.services import flight_anomaly

# Center-ish LA latitude for realistic nm<->degree scaling.
_LAT0 = 34.0


def _offset(lat, lon, dnorth_nm, deast_nm):
    """Shift a lat/lon by a north/east offset in nm."""
    dlat = dnorth_nm / 60.0
    dlon = deast_nm / (60.0 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def _circle(center_lat, center_lon, radius_nm=1.5, turns=1.0, n=40):
    """Points tracing `turns` loops around a center."""
    pts = []
    steps = max(4, int(n * turns))
    for i in range(steps + 1):
        theta = 2 * math.pi * turns * (i / steps)
        lat, lon = _offset(center_lat, center_lon, radius_nm * math.sin(theta), radius_nm * math.cos(theta))
        pts.append({"lat": lat, "lon": lon})
    return pts


def _line(a, b, n=20):
    """Straight leg of n points from a=(lat,lon) to b=(lat,lon)."""
    return [{"lat": a[0] + (b[0] - a[0]) * i / n, "lon": a[1] + (b[1] - a[1]) * i / n} for i in range(n + 1)]


def test_straight_transit_is_not_unusual():
    track = _line((34.0, -118.4), (34.6, -117.6), n=40)
    result = flight_anomaly.analyze_track(track)
    assert result["pattern"] == "transit"
    assert result["is_unusual"] is False
    assert result["loiter_count"] == 0


def test_single_orbit_is_flagged_as_loiter():
    track = _circle(34.1, -118.3, radius_nm=1.5, turns=2.0, n=40)
    result = flight_anomaly.analyze_track(track)
    assert result["is_unusual"] is True
    assert result["loiter_count"] == 1
    assert result["pattern"] in ("orbit_loiter", "circling")


def test_two_orbits_are_a_repositioned_orbit():
    # Two tight orbits joined by a long transit leg — net displacement is large,
    # so the simple path/displacement flag misses it; the cluster detector catches it.
    track = (
        _circle(34.05, -118.40, radius_nm=1.2, turns=2.0, n=36)
        + _line((34.05, -118.40), (34.20, -117.20), n=30)
        + _circle(34.20, -117.20, radius_nm=1.2, turns=2.0, n=36)
    )
    result = flight_anomaly.analyze_track(track)
    assert result["pattern"] == "repositioned_orbit"
    assert result["loiter_count"] == 2
    assert result["net_displacement_nm"] > flight_anomaly.LOITER_RADIUS_NM  # large net, still flagged
    assert result["is_unusual"] is True


def test_multi_orbit_survey_shape():
    # Three+ orbits at distinct sites joined by legs — the surveillance/survey
    # shape in the user's map (multiple loops across the metro).
    track = (
        _circle(34.05, -118.40, radius_nm=1.2, turns=2.0, n=36)
        + _line((34.05, -118.40), (34.20, -117.20), n=30)
        + _circle(34.20, -117.20, radius_nm=1.2, turns=2.0, n=36)
        + _line((34.20, -117.20), (33.95, -117.90), n=30)
        + _circle(33.95, -117.90, radius_nm=1.2, turns=2.0, n=36)
    )
    result = flight_anomaly.analyze_track(track)
    assert result["pattern"] == "multi_orbit_survey"
    assert result["loiter_count"] >= 3
    assert result["is_unusual"] is True


def test_multi_orbit_outranks_single_orbit():
    survey = flight_anomaly.analyze_track(
        _circle(34.0, -118.4, turns=2.0)
        + _line((34.0, -118.4), (34.2, -117.2), n=30)
        + _circle(34.2, -117.2, turns=2.0)
    )
    single = flight_anomaly.analyze_track(_circle(34.1, -118.3, turns=2.0))
    assert survey["score"] > single["score"]


def test_insufficient_data():
    result = flight_anomaly.analyze_track([{"lat": 34.0, "lon": -118.0}])
    assert result["pattern"] == "insufficient_data"
    assert result["is_unusual"] is False
