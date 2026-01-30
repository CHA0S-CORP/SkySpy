"""
Admin classes for airspace models (advisories and boundaries).
"""
from django.contrib import admin, messages
from django.utils import timezone

from skyspy.models import AirspaceAdvisory, AirspaceBoundary
from skyspy.admin.filters import DateRangeFilter


class ValidFromDateRangeFilter(DateRangeFilter):
    """Date range filter using 'valid_from' field."""
    title = 'valid from'
    parameter_name = 'valid_from_range'
    date_field = 'valid_from'


@admin.register(AirspaceAdvisory)
class AirspaceAdvisoryAdmin(admin.ModelAdmin):
    """Admin for AirspaceAdvisory model."""

    list_display = (
        'advisory_id',
        'advisory_type',
        'hazard',
        'severity',
        'valid_from',
        'valid_to',
        'is_active_display',
        'region',
    )
    list_filter = (
        'advisory_type',
        'hazard',
        ValidFromDateRangeFilter,
    )
    search_fields = ('advisory_id', 'raw_text')
    date_hierarchy = 'valid_from'
    readonly_fields = ('fetched_at',)

    fieldsets = (
        (None, {
            'fields': ('advisory_id', 'advisory_type', 'hazard', 'severity')
        }),
        ('Validity', {
            'fields': ('valid_from', 'valid_to', 'region')
        }),
        ('Altitude', {
            'fields': ('lower_alt_ft', 'upper_alt_ft')
        }),
        ('Details', {
            'fields': ('raw_text', 'polygon', 'source_data')
        }),
        ('Metadata', {
            'fields': ('fetched_at',)
        }),
    )

    actions = ['refresh_advisories']

    @admin.display(boolean=True, description='Active')
    def is_active_display(self, obj):
        """Check if advisory is currently active."""
        now = timezone.now()
        if obj.valid_from and obj.valid_to:
            return obj.valid_from <= now <= obj.valid_to
        elif obj.valid_from:
            return obj.valid_from <= now
        return False

    @admin.action(description="Refresh advisories from source")
    def refresh_advisories(self, request, queryset):
        """Trigger async task to refresh advisories from Aviation Weather Center."""
        from skyspy.tasks.airspace import refresh_airspace_advisories

        refresh_airspace_advisories.delay()
        self.message_user(
            request,
            "Advisory refresh task has been queued. This may take a few moments.",
            messages.SUCCESS
        )


@admin.register(AirspaceBoundary)
class AirspaceBoundaryAdmin(admin.ModelAdmin):
    """Admin for AirspaceBoundary model."""

    list_display = (
        'name',
        'icao',
        'airspace_class',
        'floor_ft',
        'ceiling_ft',
        'source',
    )
    list_filter = ('airspace_class', 'source')
    search_fields = ('name', 'icao')

    fieldsets = (
        (None, {
            'fields': ('name', 'icao', 'airspace_class')
        }),
        ('Altitude', {
            'fields': ('floor_ft', 'ceiling_ft')
        }),
        ('Location', {
            'fields': ('center_lat', 'center_lon', 'radius_nm', 'polygon')
        }),
        ('Info', {
            'fields': ('controlling_agency', 'schedule')
        }),
        ('Source', {
            'fields': ('source', 'source_id', 'updated_at')
        }),
    )
