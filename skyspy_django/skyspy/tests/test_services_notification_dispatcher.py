"""
Tests for the NotificationDispatcher service.

Tests dispatch logic for alerts and safety events, payload preparation,
template rendering, rich formatting, and delivery methods.
"""

from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth.models import User
from django.test import TestCase

from skyspy.services.notification_dispatcher import (
    NotificationDispatcher,
    NotificationPayload,
    dispatch_alert_notification,
    dispatch_safety_notification,
)
from skyspy.services.notification_router import RoutedNotification


class NotificationPayloadTests(TestCase):
    """Tests for NotificationPayload dataclass."""

    def test_payload_creation_with_required_fields(self):
        """Test creating payload with required fields only."""
        payload = NotificationPayload(
            channel_id=1,
            channel_type="discord",
            apprise_url="discord://webhook/token",
            title="Test Alert",
            body="Test body",
            priority="info",
            event_type="alert",
        )

        assert payload.channel_id == 1
        assert payload.channel_type == "discord"
        assert payload.title == "Test Alert"
        assert payload.rich_payload is None
        assert payload.user_id is None

    def test_payload_creation_with_all_fields(self):
        """Test creating payload with all fields."""
        payload = NotificationPayload(
            channel_id=1,
            channel_type="slack",
            apprise_url="slack://token",
            title="Test Alert",
            body="Test body",
            priority="warning",
            event_type="safety",
            rich_payload={"blocks": []},
            context={"icao": "ABC123"},
            user_id=42,
        )

        assert payload.rich_payload == {"blocks": []}
        assert payload.context == {"icao": "ABC123"}
        assert payload.user_id == 42


