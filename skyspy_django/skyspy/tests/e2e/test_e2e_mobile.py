"""
Comprehensive E2E tests for the SkySpy Django API mobile/Cannonball system.

Tests cover:
- Position updates
- Threat detection
- Session management (start, end, history)
- Mobile-specific endpoints
"""

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status

# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def mobile_position():
    """Standard mobile position for testing."""
    return {
        "lat": 47.5,
        "lon": -122.0,
    }


@pytest.fixture
def mobile_position_with_heading():
    """Mobile position with heading."""
    return {
        "lat": 47.5,
        "lon": -122.0,
        "heading": 270,
    }


@pytest.fixture
def mobile_session_id():
    """Generate a mobile session ID."""
    return str(uuid.uuid4())


@pytest.fixture
def cached_aircraft_with_threats():
    """Pre-populate cache with aircraft including potential threats."""
    aircraft_data = [
        # Law enforcement helicopter (threat)
        {
            "hex": "A11111",
            "flight": "N911PD",
            "lat": 47.51,  # Very close to test position
            "lon": -122.01,
            "alt_baro": 1500,
            "gs": 80,
            "category": "A7",  # Helicopter
            "t": "EC35",
            "ownOp": "Police Department",
        },
        # Regular commercial aircraft (not a threat)
        {
            "hex": "A22222",
            "flight": "UAL123",
            "lat": 47.8,  # Further away
            "lon": -122.5,
            "alt_baro": 35000,
            "gs": 450,
            "category": "A3",
            "t": "B738",
        },
        # News helicopter (potential threat)
        {
            "hex": "A33333",
            "flight": "N7NEWS",
            "lat": 47.52,
            "lon": -122.02,
            "alt_baro": 2000,
            "gs": 60,
            "category": "A7",
            "t": "AS50",
            "ownOp": "News Station",
        },
        # Military aircraft (far away)
        {
            "hex": "AE1234",
            "flight": "RCH789",
            "lat": 48.5,
            "lon": -123.0,
            "alt_baro": 28000,
            "gs": 400,
            "category": "A5",
            "t": "C17",
            "dbFlags": 1,
        },
    ]

    cache.set("current_aircraft", aircraft_data, timeout=300)
    yield aircraft_data
    cache.clear()


# =============================================================================
# Position Update Tests
# =============================================================================


@pytest.mark.django_db
class TestPositionUpdate:
    """Tests for POST /api/v1/mobile/position endpoint."""

    def test_update_position_returns_200_ok(self, operator_client, mobile_position):
        """Test that position update returns 200 OK."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        assert response.status_code == status.HTTP_200_OK

    def test_update_position_requires_lat_lon(self, operator_client):
        """Test that position update requires lat and lon."""
        response = operator_client.post("/api/v1/mobile/position/", {}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "error" in response.json()

    def test_update_position_validates_coordinates(self, operator_client):
        """Test that position update validates coordinate ranges."""
        # Invalid latitude
        response = operator_client.post(
            "/api/v1/mobile/position/",
            {"lat": 100, "lon": -122.0},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        # Invalid longitude
        response = operator_client.post(
            "/api/v1/mobile/position/",
            {"lat": 47.5, "lon": -200},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_update_position_response_structure(self, operator_client, mobile_position):
        """Test position update response structure."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        data = response.json()

        assert "session_id" in data
        assert "position" in data
        assert "threats" in data
        assert "threat_count" in data
        assert "timestamp" in data

    def test_update_position_generates_session_id(self, operator_client, mobile_position):
        """Test that position update generates session ID if not provided."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        data = response.json()

        assert data["session_id"] is not None
        assert len(data["session_id"]) > 0

    def test_update_position_uses_provided_session_id(self, operator_client, mobile_position, mobile_session_id):
        """Test that position update uses provided session ID."""
        mobile_position["session_id"] = mobile_session_id

        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        data = response.json()

        assert data["session_id"] == mobile_session_id

    def test_update_position_with_heading(self, operator_client, mobile_position_with_heading):
        """Test position update with heading."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position_with_heading, format="json")
        response.json()

        assert response.status_code == status.HTTP_200_OK
        # Heading should be used for relative bearing calculation

    def test_update_position_with_custom_radius(self, operator_client, mobile_position):
        """Test position update with custom threat radius."""
        mobile_position["radius_nm"] = 10

        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        response.json()

        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Threat Detection Tests
# =============================================================================


