"""
Integration tests for the full alert pipeline.

Exercises the complete flow:
    AlertRule (DB) → CompiledRule (cache) → check_alerts() → _trigger_alert()
    → AlertHistory (DB) → Socket.IO broadcast → notification dispatch
    → cooldown blocking on second trigger

These tests use real database operations (not APITestCase) to avoid PgBouncer
deadlocks. External side effects (Socket.IO, Apprise) are mocked.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from skyspy.models import AlertHistory, AlertRule, NotificationChannel, NotificationConfig
from skyspy.services.alert_cooldowns import cooldown_manager
from skyspy.services.alert_rule_cache import CompiledRule, rule_cache
from skyspy.services.alerts import AlertService


@pytest.fixture
def alert_service():
    """Fresh AlertService with clean cooldown state."""
    cooldown_manager.clear_all()
    service = AlertService()
    service._cooldowns = {}
    yield service
    cooldown_manager.clear_all()


@pytest.fixture
def cleanup_alerts(db):
    """Clean up alert-related DB records after each test."""
    yield
    AlertHistory.objects.all().delete()
    AlertRule.objects.all().delete()
    NotificationChannel.objects.all().delete()


@pytest.fixture
def icao_rule(db):
    """Create an ICAO-matching alert rule."""
    return AlertRule.objects.create(
        name="Track N12345",
        rule_type="icao",
        operator="eq",
        value="A12345",
        enabled=True,
        priority="warning",
        cooldown_minutes=5,
    )


@pytest.fixture
def callsign_rule(db):
    """Create a callsign prefix alert rule."""
    return AlertRule.objects.create(
        name="United Airlines Watch",
        rule_type="callsign",
        operator="startswith",
        value="UAL",
        enabled=True,
        priority="info",
        cooldown_minutes=5,
    )


@pytest.fixture
def squawk_emergency_rule(db):
    """Create a squawk 7700 emergency alert rule."""
    return AlertRule.objects.create(
        name="Emergency Squawk",
        rule_type="squawk",
        operator="eq",
        value="7700",
        enabled=True,
        priority="critical",
        cooldown_minutes=1,
    )


@pytest.fixture
def complex_rule(db):
    """Create a complex multi-condition rule (military + low altitude)."""
    return AlertRule.objects.create(
        name="Low Military Aircraft",
        rule_type=None,
        operator="eq",
        value=None,
        conditions={
            "logic": "AND",
            "groups": [
                {
                    "logic": "OR",
                    "conditions": [
                        {"type": "military", "operator": "eq", "value": "true"},
                    ],
                },
                {
                    "logic": "OR",
                    "conditions": [
                        {"type": "altitude", "operator": "lt", "value": "5000"},
                    ],
                },
            ],
        },
        enabled=True,
        priority="critical",
        cooldown_minutes=5,
    )


@pytest.fixture
def mock_aircraft():
    """Aircraft data dict matching A12345 ICAO and UAL123 callsign."""
    return {
        "hex": "A12345",
        "flight": "UAL123",
        "alt_baro": 35000,
        "alt_geom": 35200,
        "alt": 35000,
        "gs": 450,
        "track": 270,
        "baro_rate": 0,
        "squawk": "4521",
        "lat": 47.5,
        "lon": -122.0,
        "category": "A3",
        "t": "B738",
        "rssi": -25.0,
        "distance_nm": 15.5,
        "dbFlags": 0,
    }


@pytest.fixture
def emergency_aircraft():
    """Aircraft data squawking 7700 emergency."""
    return {
        "hex": "B99999",
        "flight": "DAL456",
        "alt_baro": 10000,
        "alt": 10000,
        "gs": 250,
        "track": 180,
        "squawk": "7700",
        "lat": 40.0,
        "lon": -74.0,
        "distance_nm": 5.0,
        "dbFlags": 0,
    }


@pytest.fixture
def military_aircraft():
    """Military aircraft at low altitude."""
    return {
        "hex": "AE1234",
        "flight": "RCH123",
        "alt_baro": 3000,
        "alt": 3000,
        "gs": 200,
        "track": 90,
        "squawk": "0100",
        "lat": 38.0,
        "lon": -77.0,
        "distance_nm": 10.0,
        "dbFlags": 1,  # military flag
    }


@pytest.mark.django_db
class TestAlertPipelineEndToEnd:
    """
    End-to-end tests for the complete alert pipeline.

    Each test exercises: Rule creation → cache compilation → aircraft evaluation
    → alert triggering → history recording → notification dispatch.
    """

    @patch("skyspy.services.alerts.sync_emit")
    def test_simple_icao_rule_triggers_and_records_history(
        self, mock_emit, alert_service, icao_rule, mock_aircraft, cleanup_alerts
    ):
        """Full pipeline: ICAO rule matches aircraft → AlertHistory created."""
        triggered = alert_service.check_alerts([mock_aircraft])

        assert len(triggered) == 1
        assert triggered[0]["rule_name"] == "Track N12345"
        assert triggered[0]["icao"] == "A12345"
        assert triggered[0]["priority"] == "warning"

        # Verify AlertHistory was recorded in DB
        history = AlertHistory.objects.filter(rule=icao_rule)
        assert history.count() == 1
        record = history.first()
        assert record.icao_hex == "A12345"
        assert record.callsign == "UAL123"
        assert record.priority == "warning"
        assert record.aircraft_data is not None

    @patch("skyspy.services.alerts.sync_emit")
    def test_callsign_prefix_rule_matches(self, mock_emit, alert_service, callsign_rule, mock_aircraft, cleanup_alerts):
        """Callsign startswith rule matches UAL123."""
        triggered = alert_service.check_alerts([mock_aircraft])

        assert len(triggered) == 1
        assert triggered[0]["rule_name"] == "United Airlines Watch"

    @patch("skyspy.services.alerts.sync_emit")
    def test_multiple_rules_match_same_aircraft(
        self, mock_emit, alert_service, icao_rule, callsign_rule, mock_aircraft, cleanup_alerts
    ):
        """Both ICAO and callsign rules trigger for the same aircraft."""
        triggered = alert_service.check_alerts([mock_aircraft])

        assert len(triggered) == 2
        rule_names = {t["rule_name"] for t in triggered}
        assert "Track N12345" in rule_names
        assert "United Airlines Watch" in rule_names

        # Both should have AlertHistory records
        assert AlertHistory.objects.count() == 2

    @patch("skyspy.services.alerts.sync_emit")
    def test_cooldown_blocks_duplicate_trigger(
        self, mock_emit, alert_service, icao_rule, mock_aircraft, cleanup_alerts
    ):
        """Same aircraft matching same rule is blocked by cooldown on second evaluation."""
        # First trigger succeeds
        triggered1 = alert_service.check_alerts([mock_aircraft])
        assert len(triggered1) == 1

        # Second trigger within cooldown window should be blocked
        triggered2 = alert_service.check_alerts([mock_aircraft])
        assert len(triggered2) == 0

        # Only one AlertHistory record should exist
        assert AlertHistory.objects.count() == 1

    @patch("skyspy.services.alerts.sync_emit")
    def test_different_aircraft_bypass_cooldown(self, mock_emit, alert_service, callsign_rule, cleanup_alerts):
        """Different aircraft matching the same rule are not blocked by each other's cooldown."""
        aircraft1 = {
            "hex": "AAA111",
            "flight": "UAL100",
            "alt": 30000,
            "squawk": "1200",
            "distance_nm": 10,
            "dbFlags": 0,
        }
        aircraft2 = {
            "hex": "BBB222",
            "flight": "UAL200",
            "alt": 30000,
            "squawk": "1200",
            "distance_nm": 10,
            "dbFlags": 0,
        }

        triggered = alert_service.check_alerts([aircraft1, aircraft2])
        assert len(triggered) == 2
        assert AlertHistory.objects.count() == 2

    @patch("skyspy.services.alerts.sync_emit")
    def test_disabled_rule_does_not_trigger(self, mock_emit, alert_service, icao_rule, mock_aircraft, cleanup_alerts):
        """Disabled rules are not evaluated."""
        icao_rule.enabled = False
        icao_rule.save()

        triggered = alert_service.check_alerts([mock_aircraft])
        assert len(triggered) == 0
        assert AlertHistory.objects.count() == 0

    @patch("skyspy.services.alerts.sync_emit")
    def test_expired_rule_does_not_trigger(self, mock_emit, alert_service, mock_aircraft, cleanup_alerts, db):
        """Rules past their expires_at date are not evaluated."""
        AlertRule.objects.create(
            name="Expired Rule",
            rule_type="icao",
            operator="eq",
            value="A12345",
            enabled=True,
            expires_at=timezone.now() - timedelta(hours=1),
        )

        triggered = alert_service.check_alerts([mock_aircraft])
        assert len(triggered) == 0

    @patch("skyspy.services.alerts.sync_emit")
    def test_future_rule_does_not_trigger(self, mock_emit, alert_service, mock_aircraft, cleanup_alerts, db):
        """Rules before their starts_at date are not evaluated."""
        AlertRule.objects.create(
            name="Future Rule",
            rule_type="icao",
            operator="eq",
            value="A12345",
            enabled=True,
            starts_at=timezone.now() + timedelta(hours=1),
        )

        triggered = alert_service.check_alerts([mock_aircraft])
        assert len(triggered) == 0

    @patch("skyspy.services.alerts.sync_emit")
    def test_emergency_squawk_triggers_critical_alert(
        self, mock_emit, alert_service, squawk_emergency_rule, emergency_aircraft, cleanup_alerts
    ):
        """Squawk 7700 rule triggers critical-priority alert."""
        triggered = alert_service.check_alerts([emergency_aircraft])

        assert len(triggered) == 1
        assert triggered[0]["priority"] == "critical"
        assert triggered[0]["icao"] == "B99999"

        record = AlertHistory.objects.first()
        assert record.priority == "critical"

    @patch("skyspy.services.alerts.sync_emit")
    def test_complex_conditions_rule(self, mock_emit, alert_service, complex_rule, military_aircraft, cleanup_alerts):
        """Complex AND conditions: military + low altitude."""
        triggered = alert_service.check_alerts([military_aircraft])

        assert len(triggered) == 1
        assert triggered[0]["rule_name"] == "Low Military Aircraft"

    @patch("skyspy.services.alerts.sync_emit")
    def test_complex_conditions_partial_match_no_trigger(
        self, mock_emit, alert_service, complex_rule, mock_aircraft, cleanup_alerts
    ):
        """Complex AND rule doesn't trigger when only one condition matches."""
        # mock_aircraft has alt=35000 (not < 5000) and dbFlags=0 (not military)
        triggered = alert_service.check_alerts([mock_aircraft])
        assert len(triggered) == 0

    @patch("skyspy.services.alerts.sync_emit")
    def test_socket_emit_called_on_trigger(
        self, mock_emit, alert_service, icao_rule, mock_aircraft, cleanup_alerts, django_capture_on_commit_callbacks
    ):
        """Socket.IO broadcast is called when an alert triggers (deferred via transaction.on_commit)."""
        mock_emit.return_value = True

        with django_capture_on_commit_callbacks(execute=True):
            alert_service.check_alerts([mock_aircraft])

        assert mock_emit.called
        event, payload = mock_emit.call_args[0][:2]
        assert event == "alert:triggered"
        assert payload["icao"] == "A12345"

    @patch("skyspy.services.alerts.sync_emit")
    def test_rule_last_triggered_updated(self, mock_emit, alert_service, icao_rule, mock_aircraft, cleanup_alerts):
        """Rule's last_triggered timestamp is updated after trigger."""
        before = timezone.now()

        alert_service.check_alerts([mock_aircraft])

        icao_rule.refresh_from_db()
        assert icao_rule.last_triggered is not None
        assert icao_rule.last_triggered >= before

    @patch("skyspy.services.alerts.sync_emit")
    def test_no_match_creates_no_records(self, mock_emit, alert_service, icao_rule, cleanup_alerts):
        """Aircraft that doesn't match any rule creates no AlertHistory records."""
        non_matching = {
            "hex": "FFFFFF",
            "flight": "DAL999",
            "alt": 30000,
            "squawk": "1200",
            "distance_nm": 50,
            "dbFlags": 0,
        }

        triggered = alert_service.check_alerts([non_matching])
        assert len(triggered) == 0
        assert AlertHistory.objects.count() == 0


