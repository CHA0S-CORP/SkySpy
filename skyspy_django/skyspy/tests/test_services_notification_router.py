"""
Tests for the NotificationRouter service.

Tests routing rules, priority handling, channel selection,
user preferences, quiet hours, and fallback channel logic.
"""

from datetime import time
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth.models import User
from django.test import TestCase

from skyspy.services.notification_router import (
    NotificationRouter,
    RoutedNotification,
    notification_router,
)


class RoutedNotificationTests(TestCase):
    """Tests for RoutedNotification dataclass."""

    def test_routed_notification_required_fields(self):
        """Test creating RoutedNotification with required fields."""
        routed = RoutedNotification(
            channel_id=1,
            channel_name="Discord Channel",
            channel_type="discord",
            apprise_url="discord://webhook/token",
            supports_rich=True,
        )

        assert routed.channel_id == 1
        assert routed.channel_name == "Discord Channel"
        assert routed.channel_type == "discord"
        assert routed.apprise_url == "discord://webhook/token"
        assert routed.supports_rich is True
        assert routed.user_id is None
        assert routed.preference_id is None

    def test_routed_notification_all_fields(self):
        """Test creating RoutedNotification with all fields."""
        routed = RoutedNotification(
            channel_id=1,
            channel_name="User's Slack",
            channel_type="slack",
            apprise_url="slack://token",
            supports_rich=True,
            user_id=42,
            preference_id=10,
        )

        assert routed.user_id == 42
        assert routed.preference_id == 10


class PriorityOrderTests(TestCase):
    """Tests for priority ordering."""

    def test_priority_order_values(self):
        """Test that priority order is correct."""
        router = NotificationRouter()

        assert router.PRIORITY_ORDER["info"] == 0
        assert router.PRIORITY_ORDER["warning"] == 1
        assert router.PRIORITY_ORDER["critical"] == 2

    def test_should_notify_info_meets_info(self):
        """Test info notification meets info threshold."""
        router = NotificationRouter()
        assert router.should_notify("info", "info") is True

    def test_should_notify_warning_meets_info(self):
        """Test warning notification meets info threshold."""
        router = NotificationRouter()
        assert router.should_notify("warning", "info") is True

    def test_should_notify_critical_meets_info(self):
        """Test critical notification meets info threshold."""
        router = NotificationRouter()
        assert router.should_notify("critical", "info") is True

    def test_should_notify_info_below_warning(self):
        """Test info notification below warning threshold."""
        router = NotificationRouter()
        assert router.should_notify("info", "warning") is False

    def test_should_notify_warning_meets_warning(self):
        """Test warning notification meets warning threshold."""
        router = NotificationRouter()
        assert router.should_notify("warning", "warning") is True

    def test_should_notify_critical_meets_warning(self):
        """Test critical notification meets warning threshold."""
        router = NotificationRouter()
        assert router.should_notify("critical", "warning") is True

    def test_should_notify_info_below_critical(self):
        """Test info notification below critical threshold."""
        router = NotificationRouter()
        assert router.should_notify("info", "critical") is False

    def test_should_notify_warning_below_critical(self):
        """Test warning notification below critical threshold."""
        router = NotificationRouter()
        assert router.should_notify("warning", "critical") is False

    def test_should_notify_critical_meets_critical(self):
        """Test critical notification meets critical threshold."""
        router = NotificationRouter()
        assert router.should_notify("critical", "critical") is True

    def test_should_notify_unknown_priority(self):
        """Test that unknown priorities default to lowest level."""
        router = NotificationRouter()
        # Unknown priority defaults to 0, so should meet info threshold
        assert router.should_notify("unknown", "info") is True


