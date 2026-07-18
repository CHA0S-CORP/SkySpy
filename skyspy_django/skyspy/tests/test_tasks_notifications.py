"""
Tests for notification delivery Celery tasks.

Covers send_notification_task (success + failure/retry bookkeeping),
send_webhook_task (delivery + SSRF block), the periodic retry processor,
log cleanup, channel verification, and cooldown cleanup.

Runs with CELERY_TASK_ALWAYS_EAGER (see test_settings) so tasks execute
inline. External I/O (apprise, httpx) is mocked — these tests assert the
task's own bookkeeping, not real delivery.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from skyspy.models.notifications import NotificationChannel, NotificationLog
from skyspy.tasks.notifications import (
    cleanup_notification_cooldowns,
    cleanup_old_notification_logs,
    process_notification_queue,
    send_notification_task,
    send_webhook_task,
    verify_notification_channel,
)
from skyspy.tests.factories import NotificationChannelFactory, NotificationLogFactory


@pytest.mark.django_db
class TestSendNotificationTask:
    def test_success_marks_log_sent(self):
        channel = NotificationChannelFactory()
        with patch("apprise.Apprise") as MockApprise:
            MockApprise.return_value.notify.return_value = True

            result = send_notification_task.apply(
                kwargs={
                    "channel_url": channel.apprise_url,
                    "title": "T",
                    "body": "B",
                    "channel_id": channel.id,
                }
            ).get()

        assert result["status"] == "sent"
        log = NotificationLog.objects.get(channel_id=channel.id)
        assert log.status == "sent"
        assert log.duration_ms is not None

    def test_failure_records_retry_state(self):
        """apprise.notify() returning False raises → the log is left in a
        retryable state with retry_count incremented and next_retry_at set."""
        channel = NotificationChannelFactory()
        with patch("apprise.Apprise") as MockApprise:
            MockApprise.return_value.notify.return_value = False

            # throw=False so the re-raise (for the retry pipeline) doesn't
            # propagate out of eager apply; inspect the DB row instead.
            send_notification_task.apply(
                kwargs={
                    "channel_url": channel.apprise_url,
                    "title": "T",
                    "body": "B",
                    "channel_id": channel.id,
                },
                throw=False,
            )

        log = NotificationLog.objects.get(channel_id=channel.id)
        assert log.status in ("retrying", "failed")
        assert log.retry_count >= 1
        assert log.last_error


@pytest.mark.django_db
class TestSendWebhookTask:
    def test_delivered_on_2xx(self):
        response = MagicMock(status_code=200)
        client = MagicMock()
        client.__enter__.return_value.post.return_value = response

        with (
            patch("httpx.Client", return_value=client),
            patch(
                "skyspy.services.notifications.pin_and_validate_url",
                return_value=("https://hook.example/x", {}),
            ),
        ):
            result = send_webhook_task.apply(kwargs={"url": "https://hook.example/x", "data": {"a": 1}}).get()

        assert result["status"] == "delivered"
        assert result["status_code"] == 200
        client.__enter__.return_value.post.assert_called_once()

    def test_unsafe_url_is_blocked(self):
        """SSRF guard: pin_and_validate_url rejecting the URL short-circuits
        delivery with a 'blocked' result and no HTTP call."""
        with (
            patch("httpx.Client") as MockClient,
            patch(
                "skyspy.services.notifications.pin_and_validate_url",
                return_value=(None, None),
            ),
        ):
            result = send_webhook_task.apply(
                kwargs={"url": "http://169.254.169.254/latest/meta-data", "data": {}}
            ).get()

        assert result["status"] == "blocked"
        MockClient.assert_not_called()


@pytest.mark.django_db
class TestProcessNotificationQueue:
    def test_requeues_due_retry_and_claims_row(self):
        channel = NotificationChannelFactory()
        log = NotificationLogFactory(
            channel=channel,
            channel_url=channel.apprise_url,
            status="retrying",
        )
        # Make it due for retry (bypass auto_now_add / defaults via update).
        NotificationLog.objects.filter(id=log.id).update(next_retry_at=timezone.now() - timedelta(minutes=1))

        with patch("skyspy.tasks.notifications.send_notification_task.delay") as mock_delay:
            result = process_notification_queue()

        assert result["processed"] == 1
        mock_delay.assert_called_once()

        # The row is claimed by pushing next_retry_at into the future so an
        # overlapping beat run won't re-enqueue it.
        log.refresh_from_db()
        assert log.next_retry_at > timezone.now()

    def test_ignores_not_yet_due(self):
        channel = NotificationChannelFactory()
        log = NotificationLogFactory(channel=channel, channel_url=channel.apprise_url, status="retrying")
        NotificationLog.objects.filter(id=log.id).update(next_retry_at=timezone.now() + timedelta(minutes=30))

        with patch("skyspy.tasks.notifications.send_notification_task.delay") as mock_delay:
            result = process_notification_queue()

        assert result["processed"] == 0
        mock_delay.assert_not_called()


@pytest.mark.django_db
class TestCleanupOldNotificationLogs:
    def test_deletes_only_old_logs(self):
        old = NotificationLogFactory()
        recent = NotificationLogFactory()
        # timestamp is auto_now_add, so backdate via queryset update.
        NotificationLog.objects.filter(id=old.id).update(timestamp=timezone.now() - timedelta(days=40))

        result = cleanup_old_notification_logs.apply(kwargs={"days": 30}).get()

        assert result["deleted"] == 1
        assert NotificationLog.objects.filter(id=recent.id).exists()
        assert not NotificationLog.objects.filter(id=old.id).exists()


@pytest.mark.django_db
class TestVerifyNotificationChannel:
    def test_success_marks_channel_verified(self):
        channel = NotificationChannelFactory()
        NotificationChannel.objects.filter(id=channel.id).update(verified=False)

        with patch("apprise.Apprise") as MockApprise:
            MockApprise.return_value.notify.return_value = True
            result = verify_notification_channel(channel.id)

        assert result["success"] is True
        channel.refresh_from_db()
        assert channel.verified is True

    def test_missing_channel_returns_error(self):
        result = verify_notification_channel(999999)
        assert result["success"] is False
        assert "not found" in result["error"].lower()


@pytest.mark.django_db
class TestCleanupNotificationCooldowns:
    def test_invokes_service_cleanup(self):
        with patch("skyspy.services.notifications.cleanup_cooldowns") as mock_cleanup:
            result = cleanup_notification_cooldowns.apply().get()

        assert result["status"] == "success"
        mock_cleanup.assert_called_once()
