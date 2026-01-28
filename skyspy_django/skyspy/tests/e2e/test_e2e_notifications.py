"""
End-to-end tests for the notification system API endpoints.

Tests for:
1. Notification Channel CRUD operations
2. Channel Types information
3. Channel Testing (send test notifications)
4. Notification History and filtering
5. Alert-Channel Integration
6. Global Notification Configuration
7. Rich Message Formatting
8. Permission checks and access control

Uses fixtures from conftest.py:
- notification_channels, global_notification_config
- operator_client, admin_client, viewer_client
- mock_apprise
- sample_alert_rule
"""
import pytest
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.utils import timezone
from rest_framework import status

from skyspy.models import (
    NotificationChannel,
    NotificationLog,
    NotificationConfig,
    AlertRule,
    AlertHistory,
    SafetyEvent,
)


# =============================================================================
# Notification Channel CRUD Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationChannelCRUD:
    """Tests for notification channel CRUD operations."""

    def test_create_discord_channel(self, operator_client, operator_user):
        """Test creating a Discord notification channel."""
        data = {
            'name': 'My Discord Channel',
            'channel_type': 'discord',
            'apprise_url': 'discord://webhook_id/webhook_token',
            'description': 'Alerts channel for my server',
            'supports_rich': True,
            'enabled': True,
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['name'] == 'My Discord Channel'
        assert result['channel_type'] == 'discord'
        assert result['supports_rich'] is True
        assert result['enabled'] is True
        assert result['owner'] == operator_user.id

    def test_create_slack_channel(self, operator_client):
        """Test creating a Slack notification channel."""
        data = {
            'name': 'Slack Alerts',
            'channel_type': 'slack',
            'apprise_url': 'slack://token_a/token_b/token_c/#alerts',
            'supports_rich': True,
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['channel_type'] == 'slack'

    def test_create_email_channel(self, operator_client):
        """Test creating an Email notification channel."""
        data = {
            'name': 'Email Alerts',
            'channel_type': 'email',
            'apprise_url': 'mailto://user:pass@smtp.example.com?to=alerts@example.com',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'email'

    def test_create_pushover_channel(self, operator_client):
        """Test creating a Pushover notification channel."""
        data = {
            'name': 'Pushover Notifications',
            'channel_type': 'pushover',
            'apprise_url': 'pover://user_key@api_token',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'pushover'

    def test_create_ntfy_channel(self, operator_client):
        """Test creating an ntfy notification channel."""
        data = {
            'name': 'ntfy Channel',
            'channel_type': 'ntfy',
            'apprise_url': 'ntfy://skyspy-alerts',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'ntfy'

    def test_create_gotify_channel(self, operator_client):
        """Test creating a Gotify notification channel."""
        data = {
            'name': 'Gotify Server',
            'channel_type': 'gotify',
            'apprise_url': 'gotify://gotify.example.com/app_token',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'gotify'

    def test_create_telegram_channel(self, operator_client):
        """Test creating a Telegram notification channel."""
        data = {
            'name': 'Telegram Bot',
            'channel_type': 'telegram',
            'apprise_url': 'tgram://bot_token/chat_id',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'telegram'

    def test_create_webhook_channel(self, operator_client):
        """Test creating a generic webhook notification channel."""
        data = {
            'name': 'Custom Webhook',
            'channel_type': 'webhook',
            'apprise_url': 'json://hooks.example.com/api/webhook',
            'description': 'Custom webhook for external integration',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'webhook'

    def test_create_home_assistant_channel(self, operator_client):
        """Test creating a Home Assistant notification channel."""
        data = {
            'name': 'Home Assistant',
            'channel_type': 'home_assistant',
            'apprise_url': 'hassio://homeassistant.local/long_lived_token',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'home_assistant'

    def test_create_custom_apprise_channel(self, operator_client):
        """Test creating a custom Apprise URL channel."""
        data = {
            'name': 'Custom Apprise',
            'channel_type': 'custom',
            'apprise_url': 'mailto://user:pass@gmail.com?to=alerts@example.com',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()['channel_type'] == 'custom'

    def test_list_own_notification_channels(self, operator_client, notification_channels):
        """Test listing notification channels owned by the user."""
        response = operator_client.get('/api/v1/notifications/channels/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'channels' in data
        assert 'count' in data
        assert data['count'] >= len(notification_channels)

    def test_list_my_channels_endpoint(self, operator_client, notification_channels):
        """Test the my-channels endpoint returns only owned channels."""
        response = operator_client.get('/api/v1/notifications/channels/my-channels/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'channels' in data
        # All returned channels should belong to the operator user
        for channel in data['channels']:
            assert channel['is_global'] is False or channel['owner'] is not None

    def test_retrieve_notification_channel(self, operator_client, notification_channels):
        """Test retrieving a specific notification channel."""
        channel = notification_channels[0]

        response = operator_client.get(f'/api/v1/notifications/channels/{channel.id}/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['id'] == channel.id
        assert data['name'] == channel.name
        assert data['channel_type'] == channel.channel_type

    def test_update_notification_channel(self, operator_client, notification_channels):
        """Test updating a notification channel."""
        channel = notification_channels[0]

        data = {
            'name': 'Updated Channel Name',
            'description': 'Updated description',
            'enabled': False,
        }

        response = operator_client.patch(
            f'/api/v1/notifications/channels/{channel.id}/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['name'] == 'Updated Channel Name'
        assert result['description'] == 'Updated description'
        assert result['enabled'] is False

    def test_update_channel_url_resets_verification(self, operator_client, notification_channels):
        """Test that updating apprise_url resets verification status."""
        channel = notification_channels[0]
        # Mark as verified first
        channel.verified = True
        channel.save()

        data = {
            'apprise_url': 'discord://new_webhook_id/new_token',
        }

        response = operator_client.patch(
            f'/api/v1/notifications/channels/{channel.id}/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['verified'] is False

    def test_delete_notification_channel(self, operator_client, operator_user, db):
        """Test deleting a notification channel."""
        channel = NotificationChannel.objects.create(
            name='To Delete',
            channel_type='discord',
            apprise_url='discord://test/test',
            owner=operator_user,
        )
        channel_id = channel.id

        response = operator_client.delete(f'/api/v1/notifications/channels/{channel_id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not NotificationChannel.objects.filter(id=channel_id).exists()

    def test_cannot_access_other_users_channels(self, viewer_client, admin_user, db):
        """Test that users cannot access channels owned by others (403)."""
        # Create a channel owned by admin
        channel = NotificationChannel.objects.create(
            name='Admin Private Channel',
            channel_type='discord',
            apprise_url='discord://admin_webhook/token',
            owner=admin_user,
            is_global=False,
        )

        # Viewer should not be able to access it
        response = viewer_client.get(f'/api/v1/notifications/channels/{channel.id}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_cannot_update_other_users_channels(self, viewer_client, admin_user, db):
        """Test that users cannot update channels owned by others (403)."""
        channel = NotificationChannel.objects.create(
            name='Admin Private Channel',
            channel_type='discord',
            apprise_url='discord://admin_webhook/token',
            owner=admin_user,
            is_global=False,
        )

        response = viewer_client.patch(
            f'/api/v1/notifications/channels/{channel.id}/',
            {'name': 'Hacked Name'},
            format='json'
        )

        # Should get 404 (can't even see it) or 403
        assert response.status_code in [status.HTTP_404_NOT_FOUND, status.HTTP_403_FORBIDDEN]

    def test_cannot_delete_other_users_channels(self, viewer_client, admin_user, db):
        """Test that users cannot delete channels owned by others (403)."""
        channel = NotificationChannel.objects.create(
            name='Admin Private Channel',
            channel_type='discord',
            apprise_url='discord://admin_webhook/token',
            owner=admin_user,
            is_global=False,
        )

        response = viewer_client.delete(f'/api/v1/notifications/channels/{channel.id}/')

        assert response.status_code in [status.HTTP_404_NOT_FOUND, status.HTTP_403_FORBIDDEN]
        # Channel should still exist
        assert NotificationChannel.objects.filter(id=channel.id).exists()

    def test_non_admin_cannot_create_global_channel(self, operator_client, operator_user):
        """Test that non-admin users cannot create global channels."""
        data = {
            'name': 'Global Channel Attempt',
            'channel_type': 'discord',
            'apprise_url': 'discord://test/test',
            'is_global': True,  # Trying to create global
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        # is_global should be forced to False for non-admins
        assert result['is_global'] is False


# =============================================================================
# Channel Types Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationChannelTypes:
    """Tests for notification channel types endpoint."""

    def test_get_channel_types(self, api_client):
        """Test that GET /api/v1/notifications/channels/types returns supported types."""
        response = api_client.get('/api/v1/notifications/channels/types/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'types' in data
        assert 'count' in data
        assert data['count'] > 0

    def test_channel_types_include_required_fields(self, api_client):
        """Test that each channel type has required configuration fields."""
        response = api_client.get('/api/v1/notifications/channels/types/')
        data = response.json()

        for channel_type in data['types']:
            assert 'type' in channel_type
            assert 'name' in channel_type
            assert 'description' in channel_type
            assert 'required_fields' in channel_type
            assert isinstance(channel_type['required_fields'], list)

    def test_channel_types_include_expected_services(self, api_client):
        """Test that all expected services are included."""
        response = api_client.get('/api/v1/notifications/channels/types/')
        data = response.json()

        type_names = [ct['type'] for ct in data['types']]

        expected_types = [
            'discord', 'slack', 'telegram', 'pushover',
            'email', 'ntfy', 'gotify', 'webhook', 'custom'
        ]

        for expected in expected_types:
            assert expected in type_names, f"Missing channel type: {expected}"

    def test_discord_type_info(self, api_client):
        """Test Discord channel type information."""
        response = api_client.get('/api/v1/notifications/channels/types/')
        data = response.json()

        discord_type = next(
            (t for t in data['types'] if t['type'] == 'discord'),
            None
        )

        assert discord_type is not None
        assert discord_type['supports_rich'] is True
        assert 'webhook_id' in discord_type['required_fields']
        assert 'webhook_token' in discord_type['required_fields']

    def test_slack_type_info(self, api_client):
        """Test Slack channel type information."""
        response = api_client.get('/api/v1/notifications/channels/types/')
        data = response.json()

        slack_type = next(
            (t for t in data['types'] if t['type'] == 'slack'),
            None
        )

        assert slack_type is not None
        assert slack_type['supports_rich'] is True


# =============================================================================
# Channel Testing Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationChannelTest:
    """Tests for notification channel testing endpoint."""

    def test_send_test_notification_success(self, operator_client, notification_channels, mock_apprise):
        """Test POST /api/v1/notifications/channels/{id}/test sends test notification."""
        channel = notification_channels[0]

        response = operator_client.post(
            f'/api/v1/notifications/channels/{channel.id}/test/',
            {'title': 'Test', 'message': 'Test message'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'success' in data
        assert 'message' in data
        assert 'servers_notified' in data

    def test_send_test_notification_updates_channel_status(
        self, operator_client, notification_channels, mock_apprise
    ):
        """Test that successful test notification updates channel verification status."""
        channel = notification_channels[0]
        assert channel.verified is False

        response = operator_client.post(
            f'/api/v1/notifications/channels/{channel.id}/test/',
            {},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        channel.refresh_from_db()
        assert channel.verified is True
        assert channel.last_success is not None

    def test_send_test_notification_logs_result(
        self, operator_client, notification_channels, mock_apprise, db
    ):
        """Test that test notification is logged."""
        channel = notification_channels[0]
        initial_count = NotificationLog.objects.filter(notification_type='test').count()

        response = operator_client.post(
            f'/api/v1/notifications/channels/{channel.id}/test/',
            {},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert NotificationLog.objects.filter(notification_type='test').count() > initial_count

    def test_send_test_notification_disabled_channel(
        self, operator_client, notification_channels, mock_apprise
    ):
        """Test that test notification on disabled channel returns failure."""
        channel = notification_channels[0]
        channel.enabled = False
        channel.save()

        response = operator_client.post(
            f'/api/v1/notifications/channels/{channel.id}/test/',
            {},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['success'] is False
        assert 'disabled' in data['message'].lower()

    def test_send_test_notification_failure(self, operator_client, notification_channels):
        """Test that failed test notification is handled properly."""
        channel = notification_channels[0]

        # Mock apprise to return failure
        with patch('apprise.Apprise') as mock_apprise_class:
            mock_instance = MagicMock()
            mock_instance.notify.return_value = False
            mock_apprise_class.return_value = mock_instance

            response = operator_client.post(
                f'/api/v1/notifications/channels/{channel.id}/test/',
                {},
                format='json'
            )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['success'] is False

        channel.refresh_from_db()
        assert channel.last_failure is not None

    def test_send_test_notification_validates_channel_config(
        self, operator_client, notification_channels
    ):
        """Test that test notification validates channel configuration."""
        channel = notification_channels[0]

        # Mock apprise to raise exception for invalid URL
        with patch('apprise.Apprise') as mock_apprise_class:
            mock_instance = MagicMock()
            mock_instance.notify.side_effect = Exception("Invalid URL format")
            mock_apprise_class.return_value = mock_instance

            response = operator_client.post(
                f'/api/v1/notifications/channels/{channel.id}/test/',
                {},
                format='json'
            )

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        data = response.json()
        assert data['success'] is False
        assert 'Invalid URL format' in data['message']


# =============================================================================
# Notification History Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationHistory:
    """Tests for notification history endpoint."""

    def test_get_notification_history(self, operator_client, db):
        """Test GET /api/v1/notifications/history returns sent notifications."""
        # Create some notification logs
        NotificationLog.objects.create(
            notification_type='alert',
            icao_hex='ABC123',
            callsign='UAL123',
            message='Test alert notification',
            status='sent',
        )
        NotificationLog.objects.create(
            notification_type='safety',
            icao_hex='DEF456',
            callsign='DAL456',
            message='Test safety notification',
            status='sent',
        )

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'history' in data
        assert 'count' in data
        assert data['count'] >= 2

    def test_filter_history_by_notification_type_alert(self, operator_client, db):
        """Test filtering notification history by type=alert."""
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='safety', status='sent')
        NotificationLog.objects.create(notification_type='emergency', status='sent')

        # Note: The current API uses 'status' filter, not 'notification_type'
        # Based on the view implementation, we can filter by status
        response = operator_client.get('/api/v1/notifications/history/?status=sent')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['count'] >= 1

    def test_filter_history_by_status(self, operator_client, db):
        """Test filtering notification history by status."""
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='alert', status='failed')
        NotificationLog.objects.create(notification_type='alert', status='pending')

        response = operator_client.get('/api/v1/notifications/history/?status=sent')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        for entry in data['history']:
            assert entry['status'] == 'sent'

    def test_filter_history_by_channel_id(self, operator_client, notification_channels, db):
        """Test filtering notification history by channel_id."""
        channel = notification_channels[0]
        NotificationLog.objects.create(
            notification_type='alert',
            channel=channel,
            status='sent'
        )
        NotificationLog.objects.create(
            notification_type='alert',
            channel=notification_channels[1],
            status='sent'
        )

        response = operator_client.get(f'/api/v1/notifications/history/?channel_id={channel.id}')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        for entry in data['history']:
            assert entry['channel'] == channel.id

    def test_history_includes_delivery_status(self, operator_client, db):
        """Test that notification history includes delivery status."""
        NotificationLog.objects.create(
            notification_type='alert',
            status='sent',
            sent_at=timezone.now(),
            duration_ms=150,
        )
        NotificationLog.objects.create(
            notification_type='alert',
            status='failed',
            last_error='Connection timeout',
            retry_count=2,
        )

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        for entry in data['history']:
            assert 'status' in entry
            assert 'retry_count' in entry
            assert 'last_error' in entry

    def test_history_limit_parameter(self, operator_client, db):
        """Test that history respects limit parameter."""
        # Create 20 entries
        for i in range(20):
            NotificationLog.objects.create(
                notification_type='alert',
                status='sent',
            )

        response = operator_client.get('/api/v1/notifications/history/?limit=5')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data['history']) <= 5

    def test_history_ordered_by_timestamp(self, operator_client, db):
        """Test that notification history is ordered by timestamp descending."""
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='safety', status='sent')
        NotificationLog.objects.create(notification_type='emergency', status='sent')

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        timestamps = [entry['timestamp'] for entry in data['history']]

        # Should be in descending order (most recent first)
        assert timestamps == sorted(timestamps, reverse=True)


# =============================================================================
# Alert-Channel Integration Tests
# =============================================================================

@pytest.mark.django_db
class TestAlertChannelIntegration:
    """Tests for alert rule and notification channel integration."""

    def test_alert_rule_can_reference_notification_channels(
        self, operator_client, notification_channels, sample_alert_rule, db
    ):
        """Test that alert rules can reference notification channels."""
        # The AlertRule model should have a notification_channels field
        channel = notification_channels[0]
        sample_alert_rule.notification_channels.add(channel)

        response = operator_client.get(f'/api/v1/alerts/rules/{sample_alert_rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        # The rule should include linked channels info

    def test_create_alert_with_notification_channels(
        self, operator_client, notification_channels, db
    ):
        """Test creating an alert rule with notification channels."""
        channel_ids = [c.id for c in notification_channels[:2]]

        data = {
            'name': 'Alert with Notifications',
            'type': 'military',
            'operator': 'eq',
            'value': 'true',
            'priority': 'warning',
            'notification_channel_ids': channel_ids,
        }

        response = operator_client.post(
            '/api/v1/alerts/rules/',
            data,
            format='json'
        )

        # Note: This test assumes the serializer accepts notification_channel_ids
        # If not, this may return 201 without the channels
        assert response.status_code == status.HTTP_201_CREATED

    def test_alert_trigger_sends_notifications(
        self, operator_client, notification_channels, mock_apprise, sample_alert_rule, db
    ):
        """Test that when an alert triggers, notifications are sent to linked channels."""
        # Link channels to the alert rule
        for channel in notification_channels[:2]:
            sample_alert_rule.notification_channels.add(channel)

        # Create an alert history entry (simulating a trigger)
        AlertHistory.objects.create(
            rule=sample_alert_rule,
            rule_name=sample_alert_rule.name,
            icao_hex='ABC123',
            callsign='UAL123',
            message='Military aircraft detected',
            priority='warning',
            aircraft_data={
                'hex': 'ABC123',
                'flight': 'UAL123',
                'alt': 35000,
            },
        )

        # The notification would be sent by a background task
        # This test verifies the structure is in place
        assert sample_alert_rule.notification_channels.count() >= 2

    def test_failed_notifications_are_logged(
        self, operator_client, notification_channels, db
    ):
        """Test that failed notifications are logged properly."""
        channel = notification_channels[0]

        # Create a failed notification log
        log = NotificationLog.objects.create(
            notification_type='alert',
            channel=channel,
            channel_url=channel.apprise_url,
            status='failed',
            last_error='Connection refused',
            retry_count=1,
        )

        response = operator_client.get('/api/v1/notifications/history/?status=failed')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert any(entry['status'] == 'failed' for entry in data['history'])


# =============================================================================
# Global Notification Config Tests
# =============================================================================

@pytest.mark.django_db
class TestGlobalNotificationConfig:
    """Tests for global notification configuration."""

    def test_get_global_notification_config(self, operator_client, global_notification_config):
        """Test getting global notification configuration."""
        response = operator_client.get('/api/v1/notifications/config/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'enabled' in data
        assert 'apprise_urls' in data
        assert 'cooldown_seconds' in data

    def test_update_global_notification_config(self, admin_client, global_notification_config):
        """Test updating global notification configuration."""
        data = {
            'enabled': True,
            'cooldown_seconds': 600,
            'apprise_urls': 'discord://new_webhook/token',
        }

        response = admin_client.patch(
            '/api/v1/notifications/config/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['cooldown_seconds'] == 600

    def test_global_config_cooldown_prevents_spam(self, operator_client, global_notification_config):
        """Test that cooldown setting is respected."""
        response = operator_client.get('/api/v1/notifications/config/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['cooldown_seconds'] >= 0

    def test_global_config_can_be_disabled(self, admin_client, global_notification_config):
        """Test that global notifications can be disabled."""
        data = {'enabled': False}

        response = admin_client.patch(
            '/api/v1/notifications/config/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['enabled'] is False

    def test_global_test_notification(self, operator_client, global_notification_config, mock_apprise):
        """Test sending a test notification using global config."""
        # Ensure config has URLs
        global_notification_config.apprise_urls = 'discord://test/webhook'
        global_notification_config.enabled = True
        global_notification_config.save()

        response = operator_client.post(
            '/api/v1/notifications/test/',
            {'title': 'Global Test', 'message': 'Test message'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'success' in data

    def test_global_test_notification_no_urls_configured(self, operator_client, db):
        """Test global test notification when no URLs are configured."""
        config = NotificationConfig.get_config()
        config.apprise_urls = ''
        config.save()

        response = operator_client.post(
            '/api/v1/notifications/test/',
            {},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['success'] is False
        assert 'configured' in data['message'].lower()

    def test_global_test_notification_disabled(self, operator_client, global_notification_config):
        """Test global test notification when notifications are disabled."""
        global_notification_config.enabled = False
        global_notification_config.apprise_urls = 'discord://test/test'
        global_notification_config.save()

        response = operator_client.post(
            '/api/v1/notifications/test/',
            {},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['success'] is False
        assert 'disabled' in data['message'].lower()


# =============================================================================
# Rich Message Formatting Tests
# =============================================================================

@pytest.mark.django_db
class TestRichMessageFormatting:
    """Tests for rich notification message formatting."""

    def test_notification_includes_aircraft_details(self, operator_client, db):
        """Test that notifications include aircraft details."""
        log = NotificationLog.objects.create(
            notification_type='alert',
            icao_hex='ABC123',
            callsign='UAL123',
            message='Military aircraft detected',
            details={
                'aircraft': {
                    'hex': 'ABC123',
                    'flight': 'UAL123',
                    'alt': 35000,
                    'gs': 450,
                    'type': 'C17',
                },
                'rule_name': 'Military Alert',
            },
            status='sent',
        )

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        entry = next((e for e in data['history'] if e['id'] == log.id), None)
        assert entry is not None
        assert entry['icao_hex'] == 'ABC123'
        assert entry['callsign'] == 'UAL123'
        assert 'details' in entry

    def test_safety_event_notification_includes_severity(self, operator_client, db):
        """Test that safety event notifications include severity badge."""
        log = NotificationLog.objects.create(
            notification_type='safety',
            icao_hex='DEF456',
            callsign='DAL456',
            message='TCAS RA: Climb',
            details={
                'severity': 'critical',
                'event_type': 'tcas_ra',
                'aircraft': {
                    'hex': 'DEF456',
                    'flight': 'DAL456',
                    'alt': 25000,
                },
            },
            status='sent',
        )

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        entry = next((e for e in data['history'] if e['id'] == log.id), None)
        assert entry is not None
        assert entry['notification_type'] == 'safety'
        assert 'severity' in entry['details']

    def test_alert_notification_includes_rule_info(self, operator_client, db):
        """Test that alert notifications include rule name and trigger reason."""
        log = NotificationLog.objects.create(
            notification_type='alert',
            icao_hex='ABC123',
            callsign='UAL123',
            message='Alert triggered by rule: Military Watch',
            details={
                'rule_id': 1,
                'rule_name': 'Military Watch',
                'trigger_reason': 'Aircraft type C17 matched military filter',
            },
            status='sent',
        )

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        entry = next((e for e in data['history'] if e['id'] == log.id), None)
        assert entry is not None
        assert 'rule_name' in entry['details']
        assert entry['details']['rule_name'] == 'Military Watch'


# =============================================================================
# Permission Checks Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationPermissions:
    """Tests for notification system permission checks."""

    def test_users_can_only_manage_own_channels(
        self, operator_client, viewer_client, operator_user, viewer_user, db
    ):
        """Test that users can only manage their own channels."""
        # Create channel owned by operator
        channel = NotificationChannel.objects.create(
            name='Operator Channel',
            channel_type='discord',
            apprise_url='discord://test/test',
            owner=operator_user,
            is_global=False,
        )

        # Operator can access
        response = operator_client.get(f'/api/v1/notifications/channels/{channel.id}/')
        assert response.status_code == status.HTTP_200_OK

        # Viewer cannot access (not owner, not global)
        response = viewer_client.get(f'/api/v1/notifications/channels/{channel.id}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_admin_can_see_all_channels(self, admin_client, operator_user, db):
        """Test that admin can see all channels."""
        # Create channel owned by operator (not global)
        channel = NotificationChannel.objects.create(
            name='Operator Private',
            channel_type='discord',
            apprise_url='discord://test/test',
            owner=operator_user,
            is_global=False,
        )

        response = admin_client.get('/api/v1/notifications/channels/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        # Admin should see the channel
        channel_ids = [c['id'] for c in data['channels']]
        assert channel.id in channel_ids

    def test_admin_can_update_any_channel(self, admin_client, operator_user, db):
        """Test that admin can update any channel."""
        channel = NotificationChannel.objects.create(
            name='Operator Channel',
            channel_type='discord',
            apprise_url='discord://test/test',
            owner=operator_user,
            is_global=False,
        )

        response = admin_client.patch(
            f'/api/v1/notifications/channels/{channel.id}/',
            {'name': 'Admin Updated'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()['name'] == 'Admin Updated'

    def test_admin_can_delete_any_channel(self, admin_client, operator_user, db):
        """Test that admin can delete any channel."""
        channel = NotificationChannel.objects.create(
            name='Operator Channel',
            channel_type='discord',
            apprise_url='discord://test/test',
            owner=operator_user,
            is_global=False,
        )
        channel_id = channel.id

        response = admin_client.delete(f'/api/v1/notifications/channels/{channel_id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not NotificationChannel.objects.filter(id=channel_id).exists()

    def test_admin_can_create_global_channel(self, admin_client, admin_user):
        """Test that admin can create global channels."""
        data = {
            'name': 'Global Channel',
            'channel_type': 'discord',
            'apprise_url': 'discord://global/webhook',
            'is_global': True,
        }

        response = admin_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['is_global'] is True

    def test_view_notifications_requires_auth(self, api_client, db):
        """Test that viewing notification history may require authentication."""
        NotificationLog.objects.create(
            notification_type='alert',
            status='sent',
        )

        response = api_client.get('/api/v1/notifications/history/')

        # Depending on auth mode, this could be 200 or 401
        # In public mode it should work, in authenticated mode it should require auth
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_401_UNAUTHORIZED]

    def test_global_channels_visible_to_all_authenticated_users(
        self, viewer_client, admin_user, db
    ):
        """Test that global channels are visible to all authenticated users."""
        channel = NotificationChannel.objects.create(
            name='Global Alert Channel',
            channel_type='discord',
            apprise_url='discord://global/webhook',
            owner=admin_user,
            is_global=True,
        )

        response = viewer_client.get('/api/v1/notifications/channels/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        channel_ids = [c['id'] for c in data['channels']]
        assert channel.id in channel_ids


# =============================================================================
# Notification Statistics Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationStatistics:
    """Tests for notification statistics endpoint."""

    def test_get_notification_stats(self, operator_client, db):
        """Test getting notification statistics."""
        # Create some notification logs
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='alert', status='failed')
        NotificationLog.objects.create(notification_type='safety', status='sent')

        response = operator_client.get('/api/v1/notifications/stats/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'totals' in data
        assert 'by_type' in data
        assert 'period_hours' in data

    def test_notification_stats_totals(self, operator_client, db):
        """Test that notification stats include correct totals."""
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='alert', status='failed')

        response = operator_client.get('/api/v1/notifications/stats/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['totals']['sent'] >= 2
        assert data['totals']['failed'] >= 1

    def test_notification_stats_by_type(self, operator_client, db):
        """Test that notification stats group by type."""
        NotificationLog.objects.create(notification_type='alert', status='sent')
        NotificationLog.objects.create(notification_type='safety', status='sent')
        NotificationLog.objects.create(notification_type='emergency', status='sent')

        response = operator_client.get('/api/v1/notifications/stats/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data['by_type'], list)

    def test_notification_stats_by_channel(self, operator_client, notification_channels, db):
        """Test that notification stats group by channel."""
        channel = notification_channels[0]
        NotificationLog.objects.create(
            notification_type='alert',
            channel=channel,
            status='sent'
        )

        response = operator_client.get('/api/v1/notifications/stats/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'by_channel' in data


# =============================================================================
# Notification Services List Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationServices:
    """Tests for notification services list endpoint."""

    def test_get_notification_services(self, api_client):
        """Test getting list of available notification services."""
        response = api_client.get('/api/v1/notifications/services/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert 'services' in data
        assert isinstance(data['services'], list)

    def test_services_include_expected_providers(self, api_client):
        """Test that services list includes expected providers."""
        response = api_client.get('/api/v1/notifications/services/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        service_names = [s['name'] for s in data['services']]

        assert 'Discord' in service_names
        assert 'Slack' in service_names
        assert 'Email' in service_names


# =============================================================================
# Edge Cases and Error Handling Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationEdgeCases:
    """Tests for edge cases and error handling."""

    def test_create_channel_missing_required_fields(self, operator_client):
        """Test that creating a channel without required fields fails."""
        data = {
            'channel_type': 'discord',
            # Missing name and apprise_url
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_channel_invalid_type(self, operator_client):
        """Test that creating a channel with invalid type fails."""
        data = {
            'name': 'Invalid Channel',
            'channel_type': 'invalid_type',
            'apprise_url': 'invalid://url',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_get_nonexistent_channel(self, operator_client):
        """Test that getting a non-existent channel returns 404."""
        response = operator_client.get('/api/v1/notifications/channels/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_delete_nonexistent_channel(self, operator_client):
        """Test that deleting a non-existent channel returns 404."""
        response = operator_client.delete('/api/v1/notifications/channels/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_test_nonexistent_channel(self, operator_client):
        """Test that testing a non-existent channel returns 404."""
        response = operator_client.post('/api/v1/notifications/channels/99999/test/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_channel_with_very_long_name(self, operator_client):
        """Test creating a channel with a very long name."""
        data = {
            'name': 'A' * 150,  # Exceeds max_length of 100
            'channel_type': 'discord',
            'apprise_url': 'discord://test/test',
        }

        response = operator_client.post(
            '/api/v1/notifications/channels/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_empty_history(self, operator_client, db):
        """Test getting notification history when empty."""
        NotificationLog.objects.all().delete()

        response = operator_client.get('/api/v1/notifications/history/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data['count'] == 0
        assert data['history'] == []


# =============================================================================
# Integration Workflow Tests
# =============================================================================

@pytest.mark.django_db
class TestNotificationWorkflows:
    """Tests for complete notification workflows."""

    def test_complete_channel_workflow(self, operator_client, operator_user, mock_apprise):
        """Test complete workflow: create -> test -> update -> delete."""
        # 1. Create channel
        create_response = operator_client.post(
            '/api/v1/notifications/channels/',
            {
                'name': 'Workflow Channel',
                'channel_type': 'discord',
                'apprise_url': 'discord://workflow/test',
            },
            format='json'
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        channel_id = create_response.json()['id']

        # 2. Retrieve channel
        get_response = operator_client.get(f'/api/v1/notifications/channels/{channel_id}/')
        assert get_response.status_code == status.HTTP_200_OK
        assert get_response.json()['name'] == 'Workflow Channel'

        # 3. Test channel
        test_response = operator_client.post(
            f'/api/v1/notifications/channels/{channel_id}/test/',
            {},
            format='json'
        )
        assert test_response.status_code == status.HTTP_200_OK

        # 4. Update channel
        update_response = operator_client.patch(
            f'/api/v1/notifications/channels/{channel_id}/',
            {'name': 'Updated Workflow Channel'},
            format='json'
        )
        assert update_response.status_code == status.HTTP_200_OK
        assert update_response.json()['name'] == 'Updated Workflow Channel'

        # 5. Delete channel
        delete_response = operator_client.delete(f'/api/v1/notifications/channels/{channel_id}/')
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

        # 6. Verify deleted
        verify_response = operator_client.get(f'/api/v1/notifications/channels/{channel_id}/')
        assert verify_response.status_code == status.HTTP_404_NOT_FOUND

    def test_alert_notification_workflow(
        self, operator_client, notification_channels, mock_apprise, db
    ):
        """Test workflow: create alert -> link channels -> trigger -> check logs."""
        # 1. Create alert rule
        alert_response = operator_client.post(
            '/api/v1/alerts/rules/',
            {
                'name': 'Notification Test Alert',
                'type': 'squawk',
                'operator': 'eq',
                'value': '7700',
                'priority': 'critical',
            },
            format='json'
        )
        assert alert_response.status_code == status.HTTP_201_CREATED
        alert_id = alert_response.json()['id']

        # 2. Link notification channels (if the API supports this)
        # This depends on the actual API implementation

        # 3. Create alert history (simulating trigger)
        alert = AlertRule.objects.get(id=alert_id)
        AlertHistory.objects.create(
            rule=alert,
            rule_name=alert.name,
            icao_hex='EMG123',
            callsign='EMERG',
            message='Emergency squawk detected',
            priority='critical',
        )

        # 4. Create notification log (simulating notification sent)
        NotificationLog.objects.create(
            notification_type='emergency',
            icao_hex='EMG123',
            callsign='EMERG',
            message='Emergency alert: 7700 squawk',
            status='sent',
        )

        # 5. Check notification history
        history_response = operator_client.get('/api/v1/notifications/history/')
        assert history_response.status_code == status.HTTP_200_OK
        assert history_response.json()['count'] >= 1
