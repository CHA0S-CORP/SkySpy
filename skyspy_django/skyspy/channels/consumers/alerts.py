"""
Alerts WebSocket consumer for custom alert rule triggers.

Supports user-specific channels for private alerts.
"""
import logging
from datetime import datetime, timedelta
from channels.db import database_sync_to_async
from django.utils import timezone

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.models import AlertRule, AlertHistory, AlertSubscription

logger = logging.getLogger(__name__)


class AlertsConsumer(BaseConsumer):
    """
    WebSocket consumer for custom alert rule triggers.

    Events:
    - alert:triggered - Alert rule matched
    - alert:snapshot - Recent alerts on connect

    Topics:
    - alerts - All alert triggers (public)
    - all - All alert data

    User-specific channels:
    - alerts_user_{user_id} - User's private alerts
    - alerts_session_{session_key} - Session-based alerts
    """

    group_name_prefix = 'alerts'
    supported_topics = ['alerts', 'triggers', 'all']

    async def connect(self):
        """Handle WebSocket connection with user-specific groups.

        Note: Groups are added BEFORE calling super().connect() to prevent
        race conditions where messages could be missed between accept() and
        group membership being established.
        """
        # Initialize group tracking
        self._user_group = None
        self._session_group = None

        # Join user-specific group if authenticated BEFORE accept
        user = self.scope.get('user')
        if user and user.is_authenticated:
            # Validate user.id is a safe value for group name
            user_id = user.id
            if isinstance(user_id, int) or (isinstance(user_id, str) and user_id.isalnum()):
                user_group = f'alerts_user_{user_id}'
                await self.channel_layer.group_add(user_group, self.channel_name)
                self._user_group = user_group

        # Join session-specific group for anonymous users BEFORE accept
        session = self.scope.get('session')
        if session and session.session_key:
            # Validate session_key is safe for group name (Django session keys are alphanumeric)
            session_key = session.session_key
            if session_key and session_key.isalnum():
                session_group = f'alerts_session_{session_key}'
                await self.channel_layer.group_add(session_group, self.channel_name)
                self._session_group = session_group

        # Now call parent connect which will accept() the connection
        await super().connect()

    async def disconnect(self, close_code):
        """Handle WebSocket disconnect."""
        # Leave user-specific group
        if hasattr(self, '_user_group') and self._user_group:
            await self.channel_layer.group_discard(self._user_group, self.channel_name)

        # Leave session-specific group
        if hasattr(self, '_session_group') and self._session_group:
            await self.channel_layer.group_discard(self._session_group, self.channel_name)

        await super().disconnect(close_code)

    async def send_initial_state(self):
        """Send recent alerts on connect, filtered by user access."""
        alerts = await self.get_recent_alerts()

        await self.send_json({
            'type': 'alert:snapshot',
            'data': {
                'alerts': alerts,
                'count': len(alerts),
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
        })

    def _safe_int(self, value, default: int, min_val: int = None, max_val: int = None) -> int:
        """Safely parse an integer parameter with bounds checking."""
        try:
            result = int(value) if value is not None else default
        except (ValueError, TypeError):
            result = default
        if min_val is not None and result < min_val:
            result = min_val
        if max_val is not None and result > max_val:
            result = max_val
        return result

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response messages."""
        if request_type == 'alerts':
            # Return recent alerts
            hours = self._safe_int(params.get('hours'), 24, min_val=1, max_val=720)
            limit = self._safe_int(params.get('limit'), 50, min_val=1, max_val=200)
            alerts = await self.get_alerts_history(hours, limit)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'alerts',
                'data': alerts
            })

        elif request_type == 'alert-rules':
            # Return active alert rules (filtered by visibility)
            rules = await self.get_alert_rules()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'alert-rules',
                'data': rules
            })

        elif request_type == 'alert-stats':
            # Return alert statistics
            stats = await self.get_alert_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'alert-stats',
                'data': stats
            })

        elif request_type == 'my-subscriptions':
            # Return user's subscriptions
            subscriptions = await self.get_subscriptions()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'my-subscriptions',
                'data': subscriptions
            })

        elif request_type == 'alert-count':
            # Return count of unacknowledged alerts
            acknowledged = params.get('acknowledged', False)
            count = await self.get_alert_count(acknowledged)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'alert-count',
                'data': count
            })

        elif request_type == 'acknowledge-alert':
            # Acknowledge a single alert
            alert_id = params.get('id') or params.get('alert_id')
            if alert_id:
                result = await self.acknowledge_alert(alert_id)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'acknowledge-alert',
                    'data': result
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing alert id parameter'
                })

        elif request_type == 'acknowledge-all-alerts':
            # Acknowledge all unacknowledged alerts
            result = await self.acknowledge_all_alerts()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'acknowledge-all-alerts',
                'data': result
            })

        else:
            await super().handle_request(request_type, request_id, params)

    @database_sync_to_async
    def get_recent_alerts(self):
        """Get recent triggered alerts visible to user."""
        from django.db.models import Q

        cutoff = timezone.now() - timedelta(hours=1)

        queryset = AlertHistory.objects.filter(
            triggered_at__gte=cutoff
        ).select_related('rule')

        # Filter by user access
        user = self.scope.get('user')
        if user and user.is_authenticated:
            if not user.is_superuser:
                # Get user's subscribed rules
                subscribed_rule_ids = AlertSubscription.objects.filter(
                    user=user
                ).values_list('rule_id', flat=True)

                queryset = queryset.filter(
                    Q(user=user) |
                    Q(rule__owner=user) |
                    Q(rule_id__in=subscribed_rule_ids) |
                    Q(rule__visibility='public')
                )
        else:
            # Anonymous users only see public alerts
            queryset = queryset.filter(rule__visibility='public')

        alerts = queryset.order_by('-triggered_at')[:20]
        return [self._serialize_alert(alert) for alert in alerts]

    @database_sync_to_async
    def get_alerts_history(self, hours: int, limit: int):
        """Get alert history visible to user."""
        from django.db.models import Q

        cutoff = timezone.now() - timedelta(hours=hours)

        queryset = AlertHistory.objects.filter(
            triggered_at__gte=cutoff
        ).select_related('rule')

        # Filter by user access
        user = self.scope.get('user')
        if user and user.is_authenticated:
            if not user.is_superuser:
                subscribed_rule_ids = AlertSubscription.objects.filter(
                    user=user
                ).values_list('rule_id', flat=True)

                queryset = queryset.filter(
                    Q(user=user) |
                    Q(rule__owner=user) |
                    Q(rule_id__in=subscribed_rule_ids) |
                    Q(rule__visibility='public')
                )
        else:
            queryset = queryset.filter(rule__visibility='public')

        alerts = queryset.order_by('-triggered_at')[:limit]
        return [self._serialize_alert(alert) for alert in alerts]

    @database_sync_to_async
    def get_alert_rules(self):
        """Get active alert rules visible to user."""
        from django.db.models import Q

        # Use select_related to prevent N+1 queries when accessing rule.owner_id
        queryset = AlertRule.objects.filter(enabled=True).select_related('owner')

        user = self.scope.get('user')
        if user and user.is_authenticated:
            if not user.is_superuser:
                subscribed_rule_ids = list(AlertSubscription.objects.filter(
                    user=user
                ).values_list('rule_id', flat=True))

                queryset = queryset.filter(
                    Q(owner=user) |
                    Q(visibility='public') |
                    Q(visibility='shared', id__in=subscribed_rule_ids)
                )
        else:
            queryset = queryset.filter(visibility='public')

        rules = queryset.order_by('name')

        return [{
            'id': rule.id,
            'name': rule.name,
            'rule_type': rule.rule_type,
            'operator': rule.operator,
            'value': rule.value,
            'priority': rule.priority,
            'enabled': rule.enabled,
            'visibility': rule.visibility,
            'is_system': rule.is_system,
            'cooldown_minutes': rule.cooldown_minutes,
            'last_triggered': rule.last_triggered.isoformat() if rule.last_triggered else None,
            'is_owner': rule.owner_id == user.id if user and user.is_authenticated else False,
        } for rule in rules]

    @database_sync_to_async
    def get_alert_stats(self):
        """Get alert statistics."""
        from django.db.models import Count, Q

        cutoff_24h = timezone.now() - timedelta(hours=24)
        cutoff_1h = timezone.now() - timedelta(hours=1)

        user = self.scope.get('user')

        # Build base queryset
        if user and user.is_authenticated:
            if user.is_superuser:
                history_qs = AlertHistory.objects
                rules_qs = AlertRule.objects
            else:
                subscribed_rule_ids = list(AlertSubscription.objects.filter(
                    user=user
                ).values_list('rule_id', flat=True))

                history_qs = AlertHistory.objects.filter(
                    Q(user=user) |
                    Q(rule__owner=user) |
                    Q(rule_id__in=subscribed_rule_ids) |
                    Q(rule__visibility='public')
                )
                rules_qs = AlertRule.objects.filter(
                    Q(owner=user) |
                    Q(visibility='public') |
                    Q(visibility='shared', id__in=subscribed_rule_ids)
                )
        else:
            history_qs = AlertHistory.objects.filter(rule__visibility='public')
            rules_qs = AlertRule.objects.filter(visibility='public')

        total_rules = rules_qs.count()
        active_rules = rules_qs.filter(enabled=True).count()
        alerts_24h = history_qs.filter(triggered_at__gte=cutoff_24h).count()
        alerts_1h = history_qs.filter(triggered_at__gte=cutoff_1h).count()

        # By rule
        by_rule = list(history_qs.filter(
            triggered_at__gte=cutoff_24h
        ).values('rule__name').annotate(count=Count('id')).order_by('-count')[:10])

        # By priority
        by_priority = dict(history_qs.filter(
            triggered_at__gte=cutoff_24h
        ).values('priority').annotate(count=Count('id')))

        return {
            'total_rules': total_rules,
            'active_rules': active_rules,
            'alerts_last_hour': alerts_1h,
            'alerts_last_24h': alerts_24h,
            'by_rule': by_rule,
            'by_priority': by_priority,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_subscriptions(self):
        """Get user's alert subscriptions."""
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            return []

        subscriptions = AlertSubscription.objects.filter(
            user=user
        ).select_related('rule')

        return [{
            'id': sub.id,
            'rule_id': sub.rule_id,
            'rule_name': sub.rule.name,
            'rule_priority': sub.rule.priority,
            'notify_on_trigger': sub.notify_on_trigger,
            'created_at': sub.created_at.isoformat() if sub.created_at else None,
        } for sub in subscriptions]

    @database_sync_to_async
    def get_alert_count(self, acknowledged=False):
        """Get count of alerts."""
        from django.db.models import Q

        user = self.scope.get('user')

        # Build base queryset
        if user and user.is_authenticated:
            if user.is_superuser:
                qs = AlertHistory.objects
            else:
                subscribed_rule_ids = list(AlertSubscription.objects.filter(
                    user=user
                ).values_list('rule_id', flat=True))
                qs = AlertHistory.objects.filter(
                    Q(user=user) |
                    Q(rule__owner=user) |
                    Q(rule_id__in=subscribed_rule_ids) |
                    Q(rule__visibility='public')
                )
        else:
            qs = AlertHistory.objects.filter(rule__visibility='public')

        # Filter by acknowledged status
        qs = qs.filter(acknowledged=acknowledged)

        return {
            'count': qs.count(),
            'acknowledged': acknowledged,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def acknowledge_alert(self, alert_id):
        """Acknowledge a single alert."""
        try:
            alert = AlertHistory.objects.get(id=alert_id)
            alert.acknowledged = True
            alert.acknowledged_at = timezone.now()
            alert.save()
            return {'success': True, 'alert_id': alert_id}
        except AlertHistory.DoesNotExist:
            return {'success': False, 'error': 'Alert not found'}

    @database_sync_to_async
    def acknowledge_all_alerts(self):
        """Acknowledge all unacknowledged alerts for the user."""
        from django.db.models import Q

        user = self.scope.get('user')

        # Build queryset for user's visible alerts
        if user and user.is_authenticated:
            if user.is_superuser:
                qs = AlertHistory.objects.filter(acknowledged=False)
            else:
                subscribed_rule_ids = list(AlertSubscription.objects.filter(
                    user=user
                ).values_list('rule_id', flat=True))
                qs = AlertHistory.objects.filter(
                    acknowledged=False
                ).filter(
                    Q(user=user) |
                    Q(rule__owner=user) |
                    Q(rule_id__in=subscribed_rule_ids) |
                    Q(rule__visibility='public')
                )
        else:
            qs = AlertHistory.objects.filter(acknowledged=False, rule__visibility='public')

        count = qs.count()
        qs.update(acknowledged=True, acknowledged_at=timezone.now())

        return {
            'success': True,
            'acknowledged_count': count,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    def _serialize_alert(self, alert):
        """Serialize an alert history entry."""
        return {
            'id': alert.id,
            'rule_id': alert.rule_id,
            'rule_name': alert.rule.name if alert.rule else alert.rule_name,
            'icao_hex': alert.icao_hex,
            'callsign': alert.callsign,
            'message': alert.message,
            'priority': alert.rule.priority if alert.rule else alert.priority,
            'visibility': alert.rule.visibility if alert.rule else 'public',
            'aircraft_data': alert.aircraft_data,
            'triggered_at': alert.triggered_at.isoformat() if alert.triggered_at else None,
            'acknowledged': alert.acknowledged,
            'acknowledged_at': alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        }

    # Channel layer message handlers

    async def alert_triggered(self, event):
        """Handle alert triggered broadcast."""
        await self.send_json({
            'type': 'alert:triggered',
            'data': event['data']
        })

    async def alert_snapshot(self, event):
        """Handle alert snapshot broadcast."""
        await self.send_json({
            'type': 'alert:snapshot',
            'data': event['data']
        })

    async def alert_acknowledged(self, event):
        """Handle alert acknowledged broadcast."""
        await self.send_json({
            'type': 'alert:acknowledged',
            'data': event['data']
        })
