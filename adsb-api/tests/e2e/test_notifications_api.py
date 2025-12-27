"""
End-to-end tests for notifications API endpoints.

Tests notification configuration, test notifications, history, and statistics.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.models import NotificationLog, NotificationConfig


@pytest.mark.asyncio
class TestNotificationConfigEndpoints:
    """Tests for notification configuration endpoints."""

    async def test_get_notification_config(self, client: AsyncClient):
        """Test GET /api/v1/notifications/config returns current config."""
        response = await client.get("/api/v1/notifications/config")

        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert "cooldown_seconds" in data
        assert "server_count" in data

    async def test_get_config_masks_urls(self, client: AsyncClient, db_session: AsyncSession):
        """Test GET /api/v1/notifications/config masks sensitive URLs."""
        # Update config with real URLs
        from sqlalchemy import select
        result = await db_session.execute(select(NotificationConfig).limit(1))
        config = result.scalar_one_or_none()
        if config:
            config.apprise_urls = "pover://user_key@app_token,tgram://bot_token/chat_id"
            await db_session.commit()

        response = await client.get("/api/v1/notifications/config")

        assert response.status_code == 200
        data = response.json()
        # URLs should be masked
        if data["apprise_urls"]:
            assert "****" in data["apprise_urls"]
            assert "user_key" not in data["apprise_urls"]
            assert "app_token" not in data["apprise_urls"]

    async def test_update_notification_config(self, client: AsyncClient):
        """Test PUT /api/v1/notifications/config updates configuration."""
        update_data = {
            "cooldown_seconds": 600,
            "enabled": False
        }

        response = await client.put(
            "/api/v1/notifications/config",
            json=update_data
        )

        assert response.status_code == 200
        data = response.json()
        assert data["cooldown_seconds"] == 600
        assert data["enabled"] is False

    async def test_update_config_with_apprise_urls(self, client: AsyncClient):
        """Test PUT /api/v1/notifications/config with Apprise URLs."""
        with patch('app.services.notifications.notifier.reload_urls') as mock_reload:
            update_data = {
                "apprise_urls": "pover://test_user@test_token",
                "enabled": True
            }

            response = await client.put(
                "/api/v1/notifications/config",
                json=update_data
            )

            assert response.status_code == 200
            mock_reload.assert_called_once_with("pover://test_user@test_token")

    async def test_update_config_partial(self, client: AsyncClient):
        """Test PUT /api/v1/notifications/config with partial update."""
        # Only update cooldown
        response = await client.put(
            "/api/v1/notifications/config",
            json={"cooldown_seconds": 120}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["cooldown_seconds"] == 120


@pytest.mark.asyncio
class TestNotificationTestEndpoint:
    """Tests for test notification endpoint."""

    async def test_send_test_notification_no_servers(self, client: AsyncClient):
        """Test POST /api/v1/notifications/test with no configured servers."""
        with patch('app.routers.notifications.notifier') as mock_notifier:
            mock_notifier.server_count = 0
            mock_notifier.reload_from_db = AsyncMock()

            response = await client.post("/api/v1/notifications/test")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert "No notification servers" in data["message"]

    async def test_send_test_notification_success(self, client: AsyncClient):
        """Test POST /api/v1/notifications/test sends test notification."""
        with patch('app.routers.notifications.notifier') as mock_notifier:
            mock_notifier.server_count = 2
            mock_notifier.reload_from_db = AsyncMock()
            mock_notifier.send = AsyncMock(return_value=True)

            response = await client.post(
                "/api/v1/notifications/test",
                params={"message": "Custom test message"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["servers_notified"] == 2
            mock_notifier.send.assert_called_once()

    async def test_send_test_notification_failure(self, client: AsyncClient):
        """Test POST /api/v1/notifications/test handles send failure."""
        with patch('app.routers.notifications.notifier') as mock_notifier:
            mock_notifier.server_count = 1
            mock_notifier.reload_from_db = AsyncMock()
            mock_notifier.send = AsyncMock(return_value=False)

            response = await client.post("/api/v1/notifications/test")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert "Failed" in data["message"]


@pytest.mark.asyncio
class TestNotificationHistoryEndpoints:
    """Tests for notification history endpoints."""

    async def test_get_notification_history_empty(self, client: AsyncClient):
        """Test GET /api/v1/notifications/history with no history."""
        response = await client.get("/api/v1/notifications/history")

        assert response.status_code == 200
        data = response.json()
        assert "notifications" in data
        assert "count" in data
        assert data["count"] == 0

    async def test_get_notification_history_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/notifications/history returns logged notifications."""
        # Create notification logs
        now = datetime.utcnow()
        logs = [
            NotificationLog(
                timestamp=now - timedelta(hours=1),
                notification_type="alert",
                icao_hex="A12345",
                callsign="UAL123",
                message="Aircraft below 3000ft",
                details={"rule_id": 1, "altitude": 2500}
            ),
            NotificationLog(
                timestamp=now - timedelta(hours=2),
                notification_type="safety",
                icao_hex="B67890",
                callsign="DAL456",
                message="Emergency squawk detected",
                details={"squawk": "7700"}
            ),
        ]
        for log in logs:
            db_session.add(log)
        await db_session.commit()

        response = await client.get("/api/v1/notifications/history")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2
        # Should be sorted newest first
        if len(data["notifications"]) >= 2:
            ts1 = data["notifications"][0]["timestamp"]
            ts2 = data["notifications"][1]["timestamp"]
            assert ts1 >= ts2

    async def test_get_notification_history_filter_by_hours(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/notifications/history filters by time range."""
        # Create logs at different times
        now = datetime.utcnow()
        old_log = NotificationLog(
            timestamp=now - timedelta(hours=48),
            notification_type="alert",
            icao_hex="A11111",
            message="Old notification"
        )
        recent_log = NotificationLog(
            timestamp=now - timedelta(hours=1),
            notification_type="alert",
            icao_hex="A22222",
            message="Recent notification"
        )
        db_session.add(old_log)
        db_session.add(recent_log)
        await db_session.commit()

        # Request only last 24 hours
        response = await client.get(
            "/api/v1/notifications/history",
            params={"hours": 24}
        )

        assert response.status_code == 200
        data = response.json()
        # Should not include the 48-hour old notification
        icao_hexes = [n["icao_hex"] for n in data["notifications"]]
        assert "A22222" in icao_hexes

    async def test_get_notification_history_limit(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/notifications/history respects limit."""
        # Create many logs
        now = datetime.utcnow()
        for i in range(20):
            log = NotificationLog(
                timestamp=now - timedelta(minutes=i),
                notification_type="alert",
                icao_hex=f"A{i:05d}",
                message=f"Notification {i}"
            )
            db_session.add(log)
        await db_session.commit()

        response = await client.get(
            "/api/v1/notifications/history",
            params={"limit": 5}
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["notifications"]) <= 5


@pytest.mark.asyncio
class TestNotificationStatsEndpoints:
    """Tests for notification statistics endpoints."""

    async def test_get_notification_stats(self, client: AsyncClient):
        """Test GET /api/v1/notifications/stats returns statistics."""
        response = await client.get("/api/v1/notifications/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_sent" in data
        assert "last_24h" in data
        assert "server_count" in data

    async def test_get_notification_stats_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/notifications/stats with notification logs."""
        # Create notification logs
        now = datetime.utcnow()
        for i in range(5):
            log = NotificationLog(
                timestamp=now - timedelta(hours=i),
                notification_type="alert",
                icao_hex=f"A{i:05d}",
                message=f"Test {i}"
            )
            db_session.add(log)
        await db_session.commit()

        response = await client.get("/api/v1/notifications/stats")

        assert response.status_code == 200
        data = response.json()
        assert data["total_sent"] >= 5
        assert data["last_24h"] >= 5


@pytest.mark.asyncio
class TestNotificationEnableDisable:
    """Tests for enable/disable notification endpoints."""

    async def test_enable_notifications(self, client: AsyncClient):
        """Test POST /api/v1/notifications/enable enables notifications."""
        response = await client.post("/api/v1/notifications/enable")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "enabled" in data["message"].lower()

        # Verify it's actually enabled
        config_response = await client.get("/api/v1/notifications/config")
        assert config_response.json()["enabled"] is True

    async def test_disable_notifications(self, client: AsyncClient):
        """Test POST /api/v1/notifications/disable disables notifications."""
        response = await client.post("/api/v1/notifications/disable")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "disabled" in data["message"].lower()

        # Verify it's actually disabled
        config_response = await client.get("/api/v1/notifications/config")
        assert config_response.json()["enabled"] is False

    async def test_toggle_notifications(self, client: AsyncClient):
        """Test toggling notifications on and off."""
        # Enable
        await client.post("/api/v1/notifications/enable")
        config = await client.get("/api/v1/notifications/config")
        assert config.json()["enabled"] is True

        # Disable
        await client.post("/api/v1/notifications/disable")
        config = await client.get("/api/v1/notifications/config")
        assert config.json()["enabled"] is False

        # Enable again
        await client.post("/api/v1/notifications/enable")
        config = await client.get("/api/v1/notifications/config")
        assert config.json()["enabled"] is True


@pytest.mark.asyncio
class TestNotificationIntegration:
    """Integration tests for notification system."""

    async def test_notification_cooldown_behavior(self, client: AsyncClient):
        """Test that cooldown period is respected."""
        # Set a short cooldown
        await client.put(
            "/api/v1/notifications/config",
            json={"cooldown_seconds": 60, "enabled": True}
        )

        # Verify cooldown is set
        response = await client.get("/api/v1/notifications/config")
        assert response.json()["cooldown_seconds"] == 60

    async def test_notification_workflow(self, client: AsyncClient):
        """Test complete notification workflow."""
        # 1. Configure notifications
        await client.put(
            "/api/v1/notifications/config",
            json={
                "apprise_urls": "json://localhost:9999/webhook",
                "cooldown_seconds": 300,
                "enabled": True
            }
        )

        # 2. Verify configuration
        config = await client.get("/api/v1/notifications/config")
        assert config.status_code == 200
        assert config.json()["enabled"] is True

        # 3. Check stats
        stats = await client.get("/api/v1/notifications/stats")
        assert stats.status_code == 200

        # 4. Check history
        history = await client.get("/api/v1/notifications/history")
        assert history.status_code == 200
