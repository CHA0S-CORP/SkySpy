"""Notification channel handlers for MainNamespace."""

import logging

from asgiref.sync import sync_to_async

logger = logging.getLogger(__name__)


class NotificationHandlerMixin:
    """Notification channel CRUD and test delivery."""

    async def _handle_notification_channels(self, params: dict):
        """List all notification channels."""
        return await self._get_notification_channels(params)

    async def _handle_notification_channel_types(self, params: dict):
        """Get available notification channel types."""
        return await self._get_notification_channel_types()

    async def _handle_notification_channel_create(self, params: dict):
        """Create a new notification channel."""
        return await self._create_notification_channel(params)

    async def _handle_notification_channel_update(self, params: dict):
        """Update an existing notification channel."""
        channel_id = params.get("id")
        if not channel_id:
            raise ValueError("Missing channel id")
        return await self._update_notification_channel(channel_id, params)

    async def _handle_notification_channel_delete(self, params: dict):
        """Delete a notification channel."""
        channel_id = params.get("id")
        if not channel_id:
            raise ValueError("Missing channel id")
        return await self._delete_notification_channel(channel_id)

    async def _handle_notification_channel_test(self, params: dict):
        """Test a notification channel."""
        channel_id = params.get("id")
        if not channel_id:
            raise ValueError("Missing channel id")
        return await self._test_notification_channel(channel_id)

    # -----------------------------------------------------------------
    # Data access
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_notification_channels(self, params: dict):
        """Get all notification channels."""
        from skyspy.models import NotificationChannel

        channels = NotificationChannel.objects.all().order_by("-created_at")
        return [
            {
                "id": str(ch.id),
                "name": ch.name,
                "channel_type": ch.channel_type,
                "enabled": ch.enabled,
                "verified": ch.verified,
                "config": ch.config,
                "created_at": ch.created_at.isoformat() if ch.created_at else None,
                "updated_at": ch.updated_at.isoformat() if ch.updated_at else None,
            }
            for ch in channels
        ]

    @sync_to_async
    def _get_notification_channel_types(self):
        """Get available notification channel types."""
        from skyspy.models import NotificationChannel

        return {"types": [{"value": choice[0], "label": choice[1]} for choice in NotificationChannel.CHANNEL_TYPES]}

    @sync_to_async
    def _create_notification_channel(self, params: dict):
        """Create a new notification channel."""
        from skyspy.models import NotificationChannel

        channel = NotificationChannel.objects.create(
            name=params.get("name", "New Channel"),
            channel_type=params.get("channel_type", "webhook"),
            enabled=params.get("enabled", True),
            config=params.get("config", {}),
        )
        return {
            "id": str(channel.id),
            "name": channel.name,
            "channel_type": channel.channel_type,
            "enabled": channel.enabled,
            "verified": channel.verified,
            "config": channel.config,
            "created_at": channel.created_at.isoformat() if channel.created_at else None,
        }

    @sync_to_async
    def _update_notification_channel(self, channel_id, params: dict):
        """Update a notification channel."""
        from skyspy.models import NotificationChannel

        try:
            channel = NotificationChannel.objects.get(id=channel_id)
        except NotificationChannel.DoesNotExist:
            raise ValueError("Channel not found")

        if "name" in params:
            channel.name = params["name"]
        if "channel_type" in params:
            channel.channel_type = params["channel_type"]
        if "enabled" in params:
            channel.enabled = params["enabled"]
        if "config" in params:
            channel.config = params["config"]

        channel.save()
        return {
            "id": str(channel.id),
            "name": channel.name,
            "channel_type": channel.channel_type,
            "enabled": channel.enabled,
            "verified": channel.verified,
            "config": channel.config,
            "updated_at": channel.updated_at.isoformat() if channel.updated_at else None,
        }

    @sync_to_async
    def _delete_notification_channel(self, channel_id):
        """Delete a notification channel."""
        from skyspy.models import NotificationChannel

        try:
            channel = NotificationChannel.objects.get(id=channel_id)
            channel.delete()
            return {"success": True, "id": str(channel_id)}
        except NotificationChannel.DoesNotExist:
            raise ValueError("Channel not found")

    async def _test_notification_channel(self, channel_id):
        """Test a notification channel by sending a test message."""
        channel = await self._get_channel_for_test(channel_id)
        success, message = await self._send_channel_test(channel)
        if success:
            await self._mark_channel_verified(channel)
        return {
            "success": success,
            "message": message,
            "verified": channel.verified,
        }

    @sync_to_async
    def _get_channel_for_test(self, channel_id):
        """Fetch the notification channel to test (ORM access)."""
        from skyspy.models import NotificationChannel

        try:
            return NotificationChannel.objects.get(id=channel_id)
        except NotificationChannel.DoesNotExist:
            raise ValueError("Channel not found")

    # thread_sensitive=False: the Apprise delivery is network-bound and must
    # not block Django's single shared sync thread. No ORM access here.
    @sync_to_async(thread_sensitive=False)
    def _send_channel_test(self, channel):
        """Send a test notification via Apprise (network I/O, no ORM)."""
        try:
            import apprise
        except ImportError:
            return False, "apprise library not installed"

        apobj = apprise.Apprise()
        apobj.add(channel.apprise_url)
        result = apobj.notify(
            title="SkySpy Test Notification",
            body="This is a test notification from SkySpy.",
            notify_type=apprise.NotifyType.INFO,
        )
        return bool(result), "Test notification sent" if result else "Failed to send notification"

    @sync_to_async
    def _mark_channel_verified(self, channel):
        """Mark a channel as verified after a successful test (ORM access)."""
        channel.verified = True
        channel.save(update_fields=["verified"])
