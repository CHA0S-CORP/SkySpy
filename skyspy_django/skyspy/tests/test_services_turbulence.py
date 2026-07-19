"""
Tests for the turbulence risk synthesis service.

Covers the geometry helpers (ray-cast point-in-polygon, altitude overlap),
level banding, the G-AIRMET / PIREP component scorers (with the DB/HTTP
dependencies mocked), and the combined assess_turbulence flow + grid cache.
"""

from django.core.cache import cache

from skyspy.services import turbulence

# A simple square polygon around (lon -100, lat 40), GeoJSON [lon, lat] order.
SQUARE = {
    "type": "Polygon",
    "coordinates": [[[-101, 39], [-99, 39], [-99, 41], [-101, 41], [-101, 39]]],
}


def test_point_in_polygon_inside():
    assert turbulence._point_in_polygon(-100, 40, SQUARE) is True


def test_point_in_polygon_outside_bbox():
    # Far outside — bbox fast-path rejects.
    assert turbulence._point_in_polygon(-50, 10, SQUARE) is False


def test_point_in_polygon_outside_but_in_bbox():
    # Inside bbox corner but the square contains it too; use a concave-ish check:
    # a point just outside an edge still inside bbox of a triangle.
    triangle = {"type": "Polygon", "coordinates": [[[-101, 39], [-99, 39], [-100, 41], [-101, 39]]]}
    # Top-left corner of bbox is outside the triangle.
    assert turbulence._point_in_polygon(-100.9, 40.9, triangle) is False


def test_point_in_polygon_no_geometry():
    assert turbulence._point_in_polygon(-100, 40, None) is False
    assert turbulence._point_in_polygon(-100, 40, {"type": "Polygon", "coordinates": []}) is False


def test_altitude_overlaps():
    assert turbulence._altitude_overlaps(20000, 18000, 24000) is True
    # Within the pad (2000ft default).
    assert turbulence._altitude_overlaps(17000, 18000, 24000) is True
    # Well below the band.
    assert turbulence._altitude_overlaps(5000, 18000, 24000) is False
    # No altitude given -> applies.
    assert turbulence._altitude_overlaps(None, 18000, 24000) is True
    # Missing bounds -> open band.
    assert turbulence._altitude_overlaps(35000, None, None) is True


def test_level_for_score_bands():
    assert turbulence._level_for_score(0) == "none"
    assert turbulence._level_for_score(19) == "none"
    assert turbulence._level_for_score(20) == "light"
    assert turbulence._level_for_score(45) == "moderate"
    assert turbulence._level_for_score(70) == "severe"
    assert turbulence._level_for_score(100) == "severe"


def test_score_gairmet_hit(monkeypatch):
    monkeypatch.setattr(
        turbulence.airspace,
        "get_advisories",
        lambda lat, lon: [
            {
                "advisory_id": "TURB-1",
                "hazard": "TURB-HI",
                "severity": "MOD",
                "lower_alt_ft": 18000,
                "upper_alt_ft": 42000,
                "polygon": SQUARE,
            }
        ],
    )
    score, hits = turbulence._score_gairmet(40, -100, 35000)
    assert score > 0
    assert hits and hits[0]["hazard"] == "TURB-HI"


def test_score_gairmet_ignores_non_turb(monkeypatch):
    monkeypatch.setattr(
        turbulence.airspace,
        "get_advisories",
        lambda lat, lon: [{"hazard": "ICE", "polygon": SQUARE, "lower_alt_ft": 0, "upper_alt_ft": 60000}],
    )
    score, hits = turbulence._score_gairmet(40, -100, 35000)
    assert score == 0
    assert hits == []


def test_score_pireps_distance_weight(monkeypatch):
    monkeypatch.setattr(
        turbulence,
        "get_cached_pireps",
        lambda lat, lon, radius_nm, hours, limit: [
            {"pirep_id": "P1", "turbType": "SEV", "distance_nm": 0, "altFt": 35000},
        ],
    )
    score, hits = turbulence._score_pireps(40, -100, 35000)
    assert score > 50  # severe + on top of the aircraft
    assert hits and hits[0]["turbType"] == "SEV"


def test_score_winds_shear_no_data(monkeypatch):
    # AWC usually returns [] (raw FB text) -> shear contributes nothing.
    monkeypatch.setattr(turbulence, "fetch_winds_aloft", lambda lat, lon: [])
    score, info = turbulence._score_winds_shear(40, -100, 35000)
    assert score == 0
    assert info is None


def test_assess_turbulence_combines_and_caches(monkeypatch):
    cache.clear()
    monkeypatch.setattr(turbulence, "_score_gairmet", lambda *a: (60, [{"hazard": "TURB"}]))
    monkeypatch.setattr(turbulence, "_score_pireps", lambda *a: (40, [{"turbType": "MOD"}]))
    monkeypatch.setattr(turbulence, "_score_winds_shear", lambda *a: (0, None))

    result = turbulence.assess_turbulence(40.0, -100.0, 35000)
    assert result["score"] == 70  # 60 + 40*0.25
    assert result["level"] == "severe"
    assert result["sources"]["gairmet"]

    # Second call for the same grid cell is served from cache even if the
    # component scorers would now return something different.
    monkeypatch.setattr(turbulence, "_score_gairmet", lambda *a: (0, []))
    cached = turbulence.assess_turbulence(40.0, -100.0, 35000)
    assert cached["score"] == 70


def test_assess_turbulence_missing_coords():
    assert turbulence.assess_turbulence(None, None) == {"score": 0, "level": "none", "sources": {}}


def test_assess_turbulence_none_alt_does_not_share_band_zero(monkeypatch):
    # A None-altitude assessment must not collide with real 0-4999ft aircraft in
    # the grid cache — otherwise whoever computes first pins its score on both.
    cache.clear()
    monkeypatch.setattr(turbulence, "_score_gairmet", lambda *a: (80, []))
    monkeypatch.setattr(turbulence, "_score_pireps", lambda *a: (0, []))
    monkeypatch.setattr(turbulence, "_score_winds_shear", lambda *a: (0, None))

    none_alt = turbulence.assess_turbulence(40.0, -100.0, None)
    assert none_alt["score"] == 80

    # Same cell, altitude 2000ft (band 0). Different scorer result proves it is
    # not served the None-altitude cache entry.
    monkeypatch.setattr(turbulence, "_score_gairmet", lambda *a: (30, []))
    low_alt = turbulence.assess_turbulence(40.0, -100.0, 2000)
    assert low_alt["score"] == 30


def test_gairmet_missing_severity_is_light_not_moderate(monkeypatch):
    # A TURB advisory with no severity string must land below the moderate band.
    cache.clear()
    monkeypatch.setattr(
        turbulence.airspace,
        "get_advisories",
        lambda **kw: [{"hazard": "TURB", "severity": None, "polygon": SQUARE}],
    )
    score, hits = turbulence._score_gairmet(40.0, -100.0, 30000)
    assert score == turbulence._GAIRMET_SEVERITY_DEFAULT
    assert turbulence._level_for_score(score) == "light"
    assert hits
