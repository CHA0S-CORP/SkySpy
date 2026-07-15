"""
Notification service using Apprise for multi-platform notifications.

Supports:
- Multiple notification platforms via Apprise
- Per-rule webhook URL overrides
- Cooldown tracking to prevent spam
- Database configuration and logging
"""

import ipaddress
import logging
import socket
import threading
import time
from urllib.parse import urlparse

import apprise
from django.conf import settings

from skyspy.models import NotificationConfig, NotificationLog

logger = logging.getLogger(__name__)

# Cooldown tracking (in-memory for performance)
_notification_cooldown: dict[str, float] = {}
_notification_cooldown_lock = threading.Lock()

# Private/internal IP ranges that should be blocked for SSRF prevention
_BLOCKED_IP_RANGES = [
    ipaddress.ip_network("127.0.0.0/8"),  # Loopback
    ipaddress.ip_network("10.0.0.0/8"),  # Private Class A
    ipaddress.ip_network("172.16.0.0/12"),  # Private Class B
    ipaddress.ip_network("192.168.0.0/16"),  # Private Class C
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local
    ipaddress.ip_network("::1/128"),  # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),  # IPv6 private
    ipaddress.ip_network("fe80::/10"),  # IPv6 link-local
]


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Check whether an IP address is private/loopback/link-local/reserved."""
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
        return True
    return any(ip in blocked_range for blocked_range in _BLOCKED_IP_RANGES)


def _is_safe_url(url: str) -> bool:
    """
    Validate that a URL is safe to use as a webhook destination.

    Checks:
    - URL scheme is http or https
    - Host is not a private/internal IP address (SSRF prevention)
    - Hostnames are resolved via DNS and blocked if any resolved address
      is private/internal (fail-closed on resolution errors)

    Args:
        url: The URL to validate

    Returns:
        True if the URL is safe, False otherwise
    """
    try:
        parsed = urlparse(url)

        # Only allow http and https schemes
        if parsed.scheme not in ("http", "https"):
            logger.warning(f"Blocked URL with invalid scheme: {parsed.scheme}")
            return False

        # Check if hostname is present
        if not parsed.hostname:
            logger.warning("Blocked URL with no hostname")
            return False

        # Try to parse the hostname as a literal IP address
        try:
            ip = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            # Not a literal IP - resolve the hostname and check every resolved
            # address so names like "localhost" or "redis" can't bypass the filter.
            try:
                addr_info = socket.getaddrinfo(parsed.hostname, None)
            except (socket.gaierror, OSError) as e:
                # Fail closed: if we can't resolve it, we can't validate it
                logger.warning(f"Blocked URL with unresolvable hostname {parsed.hostname}: {e}")
                return False

            for _family, _type, _proto, _canonname, sockaddr in addr_info:
                try:
                    resolved = ipaddress.ip_address(sockaddr[0])
                except ValueError:
                    logger.warning(f"Blocked URL: unparseable resolved address for {parsed.hostname}")
                    return False
                if _is_blocked_ip(resolved):
                    logger.warning(f"Blocked URL: hostname {parsed.hostname} resolves to private IP {resolved}")
                    return False

            return True

        # Literal IP address - check against blocked ranges
        if _is_blocked_ip(ip):
            logger.warning(f"Blocked URL targeting private IP: {parsed.hostname}")
            return False

        return True

    except Exception as e:
        logger.warning(f"URL validation error: {e}")
        return False


class NotificationManager:
    """Manages notifications via Apprise."""

    def __init__(self):
        self.apprise = apprise.Apprise()
        self._setup_notifications()

    def _setup_notifications(self):
        """Set up notification URLs from settings."""
        apprise_urls = getattr(settings, "APPRISE_URLS", "")
        if apprise_urls:
            for url in apprise_urls.split(","):
                url = url.strip()
                if url:
                    self.apprise.add(url)

    def reload_from_db(self):
        """Reload URLs from database config."""
        try:
            config = NotificationConfig.get_config()
            if config and config.apprise_urls:
                self.apprise.clear()
                # NotificationConfig.apprise_urls uses ";" as the canonical delimiter
                # (see serializers/notifications.py, api/notifications.py)
                for url in config.apprise_urls.split(";"):
                    url = url.strip()
                    if url:
                        self.apprise.add(url)
        except (KeyError, AttributeError, TypeError) as e:
            logger.warning(f"Failed to reload notification config: {e}")

    def reload_urls(self, urls: str):
        """Reload notification URLs."""
        self.apprise.clear()
        for url in urls.split(","):
            url = url.strip()
            if url:
                self.apprise.add(url)

    def can_notify(self, key: str, cooldown: int = None) -> bool:
        """
        Check if notification can be sent (respects cooldown).

        Uses atomic check-and-set to prevent race conditions.
        Returns True and sets cooldown if notification can proceed.
        """
        if cooldown is None:
            cooldown = getattr(settings, "NOTIFICATION_COOLDOWN", 300)

        now = time.time()
        with _notification_cooldown_lock:
            last_sent = _notification_cooldown.get(key, 0)
            if (now - last_sent) > cooldown:
                # Atomic check-and-set: update cooldown while holding lock
                _notification_cooldown[key] = now
                return True
            return False

    def send(
        self,
        title: str,
        body: str,
        notify_type: str = "info",
        key: str | None = None,
        icao: str | None = None,
        callsign: str | None = None,
        details: dict | None = None,
        api_url: str | None = None,
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
            cooldown = config.cooldown_seconds if config else getattr(settings, "NOTIFICATION_COOLDOWN", 300)
        except Exception as e:
            logger.warning(f"Failed to check notification config: {e}")
            cooldown = getattr(settings, "NOTIFICATION_COOLDOWN", 300)

        # Use per-rule API URL if provided
        notifier = self.apprise
        if api_url:
            # Validate URL before using it (SSRF prevention)
            if not _is_safe_url(api_url):
                logger.warning(f"Blocked unsafe webhook URL: {api_url[:100]}")
                return False
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
            if notify_type == "warning":
                apprise_type = apprise.NotifyType.WARNING
            elif notify_type in ("emergency", "critical"):
                apprise_type = apprise.NotifyType.FAILURE

            result = notifier.notify(title=title, body=body, notify_type=apprise_type)

            if result:
                # Note: cooldown was already set atomically in can_notify()
                # Log notification
                try:
                    NotificationLog.objects.create(
                        notification_type=notify_type,
                        icao_hex=icao,
                        callsign=callsign,
                        message=f"{title}: {body}",
                        details=details or {},
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
            cooldown = config.cooldown_seconds if config else getattr(settings, "NOTIFICATION_COOLDOWN", 300)
        except Exception:
            enabled = True
            cooldown = 300

        with _notification_cooldown_lock:
            active_cooldowns = len(_notification_cooldown)
        return {
            "enabled": enabled,
            "server_count": self.server_count,
            "cooldown_seconds": cooldown,
            "active_cooldowns": active_cooldowns,
        }


# Global notification manager instance
notifier = NotificationManager()


def send_notification(title: str, body: str, notify_type: str = "info", **kwargs) -> bool:
    """Convenience function to send notification."""
    return notifier.send(title, body, notify_type, **kwargs)


def send_alert_notification(
    rule_name: str,
    icao: str,
    callsign: str | None,
    message: str,
    priority: str = "info",
    api_url: str | None = None,
    details: dict | None = None,
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
        details=details,
    )


def send_safety_notification(
    event_type: str,
    icao: str,
    callsign: str | None,
    message: str,
    severity: str = "warning",
    details: dict | None = None,
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
        details=details,
    )


def cleanup_cooldowns():
    """Clean up old cooldown entries to prevent memory growth."""
    now = time.time()
    # Keep entries for 2x the configured cooldown (minimum 10 minutes) so
    # cooldowns longer than the old fixed 600s cutoff remain enforceable
    try:
        config = NotificationConfig.get_config()
        cooldown = (config.cooldown_seconds if config else None) or getattr(settings, "NOTIFICATION_COOLDOWN", 300)
    except Exception as e:
        logger.warning(f"Failed to read notification config for cooldown cleanup: {e}")
        cooldown = getattr(settings, "NOTIFICATION_COOLDOWN", 300)
    cutoff = now - max(600, cooldown * 2)
    with _notification_cooldown_lock:
        stale_keys = [k for k, v in _notification_cooldown.items() if v < cutoff]
        for k in stale_keys:
            _notification_cooldown.pop(k, None)
    if stale_keys:
        logger.debug(f"Cleaned up {len(stale_keys)} cooldown entries")
