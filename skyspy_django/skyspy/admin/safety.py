"""
Django admin configuration for safety event models.
"""
from django.contrib import admin

from skyspy.models import SafetyEvent
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import TimestampDateRangeFilter, AcknowledgedFilter, SeverityFilter
from skyspy.admin.actions import acknowledge_selected


@admin.register(SafetyEvent)
class SafetyEventAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for safety events including TCAS conflicts and emergencies."""

    list_display = [
        'timestamp', 'event_type', 'severity', 'icao_hex', 'callsign',
        'icao_hex_2', 'callsign_2', 'acknowledged'
    ]
    list_filter = ['event_type', SeverityFilter, AcknowledgedFilter, TimestampDateRangeFilter]
    search_fields = ['icao_hex', 'icao_hex_2', 'callsign', 'callsign_2']
    date_hierarchy = 'timestamp'
    ordering = ['-timestamp']

    actions = [acknowledge_selected, 'export_as_csv']

    fieldsets = (
        ('Event Details', {
            'fields': ('timestamp', 'event_type', 'severity', 'message')
        }),
        ('Primary Aircraft', {
            'fields': ('icao_hex', 'callsign', 'aircraft_snapshot')
        }),
        ('Secondary Aircraft', {
            'fields': ('icao_hex_2', 'callsign_2', 'aircraft_snapshot_2'),
            'classes': ('collapse',),
            'description': 'For proximity conflicts and TCAS events'
        }),
        ('Additional Details', {
            'fields': ('details',),
            'classes': ('collapse',)
        }),
        ('Acknowledgement', {
            'fields': ('acknowledged', 'acknowledged_at')
        }),
    )

    readonly_fields = ['timestamp', 'acknowledged_at']
