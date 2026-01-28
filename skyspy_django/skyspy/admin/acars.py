"""
Django admin configuration for ACARS message models.
"""
import json
from django.contrib import admin
from django.utils.html import format_html, escape

from skyspy.models import AcarsMessage
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import TimestampDateRangeFilter


@admin.register(AcarsMessage)
class AcarsMessageAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for ACARS and VDL2 messages."""

    list_display = [
        'timestamp', 'source', 'icao_hex', 'registration', 'callsign',
        'label', 'text_preview', 'decoded_display'
    ]
    list_filter = ['source', 'label', TimestampDateRangeFilter]
    search_fields = ['icao_hex', 'registration', 'callsign', 'text']
    date_hierarchy = 'timestamp'
    ordering = ['-timestamp']

    actions = ['export_as_csv']

    fieldsets = (
        ('Timestamp & Source', {
            'fields': ('timestamp', 'source', 'channel', 'frequency', 'station_id')
        }),
        ('Aircraft', {
            'fields': ('icao_hex', 'registration', 'callsign')
        }),
        ('Message', {
            'fields': ('label', 'block_id', 'msg_num', 'ack', 'mode', 'text')
        }),
        ('Decoded Content', {
            'fields': ('decoded',),
            'classes': ('collapse',)
        }),
        ('Signal', {
            'fields': ('signal_level', 'error_count'),
            'classes': ('collapse',)
        }),
    )

    readonly_fields = ['timestamp']

    @admin.display(description='Text')
    def text_preview(self, obj):
        """Display first 50 characters of message text."""
        if obj.text:
            preview = obj.text[:50]
            if len(obj.text) > 50:
                preview += "..."
            return preview
        return "-"

    @admin.display(description='Decoded')
    def decoded_display(self, obj):
        """Display formatted JSON for decoded content."""
        if obj.decoded:
            try:
                formatted = json.dumps(obj.decoded, indent=2)
                # Truncate for list display
                if len(formatted) > 100:
                    formatted = formatted[:100] + "..."
                return format_html(
                    '<pre style="margin: 0; font-size: 11px; white-space: pre-wrap;">{}</pre>',
                    escape(formatted)
                )
            except (TypeError, ValueError):
                return str(obj.decoded)[:100]
        return "-"
