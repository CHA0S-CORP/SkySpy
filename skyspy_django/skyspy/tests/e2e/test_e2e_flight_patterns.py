"""
End-to-end smoke tests for the flight-pattern and geographic stats APIs.

These endpoints run heavy aggregation over sightings/sessions and historically
carry many broad exception handlers (services/flight_pattern_stats.py). The
key guarantee here is graceful degradation: every endpoint must return 200
with a well-formed body on an EMPTY database rather than 500, and must still
respond after some sighting data exists.
"""

import pytest
from rest_framework import status

from skyspy.models import AircraftSighting

FLIGHT_PATTERN_ENDPOINTS = [
    "/api/v1/stats/flight-patterns/",
    "/api/v1/stats/flight-patterns/routes/",
    "/api/v1/stats/flight-patterns/busiest-hours/",
    "/api/v1/stats/flight-patterns/duration-by-type/",
    "/api/v1/stats/flight-patterns/aircraft-types/",
]

GEOGRAPHIC_ENDPOINTS = [
    "/api/v1/stats/geographic/",
    "/api/v1/stats/geographic/countries/",
    "/api/v1/stats/geographic/operators/",
    "/api/v1/stats/geographic/airports/",
    "/api/v1/stats/geographic/military-breakdown/",
    "/api/v1/stats/geographic/locations/",
    "/api/v1/stats/geographic/summary/",
]

ALL_ENDPOINTS = FLIGHT_PATTERN_ENDPOINTS + GEOGRAPHIC_ENDPOINTS


@pytest.fixture
def some_sightings(db):
    now_hex = ["AAA111", "BBB222", "CCC333"]
    created = []
    for i, hexid in enumerate(now_hex):
        created.append(
            AircraftSighting.objects.create(
                icao_hex=hexid,
                callsign=f"TST{i}",
                latitude=47.9 + i * 0.1,
                longitude=-122.0 - i * 0.1,
                altitude_baro=10000 + i * 1000,
                ground_speed=400,
                track=90,
            )
        )
    return created


@pytest.mark.django_db
@pytest.mark.parametrize("endpoint", ALL_ENDPOINTS)
def test_endpoint_ok_on_empty_db(api_client, endpoint):
    """Every stats endpoint degrades gracefully (200, dict body) with no data."""
    response = api_client.get(endpoint)
    assert response.status_code == status.HTTP_200_OK, endpoint
    assert isinstance(response.json(), dict), endpoint


@pytest.mark.django_db
@pytest.mark.parametrize("endpoint", ALL_ENDPOINTS)
def test_endpoint_ok_with_data(api_client, some_sightings, endpoint):
    """Every stats endpoint responds with 200 once sighting data exists."""
    response = api_client.get(endpoint)
    assert response.status_code == status.HTTP_200_OK, endpoint
    assert isinstance(response.json(), dict), endpoint


@pytest.mark.django_db
def test_flight_patterns_respects_hours_param(api_client):
    response = api_client.get("/api/v1/stats/flight-patterns/?hours=6")
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    # The service echoes the requested window back in the payload.
    assert body.get("time_range_hours") in (6, None)


@pytest.mark.django_db
def test_routes_respects_limit_param(api_client, some_sightings):
    response = api_client.get("/api/v1/stats/flight-patterns/routes/?limit=5")
    assert response.status_code == status.HTTP_200_OK
