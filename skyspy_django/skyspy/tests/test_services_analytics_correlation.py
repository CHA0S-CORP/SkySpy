"""Unit tests for services.analytics_correlation."""

import pytest

from skyspy.services import analytics_correlation as ac
from skyspy.tests.factories import (
    AcarsMessageFactory,
    AircraftInfoFactory,
    AircraftSightingFactory,
    AlertHistoryFactory,
    SafetyEventFactory,
)

# ---- pure math (no DB) ------------------------------------------------------


def test_pearson_perfect_negative():
    xs = [1, 2, 3, 4, 5]
    ys = [-10, -20, -30, -40, -50]
    assert round(ac._pearson(xs, ys), 5) == -1.0


def test_pearson_perfect_positive():
    xs = [1, 2, 3, 4, 5]
    ys = [2, 4, 6, 8, 10]
    assert round(ac._pearson(xs, ys), 5) == 1.0


def test_pearson_insufficient_or_constant():
    assert ac._pearson([1], [2]) is None
    assert ac._pearson([1, 1, 1], [2, 3, 4]) is None  # zero variance in x


def test_linregress_slope_intercept():
    slope, intercept = ac._linregress([0, 1, 2], [1, 3, 5])
    assert round(slope, 5) == 2.0
    assert round(intercept, 5) == 1.0


def test_downsample_caps_points():
    pairs = [(i, i) for i in range(1000)]
    out = ac._downsample(pairs, 200)
    assert len(out) <= 200
    assert out[0] == {"x": 0, "y": 0}


def test_clean_pair_drops_nulls():
    rows = [{"a": 1, "b": 2}, {"a": None, "b": 3}, {"a": 4, "b": None}, {"a": 5, "b": 6}]
    xs, ys = ac._clean_pair(rows, "a", "b")
    assert xs == [1, 5]
    assert ys == [2, 6]


def test_field_helpers():
    keys = {f["key"] for f in ac.field_labels()}
    assert "distance_nm" in keys and "rssi" in keys and "hour" in keys
    assert ac.is_valid_field("altitude_baro")
    assert not ac.is_valid_field("latitude")  # not exposed


# ---- scatter_correlation ----------------------------------------------------


def test_scatter_rejects_unknown_field():
    with pytest.raises(ValueError):
        ac.scatter_correlation("distance_nm", "latitude")
    with pytest.raises(ValueError):
        ac.scatter_correlation("bogus", "rssi")


@pytest.mark.django_db
def test_scatter_perfect_correlation():
    # Perfectly anti-correlated distance/rssi.
    for d, r in zip([1, 2, 3, 4, 5], [-10, -20, -30, -40, -50], strict=True):
        AircraftSightingFactory(distance_nm=d, rssi=r)
    out = ac.scatter_correlation("distance_nm", "rssi", hours=24)
    assert out["n"] == 5
    assert out["r"] == -1.0
    assert len(out["points"]) == 5
    assert out["x_field"] == "distance_nm"
    assert out["y_label"] == "Signal (RSSI)"


@pytest.mark.django_db
def test_scatter_points_downsampled(settings):
    settings.ANALYTICS_MAX_ROWS = 10000
    AircraftSightingFactory.create_batch(250)
    out = ac.scatter_correlation("altitude_baro", "ground_speed", hours=24)
    assert out["n"] >= 200
    assert len(out["points"]) <= ac.ANALYTICS_MAX_POINTS


@pytest.mark.django_db
def test_scatter_hour_field():
    AircraftSightingFactory.create_batch(5)
    out = ac.scatter_correlation("hour", "altitude_baro", hours=24)
    # hour is 0..23
    assert all(0 <= p["x"] <= 23 for p in out["points"])


@pytest.mark.django_db
def test_scatter_empty_when_no_data():
    out = ac.scatter_correlation("distance_nm", "rssi", hours=24)
    assert out["n"] == 0
    assert out["r"] is None
    assert out["points"] == []


# ---- correlation_matrix -----------------------------------------------------


@pytest.mark.django_db
def test_correlation_matrix_shape_and_diagonal():
    AircraftSightingFactory.create_batch(20)
    out = ac.correlation_matrix(hours=24)
    n_fields = len(ac.CORRELATABLE_FIELDS)
    assert len(out["fields"]) == n_fields
    assert len(out["matrix"]) == n_fields
    assert all(len(row) == n_fields for row in out["matrix"])
    for i in range(n_fields):
        assert out["matrix"][i][i] == 1.0


# ---- cross_domain_by_aircraft ----------------------------------------------


@pytest.mark.django_db
def test_cross_domain_rollup_counts():
    hex_ = "ABC123"
    AircraftInfoFactory(icao_hex=hex_, type_code="B738", operator="Test Air")
    AlertHistoryFactory.create_batch(3, icao_hex=hex_)
    SafetyEventFactory.create_batch(2, icao_hex=hex_, event_type="vs_reversal", icao_hex_2=None)
    AcarsMessageFactory.create_batch(4, icao_hex=hex_)
    AircraftSightingFactory.create_batch(5, icao_hex=hex_)

    out = ac.cross_domain_by_aircraft(hours=24, limit=25)
    row = next(r for r in out["aircraft"] if r["icao_hex"] == hex_)
    assert row["alerts"] == 3
    assert row["safety_events"] == 2
    assert row["acars"] == 4
    assert row["sightings"] == 5
    assert row["type_code"] == "B738"
    assert row["operator"] == "Test Air"


@pytest.mark.django_db
def test_cross_domain_counts_second_proximity_aircraft():
    SafetyEventFactory(
        icao_hex="AAA111",
        icao_hex_2="BBB222",
        event_type="proximity_conflict",
        callsign_2="TEST2",
    )
    out = ac.cross_domain_by_aircraft(hours=24)
    hexes = {r["icao_hex"]: r for r in out["aircraft"]}
    assert hexes["AAA111"]["safety_events"] == 1
    assert hexes["BBB222"]["safety_events"] == 1


@pytest.mark.django_db
def test_cross_domain_respects_limit():
    for i in range(5):
        AlertHistoryFactory(icao_hex=f"HEX{i:03d}")
    out = ac.cross_domain_by_aircraft(hours=24, limit=2)
    assert out["total"] == 2
    assert len(out["aircraft"]) == 2
