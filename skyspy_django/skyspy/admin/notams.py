"""
Admin classes for NOTAM models (NOTAMs, airlines, aircraft types).
"""
from django.contrib import admin

from skyspy.models import CachedNotam, CachedAirline, CachedAircraftType
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import DateRangeFilter, ArchivedFilter
from skyspy.admin.actions import archive_selected, unarchive_selected


class EffectiveStartDateRangeFilter(DateRangeFilter):
    """Date range filter using 'effective_start' field."""
    title = 'effective start'
    parameter_name = 'effective_start_range'
    date_field = 'effective_start'


@admin.register(CachedNotam)
class CachedNotamAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for CachedNotam model."""

    list_display = (
        'notam_id',
        'notam_type',
        'location',
        'effective_start',
        'effective_end',
        'is_active_display',
        'is_archived',
    )
    list_filter = (
        'notam_type',
        'classification',
        ArchivedFilter,
        EffectiveStartDateRangeFilter,
    )
    search_fields = ('notam_id', 'location', 'text')
    date_hierarchy = 'effective_start'

    fieldsets = (
        (None, {
            'fields': ('notam_id', 'notam_type', 'classification')
        }),
        ('Location', {
            'fields': ('location', 'latitude', 'longitude', 'radius_nm')
        }),
        ('Altitude', {
            'fields': ('floor_ft', 'ceiling_ft')
        }),
        ('Validity', {
            'fields': ('effective_start', 'effective_end', 'is_permanent')
        }),
        ('Content', {
            'fields': ('text', 'raw_text', 'keywords', 'reason')
        }),
        ('Geometry', {
            'fields': ('geometry',)
        }),
        ('Archive', {
            'fields': ('is_archived', 'archived_at', 'archive_reason')
        }),
    )

    actions = [archive_selected, unarchive_selected, 'export_as_csv']

    @admin.display(boolean=True, description='Active')
    def is_active_display(self, obj):
        """Display the is_active property as a boolean icon."""
        return obj.is_active


@admin.register(CachedAirline)
class CachedAirlineAdmin(admin.ModelAdmin):
    """Admin for CachedAirline model."""

    list_display = (
        'icao_code',
        'iata_code',
        'name',
        'callsign',
        'country',
        'active',
    )
    list_filter = ('active', 'country')
    search_fields = ('icao_code', 'iata_code', 'name', 'callsign')


@admin.register(CachedAircraftType)
class CachedAircraftTypeAdmin(admin.ModelAdmin):
    """Admin for CachedAircraftType model."""

    list_display = (
        'icao_code',
        'iata_code',
        'name',
        'manufacturer',
    )
    list_filter = ('manufacturer',)
    search_fields = ('icao_code', 'iata_code', 'name', 'manufacturer')
