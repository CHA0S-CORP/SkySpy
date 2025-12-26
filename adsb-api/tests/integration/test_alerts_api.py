"""Integration tests for alerts API endpoints"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AlertRule


@pytest.mark.asyncio
class TestAlertsEndpoints:
    """Tests for /api/v1/alerts endpoints"""

    async def test_get_alert_rules_empty(self, client: AsyncClient):
        """Test GET /api/v1/alerts/rules with no rules"""
        response = await client.get("/api/v1/alerts/rules")
        assert response.status_code == 200
        data = response.json()
        assert "rules" in data
        assert isinstance(data["rules"], list)
        assert data["count"] == 0

    async def test_create_alert_rule(self, client: AsyncClient):
        """Test POST /api/v1/alerts/rules"""
        rule_data = {
            "name": "Emergency Aircraft",
            "description": "Alert on emergency squawk",
            "enabled": True,
            "conditions": {
                "squawk": "7700"
            }
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Emergency Aircraft"
        assert data["enabled"] is True

    async def test_get_alert_rules_after_create(self, client: AsyncClient):
        """Test GET /api/v1/alerts/rules after creating a rule"""
        # Create a rule first
        rule_data = {
            "name": "Test Rule",
            "description": "Test",
            "enabled": True,
            "conditions": {"altitude_min": 30000}
        }
        await client.post("/api/v1/alerts/rules", json=rule_data)

        # Get all rules
        response = await client.get("/api/v1/alerts/rules")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        assert any(r["name"] == "Test Rule" for r in data["rules"])

    async def test_update_alert_rule(self, client: AsyncClient, db_session: AsyncSession):
        """Test PUT /api/v1/alerts/rules/{id}"""
        # Create a rule first
        rule = AlertRule(
            name="Original Name",
            description="Test",
            enabled=True,
            conditions={"squawk": "1200"}
        )
        db_session.add(rule)
        await db_session.commit()
        await db_session.refresh(rule)

        # Update the rule
        update_data = {
            "name": "Updated Name",
            "description": "Updated description",
            "enabled": False,
            "conditions": {"squawk": "7700"}
        }
        response = await client.put(f"/api/v1/alerts/rules/{rule.id}", json=update_data)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["enabled"] is False

    async def test_delete_alert_rule(self, client: AsyncClient, db_session: AsyncSession):
        """Test DELETE /api/v1/alerts/rules/{id}"""
        # Create a rule first
        rule = AlertRule(
            name="To Delete",
            description="Test",
            enabled=True,
            conditions={}
        )
        db_session.add(rule)
        await db_session.commit()
        await db_session.refresh(rule)

        # Delete the rule (API returns 200, not 204)
        response = await client.delete(f"/api/v1/alerts/rules/{rule.id}")
        assert response.status_code == 200

        # Verify it's deleted
        response = await client.get(f"/api/v1/alerts/rules/{rule.id}")
        assert response.status_code == 404
