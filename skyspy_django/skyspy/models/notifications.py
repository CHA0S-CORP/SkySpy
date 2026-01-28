"""
Notification-related models for configuration, channels, templates, and logging.
"""
from django.db import models, transaction
from django.contrib.auth.models import User


class NotificationConfig(models.Model):
    """Notification configuration (singleton)."""

    apprise_urls = models.TextField(default='', blank=True)
    cooldown_seconds = models.IntegerField(default=300)
    enabled = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notification_config'

    def __str__(self):
        return f"Notification Config (enabled={self.enabled})"

    def save(self, *args, **kwargs):
        """Ensure only one config instance exists."""
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    @transaction.atomic
    def get_config(cls):
        """Get or create the singleton config instance."""
        config, _ = cls.objects.select_for_update().get_or_create(pk=1)
        return config


class NotificationChannel(models.Model):
    """
    Reusable notification channel definitions.

    Channels define where notifications are sent (Discord, Slack, etc.)
    and can be reused across multiple rules and users.
    """

    CHANNEL_TYPES = [
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
    ]

    name = models.CharField(max_length=100, help_text="Friendly name for this channel")
    channel_type = models.CharField(
        max_length=30,
        choices=CHANNEL_TYPES,
        help_text="Type of notification service"
    )
    apprise_url = models.TextField(
        help_text="Apprise-compatible URL for this channel"
    )
    description = models.CharField(max_length=200, blank=True, null=True)

    # Rich content support
    supports_rich = models.BooleanField(
        default=False,
        help_text="Whether this channel supports rich formatting (embeds, blocks)"
    )

    # Ownership
    is_global = models.BooleanField(
        default=True,
        help_text="If true, this channel is available to all users"
    )
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notification_channels',
        help_text="Owner of this channel (for non-global channels)"
    )

    # Status
    enabled = models.BooleanField(default=True)
    verified = models.BooleanField(
        default=False,
        help_text="Whether a test notification has succeeded"
    )
    last_success = models.DateTimeField(null=True, blank=True)
    last_failure = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notification_channels'
        ordering = ['name']
        indexes = [
            models.Index(fields=['channel_type', 'enabled'], name='idx_notif_chan_type'),
            models.Index(fields=['is_global', 'enabled'], name='idx_notif_chan_global'),
        ]

    def __str__(self):
        return f"{self.name} ({self.channel_type})"


class NotificationTemplate(models.Model):
    """
    Message templates with variable substitution.

    Templates define how notifications are formatted for different
    event types and priorities.
    """

    PRIORITY_CHOICES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]

    EVENT_TYPES = [
        ('alert', 'Alert'),
        ('safety', 'Safety Event'),
        ('military', 'Military Aircraft'),
        ('emergency', 'Emergency'),
        ('proximity', 'Proximity Alert'),
        ('tcas', 'TCAS Event'),
    ]

    name = models.CharField(
        max_length=100,
        unique=True,
        help_text="Unique identifier for this template"
    )
    description = models.CharField(max_length=200, blank=True, null=True)

    # Basic text templates
    title_template = models.CharField(
        max_length=200,
        default="Alert: {rule_name}",
        help_text="Template for notification title. Use {variable} syntax."
    )
    body_template = models.TextField(
        default="{callsign} at {altitude}ft triggered {rule_name}",
        help_text="Template for notification body. Use {variable} syntax."
    )

    # Rich formatting templates (channel-specific)
    discord_embed = models.JSONField(
        null=True,
        blank=True,
        help_text="Discord embed JSON template"
    )
    slack_blocks = models.JSONField(
        null=True,
        blank=True,
        help_text="Slack Block Kit JSON template"
    )

    # Matching criteria
    event_type = models.CharField(
        max_length=30,
        choices=EVENT_TYPES,
        null=True,
        blank=True,
        help_text="If set, only use this template for specific event types"
    )
    priority = models.CharField(
        max_length=20,
        choices=PRIORITY_CHOICES,
        null=True,
        blank=True,
        help_text="If set, only use this template for specific priorities"
    )

    # Default selection
    is_default = models.BooleanField(
        default=False,
        help_text="Use this template when no other template matches"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notification_templates'
        ordering = ['name']

    def __str__(self):
        return self.name

    @classmethod
    def get_template_for(cls, event_type: str, priority: str):
        """
        Get the best matching template for an event type and priority.

        Priority order:
        1. Exact match on both event_type and priority
        2. Match on event_type only
        3. Match on priority only
        4. Default template
        5. Fallback (None)
        """
        from django.db.models import Q, Case, When, IntegerField

        # Combine all matching criteria into a single query with priority ordering
        template = cls.objects.filter(
            Q(event_type=event_type, priority=priority) |  # Exact match
            Q(event_type=event_type, priority__isnull=True) |  # Event type only
            Q(event_type__isnull=True, priority=priority) |  # Priority only
            Q(is_default=True)  # Default template
        ).annotate(
            match_priority=Case(
                When(event_type=event_type, priority=priority, then=0),
                When(event_type=event_type, priority__isnull=True, then=1),
                When(event_type__isnull=True, priority=priority, then=2),
                When(is_default=True, then=3),
                default=4,
                output_field=IntegerField()
            )
        ).order_by('match_priority').first()

        return template


class NotificationLog(models.Model):
    """
    Log of sent notifications with retry tracking.
    """

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
        ('retrying', 'Retrying'),
    ]

    NOTIFICATION_TYPES = [
        ('alert', 'Alert'),
        ('safety', 'Safety Event'),
        ('military', 'Military Aircraft'),
        ('emergency', 'Emergency'),
        ('proximity', 'Proximity Alert'),
        ('tcas', 'TCAS Event'),
        ('test', 'Test'),
    ]

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    notification_type = models.CharField(
        max_length=50,
        choices=NOTIFICATION_TYPES,
        db_index=True,
        blank=True,
        null=True
    )
    icao_hex = models.CharField(max_length=10, blank=True, null=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    message = models.TextField(blank=True, null=True)
    details = models.JSONField(blank=True, null=True)

    # Channel tracking
    channel = models.ForeignKey(
        NotificationChannel,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='logs'
    )
    channel_url = models.TextField(
        blank=True,
        null=True,
        help_text="The actual URL used (may differ from channel if overridden)"
    )

    # Status tracking
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending'
    )

    # Retry handling
    retry_count = models.IntegerField(default=0)
    max_retries = models.IntegerField(default=3)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, null=True)

    # Timing
    sent_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.IntegerField(
        null=True,
        blank=True,
        help_text="Time taken to send notification"
    )

    class Meta:
        db_table = 'notification_logs'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['status', 'next_retry_at'], name='idx_notif_log_retry'),
        ]

    def __str__(self):
        return f"{self.notification_type} - {self.icao_hex} @ {self.timestamp}"

    def can_retry(self) -> bool:
        """Check if this notification can be retried."""
        return self.status in ('failed', 'retrying') and self.retry_count < self.max_retries

    def mark_sent(self, duration_ms: int = None):
        """Mark notification as successfully sent."""
        from django.utils import timezone
        self.status = 'sent'
        self.sent_at = timezone.now()
        if duration_ms is not None:
            self.duration_ms = duration_ms
        self.save(update_fields=['status', 'sent_at', 'duration_ms'])

    def mark_failed(self, error: str):
        """Mark notification as failed and schedule retry if possible."""
        from django.utils import timezone
        from datetime import timedelta

        self.last_error = error
        self.retry_count += 1

        if self.can_retry():
            self.status = 'retrying'
            # Exponential backoff: 30s, 60s, 120s, 240s, ...
            delay_seconds = 30 * (2 ** (self.retry_count - 1))
            self.next_retry_at = timezone.now() + timedelta(seconds=delay_seconds)
        else:
            self.status = 'failed'
            self.next_retry_at = None

        self.save(update_fields=['status', 'last_error', 'retry_count', 'next_retry_at'])


