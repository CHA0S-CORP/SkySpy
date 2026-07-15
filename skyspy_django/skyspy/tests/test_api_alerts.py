"""
End-to-end tests for alerts API endpoints.

Tests for:
- AlertRuleViewSet (CRUD operations)
  - list (GET /api/v1/alerts/rules/)
  - create (POST /api/v1/alerts/rules/)
  - retrieve (GET /api/v1/alerts/rules/{id}/)
  - update (PUT /api/v1/alerts/rules/{id}/)
  - partial_update (PATCH /api/v1/alerts/rules/{id}/)
  - destroy (DELETE /api/v1/alerts/rules/{id}/)
  - toggle (POST /api/v1/alerts/rules/{id}/toggle/)
- AlertHistoryViewSet
  - list (GET /api/v1/alerts/history/)
  - clear (DELETE /api/v1/alerts/history/clear/)
"""

import uuid
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status

from skyspy.models import AlertHistory, AlertRule


@pytest.mark.django_db
class TestAlertRuleListView:
    """Tests for the alert rules list endpoint."""

    def test_list_returns_200(self, api_client):
        """Test that list returns 200 OK."""
        response = api_client.get("/api/v1/alerts/rules/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty(self, api_client):
        """Test list response when no rules exist."""
        response = api_client.get("/api/v1/alerts/rules/")
        data = response.json()

        assert "rules" in data
        assert "count" in data
        assert data["rules"] == []
        assert data["count"] == 0

    def test_list_with_rules(self, api_client):
        """Test list response with existing rules."""
        AlertRule.objects.create(name="Rule 1", rule_type="icao", value="ABC123", visibility="public")
        AlertRule.objects.create(name="Rule 2", rule_type="callsign", value="UAL*", visibility="public")

        response = api_client.get("/api/v1/alerts/rules/")
        data = response.json()

        assert data["count"] == 2
        assert len(data["rules"]) == 2

    def test_list_rule_structure(self, api_client):
        """Test that rules have expected fields."""
        AlertRule.objects.create(
            name="Test Rule",
            rule_type="icao",
            operator="eq",
            value="ABC123",
            description="Test description",
            enabled=True,
            priority="warning",
            visibility="public",
        )

        response = api_client.get("/api/v1/alerts/rules/")
        rule = response.json()["rules"][0]

        expected_fields = [
            "id",
            "name",
            "type",
            "operator",
            "value",
            "conditions",
            "description",
            "enabled",
            "priority",
            "starts_at",
            "expires_at",
            "api_url",
            "created_at",
            "updated_at",
        ]
        for field in expected_fields:
            assert field in rule, f"Missing field: {field}"

    def test_list_filter_by_enabled(self, api_client):
        """Test filtering rules by enabled status."""
        AlertRule.objects.create(name="Enabled", enabled=True, visibility="public")
        AlertRule.objects.create(name="Disabled", enabled=False, visibility="public")

        response = api_client.get("/api/v1/alerts/rules/?enabled=true")
        data = response.json()

        assert data["count"] == 1
        assert data["rules"][0]["name"] == "Enabled"

    def test_list_filter_by_priority(self, api_client):
        """Test filtering rules by priority."""
        AlertRule.objects.create(name="Info", priority="info", visibility="public")
        AlertRule.objects.create(name="Warning", priority="warning", visibility="public")
        AlertRule.objects.create(name="Critical", priority="critical", visibility="public")

        response = api_client.get("/api/v1/alerts/rules/?priority=critical")
        data = response.json()

        assert data["count"] == 1
        assert data["rules"][0]["name"] == "Critical"

    def test_list_filter_by_rule_type(self, api_client):
        """Test filtering rules by type."""
        AlertRule.objects.create(name="ICAO Rule", rule_type="icao", visibility="public")
        AlertRule.objects.create(name="Callsign Rule", rule_type="callsign", visibility="public")

        response = api_client.get("/api/v1/alerts/rules/?rule_type=icao")
        data = response.json()

        assert data["count"] == 1
        assert data["rules"][0]["name"] == "ICAO Rule"


@pytest.mark.django_db
class TestAlertRuleCreateView:
    """Tests for creating alert rules."""

    def test_create_simple_rule(self, api_client):
        """Test creating a simple alert rule."""
        data = {
            "name": "Watch ABC123",
            "type": "icao",
            "operator": "eq",
            "value": "ABC123",
            "priority": "info",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_returns_rule(self, api_client):
        """Test that create returns the created rule."""
        data = {
            "name": "Watch ABC123",
            "type": "icao",
            "value": "ABC123",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        result = response.json()

        assert "id" in result
        assert result["name"] == "Watch ABC123"
        assert result["type"] == "icao"

    def test_create_rule_persisted(self, api_client):
        """Test that created rule is persisted in database."""
        data = {
            "name": "Persistent Rule",
            "type": "callsign",
            "value": "UAL*",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        rule_id = response.json()["id"]

        assert AlertRule.objects.filter(id=rule_id).exists()

    def test_create_with_all_fields(self, api_client):
        """Test creating rule with all optional fields."""
        data = {
            "name": "Full Rule",
            "type": "icao",
            "operator": "contains",
            "value": "MIL",
            "description": "Watch military aircraft",
            "enabled": True,
            "priority": "warning",
            "api_url": "https://example.com/webhook",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        assert response.status_code == status.HTTP_201_CREATED

        result = response.json()
        assert result["description"] == "Watch military aircraft"
        assert result["priority"] == "warning"
        assert result["api_url"] == "https://example.com/webhook"

    def test_create_with_complex_conditions(self, api_client):
        """Test creating rule with complex conditions."""
        data = {
            "name": "Complex Rule",
            "conditions": {
                "logic": "AND",
                "groups": [
                    {
                        "logic": "OR",
                        "conditions": [
                            {"type": "icao", "operator": "eq", "value": "ABC123"},
                            {"type": "icao", "operator": "eq", "value": "DEF456"},
                        ],
                    }
                ],
            },
            "priority": "critical",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_missing_name(self, api_client):
        """Test that name is required."""
        data = {
            "type": "icao",
            "value": "ABC123",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_default_values(self, api_client):
        """Test that default values are applied."""
        data = {
            "name": "Minimal Rule",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        assert response.status_code == status.HTTP_201_CREATED

        result = response.json()
        assert result["enabled"]  # Default True
        assert result["priority"] == "info"  # Default info
        assert result["operator"] == "eq"  # Default eq

    def test_create_invalid_priority(self, api_client):
        """Test that invalid priority is rejected."""
        data = {
            "name": "Bad Priority",
            "priority": "invalid",
        }

        response = api_client.post("/api/v1/alerts/rules/", data, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestAlertRuleRetrieveView:
    """Tests for retrieving a single alert rule."""

    @pytest.fixture
    def rule(self):
        return AlertRule.objects.create(
            name="Test Rule",
            rule_type="icao",
            value="ABC123",
            priority="warning",
            visibility="public",
        )

    def test_retrieve_existing_rule(self, api_client, rule):
        """Test retrieving an existing rule."""
        response = api_client.get(f"/api/v1/alerts/rules/{rule.id}/")
        assert response.status_code == status.HTTP_200_OK

    def test_retrieve_rule_data(self, api_client, rule):
        """Test that retrieved rule has correct data."""
        response = api_client.get(f"/api/v1/alerts/rules/{rule.id}/")
        data = response.json()

        assert data["name"] == "Test Rule"
        assert data["type"] == "icao"
        assert data["value"] == "ABC123"

    def test_retrieve_nonexistent_rule(self, api_client):
        """Test retrieving non-existent rule returns 404."""
        response = api_client.get("/api/v1/alerts/rules/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestAlertRuleUpdateView:
    """Tests for updating alert rules."""

    @pytest.fixture
    def rule(self):
        return AlertRule.objects.create(
            name="Original Name",
            rule_type="icao",
            value="ABC123",
            priority="info",
            enabled=True,
            visibility="public",
        )

    def test_full_update(self, api_client, rule):
        """Test full update (PUT) of a rule."""
        data = {
            "name": "Updated Name",
            "operator": "contains",
            "value": "DEF",
            "priority": "critical",
            "enabled": False,
        }

        response = api_client.put(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")
        assert response.status_code == status.HTTP_200_OK

    def test_partial_update(self, api_client, rule):
        """Test partial update (PATCH) of a rule."""
        data = {
            "name": "New Name Only",
        }

        response = api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")
        assert response.status_code == status.HTTP_200_OK

        result = response.json()
        assert result["name"] == "New Name Only"
        # Other fields should be preserved
        assert result["value"] == "ABC123"

    def test_update_persisted(self, api_client, rule):
        """Test that updates are persisted."""
        data = {"name": "Persisted Name"}

        api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")

        rule.refresh_from_db()
        assert rule.name == "Persisted Name"

    def test_update_nonexistent_rule(self, api_client):
        """Test updating non-existent rule returns 404."""
        data = {"name": "New Name"}

        response = api_client.patch("/api/v1/alerts/rules/99999/", data, format="json")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_update_priority(self, api_client, rule):
        """Test updating rule priority."""
        data = {"priority": "critical"}

        api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")

        rule.refresh_from_db()
        assert rule.priority == "critical"

    def test_update_enabled_status(self, api_client, rule):
        """Test updating enabled status."""
        data = {"enabled": False}

        api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")

        rule.refresh_from_db()
        assert not rule.enabled


@pytest.mark.django_db
class TestAlertRuleDeleteView:
    """Tests for deleting alert rules."""

    @pytest.fixture
    def rule(self):
        return AlertRule.objects.create(name="To Delete", visibility="public")

    def test_delete_rule(self, api_client, rule):
        """Test deleting a rule."""
        response = api_client.delete(f"/api/v1/alerts/rules/{rule.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_delete_removes_from_db(self, api_client, rule):
        """Test that delete removes rule from database."""
        rule_id = rule.id
        api_client.delete(f"/api/v1/alerts/rules/{rule_id}/")

        assert not AlertRule.objects.filter(id=rule_id).exists()

    def test_delete_nonexistent_rule(self, api_client):
        """Test deleting non-existent rule returns 404."""
        response = api_client.delete("/api/v1/alerts/rules/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_delete_twice(self, api_client, rule):
        """Test that deleting same rule twice returns 404 on second."""
        api_client.delete(f"/api/v1/alerts/rules/{rule.id}/")
        response = api_client.delete(f"/api/v1/alerts/rules/{rule.id}/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestAlertRuleToggleView:
    """Tests for the alert rule toggle action."""

    @pytest.fixture
    def rule(self):
        return AlertRule.objects.create(name="Toggle Test", enabled=True, visibility="public")

    def test_toggle_enabled_to_disabled(self, api_client, rule):
        """Test toggling enabled rule to disabled."""
        assert rule.enabled

        response = api_client.post(f"/api/v1/alerts/rules/{rule.id}/toggle/")
        assert response.status_code == status.HTTP_200_OK

        rule.refresh_from_db()
        assert not rule.enabled

    def test_toggle_disabled_to_enabled(self, api_client, rule):
        """Test toggling disabled rule to enabled."""
        rule.enabled = False
        rule.save()

        response = api_client.post(f"/api/v1/alerts/rules/{rule.id}/toggle/")
        assert response.status_code == status.HTTP_200_OK

        rule.refresh_from_db()
        assert rule.enabled

    def test_toggle_returns_updated_rule(self, api_client, rule):
        """Test that toggle returns the updated rule."""
        response = api_client.post(f"/api/v1/alerts/rules/{rule.id}/toggle/")
        data = response.json()

        assert "enabled" in data
        assert not data["enabled"]  # Was True, now False

    def test_toggle_nonexistent_rule(self, api_client):
        """Test toggling non-existent rule returns 404."""
        response = api_client.post("/api/v1/alerts/rules/99999/toggle/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_toggle_twice_returns_to_original(self, api_client, rule):
        """Test that toggling twice returns to original state."""
        original_state = rule.enabled

        api_client.post(f"/api/v1/alerts/rules/{rule.id}/toggle/")
        api_client.post(f"/api/v1/alerts/rules/{rule.id}/toggle/")

        rule.refresh_from_db()
        assert rule.enabled == original_state


@pytest.mark.django_db
class TestAlertHistoryListView:
    """Tests for the alert history list endpoint."""

    def test_list_returns_200(self, api_client):
        """Test that list returns 200 OK."""
        response = api_client.get("/api/v1/alerts/history/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty(self, api_client):
        """Test list response when no history exists."""
        response = api_client.get("/api/v1/alerts/history/")
        data = response.json()

        assert "history" in data
        assert "count" in data
        assert data["count"] == 0

    def test_list_with_history(self, api_client):
        """Test list with existing history entries."""
        rule = AlertRule.objects.create(name="Test Rule", visibility="public")
        AlertHistory.objects.create(
            rule=rule,
            rule_name="Test Rule",
            icao_hex="ABC123",
            message="Alert triggered",
            priority="warning",
        )

        response = api_client.get("/api/v1/alerts/history/")
        data = response.json()

        assert data["count"] == 1

    def test_list_time_filter(self, api_client):
        """Test filtering by time range."""
        rule = AlertRule.objects.create(name="Test Rule", visibility="public")

        # Create entry outside time range
        old_entry = AlertHistory.objects.create(
            rule=rule,
            rule_name="Old",
            icao_hex="OLD123",
        )
        # Manually set old timestamp
        old_entry.triggered_at = timezone.now() - timedelta(hours=48)
        old_entry.save()

        # Create recent entry
        AlertHistory.objects.create(
            rule=rule,
            rule_name="Recent",
            icao_hex="NEW123",
        )

        response = api_client.get("/api/v1/alerts/history/?hours=24")
        data = response.json()

        assert data["count"] == 1
        assert data["history"][0]["icao"] == "NEW123"

    def test_list_filter_by_icao(self, api_client):
        """Test filtering history by ICAO hex."""
        rule = AlertRule.objects.create(name="Test", visibility="public")
        AlertHistory.objects.create(rule=rule, icao_hex="ABC123")
        AlertHistory.objects.create(rule=rule, icao_hex="DEF456")

        response = api_client.get("/api/v1/alerts/history/?icao_hex=ABC123")
        data = response.json()

        assert data["count"] == 1
        assert data["history"][0]["icao"] == "ABC123"

    def test_list_filter_by_priority(self, api_client):
        """Test filtering history by priority."""
        rule = AlertRule.objects.create(name="Test", visibility="public")
        AlertHistory.objects.create(rule=rule, icao_hex="A", priority="info")
        AlertHistory.objects.create(rule=rule, icao_hex="B", priority="critical")

        response = api_client.get("/api/v1/alerts/history/?priority=critical")
        data = response.json()

        assert data["count"] == 1
        assert data["history"][0]["priority"] == "critical"

    def test_list_ordered_by_time(self, api_client):
        """Test that history is ordered by triggered time descending."""
        rule = AlertRule.objects.create(name="Test", visibility="public")
        AlertHistory.objects.create(rule=rule, icao_hex="FIRST")
        AlertHistory.objects.create(rule=rule, icao_hex="SECOND")

        response = api_client.get("/api/v1/alerts/history/")
        data = response.json()

        # Most recent should be first
        assert data["history"][0]["icao"] == "SECOND"


@pytest.mark.django_db
class TestAlertHistoryClearView:
    """Tests for the alert history clear endpoint."""

    @pytest.fixture
    def superuser(self):
        User = get_user_model()
        username = f"admin_{uuid.uuid4().hex[:8]}"
        return User.objects.create_superuser(username=username, email=f"{username}@test.com", password="testpass123")

    @pytest.fixture
    def auth_client(self, api_client, superuser):
        api_client.force_authenticate(user=superuser)
        yield api_client
        api_client.force_authenticate(user=None)

    def test_clear_returns_200(self, auth_client):
        """Test that clear returns 200 OK."""
        response = auth_client.delete("/api/v1/alerts/history/clear/")
        assert response.status_code == status.HTTP_200_OK

    def test_clear_deletes_all(self, auth_client):
        """Test that clear deletes all history entries."""
        rule = AlertRule.objects.create(name="Test")
        AlertHistory.objects.create(rule=rule, icao_hex="A")
        AlertHistory.objects.create(rule=rule, icao_hex="B")
        AlertHistory.objects.create(rule=rule, icao_hex="C")

        auth_client.delete("/api/v1/alerts/history/clear/")

        assert AlertHistory.objects.count() == 0

    def test_clear_returns_count(self, auth_client):
        """Test that clear returns deleted count."""
        rule = AlertRule.objects.create(name="Test")
        AlertHistory.objects.create(rule=rule, icao_hex="A")
        AlertHistory.objects.create(rule=rule, icao_hex="B")

        response = auth_client.delete("/api/v1/alerts/history/clear/")
        data = response.json()

        assert "deleted" in data
        assert data["deleted"] == 2

    def test_clear_empty_history(self, auth_client):
        """Test clearing empty history."""
        response = auth_client.delete("/api/v1/alerts/history/clear/")
        data = response.json()

        assert data["deleted"] == 0

    def test_clear_does_not_affect_rules(self, auth_client):
        """Test that clearing history doesn't delete rules."""
        rule = AlertRule.objects.create(name="Keep Me")
        AlertHistory.objects.create(rule=rule, icao_hex="A")

        auth_client.delete("/api/v1/alerts/history/clear/")

        assert AlertRule.objects.filter(id=rule.id).exists()


@pytest.mark.django_db
class TestAlertsIntegration:
    """Integration tests for alerts endpoints."""

    @pytest.fixture
    def superuser(self):
        User = get_user_model()
        username = f"admin_{uuid.uuid4().hex[:8]}"
        return User.objects.create_superuser(username=username, email=f"{username}@test.com", password="testpass123")

    @pytest.fixture
    def auth_client(self, api_client, superuser):
        api_client.force_authenticate(user=superuser)
        yield api_client
        api_client.force_authenticate(user=None)

    def test_crud_workflow(self, auth_client):
        """Test complete CRUD workflow."""
        # Create
        create_response = auth_client.post(
            "/api/v1/alerts/rules/", {"name": "CRUD Test", "type": "icao", "value": "ABC123"}, format="json"
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        rule_id = create_response.json()["id"]

        # Read
        read_response = auth_client.get(f"/api/v1/alerts/rules/{rule_id}/")
        assert read_response.status_code == status.HTTP_200_OK
        assert read_response.json()["name"] == "CRUD Test"

        # Update
        update_response = auth_client.patch(
            f"/api/v1/alerts/rules/{rule_id}/", {"name": "Updated CRUD Test"}, format="json"
        )
        assert update_response.status_code == status.HTTP_200_OK
        assert update_response.json()["name"] == "Updated CRUD Test"

        # Delete
        delete_response = auth_client.delete(f"/api/v1/alerts/rules/{rule_id}/")
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

        # Verify deleted
        verify_response = auth_client.get(f"/api/v1/alerts/rules/{rule_id}/")
        assert verify_response.status_code == status.HTTP_404_NOT_FOUND

    def test_history_linked_to_rule(self, auth_client):
        """Test that history entries are linked to rules."""
        # Create rule - must be public for anonymous access or owned by authenticated user
        rule = AlertRule.objects.create(name="History Test", visibility="public")

        # Create history entry linked to rule
        AlertHistory.objects.create(
            rule=rule,
            rule_name="History Test",
            icao_hex="ABC123",
        )

        # Get history
        response = auth_client.get("/api/v1/alerts/history/")
        history = response.json()["history"][0]

        assert history["rule_id"] == rule.id
        assert history["rule_name"] == "History Test"

    def test_all_endpoints_return_json(self, auth_client):
        """Test that all endpoints return JSON."""
        rule = AlertRule.objects.create(name="JSON Test", visibility="public")

        endpoints = [
            ("/api/v1/alerts/rules/", "GET"),
            ("/api/v1/alerts/rules/", "POST"),
            (f"/api/v1/alerts/rules/{rule.id}/", "GET"),
            ("/api/v1/alerts/history/", "GET"),
        ]

        for endpoint, method in endpoints:
            if method == "GET":
                response = auth_client.get(endpoint)
            elif method == "POST":
                response = auth_client.post(endpoint, {"name": "Test"}, format="json")

            if response.status_code in [200, 201]:
                assert response["Content-Type"] == "application/json", f"{method} {endpoint} should return JSON"

    def test_no_authentication_required(self, api_client):
        """Test that no authentication is required."""
        api_client.credentials()

        rule = AlertRule.objects.create(name="Auth Test")

        endpoints = [
            ("/api/v1/alerts/rules/", "GET"),
            (f"/api/v1/alerts/rules/{rule.id}/", "GET"),
            ("/api/v1/alerts/history/", "GET"),
        ]

        for endpoint, _method in endpoints:
            response = api_client.get(endpoint)
            assert response.status_code not in [
                status.HTTP_401_UNAUTHORIZED,
                status.HTTP_403_FORBIDDEN,
            ], f"{endpoint} should not require authentication"


@pytest.mark.django_db
class TestAlertRuleUpdateConditionsValidation:
    """Regression: PATCH/PUT must validate complex conditions.

    An unvalidated JSONField allowed persisting a group condition without a
    "value" key, which crashed every subsequent alert-evaluation cycle.
    """

    @pytest.fixture
    def rule(self):
        return AlertRule.objects.create(
            name="Conditions Rule",
            rule_type="icao",
            value="ABC123",
            enabled=True,
            visibility="public",
        )

    def test_patch_rejects_condition_without_value(self, api_client, rule):
        data = {
            "conditions": {
                "logic": "AND",
                "groups": [{"logic": "AND", "conditions": [{"type": "emergency"}]}],
            }
        }

        response = api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        rule.refresh_from_db()
        assert rule.conditions is None

    def test_patch_rejects_non_dict_conditions(self, api_client, rule):
        response = api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", {"conditions": "bogus"}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        rule.refresh_from_db()
        assert rule.conditions is None

    def test_patch_accepts_valid_conditions(self, api_client, rule):
        data = {
            "conditions": {
                "logic": "AND",
                "groups": [{"logic": "AND", "conditions": [{"type": "emergency", "operator": "eq", "value": "true"}]}],
            }
        }

        response = api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", data, format="json")

        assert response.status_code == status.HTTP_200_OK
        rule.refresh_from_db()
        assert rule.conditions["groups"][0]["conditions"][0]["value"] == "true"

    def test_patch_accepts_null_conditions(self, api_client, rule):
        rule.conditions = {"logic": "AND", "groups": []}
        rule.save()

        response = api_client.patch(f"/api/v1/alerts/rules/{rule.id}/", {"conditions": None}, format="json")

        assert response.status_code == status.HTTP_200_OK
        rule.refresh_from_db()
        assert rule.conditions is None