class NotificationDispatcherAlertTests(TestCase):
    """Tests for alert dispatch."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()
        self.sample_alert_data = {
            "rule_name": "Military Watch",
            "rule_type": "military",
            "rule_id": 1,
            "priority": "warning",
            "message": "Military aircraft detected",
            "aircraft": {
                "hex": "ABC123",
                "flight": "RCH456",
                "alt": 32000,
                "gs": 450,
                "t": "C17",
                "military": True,
            },
        }

    @patch("skyspy.services.notification_dispatcher.notification_router")
    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_dispatch_alert_with_channels(self, mock_template_engine, mock_router):
        """Test dispatching alert to configured channels."""
        # Set up mock router to return channels
        mock_router.get_channels_for_notification.return_value = [
            RoutedNotification(
                channel_id=1,
                channel_name="Discord Channel",
                channel_type="discord",
                apprise_url="discord://webhook/token",
                supports_rich=True,
            ),
        ]

        # Set up template engine mock
        mock_template_engine.build_context_from_alert.return_value = {
            "rule_name": "Military Watch",
            "icao": "ABC123",
        }
        mock_template_engine.render.return_value = "Rendered text"

        # Mock the template retrieval
        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            payloads = self.dispatcher.dispatch_alert(
                self.sample_alert_data,
                use_celery=False,
            )

        assert len(payloads) == 1
        assert payloads[0].channel_type == "discord"
        assert payloads[0].priority == "warning"

    @patch("skyspy.services.notification_dispatcher.notification_router")
    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_dispatch_alert_uses_fallback_channels(self, mock_template_engine, mock_router):
        """Test that fallback channels are used when no channels configured."""
        mock_router.get_channels_for_notification.return_value = []
        mock_router.get_fallback_channels.return_value = [
            RoutedNotification(
                channel_id=0,
                channel_name="Legacy Channel",
                channel_type="webhook",
                apprise_url="https://example.com/webhook",
                supports_rich=False,
            ),
        ]

        mock_template_engine.build_context_from_alert.return_value = {"rule_name": "Test"}
        mock_template_engine.render.return_value = "Rendered"

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            payloads = self.dispatcher.dispatch_alert(
                self.sample_alert_data,
                use_celery=False,
            )

        mock_router.get_fallback_channels.assert_called_once()
        assert len(payloads) == 1
        assert payloads[0].channel_type == "webhook"

    @patch("skyspy.services.notification_dispatcher.notification_router")
    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_dispatch_alert_with_rule_webhook(self, mock_template_engine, mock_router):
        """Test dispatching alert with rule-specific webhook URL."""
        mock_router.get_channels_for_notification.return_value = [
            RoutedNotification(
                channel_id=0,
                channel_name="Rule Webhook",
                channel_type="webhook",
                apprise_url="https://custom.webhook.com",
                supports_rich=False,
            ),
        ]

        mock_template_engine.build_context_from_alert.return_value = {"rule_name": "Test"}
        mock_template_engine.render.return_value = "Rendered"

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            self.dispatcher.dispatch_alert(
                self.sample_alert_data,
                rule_webhook_url="https://custom.webhook.com",
                use_celery=False,
            )

        # Verify router was called with the webhook URL
        mock_router.get_channels_for_notification.assert_called_once()
        call_kwargs = mock_router.get_channels_for_notification.call_args[1]
        assert call_kwargs["rule_webhook_url"] == "https://custom.webhook.com"


class NotificationDispatcherSafetyEventTests(TestCase):
    """Tests for safety event dispatch."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()
        self.sample_safety_event = {
            "event_type": "tcas_ra",
            "severity": "critical",
            "message": "TCAS Resolution Advisory - Climb",
            "icao_hex": "ABC123",
            "callsign": "UAL456",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
                "alt": 35000,
                "vr": 2500,
            },
        }

    @patch("skyspy.services.notification_dispatcher.notification_router")
    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_dispatch_safety_event_uses_severity_as_priority(
        self, mock_template_engine, mock_router
    ):
        """Test that safety event severity maps to priority."""
        mock_router.get_channels_for_priority.return_value = [
            RoutedNotification(
                channel_id=1,
                channel_name="Discord",
                channel_type="discord",
                apprise_url="discord://webhook/token",
                supports_rich=True,
            ),
        ]

        mock_template_engine.build_context_from_safety_event.return_value = {
            "event_type": "tcas_ra",
        }
        mock_template_engine.render.return_value = "Rendered"

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            payloads = self.dispatcher.dispatch_safety_event(
                self.sample_safety_event,
                use_celery=False,
            )

        assert len(payloads) == 1
        assert payloads[0].priority == "critical"
        assert payloads[0].event_type == "tcas_ra"

    @patch("skyspy.services.notification_dispatcher.notification_router")
    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_dispatch_safety_event_default_severity(
        self, mock_template_engine, mock_router
    ):
        """Test that default severity is warning."""
        event_without_severity = {
            "event_type": "proximity_conflict",
            "message": "Aircraft proximity alert",
            "aircraft": {"hex": "ABC123"},
        }

        mock_router.get_channels_for_priority.return_value = []
        mock_router.get_fallback_channels.return_value = [
            RoutedNotification(
                channel_id=0,
                channel_name="Legacy",
                channel_type="webhook",
                apprise_url="https://example.com",
                supports_rich=False,
            ),
        ]

        mock_template_engine.build_context_from_safety_event.return_value = {}
        mock_template_engine.render.return_value = "Rendered"

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            payloads = self.dispatcher.dispatch_safety_event(
                event_without_severity,
                use_celery=False,
            )

        assert payloads[0].priority == "warning"


