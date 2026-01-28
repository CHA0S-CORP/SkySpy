"""
Alert-related serializers for rules, subscriptions, and history.
"""
import re
from rest_framework import serializers
from skyspy.models import AlertRule, AlertHistory, AlertSubscription, AlertAggregate, NotificationChannel


class ConditionSerializer(serializers.Serializer):
    """Single condition in an alert rule."""

    type = serializers.CharField(
        help_text="Condition type (icao, callsign, squawk, altitude, distance, type, military)"
    )
    operator = serializers.CharField(
        default='eq',
        help_text="Comparison operator (eq, ne, lt, gt, le, ge, contains, startswith)"
    )
    value = serializers.CharField(help_text="Value to compare against")


class ConditionGroupSerializer(serializers.Serializer):
    """Group of conditions with AND/OR logic."""

    logic = serializers.CharField(default='AND', help_text="Logic operator (AND, OR)")
    conditions = ConditionSerializer(many=True, help_text="List of conditions")


class ComplexConditionsSerializer(serializers.Serializer):
    """Complex conditions with multiple groups."""

    logic = serializers.CharField(default='AND', help_text="Logic between groups (AND, OR)")
    groups = ConditionGroupSerializer(many=True, help_text="Condition groups")


class SuppressionWindowSerializer(serializers.Serializer):
    """A time window when alerts are suppressed."""

    day = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Day of week (monday, tuesday, etc.) or empty for all days"
    )
    start = serializers.CharField(help_text="Start time in HH:MM format")
    end = serializers.CharField(help_text="End time in HH:MM format")

    def validate(self, attrs):
        """Validate start and end are valid HH:MM format and start < end."""
        time_pattern = re.compile(r'^([01]\d|2[0-3]):([0-5]\d)$')

        start = attrs.get('start', '')
        end = attrs.get('end', '')

        if not time_pattern.match(start):
            raise serializers.ValidationError({'start': 'Must be in HH:MM format (00:00 - 23:59)'})
        if not time_pattern.match(end):
            raise serializers.ValidationError({'end': 'Must be in HH:MM format (00:00 - 23:59)'})

        if start >= end:
            raise serializers.ValidationError({'end': 'End time must be after start time'})

        return attrs


VALID_OPERATORS = ['eq', 'neq', 'ne', 'lt', 'le', 'gt', 'ge', 'contains', 'startswith', 'endswith', 'regex', 'in']


class AlertRuleCreateSerializer(serializers.Serializer):
    """Request body for creating an alert rule."""

    name = serializers.CharField(max_length=100, help_text="Alert rule name")
    type = serializers.CharField(
        source='rule_type',
        required=False,
        allow_null=True,
        max_length=30,
        help_text="Simple rule type"
    )
    operator = serializers.ChoiceField(
        choices=[(op, op) for op in VALID_OPERATORS],
        default='eq',
        help_text="Comparison operator"
    )
    value = serializers.CharField(
        max_length=100,
        required=False,
        allow_null=True,
        help_text="Comparison value"
    )
    conditions = ComplexConditionsSerializer(
        required=False,
        allow_null=True,
        help_text="Complex conditions"
    )
    description = serializers.CharField(
        max_length=200,
        required=False,
        default='',
        help_text="Rule description"
    )
    enabled = serializers.BooleanField(default=True, help_text="Rule enabled status")
    priority = serializers.ChoiceField(
        choices=['info', 'warning', 'critical'],
        default='info',
        help_text="Alert priority"
    )
    starts_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Rule activation time"
    )
    expires_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Rule expiration time"
    )
    api_url = serializers.CharField(
        max_length=500,
        required=False,
        allow_null=True,
        help_text="External API to fetch when triggered"
    )
    cooldown_minutes = serializers.IntegerField(
        default=5,
        min_value=0,
        max_value=1440,
        help_text="Cooldown in minutes before rule can trigger again for same aircraft"
    )
    visibility = serializers.ChoiceField(
        choices=['private', 'shared', 'public'],
        default='private',
        help_text="Who can see this rule"
    )
    suppression_windows = SuppressionWindowSerializer(
        many=True,
        required=False,
        default=list,
        help_text="Time windows when rule should not trigger"
    )
    notification_channel_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
        help_text="IDs of notification channels to use for this rule"
    )
    use_global_notifications = serializers.BooleanField(
        default=True,
        help_text="Also send to global notification URLs from environment"
    )

    def validate(self, attrs):
        """Validate expires_at > starts_at if both provided."""
        starts_at = attrs.get('starts_at')
        expires_at = attrs.get('expires_at')

        if starts_at and expires_at and expires_at <= starts_at:
            raise serializers.ValidationError({'expires_at': 'Expiration time must be after start time'})

        return attrs

    def create(self, validated_data):
        """Create a new alert rule."""
        # Extract notification channel IDs
        channel_ids = validated_data.pop('notification_channel_ids', [])

        # Convert complex conditions to JSON if present
        conditions = validated_data.pop('conditions', None)
        if conditions:
            validated_data['conditions'] = conditions

        rule = AlertRule.objects.create(**validated_data)

        # Add notification channels
        if channel_ids:
            channels = NotificationChannel.objects.filter(id__in=channel_ids)
            rule.notification_channels.set(channels)

        return rule


