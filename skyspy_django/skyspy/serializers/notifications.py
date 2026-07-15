"""
Notification configuration, channel, and log serializers.
"""

from urllib.parse import urlsplit

from rest_framework import serializers

from skyspy.models import NotificationChannel, NotificationConfig, NotificationLog

APPRISE_URL_MASK = "****"


def mask_apprise_url(url):
    """Mask credentials/tokens in an Apprise URL for API responses.

    Apprise URLs embed secrets (webhook tokens, SMTP passwords, API keys) in
    the userinfo, path, and query segments. Keep only the scheme and host so
    the channel stays identifiable, and redact everything else. Some schemes
    put a token where the host would be (e.g. ``ntfy://{topic}``,
    ``discord://{webhook_id}/...``), so the host is only kept when it looks
    like a real hostname. Raw values are write-only (accepted via
    create/update serializers, never echoed).
    """
    if not url:
        return url
    try:
        parsed = urlsplit(url)
        if not parsed.scheme:
            return APPRISE_URL_MASK
        host = parsed.hostname or ""
        # Only keep hosts that look like real hostnames - for several apprise
        # schemes the netloc is itself a secret (topic, webhook id, user key)
        if "." not in host and host != "localhost":
            host = ""
        if host and parsed.port:
            host = f"{host}:{parsed.port}"
    except ValueError:
        return APPRISE_URL_MASK
    if not host:
        return f"{parsed.scheme}://{APPRISE_URL_MASK}"
    return f"{parsed.scheme}://{host}/{APPRISE_URL_MASK}"


class NotificationChannelSerializer(serializers.ModelSerializer):
    """Full notification channel representation.

    The Apprise URL is masked on read - raw values are only accepted via the
    create/update serializers and never returned by the API.
    """

    owner_username = serializers.CharField(source="owner.username", read_only=True)
    alert_rule_count = serializers.SerializerMethodField()
    apprise_url = serializers.SerializerMethodField(help_text="Masked Apprise URL (credentials redacted)")

    class Meta:
        model = NotificationChannel
        fields = [
            "id",
            "name",
            "channel_type",
            "apprise_url",
            "description",
            "supports_rich",
            "is_global",
            "owner",
            "owner_username",
            "enabled",
            "verified",
            "last_success",
            "last_failure",
            "last_error",
            "alert_rule_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "owner",
            "owner_username",
            "verified",
            "last_success",
            "last_failure",
            "last_error",
            "alert_rule_count",
            "created_at",
            "updated_at",
        ]

    def get_alert_rule_count(self, obj) -> int:
        # Use annotated count if available (from viewset with .annotate(_alert_rule_count=Count('alert_rules')))
        if hasattr(obj, "_alert_rule_count"):
            return obj._alert_rule_count
        return obj.alert_rules.count()

    def get_apprise_url(self, obj) -> str:
        return mask_apprise_url(obj.apprise_url)


class NotificationChannelCreateSerializer(serializers.Serializer):
    """Request body for creating a notification channel."""

    name = serializers.CharField(max_length=100, help_text="Friendly name for this channel")
    channel_type = serializers.ChoiceField(
        choices=[
            ("discord", "Discord"),
            ("slack", "Slack"),
            ("pushover", "Pushover"),
            ("telegram", "Telegram"),
            ("email", "Email"),
            ("webhook", "Generic Webhook"),
            ("ntfy", "ntfy"),
            ("gotify", "Gotify"),
            ("home_assistant", "Home Assistant"),
            ("twilio", "Twilio SMS"),
            ("custom", "Custom Apprise URL"),
        ],
        help_text="Type of notification service",
    )
    apprise_url = serializers.CharField(help_text="Apprise-compatible URL for this channel")
    description = serializers.CharField(
        max_length=200, required=False, allow_blank=True, help_text="Optional description"
    )
    supports_rich = serializers.BooleanField(default=False, help_text="Whether this channel supports rich formatting")
    is_global = serializers.BooleanField(default=False, help_text="If true, channel is available to all users")
    enabled = serializers.BooleanField(default=True, help_text="Whether channel is active")

    def create(self, validated_data):
        # Whitelist only allowed fields - explicitly exclude owner, is_global, verified
        allowed_fields = {"name", "channel_type", "apprise_url", "description", "supports_rich", "enabled"}
        safe_data = {k: v for k, v in validated_data.items() if k in allowed_fields}
        return NotificationChannel.objects.create(**safe_data)