class PreparePayloadTests(TestCase):
    """Tests for payload preparation."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()

    @patch("skyspy.services.notification_dispatcher.template_engine")
    @patch("skyspy.services.notification_dispatcher.rich_formatter")
    def test_prepare_payload_with_template(self, mock_rich_formatter, mock_template_engine):
        """Test payload preparation with database template."""
        mock_template_engine.render.side_effect = [
            "Rendered Title",
            "Rendered Body",
        ]

        channel = RoutedNotification(
            channel_id=1,
            channel_name="Test Channel",
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            supports_rich=False,
        )

        context = {
            "rule_name": "Test Rule",
            "icao": "ABC123",
        }

        # Mock template
        mock_template = MagicMock()
        mock_template.title_template = "{rule_name} Alert"
        mock_template.body_template = "Aircraft {icao} detected"
        mock_template.discord_embed = None
        mock_template.slack_blocks = None

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = mock_template

            payload = self.dispatcher._prepare_payload(
                channel=channel,
                context=context,
                event_type="alert",
                priority="info",
            )

        assert payload.title == "Rendered Title"
        assert payload.body == "Rendered Body"
        assert payload.channel_id == 1
        assert payload.priority == "info"

    @patch("skyspy.services.notification_dispatcher.template_engine")
    @patch("skyspy.services.notification_dispatcher.rich_formatter")
    def test_prepare_payload_default_template(self, mock_rich_formatter, mock_template_engine):
        """Test payload preparation with default template when none found."""
        channel = RoutedNotification(
            channel_id=1,
            channel_name="Test Channel",
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            supports_rich=False,
        )

        context = {
            "rule_name": "My Rule",
            "message": "Custom message",
        }

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            payload = self.dispatcher._prepare_payload(
                channel=channel,
                context=context,
                event_type="alert",
                priority="warning",
            )

        assert "My Rule" in payload.title
        assert payload.body == "Custom message"

    @patch("skyspy.services.notification_dispatcher.template_engine")
    @patch("skyspy.services.notification_dispatcher.rich_formatter")
    def test_prepare_payload_with_rich_formatting(self, mock_rich_formatter, mock_template_engine):
        """Test that rich formatting is applied for supported channels."""
        mock_rich_formatter.format.return_value = {"embeds": [{"title": "Test"}]}
        mock_template_engine.render.return_value = "Rendered"

        channel = RoutedNotification(
            channel_id=1,
            channel_name="Discord Channel",
            channel_type="discord",
            apprise_url="discord://webhook/token",
            supports_rich=True,
        )

        context = {"rule_name": "Test"}

        with patch("skyspy.models.notifications.NotificationTemplate.get_template_for") as mock_get_template:
            mock_get_template.return_value = None

            payload = self.dispatcher._prepare_payload(
                channel=channel,
                context=context,
                event_type="alert",
                priority="info",
            )

        mock_rich_formatter.format.assert_called_once_with(
            channel_type="discord",
            event_type="alert",
            data=context,
        )
        assert payload.rich_payload == {"embeds": [{"title": "Test"}]}


class RenderJsonTemplateTests(TestCase):
    """Tests for JSON template rendering."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()

    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_render_json_template_dict(self, mock_template_engine):
        """Test rendering dict template with variables."""
        mock_template_engine.render.side_effect = lambda t, c: t.replace("{icao}", "ABC123")

        template = {
            "title": "{icao} Alert",
            "color": 16711680,
        }
        context = {"icao": "ABC123"}

        result = self.dispatcher._render_json_template(template, context)

        assert result["title"] == "ABC123 Alert"
        assert result["color"] == 16711680  # Non-strings unchanged

    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_render_json_template_list(self, mock_template_engine):
        """Test rendering list template with variables."""
        mock_template_engine.render.side_effect = lambda t, c: t.replace("{callsign}", "UAL456")

        template = [
            {"text": "Flight: {callsign}"},
            {"text": "Status: Active"},
        ]
        context = {"callsign": "UAL456"}

        result = self.dispatcher._render_json_template(template, context)

        assert result[0]["text"] == "Flight: UAL456"
        assert result[1]["text"] == "Status: Active"

    @patch("skyspy.services.notification_dispatcher.template_engine")
    def test_render_json_template_nested(self, mock_template_engine):
        """Test rendering deeply nested template."""
        mock_template_engine.render.side_effect = lambda t, c: t.replace("{value}", "test")

        template = {
            "outer": {
                "inner": {
                    "field": "{value}",
                },
            },
        }
        context = {"value": "test"}

        result = self.dispatcher._render_json_template(template, context)

        assert result["outer"]["inner"]["field"] == "test"


