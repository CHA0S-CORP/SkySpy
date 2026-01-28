"""
Django admin classes for SkySpy notification models.
"""
from django.contrib import admin, messages
from django.utils import timezone
from django.utils.html import format_html
from django.utils.timesince import timesince

from skyspy.models import (
    NotificationConfig,
    NotificationChannel,
    NotificationTemplate,
    NotificationLog,
    UserNotificationPreference,
)
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import (
    EnabledFilter,
    PriorityFilter,
    NotificationStatusFilter,
    VerifiedFilter,
)
from skyspy.admin.actions import enable_selected, disable_selected, mark_verified


@admin.register(NotificationConfig)
class NotificationConfigAdmin(admin.ModelAdmin):
    """Admin for NotificationConfig model (singleton pattern)."""
    list_display = ('enabled', 'cooldown_seconds', 'updated_at')
    fields = ('enabled', 'cooldown_seconds', 'apprise_urls')

    def has_add_permission(self, request):
        """Only allow adding if no instance exists (singleton)."""
        return not NotificationConfig.objects.exists()

    def has_delete_permission(self, request, obj=None):
        """Prevent deletion of the singleton config."""
        return False


@admin.register(NotificationChannel)
class NotificationChannelAdmin(admin.ModelAdmin):
    """Admin for NotificationChannel model."""
    list_display = (
        'name',
        'channel_type',
        'is_global',
        'owner',
        'enabled',
        'verified',
        'last_success_display',
    )
    list_filter = (
        'channel_type',
        EnabledFilter,
        VerifiedFilter,
        'is_global',
    )
    search_fields = ('name', 'description', 'apprise_url')

    fieldsets = (
        (None, {
            'fields': ('name', 'channel_type', 'description'),
        }),
        ('Configuration', {
            'fields': ('apprise_url', 'supports_rich'),
        }),
        ('Ownership', {
            'fields': ('is_global', 'owner'),
        }),
        ('Status', {
            'fields': ('enabled', 'verified', 'last_success', 'last_failure', 'last_error'),
        }),
    )

    actions = [enable_selected, disable_selected, mark_verified, 'test_notification']

    @admin.display(description='Last Success')
    def last_success_display(self, obj):
        """Display humanized time since last success."""
        if obj.last_success:
            return format_html(
                '<span title="{}">{} ago</span>',
                obj.last_success.strftime('%Y-%m-%d %H:%M:%S'),
                timesince(obj.last_success)
            )
        return format_html('<span style="color: #999;">Never</span>')

    @admin.action(description="Test selected notification channels")
    def test_notification(self, request, queryset):
        """Test notification channels by marking them verified."""
        now = timezone.now()
        updated = queryset.update(verified=True, last_success=now)
        self.message_user(
            request,
            f"{updated} channel(s) tested and marked as verified.",
            messages.SUCCESS
        )


@admin.register(NotificationTemplate)
class NotificationTemplateAdmin(admin.ModelAdmin):
    """Admin for NotificationTemplate model."""
    list_display = ('name', 'event_type', 'priority', 'is_default')
    list_filter = ('event_type', PriorityFilter, 'is_default')
    search_fields = ('name', 'title_template', 'body_template')

    fieldsets = (
        (None, {
            'fields': ('name', 'event_type', 'priority', 'is_default'),
        }),
        ('Basic Templates', {
            'fields': ('title_template', 'body_template'),
        }),
        ('Rich Templates', {
            'fields': ('discord_embed', 'slack_blocks'),
            'classes': ('collapse',),
        }),
    )


@admin.register(NotificationLog)
class NotificationLogAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for NotificationLog model."""
    list_display = (
        'timestamp',
        'notification_type',
        'icao_hex',
        'callsign',
        'channel',
        'status',
        'retry_count',
        'sent_at',
    )
    list_filter = (
        NotificationStatusFilter,
        'notification_type',
        'channel',
        'timestamp',
    )
    search_fields = ('icao_hex', 'callsign', 'message')
    date_hierarchy = 'timestamp'

    readonly_fields = (
        'timestamp',
        'notification_type',
        'icao_hex',
        'callsign',
        'message',
        'channel',
        'sent_at',
        'last_error',
        'details',
    )

    actions = ['retry_failed', 'export_as_csv']

    @admin.action(description="Retry failed notifications")
    def retry_failed(self, request, queryset):
        """Reset failed notifications to pending for retry."""
        max_retries = 3
        failed = queryset.filter(status='failed', retry_count__lt=max_retries)
        updated = failed.update(status='pending')
        self.message_user(
            request,
            f"{updated} notification(s) queued for retry.",
            messages.SUCCESS
        )


@admin.register(UserNotificationPreference)
class UserNotificationPreferenceAdmin(admin.ModelAdmin):
    """Admin for UserNotificationPreference model."""
    list_display = (
        'user',
        'channel',
        'min_priority',
        'enabled',
        'quiet_hours_display',
    )
    list_filter = (
        EnabledFilter,
        'min_priority',
        'channel',
    )
    search_fields = ('user__username',)

    @admin.display(description='Quiet Hours')
    def quiet_hours_display(self, obj):
        """Display formatted quiet hours range."""
        if obj.quiet_hours_start and obj.quiet_hours_end:
            return format_html(
                '{} - {}',
                obj.quiet_hours_start.strftime('%H:%M'),
                obj.quiet_hours_end.strftime('%H:%M')
            )
        return format_html('<span style="color: #999;">None</span>')
