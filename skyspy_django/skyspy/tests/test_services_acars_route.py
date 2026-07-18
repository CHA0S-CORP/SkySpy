"""Tests for ACARS route resolution (services/acars_route.py)."""

import pytest

from skyspy.models import CachedAirport, CachedNavaid
from skyspy.services.acars_route import build_acars_route


@pytest.fixture
def route_fixtures(db):
    """A handful of cached airports/navaids to resolve names against."""
    CachedAirport.objects.create(icao_id="KLAX", name="Los Angeles Intl", latitude=33.9425, longitude=-118.408)
    CachedAirport.objects.create(icao_id="KJFK", name="John F Kennedy Intl", latitude=40.6398, longitude=-73.7789)
    CachedNavaid.objects.create(
        ident="SLI", name="Seal Beach", navaid_type="VORTAC", latitude=33.787, longitude=-118.052
    )
    # Duplicate ident at two locations to exercise nearest-to-position selection.
    CachedNavaid.objects.create(ident="DUP", name="Near", navaid_type="VOR", latitude=34.0, longitude=-118.0)
    CachedNavaid.objects.create(ident="DUP", name="Far", navaid_type="VOR", latitude=51.0, longitude=0.0)


def test_empty_decoded_makes_no_query(db, django_assert_num_queries):
    """Messages with no route keys resolve without touching the database."""
    with django_assert_num_queries(0):
        assert build_acars_route(None) == {"points": [], "has_route": False}
        assert build_acars_route({}) == {"points": [], "has_route": False}
        assert build_acars_route({"message_type": "Free text"})["has_route"] is False


def test_flight_plan_orders_origin_waypoints_destination(route_fixtures):
    decoded = {"origin": "KLAX", "waypoints": ["SLI", "NOPE"], "destination": "KJFK"}
    route = build_acars_route(decoded)

    assert route["has_route"] is True
    roles = [(p["name"], p["role"]) for p in route["points"]]
    # KLAX origin, SLI waypoint (NOPE unresolved → dropped), KJFK destination.
    assert roles == [("KLAX", "origin"), ("SLI", "waypoint"), ("KJFK", "destination")]
    assert route["points"][0]["lat"] == pytest.approx(33.9425)
    assert route["points"][1]["type"] == "vortac"


def test_position_report_adds_position_marker(route_fixtures):
    route = build_acars_route({"position": {"lat": 34.05, "lon": -118.24}})
    assert route["has_route"] is True
    assert len(route["points"]) == 1
    p = route["points"][0]
    assert p["role"] == "position"
    assert (p["lat"], p["lon"]) == (34.05, -118.24)


def test_duplicate_navaid_picks_nearest_to_position(route_fixtures):
    decoded = {"waypoints": ["DUP"], "position": {"lat": 34.0, "lon": -118.0}}
    route = build_acars_route(decoded)
    dup = next(p for p in route["points"] if p["name"] == "DUP")
    # The LA-area DUP (34,-118) must win over the far one (51,0).
    assert dup["lat"] == pytest.approx(34.0)
    assert dup["label"] == "Near"


def test_unresolvable_route_has_no_points(route_fixtures):
    route = build_acars_route({"origin": "ZZZZ", "destination": "YYYY"})
    assert route == {"points": [], "has_route": False}


def test_serializer_exposes_route(route_fixtures):
    """AcarsMessageSerializer.route surfaces the resolved geo points."""
    from skyspy.models import AcarsMessage
    from skyspy.serializers.acars import AcarsMessageSerializer

    msg = AcarsMessage(label="H1", decoded={"origin": "KLAX", "destination": "KJFK"})
    data = AcarsMessageSerializer(msg).data
    assert data["route"]["has_route"] is True
    assert [p["name"] for p in data["route"]["points"]] == ["KLAX", "KJFK"]
