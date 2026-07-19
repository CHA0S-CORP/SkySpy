"""Tests for the wildfires (Watch Duty) service.

The libwatchduty client is mocked so no network is hit; compute_threat runs for
real (pure function). Covers refresh upsert, radius filtering, marker mapping,
and the bundle cache.

Uses the pytest-django ``settings`` fixture (not the ``@override_settings``
decorator) to toggle WILDFIRES_* — the decorator does not compose reliably with
the ``db`` fixture on plain pytest functions.
"""

from unittest.mock import MagicMock, patch

import pytest

from skyspy.models import CachedWildfire
from skyspy.services import wildfires

# Feeder in test_settings is 47.9377, -121.9687.
NEAR_FIRE = {
    "id": 101,
    "name": "Cascade Fire",
    "geo_event_type": "wildfire",
    "is_active": True,
    "lat": 47.95,
    "lng": -121.95,
    "address": "Near feeder",
    "date_modified": "2026-07-18T12:00:00Z",
    "data": {"acreage": 1500.0, "containment": 10.0, "evacuation_orders": "Zone 3"},
}
FAR_FIRE = {
    "id": 202,
    "name": "SoCal Fire",
    "is_active": True,
    "lat": 34.05,
    "lng": -118.24,  # LA — ~800 nm from the feeder
    "data": {"acreage": 500.0, "containment": 50.0},
}
NO_COORDS_FIRE = {"id": 303, "name": "Ghost", "is_active": True, "data": {}}


def _fake_client(fires):
    client = MagicMock()
    client.list_geo_events.return_value = fires
    return client


def _enable(settings, radius_nm=250):
    settings.WILDFIRES_ENABLED = True
    settings.WILDFIRES_RADIUS_NM = radius_nm
    # Pin the feeder so the fixtures' near/far geometry is deterministic
    # regardless of the ambient .env.test feeder location.
    settings.FEEDER_LAT = 47.9377
    settings.FEEDER_LON = -121.9687


@pytest.mark.django_db
def test_refresh_filters_by_radius_and_upserts(settings):
    _enable(settings)
    with patch.object(wildfires, "_client", return_value=_fake_client([NEAR_FIRE, FAR_FIRE, NO_COORDS_FIRE])):
        count = wildfires.refresh_wildfires()

    assert count == 1  # only the near fire is within 250 nm and has coords
    row = CachedWildfire.objects.get()
    assert row.event_id == 101
    assert row.name == "Cascade Fire"
    assert row.acreage == 1500.0
    assert row.containment == 10.0
    assert row.evacuation_orders == "Zone 3"
    assert row.threat_score is not None  # compute_threat ran


@pytest.mark.django_db
def test_refresh_replaces_previous_rows(settings):
    _enable(settings)
    CachedWildfire.objects.create(event_id=999, latitude=47.9, longitude=-121.9, name="Stale")
    with patch.object(wildfires, "_client", return_value=_fake_client([NEAR_FIRE])):
        wildfires.refresh_wildfires()
    # The stale row is swapped out; only the freshly-fetched fire remains.
    assert list(CachedWildfire.objects.values_list("event_id", flat=True)) == [101]


@pytest.mark.django_db
def test_refresh_noop_when_disabled(settings):
    settings.WILDFIRES_ENABLED = False
    with patch.object(wildfires, "_client") as client:
        assert wildfires.refresh_wildfires() == 0
        client.assert_not_called()


@pytest.mark.django_db
def test_get_cached_wildfires_bbox_and_markers():
    CachedWildfire.objects.create(
        event_id=101, name="Cascade Fire", latitude=47.95, longitude=-121.95, acreage=1500.0, threat_score=42.0
    )
    CachedWildfire.objects.create(event_id=202, name="Far", latitude=34.0, longitude=-118.2)

    markers = wildfires.get_cached_wildfires(47.9377, -121.9687, 250)
    assert len(markers) == 1
    m = markers[0]
    assert m["id"] == 101
    assert m["name"] == "Cascade Fire"
    assert m["lat"] == pytest.approx(47.95)
    assert m["threat_score"] == 42.0


@pytest.mark.django_db
def test_get_fire_bundle_trims_and_caches(settings):
    settings.WILDFIRES_ENABLED = True
    bundle = {
        "event": {"id": 101},
        "reports": [{"id": 1, "message": "<p>update</p>"}],
        "cameras": [{"id": "c1", "image_url": "http://x/c.jpg"}],
        "radio_feeds": [{"feed_id": 5, "name": "County Fire"}],
        "fps_runs": [{"heavy": "dropped"}],
    }
    client = MagicMock()
    client.get_fire_bundle.return_value = bundle
    with patch.object(wildfires, "_client", return_value=client):
        out = wildfires.get_fire_bundle(101)
        # Second call is served from cache (client not hit again).
        wildfires.get_fire_bundle(101)

    assert "fps_runs" not in out
    assert out["reports"][0]["message"] == "<p>update</p>"
    assert client.get_fire_bundle.call_count == 1