class AlertRuleUpdateSerializer(serializers.Serializer):
    """Request body for updating an alert rule."""

    name = serializers.CharField(
        max_length=100,
        required=False,
        help_text="Rule name"
    )
    operator = serializers.CharField(
        max_length=10,
        required=False,
        help_text="Comparison operator"
    )
    value = serializers.CharField(
        max_length=100,
        required=False,
        allow_null=True,
        help_text="Comparison value"
    )
    conditions = serializers.JSONField(
        required=False,
        allow_null=True,
        help_text="Complex conditions"
    )
    description = serializers.CharField(
        max_length=200,
        required=False,
        help_text="Rule description"
    )
    enabled = serializers.BooleanField(required=False, help_text="Enabled status")
    priority = serializers.ChoiceField(
        choices=['info', 'warning', 'critical'],
        required=False,
        help_text="Priority level"
    )
    starts_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Activation time"
    )
    expires_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        help_text="Expiration time"
    )
    api_url = serializers.CharField(
        max_length=500,
        required=False,
        allow_null=True,
        help_text="External API URL"
    )
    cooldown_minutes = serializers.IntegerField(
        required=False,
        min_value=0,
        max_value=1440,
        help_text="Cooldown in minutes"
    )
    visibility = serializers.ChoiceField(
        choices=['private', 'shared', 'public'],
        required=False,
        help_text="Rule visibility"
    )
    suppression_windows = serializers.JSONField(
        required=False,
        help_text="Suppression time windows"
    )
    notification_channel_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        help_text="IDs of notification channels to use for this rule"
    )
    use_global_notifications = serializers.BooleanField(
        required=False,
        help_text="Also send to global notification URLs from environment"
    )

    def update(self, instance, validated_data):
        """Update an existing alert rule."""
        # Handle notification channels separately
        channel_ids = validated_data.pop('notification_channel_ids', None)

        # Explicit field whitelist - excludes owner, is_system
        allowed_fields = {
            'name', 'operator', 'value', 'conditions', 'description', 'enabled',
            'priority', 'starts_at', 'expires_at', 'api_url', 'cooldown_minutes',
            'visibility', 'suppression_windows', 'use_global_notifications'
        }
        for field in allowed_fields:
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        instance.save()

        # Update notification channels if provided
        if channel_ids is not None:
            channels = NotificationChannel.objects.filter(id__in=channel_ids)
            instance.notification_channels.set(channels)

        return instance


class NotificationChannelMinimalSerializer(serializers.ModelSerializer):
    """Minimal notification channel for embedding in alert rules."""

    class Meta:
        model = NotificationChannel
        fields = ['id', 'name', 'channel_type', 'enabled', 'verified']


