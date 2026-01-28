"""
Notification routing service.

Determines which channels should receive notifications based on
priority, event type, user preferences, and quiet hours.
"""
import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from django.contrib.auth.models import User

logger = logging.getLogger(__name__)


@dataclass
class RoutedNotification:
    """A notification routed to a specific channel."""
    channel_id: int
    channel_name: str
    channel_type: str
    apprise_url: str
    supports_rich: bool
    user_id: Optional[int] = None
    preference_id: Optional[int] = None


class NotificationRouter:
    """
    Routes notifications to appropriate channels based on:
    - Rule-specific webhook URLs
    - User notification preferences
    - Priority-based filtering
    - Quiet hours
    - Global channel configuration
    """

    # Priority levels in order
    PRIORITY_ORDER = {'info': 0, 'warning': 1, 'critical': 2}

    def get_channels_for_notification(
        self,
        priority: str,
        event_type: str,
        user: Optional[User] = None,
        rule_webhook_url: Optional[str] = None,
        include_global: bool = True
    ) -> List[RoutedNotification]:
        """
        Get all channels that should receive this notification.

        Priority order:
        1. Rule-specific webhook (if api_url set on rule)
        2. User preferences (filtered by min_priority, event_types, quiet_hours)
        3. Global channels (fallback)

        Args:
            priority: Notification priority (info, warning, critical)
            event_type: Event type (alert, safety, military, etc.)
            user: Optional user for user-specific routing
            rule_webhook_url: Optional webhook URL from the rule
            include_global: Whether to include global channels

        Returns:
            List of RoutedNotification objects
        """
        from skyspy.models.notifications import NotificationChannel, UserNotificationPreference

        routed: List[RoutedNotification] = []
        seen_urls: set = set()

        # 1. Rule-specific webhook
        if rule_webhook_url:
            routed.append(RoutedNotification(
                channel_id=0,
                channel_name='Rule Webhook',
                channel_type='webhook',
                apprise_url=rule_webhook_url,
                supports_rich=False,
            ))
            seen_urls.add(rule_webhook_url)

        # 2. User preferences
        if user and user.is_authenticated:
            preferences = UserNotificationPreference.objects.filter(
                user=user,
                enabled=True,
                channel__enabled=True
            ).select_related('channel')

            for pref in preferences:
                if not pref.should_receive(priority, event_type):
                    continue

                if pref.channel.apprise_url in seen_urls:
                    continue

                routed.append(RoutedNotification(
                    channel_id=pref.channel.id,
                    channel_name=pref.channel.name,
                    channel_type=pref.channel.channel_type,
                    apprise_url=pref.channel.apprise_url,
                    supports_rich=pref.channel.supports_rich,
                    user_id=user.id,
                    preference_id=pref.id,
                ))
                seen_urls.add(pref.channel.apprise_url)

        # 3. Global channels
        if include_global:
            global_channels = NotificationChannel.objects.filter(
                is_global=True,
                enabled=True
            )

            for channel in global_channels:
                if channel.apprise_url in seen_urls:
                    continue

                # Apply basic priority filtering for global channels
                # Global channels receive all notifications by default
                routed.append(RoutedNotification(
                    channel_id=channel.id,
                    channel_name=channel.name,
                    channel_type=channel.channel_type,
                    apprise_url=channel.apprise_url,
                    supports_rich=channel.supports_rich,
                ))
                seen_urls.add(channel.apprise_url)

        return routed

    def get_channels_for_priority(
        self,
        priority: str,
        event_type: str = 'alert'
    ) -> List[RoutedNotification]:
        """
        Get global channels filtered by priority.

        Used for notifications that don't have a specific user context.

        Example routing:
        - critical: All channels
        - warning: Channels configured for warning or higher
        - info: Channels configured for info notifications
        """
        from skyspy.models.notifications import NotificationChannel

        channels = NotificationChannel.objects.filter(
            is_global=True,
            enabled=True
        )

        routed: List[RoutedNotification] = []
        for channel in channels:
            routed.append(RoutedNotification(
                channel_id=channel.id,
                channel_name=channel.name,
                channel_type=channel.channel_type,
                apprise_url=channel.apprise_url,
                supports_rich=channel.supports_rich,
            ))

        return routed

    def get_channels_for_users(
        self,
        user_ids: List[int],
        priority: str,
        event_type: str
    ) -> Dict[int, List[RoutedNotification]]:
        """
        Get channels for multiple users efficiently.

        Returns:
            Dict mapping user_id to list of RoutedNotification
        """
        from skyspy.models.notifications import UserNotificationPreference

        result: Dict[int, List[RoutedNotification]] = {uid: [] for uid in user_ids}

        preferences = UserNotificationPreference.objects.filter(
            user_id__in=user_ids,
            enabled=True,
            channel__enabled=True
        ).select_related('channel', 'user')

        for pref in preferences:
            if not pref.should_receive(priority, event_type):
                continue

            result[pref.user_id].append(RoutedNotification(
                channel_id=pref.channel.id,
                channel_name=pref.channel.name,
                channel_type=pref.channel.channel_type,
                apprise_url=pref.channel.apprise_url,
                supports_rich=pref.channel.supports_rich,
                user_id=pref.user_id,
                preference_id=pref.id,
            ))

        return result

    def get_subscribers_for_rule(
        self,
        rule_id: int,
        priority: str,
        event_type: str = 'alert'
    ) -> List[RoutedNotification]:
        """
        Get all subscribers to a rule and their channels.

        Used for user-specific alert rules.
        """
        from skyspy.models.alerts import AlertSubscription

        routed: List[RoutedNotification] = []
        seen_urls: set = set()

        try:
            subscriptions = AlertSubscription.objects.filter(
                rule_id=rule_id,
                notify_on_trigger=True
            ).select_related('user')

            user_ids = [sub.user_id for sub in subscriptions if sub.user_id]
            user_channels = self.get_channels_for_users(user_ids, priority, event_type)

            for user_id, channels in user_channels.items():
                for channel in channels:
                    if channel.apprise_url not in seen_urls:
                        routed.append(channel)
                        seen_urls.add(channel.apprise_url)

        except Exception as e:
            # AlertSubscription model may not exist yet
            logger.debug(f"Could not get rule subscribers: {e}")

        return routed

    def should_notify(
        self,
        priority: str,
        min_priority: str
    ) -> bool:
        """
        Check if a notification meets minimum priority threshold.
        """
        msg_level = self.PRIORITY_ORDER.get(priority, 0)
        min_level = self.PRIORITY_ORDER.get(min_priority, 0)
        return msg_level >= min_level

    def get_fallback_channels(self) -> List[RoutedNotification]:
        """
        Get legacy/fallback channels from NotificationConfig.

        Used for backwards compatibility with existing configuration.
        """
        from skyspy.models.notifications import NotificationConfig

        routed: List[RoutedNotification] = []

        try:
            config = NotificationConfig.get_config()
            if config.enabled and config.apprise_urls:
                for i, url in enumerate(config.apprise_urls.split(';')):
                    url = url.strip()
                    if url:
                        # Determine channel type from URL
                        channel_type = self._guess_channel_type(url)
                        routed.append(RoutedNotification(
                            channel_id=0,
                            channel_name=f'Legacy Channel {i + 1}',
                            channel_type=channel_type,
                            apprise_url=url,
                            supports_rich=channel_type in ('discord', 'slack'),
                        ))
        except Exception as e:
            logger.warning(f"Failed to get fallback channels: {e}")

        return routed

    def _guess_channel_type(self, url: str) -> str:
        """Guess channel type from Apprise URL."""
        url_lower = url.lower()

        if 'discord' in url_lower:
            return 'discord'
        elif 'slack' in url_lower:
            return 'slack'
        elif 'pushover' in url_lower:
            return 'pushover'
        elif 'telegram' in url_lower or url_lower.startswith('tgram'):
            return 'telegram'
        elif 'mailto' in url_lower or '@' in url_lower:
            return 'email'
        elif 'ntfy' in url_lower:
            return 'ntfy'
        elif 'gotify' in url_lower:
            return 'gotify'
        elif 'hassio' in url_lower or 'home-assistant' in url_lower:
            return 'home_assistant'
        else:
            return 'webhook'


# Global singleton
notification_router = NotificationRouter()