class GuessChannelTypeTests(TestCase):
    """Tests for channel type guessing from URL."""

    def test_guess_discord_url(self):
        """Test guessing Discord from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("discord://webhook/token") == "discord"
        assert router._guess_channel_type("https://discord.com/api/webhooks/xxx") == "discord"

    def test_guess_slack_url(self):
        """Test guessing Slack from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("slack://token") == "slack"
        assert router._guess_channel_type("https://hooks.slack.com/xxx") == "slack"

    def test_guess_pushover_url(self):
        """Test guessing Pushover from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("pushover://user@token") == "pushover"

    def test_guess_telegram_url(self):
        """Test guessing Telegram from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("tgram://token/chat_id") == "telegram"
        assert router._guess_channel_type("telegram://token/chat_id") == "telegram"

    def test_guess_email_url(self):
        """Test guessing email from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("mailto://user@example.com") == "email"
        assert router._guess_channel_type("user@example.com") == "email"

    def test_guess_ntfy_url(self):
        """Test guessing ntfy from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("ntfy://topic") == "ntfy"

    def test_guess_gotify_url(self):
        """Test guessing Gotify from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("gotify://host/token") == "gotify"

    def test_guess_home_assistant_url(self):
        """Test guessing Home Assistant from URL."""
        router = NotificationRouter()
        assert router._guess_channel_type("hassio://host/token") == "home_assistant"
        assert router._guess_channel_type("home-assistant://host/token") == "home_assistant"

    def test_guess_webhook_fallback(self):
        """Test fallback to webhook for unknown URLs."""
        router = NotificationRouter()
        assert router._guess_channel_type("https://example.com/webhook") == "webhook"
        assert router._guess_channel_type("http://api.service.com/notify") == "webhook"


class GetChannelsForNotificationTests(TestCase):
    """Tests for get_channels_for_notification method."""

    def setUp(self):
        """Set up test fixtures."""
        self.router = NotificationRouter()

    @patch("skyspy.models.notifications.NotificationChannel.objects")
    @patch("skyspy.models.notifications.UserNotificationPreference.objects")
    def test_rule_webhook_url_takes_priority(self, mock_prefs, mock_channels):
        """Test that rule webhook URL is always included first."""
        mock_channels.filter.return_value.select_related.return_value = []

        channels = self.router.get_channels_for_notification(
            priority="warning",
            event_type="alert",
            rule_webhook_url="https://custom.webhook.com",
            include_global=False,
        )

        assert len(channels) == 1
        assert channels[0].channel_name == "Rule Webhook"
        assert channels[0].apprise_url == "https://custom.webhook.com"
        assert channels[0].channel_type == "webhook"

    @patch("skyspy.models.notifications.NotificationChannel.objects")
    @patch("skyspy.models.notifications.UserNotificationPreference.objects")
    def test_global_channels_included_by_default(self, mock_prefs, mock_channels):
        """Test that global channels are included when include_global=True."""
        mock_global_channel = MagicMock()
        mock_global_channel.id = 1
        mock_global_channel.name = "Global Discord"
        mock_global_channel.channel_type = "discord"
        mock_global_channel.apprise_url = "discord://webhook"
        mock_global_channel.supports_rich = True

        mock_channels.filter.return_value = [mock_global_channel]

        channels = self.router.get_channels_for_notification(
            priority="info",
            event_type="alert",
            include_global=True,
        )

        assert len(channels) == 1
        assert channels[0].channel_name == "Global Discord"

    @patch("skyspy.models.notifications.NotificationChannel.objects")
    def test_no_duplicate_urls(self, mock_channels):
        """Test that duplicate URLs are not included."""
        # Create two channels with the same URL
        mock_channel1 = MagicMock()
        mock_channel1.id = 1
        mock_channel1.name = "Channel 1"
        mock_channel1.channel_type = "webhook"
        mock_channel1.apprise_url = "https://example.com/webhook"
        mock_channel1.supports_rich = False

        mock_channel2 = MagicMock()
        mock_channel2.id = 2
        mock_channel2.name = "Channel 2"
        mock_channel2.channel_type = "webhook"
        mock_channel2.apprise_url = "https://example.com/webhook"  # Same URL
        mock_channel2.supports_rich = False

        mock_channels.filter.return_value = [mock_channel1, mock_channel2]

        channels = self.router.get_channels_for_notification(
            priority="info",
            event_type="alert",
            include_global=True,
        )

        # Should only have one channel since URLs are deduplicated
        assert len(channels) == 1


@pytest.mark.django_db
class GetChannelsForNotificationWithUserTests:
    """Tests for channel routing with user preferences (requires DB)."""

    @pytest.fixture
    def test_user(self, db):
        """Create a test user."""
        return User.objects.create_user(
            username="testuser",
            password="testpass",
        )

    @pytest.fixture
    def discord_channel(self, db):
        """Create a Discord notification channel."""
        from skyspy.models.notifications import NotificationChannel

        return NotificationChannel.objects.create(
            name="Discord Channel",
            channel_type="discord",
            apprise_url="discord://webhook/token",
            supports_rich=True,
            is_global=False,
            enabled=True,
        )

    @pytest.fixture
    def user_preference(self, db, test_user, discord_channel):
        """Create user notification preference."""
        from skyspy.models.notifications import UserNotificationPreference

        return UserNotificationPreference.objects.create(
            user=test_user,
            channel=discord_channel,
            min_priority="info",
            enabled=True,
        )

    def test_user_preferences_included(self, test_user, user_preference):
        """Test that user preferences are included when user provided."""
        router = NotificationRouter()

        channels = router.get_channels_for_notification(
            priority="warning",
            event_type="alert",
            user=test_user,
            include_global=False,
        )

        assert len(channels) == 1
        assert channels[0].user_id == test_user.id

    def test_user_preferences_filtered_by_priority(self, test_user, discord_channel, db):
        """Test that user preferences respect min_priority."""
        from skyspy.models.notifications import UserNotificationPreference

        # Create preference that only wants critical
        UserNotificationPreference.objects.create(
            user=test_user,
            channel=discord_channel,
            min_priority="critical",
            enabled=True,
        )

        router = NotificationRouter()

        # Warning should not match critical min_priority
        channels = router.get_channels_for_notification(
            priority="warning",
            event_type="alert",
            user=test_user,
            include_global=False,
        )

        assert len(channels) == 0


class GetChannelsForPriorityTests(TestCase):
    """Tests for get_channels_for_priority method."""

    @patch("skyspy.models.notifications.NotificationChannel.objects")
    def test_returns_global_channels(self, mock_channels):
        """Test that global enabled channels are returned."""
        mock_channel = MagicMock()
        mock_channel.id = 1
        mock_channel.name = "Global Slack"
        mock_channel.channel_type = "slack"
        mock_channel.apprise_url = "slack://token"
        mock_channel.supports_rich = True

        mock_channels.filter.return_value = [mock_channel]

        router = NotificationRouter()
        channels = router.get_channels_for_priority(
            priority="warning",
            event_type="safety",
        )

        mock_channels.filter.assert_called_once_with(is_global=True, enabled=True)
        assert len(channels) == 1
        assert channels[0].channel_name == "Global Slack"


class GetChannelsForUsersTests(TestCase):
    """Tests for get_channels_for_users method."""

    @patch("skyspy.models.notifications.UserNotificationPreference.objects")
    def test_returns_channels_by_user(self, mock_prefs):
        """Test that channels are grouped by user ID."""
        mock_pref1 = MagicMock()
        mock_pref1.user_id = 1
        mock_pref1.should_receive.return_value = True
        mock_pref1.channel.id = 1
        mock_pref1.channel.name = "User 1 Discord"
        mock_pref1.channel.channel_type = "discord"
        mock_pref1.channel.apprise_url = "discord://user1"
        mock_pref1.channel.supports_rich = True
        mock_pref1.id = 10

        mock_pref2 = MagicMock()
        mock_pref2.user_id = 2
        mock_pref2.should_receive.return_value = True
        mock_pref2.channel.id = 2
        mock_pref2.channel.name = "User 2 Slack"
        mock_pref2.channel.channel_type = "slack"
        mock_pref2.channel.apprise_url = "slack://user2"
        mock_pref2.channel.supports_rich = True
        mock_pref2.id = 20

        mock_prefs.filter.return_value.select_related.return_value = [mock_pref1, mock_pref2]

        router = NotificationRouter()
        result = router.get_channels_for_users(
            user_ids=[1, 2, 3],
            priority="warning",
            event_type="alert",
        )

        assert len(result) == 3  # All user IDs in result
        assert len(result[1]) == 1  # User 1 has one channel
        assert len(result[2]) == 1  # User 2 has one channel
        assert len(result[3]) == 0  # User 3 has no channels

    @patch("skyspy.models.notifications.UserNotificationPreference.objects")
    def test_filters_by_should_receive(self, mock_prefs):
        """Test that preferences are filtered by should_receive."""
        mock_pref = MagicMock()
        mock_pref.user_id = 1
        mock_pref.should_receive.return_value = False  # Should not receive

        mock_prefs.filter.return_value.select_related.return_value = [mock_pref]

        router = NotificationRouter()
        result = router.get_channels_for_users(
            user_ids=[1],
            priority="info",
            event_type="alert",
        )

        assert len(result[1]) == 0  # No channels because should_receive is False


class GetSubscribersForRuleTests(TestCase):
    """Tests for get_subscribers_for_rule method."""

    @patch("skyspy.models.alerts.AlertSubscription.objects")
    def test_returns_subscriber_channels(self, mock_subscriptions):
        """Test that subscriber channels are returned."""
        router = NotificationRouter()

        mock_sub = MagicMock()
        mock_sub.user_id = 1

        mock_subscriptions.filter.return_value.select_related.return_value = [mock_sub]

        with patch.object(router, "get_channels_for_users") as mock_get_channels:
            mock_get_channels.return_value = {
                1: [
                    RoutedNotification(
                        channel_id=1,
                        channel_name="Subscriber Channel",
                        channel_type="discord",
                        apprise_url="discord://webhook",
                        supports_rich=True,
                        user_id=1,
                    )
                ]
            }

            channels = router.get_subscribers_for_rule(
                rule_id=1,
                priority="warning",
            )

        assert len(channels) == 1
        assert channels[0].channel_name == "Subscriber Channel"

    @patch("skyspy.models.alerts.AlertSubscription.objects")
    def test_handles_missing_model(self, mock_subscriptions):
        """Test graceful handling when AlertSubscription doesn't exist."""
        mock_subscriptions.filter.side_effect = Exception("Model not found")

        router = NotificationRouter()
        channels = router.get_subscribers_for_rule(
            rule_id=1,
            priority="warning",
        )

        assert channels == []

    @patch("skyspy.models.alerts.AlertSubscription.objects")
    def test_deduplicates_urls(self, mock_subscriptions):
        """Test that duplicate URLs from different users are deduplicated."""
        router = NotificationRouter()

        mock_sub1 = MagicMock()
        mock_sub1.user_id = 1
        mock_sub2 = MagicMock()
        mock_sub2.user_id = 2

        mock_subscriptions.filter.return_value.select_related.return_value = [mock_sub1, mock_sub2]

        with patch.object(router, "get_channels_for_users") as mock_get_channels:
            # Both users have same URL
            mock_get_channels.return_value = {
                1: [
                    RoutedNotification(
                        channel_id=1,
                        channel_name="Shared Channel",
                        channel_type="slack",
                        apprise_url="slack://shared",
                        supports_rich=True,
                    )
                ],
                2: [
                    RoutedNotification(
                        channel_id=2,
                        channel_name="Shared Channel 2",
                        channel_type="slack",
                        apprise_url="slack://shared",  # Same URL
                        supports_rich=True,
                    )
                ],
            }

            channels = router.get_subscribers_for_rule(
                rule_id=1,
                priority="info",
            )

        # Should only have one channel due to URL deduplication
        assert len(channels) == 1


