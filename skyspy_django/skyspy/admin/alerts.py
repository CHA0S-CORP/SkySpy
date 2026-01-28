"""
Django admin classes for SkySpy alert models.
"""
from django.contrib import admin
from django.utils.html import format_html

from skyspy.models import AlertRule, AlertHistory, AlertSubscription, AlertAggregate
from skyspy.admin.mixins import ExportCSVMixin, ExportJSONMixin
from skyspy.admin.filters import TriggeredAtDateRangeFilter, EnabledFilter, PriorityFilter
from skyspy.admin.actions import acknowledge_selected, enable_selected, disable_selected


class AlertSubscriptionInline(admin.TabularInline):
    """Inline admin for alert subscriptions."""
    model = AlertSubscription
    extra = 0
    fields = ('user', 'session_key', 'notify_on_trigger', 'created_at')
    readonly_fields = ('created_at',)
    raw_id_fields = ('user',)


@admin.register(AlertRule)
class AlertRuleAdmin(admin.ModelAdmin):
    """Admin for AlertRule model."""
    list_display = (
        'name',
        'rule_type',
        'priority',
        'enabled',
        'visibility',
        'owner',
        'cooldown_minutes',
        'notification_count',
    )
    list_filter = (
        EnabledFilter,
        'priority',
        'visibility',
        'is_system',
        'rule_type',
    )
    search_fields = ('name', 'description', 'value')
    filter_horizontal = ('notification_channels',)

    fieldsets = (
        (None, {
            'fields': ('name', 'description', 'enabled', 'priority'),
        }),
        ('Conditions', {
            'fields': ('rule_type', 'operator', 'value', 'conditions'),
        }),
        ('Scheduling', {
            'fields': (
                'starts_at',
                'expires_at',
                'cooldown_minutes',
                'last_triggered',
                'suppression_windows',
            ),
        }),
        ('Visibility & Ownership', {
            'fields': ('visibility', 'owner', 'is_system', 'is_shared'),
        }),
        ('Notifications', {
            'fields': (
                'notification_channels',
                'use_global_notifications',
                'api_url',
            ),
        }),
    )

    inlines = [AlertSubscriptionInline]
    actions = [enable_selected, disable_selected]

    @admin.display(description='Notification Channels')
    def notification_count(self, obj):
        """Return count of associated notification channels."""
        count = obj.notification_channels.count()
        if count == 0:
            return format_html('<span style="color: #999;">0</span>')
        return count


@admin.register(AlertHistory)
class AlertHistoryAdmin(ExportCSVMixin, ExportJSONMixin, admin.ModelAdmin):
    """Admin for AlertHistory model."""
    list_display = (
        'triggered_at',
        'rule_name',
        'icao_hex',
        'callsign',
        'priority',
        'user',
        'acknowledged',
    )
    list_filter = (
        PriorityFilter,
        'acknowledged',
        TriggeredAtDateRangeFilter,
    )
    search_fields = ('rule_name', 'icao_hex', 'callsign', 'message')
    date_hierarchy = 'triggered_at'
    readonly_fields = (
        'triggered_at',
        'rule',
        'rule_name',
        'icao_hex',
        'callsign',
        'message',
        'priority',
        'aircraft_data',
        'user',
        'session_key',
    )

    actions = [acknowledge_selected, 'export_as_csv', 'export_as_json']


@admin.register(AlertSubscription)
class AlertSubscriptionAdmin(admin.ModelAdmin):
    """Admin for AlertSubscription model."""
    list_display = (
        'user',
        'session_key',
        'rule',
        'notify_on_trigger',
        'created_at',
    )
    list_filter = (
        'notify_on_trigger',
        'created_at',
    )
    search_fields = ('user__username', 'rule__name')
    raw_id_fields = ('user', 'rule')


@admin.register(AlertAggregate)
class AlertAggregateAdmin(admin.ModelAdmin):
    """Admin for AlertAggregate model (read-only aggregates)."""
    list_display = (
        'rule',
        'window_start',
        'window_end',
        'trigger_count',
        'unique_aircraft',
    )
    list_filter = (
        'rule',
        'window_start',
    )
    date_hierarchy = 'window_start'

    def get_readonly_fields(self, request, obj=None):
        """All fields are readonly since aggregates are computed."""
        if obj:
            return [f.name for f in self.model._meta.fields]
        return []

    def has_add_permission(self, request):
        """Aggregates are computed, not manually added."""
        return False

    def has_change_permission(self, request, obj=None):
        """Aggregates are immutable."""
        return False
