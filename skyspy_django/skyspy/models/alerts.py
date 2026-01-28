"""
Alert-related models for user-defined rules, subscriptions, and history.
"""
from django.db import models, transaction
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError


class AlertRule(models.Model):
    """User-defined alert rules with complex conditions and scheduling."""

    PRIORITY_CHOICES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]

    OPERATOR_CHOICES = [
        ('eq', 'Equals'),
        ('neq', 'Not Equals'),
        ('lt', 'Less Than'),
        ('le', 'Less Than or Equal'),
        ('gt', 'Greater Than'),
        ('ge', 'Greater Than or Equal'),
        ('contains', 'Contains'),
        ('startswith', 'Starts With'),
        ('endswith', 'Ends With'),
        ('regex', 'Regex Match'),
    ]

    VISIBILITY_CHOICES = [
        ('private', 'Private'),
        ('shared', 'Shared'),
        ('public', 'Public'),
    ]

    name = models.CharField(max_length=100)
    rule_type = models.CharField(max_length=30, blank=True, null=True)
    operator = models.CharField(max_length=10, choices=OPERATOR_CHOICES, default='eq')
    value = models.CharField(max_length=100, blank=True, null=True)
    conditions = models.JSONField(blank=True, null=True)  # Complex AND/OR conditions
    description = models.CharField(max_length=200, blank=True, null=True)
    enabled = models.BooleanField(default=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='info')
    starts_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    api_url = models.CharField(max_length=500, blank=True, null=True)  # Webhook URL
    cooldown_minutes = models.IntegerField(default=5)
    last_triggered = models.DateTimeField(blank=True, null=True)

    # Notification channels - multiple targets per rule
    notification_channels = models.ManyToManyField(
        'NotificationChannel',
        blank=True,
        related_name='alert_rules',
        help_text='Notification channels to send alerts to when this rule triggers'
    )

    # Whether to also use global notification config (APPRISE_URLS from env)
    use_global_notifications = models.BooleanField(
        default=True,
        help_text='Also send to global notification URLs from environment'
    )

    # Ownership fields for RBAC
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_index=True,
        related_name='alert_rules',
        help_text='Owner of this alert rule'
    )

    # Visibility control
    visibility = models.CharField(
        max_length=20,
        choices=VISIBILITY_CHOICES,
        default='private',
        help_text='Who can see this rule: private (owner only), shared (subscribers), public (everyone)'
    )
    is_system = models.BooleanField(
        default=False,
        help_text='System rules cannot be deleted by users'
    )

    # Legacy field (kept for backwards compatibility, use visibility instead)
    is_shared = models.BooleanField(
        default=False,
        help_text='Deprecated: use visibility field instead'
    )

    # Suppression windows
    suppression_windows = models.JSONField(
        default=list,
        blank=True,
        help_text='Time windows when this rule should not trigger. Format: [{"day": "saturday", "start": "22:00", "end": "08:00"}]'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'alert_rules'
        indexes = [
            models.Index(fields=['rule_type', 'enabled'], name='idx_alert_rules_type'),
            models.Index(fields=['visibility', 'enabled'], name='idx_alert_rules_vis'),
            models.Index(fields=['owner', 'enabled'], name='idx_alert_rules_owner'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.rule_type})"

    def clean(self):
        if self.starts_at and self.expires_at and self.expires_at <= self.starts_at:
            raise ValidationError({'expires_at': 'Expiration must be after start time'})

    def is_in_suppression_window(self) -> bool:
        """Check if current time is within a suppression window."""
        if not self.suppression_windows:
            return False

        try:
            from datetime import datetime
            import calendar

            now = datetime.now()
            current_day = calendar.day_name[now.weekday()].lower()
            current_time = now.strftime('%H:%M')

            for window in self.suppression_windows:
                day = window.get('day', '').lower()
                start = window.get('start', '')
                end = window.get('end', '')

                if day and day != current_day:
                    continue

                if start and end:
                    if start <= end:
                        # Normal window (e.g., 09:00 - 17:00)
                        if start <= current_time <= end:
                            return True
                    else:
                        # Overnight window (e.g., 22:00 - 08:00)
                        if current_time >= start or current_time <= end:
                            return True

            return False
        except Exception:
            return False

    def can_be_edited_by(self, user) -> bool:
        """Check if a user can edit this rule."""
        if user is None:
            return False
        if user.is_superuser:
            return True
        if self.owner_id == user.id:
            return True
        return False

    def can_be_deleted_by(self, user) -> bool:
        """Check if a user can delete this rule."""
        if self.is_system:
            return user.is_superuser if user else False
        return self.can_be_edited_by(user)


class AlertHistory(models.Model):
    """History of triggered alerts."""

    rule = models.ForeignKey(
        AlertRule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='history'
    )
    rule_name = models.CharField(max_length=100, blank=True, null=True)
    icao_hex = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    message = models.TextField(blank=True, null=True)
    priority = models.CharField(max_length=20, blank=True, null=True)
    aircraft_data = models.JSONField(blank=True, null=True)
    triggered_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # User tracking
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='alert_history',
        help_text='Owner of the rule that triggered this alert'
    )
    session_key = models.CharField(
        max_length=40,
        blank=True,
        null=True,
        help_text='Session key for anonymous users'
    )

    # Acknowledgment
    acknowledged = models.BooleanField(default=False)
    acknowledged_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='acknowledged_alerts',
        help_text='User who acknowledged this alert'
    )
    acknowledged_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'alert_history'
        ordering = ['-triggered_at']
        indexes = [
            models.Index(fields=['user', 'triggered_at'], name='idx_alert_hist_user'),
            models.Index(fields=['acknowledged', 'triggered_at'], name='idx_alert_hist_ack'),
        ]

    def __str__(self):
        return f"{self.rule_name} - {self.icao_hex} @ {self.triggered_at}"

    def acknowledge(self, user):
        """Mark this alert as acknowledged."""
        from django.utils import timezone
        self.acknowledged = True
        self.acknowledged_by = user
        self.acknowledged_at = timezone.now()
        self.save(update_fields=['acknowledged', 'acknowledged_by', 'acknowledged_at'])


