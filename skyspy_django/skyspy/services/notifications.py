"""
Notification service using Apprise for multi-platform notifications.

Supports:
- Multiple notification platforms via Apprise
- Per-rule webhook URL overrides
- Cooldown tracking to prevent spam
- Database configuration and logging
"""
import logging
import time
from typing import Optional

import apprise
from django.conf import settings
from django.core.cache import cache

from skyspy.models import NotificationConfig, NotificationLog

logger = logging.getLogger(__name__)

# Cooldown tracking (in-memory for performance)
_notification_cooldown: dict[str, float] = {}


class NotificationManager:
    """Manages notifications via Apprise."""

    def __init__(self):
        self.apprise = apprise.Apprise()
        self._setup_notifications()

    def _setup_notifications(self):
        """Set up notification URLs from settings."""
        apprise_urls = getattr(settings, 'APPRISE_URLS', '')
        if apprise_urls:
            for url in apprise_urls.split(','):
                url = url.strip()
                if url:
                    self.apprise.add(url)

    def reload_from_db(self):
        """Reload URLs from database config."""
        try:
            config = NotificationConfig.get_config()
            if config and config.apprise_urls:
                self.apprise.clear()
                for url in config.apprise_urls.split(','):
                    url = url.strip()
                    if url:
                        self.apprise.add(url)
        except (KeyError, AttributeError, TypeError) as e:
            logger.warning(f"Failed to reload notification config: {e}")

    def reload_urls(self, urls: str):
        """Reload notification URLs."""
        self.apprise.clear()
        for url in urls.split(','):
            url = url.strip()
            if url:
                self.apprise.add(url)

    def can_notify(self, key: str, cooldown: int = None) -> bool:
        """Check if notification can be sent (respects cooldown)."""
        if cooldown is None:
            cooldown = getattr(settings, 'NOTIFICATION_COOLDOWN', 300)

        now = time.time()
        last_sent = _notification_cooldown.get(key, 0)
        return (now - last_sent) > cooldown

    def send(
        self,
        title: str,
        body: str,
        notify_type: str = 'info',
        key: Optional[str] = None,
        icao: Optional[str] = None,
        callsign: Optional[str] = None,
        details: Optional[dict] = None,
        api_url: Optional[str] = None
    ) -> bool:
        """
        Send notification with optional per-rule API URL override.

        Args:
            title: Notification title
            body: Notification body text
            notify_type: Type (info, warning, emergency)
            key: Cooldown key
            icao: Aircraft ICAO hex
            callsign: Aircraft callsign
            details: Additional details dict
            api_url: Override webhook URL

        Returns:
            True if notification sent successfully
        """
        # Check if enabled
        try:
            config = NotificationConfig.get_config()
            if config and not config.enabled:
                return False
            cooldown = config.cooldown_seconds if config else getattr(
                settings, 'NOTIFICATION_COOLDOWN', 300
            )
        except Exception as e:
            logger.warning(f"Failed to check notification config: {e}")
            cooldown = getattr(settings, 'NOTIFICATION_COOLDOWN', 300)

        # Use per-rule API URL if provided
        notifier = self.apprise
        if api_url:
            notifier = apprise.Apprise()
            notifier.add(api_url)
        elif not self.apprise.servers:
            self.reload_from_db()
            if not self.apprise.servers:
                return False

        cooldown_key = key or f"{notify_type}:{icao}:{callsign}"
        if not self.can_notify(cooldown_key, cooldown):
            return False

        try:
            apprise_type = apprise.NotifyType.INFO
            if notify_type == 'warning':
                apprise_type = apprise.NotifyType.WARNING
            elif notify_type in ('emergency', 'critical'):
                apprise_type = apprise.NotifyType.FAILURE

            result = notifier.notify(title=title, body=body, notify_type=apprise_type)

            if result:
                _notification_cooldown[cooldown_key] = time.time()

                # Log notification
                try:
                    NotificationLog.objects.create(
                        notification_type=notify_type,
                        icao_hex=icao,
                        callsign=callsign,
                        message=f"{title}: {body}",
                        details=details or {}
                    )
                except Exception as e:
                    logger.warning(f"Failed to log notification: {e}")

                logger.info(f"Notification sent: {title}")
            else:
                logger.warning(f"Notification failed: {title}")

            return result

        except Exception as e:
            logger.error(f"Notification error: {e}")
            return False

    @property
    def server_count(self) -> int:
        """Get number of configured notification servers."""
        return len(self.apprise.servers)

    def get_status(self) -> dict:
        """Get notification service status."""
        try:
            config = NotificationConfig.get_config()
            enabled = config.enabled if config else True
            cooldown = config.cooldown_seconds if config else getattr(
                settings, 'NOTIFICATION_COOLDOWN', 300
            )
        except Exception:
            enabled = True
            cooldown = 300

        return {
            'enabled': enabled,
            'server_count': self.server_count,
            'cooldown_seconds': cooldown,
            'active_cooldowns': len(_notification_cooldown),
        }


# Global notification manager instance
notifier = NotificationManager()


def send_notification(
    title: str,
    body: str,
    notify_type: str = 'info',
    **kwargs
) -> bool:
    """Convenience function to send notification."""
    return notifier.send(title, body, notify_type, **kwargs)


def send_alert_notification(
    rule_name: str,
    icao: str,
    callsign: Optional[str],
    message: str,
    priority: str = 'info',
    api_url: Optional[str] = None,
    details: Optional[dict] = None
) -> bool:
    """Send notification for triggered alert rule."""
    title = f"Alert: {rule_name}"
    body = f"{icao}"
    if callsign:
        body += f" ({callsign})"
    body += f": {message}"

    return notifier.send(
        title=title,
        body=body,
        notify_type=priority,
        key=f"alert:{rule_name}:{icao}",
        icao=icao,
        callsign=callsign,
        api_url=api_url,
        details=details
    )


def send_safety_notification(
    event_type: str,
    icao: str,
    callsign: Optional[str],
    message: str,
    severity: str = 'warning',
    details: Optional[dict] = None
) -> bool:
    """Send notification for safety event."""
    title = f"Safety Event: {event_type}"
    body = f"{icao}"
    if callsign:
        body += f" ({callsign})"
    body += f": {message}"

    return notifier.send(
        title=title,
        body=body,
        notify_type=severity,
        key=f"safety:{event_type}:{icao}",
        icao=icao,
        callsign=callsign,
        details=details
    )


def cleanup_cooldowns():
    """Clean up old cooldown entries to prevent memory growth."""
    now = time.time()
    # Default cooldown is 5 minutes, keep entries for 2x that
    cutoff = now - 600
    stale_keys = [k for k, v in _notification_cooldown.items() if v < cutoff]
    for k in stale_keys:
        _notification_cooldown.pop(k, None)
    if stale_keys:
        logger.debug(f"Cleaned up {len(stale_keys)} cooldown entries")