class NotificationChannelUpdateSerializer(serializers.Serializer):
    """Request body for updating a notification channel."""

    name = serializers.CharField(max_length=100, required=False, help_text="Friendly name")
    channel_type = serializers.ChoiceField(
        choices=[
            ("discord", "Discord"),
            ("slack", "Slack"),
            ("pushover", "Pushover"),
            ("telegram", "Telegram"),
            ("email", "Email"),
            ("webhook", "Generic Webhook"),
            ("ntfy", "ntfy"),
            ("gotify", "Gotify"),
            ("home_assistant", "Home Assistant"),
            ("twilio", "Twilio SMS"),
            ("custom", "Custom Apprise URL"),
        ],
        required=False,
        help_text="Type of notification service",
    )
    apprise_url = serializers.CharField(required=False, help_text="Apprise-compatible URL")
    description = serializers.CharField(
        max_length=200, required=False, allow_blank=True, allow_null=True, help_text="Optional description"
    )
    supports_rich = serializers.BooleanField(required=False, help_text="Whether this channel supports rich formatting")
    is_global = serializers.BooleanField(required=False, help_text="If true, channel is available to all users")
    enabled = serializers.BooleanField(required=False, help_text="Whether channel is active")

    def update(self, instance, validated_data):
        # Round-trip convention: the API returns masked URLs, so a client that
        # echoes the masked value back (or omits the field) keeps the stored URL.
        if APPRISE_URL_MASK in validated_data.get("apprise_url", ""):
            validated_data.pop("apprise_url")
        # Explicit field whitelist - excludes owner, is_global, verified
        allowed_fields = {"name", "channel_type", "apprise_url", "description", "supports_rich", "enabled"}
        for field in allowed_fields:
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        # Reset verification if URL changed
        if "apprise_url" in validated_data:
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
    """Notification configuration response.

    Apprise URLs are masked on read - raw values are only accepted via
    NotificationConfigUpdateSerializer and never returned by the API.
    """

    server_count = serializers.SerializerMethodField()
    apprise_urls = serializers.SerializerMethodField(help_text="Masked Apprise URLs (credentials redacted)")

    class Meta:
        model = NotificationConfig
        fields = ["enabled", "apprise_urls", "cooldown_seconds", "server_count"]

    def get_server_count(self, obj):
        """Count number of configured notification servers."""
        if obj.apprise_urls:
            return len([u for u in obj.apprise_urls.split(";") if u.strip()])
        return 0

    def get_apprise_urls(self, obj) -> str:
        if not obj.apprise_urls:
            return obj.apprise_urls
        return ";".join(mask_apprise_url(u.strip()) for u in obj.apprise_urls.split(";") if u.strip())


class NotificationConfigUpdateSerializer(serializers.Serializer):
    """Request body for updating notification config."""

    apprise_urls = serializers.CharField(
        required=False, allow_blank=True, help_text="Apprise notification URLs (semicolon-separated)"
    )
    cooldown_seconds = serializers.IntegerField(required=False, min_value=0, help_text="Cooldown between notifications")
    enabled = serializers.BooleanField(required=False, help_text="Enable/disable notifications")

    def update(self, instance, validated_data):
        """Update notification config."""
        # Round-trip convention: masked URLs echoed back keep the stored value
        # (blank still clears). See mask_apprise_url.
        if APPRISE_URL_MASK in validated_data.get("apprise_urls", ""):
            validated_data.pop("apprise_urls")
        # Explicit field whitelist
        allowed_fields = {"apprise_urls", "cooldown_seconds", "enabled"}
        for field in allowed_fields:
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        instance.save()
        return instance


class NotificationLogSerializer(serializers.ModelSerializer):
    """Notification log entry.

    The channel URL is masked on read since it may embed credentials.
    """

    channel_name = serializers.CharField(source="channel.name", read_only=True)
    channel_url = serializers.SerializerMethodField(help_text="Masked channel URL (credentials redacted)")

    class Meta:
        model = NotificationLog
        fields = [
            "id",
            "timestamp",
            "notification_type",
            "icao_hex",
            "callsign",
            "message",
            "details",
            "channel",
            "channel_name",
            "channel_url",
            "status",
            "retry_count",
            "last_error",
            "sent_at",
            "duration_ms",
        ]

    def get_channel_url(self, obj) -> str:
        return mask_apprise_url(obj.channel_url)


class NotificationTestSerializer(serializers.Serializer):
    """Response from test notification."""

    success = serializers.BooleanField(help_text="Whether notification was sent")
    message = serializers.CharField(help_text="Result message")
    servers_notified = serializers.IntegerField(help_text="Number of servers notified")


class NotificationTestRequestSerializer(serializers.Serializer):
    """Request body for testing a notification channel."""

    channel_id = serializers.IntegerField(
        required=False, help_text="Channel ID to test (if not provided, tests global config)"
    )
    title = serializers.CharField(default="SkysPy Test Notification", help_text="Notification title")
    message = serializers.CharField(
        default="This is a test notification from SkysPy.", help_text="Notification message"
    )


class NotificationServicesSerializer(serializers.Serializer):
    """Available notification services."""

    services = serializers.ListField(child=serializers.DictField(), help_text="List of available notification services")


class ChannelTypeInfoSerializer(serializers.Serializer):
    """Information about a notification channel type."""

    type = serializers.CharField()
    name = serializers.CharField()
    schema = serializers.CharField()
    description = serializers.CharField()
    supports_rich = serializers.BooleanField()
    url_template = serializers.CharField(required=False)
    required_fields = serializers.ListField(child=serializers.CharField())