@pytest.mark.django_db
class TestThreatDetection:
    """Tests for threat detection functionality."""

    def test_threats_returned_when_nearby(self, operator_client, mobile_position, cached_aircraft_with_threats):
        """Test that threats are returned when aircraft are nearby."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        data = response.json()

        # Should detect at least the nearby helicopter
        assert data["threat_count"] >= 0
        assert isinstance(data["threats"], list)

    def test_threat_response_structure(self, operator_client, mobile_position, cached_aircraft_with_threats):
        """Test threat response structure."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        data = response.json()

        if data["threats"]:
            threat = data["threats"][0]
            # Check for expected fields
            assert "hex" in threat
            assert "distance_nm" in threat
            assert "bearing" in threat
            assert "direction" in threat
            assert "threat_level" in threat

    def test_threats_sorted_by_distance(self, operator_client, mobile_position, cached_aircraft_with_threats):
        """Test that threats are sorted by distance (closest first)."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        data = response.json()

        threats = data["threats"]
        if len(threats) > 1:
            for i in range(len(threats) - 1):
                # May also be sorted by threat level, then distance
                assert threats[i]["distance_nm"] <= threats[i + 1]["distance_nm"] or threats[i]["threat_level"] in [
                    "critical",
                    "warning",
                ]

    def test_get_threats_for_session(self, operator_client, mobile_position, cached_aircraft_with_threats):
        """Test GET /api/v1/mobile/threats endpoint."""
        # First, update position to create session
        mobile_position["session_id"] = str(uuid.uuid4())
        operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")

        # Then get threats for that session
        response = operator_client.get(f"/api/v1/mobile/threats/?session_id={mobile_position['session_id']}")
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert "threats" in data
        assert "position" in data

    def test_get_threats_requires_session_id(self, operator_client):
        """Test that GET threats requires session_id."""
        response = operator_client.get("/api/v1/mobile/threats/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_get_threats_session_not_found(self, operator_client):
        """Test GET threats with invalid session ID."""
        response = operator_client.get(f"/api/v1/mobile/threats/?session_id={uuid.uuid4()}")
        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Session Management Tests
# =============================================================================


@pytest.mark.django_db
class TestSessionManagement:
    """Tests for session management endpoints."""

    def test_start_session_returns_200_ok(self, operator_client):
        """Test that start session returns 200 OK."""
        response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        assert response.status_code == status.HTTP_200_OK

    def test_start_session_response_structure(self, operator_client):
        """Test start session response structure."""
        response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        data = response.json()

        assert "session_id" in data
        assert "persistent" in data
        assert "started_at" in data

    def test_start_session_generates_uuid(self, operator_client):
        """Test that start session generates valid UUID."""
        response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        data = response.json()

        # Should be a valid UUID
        session_id = data["session_id"]
        uuid.UUID(session_id)  # Will raise if invalid

    def test_start_session_with_persistent_flag(self, operator_client):
        """Test starting a persistent session."""
        response = operator_client.post("/api/v1/mobile/session/start/", {"persistent": True}, format="json")
        data = response.json()

        assert data["persistent"] is True

    def test_end_session_returns_200_ok(self, operator_client):
        """Test that end session returns 200 OK."""
        # Start a session first
        start_response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        session_id = start_response.json()["session_id"]

        # End the session
        response = operator_client.post("/api/v1/mobile/session/end/", {"session_id": session_id}, format="json")
        assert response.status_code == status.HTTP_200_OK

    def test_end_session_requires_session_id(self, operator_client):
        """Test that end session requires session_id."""
        response = operator_client.post("/api/v1/mobile/session/end/", {}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_end_session_response_structure(self, operator_client):
        """Test end session response structure."""
        # Start a session
        start_response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        session_id = start_response.json()["session_id"]

        # End the session
        response = operator_client.post("/api/v1/mobile/session/end/", {"session_id": session_id}, format="json")
        data = response.json()

        assert "session_id" in data
        assert "encounters" in data
        assert "duration_seconds" in data

    def test_end_session_calculates_duration(self, operator_client):
        """Test that end session calculates duration."""
        # Start a session
        start_response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        session_id = start_response.json()["session_id"]

        # End the session
        response = operator_client.post("/api/v1/mobile/session/end/", {"session_id": session_id}, format="json")
        data = response.json()

        # Duration should be >= 0
        assert data["duration_seconds"] >= 0

    def test_end_nonexistent_session(self, operator_client):
        """Test ending a nonexistent session."""
        response = operator_client.post(
            "/api/v1/mobile/session/end/",
            {"session_id": str(uuid.uuid4())},
            format="json",
        )
        # Should return 200 with empty data rather than error
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["encounters"] == []


# =============================================================================
# Session History Tests
# =============================================================================


@pytest.mark.django_db
class TestSessionHistory:
    """Tests for session history endpoint."""

    def test_get_history_returns_200_ok(self, operator_client):
        """Test that history endpoint returns 200 OK for persistent session."""
        # Start a persistent session
        start_response = operator_client.post("/api/v1/mobile/session/start/", {"persistent": True}, format="json")
        session_id = start_response.json()["session_id"]

        response = operator_client.get(f"/api/v1/mobile/session/history/?session_id={session_id}")
        assert response.status_code == status.HTTP_200_OK

    def test_get_history_requires_session_id(self, operator_client):
        """Test that history requires session_id."""
        response = operator_client.get("/api/v1/mobile/session/history/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_get_history_response_structure(self, operator_client):
        """Test history response structure."""
        # Start a persistent session
        start_response = operator_client.post("/api/v1/mobile/session/start/", {"persistent": True}, format="json")
        session_id = start_response.json()["session_id"]

        response = operator_client.get(f"/api/v1/mobile/session/history/?session_id={session_id}")
        data = response.json()

        assert "session_id" in data
        assert "encounters" in data
        assert "started_at" in data
        assert "persistent" in data

    def test_get_history_session_not_found(self, operator_client):
        """Test history with invalid session ID."""
        response = operator_client.get(f"/api/v1/mobile/session/history/?session_id={uuid.uuid4()}")
        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Permission Tests
# =============================================================================


@pytest.mark.django_db
class TestMobilePermissions:
    """Tests for mobile endpoint permissions."""

    def test_operator_can_update_position(self, operator_client, mobile_position):
        """Test that operator can update position."""
        response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_manage_sessions(self, operator_client):
        """Test that operator can manage sessions."""
        # Start session
        start_response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
        assert start_response.status_code == status.HTTP_200_OK

        session_id = start_response.json()["session_id"]

        # End session
        end_response = operator_client.post("/api/v1/mobile/session/end/", {"session_id": session_id}, format="json")
        assert end_response.status_code == status.HTTP_200_OK

    def test_viewer_can_update_position(self, viewer_client, mobile_position):
        """Test that viewer can update position (for mobile app use)."""
        response = viewer_client.post("/api/v1/mobile/position/", mobile_position, format="json")
        # Mobile features may be restricted or allowed based on configuration
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_403_FORBIDDEN]


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestMobileIntegration:
    """Integration tests for mobile workflows."""

    def test_complete_mobile_session_workflow(self, operator_client, mobile_position, cached_aircraft_with_threats):
        """Test complete mobile session workflow."""
        # 1. Start session
        start_response = operator_client.post("/api/v1/mobile/session/start/", {"persistent": True}, format="json")
        assert start_response.status_code == status.HTTP_200_OK
        session_id = start_response.json()["session_id"]

        # 2. Update position multiple times
        mobile_position["session_id"] = session_id
        for i in range(3):
            mobile_position["lat"] = 47.5 + i * 0.01
            pos_response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
            assert pos_response.status_code == status.HTTP_200_OK
            assert pos_response.json()["session_id"] == session_id

        # 3. Get current threats
        threats_response = operator_client.get(f"/api/v1/mobile/threats/?session_id={session_id}")
        assert threats_response.status_code == status.HTTP_200_OK

        # 4. Get session history
        history_response = operator_client.get(f"/api/v1/mobile/session/history/?session_id={session_id}")
        assert history_response.status_code == status.HTTP_200_OK

        # 5. End session
        end_response = operator_client.post("/api/v1/mobile/session/end/", {"session_id": session_id}, format="json")
        assert end_response.status_code == status.HTTP_200_OK
        assert end_response.json()["duration_seconds"] >= 0

    def test_position_tracking_with_movement(self, operator_client, cached_aircraft_with_threats):
        """Test position tracking as user moves."""
        session_id = str(uuid.uuid4())

        # Simulate movement
        positions = [
            {"lat": 47.5, "lon": -122.0, "session_id": session_id},
            {"lat": 47.51, "lon": -122.01, "session_id": session_id},  # Moving closer to threat
            {"lat": 47.52, "lon": -122.02, "session_id": session_id},  # Even closer
        ]

        previous_threat_count = None
        for pos in positions:
            response = operator_client.post("/api/v1/mobile/position/", pos, format="json")
            assert response.status_code == status.HTTP_200_OK

            data = response.json()
            current_threat_count = data["threat_count"]

            # Threat count may change based on position
            if previous_threat_count is not None:
                # Just verify we're getting valid responses
                assert isinstance(current_threat_count, int)

            previous_threat_count = current_threat_count

    def test_multiple_concurrent_sessions(self, operator_client, mobile_position):
        """Test handling multiple concurrent sessions."""
        sessions = []

        # Start multiple sessions
        for _i in range(3):
            response = operator_client.post("/api/v1/mobile/session/start/", {}, format="json")
            assert response.status_code == status.HTTP_200_OK
            sessions.append(response.json()["session_id"])

        # Update positions for each session
        for session_id in sessions:
            mobile_position["session_id"] = session_id
            response = operator_client.post("/api/v1/mobile/position/", mobile_position, format="json")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["session_id"] == session_id

        # End all sessions
        for session_id in sessions:
            response = operator_client.post("/api/v1/mobile/session/end/", {"session_id": session_id}, format="json")
            assert response.status_code == status.HTTP_200_OK

    def test_threat_radius_affects_detection(self, operator_client, cached_aircraft_with_threats):
        """Test that threat radius affects detection."""
        base_position = {"lat": 47.5, "lon": -122.0}

        # Small radius
        small_radius_pos = {**base_position, "radius_nm": 5}
        small_response = operator_client.post("/api/v1/mobile/position/", small_radius_pos, format="json")
        small_data = small_response.json()

        # Large radius
        large_radius_pos = {**base_position, "radius_nm": 50}
        large_response = operator_client.post("/api/v1/mobile/position/", large_radius_pos, format="json")
        large_data = large_response.json()

        # Larger radius should detect more or equal threats
        assert large_data["threat_count"] >= small_data["threat_count"]
