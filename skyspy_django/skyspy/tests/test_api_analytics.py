"""API tests for the Advanced Analytics endpoints.

pytest-style with the ``api_client`` fixture (never APITestCase — PgBouncer
deadlock rule).
"""

import pytest

from skyspy.tests.factories import (
    AcarsMessageFactory,
    AircraftSightingFactory,
    AlertHistoryFactory,
)

BASE = "/api/v1/analytics"


@pytest.mark.django_db
def test_list_returns_fields(api_client):
    res = api_client.get(f"{BASE}/")
    assert res.status_code == 200
    keys = {f["key"] for f in res.json()["fields"]}
    assert "distance_nm" in keys and "rssi" in keys


@pytest.mark.django_db
def test_scatter_ok(api_client):
    AircraftSightingFactory.create_batch(10)
    res = api_client.get(f"{BASE}/scatter/", {"x_field": "distance_nm", "y_field": "rssi", "hours": 24})
    assert res.status_code == 200
    body = res.json()
    assert body["x_field"] == "distance_nm"
    assert body["y_field"] == "rssi"
    assert "points" in body and "r" in body and "n" in body


@pytest.mark.django_db
def test_scatter_rejects_unknown_field(api_client):
    res = api_client.get(f"{BASE}/scatter/", {"x_field": "latitude", "y_field": "rssi"})
    assert res.status_code == 400
    assert "valid_fields" in res.json()


@pytest.mark.django_db
def test_scatter_defaults_when_no_params(api_client):
    res = api_client.get(f"{BASE}/scatter/")
    assert res.status_code == 200
    assert res.json()["x_field"] == "distance_nm"


@pytest.mark.django_db
def test_matrix_ok(api_client):
    AircraftSightingFactory.create_batch(10)
    res = api_client.get(f"{BASE}/matrix/", {"hours": 24})
    assert res.status_code == 200
    body = res.json()
    n = len(body["fields"])
    assert len(body["matrix"]) == n
    assert body["matrix"][0][0] == 1.0


@pytest.mark.django_db
def test_cross_domain_ok(api_client):
    hex_ = "DEAD01"
    AlertHistoryFactory.create_batch(2, icao_hex=hex_)
    AcarsMessageFactory.create_batch(3, icao_hex=hex_)
    AircraftSightingFactory.create_batch(4, icao_hex=hex_)
    res = api_client.get(f"{BASE}/cross-domain/", {"hours": 24, "limit": 10})
    assert res.status_code == 200
    row = next(r for r in res.json()["aircraft"] if r["icao_hex"] == hex_)
    assert row["alerts"] == 2
    assert row["acars"] == 3