class GetFallbackChannelsTests(TestCase):
    """Tests for get_fallback_channels method."""

    @patch("skyspy.models.notifications.NotificationConfig.get_config")
    def test_returns_legacy_channels(self, mock_get_config):
        """Test that legacy channels from NotificationConfig are returned."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.apprise_urls = "discord://webhook1;slack://webhook2"
        mock_get_config.return_value = mock_config

        router = NotificationRouter()
        channels = router.get_fallback_channels()

        assert len(channels) == 2
        assert channels[0].channel_type == "discord"
        assert channels[0].apprise_url == "discord://webhook1"
        assert channels[0].supports_rich is True
        assert channels[1].channel_type == "slack"
        assert channels[1].apprise_url == "slack://webhook2"

    @patch("skyspy.models.notifications.NotificationConfig.get_config")
    def test_disabled_config_returns_empty(self, mock_get_config):
        """Test that disabled config returns no channels."""
        mock_config = MagicMock()
        mock_config.enabled = False
        mock_config.apprise_urls = "discord://webhook"
        mock_get_config.return_value = mock_config

        router = NotificationRouter()
        channels = router.get_fallback_channels()

        assert channels == []

    @patch("skyspy.models.notifications.NotificationConfig.get_config")
    def test_empty_urls_returns_empty(self, mock_get_config):
        """Test that empty URLs returns no channels."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.apprise_urls = ""
        mock_get_config.return_value = mock_config

        router = NotificationRouter()
        channels = router.get_fallback_channels()

        assert channels == []

    @patch("skyspy.models.notifications.NotificationConfig.get_config")
    def test_handles_config_error(self, mock_get_config):
        """Test graceful handling of config errors."""
        mock_get_config.side_effect = Exception("Database error")

        router = NotificationRouter()
        channels = router.get_fallback_channels()

        assert channels == []

    @patch("skyspy.models.notifications.NotificationConfig.get_config")
    def test_strips_whitespace_from_urls(self, mock_get_config):
        """Test that whitespace is stripped from URLs."""
        mock_config = MagicMock()
        mock_config.enabled = True
        mock_config.apprise_urls = "  discord://webhook  ;  slack://token  "
        mock_get_config.return_value = mock_config

        router = NotificationRouter()
        channels = router.get_fallback_channels()

        assert len(channels) == 2
        assert channels[0].apprise_url == "discord://webhook"
        assert channels[1].apprise_url == "slack://token"


