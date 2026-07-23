"""Tests for the aircraft-clusters Socket.IO handler (server-side map clustering)."""

import pytest
from asgiref.sync import async_to_sync
from django.contrib.gis.geos import Point

from skyspy.models import LiveAircraftPosition
from skyspy.socketio.namespaces.mixins.aircraft import AircraftHandlerMixin


def _seed():
    LiveAircraftPosition.objects.all().delete()
    # Two spatially separated groups: near LAX and near SEA.
    pts = [
        (33.94, -118.40),
        (33.95, -118.41),
        (33.96, -118.39),
        (47.45, -122.31),
        (47.46, -122.30),
    ]
    for i, (lat, lon) in enumerate(pts):
        LiveAircraftPosition.objects.create(icao_hex=f"AAA{i:03d}", geom=Point(lon, lat, srid=4326), altitude=10000)


@pytest.mark.django_db
def test_low_zoom_returns_clusters():
    _seed()
    mixin = AircraftHandlerMixin()
    result = async_to_sync(mixin._get_aircraft_clusters)(
        {"zoom": 4, "bbox": {"north": 50, "south": 30, "east": -110, "west": -125}}
    )
    assert result["clustered"] is True
    # Two well-separated groups should form two clusters at low zoom.
    assert len(result["clusters"]) == 2
    assert result["count"] == 5
    for c in result["clusters"]:
        assert c["count"] >= 1
        assert len(c["bbox"]) == 4


@pytest.mark.django_db
def test_high_zoom_returns_raw_points():
    _seed()
    mixin = AircraftHandlerMixin()
    # Zoom above threshold, bbox tight on the LAX group only.
    result = async_to_sync(mixin._get_aircraft_clusters)(
        {"zoom": 12, "bbox": {"north": 34.1, "south": 33.8, "east": -118.2, "west": -118.6}}
    )
    assert result["clustered"] is False
    assert len(result["aircraft"]) == 3
    hexes = {a["hex"] for a in result["aircraft"]}
    assert hexes == {"AAA000", "AAA001", "AAA002"}


@pytest.mark.django_db
def test_cold_path_upsert_and_prune():
    from datetime import timedelta

    from django.utils import timezone

    from skyspy.tasks.aircraft_stream import _upsert_live_positions

    LiveAircraftPosition.objects.all().delete()
    # Two positions for the same hex in one batch (last wins) + one other.
    _upsert_live_positions(
        [
            {"hex": "abc123", "lat": 10.0, "lon": 20.0, "gs": 100, "track": 90},
            {"hex": "abc123", "lat": 11.0, "lon": 21.0, "gs": 120, "track": 95},
            {"hex": "def456", "lat": 30.0, "lon": 40.0},
            {"hex": "nolatlon"},  # skipped (no position)
        ]
    )
    assert LiveAircraftPosition.objects.count() == 2
    row = LiveAircraftPosition.objects.get(icao_hex="ABC123")
    assert row.geom.x == 21.0 and row.geom.y == 11.0  # last write won

    # Age one row past the TTL and confirm the prune drops it.
    stale = LiveAircraftPosition.objects.get(icao_hex="DEF456")
    LiveAircraftPosition.objects.filter(pk=stale.pk).update(updated_at=timezone.now() - timedelta(seconds=10_000))
    _upsert_live_positions([{"hex": "abc123", "lat": 11.0, "lon": 21.0}])
    assert set(LiveAircraftPosition.objects.values_list("icao_hex", flat=True)) == {"ABC123"}


@pytest.mark.django_db
def test_bbox_filters_out_of_view():
    _seed()
    mixin = AircraftHandlerMixin()
    # High zoom over an empty area → no points.
    result = async_to_sync(mixin._get_aircraft_clusters)(
        {"zoom": 12, "bbox": {"north": 10, "south": 0, "east": 10, "west": 0}}
    )
    assert result["clustered"] is False
    assert result["aircraft"] == []
