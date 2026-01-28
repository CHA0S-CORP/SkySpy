"""
Central notification dispatch coordinator.

Orchestrates the notification flow from alert/safety events through
templating, routing, and channel-specific delivery.
"""
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

from django.contrib.auth.models import User

from skyspy.services.template_engine import template_engine
from skyspy.services.notification_router import notification_router, RoutedNotification
from skyspy.services.rich_formatters import rich_formatter

logger = logging.getLogger(__name__)


@dataclass
class NotificationPayload:
    """Prepared notification ready for delivery."""
    channel_id: int
    channel_type: str
    apprise_url: str
    title: str
    body: str
    priority: str
    event_type: str
    rich_payload: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None
    user_id: Optional[int] = None


class NotificationDispatcher:
    """
    Coordinates notification dispatch from events to channels.

    Flow:
    1. Build context from event data
    2. Route to appropriate channels
    3. Render templates for each channel
    4. Format rich content where supported
    5. Queue for delivery (sync or async)
    """

    def dispatch_alert(
        self,
        alert_data: Dict[str, Any],
        user: Optional[User] = None,
        rule_webhook_url: Optional[str] = None,
        use_celery: bool = True
    ) -> List[NotificationPayload]:
        """
        Dispatch notifications for an alert event.

        Args:
            alert_data: Alert context with rule_name, aircraft, priority, etc.
            user: Optional user who owns the rule
            rule_webhook_url: Optional webhook URL from the rule
            use_celery: If True, queue via Celery; otherwise send synchronously

        Returns:
            List of prepared NotificationPayload objects
        """
        priority = alert_data.get('priority', 'info')
        event_type = 'alert'

        # Build template context
        context = template_engine.build_context_from_alert(alert_data)

        # Route to channels
        channels = notification_router.get_channels_for_notification(
            priority=priority,
            event_type=event_type,
            user=user,
            rule_webhook_url=rule_webhook_url,
        )

        # If no channels from new system, use fallback
        if not channels:
            channels = notification_router.get_fallback_channels()

        payloads = []
        for channel in channels:
            payload = self._prepare_payload(
                channel=channel,
                context=context,
                event_type=event_type,
                priority=priority,
            )
            payloads.append(payload)

        # Dispatch
        if use_celery:
            self._queue_payloads(payloads)
        else:
            self._send_payloads_sync(payloads)

        return payloads

    def dispatch_safety_event(
        self,
        event_data: Dict[str, Any],
        use_celery: bool = True
    ) -> List[NotificationPayload]:
        """
        Dispatch notifications for a safety event.

        Args:
            event_data: Safety event context
            use_celery: If True, queue via Celery

        Returns:
            List of prepared NotificationPayload objects
        """
        event_type = event_data.get('event_type', 'safety')
        severity = event_data.get('severity', 'warning')

        # Build template context
        context = template_engine.build_context_from_safety_event(event_data)

        # Route to channels (safety events go to global channels)
        channels = notification_router.get_channels_for_priority(
            priority=severity,
            event_type=event_type,
        )

        # If no channels from new system, use fallback
        if not channels:
            channels = notification_router.get_fallback_channels()

        payloads = []
        for channel in channels:
            payload = self._prepare_payload(
                channel=channel,
                context=context,
                event_type=event_type,
                priority=severity,
            )
            payloads.append(payload)

        # Dispatch
        if use_celery:
            self._queue_payloads(payloads)
        else:
            self._send_payloads_sync(payloads)

        return payloads

    def _prepare_payload(
        self,
        channel: RoutedNotification,
        context: Dict[str, Any],
        event_type: str,
        priority: str,
    ) -> NotificationPayload:
        """
        Prepare a notification payload for a specific channel.
        """
        from skyspy.models.notifications import NotificationTemplate

        # Get template
        template = NotificationTemplate.get_template_for(event_type, priority)

        # Render title and body
        if template:
            title = template_engine.render(template.title_template, context)
            body = template_engine.render(template.body_template, context)
        else:
            # Default templates
            title = f"SkysPy Alert: {context.get('rule_name', 'Notification')}"
            body = context.get('message', 'A notification was triggered.')

        # Prepare rich payload if channel supports it
        rich_payload = None
        if channel.supports_rich:
            rich_payload = rich_formatter.format(
                channel_type=channel.channel_type,
                event_type=event_type,
                data=context,
            )

            # Also check for template-specific rich formatting
            if template:
                if channel.channel_type == 'discord' and template.discord_embed:
                    # Use template's discord embed, rendering any variables
                    rich_payload = self._render_json_template(
                        template.discord_embed, context
                    )
                elif channel.channel_type == 'slack' and template.slack_blocks:
                    rich_payload = self._render_json_template(
                        template.slack_blocks, context
                    )

        return NotificationPayload(
            channel_id=channel.channel_id,
            channel_type=channel.channel_type,
            apprise_url=channel.apprise_url,
            title=title,
            body=body,
            priority=priority,
            event_type=event_type,
            rich_payload=rich_payload,
            context=context,
            user_id=channel.user_id,
        )

    def _render_json_template(
        self,
        template_json: Dict,
        context: Dict[str, Any]
    ) -> Dict:
        """
        Recursively render template variables in a JSON structure.
        """
        if isinstance(template_json, dict):
            return {
                k: self._render_json_template(v, context)
                for k, v in template_json.items()
            }
        elif isinstance(template_json, list):
            return [
                self._render_json_template(item, context)
                for item in template_json
            ]
        elif isinstance(template_json, str):
            return template_engine.render(template_json, context)
        else:
            return template_json

    def _queue_payloads(self, payloads: List[NotificationPayload]):
        """Queue payloads for async delivery via Celery."""
        for payload in payloads:
            try:
                from skyspy.tasks.notifications import send_notification_task
                send_notification_task.delay(
                    channel_url=payload.apprise_url,
                    title=payload.title,
                    body=payload.body,
                    priority=payload.priority,
                    event_type=payload.event_type,
                    channel_type=payload.channel_type,
                    channel_id=payload.channel_id,
                    rich_payload=payload.rich_payload,
                    context=payload.context,
                )
            except Exception as e:
                logger.warning(f"Failed to queue notification: {e}")
                # Fall back to sync delivery
                self._send_payload_sync(payload)

    def _send_payloads_sync(self, payloads: List[NotificationPayload]):
        """Send payloads synchronously."""
        for payload in payloads:
            self._send_payload_sync(payload)

    def _send_payload_sync(self, payload: NotificationPayload):
        """Send a single notification synchronously."""
        try:
            import apprise

            apobj = apprise.Apprise()
            apobj.add(payload.apprise_url)

            # Map priority to apprise notification type
            notify_type = apprise.NotifyType.INFO
            if payload.priority == 'warning':
                notify_type = apprise.NotifyType.WARNING
            elif payload.priority == 'critical':
                notify_type = apprise.NotifyType.FAILURE

            # Send notification
            apobj.notify(
                title=payload.title,
                body=payload.body,
                notify_type=notify_type,
            )

            # Log success
            self._log_notification(payload, status='sent')

        except ImportError:
            logger.debug("Apprise not installed, skipping notification")
        except Exception as e:
            logger.error(f"Failed to send notification: {e}")
            self._log_notification(payload, status='failed', error=str(e))

    def _log_notification(
        self,
        payload: NotificationPayload,
        status: str = 'sent',
        error: str = None
    ):
        """Log notification to database."""
        try:
            from skyspy.models.notifications import NotificationLog, NotificationChannel

            channel = None
            if payload.channel_id:
                try:
                    channel = NotificationChannel.objects.get(id=payload.channel_id)
                except NotificationChannel.DoesNotExist:
                    pass

            NotificationLog.objects.create(
                notification_type=payload.event_type,
                icao_hex=payload.context.get('icao') if payload.context else None,
                callsign=payload.context.get('callsign') if payload.context else None,
                message=payload.body[:500] if payload.body else None,
                details=payload.context,
                channel=channel,
                channel_url=payload.apprise_url,
                status=status,
                last_error=error,
            )
        except Exception as e:
            logger.warning(f"Failed to log notification: {e}")


# Global singleton
notification_dispatcher = NotificationDispatcher()


# Convenience functions for backwards compatibility
def dispatch_alert_notification(alert_data: Dict[str, Any], **kwargs):
    """Dispatch alert notification (convenience function)."""
    return notification_dispatcher.dispatch_alert(alert_data, **kwargs)


def dispatch_safety_notification(event_data: Dict[str, Any], **kwargs):
    """Dispatch safety notification (convenience function)."""
    return notification_dispatcher.dispatch_safety_event(event_data, **kwargs)