class GlobalSingletonTests(TestCase):
    """Tests for the global notification_router singleton."""

    def test_singleton_exists(self):
        """Test that global singleton is available."""
        assert notification_router is not None
        assert isinstance(notification_router, NotificationRouter)


@pytest.mark.django_db
class UserNotificationPreferenceIntegrationTests:
    """Integration tests for UserNotificationPreference filtering."""

    @pytest.fixture
    def test_user(self, db):
        """Create test user."""
        return User.objects.create_user(username="testuser", password="testpass")

    @pytest.fixture
    def notification_channel(self, db):
        """Create notification channel."""
        from skyspy.models.notifications import NotificationChannel

        return NotificationChannel.objects.create(
            name="Test Channel",
            channel_type="discord",
            apprise_url="discord://test",
            supports_rich=True,
            enabled=True,
            is_global=False,
        )

    def test_preference_should_receive_checks_priority(self, test_user, notification_channel, db):
        """Test that should_receive checks priority threshold."""
        from skyspy.models.notifications import UserNotificationPreference

        pref = UserNotificationPreference.objects.create(
            user=test_user,
            channel=notification_channel,
            min_priority="warning",
            enabled=True,
        )

        assert pref.should_receive("info", "alert") is False
        assert pref.should_receive("warning", "alert") is True
        assert pref.should_receive("critical", "alert") is True

    def test_preference_should_receive_checks_event_type(self, test_user, notification_channel, db):
        """Test that should_receive checks event type filter."""
        from skyspy.models.notifications import UserNotificationPreference

        pref = UserNotificationPreference.objects.create(
            user=test_user,
            channel=notification_channel,
            min_priority="info",
            event_types=["alert", "military"],  # Only these types
            enabled=True,
        )

        assert pref.should_receive("info", "alert") is True
        assert pref.should_receive("info", "military") is True
        assert pref.should_receive("info", "safety") is False

    def test_preference_should_receive_empty_event_types(self, test_user, notification_channel, db):
        """Test that empty event_types allows all types."""
        from skyspy.models.notifications import UserNotificationPreference

        pref = UserNotificationPreference.objects.create(
            user=test_user,
            channel=notification_channel,
            min_priority="info",
            event_types=[],  # Empty = all types
            enabled=True,
        )

        assert pref.should_receive("info", "alert") is True
        assert pref.should_receive("info", "safety") is True
        assert pref.should_receive("info", "unknown_type") is True

    def test_preference_disabled_returns_false(self, test_user, notification_channel, db):
        """Test that disabled preference returns False."""
        from skyspy.models.notifications import UserNotificationPreference

        pref = UserNotificationPreference.objects.create(
            user=test_user,
            channel=notification_channel,
            min_priority="info",
            enabled=False,  # Disabled
        )

        assert pref.should_receive("critical", "alert") is False

    @patch("skyspy.models.notifications.UserNotificationPreference.is_in_quiet_hours")
    def test_preference_quiet_hours_blocks_notification(self, mock_quiet, test_user, notification_channel, db):
        """Test that quiet hours block notifications."""
        from skyspy.models.notifications import UserNotificationPreference

        mock_quiet.return_value = True

        pref = UserNotificationPreference.objects.create(
            user=test_user,
            channel=notification_channel,
            min_priority="info",
            quiet_hours_start=time(22, 0),
            quiet_hours_end=time(8, 0),
            critical_overrides_quiet=False,
            enabled=True,
        )

        assert pref.should_receive("warning", "alert") is False

    @patch("skyspy.models.notifications.UserNotificationPreference.is_in_quiet_hours")
    def test_preference_critical_overrides_quiet_hours(self, mock_quiet, test_user, notification_channel, db):
        """Test that critical notifications can override quiet hours."""
        from skyspy.models.notifications import UserNotificationPreference

        mock_quiet.return_value = True

        pref = UserNotificationPreference.objects.create(
            user=test_user,
            channel=notification_channel,
            min_priority="info",
            quiet_hours_start=time(22, 0),
            quiet_hours_end=time(8, 0),
            critical_overrides_quiet=True,  # Critical overrides
            enabled=True,
        )

        assert pref.should_receive("warning", "alert") is False
        assert pref.should_receive("critical", "alert") is True