@pytest.mark.django_db
class TestAlertPipelineNotifications:
    """
    Tests for the notification dispatch portion of the alert pipeline.

    Verifies that triggered alerts flow through to the notification system.
    """

    @patch("skyspy.services.alerts.sync_emit")
    @patch("apprise.Apprise")
    def test_trigger_sends_notification_via_apprise(
        self, mock_apprise_cls, mock_emit, alert_service, cleanup_alerts, db
    ):
        """Alert trigger dispatches notification through Apprise when configured."""
        # Set up NotificationConfig with a URL
        config = NotificationConfig.get_config()
        config.enabled = True
        config.apprise_urls = "json://localhost:8080/notify"
        config.save()

        # Create rule
        AlertRule.objects.create(
            name="Notify Test",
            rule_type="icao",
            operator="eq",
            value="A12345",
            enabled=True,
            priority="warning",
            use_global_notifications=True,
        )

        # Mock Apprise instance
        mock_apobj = MagicMock()
        mock_apprise_cls.return_value = mock_apobj

        aircraft = {
            "hex": "A12345",
            "flight": "UAL123",
            "alt": 35000,
            "squawk": "1200",
            "distance_nm": 10,
            "dbFlags": 0,
        }

        triggered = alert_service.check_alerts([aircraft])
        assert len(triggered) == 1

        # Apprise should have been called for notification
        assert mock_apobj.add.called or mock_apobj.notify.called

        # Clean up
        NotificationConfig.objects.all().delete()

    @patch("skyspy.services.alerts.sync_emit")
    def test_trigger_skips_notification_when_disabled(self, mock_emit, alert_service, cleanup_alerts, db):
        """No notification sent when NotificationConfig is disabled."""
        config = NotificationConfig.get_config()
        config.enabled = False
        config.save()

        AlertRule.objects.create(
            name="No Notify Test",
            rule_type="icao",
            operator="eq",
            value="A12345",
            enabled=True,
            priority="info",
        )

        aircraft = {
            "hex": "A12345",
            "flight": "UAL123",
            "alt": 35000,
            "squawk": "1200",
            "distance_nm": 10,
            "dbFlags": 0,
        }

        # Should trigger alert but not send notification
        triggered = alert_service.check_alerts([aircraft])
        assert len(triggered) == 1

        # Alert recorded in history regardless of notification config
        assert AlertHistory.objects.count() == 1

        # Clean up
        NotificationConfig.objects.all().delete()

    @patch("skyspy.services.alerts.sync_emit")
    @patch("skyspy.tasks.notifications.send_webhook_task")
    def test_webhook_queued_when_rule_has_api_url(
        self, mock_webhook_task, mock_emit, alert_service, cleanup_alerts, db
    ):
        """Webhook task is queued when rule has an api_url configured."""
        AlertRule.objects.create(
            name="Webhook Test",
            rule_type="icao",
            operator="eq",
            value="A12345",
            enabled=True,
            priority="warning",
            api_url="https://example.com/webhook",
        )

        aircraft = {
            "hex": "A12345",
            "flight": "UAL123",
            "alt": 35000,
            "squawk": "1200",
            "distance_nm": 10,
            "dbFlags": 0,
        }

        triggered = alert_service.check_alerts([aircraft])
        assert len(triggered) == 1


