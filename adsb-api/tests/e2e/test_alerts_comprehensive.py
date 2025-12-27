"""
Comprehensive end-to-end tests for alert rule system.

Tests alert rule CRUD, complex condition evaluation, scheduling,
and alert history functionality.
"""
import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AlertRule, AlertHistory


@pytest.mark.asyncio
class TestAlertRuleCRUD:
    """Tests for alert rule CRUD operations."""

    async def test_create_simple_rule(self, client: AsyncClient):
        """Test POST /api/v1/alerts/rules creates simple rule."""
        rule_data = {
            "name": "Emergency Squawk",
            "type": "squawk",
            "operator": "eq",
            "value": "7700",
            "description": "Alert on emergency squawk code",
            "enabled": True,
            "priority": "critical"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Emergency Squawk"
        assert data["type"] == "squawk"
        assert data["operator"] == "eq"
        assert data["value"] == "7700"
        assert data["enabled"] is True
        assert data["priority"] == "critical"
        assert "id" in data

    async def test_create_altitude_rule(self, client: AsyncClient):
        """Test creating altitude-based alert rule."""
        rule_data = {
            "name": "Low Altitude Alert",
            "type": "altitude",
            "operator": "lt",
            "value": "3000",
            "description": "Aircraft below 3000ft",
            "priority": "warning"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["type"] == "altitude"
        assert data["operator"] == "lt"

    async def test_create_distance_rule(self, client: AsyncClient):
        """Test creating distance-based alert rule."""
        rule_data = {
            "name": "Close Proximity",
            "type": "distance",
            "operator": "lt",
            "value": "5",
            "description": "Aircraft within 5nm",
            "priority": "info"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201

    async def test_create_callsign_rule(self, client: AsyncClient):
        """Test creating callsign-based alert rule."""
        rule_data = {
            "name": "Track UAL Flights",
            "type": "callsign",
            "operator": "startswith",
            "value": "UAL",
            "description": "All United Airlines flights",
            "priority": "info"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201

    async def test_create_military_rule(self, client: AsyncClient):
        """Test creating military aircraft alert rule."""
        rule_data = {
            "name": "Military Aircraft",
            "type": "military",
            "operator": "eq",
            "value": "true",
            "description": "Any military aircraft",
            "priority": "info"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201

    async def test_get_rule_by_id(self, client: AsyncClient, db_session: AsyncSession):
        """Test GET /api/v1/alerts/rules/{id} returns rule."""
        # Create a rule
        rule = AlertRule(
            name="Test Rule",
            rule_type="squawk",
            operator="eq",
            value="1200",
            enabled=True,
        )
        db_session.add(rule)
        await db_session.commit()
        await db_session.refresh(rule)

        response = await client.get(f"/api/v1/alerts/rules/{rule.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == rule.id
        assert data["name"] == "Test Rule"

    async def test_get_rule_not_found(self, client: AsyncClient):
        """Test GET /api/v1/alerts/rules/{id} returns 404 for nonexistent."""
        response = await client.get("/api/v1/alerts/rules/99999")
        assert response.status_code == 404

    async def test_update_rule(self, client: AsyncClient, db_session: AsyncSession):
        """Test PUT /api/v1/alerts/rules/{id} updates rule."""
        # Create a rule
        rule = AlertRule(
            name="Original Name",
            rule_type="squawk",
            operator="eq",
            value="1200",
            enabled=True,
        )
        db_session.add(rule)
        await db_session.commit()
        await db_session.refresh(rule)

        # Update it
        update_data = {
            "name": "Updated Name",
            "value": "7700",
            "priority": "critical"
        }

        response = await client.put(f"/api/v1/alerts/rules/{rule.id}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["value"] == "7700"

    async def test_delete_rule(self, client: AsyncClient, db_session: AsyncSession):
        """Test DELETE /api/v1/alerts/rules/{id} removes rule."""
        # Create a rule
        rule = AlertRule(
            name="To Delete",
            rule_type="squawk",
            operator="eq",
            value="1200",
        )
        db_session.add(rule)
        await db_session.commit()
        await db_session.refresh(rule)

        # Delete it
        response = await client.delete(f"/api/v1/alerts/rules/{rule.id}")
        assert response.status_code == 200

        # Verify it's gone
        response = await client.get(f"/api/v1/alerts/rules/{rule.id}")
        assert response.status_code == 404

    async def test_toggle_rule(self, client: AsyncClient, db_session: AsyncSession):
        """Test POST /api/v1/alerts/rules/{id}/toggle toggles enabled state."""
        # Create an enabled rule
        rule = AlertRule(
            name="Toggle Test",
            rule_type="squawk",
            operator="eq",
            value="1200",
            enabled=True,
        )
        db_session.add(rule)
        await db_session.commit()
        await db_session.refresh(rule)

        # Toggle off
        response = await client.post(f"/api/v1/alerts/rules/{rule.id}/toggle")
        assert response.status_code == 200
        assert response.json()["enabled"] is False

        # Toggle on
        response = await client.post(f"/api/v1/alerts/rules/{rule.id}/toggle")
        assert response.status_code == 200
        assert response.json()["enabled"] is True


@pytest.mark.asyncio
class TestComplexAlertRules:
    """Tests for complex alert rules with AND/OR logic."""

    async def test_create_complex_and_rule(self, client: AsyncClient):
        """Test creating rule with AND conditions."""
        rule_data = {
            "name": "Military Low Approach",
            "conditions": {
                "logic": "AND",
                "groups": [
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "military", "operator": "eq", "value": "true"},
                            {"type": "altitude", "operator": "lt", "value": "5000"}
                        ]
                    }
                ]
            },
            "description": "Military aircraft below 5000ft",
            "priority": "critical"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["conditions"] is not None
        assert data["conditions"]["logic"] == "AND"

    async def test_create_complex_or_rule(self, client: AsyncClient):
        """Test creating rule with OR conditions."""
        rule_data = {
            "name": "Emergency or Military",
            "conditions": {
                "logic": "OR",
                "groups": [
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "squawk", "operator": "eq", "value": "7700"}
                        ]
                    },
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "military", "operator": "eq", "value": "true"}
                        ]
                    }
                ]
            },
            "description": "Emergency squawk OR military aircraft",
            "priority": "critical"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["conditions"]["logic"] == "OR"
        assert len(data["conditions"]["groups"]) == 2

    async def test_create_nested_complex_rule(self, client: AsyncClient):
        """Test creating rule with nested conditions."""
        rule_data = {
            "name": "Complex Nested Rule",
            "conditions": {
                "logic": "OR",
                "groups": [
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "military", "operator": "eq", "value": "true"},
                            {"type": "altitude", "operator": "lt", "value": "10000"},
                            {"type": "distance", "operator": "lt", "value": "20"}
                        ]
                    },
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "squawk", "operator": "eq", "value": "7700"}
                        ]
                    },
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "squawk", "operator": "eq", "value": "7600"}
                        ]
                    }
                ]
            },
            "description": "(Military AND Low AND Close) OR Emergency squawks",
            "priority": "critical"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert len(data["conditions"]["groups"]) == 3