class QueuePayloadsTests(TestCase):
    """Tests for payload queuing."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()

    @patch("skyspy.tasks.notifications.send_notification_task")
    def test_queue_payloads_calls_celery(self, mock_task):
        """Test that payloads are queued via Celery."""
        payload = NotificationPayload(
            channel_id=1,
            channel_type="discord",
            apprise_url="discord://webhook/token",
            title="Test",
            body="Body",
            priority="info",
            event_type="alert",
            rich_payload={"embeds": []},
            context={"icao": "ABC123"},
        )

        self.dispatcher._queue_payloads([payload])

        mock_task.delay.assert_called_once()
        call_kwargs = mock_task.delay.call_args[1]
        assert call_kwargs["channel_url"] == "discord://webhook/token"
        assert call_kwargs["title"] == "Test"
        assert call_kwargs["priority"] == "info"

    @patch("skyspy.tasks.notifications.send_notification_task")
    def test_queue_payloads_fallback_to_sync(self, mock_task):
        """Test that sync delivery is used when Celery fails."""
        mock_task.delay.side_effect = Exception("Celery unavailable")

        payload = NotificationPayload(
            channel_id=1,
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            title="Test",
            body="Body",
            priority="info",
            event_type="alert",
        )

        with patch.object(self.dispatcher, "_send_payload_sync") as mock_sync:
            self.dispatcher._queue_payloads([payload])
            mock_sync.assert_called_once_with(payload)


class SendPayloadSyncTests(TestCase):
    """Tests for synchronous payload delivery."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_payload_sync_success(self, mock_notify_type, mock_apprise_class):
        """Test successful synchronous delivery."""
        mock_instance = MagicMock()
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.INFO = "info"

        payload = NotificationPayload(
            channel_id=1,
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            title="Test Alert",
            body="Test body",
            priority="info",
            event_type="alert",
            context={"icao": "ABC123"},
        )

        with patch.object(self.dispatcher, "_log_notification") as mock_log:
            self.dispatcher._send_payload_sync(payload)

        mock_instance.add.assert_called_once_with("https://example.com/webhook")
        mock_instance.notify.assert_called_once()
        mock_log.assert_called_once()
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["status"] == "sent"

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_payload_sync_warning_priority(self, mock_notify_type, mock_apprise_class):
        """Test that warning priority uses correct notify type."""
        mock_instance = MagicMock()
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.WARNING = "warning"

        payload = NotificationPayload(
            channel_id=1,
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            title="Test",
            body="Body",
            priority="warning",
            event_type="alert",
        )

        with patch.object(self.dispatcher, "_log_notification"):
            self.dispatcher._send_payload_sync(payload)

        call_kwargs = mock_instance.notify.call_args[1]
        assert call_kwargs["notify_type"] == "warning"

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_payload_sync_critical_priority(self, mock_notify_type, mock_apprise_class):
        """Test that critical priority uses FAILURE type."""
        mock_instance = MagicMock()
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.FAILURE = "failure"

        payload = NotificationPayload(
            channel_id=1,
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            title="Test",
            body="Body",
            priority="critical",
            event_type="safety",
        )

        with patch.object(self.dispatcher, "_log_notification"):
            self.dispatcher._send_payload_sync(payload)

        call_kwargs = mock_instance.notify.call_args[1]
        assert call_kwargs["notify_type"] == "failure"

    @patch("apprise.Apprise")
    def test_send_payload_sync_failure_logs_error(self, mock_apprise_class):
        """Test that delivery failures are logged."""
        mock_instance = MagicMock()
        mock_instance.notify.side_effect = Exception("Connection failed")
        mock_apprise_class.return_value = mock_instance

        payload = NotificationPayload(
            channel_id=1,
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
            title="Test",
            body="Body",
            priority="info",
            event_type="alert",
        )

        with patch.object(self.dispatcher, "_log_notification") as mock_log:
            self.dispatcher._send_payload_sync(payload)

        mock_log.assert_called_once()
        call_kwargs = mock_log.call_args[1]
        assert call_kwargs["status"] == "failed"
        assert "Connection failed" in call_kwargs["error"]