class AlertSubscription(models.Model):
    """
    User subscriptions to shared/public alert rules.

    Allows users to subscribe to rules they don't own but want
    to receive notifications from.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='alert_subscriptions',
        help_text='Subscribed user (null for anonymous)'
    )
    session_key = models.CharField(
        max_length=40,
        blank=True,
        null=True,
        help_text='Session key for anonymous subscriptions'
    )
    rule = models.ForeignKey(
        AlertRule,
        on_delete=models.CASCADE,
        related_name='subscriptions'
    )
    notify_on_trigger = models.BooleanField(
        default=True,
        help_text='Whether to send notifications when rule triggers'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'alert_subscriptions'
        unique_together = [
            ['user', 'rule'],
            ['session_key', 'rule'],
        ]
        indexes = [
            models.Index(fields=['rule', 'notify_on_trigger'], name='idx_alert_sub_rule'),
        ]

    def __str__(self):
        subscriber = self.user.username if self.user else f"session:{self.session_key[:8]}"
        return f"{subscriber} -> {self.rule.name}"

    @classmethod
    @transaction.atomic
    def subscribe(cls, rule, user=None, session_key=None, notify=True):
        """Subscribe to a rule."""
        if not user and not session_key:
            raise ValueError("Either user or session_key is required")

        subscription, created = cls.objects.update_or_create(
            user=user,
            session_key=session_key if not user else None,
            rule=rule,
            defaults={'notify_on_trigger': notify}
        )
        return subscription, created

    @classmethod
    def unsubscribe(cls, rule, user=None, session_key=None):
        """Unsubscribe from a rule."""
        filters = {'rule': rule}
        if user:
            filters['user'] = user
        elif session_key:
            filters['session_key'] = session_key
        else:
            return 0

        deleted, _ = cls.objects.filter(**filters).delete()
        return deleted


class AlertAggregate(models.Model):
    """
    Aggregated alert statistics for time windows.

    Reduces noise in history views by grouping alerts by rule
    within configurable time windows.
    """

    rule = models.ForeignKey(
        AlertRule,
        on_delete=models.CASCADE,
        related_name='aggregates'
    )
    window_start = models.DateTimeField(db_index=True)
    window_end = models.DateTimeField()
    trigger_count = models.IntegerField(default=0)
    unique_aircraft = models.IntegerField(default=0)
    sample_aircraft = models.JSONField(
        default=list,
        help_text='Sample of aircraft that triggered (first few)'
    )

    class Meta:
        db_table = 'alert_aggregates'
        ordering = ['-window_start']
        indexes = [
            models.Index(fields=['rule', 'window_start'], name='idx_alert_agg_rule'),
        ]

    def __str__(self):
        return f"{self.rule.name}: {self.trigger_count} triggers ({self.window_start} - {self.window_end})"

    @classmethod
    def aggregate_for_window(cls, rule, window_start, window_end):
        """
        Create or update an aggregate for a time window.
        """
        from django.db.models import Count

        # Reuse the filtered queryset to avoid querying twice
        qs = AlertHistory.objects.filter(
            rule=rule,
            triggered_at__gte=window_start,
            triggered_at__lt=window_end
        )

        # Get stats from AlertHistory
        history_stats = qs.aggregate(
            count=Count('id'),
            unique_icao=Count('icao_hex', distinct=True)
        )

        # Get sample aircraft
        samples = list(qs.values('icao_hex', 'callsign')[:5])

        aggregate, _ = cls.objects.update_or_create(
            rule=rule,
            window_start=window_start,
            window_end=window_end,
            defaults={
                'trigger_count': history_stats['count'] or 0,
                'unique_aircraft': history_stats['unique_icao'] or 0,
                'sample_aircraft': samples,
            }
        )
        return aggregate