class AlertRuleSerializer(serializers.ModelSerializer):
    """Response for alert rule."""

    type = serializers.CharField(source='rule_type', read_only=True)
    is_owner = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    subscriber_count = serializers.SerializerMethodField()
    notification_channels = NotificationChannelMinimalSerializer(many=True, read_only=True)
    notification_channel_ids = serializers.SerializerMethodField()

    class Meta:
        model = AlertRule
        fields = [
            'id', 'name', 'type', 'operator', 'value', 'conditions',
            'description', 'enabled', 'priority', 'starts_at', 'expires_at',
            'api_url', 'cooldown_minutes', 'last_triggered', 'visibility',
            'is_system', 'suppression_windows', 'owner_id',
            'notification_channels', 'notification_channel_ids', 'use_global_notifications',
            'is_owner', 'can_edit', 'can_delete', 'subscriber_count',
            'created_at', 'updated_at'
        ]

    def get_is_owner(self, obj) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.owner_id == request.user.id
        return False

    def get_can_edit(self, obj) -> bool:
        request = self.context.get('request')
        if request:
            return obj.can_be_edited_by(request.user)
        return False

    def get_can_delete(self, obj) -> bool:
        request = self.context.get('request')
        if request:
            return obj.can_be_deleted_by(request.user)
        return False

    def get_subscriber_count(self, obj) -> int:
        return obj.subscriptions.count()

    def get_notification_channel_ids(self, obj) -> list:
        return list(obj.notification_channels.values_list('id', flat=True))


class AlertRulesListSerializer(serializers.Serializer):
    """Response containing list of alert rules."""

    rules = AlertRuleSerializer(many=True, help_text="List of alert rules")
    count = serializers.IntegerField(help_text="Number of rules")


class AlertHistorySerializer(serializers.ModelSerializer):
    """Single alert history entry."""

    icao = serializers.CharField(source='icao_hex', read_only=True)
    timestamp = serializers.DateTimeField(source='triggered_at', read_only=True)
    acknowledged_by_username = serializers.SerializerMethodField()

    class Meta:
        model = AlertHistory
        fields = [
            'id', 'rule_id', 'rule_name', 'icao', 'callsign',
            'message', 'priority', 'aircraft_data', 'timestamp',
            'acknowledged', 'acknowledged_by', 'acknowledged_by_username',
            'acknowledged_at', 'user_id'
        ]

    def get_acknowledged_by_username(self, obj) -> str:
        if obj.acknowledged_by:
            return obj.acknowledged_by.username
        return None


class AlertHistoryListSerializer(serializers.Serializer):
    """Response containing alert history."""

    history = AlertHistorySerializer(many=True, help_text="Alert history entries")
    count = serializers.IntegerField(help_text="Number of entries returned")


class AlertSubscriptionSerializer(serializers.ModelSerializer):
    """Alert subscription."""

    rule_name = serializers.CharField(source='rule.name', read_only=True)
    rule_priority = serializers.CharField(source='rule.priority', read_only=True)

    class Meta:
        model = AlertSubscription
        fields = [
            'id', 'rule_id', 'rule_name', 'rule_priority',
            'notify_on_trigger', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class AlertAggregateSerializer(serializers.ModelSerializer):
    """Aggregated alert statistics."""

    rule_name = serializers.CharField(source='rule.name', read_only=True)

    class Meta:
        model = AlertAggregate
        fields = [
            'id', 'rule_id', 'rule_name', 'window_start', 'window_end',
            'trigger_count', 'unique_aircraft', 'sample_aircraft'
        ]


class AlertRuleTestSerializer(serializers.Serializer):
    """Request for testing a rule against aircraft."""

    rule = serializers.DictField(help_text="Rule configuration to test")
    aircraft = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        help_text="List of aircraft data to test against"
    )


class BulkRuleIdsSerializer(serializers.Serializer):
    """Request for bulk operations on rules."""

    rule_ids = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="List of rule IDs"
    )
    enabled = serializers.BooleanField(
        required=False,
        help_text="For bulk-toggle: new enabled status"
    )