@pytest.mark.django_db
def test_get_fire_bundle_none_when_disabled(settings):
    settings.WILDFIRES_ENABLED = False
    assert wildfires.get_fire_bundle(101) is None


def test_best_cameras_picks_nearest_online_first(settings):
    # Raise the distance cap so the ordering (incl. the far camera) is what's tested.
    settings.WILDFIRES_CAMERA_RADIUS_NM = 1000
    fire_lat, fire_lon = 34.0, -118.0
    cams = [
        {"id": "far", "latlng": {"lat": 40.0, "lng": -118.0}},  # ~660 km
        {"id": "near", "latlng": {"lat": 34.05, "lng": -118.02}},  # ~6 km
        {"id": "near_offline", "latlng": {"lat": 34.01, "lng": -118.0}, "is_offline": True},  # ~1 km but offline
        {"id": "mid", "latlng": {"lat": 34.5, "lng": -118.0}},  # ~55 km
        {"id": "no_coords"},
    ]
    picked = wildfires._best_cameras(cams, fire_lat, fire_lon, limit=4)
    ids = [c["id"] for c in picked]
    # Online cameras ranked by distance first; the closer-but-offline one sinks below them.
    assert ids[:3] == ["near", "mid", "far"]
    assert ids[3] == "near_offline"
    assert "no_coords" not in ids


def test_best_cameras_drops_cameras_beyond_radius(settings):
    # A fire in a sparse-camera area: the only cameras are far away → drop them
    # rather than show the "wrong location". Nearby cameras carry distance_km.
    settings.WILDFIRES_CAMERA_RADIUS_NM = 50  # ~93 km
    fire_lat, fire_lon = 34.0, -118.0
    cams = [
        {"id": "near", "latlng": {"lat": 34.05, "lng": -118.02}},  # ~6 km, kept
        {"id": "far", "latlng": {"lat": 40.0, "lng": -118.0}},  # ~660 km, dropped
    ]
    picked = wildfires._best_cameras(cams, fire_lat, fire_lon, limit=4)
    ids = [c["id"] for c in picked]
    assert ids == ["near"]
    assert isinstance(picked[0]["distance_km"], float)
    assert picked[0]["distance_km"] < 10


def test_best_cameras_prefers_wildfire_over_traffic(settings):
    # A near Caltrans traffic cam must not crowd out a farther real fire lookout.
    settings.WILDFIRES_CAMERA_RADIUS_NM = 100
    fire_lat, fire_lon = 34.0, -118.0
    cams = [
        {
            "id": "traffic_near",
            "name": "KER-99-AT 11TH AVE",
            "provider": "caltrans",
            "latlng": {"lat": 34.01, "lng": -118.0},
        },  # ~1 km
        {
            "id": "fire_far",
            "name": "Slate Mtn",
            "provider": "alertwest",
            "latlng": {"lat": 34.4, "lng": -118.0},
        },  # ~44 km
    ]
    picked = wildfires._best_cameras(cams, fire_lat, fire_lon, limit=4)
    ids = [c["id"] for c in picked]
    # The wildfire lookout wins despite being much farther; traffic cam dropped.
    assert ids == ["fire_far"]


def test_best_cameras_traffic_only_fallback(settings):
    # When a fire's only cameras are traffic cams, still show them (last resort).
    settings.WILDFIRES_CAMERA_RADIUS_NM = 100
    fire_lat, fire_lon = 34.0, -118.0
    cams = [
        {"id": "t1", "name": "KER-99-AT RTE 46", "provider": "caltrans", "latlng": {"lat": 34.01, "lng": -118.0}},
        {"id": "t2", "name": "KER-58-AT MAIN", "provider": "caltrans", "latlng": {"lat": 34.02, "lng": -118.0}},
    ]
    picked = wildfires._best_cameras(cams, fire_lat, fire_lon, limit=4)
    assert [c["id"] for c in picked] == ["t1", "t2"]


def test_best_cameras_falls_back_without_fire_coords():
    cams = [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}, {"id": "e"}]
    picked = wildfires._best_cameras(cams, None, None, limit=4)
    assert [c["id"] for c in picked] == ["a", "b", "c", "d"]
