"""
Alert rules, subscriptions, and history API views.
"""
import logging
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AlertRule, AlertHistory, AlertSubscription, AlertAggregate
from skyspy.serializers.alerts import (
    AlertRuleSerializer,
    AlertRuleCreateSerializer,
    AlertRuleUpdateSerializer,
    AlertHistorySerializer,
    AlertSubscriptionSerializer,
    AlertAggregateSerializer,
    AlertRuleTestSerializer,
    BulkRuleIdsSerializer,
)
from skyspy.services.alerts import alert_service
from skyspy.services.alert_metrics import alert_metrics
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.auth.permissions import CanAccessAlert, IsOwnerOrAdmin

logger = logging.getLogger(__name__)


class AlertRuleViewSet(viewsets.ModelViewSet):
    """ViewSet for alert rule management."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [CanAccessAlert, IsOwnerOrAdmin]

    queryset = AlertRule.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['enabled', 'priority', 'rule_type', 'visibility']

    def get_serializer_class(self):
        if self.action == 'create':
            return AlertRuleCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return AlertRuleUpdateSerializer
        elif self.action in ['test', 'test_rule']:
            return AlertRuleTestSerializer
        elif self.action in ['bulk_create', 'bulk_delete', 'bulk_toggle']:
            return BulkRuleIdsSerializer
        return AlertRuleSerializer

    def get_queryset(self):
        """Filter rules by ownership and visibility."""
        queryset = super().get_queryset()
        user = self.request.user

        # Apply visibility filtering
        if user.is_authenticated:
            if user.is_superuser:
                # Superusers see all rules
                return queryset
            # Check if user has admin role with alerts.manage_all permission
            elif self._user_has_manage_all_permission(user):
                # Admins with manage_all can see all rules
                return queryset
            else:
                # Users see: their own rules + shared + public rules
                return queryset.filter(
                    Q(owner=user) |
                    Q(visibility='public') |
                    Q(visibility='shared')
                ).distinct()
        else:
            # Anonymous users only see public rules
            return queryset.filter(visibility='public')

    def _user_has_manage_all_permission(self, user):
        """Check if user has alerts.manage_all permission or superadmin role."""
        if not user.is_authenticated:
            return False
        # Check if user has admin/superadmin role or explicit permission
        from skyspy.models.auth import UserRole
        user_roles = UserRole.objects.filter(user=user).select_related('role')
        for user_role in user_roles:
            permissions = user_role.role.permissions or []
            role_name = user_role.role.name.lower()
            if 'alerts.manage_all' in permissions or role_name in ('admin', 'superadmin'):
                return True
        return False

    def _user_is_superadmin(self, user):
        """Check if user has superadmin role."""
        if not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        from skyspy.models.auth import UserRole
        return UserRole.objects.filter(user=user, role__name='superadmin').exists()

    def get_object_for_permission_check(self):
        """Get object without queryset filtering for permission checks."""
        pk = self.kwargs.get('pk')
        try:
            return AlertRule.objects.get(pk=pk)
        except AlertRule.DoesNotExist:
            return None

    def update(self, request, *args, **kwargs):
        """Update with proper permission checking (403 vs 404)."""
        partial = kwargs.pop('partial', False)

        # First check if the rule exists at all
        rule = self.get_object_for_permission_check()
        if rule is None:
            return Response(
                {'error': 'Rule not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if user can edit this rule
        if not rule.can_be_edited_by(request.user) and not self._user_has_manage_all_permission(request.user):
            return Response(
                {'error': 'You do not have permission to edit this rule'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Perform the update directly using the rule we already fetched
        # (avoids re-fetching via get_queryset which may filter out the object)
        serializer = self.get_serializer(rule, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if getattr(rule, '_prefetched_objects_cache', None):
            # If 'prefetch_related' has been applied to a queryset, we need to
            # forcibly invalidate the prefetch cache on the instance.
            rule._prefetched_objects_cache = {}

        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        """Delete with proper permission checking (403 vs 404)."""
        # First check if the rule exists at all
        rule = self.get_object_for_permission_check()
        if rule is None:
            return Response(
                {'error': 'Rule not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if user can delete this rule
        # Superadmin role users can delete any rule including system rules
        is_superadmin = self._user_is_superadmin(request.user)
        can_delete = rule.can_be_deleted_by(request.user) or is_superadmin

        if not can_delete:
            return Response(
                {'error': 'You do not have permission to delete this rule'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Use normal destroy flow (skip perform_destroy permission check for superadmin)
        if is_superadmin:
            # Directly delete without checking can_be_deleted_by again
            alert_service.clear_cooldowns_for_rule(rule.id)
            rule.delete()
            alert_service.invalidate_cache()
            return Response(status=status.HTTP_204_NO_CONTENT)

        return super().destroy(request, *args, **kwargs)

    @extend_schema(
        summary="List alert rules",
        responses={200: AlertRuleSerializer(many=True)}
    )
    def list(self, request, *args, **kwargs):
        """List all alert rules (filtered by ownership/visibility)."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = AlertRuleSerializer(queryset, many=True, context={'request': request})
        return Response({
            'rules': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Create alert rule",
        request=AlertRuleCreateSerializer,
        responses={201: AlertRuleSerializer}
    )
    def create(self, request, *args, **kwargs):
        """Create a new alert rule."""
        serializer = AlertRuleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Set owner if user is authenticated
        if request.user.is_authenticated:
            rule = serializer.save(owner=request.user)
        else:
            rule = serializer.save()

        # Invalidate cache
        alert_service.invalidate_cache()

        return Response(
            AlertRuleSerializer(rule).data,
            status=status.HTTP_201_CREATED
        )

    def perform_update(self, serializer):
        """Update and invalidate cache."""
        serializer.save()
        alert_service.invalidate_cache()

    def perform_destroy(self, instance):
        """Check permissions before delete."""
        if not instance.can_be_deleted_by(self.request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Cannot delete this rule")

        # Clear cooldowns for this rule
        alert_service.clear_cooldowns_for_rule(instance.id)
        instance.delete()
        alert_service.invalidate_cache()

    @extend_schema(
        summary="Toggle alert rule",
        description="Enable or disable an alert rule",
        responses={200: AlertRuleSerializer}
    )
    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        """Toggle rule enabled status."""
        rule = self.get_object()
        rule.enabled = not rule.enabled
        rule.save()
        alert_service.invalidate_cache()
        return Response(AlertRuleSerializer(rule).data)

    @extend_schema(
        summary="Get user's own rules",
        responses={200: AlertRuleSerializer(many=True)}
    )
    @action(detail=False, methods=['get'], url_path='my-rules')
    def my_rules(self, request):
        """Get rules owned by the current user."""
        if not request.user.is_authenticated:
            return Response({'rules': [], 'count': 0})

        queryset = AlertRule.objects.filter(owner=request.user)
        serializer = AlertRuleSerializer(queryset, many=True, context={'request': request})
        return Response({
            'rules': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Get shared rules for subscription",
        responses={200: AlertRuleSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def shared(self, request):
        """Get shared rules available for subscription."""
        queryset = AlertRule.objects.filter(
            visibility__in=['shared', 'public'],
            enabled=True
        ).exclude(owner=request.user if request.user.is_authenticated else None)

        serializer = AlertRuleSerializer(queryset, many=True, context={'request': request})
        return Response({
            'rules': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Test a rule against sample aircraft",
        request=AlertRuleTestSerializer,
        responses={200: dict}
    )
    @action(detail=False, methods=['post'])
    def test(self, request):
        """Test a rule configuration against sample aircraft data."""
        rule_data = request.data.get('rule', {})
        sample_aircraft = request.data.get('aircraft', [])

        # If no aircraft provided, could fetch current live aircraft
        if not sample_aircraft:
            return Response({
                'would_match': 0,
                'matched_aircraft': [],
                'rule_valid': True,
                'aircraft_tested': 0,
                'message': 'No aircraft data provided for testing'
            })

        result = alert_service.test_rule_against_aircraft(rule_data, sample_aircraft)
        return Response(result)

    @extend_schema(
        summary="Test an existing rule against sample aircraft",
        request=AlertRuleTestSerializer,
        responses={200: dict}
    )
    @action(detail=True, methods=['post'], url_path='test')
    def test_rule(self, request, pk=None):
        """Test an existing rule against sample aircraft data."""
        rule = self.get_object()
        aircraft_data = request.data.get('aircraft', {})
        trigger_notifications = request.data.get('trigger_notifications', False)

        # Normalize aircraft data to list
        if isinstance(aircraft_data, dict):
            aircraft_list = [aircraft_data]
        else:
            aircraft_list = aircraft_data

        # Check if rule is currently active (scheduling)
        from django.utils import timezone
        now = timezone.now()
        is_active = True
        active_reason = None

        if rule.starts_at and now < rule.starts_at:
            is_active = False
            active_reason = 'not_started'

        if rule.expires_at and now > rule.expires_at:
            is_active = False
            active_reason = 'expired'

        # Check cooldown
        cooldown_active = False
        if rule.cooldown_minutes and rule.last_triggered:
            cooldown_end = rule.last_triggered + timedelta(minutes=rule.cooldown_minutes)
            if now < cooldown_end:
                cooldown_active = True

        # Build rule data from the model
        rule_data = {
            'type': rule.rule_type,
            'operator': rule.operator,
            'value': rule.value,
            'conditions': rule.conditions,
        }

        # Test against aircraft
        match = False
        if aircraft_list:
            result = alert_service.test_rule_against_aircraft(rule_data, aircraft_list)
            match = result.get('would_match', 0) > 0 or result.get('match', False)
        else:
            result = {'would_match': 0, 'matched_aircraft': []}

        return Response({
            'match': match and is_active and not cooldown_active,
            'active': is_active,
            'active_reason': active_reason,
            'cooldown_active': cooldown_active,
            'rule': {
                'id': rule.id,
                'name': rule.name,
                'enabled': rule.enabled,
                'type': rule.rule_type,
                'operator': rule.operator,
                'value': rule.value,
            },
            'aircraft': aircraft_data,
            'result': result,
        })

    @extend_schema(
        summary="Get alert service status and metrics",
        responses={200: dict}
    )
    @action(detail=False, methods=['get'])
    def metrics(self, request):
        """Get alert service metrics."""
        return Response({
            'service_status': alert_service.get_status(),
            'metrics_summary': alert_metrics.get_summary(),
            'rule_metrics': alert_metrics.get_rule_metrics(limit=20),
            'timing_histogram': alert_metrics.get_timing_histogram(),
        })

    # Bulk operations

    @extend_schema(
        summary="Bulk create rules",
        request=AlertRuleCreateSerializer(many=True),
        responses={201: dict}
    )
    @action(detail=False, methods=['post'], url_path='bulk_create')
    def bulk_create(self, request):
        """Create multiple rules at once (up to 100)."""
        rules_data = request.data.get('rules', [])

        if len(rules_data) > 100:
            return Response(
                {'error': 'Maximum 100 rules per request'},
                status=status.HTTP_400_BAD_REQUEST
            )

        created = []
        errors = []

        for i, rule_data in enumerate(rules_data):
            serializer = AlertRuleCreateSerializer(data=rule_data)
            if serializer.is_valid():
                if request.user.is_authenticated:
                    rule = serializer.save(owner=request.user)
                else:
                    rule = serializer.save()
                created.append(AlertRuleSerializer(rule).data)
            else:
                errors.append({'index': i, 'errors': serializer.errors})

        if created:
            alert_service.invalidate_cache()

        return Response({
            'created': len(created),
            'rules': created,
            'errors': errors,
        }, status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST)

    @extend_schema(
        summary="Bulk delete rules",
        request=BulkRuleIdsSerializer,
        responses={200: dict}
    )
    @action(detail=False, methods=['delete', 'post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        """Delete multiple rules by ID."""
        # Support both 'rule_ids' and 'ids' keys
        rule_ids = request.data.get('rule_ids', []) or request.data.get('ids', [])

        if not rule_ids:
            return Response({'error': 'No rule_ids provided'}, status=status.HTTP_400_BAD_REQUEST)

        # Filter to rules user can delete
        queryset = AlertRule.objects.filter(id__in=rule_ids)
        if not request.user.is_superuser:
            queryset = queryset.filter(Q(owner=request.user) | Q(is_system=False))

        deleted_count = 0
        for rule in queryset:
            if rule.can_be_deleted_by(request.user):
                alert_service.clear_cooldowns_for_rule(rule.id)
                rule.delete()
                deleted_count += 1

        if deleted_count:
            alert_service.invalidate_cache()

        return Response({
            'deleted': deleted_count,
            'requested': len(rule_ids),
        })

    @extend_schema(
        summary="Bulk toggle rules",
        request=BulkRuleIdsSerializer,
        responses={200: dict}
    )
    @action(detail=False, methods=['post'], url_path='bulk_toggle')
    def bulk_toggle(self, request):
        """Enable or disable multiple rules."""
        rule_ids = request.data.get('rule_ids', [])
        enabled = request.data.get('enabled', True)

        if not rule_ids:
            return Response({'error': 'No rule_ids provided'}, status=status.HTTP_400_BAD_REQUEST)

        # Filter to rules user can edit
        queryset = AlertRule.objects.filter(id__in=rule_ids)
        if not request.user.is_superuser:
            queryset = queryset.filter(owner=request.user)

        updated = queryset.update(enabled=enabled)

        if updated:
            alert_service.invalidate_cache()

        return Response({
            'updated': updated,
            'requested': len(rule_ids),
            'enabled': enabled,
        })

    @extend_schema(
        summary="Export all rules as JSON",
        responses={200: dict}
    )
    @action(detail=False, methods=['get'])
    def export(self, request):
        """Export all user's rules as JSON."""
        if request.user.is_authenticated:
            queryset = AlertRule.objects.filter(owner=request.user)
        else:
            queryset = AlertRule.objects.filter(visibility='public')

        serializer = AlertRuleSerializer(queryset, many=True)
        return Response({
            'rules': serializer.data,
            'count': queryset.count(),
            'exported_at': timezone.now().isoformat(),
        })

    @extend_schema(
        summary="Import rules from JSON",
        responses={201: dict}
    )
    @action(detail=False, methods=['post'], url_path='import')
    def import_rules(self, request):
        """Import rules from JSON (optionally replace all existing)."""
        rules_data = request.data.get('rules', [])
        replace_all = request.data.get('replace_all', False)

        if replace_all and request.user.is_authenticated:
            # Delete user's existing rules (except system rules)
            AlertRule.objects.filter(owner=request.user, is_system=False).delete()

        created = []
        errors = []

        for i, rule_data in enumerate(rules_data):
            # Remove fields that shouldn't be imported
            rule_data.pop('id', None)
            rule_data.pop('created_at', None)
            rule_data.pop('updated_at', None)
            rule_data.pop('last_triggered', None)

            serializer = AlertRuleCreateSerializer(data=rule_data)
            if serializer.is_valid():
                if request.user.is_authenticated:
                    rule = serializer.save(owner=request.user)
                else:
                    rule = serializer.save()
                created.append(AlertRuleSerializer(rule).data)
            else:
                errors.append({'index': i, 'errors': serializer.errors})

        if created:
            alert_service.invalidate_cache()

        return Response({
            'imported': len(created),
            'rules': created,
            'errors': errors,
            'replaced_all': replace_all,
        }, status=status.HTTP_201_CREATED)


class AlertSubscriptionViewSet(viewsets.ModelViewSet):
    """ViewSet for alert rule subscriptions.

    Routes:
    - GET /api/v1/alerts/subscriptions/ - List user's subscriptions
    - POST /api/v1/alerts/subscriptions/ - Subscribe to a rule (with rule_id in body)
    - DELETE /api/v1/alerts/subscriptions/{rule_id}/ - Unsubscribe from a rule
    """

    queryset = AlertSubscription.objects.all()
    serializer_class = AlertSubscriptionSerializer
    # Use rule_id as the lookup field for DELETE
    lookup_field = 'rule_id'

    def get_queryset(self):
        """Filter subscriptions to current user."""
        if self.request.user.is_authenticated:
            return AlertSubscription.objects.filter(user=self.request.user).select_related('rule')
        return AlertSubscription.objects.none()

    @extend_schema(
        summary="List user's subscriptions",
        responses={200: AlertSubscriptionSerializer(many=True)}
    )
    def list(self, request, *args, **kwargs):
        """List all subscriptions for the current user."""
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'subscriptions': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Subscribe to a rule",
        responses={201: AlertSubscriptionSerializer}
    )
    def create(self, request, *args, **kwargs):
        """Subscribe to a shared/public rule."""
        rule_id = request.data.get('rule_id')
        notify = request.data.get('notify_on_trigger', True)

        if not rule_id:
            return Response(
                {'error': 'rule_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            rule = AlertRule.objects.get(id=rule_id)
        except AlertRule.DoesNotExist:
            return Response(
                {'error': 'Rule not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if rule is subscribable
        if rule.visibility == 'private' and rule.owner != request.user:
            return Response(
                {'error': 'Cannot subscribe to private rule'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Check if user is authenticated
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        subscription, created = AlertSubscription.objects.get_or_create(
            rule=rule,
            user=request.user,
            defaults={'notify_on_trigger': notify}
        )

        if not created:
            # Already subscribed, update notify preference
            subscription.notify_on_trigger = notify
            subscription.save()

        return Response(
            AlertSubscriptionSerializer(subscription).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )

    @extend_schema(
        summary="Unsubscribe from a rule",
        responses={204: None}
    )
    def destroy(self, request, *args, **kwargs):
        """Unsubscribe from a rule by rule_id."""
        rule_id = kwargs.get('rule_id')

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        try:
            subscription = AlertSubscription.objects.get(
                rule_id=rule_id,
                user=request.user
            )
            subscription.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except AlertSubscription.DoesNotExist:
            return Response(
                {'error': 'Subscription not found'},
                status=status.HTTP_404_NOT_FOUND
            )

    @extend_schema(
        summary="Subscribe to a rule (alternative endpoint)",
        responses={201: AlertSubscriptionSerializer}
    )
    @action(detail=False, methods=['post'])
    def subscribe(self, request):
        """Subscribe to a shared/public rule."""
        return self.create(request)

    @extend_schema(
        summary="Unsubscribe from a rule (alternative endpoint)",
        responses={200: dict}
    )
    @action(detail=False, methods=['post'])
    def unsubscribe(self, request):
        """Unsubscribe from a rule."""
        rule_id = request.data.get('rule_id')

        if not rule_id:
            return Response(
                {'error': 'rule_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        deleted, _ = AlertSubscription.objects.filter(
            rule_id=rule_id,
            user=request.user
        ).delete()

        return Response({
            'unsubscribed': deleted > 0,
            'rule_id': rule_id,
        })


class AlertHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for alert history."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [CanAccessAlert]

    queryset = AlertHistory.objects.all()
    serializer_class = AlertHistorySerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['rule_id', 'icao_hex', 'priority', 'acknowledged']

    def get_queryset(self):
        """Filter history by ownership and time range."""
        queryset = super().get_queryset()
        user = self.request.user

        # Time range filter
        hours = self.request.query_params.get('hours', 24)
        try:
            hours = int(hours)
        except ValueError:
            hours = 24

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = queryset.filter(triggered_at__gte=cutoff)

        # Ownership filter
        if user.is_authenticated and not user.is_superuser:
            # User sees alerts from their rules or subscribed rules
            subscribed_rule_ids = AlertSubscription.objects.filter(
                user=user
            ).values_list('rule_id', flat=True)

            queryset = queryset.filter(
                Q(user=user) |
                Q(rule__owner=user) |
                Q(rule_id__in=subscribed_rule_ids) |
                Q(rule__visibility='public')
            )
        elif not user.is_authenticated:
            # Anonymous users see public alerts only
            queryset = queryset.filter(rule__visibility='public')

        return queryset.order_by('-triggered_at')

    @extend_schema(
        summary="List alert history",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='rule_id', type=int, description='Filter by rule ID'),
            OpenApiParameter(name='icao_hex', type=str, description='Filter by ICAO hex'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List alert history entries."""
        queryset = self.filter_queryset(self.get_queryset())

        # Use pagination
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'history': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Get aggregated alert history",
        responses={200: AlertAggregateSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def aggregated(self, request):
        """Get alert history aggregated by rule and time window."""
        hours = int(request.query_params.get('hours', 24))
        window_minutes = int(request.query_params.get('window_minutes', 60))

        cutoff = timezone.now() - timedelta(hours=hours)
        aggregates = AlertAggregate.objects.filter(
            window_start__gte=cutoff
        ).select_related('rule').order_by('-window_start')

        serializer = AlertAggregateSerializer(aggregates, many=True)
        return Response({
            'aggregates': serializer.data,
            'count': aggregates.count(),
        })

    @extend_schema(
        summary="Acknowledge an alert",
        responses={200: AlertHistorySerializer}
    )
    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        """Mark an alert as acknowledged."""
        alert = self.get_object()

        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        alert.acknowledge(request.user)
        return Response(AlertHistorySerializer(alert).data)

    @extend_schema(
        summary="Acknowledge all unacknowledged alerts",
        responses={200: dict}
    )
    @action(detail=False, methods=['post'], url_path='acknowledge-all')
    def acknowledge_all(self, request):
        """Acknowledge all unacknowledged alerts visible to user."""
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        queryset = self.get_queryset().filter(acknowledged=False)
        updated = queryset.update(
            acknowledged=True,
            acknowledged_by=request.user,
            acknowledged_at=timezone.now()
        )

        return Response({
            'acknowledged': updated,
        })

    @extend_schema(
        summary="Clear alert history",
        description="Delete all alert history entries",
        responses={200: None}
    )
    @action(detail=False, methods=['delete'])
    def clear(self, request):
        """Clear all alert history (admin only or own alerts)."""
        if request.user.is_superuser:
            count = AlertHistory.objects.count()
            AlertHistory.objects.all().delete()
        elif request.user.is_authenticated:
            count = AlertHistory.objects.filter(user=request.user).count()
            AlertHistory.objects.filter(user=request.user).delete()
        else:
            return Response(
                {'error': 'Authentication required'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        return Response({
            'deleted': count,
            'message': f'Deleted {count} alert history entries'
        })
