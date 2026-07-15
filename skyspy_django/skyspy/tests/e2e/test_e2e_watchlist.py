"""
End-to-end tests for the watch-list API (WatchListViewSet).

Covers:
- list (GET /api/v1/watchlist/)
- create / upsert (POST /api/v1/watchlist/)
- destroy by hex (DELETE /api/v1/watchlist/<hex>/)
- import (POST /api/v1/watchlist/import/)
- export (GET /api/v1/watchlist/export/)
- clear (DELETE /api/v1/watchlist/clear/)
- import -> export round trip
"""

import pytest
from rest_framework import status

from skyspy.models import WatchedAircraft


@pytest.fixture
def watched_batch(db):
    """Three watched aircraft."""
    return [
        WatchedAircraft.objects.create(hex="ABC123", callsign="TEST1", type_code="B738"),
        WatchedAircraft.objects.create(hex="DEF456", callsign="TEST2", registration="N456DE"),
        WatchedAircraft.objects.create(hex="A1B2C3", notes="watch this one"),
    ]


@pytest.mark.django_db
class TestWatchListRead:
    def test_list_empty(self, api_client):
        response = api_client.get("/api/v1/watchlist/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 0
        assert body["watchList"] == []

    def test_list_with_data(self, api_client, watched_batch):
        response = api_client.get("/api/v1/watchlist/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 3
        assert {item["hex"] for item in body["watchList"]} == {"ABC123", "DEF456", "A1B2C3"}


@pytest.mark.django_db
class TestWatchListCreate:
    def test_create_adds_aircraft(self, api_client):
        response = api_client.post(
            "/api/v1/watchlist/",
            {"hex": "abc999", "callsign": "NEW1", "type_code": "A320", "notes": "n"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        # hex is normalised to upper-case
        assert response.json()["hex"] == "ABC999"
        assert WatchedAircraft.objects.filter(hex="ABC999").exists()

    def test_create_requires_hex(self, api_client):
        response = api_client.post("/api/v1/watchlist/", {"callsign": "NOHEX"}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "error" in response.json()

    def test_create_is_upsert(self, api_client):
        api_client.post("/api/v1/watchlist/", {"hex": "AA11BB", "callsign": "OLD"}, format="json")
        response = api_client.post("/api/v1/watchlist/", {"hex": "AA11BB", "callsign": "UPDATED"}, format="json")
        # Second call updates the existing row rather than creating a duplicate.
        assert response.status_code == status.HTTP_200_OK
        assert WatchedAircraft.objects.filter(hex="AA11BB").count() == 1
        assert WatchedAircraft.objects.get(hex="AA11BB").callsign == "UPDATED"


@pytest.mark.django_db
class TestWatchListDestroy:
    def test_destroy_removes_aircraft(self, api_client, watched_batch):
        response = api_client.delete("/api/v1/watchlist/ABC123/")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not WatchedAircraft.objects.filter(hex="ABC123").exists()

    def test_destroy_is_case_insensitive(self, api_client, watched_batch):
        response = api_client.delete("/api/v1/watchlist/abc123/")
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_destroy_unknown_returns_404(self, api_client):
        response = api_client.delete("/api/v1/watchlist/ZZZZZZ/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestWatchListImportExport:
    def test_import_adds_and_updates(self, api_client):
        WatchedAircraft.objects.create(hex="EXIST1", callsign="OLD")
        payload = {
            "watchList": [
                {"hex": "exist1", "callsign": "NEW"},
                {"hex": "fresh1", "callsign": "F1"},
                {"hex": "", "callsign": "skipped"},  # no hex -> ignored
            ]
        }
        response = api_client.post("/api/v1/watchlist/import/", payload, format="json")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["added"] == 1
        assert body["updated"] == 1
        assert body["total"] == 2
        assert WatchedAircraft.objects.get(hex="EXIST1").callsign == "NEW"

    def test_import_rejects_non_list(self, api_client):
        response = api_client.post("/api/v1/watchlist/import/", {"watchList": "nope"}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_export_shape(self, api_client, watched_batch):
        response = api_client.get("/api/v1/watchlist/export/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["version"] == 1
        assert body["count"] == 3
        assert "exported" in body
        assert len(body["watchList"]) == 3

    def test_import_export_round_trip(self, api_client, watched_batch):
        exported = api_client.get("/api/v1/watchlist/export/").json()
        api_client.delete("/api/v1/watchlist/clear/")
        assert WatchedAircraft.objects.count() == 0

        response = api_client.post("/api/v1/watchlist/import/", {"watchList": exported["watchList"]}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert WatchedAircraft.objects.count() == 3
        reexported = api_client.get("/api/v1/watchlist/export/").json()
        assert {a["hex"] for a in reexported["watchList"]} == {"ABC123", "DEF456", "A1B2C3"}


@pytest.mark.django_db
class TestWatchListClear:
    def test_clear_removes_all(self, api_client, watched_batch):
        response = api_client.delete("/api/v1/watchlist/clear/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["deleted"] == 3
        assert WatchedAircraft.objects.count() == 0

    def test_clear_when_empty(self, api_client):
        response = api_client.delete("/api/v1/watchlist/clear/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["deleted"] == 0