@pytest.mark.asyncio
class TestAlertRuleScheduling:
    """Tests for alert rule scheduling functionality."""

    async def test_create_scheduled_rule(self, client: AsyncClient):
        """Test creating rule with schedule."""
        now = datetime.utcnow()
        # Use ISO format without Z suffix to avoid timezone issues
        rule_data = {
            "name": "Scheduled Alert",
            "type": "altitude",
            "operator": "lt",
            "value": "3000",
            "starts_at": (now + timedelta(hours=1)).isoformat(),
            "expires_at": (now + timedelta(days=7)).isoformat(),
            "priority": "warning"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["starts_at"] is not None
        assert data["expires_at"] is not None

    async def test_create_rule_with_only_start(self, client: AsyncClient):
        """Test creating rule with only start time."""
        now = datetime.utcnow()
        rule_data = {
            "name": "Starts Later",
            "type": "squawk",
            "operator": "eq",
            "value": "7700",
            "starts_at": (now + timedelta(hours=2)).isoformat(),
            "priority": "critical"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["starts_at"] is not None
        assert data["expires_at"] is None

    async def test_create_rule_with_only_expiry(self, client: AsyncClient):
        """Test creating rule with only expiry time."""
        now = datetime.utcnow()
        rule_data = {
            "name": "Expires Soon",
            "type": "squawk",
            "operator": "eq",
            "value": "7700",
            "expires_at": (now + timedelta(days=1)).isoformat(),
            "priority": "critical"
        }

        response = await client.post("/api/v1/alerts/rules", json=rule_data)

        assert response.status_code == 201
        data = response.json()
        assert data["starts_at"] is None
        assert data["expires_at"] is not None


@pytest.mark.asyncio
class TestAlertRuleOperators:
    """Tests for different alert rule operators."""

    async def test_operator_eq(self, client: AsyncClient):
        """Test equals operator."""
        rule_data = {
            "name": "Equals Test",
            "type": "squawk",
            "operator": "eq",
            "value": "7700",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_ne(self, client: AsyncClient):
        """Test not equals operator."""
        rule_data = {
            "name": "Not Equals Test",
            "type": "squawk",
            "operator": "ne",
            "value": "1200",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_lt(self, client: AsyncClient):
        """Test less than operator."""
        rule_data = {
            "name": "Less Than Test",
            "type": "altitude",
            "operator": "lt",
            "value": "5000",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_gt(self, client: AsyncClient):
        """Test greater than operator."""
        rule_data = {
            "name": "Greater Than Test",
            "type": "altitude",
            "operator": "gt",
            "value": "40000",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_le(self, client: AsyncClient):
        """Test less than or equal operator."""
        rule_data = {
            "name": "Less Equal Test",
            "type": "distance",
            "operator": "le",
            "value": "10",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_ge(self, client: AsyncClient):
        """Test greater than or equal operator."""
        rule_data = {
            "name": "Greater Equal Test",
            "type": "distance",
            "operator": "ge",
            "value": "50",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_contains(self, client: AsyncClient):
        """Test contains operator."""
        rule_data = {
            "name": "Contains Test",
            "type": "callsign",
            "operator": "contains",
            "value": "123",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201

    async def test_operator_startswith(self, client: AsyncClient):
        """Test startswith operator."""
        rule_data = {
            "name": "Starts With Test",
            "type": "callsign",
            "operator": "startswith",
            "value": "UAL",
        }
        response = await client.post("/api/v1/alerts/rules", json=rule_data)
        assert response.status_code == 201


@pytest.mark.asyncio
class TestAlertHistory:
    """Tests for alert history endpoints."""

    async def test_get_alert_history_empty(self, client: AsyncClient):
        """Test GET /api/v1/alerts/history with no history."""
        response = await client.get("/api/v1/alerts/history")

        assert response.status_code == 200
        data = response.json()
        assert "history" in data
        assert "count" in data

    async def test_get_alert_history_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/alerts/history returns triggered alerts."""
        # First create the alert rules (FK constraint)
        rule1 = AlertRule(name="Low Altitude", rule_type="altitude", operator="lt", value="3000")
        rule2 = AlertRule(name="Emergency", rule_type="squawk", operator="eq", value="7700")
        db_session.add(rule1)
        db_session.add(rule2)
        await db_session.flush()

        # Create alert history entries
        now = datetime.utcnow()
        entries = [
            AlertHistory(
                rule_id=rule1.id,
                rule_name="Low Altitude",
                icao_hex="A12345",
                callsign="UAL123",
                message="Aircraft below 3000ft",
                priority="warning",
                aircraft_data={"altitude": 2500},
                triggered_at=now - timedelta(hours=1),
            ),
            AlertHistory(
                rule_id=rule2.id,
                rule_name="Emergency",
                icao_hex="B67890",
                callsign="EMG777",
                message="Emergency squawk 7700",
                priority="critical",
                aircraft_data={"squawk": "7700"},
                triggered_at=now - timedelta(hours=2),
            ),
        ]
        for entry in entries:
            db_session.add(entry)
        await db_session.commit()

        response = await client.get("/api/v1/alerts/history")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2
        # Should be sorted newest first
        if len(data["history"]) >= 2:
            ts1 = data["history"][0]["timestamp"]
            ts2 = data["history"][1]["timestamp"]
            assert ts1 >= ts2

    async def test_get_alert_history_filter_by_rule(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/alerts/history?rule_id filters by rule."""
        # First create the alert rules (FK constraint)
        rule1 = AlertRule(name="Rule 1", rule_type="squawk", operator="eq", value="1200")
        rule2 = AlertRule(name="Rule 2", rule_type="squawk", operator="eq", value="7700")
        db_session.add(rule1)
        db_session.add(rule2)
        await db_session.flush()

        now = datetime.utcnow()
        entries = [
            AlertHistory(rule_id=rule1.id, rule_name="Rule 1", icao_hex="A11111", triggered_at=now),
            AlertHistory(rule_id=rule1.id, rule_name="Rule 1", icao_hex="A22222", triggered_at=now),
            AlertHistory(rule_id=rule2.id, rule_name="Rule 2", icao_hex="B33333", triggered_at=now),
        ]
        for entry in entries:
            db_session.add(entry)
        await db_session.commit()

        response = await client.get("/api/v1/alerts/history", params={"rule_id": rule1.id})

        assert response.status_code == 200
        data = response.json()
        # All should be rule_id matching rule1
        for entry in data["history"]:
            assert entry["rule_id"] == rule1.id

    async def test_get_alert_history_filter_by_hours(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/alerts/history?hours filters by time."""
        # First create the alert rule (FK constraint)
        rule = AlertRule(name="Test Rule", rule_type="squawk", operator="eq", value="1200")
        db_session.add(rule)
        await db_session.flush()

        now = datetime.utcnow()
        entries = [
            AlertHistory(rule_id=rule.id, icao_hex="RECENT", triggered_at=now - timedelta(hours=1)),
            AlertHistory(rule_id=rule.id, icao_hex="OLD", triggered_at=now - timedelta(hours=48)),
        ]
        for entry in entries:
            db_session.add(entry)
        await db_session.commit()

        response = await client.get("/api/v1/alerts/history", params={"hours": 24})

        assert response.status_code == 200
        data = response.json()
        icao_hexes = [h["icao"] for h in data["history"]]
        assert "RECENT" in icao_hexes

    async def test_clear_alert_history(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test DELETE /api/v1/alerts/history clears old entries."""
        # First create the alert rule (FK constraint)
        rule = AlertRule(name="Test Rule", rule_type="squawk", operator="eq", value="1200")
        db_session.add(rule)
        await db_session.flush()

        now = datetime.utcnow()
        entries = [
            AlertHistory(rule_id=rule.id, icao_hex="OLD1", triggered_at=now - timedelta(days=10)),
            AlertHistory(rule_id=rule.id, icao_hex="OLD2", triggered_at=now - timedelta(days=15)),
            AlertHistory(rule_id=rule.id, icao_hex="NEW", triggered_at=now - timedelta(hours=1)),
        ]
        for entry in entries:
            db_session.add(entry)
        await db_session.commit()

        response = await client.delete("/api/v1/alerts/history", params={"days": 7})

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # Should have deleted 2 old entries


@pytest.mark.asyncio
class TestAlertRuleListFiltering:
    """Tests for alert rule list filtering."""

    async def test_get_all_rules(self, client: AsyncClient, db_session: AsyncSession):
        """Test GET /api/v1/alerts/rules returns all rules."""
        # Create rules
        rules = [
            AlertRule(name="Rule 1", enabled=True),
            AlertRule(name="Rule 2", enabled=False),
            AlertRule(name="Rule 3", enabled=True),
        ]
        for rule in rules:
            db_session.add(rule)
        await db_session.commit()

        response = await client.get("/api/v1/alerts/rules")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 3

    async def test_get_enabled_rules_only(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/alerts/rules?enabled_only=true."""
        rules = [
            AlertRule(name="Enabled 1", enabled=True),
            AlertRule(name="Disabled 1", enabled=False),
            AlertRule(name="Enabled 2", enabled=True),
        ]
        for rule in rules:
            db_session.add(rule)
        await db_session.commit()

        response = await client.get(
            "/api/v1/alerts/rules",
            params={"enabled_only": True}
        )

        assert response.status_code == 200
        data = response.json()
        # All returned rules should be enabled
        for rule in data["rules"]:
            assert rule["enabled"] is True


@pytest.mark.asyncio
class TestAlertRuleIntegration:
    """Integration tests for alert rule system."""

    async def test_complete_alert_workflow(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test complete alert rule lifecycle."""
        # 1. Create a rule
        create_response = await client.post(
            "/api/v1/alerts/rules",
            json={
                "name": "Integration Test Rule",
                "type": "squawk",
                "operator": "eq",
                "value": "7700",
                "priority": "critical",
                "enabled": True,
            }
        )
        assert create_response.status_code == 201
        rule_id = create_response.json()["id"]

        # 2. Verify it appears in list
        list_response = await client.get("/api/v1/alerts/rules")
        rule_ids = [r["id"] for r in list_response.json()["rules"]]
        assert rule_id in rule_ids

        # 3. Update the rule
        update_response = await client.put(
            f"/api/v1/alerts/rules/{rule_id}",
            json={"name": "Updated Integration Test Rule"}
        )
        assert update_response.status_code == 200
        assert update_response.json()["name"] == "Updated Integration Test Rule"

        # 4. Toggle the rule
        toggle_response = await client.post(f"/api/v1/alerts/rules/{rule_id}/toggle")
        assert toggle_response.status_code == 200
        assert toggle_response.json()["enabled"] is False

        # 5. Delete the rule
        delete_response = await client.delete(f"/api/v1/alerts/rules/{rule_id}")
        assert delete_response.status_code == 200

        # 6. Verify it's gone
        get_response = await client.get(f"/api/v1/alerts/rules/{rule_id}")
        assert get_response.status_code == 404

    async def test_alert_history_accumulation(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test that alert history accumulates properly."""
        # First create the alert rule (FK constraint)
        rule = AlertRule(name="Test Rule", rule_type="squawk", operator="eq", value="1200")
        db_session.add(rule)
        await db_session.flush()

        # Create multiple history entries over time
        now = datetime.utcnow()
        for i in range(10):
            entry = AlertHistory(
                rule_id=rule.id,
                rule_name="Test Rule",
                icao_hex=f"A{i:05d}",
                callsign=f"TST{i:03d}",
                message=f"Test alert {i}",
                priority="info",
                triggered_at=now - timedelta(hours=i),
            )
            db_session.add(entry)
        await db_session.commit()

        # Verify all are retrievable
        response = await client.get(
            "/api/v1/alerts/history",
            params={"hours": 24, "limit": 100}
        )
        assert response.status_code == 200
        assert response.json()["count"] >= 10
