"""
Notification configuration, channel, and log serializers.
"""
from rest_framework import serializers
from skyspy.models import NotificationConfig, NotificationLog, NotificationChannel


class NotificationChannelSerializer(serializers.ModelSerializer):
    """Full notification channel representation."""

    owner_username = serializers.CharField(source='owner.username', read_only=True)
    alert_rule_count = serializers.SerializerMethodField()

    class Meta:
        model = NotificationChannel
        fields = [
            'id', 'name', 'channel_type', 'apprise_url', 'description',
            'supports_rich', 'is_global', 'owner', 'owner_username',
            'enabled', 'verified', 'last_success', 'last_failure', 'last_error',
            'alert_rule_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'owner', 'owner_username', 'verified',
                           'last_success', 'last_failure', 'last_error',
                           'alert_rule_count', 'created_at', 'updated_at']

    def get_alert_rule_count(self, obj) -> int:
        return obj.alert_rules.count()


class NotificationChannelCreateSerializer(serializers.Serializer):
    """Request body for creating a notification channel."""

    name = serializers.CharField(
        max_length=100,
        help_text="Friendly name for this channel"
    )
    channel_type = serializers.ChoiceField(
        choices=[
            ('discord', 'Discord'),
            ('slack', 'Slack'),
            ('pushover', 'Pushover'),
            ('telegram', 'Telegram'),
            ('email', 'Email'),
            ('webhook', 'Generic Webhook'),
            ('ntfy', 'ntfy'),
            ('gotify', 'Gotify'),
            ('home_assistant', 'Home Assistant'),
            ('twilio', 'Twilio SMS'),
            ('custom', 'Custom Apprise URL'),
        ],
        help_text="Type of notification service"
    )
    apprise_url = serializers.CharField(
        help_text="Apprise-compatible URL for this channel"
    )
    description = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        help_text="Optional description"
    )
    supports_rich = serializers.BooleanField(
        default=False,
        help_text="Whether this channel supports rich formatting"
    )
    is_global = serializers.BooleanField(
        default=False,
        help_text="If true, channel is available to all users"
    )
    enabled = serializers.BooleanField(
        default=True,
        help_text="Whether channel is active"
    )

    def create(self, validated_data):
        # Whitelist only allowed fields - explicitly exclude owner, is_global, verified
        allowed_fields = {'name', 'channel_type', 'apprise_url', 'description', 'supports_rich', 'enabled'}
        safe_data = {k: v for k, v in validated_data.items() if k in allowed_fields}
        return NotificationChannel.objects.create(**safe_data)


class NotificationChannelUpdateSerializer(serializers.Serializer):
    """Request body for updating a notification channel."""

    name = serializers.CharField(
        max_length=100,
        required=False,
        help_text="Friendly name"
    )
    channel_type = serializers.ChoiceField(
        choices=[
            ('discord', 'Discord'),
            ('slack', 'Slack'),
            ('pushover', 'Pushover'),
            ('telegram', 'Telegram'),
            ('email', 'Email'),
            ('webhook', 'Generic Webhook'),
            ('ntfy', 'ntfy'),
            ('gotify', 'Gotify'),
            ('home_assistant', 'Home Assistant'),
            ('twilio', 'Twilio SMS'),
            ('custom', 'Custom Apprise URL'),
        ],
        required=False,
        help_text="Type of notification service"
    )
    apprise_url = serializers.CharField(
        required=False,
        help_text="Apprise-compatible URL"
    )
    description = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Optional description"
    )
    supports_rich = serializers.BooleanField(
        required=False,
        help_text="Whether this channel supports rich formatting"
    )
    is_global = serializers.BooleanField(
        required=False,
        help_text="If true, channel is available to all users"
    )
    enabled = serializers.BooleanField(
        required=False,
        help_text="Whether channel is active"
    )

    def update(self, instance, validated_data):
        # Explicit field whitelist - excludes owner, is_global, verified
        allowed_fields = {'name', 'channel_type', 'apprise_url', 'description', 'supports_rich', 'enabled'}
        for field in allowed_fields:
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        # Reset verification if URL changed
        if 'apprise_url' in validated_data:
            instance.verified = False
        instance.save()
        return instance


class NotificationChannelListSerializer(serializers.Serializer):
    """Minimal channel info for lists and dropdowns."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    channel_type = serializers.CharField()
    enabled = serializers.BooleanField()
    verified = serializers.BooleanField()
    is_global = serializers.BooleanField()


class NotificationConfigSerializer(serializers.ModelSerializer):
    """Notification configuration response."""

    server_count = serializers.SerializerMethodField()

    class Meta:
        model = NotificationConfig
        fields = ['enabled', 'apprise_urls', 'cooldown_seconds', 'server_count']

    def get_server_count(self, obj):
        """Count number of configured notification servers."""
        if obj.apprise_urls:
            return len([u for u in obj.apprise_urls.split(';') if u.strip()])
        return 0


class NotificationConfigUpdateSerializer(serializers.Serializer):
    """Request body for updating notification config."""

    apprise_urls = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Apprise notification URLs (semicolon-separated)"
    )
    cooldown_seconds = serializers.IntegerField(
        required=False,
        min_value=0,
        help_text="Cooldown between notifications"
    )
    enabled = serializers.BooleanField(
        required=False,
        help_text="Enable/disable notifications"
    )

    def update(self, instance, validated_data):
        """Update notification config."""
        # Explicit field whitelist
        allowed_fields = {'apprise_urls', 'cooldown_seconds', 'enabled'}
        for field in allowed_fields:
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        instance.save()
        return instance


class NotificationLogSerializer(serializers.ModelSerializer):
    """Notification log entry."""

    channel_name = serializers.CharField(source='channel.name', read_only=True)

    class Meta:
        model = NotificationLog
        fields = [
            'id', 'timestamp', 'notification_type', 'icao_hex',
            'callsign', 'message', 'details', 'channel', 'channel_name',
            'channel_url', 'status', 'retry_count', 'last_error',
            'sent_at', 'duration_ms'
        ]


class NotificationTestSerializer(serializers.Serializer):
    """Response from test notification."""

    success = serializers.BooleanField(help_text="Whether notification was sent")
    message = serializers.CharField(help_text="Result message")
    servers_notified = serializers.IntegerField(help_text="Number of servers notified")


class NotificationTestRequestSerializer(serializers.Serializer):
    """Request body for testing a notification channel."""

    channel_id = serializers.IntegerField(
        required=False,
        help_text="Channel ID to test (if not provided, tests global config)"
    )
    title = serializers.CharField(
        default="SkysPy Test Notification",
        help_text="Notification title"
    )
    message = serializers.CharField(
        default="This is a test notification from SkysPy.",
        help_text="Notification message"
    )


class NotificationServicesSerializer(serializers.Serializer):
    """Available notification services."""

    services = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of available notification services"
    )


class ChannelTypeInfoSerializer(serializers.Serializer):
    """Information about a notification channel type."""

    type = serializers.CharField()
    name = serializers.CharField()
    schema = serializers.CharField()
    description = serializers.CharField()
    supports_rich = serializers.BooleanField()
    url_template = serializers.CharField(required=False)
    required_fields = serializers.ListField(child=serializers.CharField())