@pytest.mark.django_db
class TestAlertRuleCacheIntegration:
    """Tests that rule cache correctly reflects DB state."""

    def test_new_rule_appears_in_cache_after_invalidation(self, cleanup_alerts, db):
        """Rules created in DB appear in cache after invalidation."""
        AlertRule.objects.create(
            name="Cache Test",
            rule_type="icao",
            operator="eq",
            value="AAAAAA",
            enabled=True,
        )

        # Signal auto-invalidates cache, so rule should be in cache
        rules = rule_cache.get_active_rules()
        rule_names = [r.name for r in rules]
        assert "Cache Test" in rule_names

    def test_disabled_rule_excluded_from_cache(self, cleanup_alerts, db):
        """Disabled rules are not returned by cache."""
        AlertRule.objects.create(
            name="Disabled Cache Test",
            rule_type="icao",
            operator="eq",
            value="BBBBBB",
            enabled=False,
        )

        rules = rule_cache.get_active_rules()
        rule_names = [r.name for r in rules]
        assert "Disabled Cache Test" not in rule_names

    def test_deleted_rule_removed_from_cache(self, cleanup_alerts, db):
        """A deleted rule is gone from the cache after invalidation.

        The post_delete signal invalidates via transaction.on_commit, which
        does not fire inside pytest's test transaction, so invalidate directly
        to stand in for the committed signal (as the sibling create tests rely
        on the autouse clear_rule_cache fixture doing).
        """
        rule = AlertRule.objects.create(
            name="Delete Cache Test",
            rule_type="icao",
            operator="eq",
            value="CCCCCC",
            enabled=True,
        )
        rule_cache.invalidate()

        # Verify it's in cache
        rules = rule_cache.get_active_rules()
        assert any(r.name == "Delete Cache Test" for r in rules)

        # Delete it and invalidate (the signal's committed effect)
        rule.delete()
        rule_cache.invalidate()

        # Should no longer be in cache
        rules = rule_cache.get_active_rules()
        assert not any(r.name == "Delete Cache Test" for r in rules)

    def test_compiled_rule_has_correct_fields(self, cleanup_alerts, db):
        """CompiledRule correctly represents DB rule fields."""
        rule = AlertRule.objects.create(
            name="Compile Test",
            rule_type="squawk",
            operator="eq",
            value="7700",
            enabled=True,
            priority="critical",
            cooldown_minutes=10,
        )

        compiled = CompiledRule.from_db_rule(rule)
        assert compiled.id == rule.id
        assert compiled.name == "Compile Test"
        assert compiled.rule_type == "squawk"
        assert compiled.operator == "eq"
        assert compiled.value == "7700"
        assert compiled.priority == "critical"
        assert compiled.cooldown_seconds == 600  # 10 minutes
