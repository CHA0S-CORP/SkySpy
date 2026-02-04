"""
Tests for the NotificationManager and notification services.

Tests URL validation, cooldown tracking, notification sending,
and the various convenience functions.
"""

from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.models import NotificationConfig, NotificationLog
from skyspy.services.notifications import (
    NotificationManager,
    _is_safe_url,
    _notification_cooldown,
    _notification_cooldown_lock,
    cleanup_cooldowns,
    send_alert_notification,
    send_notification,
    send_safety_notification,
)


class UrlSafetyValidationTests(TestCase):
    """Tests for URL safety validation (SSRF prevention)."""

    def test_valid_https_url(self):
        """Test that valid HTTPS URLs pass validation."""
        assert _is_safe_url("https://hooks.slack.com/services/xxx") is True

    def test_valid_http_url(self):
        """Test that valid HTTP URLs pass validation."""
        assert _is_safe_url("http://example.com/webhook") is True

    def test_invalid_scheme_ftp(self):
        """Test that FTP URLs are blocked."""
        assert _is_safe_url("ftp://example.com/file") is False

    def test_invalid_scheme_file(self):
        """Test that file:// URLs are blocked."""
        assert _is_safe_url("file:///etc/passwd") is False

    def test_invalid_scheme_javascript(self):
        """Test that javascript: URLs are blocked."""
        assert _is_safe_url("javascript:alert(1)") is False

    def test_private_ip_loopback(self):
        """Test that loopback addresses are blocked."""
        assert _is_safe_url("http://127.0.0.1/webhook") is False
        assert _is_safe_url("http://127.0.0.100/webhook") is False

    def test_private_ip_class_a(self):
        """Test that Class A private addresses are blocked."""
        assert _is_safe_url("http://10.0.0.1/webhook") is False
        assert _is_safe_url("http://10.255.255.255/webhook") is False

    def test_private_ip_class_b(self):
        """Test that Class B private addresses are blocked."""
        assert _is_safe_url("http://172.16.0.1/webhook") is False
        assert _is_safe_url("http://172.31.255.255/webhook") is False

    def test_private_ip_class_c(self):
        """Test that Class C private addresses are blocked."""
        assert _is_safe_url("http://192.168.0.1/webhook") is False
        assert _is_safe_url("http://192.168.1.100/webhook") is False

    def test_link_local_address(self):
        """Test that link-local addresses are blocked."""
        assert _is_safe_url("http://169.254.0.1/webhook") is False

    def test_ipv6_loopback(self):
        """Test that IPv6 loopback is blocked."""
        assert _is_safe_url("http://[::1]/webhook") is False

    def test_public_hostname_allowed(self):
        """Test that public hostnames are allowed."""
        assert _is_safe_url("https://discord.com/api/webhooks/xxx") is True
        assert _is_safe_url("https://api.pushover.net/1/messages.json") is True

    def test_url_without_hostname(self):
        """Test that URLs without hostnames are blocked."""
        assert _is_safe_url("http:///webhook") is False

    def test_malformed_url(self):
        """Test that malformed URLs are handled gracefully."""
        assert _is_safe_url("not-a-url") is False
        assert _is_safe_url("") is False


class NotificationManagerSetupTests(TestCase):
    """Tests for NotificationManager initialization."""

    @patch("apprise.Apprise")
    def test_init_creates_apprise_instance(self, mock_apprise_class):
        """Test that initialization creates an Apprise instance."""
        manager = NotificationManager()
        mock_apprise_class.assert_called_once()
        assert manager.apprise is not None

    @patch("apprise.Apprise")
    @override_settings(APPRISE_URLS="tgram://token/chat,slack://token")
    def test_setup_loads_urls_from_settings(self, mock_apprise_class):
        """Test that APPRISE_URLS are loaded from settings."""
        mock_instance = MagicMock()
        mock_apprise_class.return_value = mock_instance

        NotificationManager()

        # Should add each URL from settings
        assert mock_instance.add.call_count == 2

    @patch("apprise.Apprise")
    def test_reload_urls_clears_and_adds(self, mock_apprise_class):
        """Test that reload_urls clears existing and adds new URLs."""
        mock_instance = MagicMock()
        mock_apprise_class.return_value = mock_instance

        manager = NotificationManager()
        manager.reload_urls("discord://webhook1,slack://webhook2")

        mock_instance.clear.assert_called()
        assert mock_instance.add.call_count >= 2


