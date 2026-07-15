"""
End-to-end tests for safety API endpoints.

Tests for:
- SafetyEventViewSet
  - list (GET /api/v1/safety/events/)
  - retrieve (GET /api/v1/safety/events/{id}/)
  - stats (GET /api/v1/safety/events/stats/)
  - aircraft (GET /api/v1/safety/events/aircraft/)
  - acknowledge (POST /api/v1/safety/events/{id}/acknowledge/)
  - unacknowledge (DELETE /api/v1/safety/events/{id}/unacknowledge/)
  - delete (DELETE /api/v1/safety/events/{id}/)
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from skyspy.models import SafetyEvent


@pytest.mark.django_db
class TestSafetyEventListView:
    """Tests for the safety events list endpoint."""

    def test_list_returns_200(self, api_client):
        """Test that list returns 200 OK."""
        response = api_client.get("/api/v1/safety/events/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty(self, api_client):
        """Test list response when no events exist."""
        response = api_client.get("/api/v1/safety/events/")
        data = response.json()

        assert "events" in data
        assert "count" in data
        assert data["events"] == []
        assert data["count"] == 0

    def test_list_with_events(self, api_client):
        """Test list response with existing events."""
        SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            callsign="UAL123",
            message="TCAS RA: Climb",
        )
        SafetyEvent.objects.create(
            event_type="extreme_vs",
            severity="warning",
            icao_hex="DEF456",
            message="Extreme vertical speed detected",
        )

        response = api_client.get("/api/v1/safety/events/")
        data = response.json()

        assert data["count"] == 2
        assert len(data["events"]) == 2

    def test_list_event_structure(self, api_client):
        """Test that events have expected fields."""
        SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            icao_hex_2="DEF456",
            callsign="UAL123",
            callsign_2="DAL456",
            message="TCAS RA detected",
            details={"altitude_diff": 500},
            acknowledged=False,
        )

        response = api_client.get("/api/v1/safety/events/")
        event = response.json()["events"][0]

        expected_fields = [
            "id",
            "event_type",
            "severity",
            "icao",
            "icao_2",
            "callsign",
            "callsign_2",
            "message",
            "details",
            "aircraft_snapshot",
            "aircraft_snapshot_2",
            "acknowledged",
            "acknowledged_at",
            "timestamp",
        ]
        for field in expected_fields:
            assert field in event, f"Missing field: {field}"

    def test_list_filter_by_event_type(self, api_client):
        """Test filtering events by type."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="A")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="B")
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="C")

        response = api_client.get("/api/v1/safety/events/?event_type=tcas_ra")
        data = response.json()

        assert data["count"] == 2
        for event in data["events"]:
            assert event["event_type"] == "tcas_ra"

    def test_list_filter_by_severity(self, api_client):
        """Test filtering events by severity."""
        SafetyEvent.objects.create(event_type="tcas_ra", severity="critical", icao_hex="A")
        SafetyEvent.objects.create(event_type="extreme_vs", severity="warning", icao_hex="B")

        response = api_client.get("/api/v1/safety/events/?severity=critical")
        data = response.json()

        assert data["count"] == 1
        assert data["events"][0]["severity"] == "critical"

    def test_list_filter_by_icao(self, api_client):
        """Test filtering events by ICAO hex."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="ABC123")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="DEF456")

        response = api_client.get("/api/v1/safety/events/?icao_hex=ABC123")
        data = response.json()

        assert data["count"] == 1
        assert data["events"][0]["icao"] == "ABC123"

    def test_list_filter_by_acknowledged(self, api_client):
        """Test filtering events by acknowledged status."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="A", acknowledged=True)
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="B", acknowledged=False)

        response = api_client.get("/api/v1/safety/events/?acknowledged=true")
        data = response.json()

        assert data["count"] == 1
        assert data["events"][0]["acknowledged"]

    def test_list_time_filter(self, api_client):
        """Test filtering by time range."""
        # Create event outside time range
        old_event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            icao_hex="OLD123",
        )
        old_event.timestamp = timezone.now() - timedelta(hours=48)
        old_event.save()

        # Create recent event
        SafetyEvent.objects.create(
            event_type="extreme_vs",
            icao_hex="NEW123",
        )

        response = api_client.get("/api/v1/safety/events/?hours=24")
        data = response.json()

        assert data["count"] == 1
        assert data["events"][0]["icao"] == "NEW123"

    def test_list_ordered_by_timestamp(self, api_client):
        """Test that events are ordered by timestamp descending."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="FIRST")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="SECOND")

        response = api_client.get("/api/v1/safety/events/")
        data = response.json()

        # Most recent should be first
        assert data["events"][0]["icao"] == "SECOND"


@pytest.mark.django_db
class TestSafetyEventRetrieveView:
    """Tests for retrieving a single safety event."""

    @pytest.fixture(autouse=True)
    def setup_event(self):
        """Set up test fixtures."""
        self.event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            callsign="UAL123",
            message="TCAS RA: Climb",
        )

    def test_retrieve_existing_event(self, api_client):
        """Test retrieving an existing event."""
        response = api_client.get(f"/api/v1/safety/events/{self.event.id}/")
        assert response.status_code == status.HTTP_200_OK

    def test_retrieve_event_data(self, api_client):
        """Test that retrieved event has correct data."""
        response = api_client.get(f"/api/v1/safety/events/{self.event.id}/")
        data = response.json()

        assert data["event_type"] == "tcas_ra"
        assert data["severity"] == "critical"
        assert data["icao"] == "ABC123"
        assert data["callsign"] == "UAL123"
        assert data["message"] == "TCAS RA: Climb"

    def test_retrieve_nonexistent_event(self, api_client):
        """Test retrieving non-existent event returns 404."""
        response = api_client.get("/api/v1/safety/events/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestSafetyEventStatsView:
    """Tests for the safety events stats endpoint."""

    def test_stats_returns_200(self, api_client):
        """Test that stats returns 200 OK."""
        response = api_client.get("/api/v1/safety/events/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_stats_response_structure(self, api_client):
        """Test that stats response has expected fields."""
        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        expected_fields = [
            "monitoring_enabled",
            "thresholds",
            "time_range_hours",
            "events_by_type",
            "events_by_severity",
            "events_by_type_severity",
            "total_events",
            "unique_aircraft",
            "event_rate_per_hour",
            "top_aircraft",
            "recent_events",
            "timestamp",
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"

    def test_stats_thresholds(self, api_client):
        """Test that thresholds are included in stats."""
        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        thresholds = data["thresholds"]
        expected_thresholds = [
            "vs_change_threshold",
            "vs_extreme_threshold",
            "proximity_nm",
            "altitude_diff_ft",
            "closure_rate_kt",
            "tcas_vs_threshold",
        ]
        for threshold in expected_thresholds:
            assert threshold in thresholds

    def test_stats_counts_by_type(self, api_client):
        """Test that events are counted by type."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="A")
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="B")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="C")

        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        assert data["events_by_type"].get("tcas_ra", 0) == 2
        assert data["events_by_type"].get("extreme_vs", 0) == 1

    def test_stats_counts_by_severity(self, api_client):
        """Test that events are counted by severity."""
        SafetyEvent.objects.create(event_type="tcas_ra", severity="critical", icao_hex="A")
        SafetyEvent.objects.create(event_type="extreme_vs", severity="warning", icao_hex="B")
        SafetyEvent.objects.create(event_type="vs_reversal", severity="warning", icao_hex="C")

        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        assert data["events_by_severity"].get("critical", 0) == 1
        assert data["events_by_severity"].get("warning", 0) == 2

    def test_stats_unique_aircraft(self, api_client):
        """Test unique aircraft count."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="ABC123")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="ABC123")  # Same ICAO
        SafetyEvent.objects.create(event_type="vs_reversal", icao_hex="DEF456")

        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        assert data["unique_aircraft"] == 2

    def test_stats_total_events(self, api_client):
        """Test total events count."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="A")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="B")
        SafetyEvent.objects.create(event_type="vs_reversal", icao_hex="C")

        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        assert data["total_events"] == 3

    def test_stats_event_rate(self, api_client):
        """Test event rate per hour."""
        # Create 24 events for 24 hours = 1 per hour
        for i in range(24):
            SafetyEvent.objects.create(event_type="tcas_ra", icao_hex=f"AC{i}")

        response = api_client.get("/api/v1/safety/events/stats/?hours=24")
        data = response.json()

        assert data["event_rate_per_hour"] == 1.0

    def test_stats_top_aircraft(self, api_client):
        """Test top aircraft list."""
        # Create multiple events for same aircraft
        for _ in range(5):
            SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="FREQUENT")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="SINGLE")

        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        # FREQUENT should be first in top_aircraft
        assert len(data["top_aircraft"]) > 0
        assert data["top_aircraft"][0]["icao_hex"] == "FREQUENT"
        assert data["top_aircraft"][0]["count"] == 5

    def test_stats_recent_events(self, api_client):
        """Test recent events list."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="A")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="B")

        response = api_client.get("/api/v1/safety/events/stats/")
        data = response.json()

        # Should have recent events
        assert isinstance(data["recent_events"], list)

    def test_stats_time_filter(self, api_client):
        """Test that stats respect time filter."""
        # Create old event
        old_event = SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="OLD")
        old_event.timestamp = timezone.now() - timedelta(hours=48)
        old_event.save()

        # Create recent event
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="NEW")

        response = api_client.get("/api/v1/safety/events/stats/?hours=24")
        data = response.json()

        assert data["total_events"] == 1


@pytest.mark.django_db
class TestSafetyEventAircraftStatsView:
    """Tests for the safety events aircraft stats endpoint."""

    def test_aircraft_stats_returns_200(self, api_client):
        """Test that aircraft stats returns 200 OK."""
        response = api_client.get("/api/v1/safety/events/aircraft/")
        assert response.status_code == status.HTTP_200_OK

    def test_aircraft_stats_response_structure(self, api_client):
        """Test that response has expected structure."""
        response = api_client.get("/api/v1/safety/events/aircraft/")
        data = response.json()

        assert "aircraft" in data
        assert "total_aircraft" in data
        assert "time_range_hours" in data
        assert "timestamp" in data

    def test_aircraft_stats_empty(self, api_client):
        """Test aircraft stats with no events."""
        response = api_client.get("/api/v1/safety/events/aircraft/")
        data = response.json()

        assert data["aircraft"] == []
        assert data["total_aircraft"] == 0

    def test_aircraft_stats_with_events(self, api_client):
        """Test aircraft stats with events."""
        SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            callsign="UAL123",
        )
        SafetyEvent.objects.create(
            event_type="extreme_vs",
            severity="warning",
            icao_hex="ABC123",
            callsign="UAL123",
        )

        response = api_client.get("/api/v1/safety/events/aircraft/")
        data = response.json()

        assert data["total_aircraft"] == 1
        assert len(data["aircraft"]) == 1

        aircraft = data["aircraft"][0]
        assert aircraft["icao_hex"] == "ABC123"
        assert aircraft["total_events"] == 2

    def test_aircraft_stats_structure(self, api_client):
        """Test that aircraft stats have expected fields."""
        SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            callsign="UAL123",
        )

        response = api_client.get("/api/v1/safety/events/aircraft/")
        aircraft = response.json()["aircraft"][0]

        expected_fields = [
            "icao_hex",
            "callsign",
            "total_events",
            "events_by_type",
            "events_by_severity",
            "worst_severity",
            "last_event_time",
            "last_event_type",
        ]
        for field in expected_fields:
            assert field in aircraft, f"Missing field: {field}"

    def test_aircraft_stats_worst_severity(self, api_client):
        """Test worst severity calculation."""
        SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
        )
        SafetyEvent.objects.create(
            event_type="extreme_vs",
            severity="warning",
            icao_hex="ABC123",
        )

        response = api_client.get("/api/v1/safety/events/aircraft/")
        aircraft = response.json()["aircraft"][0]

        assert aircraft["worst_severity"] == "critical"

    def test_aircraft_stats_ordered_by_event_count(self, api_client):
        """Test that aircraft are ordered by event count."""
        for _ in range(5):
            SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="FREQUENT")
        for _ in range(2):
            SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="MODERATE")
        SafetyEvent.objects.create(event_type="vs_reversal", icao_hex="RARE")

        response = api_client.get("/api/v1/safety/events/aircraft/")
        data = response.json()

        assert data["aircraft"][0]["icao_hex"] == "FREQUENT"
        assert data["aircraft"][0]["total_events"] == 5


@pytest.mark.django_db
class TestSafetyEventAcknowledgeView:
    """Tests for the safety event acknowledge endpoint."""

    @pytest.fixture(autouse=True)
    def setup_event(self):
        """Set up test fixtures."""
        self.event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            acknowledged=False,
        )

    def test_acknowledge_event(self, api_client):
        """Test acknowledging an event."""
        response = api_client.post(f"/api/v1/safety/events/{self.event.id}/acknowledge/")
        assert response.status_code == status.HTTP_200_OK

        self.event.refresh_from_db()
        assert self.event.acknowledged

    def test_acknowledge_sets_timestamp(self, api_client):
        """Test that acknowledge sets acknowledged_at timestamp."""
        assert self.event.acknowledged_at is None

        api_client.post(f"/api/v1/safety/events/{self.event.id}/acknowledge/")

        self.event.refresh_from_db()
        assert self.event.acknowledged_at is not None

    def test_acknowledge_returns_event(self, api_client):
        """Test that acknowledge returns the updated event."""
        response = api_client.post(f"/api/v1/safety/events/{self.event.id}/acknowledge/")
        data = response.json()

        assert data["acknowledged"]
        assert data["acknowledged_at"] is not None

    def test_acknowledge_nonexistent_event(self, api_client):
        """Test acknowledging non-existent event returns 404."""
        response = api_client.post("/api/v1/safety/events/99999/acknowledge/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_acknowledge_already_acknowledged(self, api_client):
        """Test acknowledging an already acknowledged event."""
        self.event.acknowledged = True
        self.event.acknowledged_at = timezone.now()
        self.event.save()

        response = api_client.post(f"/api/v1/safety/events/{self.event.id}/acknowledge/")
        assert response.status_code == status.HTTP_200_OK

        # Should still be acknowledged
        self.event.refresh_from_db()
        assert self.event.acknowledged


@pytest.mark.django_db
class TestSafetyEventUnacknowledgeView:
    """Tests for the safety event unacknowledge endpoint."""

    @pytest.fixture(autouse=True)
    def setup_event(self):
        """Set up test fixtures."""
        self.event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="ABC123",
            acknowledged=True,
            acknowledged_at=timezone.now(),
        )

    def test_unacknowledge_event(self, api_client):
        """Test unacknowledging an event."""
        response = api_client.delete(f"/api/v1/safety/events/{self.event.id}/unacknowledge/")
        assert response.status_code == status.HTTP_200_OK

        self.event.refresh_from_db()
        assert not self.event.acknowledged

    def test_unacknowledge_clears_timestamp(self, api_client):
        """Test that unacknowledge clears acknowledged_at timestamp."""
        assert self.event.acknowledged_at is not None

        api_client.delete(f"/api/v1/safety/events/{self.event.id}/unacknowledge/")

        self.event.refresh_from_db()
        assert self.event.acknowledged_at is None

    def test_unacknowledge_returns_event(self, api_client):
        """Test that unacknowledge returns the updated event."""
        response = api_client.delete(f"/api/v1/safety/events/{self.event.id}/unacknowledge/")
        data = response.json()

        assert not data["acknowledged"]
        assert data["acknowledged_at"] is None

    def test_unacknowledge_nonexistent_event(self, api_client):
        """Test unacknowledging non-existent event returns 404."""
        response = api_client.delete("/api/v1/safety/events/99999/unacknowledge/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestSafetyEventDeleteView:
    """Tests for deleting safety events.

    Deletes always require authentication (even in public mode) - safety
    events are system-generated emergency records.
    """

    @pytest.fixture(autouse=True)
    def setup_event(self):
        """Set up test fixtures."""
        from django.contrib.auth.models import User

        self.event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            icao_hex="ABC123",
        )
        self.user = User.objects.create_user(username="safety_deleter", password="testpass")

    def test_delete_event(self, api_client):
        """Test deleting an event."""
        api_client.force_authenticate(user=self.user)
        response = api_client.delete(f"/api/v1/safety/events/{self.event.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_delete_removes_from_db(self, api_client):
        """Test that delete removes event from database."""
        api_client.force_authenticate(user=self.user)
        event_id = self.event.id
        api_client.delete(f"/api/v1/safety/events/{event_id}/")

        assert not SafetyEvent.objects.filter(id=event_id).exists()

    def test_delete_nonexistent_event(self, api_client):
        """Test deleting non-existent event returns 404."""
        api_client.force_authenticate(user=self.user)
        response = api_client.delete("/api/v1/safety/events/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_delete_requires_authentication(self, api_client):
        """Test that anonymous clients cannot delete safety events."""
        response = api_client.delete(f"/api/v1/safety/events/{self.event.id}/")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
        assert SafetyEvent.objects.filter(id=self.event.id).exists()


@pytest.mark.django_db
class TestSafetyEventValidation:
    """Tests for safety event validation."""

    def test_event_types(self):
        """Test that all event types are valid."""
        valid_types = [
            "tcas_ra",
            "tcas_ta",
            "extreme_vs",
            "vs_reversal",
            "proximity_conflict",
            "emergency_squawk",
            "7500",
            "7600",
            "7700",
        ]

        for event_type in valid_types:
            event = SafetyEvent.objects.create(
                event_type=event_type,
                icao_hex="TEST123",
            )
            assert event.event_type == event_type

    def test_severity_levels(self):
        """Test that all severity levels are valid."""
        valid_severities = ["info", "warning", "critical"]

        for severity in valid_severities:
            event = SafetyEvent.objects.create(
                event_type="tcas_ra",
                severity=severity,
                icao_hex="TEST123",
            )
            assert event.severity == severity


@pytest.mark.django_db
class TestSafetyEventsIntegration:
    """Integration tests for safety events endpoints."""

    def test_acknowledge_workflow(self, api_client):
        """Test complete acknowledge/unacknowledge workflow."""
        # Create event
        event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            icao_hex="ABC123",
            acknowledged=False,
        )

        # Acknowledge
        ack_response = api_client.post(f"/api/v1/safety/events/{event.id}/acknowledge/")
        assert ack_response.status_code == status.HTTP_200_OK
        assert ack_response.json()["acknowledged"]

        # Verify in list
        list_response = api_client.get("/api/v1/safety/events/?acknowledged=true")
        assert list_response.json()["count"] == 1

        # Unacknowledge
        unack_response = api_client.delete(f"/api/v1/safety/events/{event.id}/unacknowledge/")
        assert unack_response.status_code == status.HTTP_200_OK
        assert not unack_response.json()["acknowledged"]

        # Verify in list
        list_response = api_client.get("/api/v1/safety/events/?acknowledged=false")
        assert list_response.json()["count"] == 1

    def test_stats_consistency(self, api_client):
        """Test that stats are consistent with list data."""
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="A")
        SafetyEvent.objects.create(event_type="extreme_vs", icao_hex="B")
        SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="C")

        list_response = api_client.get("/api/v1/safety/events/")
        stats_response = api_client.get("/api/v1/safety/events/stats/")

        list_count = list_response.json()["count"]
        stats_total = stats_response.json()["total_events"]

        assert list_count == stats_total

    def test_all_endpoints_return_json(self, api_client):
        """Test that all endpoints return JSON."""
        event = SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="ABC123")

        endpoints = [
            "/api/v1/safety/events/",
            f"/api/v1/safety/events/{event.id}/",
            "/api/v1/safety/events/stats/",
            "/api/v1/safety/events/aircraft/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response["Content-Type"] == "application/json", f"Endpoint {endpoint} should return JSON"

    def test_no_authentication_required(self, api_client):
        """Test that no authentication is required."""
        api_client.credentials()

        event = SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="ABC123")

        endpoints = [
            "/api/v1/safety/events/",
            f"/api/v1/safety/events/{event.id}/",
            "/api/v1/safety/events/stats/",
            "/api/v1/safety/events/aircraft/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response.status_code not in [
                status.HTTP_401_UNAUTHORIZED,
                status.HTTP_403_FORBIDDEN,
            ], f"{endpoint} should not require authentication"

    def test_http_methods_restricted(self, api_client):
        """Test that only allowed HTTP methods work."""
        # POST should not be allowed on list endpoint (events are created by system)
        # Note: SafetyEventViewSet has http_method_names = ['get', 'post', 'delete']
        # POST is for acknowledge action, not creating events via list
        event = SafetyEvent.objects.create(event_type="tcas_ra", icao_hex="ABC123")

        # PUT should not be allowed
        response = api_client.put(f"/api/v1/safety/events/{event.id}/", {"event_type": "extreme_vs"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
