"""
End-to-end tests for Safety API endpoints.

Tests all safety monitoring endpoints including:
- Safety events queries
- Event details
- Safety statistics
- Per-aircraft safety stats
- Monitor control (enable/disable)
- Active events management
- Event acknowledgment
"""
import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.models import SafetyEvent


@pytest.mark.asyncio
class TestSafetyEventsEndpoint:
    """Tests for GET /api/v1/safety/events endpoint."""

    async def test_get_events_empty(self, client: AsyncClient):
        """Test GET /api/v1/safety/events returns empty list when no events."""
        response = await client.get("/api/v1/safety/events")

        assert response.status_code == 200
        data = response.json()
        assert "events" in data
        assert isinstance(data["events"], list)
        assert "count" in data
        assert data["count"] == 0

    async def test_get_events_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events returns event data."""
        now = datetime.utcnow()
        events = [
            SafetyEvent(
                event_type="tcas_ra",
                severity="critical",
                icao_hex="A12345",
                callsign="UAL123",
                message="TCAS RA: Climb",
                details={"action": "climb", "altitude": 35000},
                timestamp=now - timedelta(hours=1)
            ),
            SafetyEvent(
                event_type="extreme_vs",
                severity="warning",
                icao_hex="B67890",
                callsign="DAL456",
                message="Extreme vertical speed: -4500 ft/min",
                details={"vertical_rate": -4500, "altitude": 25000},
                timestamp=now - timedelta(hours=2)
            ),
        ]
        for e in events:
            db_session.add(e)
        await db_session.commit()

        response = await client.get("/api/v1/safety/events")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2

    async def test_get_events_response_structure(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events returns correct structure."""
        now = datetime.utcnow()
        event = SafetyEvent(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="A12345",
            icao_hex_2="B67890",
            callsign="UAL123",
            callsign_2="DAL456",
            message="TCAS RA between UAL123 and DAL456",
            details={"separation_nm": 0.5, "altitude_diff": 500},
            aircraft_snapshot={"altitude": 35000, "gs": 450},
            aircraft_snapshot_2={"altitude": 34500, "gs": 420},
            timestamp=now
        )
        db_session.add(event)
        await db_session.commit()

        response = await client.get("/api/v1/safety/events")

        assert response.status_code == 200
        data = response.json()

        if data["events"]:
            e = data["events"][0]
            expected_fields = [
                "id", "event_type", "severity", "icao", "callsign",
                "message", "details", "timestamp"
            ]
            for field in expected_fields:
                assert field in e, f"Missing field: {field}"

    async def test_get_events_filter_by_type(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events?event_type=... filters correctly."""
        now = datetime.utcnow()
        events = [
            SafetyEvent(event_type="tcas_ra", severity="critical", icao_hex="A11111", timestamp=now),
            SafetyEvent(event_type="tcas_ta", severity="warning", icao_hex="A22222", timestamp=now),
            SafetyEvent(event_type="extreme_vs", severity="warning", icao_hex="A33333", timestamp=now),
            SafetyEvent(event_type="proximity", severity="warning", icao_hex="A44444", timestamp=now),
        ]
        for e in events:
            db_session.add(e)
        await db_session.commit()

        response = await client.get("/api/v1/safety/events?event_type=tcas_ra")

        assert response.status_code == 200
        data = response.json()
        assert all(e["event_type"] == "tcas_ra" for e in data["events"])

    async def test_get_events_filter_by_severity(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events?severity=... filters correctly."""
        now = datetime.utcnow()
        events = [
            SafetyEvent(event_type="tcas_ra", severity="critical", icao_hex="CRIT01", timestamp=now),
            SafetyEvent(event_type="tcas_ta", severity="warning", icao_hex="WARN01", timestamp=now),
            SafetyEvent(event_type="extreme_vs", severity="info", icao_hex="INFO01", timestamp=now),
        ]
        for e in events:
            db_session.add(e)
        await db_session.commit()

        response = await client.get("/api/v1/safety/events?severity=critical")

        assert response.status_code == 200
        data = response.json()
        assert all(e["severity"] == "critical" for e in data["events"])

    async def test_get_events_filter_by_icao(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events?icao_hex=... filters correctly."""
        now = datetime.utcnow()
        events = [
            SafetyEvent(event_type="tcas_ra", severity="critical", icao_hex="TARGET", timestamp=now),
            SafetyEvent(event_type="proximity", severity="warning", icao_hex="OTHER1", icao_hex_2="TARGET", timestamp=now),
            SafetyEvent(event_type="extreme_vs", severity="warning", icao_hex="OTHER2", timestamp=now),
        ]
        for e in events:
            db_session.add(e)
        await db_session.commit()

        response = await client.get("/api/v1/safety/events?icao_hex=TARGET")

        assert response.status_code == 200
        data = response.json()
        # Should include events where icao_hex OR icao_hex_2 matches
        for e in data["events"]:
            assert e.get("icao") == "TARGET" or e.get("icao_2") == "TARGET"

    async def test_get_events_hours_filter(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events?hours=... filters correctly."""
        now = datetime.utcnow()
        recent = SafetyEvent(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="RECENT",
            timestamp=now - timedelta(hours=2)
        )
        old = SafetyEvent(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="OLDONE",
            timestamp=now - timedelta(hours=48)
        )
        db_session.add_all([recent, old])
        await db_session.commit()

        response = await client.get("/api/v1/safety/events?hours=24")

        assert response.status_code == 200
        data = response.json()
        icaos = [e["icao"] for e in data["events"]]
        assert "RECENT" in icaos
        assert "OLDONE" not in icaos

    async def test_get_events_limit(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events?limit=... works correctly."""
        now = datetime.utcnow()
        for i in range(15):
            e = SafetyEvent(
                event_type="extreme_vs",
                severity="warning",
                icao_hex=f"LIMIT{i:02d}",
                timestamp=now - timedelta(minutes=i)
            )
            db_session.add(e)
        await db_session.commit()

        response = await client.get("/api/v1/safety/events?limit=5")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 5


@pytest.mark.asyncio
class TestSafetyEventByIdEndpoint:
    """Tests for GET /api/v1/safety/events/{event_id} endpoint."""

    async def test_get_event_found(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/events/{id} returns event when found."""
        now = datetime.utcnow()
        event = SafetyEvent(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="A12345",
            callsign="UAL123",
            message="TCAS RA: Climb",
            timestamp=now
        )
        db_session.add(event)
        await db_session.commit()
        await db_session.refresh(event)

        response = await client.get(f"/api/v1/safety/events/{event.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == event.id
        assert data["event_type"] == "tcas_ra"
        assert data["icao"] == "A12345"

    async def test_get_event_not_found(self, client: AsyncClient):
        """Test GET /api/v1/safety/events/{id} returns 404 when not found."""
        response = await client.get("/api/v1/safety/events/999999")

        assert response.status_code == 404

    async def test_get_event_invalid_id(self, client: AsyncClient):
        """Test GET /api/v1/safety/events/{id} validates ID."""
        # ID must be >= 1
        response = await client.get("/api/v1/safety/events/0")
        assert response.status_code == 422


@pytest.mark.asyncio
class TestSafetyStatsEndpoint:
    """Tests for GET /api/v1/safety/stats endpoint."""

    async def test_get_stats_returns_503_when_cache_empty(self, client: AsyncClient):
        """Test GET /api/v1/safety/stats returns 503 when cache empty."""
        with patch('app.services.stats_cache.get_safety_stats', return_value=None):
            response = await client.get("/api/v1/safety/stats")

            assert response.status_code in [200, 503]

    async def test_get_stats_returns_cached_data(self, client: AsyncClient):
        """Test GET /api/v1/safety/stats returns cached statistics."""
        mock_stats = {
            "monitoring_enabled": True,
            "thresholds": {
                "vs_change": 3000,
                "vs_extreme": 4500,
                "proximity_nm": 1.0,
                "altitude_diff_ft": 1000
            },
            "time_range_hours": 24,
            "events_by_type": {"tcas_ra": 2, "extreme_vs": 5},
            "events_by_severity": {"critical": 2, "warning": 5},
            "events_by_type_severity": {"tcas_ra": {"critical": 2}},
            "total_events": 7,
            "unique_aircraft": 5,
            "event_rate_per_hour": 0.29,
            "events_by_hour": [],
            "top_aircraft": [],
            "recent_events": [],
            "monitor_state": {"tracked_aircraft": 45},
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        with patch('app.services.stats_cache.get_safety_stats', return_value=mock_stats):
            response = await client.get("/api/v1/safety/stats")

            assert response.status_code == 200
            data = response.json()
            assert data["monitoring_enabled"] is True
            assert data["total_events"] == 7


@pytest.mark.asyncio
class TestAircraftSafetyStatsEndpoint:
    """Tests for GET /api/v1/safety/stats/aircraft endpoint."""

    async def test_get_aircraft_stats_empty(self, client: AsyncClient):
        """Test GET /api/v1/safety/stats/aircraft returns empty when no events."""
        response = await client.get("/api/v1/safety/stats/aircraft")

        assert response.status_code == 200
        data = response.json()
        assert "aircraft" in data
        assert "total_aircraft" in data
        assert "time_range_hours" in data
        assert "timestamp" in data

    async def test_get_aircraft_stats_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/stats/aircraft returns per-aircraft stats."""
        now = datetime.utcnow()
        events = [
            SafetyEvent(event_type="tcas_ra", severity="critical", icao_hex="MULTI1", callsign="TST001", timestamp=now),
            SafetyEvent(event_type="extreme_vs", severity="warning", icao_hex="MULTI1", callsign="TST001", timestamp=now - timedelta(hours=1)),
            SafetyEvent(event_type="proximity", severity="warning", icao_hex="MULTI1", icao_hex_2="MULTI2", callsign="TST001", callsign_2="TST002", timestamp=now - timedelta(hours=2)),
            SafetyEvent(event_type="tcas_ta", severity="info", icao_hex="SINGLE", timestamp=now),
        ]
        for e in events:
            db_session.add(e)
        await db_session.commit()

        response = await client.get("/api/v1/safety/stats/aircraft")

        assert response.status_code == 200
        data = response.json()
        assert data["total_aircraft"] >= 2

        # Find aircraft with multiple events
        multi1 = next((a for a in data["aircraft"] if a["icao_hex"] == "MULTI1"), None)
        assert multi1 is not None
        assert multi1["total_events"] >= 3

    async def test_get_aircraft_stats_filters(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/safety/stats/aircraft filters work."""
        now = datetime.utcnow()
        events = [
            SafetyEvent(event_type="tcas_ra", severity="critical", icao_hex="FILT01", timestamp=now),
            SafetyEvent(event_type="tcas_ra", severity="critical", icao_hex="FILT01", timestamp=now - timedelta(hours=1)),
            SafetyEvent(event_type="extreme_vs", severity="warning", icao_hex="FILT02", timestamp=now),
        ]
        for e in events:
            db_session.add(e)
        await db_session.commit()

        # Filter by event type
        response = await client.get("/api/v1/safety/stats/aircraft?event_type=tcas_ra")
        assert response.status_code == 200

        # Filter by severity
        response = await client.get("/api/v1/safety/stats/aircraft?severity=critical")
        assert response.status_code == 200

        # Filter by min_events
        response = await client.get("/api/v1/safety/stats/aircraft?min_events=2")
        assert response.status_code == 200
        data = response.json()
        assert all(a["total_events"] >= 2 for a in data["aircraft"])


@pytest.mark.asyncio
class TestMonitorControlEndpoints:
    """Tests for safety monitor control endpoints."""

    async def test_enable_monitor(self, client: AsyncClient):
        """Test POST /api/v1/safety/monitor/enable enables monitoring."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.enabled = False

            response = await client.post("/api/v1/safety/monitor/enable")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert mock_monitor.enabled is True

    async def test_disable_monitor(self, client: AsyncClient):
        """Test POST /api/v1/safety/monitor/disable disables monitoring."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.enabled = True

            response = await client.post("/api/v1/safety/monitor/disable")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert mock_monitor.enabled is False

    async def test_get_monitor_status(self, client: AsyncClient):
        """Test GET /api/v1/safety/monitor/status returns monitor state."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.enabled = True
            mock_monitor._aircraft_state = {"A12345": {}, "B67890": {}}
            mock_monitor.get_thresholds.return_value = {
                "vs_change": 3000,
                "vs_extreme": 4500,
                "proximity_nm": 1.0,
                "altitude_diff_ft": 1000
            }

            response = await client.get("/api/v1/safety/monitor/status")

            assert response.status_code == 200
            data = response.json()
            assert data["enabled"] is True
            assert data["tracked_aircraft"] == 2
            assert "thresholds" in data


@pytest.mark.asyncio
class TestActiveEventsEndpoints:
    """Tests for active safety events management endpoints."""

    async def test_get_active_events(self, client: AsyncClient):
        """Test GET /api/v1/safety/active returns active events."""
        mock_events = [
            {
                "id": "squawk_emergency:A12345",
                "event_type": "squawk_emergency",
                "severity": "critical",
                "icao": "A12345",
                "callsign": "UAL123",
                "message": "EMERGENCY: UAL123 squawking 7700",
                "acknowledged": False,
                "created_at": datetime.utcnow().timestamp(),
                "last_seen": datetime.utcnow().timestamp()
            }
        ]

        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.get_active_events.return_value = mock_events

            response = await client.get("/api/v1/safety/active")

            assert response.status_code == 200
            data = response.json()
            assert "events" in data
            assert "count" in data
            assert "unacknowledged_count" in data
            assert data["count"] == 1
            assert data["unacknowledged_count"] == 1

    async def test_get_active_events_exclude_acknowledged(self, client: AsyncClient):
        """Test GET /api/v1/safety/active?include_acknowledged=false filters acknowledged."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.get_active_events.return_value = []

            response = await client.get("/api/v1/safety/active?include_acknowledged=false")

            assert response.status_code == 200
            mock_monitor.get_active_events.assert_called_with(include_acknowledged=False)

    async def test_acknowledge_event(self, client: AsyncClient):
        """Test POST /api/v1/safety/active/{id}/acknowledge acknowledges event."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.acknowledge_event.return_value = True

            response = await client.post("/api/v1/safety/active/squawk_emergency:A12345/acknowledge")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            mock_monitor.acknowledge_event.assert_called_with("squawk_emergency:A12345")

    async def test_acknowledge_event_not_found(self, client: AsyncClient):
        """Test POST /api/v1/safety/active/{id}/acknowledge returns 404 if not found."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.acknowledge_event.return_value = False

            response = await client.post("/api/v1/safety/active/nonexistent/acknowledge")

            assert response.status_code == 404

    async def test_unacknowledge_event(self, client: AsyncClient):
        """Test POST /api/v1/safety/active/{id}/unacknowledge removes acknowledgment."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.unacknowledge_event.return_value = True

            response = await client.post("/api/v1/safety/active/squawk_emergency:A12345/unacknowledge")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    async def test_unacknowledge_event_not_found(self, client: AsyncClient):
        """Test POST /api/v1/safety/active/{id}/unacknowledge returns 404 if not found."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.unacknowledge_event.return_value = False

            response = await client.post("/api/v1/safety/active/nonexistent/unacknowledge")

            assert response.status_code == 404

    async def test_clear_event(self, client: AsyncClient):
        """Test DELETE /api/v1/safety/active/{id} clears single event."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.clear_event.return_value = True

            response = await client.delete("/api/v1/safety/active/squawk_emergency:A12345")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    async def test_clear_event_not_found(self, client: AsyncClient):
        """Test DELETE /api/v1/safety/active/{id} returns 404 if not found."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.clear_event.return_value = False

            response = await client.delete("/api/v1/safety/active/nonexistent")

            assert response.status_code == 404

    async def test_clear_all_events(self, client: AsyncClient):
        """Test DELETE /api/v1/safety/active clears all events."""
        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            response = await client.delete("/api/v1/safety/active")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            mock_monitor.clear_all_events.assert_called_once()


@pytest.mark.asyncio
class TestTestEventsEndpoint:
    """Tests for POST /api/v1/safety/test endpoint."""

    async def test_generate_test_events(self, client: AsyncClient):
        """Test POST /api/v1/safety/test generates test events."""
        mock_events = [
            {"id": "test_squawk:TEST01", "event_type": "squawk_emergency", "is_test": True},
            {"id": "test_tcas:TEST02", "event_type": "tcas_ra", "is_test": True},
        ]

        with patch('app.routers.safety.safety_monitor') as mock_monitor:
            mock_monitor.generate_test_events.return_value = mock_events

            response = await client.post("/api/v1/safety/test")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["count"] == 2
            assert "events" in data


@pytest.mark.asyncio
class TestSafetyApiIntegration:
    """Integration tests for safety API system."""

    async def test_safety_event_workflow(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test complete safety event workflow."""
        now = datetime.utcnow()

        # 1. Initially no events
        response = await client.get("/api/v1/safety/events")
        initial_count = response.json()["count"]

        # 2. Event occurs (create event)
        event = SafetyEvent(
            event_type="tcas_ra",
            severity="critical",
            icao_hex="WORKFLOW",
            callsign="TST001",
            message="Test TCAS RA event",
            details={"action": "climb"},
            timestamp=now
        )
        db_session.add(event)
        await db_session.commit()
        await db_session.refresh(event)

        # 3. Event should be visible in list
        response = await client.get("/api/v1/safety/events")
        assert response.json()["count"] > initial_count

        # 4. Can get specific event
        response = await client.get(f"/api/v1/safety/events/{event.id}")
        assert response.status_code == 200
        assert response.json()["icao"] == "WORKFLOW"

        # 5. Event appears in aircraft stats
        response = await client.get("/api/v1/safety/stats/aircraft")
        assert response.status_code == 200
        aircraft_list = response.json()["aircraft"]
        workflow_aircraft = next(
            (a for a in aircraft_list if a["icao_hex"] == "WORKFLOW"),
            None
        )
        assert workflow_aircraft is not None

    async def test_multiple_event_types(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test system handles all event types correctly."""
        now = datetime.utcnow()

        event_types = [
            ("tcas_ra", "critical", "TCAS RA event"),
            ("tcas_ta", "warning", "TCAS TA event"),
            ("extreme_vs", "warning", "Extreme VS event"),
            ("proximity", "warning", "Proximity event"),
        ]

        for event_type, severity, message in event_types:
            event = SafetyEvent(
                event_type=event_type,
                severity=severity,
                icao_hex=f"TYPE{event_type[:4].upper()}",
                message=message,
                timestamp=now
            )
            db_session.add(event)
        await db_session.commit()

        # Verify all types are returned
        response = await client.get("/api/v1/safety/events")
        assert response.status_code == 200
        data = response.json()

        found_types = set(e["event_type"] for e in data["events"])
        for event_type, _, _ in event_types:
            assert event_type in found_types, f"Missing event type: {event_type}"

    async def test_proximity_event_dual_aircraft(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test proximity events include both aircraft."""
        now = datetime.utcnow()

        event = SafetyEvent(
            event_type="proximity",
            severity="warning",
            icao_hex="PROX01",
            icao_hex_2="PROX02",
            callsign="UAL123",
            callsign_2="DAL456",
            message="Proximity conflict between UAL123 and DAL456",
            details={
                "distance_nm": 0.8,
                "altitude_diff_ft": 500
            },
            aircraft_snapshot={"altitude": 35000, "gs": 450},
            aircraft_snapshot_2={"altitude": 34500, "gs": 420},
            timestamp=now
        )
        db_session.add(event)
        await db_session.commit()
        await db_session.refresh(event)

        response = await client.get(f"/api/v1/safety/events/{event.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["icao"] == "PROX01"
        assert data["icao_2"] == "PROX02"
        assert data["callsign"] == "UAL123"
        assert data["callsign_2"] == "DAL456"
        assert data["aircraft_snapshot"] is not None
        assert data["aircraft_snapshot_2"] is not None
