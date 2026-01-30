"""
Admin classes for aviation data models (airports, navaids, GeoJSON, PIREPs).
"""
from django.contrib import admin, messages

from skyspy.models import CachedAirport, CachedNavaid, CachedGeoJSON, CachedPirep
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import ObservationTimeDateRangeFilter, ArchivedFilter
from skyspy.admin.actions import archive_selected, unarchive_selected


@admin.register(CachedAirport)
class CachedAirportAdmin(admin.ModelAdmin):
    """Admin for CachedAirport model."""

    list_display = (
        'icao_id',
        'name',
        'airport_type',
        'country',
        'latitude',
        'longitude',
        'elevation_ft',
    )
    list_filter = ('airport_type', 'country')
    search_fields = ('icao_id', 'name')
    readonly_fields = ('fetched_at',)

    actions = ['refresh_airports']

    @admin.action(description="Refresh airports from source")
    def refresh_airports(self, request, queryset):
        """Trigger async task to refresh airports from Aviation Weather Center."""
        from skyspy.tasks.geodata import refresh_airports as refresh_airports_task

        refresh_airports_task.delay()
        self.message_user(
            request,
            "Airport refresh task has been queued. This may take a few moments.",
            messages.SUCCESS
        )


@admin.register(CachedNavaid)
class CachedNavaidAdmin(admin.ModelAdmin):
    """Admin for CachedNavaid model."""

    list_display = (
        'ident',
        'name',
        'navaid_type',
        'latitude',
        'longitude',
        'frequency',
    )
    list_filter = ('navaid_type',)
    search_fields = ('ident', 'name')
    readonly_fields = ('fetched_at',)


@admin.register(CachedGeoJSON)
class CachedGeoJSONAdmin(admin.ModelAdmin):
    """Admin for CachedGeoJSON model."""

    list_display = (
        'data_type',
        'name',
        'code',
        'fetched_at',
    )
    list_filter = ('data_type',)
    search_fields = ('name', 'code')
    readonly_fields = ('fetched_at', 'geometry')


@admin.register(CachedPirep)
class CachedPirepAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for CachedPirep model."""

    list_display = (
        'pirep_id',
        'report_type',
        'observation_time',
        'location',
        'turbulence_type',
        'icing_type',
        'is_archived',
    )
    list_filter = (
        'report_type',
        'turbulence_type',
        'icing_type',
        ArchivedFilter,
        ObservationTimeDateRangeFilter,
    )
    search_fields = ('pirep_id', 'location', 'aircraft_type')
    date_hierarchy = 'observation_time'

    fieldsets = (
        (None, {
            'fields': ('pirep_id', 'report_type', 'aircraft_type')
        }),
        ('Location', {
            'fields': ('location', 'latitude', 'longitude', 'flight_level', 'altitude_ft')
        }),
        ('Time', {
            'fields': ('observation_time',)
        }),
        ('Turbulence', {
            'fields': ('turbulence_type', 'turbulence_freq', 'turbulence_base_ft', 'turbulence_top_ft')
        }),
        ('Icing', {
            'fields': ('icing_type', 'icing_intensity', 'icing_base_ft', 'icing_top_ft')
        }),
        ('Weather', {
            'fields': ('sky_cover', 'visibility_sm', 'weather', 'temperature_c', 'wind_dir', 'wind_speed_kt')
        }),
        ('Archive', {
            'fields': ('is_archived', 'archived_at', 'archive_reason')
        }),
    )

    actions = [archive_selected, unarchive_selected, 'export_as_csv']