class LogNotificationTests(TestCase):
    """Tests for notification logging."""

    def setUp(self):
        """Set up test fixtures."""
        self.dispatcher = NotificationDispatcher()

    @patch("skyspy.models.notifications.NotificationLog.objects.create")
    @patch("skyspy.models.notifications.NotificationChannel.objects.get")
    def test_log_notification_creates_record(self, mock_channel_get, mock_log_create):
        """Test that logging creates a NotificationLog record."""
        mock_channel = MagicMock()
        mock_channel_get.return_value = mock_channel

        payload = NotificationPayload(
            channel_id=1,
            channel_type="discord",
            apprise_url="discord://webhook/token",
            title="Test",
            body="Body text that is quite long",
            priority="info",
            event_type="alert",
            context={"icao": "ABC123", "callsign": "UAL456"},
        )

        self.dispatcher._log_notification(payload, status="sent")

        mock_log_create.assert_called_once()
        call_kwargs = mock_log_create.call_args[1]
        assert call_kwargs["notification_type"] == "alert"
        assert call_kwargs["icao_hex"] == "ABC123"
        assert call_kwargs["callsign"] == "UAL456"
        assert call_kwargs["status"] == "sent"
        assert call_kwargs["channel"] == mock_channel

    @patch("skyspy.models.notifications.NotificationLog.objects.create")
    @patch("skyspy.models.notifications.NotificationChannel.objects.get")
    def test_log_notification_with_error(self, mock_channel_get, mock_log_create):
        """Test logging with error message."""
        mock_channel_get.side_effect = Exception("Channel not found")

        payload = NotificationPayload(
            channel_id=0,  # No channel
            channel_type="webhook",
            apprise_url="https://example.com",
            title="Test",
            body="Body",
            priority="info",
            event_type="alert",
            context={},
        )

        self.dispatcher._log_notification(
            payload,
            status="failed",
            error="Connection timeout",
        )

        call_kwargs = mock_log_create.call_args[1]
        assert call_kwargs["status"] == "failed"
        assert call_kwargs["last_error"] == "Connection timeout"


class ConvenienceFunctionsTests(TestCase):
    """Tests for dispatch convenience functions."""

    @patch("skyspy.services.notification_dispatcher.notification_dispatcher")
    def test_dispatch_alert_notification_calls_dispatcher(self, mock_dispatcher):
        """Test that convenience function calls dispatcher."""
        mock_dispatcher.dispatch_alert.return_value = []

        alert_data = {"rule_name": "Test", "priority": "info"}
        dispatch_alert_notification(alert_data, use_celery=False)

        mock_dispatcher.dispatch_alert.assert_called_once_with(
            alert_data,
            use_celery=False,
        )

    @patch("skyspy.services.notification_dispatcher.notification_dispatcher")
    def test_dispatch_safety_notification_calls_dispatcher(self, mock_dispatcher):
        """Test that convenience function calls dispatcher."""
        mock_dispatcher.dispatch_safety_event.return_value = []

        event_data = {"event_type": "tcas_ra", "severity": "critical"}
        dispatch_safety_notification(event_data, use_celery=True)

        mock_dispatcher.dispatch_safety_event.assert_called_once_with(
            event_data,
            use_celery=True,
        )


@pytest.mark.django_db
class NotificationDispatcherIntegrationTests:
    """Integration tests with database models."""

    def test_dispatch_alert_with_db_template(self):
        """Test dispatching with template from database."""
        from skyspy.models.notifications import NotificationTemplate

        # Create template
        NotificationTemplate.objects.create(
            name="Alert Template",
            title_template="[{priority}] {rule_name}",
            body_template="{callsign} ({icao}) - {message}",
            event_type="alert",
            priority="warning",
        )

        # NotificationDispatcher would be used here with full mocking setup
        # This would need full mocking setup for complete test

    def test_dispatch_alert_logs_to_database(self):
        """Test that dispatched alerts are logged."""
        from skyspy.models.notifications import NotificationLog

        # Would need full integration test setup
        pass
