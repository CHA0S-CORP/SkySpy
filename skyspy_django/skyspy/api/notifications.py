"""
Notification configuration and channel API views.
"""
import logging

from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import NotificationConfig, NotificationLog, NotificationChannel, SkyspyUser
from skyspy.serializers.notifications import (
    NotificationConfigSerializer,
    NotificationConfigUpdateSerializer,
    NotificationLogSerializer,
    NotificationTestSerializer,
    NotificationTestRequestSerializer,
    NotificationChannelSerializer,
    NotificationChannelCreateSerializer,
    NotificationChannelUpdateSerializer,
    NotificationChannelListSerializer,
)

logger = logging.getLogger(__name__)


def _is_admin_user(user) -> bool:
    """Check if user is an admin (superuser or has admin/superadmin role)."""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    # Check for admin role via SkyspyUser profile
    try:
        skyspy_user = SkyspyUser.objects.get(user=user)
        permissions = skyspy_user.get_all_permissions()
        # Admin users have alerts.manage_all permission
        return 'alerts.manage_all' in permissions
    except SkyspyUser.DoesNotExist:
        return False

# Channel type information with URL templates and required fields
CHANNEL_TYPES = [
    {
        'type': 'discord',
        'name': 'Discord',
        'schema': 'discord://',
        'description': 'Send notifications to a Discord channel via webhook',
        'supports_rich': True,
        'url_template': 'discord://{webhook_id}/{webhook_token}',
        'required_fields': ['webhook_id', 'webhook_token'],
    },
    {
        'type': 'slack',
        'name': 'Slack',
        'schema': 'slack://',
        'description': 'Send notifications to a Slack channel',
        'supports_rich': True,
        'url_template': 'slack://{token_a}/{token_b}/{token_c}',
        'required_fields': ['token_a', 'token_b', 'token_c'],
    },
    {
        'type': 'telegram',
        'name': 'Telegram',
        'schema': 'tgram://',
        'description': 'Send notifications via Telegram bot',
        'supports_rich': False,
        'url_template': 'tgram://{bot_token}/{chat_id}',
        'required_fields': ['bot_token', 'chat_id'],
    },
    {
        'type': 'pushover',
        'name': 'Pushover',
        'schema': 'pover://',
        'description': 'Send push notifications via Pushover',
        'supports_rich': False,
        'url_template': 'pover://{user_key}/{api_token}',
        'required_fields': ['user_key', 'api_token'],
    },
    {
        'type': 'email',
        'name': 'Email',
        'schema': 'mailto://',
        'description': 'Send notifications via email',
        'supports_rich': False,
        'url_template': 'mailto://{user}:{password}@{smtp_host}?to={recipient}',
        'required_fields': ['user', 'password', 'smtp_host', 'recipient'],
    },
    {
        'type': 'ntfy',
        'name': 'ntfy',
        'schema': 'ntfy://',
        'description': 'Send notifications via ntfy.sh or self-hosted ntfy',
        'supports_rich': False,
        'url_template': 'ntfy://{topic}',
        'required_fields': ['topic'],
    },
    {
        'type': 'gotify',
        'name': 'Gotify',
        'schema': 'gotify://',
        'description': 'Send notifications via Gotify server',
        'supports_rich': False,
        'url_template': 'gotify://{host}/{token}',
        'required_fields': ['host', 'token'],
    },
    {
        'type': 'home_assistant',
        'name': 'Home Assistant',
        'schema': 'hassio://',
        'description': 'Send notifications to Home Assistant',
        'supports_rich': False,
        'url_template': 'hassio://{host}/{access_token}',
        'required_fields': ['host', 'access_token'],
    },
    {
        'type': 'webhook',
        'name': 'Generic Webhook',
        'schema': 'json://',
        'description': 'Send JSON payload to any webhook URL',
        'supports_rich': False,
        'url_template': 'json://{webhook_url}',
        'required_fields': ['webhook_url'],
    },
    {
        'type': 'twilio',
        'name': 'Twilio SMS',
        'schema': 'twilio://',
        'description': 'Send SMS via Twilio',
        'supports_rich': False,
        'url_template': 'twilio://{account_sid}:{auth_token}@{from_phone}/{to_phone}',
        'required_fields': ['account_sid', 'auth_token', 'from_phone', 'to_phone'],
    },
    {
        'type': 'custom',
        'name': 'Custom Apprise URL',
        'schema': '',
        'description': 'Use any Apprise-compatible URL',
        'supports_rich': False,
        'url_template': '{apprise_url}',
        'required_fields': ['apprise_url'],
    },
]


class NotificationChannelViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing notification channels.

    Notification channels are reusable notification targets (Apprise URLs)
    that can be attached to multiple alert rules.
    """

    queryset = NotificationChannel.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['channel_type', 'enabled', 'is_global', 'verified']

    def get_serializer_class(self):
        if self.action == 'create':
            return NotificationChannelCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return NotificationChannelUpdateSerializer
        elif self.action == 'list':
            return NotificationChannelSerializer
        return NotificationChannelSerializer

    def get_queryset(self):
        """Filter channels by ownership and global status."""
        queryset = super().get_queryset()
        user = self.request.user

        if user.is_authenticated:
            if _is_admin_user(user):
                return queryset
            # Users see: their own channels + global channels
            return queryset.filter(
                Q(owner=user) | Q(is_global=True)
            ).distinct()
        else:
            # Anonymous users only see global channels
            return queryset.filter(is_global=True)

    @extend_schema(
        summary="List notification channels",
        responses={200: NotificationChannelSerializer(many=True)}
    )
    def list(self, request, *args, **kwargs):
        """List all notification channels (filtered by ownership)."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'channels': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Create notification channel",
        request=NotificationChannelCreateSerializer,
        responses={201: NotificationChannelSerializer}
    )
    def create(self, request, *args, **kwargs):
        """Create a new notification channel."""
        serializer = NotificationChannelCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Set owner if user is authenticated
        channel_data = serializer.validated_data
        if request.user.is_authenticated:
            channel_data['owner'] = request.user

        # Non-admins cannot create global channels
        if not _is_admin_user(request.user):
            channel_data['is_global'] = False

        channel = NotificationChannel.objects.create(**channel_data)

        return Response(
            NotificationChannelSerializer(channel).data,
            status=status.HTTP_201_CREATED
        )

    @extend_schema(
        summary="Update notification channel",
        request=NotificationChannelUpdateSerializer,
        responses={200: NotificationChannelSerializer}
    )
    def update(self, request, *args, **kwargs):
        """Update a notification channel."""
        channel = self.get_object()

        # Check permission
        if not self._can_edit(request.user, channel):
            return Response(
                {'error': 'Permission denied'},
                status=status.HTTP_403_FORBIDDEN
            )

        serializer = NotificationChannelUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        # Non-admins cannot make channels global
        if not _is_admin_user(request.user) and serializer.validated_data.get('is_global'):
            serializer.validated_data['is_global'] = False

        serializer.update(channel, serializer.validated_data)

        return Response(NotificationChannelSerializer(channel).data)

    @extend_schema(
        summary="Delete notification channel",
        responses={204: None}
    )
    def destroy(self, request, *args, **kwargs):
        """Delete a notification channel."""
        channel = self.get_object()

        # Check permission
        if not self._can_delete(request.user, channel):
            return Response(
                {'error': 'Permission denied'},
                status=status.HTTP_403_FORBIDDEN
            )

        channel.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _can_edit(self, user, channel) -> bool:
        """Check if user can edit this channel."""
        if not user or not user.is_authenticated:
            return False
        if _is_admin_user(user):
            return True
        return channel.owner_id == user.id

    def _can_delete(self, user, channel) -> bool:
        """Check if user can delete this channel."""
        return self._can_edit(user, channel)

    @extend_schema(
        summary="Test notification channel",
        request=NotificationTestRequestSerializer,
        responses={200: NotificationTestSerializer}
    )
    @action(detail=True, methods=['post'])
    def test(self, request, pk=None):
        """Send a test notification to this channel."""
        channel = self.get_object()

        if not channel.enabled:
            return Response({
                'success': False,
                'message': 'Channel is disabled',
                'servers_notified': 0
            })

        title = request.data.get('title', 'SkysPy Test Notification')
        message = request.data.get('message', 'This is a test notification from SkysPy.')

        try:
            import apprise
            apobj = apprise.Apprise()
            apobj.add(channel.apprise_url)

            result = apobj.notify(
                title=title,
                body=message,
                notify_type=apprise.NotifyType.INFO
            )

            # Update channel status
            if result:
                channel.verified = True
                channel.last_success = timezone.now()
                channel.last_error = None
            else:
                channel.last_failure = timezone.now()
                channel.last_error = 'Notification failed'
            channel.save()

            # Log the notification
            NotificationLog.objects.create(
                notification_type='test',
                message=f'Test notification to {channel.name}',
                channel=channel,
                channel_url=channel.apprise_url,
                status='sent' if result else 'failed',
                details={'success': result, 'channel_id': channel.id}
            )

            return Response({
                'success': result,
                'message': 'Test notification sent' if result else 'Failed to send notification',
                'servers_notified': 1 if result else 0
            })

        except ImportError:
            return Response({
                'success': False,
                'message': 'apprise library not installed',
                'servers_notified': 0
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as e:
            logger.error(f"Failed to send test notification to {channel.name}: {e}")
            channel.last_failure = timezone.now()
            channel.last_error = str(e)
            channel.save()

            return Response({
                'success': False,
                'message': str(e),
                'servers_notified': 0
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @extend_schema(
        summary="Get user's own channels",
        responses={200: NotificationChannelSerializer(many=True)}
    )
    @action(detail=False, methods=['get'], url_path='my-channels')
    def my_channels(self, request):
        """Get channels owned by the current user."""
        if not request.user.is_authenticated:
            return Response({'channels': [], 'count': 0})

        queryset = NotificationChannel.objects.filter(owner=request.user)
        serializer = NotificationChannelSerializer(queryset, many=True)
        return Response({
            'channels': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="List available channel types",
        description="Get information about supported notification channel types"
    )
    @action(detail=False, methods=['get'])
    def types(self, request):
        """List available notification channel types with configuration info."""
        return Response({
            'types': CHANNEL_TYPES,
            'count': len(CHANNEL_TYPES)
        })


class NotificationViewSet(viewsets.ViewSet):
    """ViewSet for global notification configuration."""

    @extend_schema(
        summary="Get notification config",
        responses={200: NotificationConfigSerializer}
    )
    @action(detail=False, methods=['get'])
    def config(self, request):
        """Get notification configuration."""
        config = NotificationConfig.get_config()
        return Response(NotificationConfigSerializer(config).data)

    @extend_schema(
        summary="Update notification config",
        request=NotificationConfigUpdateSerializer,
        responses={200: NotificationConfigSerializer}
    )
    @config.mapping.patch
    def update_config(self, request):
        """Update notification configuration."""
        config = NotificationConfig.get_config()
        serializer = NotificationConfigUpdateSerializer(
            config,
            data=request.data,
            partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(NotificationConfigSerializer(config).data)

    @extend_schema(
        summary="Send test notification (global config)",
        request=NotificationTestRequestSerializer,
        responses={200: NotificationTestSerializer}
    )
    @action(detail=False, methods=['post'])
    def test(self, request):
        """Send a test notification using global config."""
        config = NotificationConfig.get_config()

        if not config.apprise_urls:
            return Response({
                'success': False,
                'message': 'No notification URLs configured',
                'servers_notified': 0
            })

        if not config.enabled:
            return Response({
                'success': False,
                'message': 'Notifications are disabled',
                'servers_notified': 0
            })

        title = request.data.get('title', 'SkysPy Test Notification')
        message = request.data.get('message', 'This is a test notification from SkysPy.')

        try:
            import apprise
            apobj = apprise.Apprise()

            for url in config.apprise_urls.split(';'):
                url = url.strip()
                if url:
                    apobj.add(url)

            result = apobj.notify(
                title=title,
                body=message,
                notify_type=apprise.NotifyType.INFO
            )

            # Log the notification
            NotificationLog.objects.create(
                notification_type='test',
                message='Test notification sent (global config)',
                status='sent' if result else 'failed',
                details={'success': result, 'global': True}
            )

            return Response({
                'success': result,
                'message': 'Test notification sent' if result else 'Failed to send notification',
                'servers_notified': len(apobj) if result else 0
            })

        except ImportError:
            return Response({
                'success': False,
                'message': 'apprise library not installed',
                'servers_notified': 0
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception as e:
            logger.error(f"Failed to send test notification: {e}")
            return Response({
                'success': False,
                'message': str(e),
                'servers_notified': 0
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @extend_schema(
        summary="List available notification services",
        description="Get list of supported notification services (legacy endpoint)"
    )
    @action(detail=False, methods=['get'])
    def services(self, request):
        """List available notification services."""
        services = [
            {'name': ct['name'], 'schema': ct['schema']}
            for ct in CHANNEL_TYPES
        ]
        return Response({'services': services})

    @extend_schema(
        summary="Get notification history",
        parameters=[
            OpenApiParameter(name='limit', type=int, description='Maximum entries to return'),
            OpenApiParameter(name='channel_id', type=int, description='Filter by channel ID'),
            OpenApiParameter(name='status', type=str, description='Filter by status'),
        ],
        responses={200: NotificationLogSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def history(self, request):
        """Get notification history."""
        limit = int(request.query_params.get('limit', 50))
        channel_id = request.query_params.get('channel_id')
        status_filter = request.query_params.get('status')

        queryset = NotificationLog.objects.order_by('-timestamp')

        if channel_id:
            queryset = queryset.filter(channel_id=channel_id)
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        logs = queryset[:limit]
        return Response({
            'history': NotificationLogSerializer(logs, many=True).data,
            'count': logs.count()
        })

    @extend_schema(
        summary="Get notification statistics",
        responses={200: dict}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get notification statistics."""
        from django.db.models import Count
        from datetime import timedelta

        # Stats from last 24 hours
        cutoff = timezone.now() - timedelta(hours=24)

        stats = NotificationLog.objects.filter(
            timestamp__gte=cutoff
        ).aggregate(
            total=Count('id'),
            sent=Count('id', filter=Q(status='sent')),
            failed=Count('id', filter=Q(status='failed')),
            pending=Count('id', filter=Q(status='pending')),
        )

        # By type
        by_type = list(NotificationLog.objects.filter(
            timestamp__gte=cutoff
        ).values('notification_type').annotate(
            count=Count('id')
        ).order_by('-count'))

        # By channel
        by_channel = list(NotificationLog.objects.filter(
            timestamp__gte=cutoff,
            channel__isnull=False
        ).values('channel__name', 'channel_id').annotate(
            count=Count('id')
        ).order_by('-count')[:10])

        return Response({
            'period_hours': 24,
            'totals': stats,
            'by_type': by_type,
            'by_channel': by_channel,
        })