class NotificationManagerCooldownTests(TestCase):
    """Tests for notification cooldown tracking."""

    def setUp(self):
        """Set up test fixtures."""
        # Clear cooldowns before each test
        with _notification_cooldown_lock:
            _notification_cooldown.clear()

    def tearDown(self):
        """Clean up after tests."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()

    @patch("apprise.Apprise")
    def test_can_notify_first_time_returns_true(self, mock_apprise_class):
        """Test that first notification for a key passes."""
        manager = NotificationManager()
        assert manager.can_notify("test_key") is True

    @patch("apprise.Apprise")
    def test_can_notify_within_cooldown_returns_false(self, mock_apprise_class):
        """Test that second notification within cooldown is blocked."""
        manager = NotificationManager()

        # First notification passes
        assert manager.can_notify("test_key", cooldown=300) is True

        # Second notification immediately after is blocked
        assert manager.can_notify("test_key", cooldown=300) is False

    @patch("apprise.Apprise")
    def test_can_notify_different_keys_independent(self, mock_apprise_class):
        """Test that different keys have independent cooldowns."""
        manager = NotificationManager()

        assert manager.can_notify("key1", cooldown=300) is True
        assert manager.can_notify("key2", cooldown=300) is True

        # key1 should still be blocked
        assert manager.can_notify("key1", cooldown=300) is False

    @patch("apprise.Apprise")
    def test_can_notify_after_cooldown_expires(self, mock_apprise_class):
        """Test that notification passes after cooldown expires by simulating old timestamp."""
        import time as time_module

        manager = NotificationManager()

        # Set an old timestamp directly in the cooldown dict
        with _notification_cooldown_lock:
            _notification_cooldown["test_key_expire"] = time_module.time() - 100

        # Should pass because cooldown (60s) has expired
        assert manager.can_notify("test_key_expire", cooldown=60) is True


class NotificationManagerSendTests(TestCase):
    """Tests for sending notifications."""

    def setUp(self):
        """Set up test fixtures."""
        # Clear cooldowns
        with _notification_cooldown_lock:
            _notification_cooldown.clear()
        # Create notification config
        NotificationConfig.objects.all().delete()
        NotificationLog.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()
        NotificationConfig.objects.all().delete()
        NotificationLog.objects.all().delete()

    @patch("apprise.Apprise")
    def test_send_disabled_config_returns_false(self, mock_apprise_class):
        """Test that notifications are not sent when disabled."""
        config = NotificationConfig.get_config()
        config.enabled = False
        config.save()

        manager = NotificationManager()
        result = manager.send("Test", "Test body")

        assert result is False

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_success_logs_notification(self, mock_notify_type, mock_apprise_class):
        """Test that successful send creates a log entry."""
        config = NotificationConfig.get_config()
        config.enabled = True
        config.apprise_urls = "tgram://token/chat"
        config.save()

        mock_instance = MagicMock()
        mock_instance.notify.return_value = True
        mock_instance.servers = [MagicMock()]
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.INFO = "info"

        manager = NotificationManager()
        manager.apprise = mock_instance  # Override the apprise instance

        result = manager.send(
            "Test Alert",
            "Test body",
            notify_type="info",
            icao="ABC123",
            callsign="UAL456",
        )

        assert result is True
        assert NotificationLog.objects.count() == 1

        log = NotificationLog.objects.first()
        assert log.notification_type == "info"
        assert log.icao_hex == "ABC123"
        assert log.callsign == "UAL456"

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_with_api_url_uses_custom_notifier(self, mock_notify_type, mock_apprise_class):
        """Test that custom API URL creates separate Apprise instance."""
        config = NotificationConfig.get_config()
        config.enabled = True
        config.save()

        mock_instance = MagicMock()
        mock_instance.notify.return_value = True
        mock_instance.servers = [MagicMock()]
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.INFO = "info"

        manager = NotificationManager()

        manager.send(
            "Test Alert",
            "Test body",
            api_url="https://example.com/webhook",
        )

        # A new Apprise instance should be created for custom URL
        assert mock_apprise_class.call_count >= 2  # One for init, one for custom URL

    @patch("apprise.Apprise")
    def test_send_with_unsafe_api_url_blocked(self, mock_apprise_class):
        """Test that unsafe API URLs are blocked."""
        config = NotificationConfig.get_config()
        config.enabled = True
        config.save()

        mock_instance = MagicMock()
        mock_apprise_class.return_value = mock_instance

        manager = NotificationManager()

        result = manager.send(
            "Test Alert",
            "Test body",
            api_url="http://127.0.0.1/internal",
        )

        assert result is False

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_warning_uses_warning_type(self, mock_notify_type, mock_apprise_class):
        """Test that warning priority uses WARNING notify type."""
        config = NotificationConfig.get_config()
        config.enabled = True
        config.apprise_urls = "tgram://token/chat"
        config.save()

        mock_instance = MagicMock()
        mock_instance.notify.return_value = True
        mock_instance.servers = [MagicMock()]
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.INFO = "info"
        mock_notify_type.WARNING = "warning"

        manager = NotificationManager()
        manager.apprise = mock_instance

        manager.send("Test", "Body", notify_type="warning")

        mock_instance.notify.assert_called_once()
        call_kwargs = mock_instance.notify.call_args[1]
        assert call_kwargs["notify_type"] == "warning"

    @patch("apprise.Apprise")
    @patch("apprise.NotifyType")
    def test_send_critical_uses_failure_type(self, mock_notify_type, mock_apprise_class):
        """Test that critical priority uses FAILURE notify type."""
        config = NotificationConfig.get_config()
        config.enabled = True
        config.apprise_urls = "tgram://token/chat"
        config.save()

        mock_instance = MagicMock()
        mock_instance.notify.return_value = True
        mock_instance.servers = [MagicMock()]
        mock_apprise_class.return_value = mock_instance
        mock_notify_type.INFO = "info"
        mock_notify_type.FAILURE = "failure"

        manager = NotificationManager()
        manager.apprise = mock_instance

        manager.send("Test", "Body", notify_type="critical")

        mock_instance.notify.assert_called_once()
        call_kwargs = mock_instance.notify.call_args[1]
        assert call_kwargs["notify_type"] == "failure"


class NotificationManagerStatusTests(TestCase):
    """Tests for notification status retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()
        NotificationConfig.objects.all().delete()

    def tearDown(self):
        """Clean up."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()
        NotificationConfig.objects.all().delete()

    @patch("apprise.Apprise")
    def test_get_status_returns_correct_info(self, mock_apprise_class):
        """Test that get_status returns expected fields."""
        config = NotificationConfig.get_config()
        config.enabled = True
        config.cooldown_seconds = 120
        config.save()

        mock_instance = MagicMock()
        mock_instance.servers = [MagicMock(), MagicMock()]
        mock_apprise_class.return_value = mock_instance

        manager = NotificationManager()
        manager.apprise = mock_instance

        status = manager.get_status()

        assert status["enabled"] is True
        assert status["server_count"] == 2
        assert status["cooldown_seconds"] == 120
        assert "active_cooldowns" in status

    @patch("apprise.Apprise")
    def test_server_count_property(self, mock_apprise_class):
        """Test that server_count returns correct number."""
        mock_instance = MagicMock()
        mock_instance.servers = [MagicMock(), MagicMock(), MagicMock()]
        mock_apprise_class.return_value = mock_instance

        manager = NotificationManager()
        manager.apprise = mock_instance

        assert manager.server_count == 3


class ConvenienceFunctionsTests(TestCase):
    """Tests for convenience functions."""

    def setUp(self):
        """Set up test fixtures."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()
        NotificationConfig.objects.all().delete()
        NotificationLog.objects.all().delete()

    def tearDown(self):
        """Clean up."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()
        NotificationConfig.objects.all().delete()
        NotificationLog.objects.all().delete()

    @patch("skyspy.services.notifications.notifier")
    def test_send_notification_calls_manager(self, mock_notifier):
        """Test that send_notification calls the global notifier."""
        mock_notifier.send.return_value = True

        result = send_notification("Test", "Body", notify_type="info")

        mock_notifier.send.assert_called_once_with("Test", "Body", "info")
        assert result is True

    @patch("skyspy.services.notifications.notifier")
    def test_send_alert_notification_formats_correctly(self, mock_notifier):
        """Test that send_alert_notification formats title and body."""
        mock_notifier.send.return_value = True

        send_alert_notification(
            rule_name="Test Rule",
            icao="ABC123",
            callsign="UAL456",
            message="Aircraft spotted",
            priority="warning",
        )

        mock_notifier.send.assert_called_once()
        call_kwargs = mock_notifier.send.call_args[1]
        assert call_kwargs["title"] == "Alert: Test Rule"
        assert "ABC123" in call_kwargs["body"]
        assert "UAL456" in call_kwargs["body"]
        assert "Aircraft spotted" in call_kwargs["body"]
        assert call_kwargs["notify_type"] == "warning"
        assert call_kwargs["key"] == "alert:Test Rule:ABC123"

    @patch("skyspy.services.notifications.notifier")
    def test_send_alert_notification_without_callsign(self, mock_notifier):
        """Test alert notification without callsign."""
        mock_notifier.send.return_value = True

        send_alert_notification(
            rule_name="Test Rule",
            icao="ABC123",
            callsign=None,
            message="Aircraft spotted",
        )

        call_kwargs = mock_notifier.send.call_args[1]
        assert "ABC123" in call_kwargs["body"]
        assert "()" not in call_kwargs["body"]  # No empty callsign parens

    @patch("skyspy.services.notifications.notifier")
    def test_send_safety_notification_formats_correctly(self, mock_notifier):
        """Test that send_safety_notification formats title and body."""
        mock_notifier.send.return_value = True

        send_safety_notification(
            event_type="tcas_ra",
            icao="ABC123",
            callsign="UAL456",
            message="TCAS Resolution Advisory",
            severity="critical",
        )

        mock_notifier.send.assert_called_once()
        call_kwargs = mock_notifier.send.call_args[1]
        assert call_kwargs["title"] == "Safety Event: tcas_ra"
        assert "ABC123" in call_kwargs["body"]
        assert "UAL456" in call_kwargs["body"]
        assert call_kwargs["notify_type"] == "critical"
        assert call_kwargs["key"] == "safety:tcas_ra:ABC123"


class CleanupCooldownsTests(TestCase):
    """Tests for cooldown cleanup functionality."""

    def setUp(self):
        """Set up test fixtures."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()

    def tearDown(self):
        """Clean up."""
        with _notification_cooldown_lock:
            _notification_cooldown.clear()

    def test_cleanup_removes_old_entries(self):
        """Test that cleanup removes entries older than 10 minutes."""
        import time as time_module

        now = time_module.time()

        # Add some cooldown entries
        with _notification_cooldown_lock:
            _notification_cooldown["old_key1"] = now - 700  # Very old (>600s)
            _notification_cooldown["old_key2"] = now - 650  # Old (>600s)
            _notification_cooldown["recent_key"] = now - 100  # Recent (<600s)

        cleanup_cooldowns()

        with _notification_cooldown_lock:
            assert "old_key1" not in _notification_cooldown
            assert "old_key2" not in _notification_cooldown
            assert "recent_key" in _notification_cooldown

    def test_cleanup_handles_empty_cooldowns(self):
        """Test that cleanup handles empty cooldown dict gracefully."""
        cleanup_cooldowns()  # Should not raise


@pytest.mark.django_db
class NotificationManagerIntegrationTests:
    """Integration tests for NotificationManager with database."""

    def test_reload_from_db_loads_config(self):
        """Test that reload_from_db reads configuration from database."""
        config = NotificationConfig.get_config()
        config.apprise_urls = "discord://webhook/token,slack://token"
        config.save()

        with patch("apprise.Apprise") as mock_apprise_class:
            mock_instance = MagicMock()
            mock_apprise_class.return_value = mock_instance

            manager = NotificationManager()
            manager.reload_from_db()

            # Should have cleared and added the two URLs
            mock_instance.clear.assert_called()
            assert mock_instance.add.call_count >= 2
