"""
End-to-end tests for the Cannonball (mobile LE threat detection) API.

Covers:
- Sessions: list / filter / active action / end action
- Known aircraft: list / search / create / retrieve / check-by-icao / verify / stats
- Alerts: list / acknowledge / acknowledge-all
- Stats summary
"""

import pytest
from rest_framework import status

from skyspy.models import (
    CannonballAlert,
    CannonballKnownAircraft,
    CannonballSession,
)


def _make_alert(session, acknowledged=False):
    return CannonballAlert.objects.create(
        session=session,
        alert_type="proximity",
        priority="high",
        title="LE nearby",
        message="LE aircraft nearby",
        acknowledged=acknowledged,
    )


@pytest.fixture
def sessions(db):
    """One active and one inactive session."""
    active = CannonballSession.objects.create(
        icao_hex="AE1234",
        callsign="LEO1",
        is_active=True,
        threat_level="high",
        identification_method="known_db",
    )
    inactive = CannonballSession.objects.create(
        icao_hex="AE5678",
        callsign="LEO2",
        is_active=False,
        threat_level="info",
    )
    return active, inactive


@pytest.fixture
def known_aircraft(db):
    return CannonballKnownAircraft.objects.create(
        icao_hex="AE1234",
        registration="N911PD",
        agency_name="Example County Sheriff",
        agency_type="local",
        agency_state="WA",
        verified=True,
    )


@pytest.mark.django_db
class TestCannonballSessions:
    def test_list_empty(self, api_client):
        response = api_client.get("/api/v1/cannonball/sessions/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 0
        assert body["active_count"] == 0

    def test_list_reports_counts(self, api_client, sessions):
        response = api_client.get("/api/v1/cannonball/sessions/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 2
        assert body["active_count"] == 1

    def test_active_only_filter(self, api_client, sessions):
        response = api_client.get("/api/v1/cannonball/sessions/?active_only=true")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 1

    def test_active_action(self, api_client, sessions):
        response = api_client.get("/api/v1/cannonball/sessions/active/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 1
        assert body["sessions"][0]["icao_hex"] == "AE1234"

    def test_end_action(self, api_client, sessions):
        active, _ = sessions
        response = api_client.post(f"/api/v1/cannonball/sessions/{active.id}/end/")
        assert response.status_code == status.HTTP_200_OK
        active.refresh_from_db()
        assert active.is_active is False


@pytest.mark.django_db
class TestCannonballKnownAircraft:
    def test_list_reports_verified_count(self, api_client, known_aircraft):
        response = api_client.get("/api/v1/cannonball/known-aircraft/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 1
        assert body["verified_count"] == 1

    def test_search(self, api_client, known_aircraft):
        response = api_client.get("/api/v1/cannonball/known-aircraft/?search=Sheriff")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["count"] == 1
        response = api_client.get("/api/v1/cannonball/known-aircraft/?search=nomatch")
        assert response.json()["count"] == 0

    def test_create_and_retrieve(self, api_client):
        payload = {
            "icao_hex": "A0F0F0",
            "registration": "N5FBI",
            "agency_name": "Example Federal Agency",
            "agency_type": "federal",
            "agency_state": "DC",
        }
        response = api_client.post("/api/v1/cannonball/known-aircraft/", payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert CannonballKnownAircraft.objects.filter(icao_hex="A0F0F0").exists()

    def test_check_found(self, api_client, known_aircraft):
        response = api_client.get("/api/v1/cannonball/known-aircraft/check/AE1234/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["found"] is True
        assert body["aircraft"]["agency_name"] == "Example County Sheriff"

    def test_check_case_insensitive_and_not_found(self, api_client, known_aircraft):
        # lower-case hex is normalised to match
        assert api_client.get("/api/v1/cannonball/known-aircraft/check/ae1234/").json()["found"] is True
        missing = api_client.get("/api/v1/cannonball/known-aircraft/check/BBBBBB/").json()
        assert missing["found"] is False
        assert missing["icao_hex"] == "BBBBBB"

    def test_verify_action(self, api_client, db):
        ac = CannonballKnownAircraft.objects.create(icao_hex="A1A1A1", agency_name="Unverified Agency", verified=False)
        response = api_client.post(f"/api/v1/cannonball/known-aircraft/{ac.id}/verify/")
        assert response.status_code == status.HTTP_200_OK
        ac.refresh_from_db()
        assert ac.verified is True
        assert ac.verified_at is not None

    def test_stats(self, api_client, known_aircraft):
        response = api_client.get("/api/v1/cannonball/known-aircraft/stats/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["total"] == 1
        assert body["verified"] == 1
        assert body["by_agency_type"]["local"] == 1


@pytest.mark.django_db
class TestCannonballAlerts:
    def test_list(self, api_client, sessions):
        _make_alert(sessions[0])
        response = api_client.get("/api/v1/cannonball/alerts/")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["count"] == 1
        assert body["unacknowledged"] == 1

    def test_acknowledge(self, api_client, sessions):
        alert = _make_alert(sessions[0])
        response = api_client.post(f"/api/v1/cannonball/alerts/{alert.id}/acknowledge/")
        assert response.status_code == status.HTTP_200_OK
        alert.refresh_from_db()
        assert alert.acknowledged is True

    def test_acknowledge_all(self, api_client, sessions):
        _make_alert(sessions[0])
        _make_alert(sessions[0])
        response = api_client.post("/api/v1/cannonball/alerts/acknowledge-all/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["acknowledged"] == 2
        assert CannonballAlert.objects.filter(acknowledged=False).count() == 0