class UserNotificationPreference(models.Model):
    """
    Per-user notification preferences.

    Controls which notifications a user receives, on which channels,
    and includes quiet hours support.
    """

    PRIORITY_CHOICES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notification_preferences'
    )
    channel = models.ForeignKey(
        NotificationChannel,
        on_delete=models.CASCADE,
        related_name='user_preferences'
    )

    # Filtering
    min_priority = models.CharField(
        max_length=20,
        choices=PRIORITY_CHOICES,
        default='info',
        help_text="Minimum priority level to receive notifications"
    )
    event_types = models.JSONField(
        default=list,
        blank=True,
        help_text="List of event types to receive. Empty = all types."
    )

    # Quiet hours
    quiet_hours_start = models.TimeField(
        null=True,
        blank=True,
        help_text="Start of quiet hours (notifications muted)"
    )
    quiet_hours_end = models.TimeField(
        null=True,
        blank=True,
        help_text="End of quiet hours"
    )
    critical_overrides_quiet = models.BooleanField(
        default=True,
        help_text="If true, critical notifications ignore quiet hours"
    )

    # Timezone for quiet hours
    timezone = models.CharField(
        max_length=50,
        default='UTC',
        help_text="Timezone for quiet hours calculation"
    )

    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_notification_preferences'
        unique_together = [['user', 'channel']]

    def __str__(self):
        return f"{self.user.username} - {self.channel.name}"

    def is_in_quiet_hours(self) -> bool:
        """Check if current time is within quiet hours."""
        if not self.quiet_hours_start or not self.quiet_hours_end:
            return False

        try:
            import pytz
            from datetime import datetime

            tz = pytz.timezone(self.timezone)
            now = datetime.now(tz).time()

            if self.quiet_hours_start <= self.quiet_hours_end:
                # Normal case: quiet hours don't span midnight
                return self.quiet_hours_start <= now <= self.quiet_hours_end
            else:
                # Quiet hours span midnight (e.g., 22:00 - 08:00)
                return now >= self.quiet_hours_start or now <= self.quiet_hours_end
        except Exception:
            return False

    def should_receive(self, priority: str, event_type: str) -> bool:
        """
        Determine if user should receive a notification based on preferences.
        """
        if not self.enabled:
            return False

        # Check priority
        priority_order = {'info': 0, 'warning': 1, 'critical': 2}
        min_level = priority_order.get(self.min_priority, 0)
        msg_level = priority_order.get(priority, 0)

        if msg_level < min_level:
            return False

        # Check event type filter
        if self.event_types and event_type not in self.event_types:
            return False

        # Check quiet hours
        if self.is_in_quiet_hours():
            if priority == 'critical' and self.critical_overrides_quiet:
                return True
            return False

        return True
