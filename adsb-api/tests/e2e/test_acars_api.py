"""
End-to-end tests for ACARS API endpoints.

Tests ACARS message retrieval, filtering, statistics, and cleanup.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.models import AcarsMessage


@pytest.mark.asyncio
class TestAcarsMessagesEndpoints:
    """Tests for ACARS message retrieval endpoints."""

    async def test_get_acars_messages_empty(self, client: AsyncClient):
        """Test GET /api/v1/acars/messages with no messages."""
        response = await client.get("/api/v1/acars/messages")

        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert "count" in data
        assert "filters" in data

    async def test_get_acars_messages_with_data(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages returns messages from database."""
        response = await client.get("/api/v1/acars/messages")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1

    async def test_get_acars_messages_filter_by_icao(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages filters by ICAO hex."""
        response = await client.get(
            "/api/v1/acars/messages",
            params={"icao_hex": "A12345"}
        )

        assert response.status_code == 200
        data = response.json()
        # All messages should be for the specified aircraft
        for msg in data["messages"]:
            assert msg["icao_hex"].upper() == "A12345"

    async def test_get_acars_messages_filter_by_callsign(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages filters by callsign."""
        response = await client.get(
            "/api/v1/acars/messages",
            params={"callsign": "UAL"}
        )

        assert response.status_code == 200
        data = response.json()
        # All messages should contain the callsign substring
        for msg in data["messages"]:
            if msg.get("callsign"):
                assert "UAL" in msg["callsign"].upper()

    async def test_get_acars_messages_filter_by_label(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages filters by ACARS label."""
        response = await client.get(
            "/api/v1/acars/messages",
            params={"label": "H1"}
        )

        assert response.status_code == 200
        data = response.json()
        for msg in data["messages"]:
            assert msg.get("label") == "H1"

    async def test_get_acars_messages_filter_by_source(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages filters by source type."""
        response = await client.get(
            "/api/v1/acars/messages",
            params={"source": "acars"}
        )

        assert response.status_code == 200
        data = response.json()
        for msg in data["messages"]:
            assert msg.get("source") == "acars"

    async def test_get_acars_messages_filter_by_hours(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/acars/messages filters by time range."""
        # Create messages at different times
        now = datetime.utcnow()
        old_msg = AcarsMessage(
            timestamp=now - timedelta(hours=48),
            source="acars",
            icao_hex="A11111",
            text="Old message"
        )
        recent_msg = AcarsMessage(
            timestamp=now - timedelta(hours=1),
            source="acars",
            icao_hex="A22222",
            text="Recent message"
        )
        db_session.add(old_msg)
        db_session.add(recent_msg)
        await db_session.commit()

        # Request only last 24 hours
        response = await client.get(
            "/api/v1/acars/messages",
            params={"hours": 24}
        )

        assert response.status_code == 200
        data = response.json()
        icao_hexes = [m.get("icao_hex", "").upper() for m in data["messages"]]
        assert "A22222" in icao_hexes

    async def test_get_acars_messages_limit(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/acars/messages respects limit parameter."""
        # Create many messages
        now = datetime.utcnow()
        for i in range(20):
            msg = AcarsMessage(
                timestamp=now - timedelta(minutes=i),
                source="acars",
                icao_hex=f"A{i:05d}",
                text=f"Message {i}"
            )
            db_session.add(msg)
        await db_session.commit()

        response = await client.get(
            "/api/v1/acars/messages",
            params={"limit": 5}
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) <= 5

    async def test_get_acars_messages_combined_filters(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages with multiple filters."""
        response = await client.get(
            "/api/v1/acars/messages",
            params={
                "icao_hex": "A12345",
                "source": "acars",
                "hours": 24,
                "limit": 10
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["filters"]["icao_hex"] == "A12345"
        assert data["filters"]["source"] == "acars"


@pytest.mark.asyncio
class TestAcarsRecentMessagesEndpoint:
    """Tests for recent ACARS messages from memory buffer."""

    async def test_get_recent_messages(self, client: AsyncClient):
        """Test GET /api/v1/acars/messages/recent returns from memory buffer."""
        with patch('app.routers.acars.acars_service') as mock_service:
            mock_service.get_recent_messages.return_value = [
                {"timestamp": 1703145600, "source": "acars", "callsign": "UAL123"},
                {"timestamp": 1703145590, "source": "vdlm2", "callsign": "DAL456"},
            ]

            response = await client.get("/api/v1/acars/messages/recent")

            assert response.status_code == 200
            data = response.json()
            assert data["source"] == "memory_buffer"
            assert len(data["messages"]) == 2

    async def test_get_recent_messages_with_limit(self, client: AsyncClient):
        """Test GET /api/v1/acars/messages/recent respects limit."""
        with patch('app.routers.acars.acars_service') as mock_service:
            mock_service.get_recent_messages.return_value = []

            response = await client.get(
                "/api/v1/acars/messages/recent",
                params={"limit": 10}
            )

            assert response.status_code == 200
            mock_service.get_recent_messages.assert_called_once_with(limit=10)


@pytest.mark.asyncio
class TestAcarsAircraftMessagesEndpoint:
    """Tests for aircraft-specific ACARS messages."""

    async def test_get_aircraft_acars(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages/{icao_hex} returns aircraft messages."""
        response = await client.get("/api/v1/acars/messages/A12345")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "A12345"
        assert "messages" in data
        assert "count" in data

    async def test_get_aircraft_acars_with_params(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages/{icao_hex} with parameters."""
        response = await client.get(
            "/api/v1/acars/messages/A12345",
            params={"hours": 12, "limit": 25}
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) <= 25

    async def test_get_aircraft_acars_normalizes_icao(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/messages/{icao_hex} normalizes to uppercase."""
        response = await client.get("/api/v1/acars/messages/a12345")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "A12345"


@pytest.mark.asyncio
class TestAcarsStatsEndpoints:
    """Tests for ACARS statistics endpoints."""

    async def test_get_acars_stats(self, client: AsyncClient):
        """Test GET /api/v1/acars/stats returns statistics."""
        response = await client.get("/api/v1/acars/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_messages" in data or "service_stats" in data

    async def test_get_acars_stats_with_data(
        self, client: AsyncClient, populated_db: AsyncSession
    ):
        """Test GET /api/v1/acars/stats with messages in database."""
        response = await client.get("/api/v1/acars/stats")

        assert response.status_code == 200
        data = response.json()
        # Should have some message counts
        if "total_messages" in data:
            assert data["total_messages"] >= 0


@pytest.mark.asyncio
class TestAcarsStatusEndpoint:
    """Tests for ACARS service status endpoint."""

    async def test_get_acars_status(self, client: AsyncClient):
        """Test GET /api/v1/acars/status returns service status."""
        with patch('app.routers.acars.acars_service') as mock_service:
            mock_service.get_stats.return_value = {
                "running": True,
                "acars": {"total": 1000, "last_hour": 50, "errors": 2},
                "vdlm2": {"total": 800, "last_hour": 40, "errors": 1},
                "recent_buffer_size": 85,
            }

            response = await client.get("/api/v1/acars/status")

            assert response.status_code == 200
            data = response.json()
            assert "running" in data
            assert "acars" in data
            assert "vdlm2" in data
            assert "buffer_size" in data

    async def test_get_acars_status_not_running(self, client: AsyncClient):
        """Test GET /api/v1/acars/status when service is not running."""
        with patch('app.routers.acars.acars_service') as mock_service:
            mock_service.get_stats.return_value = {
                "running": False,
                "acars": {"total": 0, "last_hour": 0, "errors": 0},
                "vdlm2": {"total": 0, "last_hour": 0, "errors": 0},
                "recent_buffer_size": 0,
            }

            response = await client.get("/api/v1/acars/status")

            assert response.status_code == 200
            data = response.json()
            assert data["running"] is False


@pytest.mark.asyncio
class TestAcarsCleanupEndpoint:
    """Tests for ACARS message cleanup endpoint."""

    async def test_cleanup_old_messages(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test DELETE /api/v1/acars/messages/cleanup removes old messages."""
        # Create old messages
        now = datetime.utcnow()
        old_msg = AcarsMessage(
            timestamp=now - timedelta(days=10),
            source="acars",
            icao_hex="OLD123",
            text="Old message to delete"
        )
        recent_msg = AcarsMessage(
            timestamp=now - timedelta(hours=1),
            source="acars",
            icao_hex="NEW456",
            text="Recent message to keep"
        )
        db_session.add(old_msg)
        db_session.add(recent_msg)
        await db_session.commit()

        response = await client.delete(
            "/api/v1/acars/messages/cleanup",
            params={"days": 7}
        )

        assert response.status_code == 200
        data = response.json()
        assert "deleted" in data
        assert data["deleted"] >= 1

    async def test_cleanup_default_days(self, client: AsyncClient):
        """Test DELETE /api/v1/acars/messages/cleanup uses default 7 days."""
        response = await client.delete("/api/v1/acars/messages/cleanup")

        assert response.status_code == 200
        data = response.json()
        assert "deleted" in data
        assert "7 days" in data.get("message", "")

    async def test_cleanup_custom_days(self, client: AsyncClient):
        """Test DELETE /api/v1/acars/messages/cleanup with custom days."""
        response = await client.delete(
            "/api/v1/acars/messages/cleanup",
            params={"days": 3}
        )

        assert response.status_code == 200
        data = response.json()
        assert "3 days" in data.get("message", "")


@pytest.mark.asyncio
class TestAcarsLabelsEndpoint:
    """Tests for ACARS label reference endpoint."""

    async def test_get_label_reference(self, client: AsyncClient):
        """Test GET /api/v1/acars/labels returns label reference."""
        response = await client.get("/api/v1/acars/labels")

        assert response.status_code == 200
        data = response.json()
        assert "labels" in data
        assert "sources" in data

        # Check for common labels
        labels = data["labels"]
        assert "H1" in labels  # Flight plan
        assert "SA" in labels  # Position report
        assert "QA" in labels  # Weather request

        # Check source descriptions
        sources = data["sources"]
        assert "acars" in sources
        assert "vdlm2" in sources


@pytest.mark.asyncio
class TestAcarsIntegration:
    """Integration tests for ACARS system."""

    async def test_acars_message_lifecycle(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test complete ACARS message lifecycle."""
        # 1. Initially no messages
        response = await client.get("/api/v1/acars/messages")
        initial_count = response.json()["count"]

        # 2. Add message directly to database (simulating receiver)
        now = datetime.utcnow()
        msg = AcarsMessage(
            timestamp=now,
            source="acars",
            frequency=130.025,
            icao_hex="TEST01",
            callsign="TST100",
            label="H1",
            text="TEST DEPARTURE CLEARANCE",
        )
        db_session.add(msg)
        await db_session.commit()

        # 3. Retrieve message
        response = await client.get("/api/v1/acars/messages")
        assert response.json()["count"] > initial_count

        # 4. Filter by aircraft
        response = await client.get("/api/v1/acars/messages/TEST01")
        assert response.json()["count"] >= 1

        # 5. Check stats reflect the message
        response = await client.get("/api/v1/acars/stats")
        assert response.status_code == 200

    async def test_acars_filtering_accuracy(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test that ACARS filtering is accurate."""
        now = datetime.utcnow()

        # Create diverse messages
        messages = [
            AcarsMessage(timestamp=now, source="acars", icao_hex="AAA111", label="H1", callsign="UAL100"),
            AcarsMessage(timestamp=now, source="vdlm2", icao_hex="BBB222", label="SA", callsign="DAL200"),
            AcarsMessage(timestamp=now, source="acars", icao_hex="CCC333", label="QA", callsign="SWA300"),
            AcarsMessage(timestamp=now, source="vdlm2", icao_hex="AAA111", label="SA", callsign="UAL100"),
        ]
        for msg in messages:
            db_session.add(msg)
        await db_session.commit()

        # Filter by ICAO - should get 2
        response = await client.get("/api/v1/acars/messages", params={"icao_hex": "AAA111"})
        aaa_messages = [m for m in response.json()["messages"] if m.get("icao_hex", "").upper() == "AAA111"]
        assert len(aaa_messages) >= 2

        # Filter by source - should get appropriate count
        response = await client.get("/api/v1/acars/messages", params={"source": "vdlm2"})
        vdlm2_count = sum(1 for m in response.json()["messages"] if m.get("source") == "vdlm2")
        assert vdlm2_count >= 2

        # Filter by label
        response = await client.get("/api/v1/acars/messages", params={"label": "SA"})
        sa_count = sum(1 for m in response.json()["messages"] if m.get("label") == "SA")
        assert sa_count >= 2
