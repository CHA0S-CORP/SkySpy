"""
Django admin configuration for aircraft-related models.
"""
from django.contrib import admin, messages
from django.utils.html import format_html

from skyspy.models import AircraftSighting, AircraftSession, AircraftInfo
from skyspy.models.engagement import SessionTrackingQuality
from skyspy.admin.filters import TimestampDateRangeFilter, DateRangeFilter, MilitaryFilter


class FirstSeenDateRangeFilter(DateRangeFilter):
    """Date range filter using 'first_seen' field."""
    date_field = 'first_seen'


class SessionTrackingQualityInline(admin.TabularInline):
    """Inline for session tracking quality metrics."""
    model = SessionTrackingQuality
    extra = 0
    readonly_fields = [
        'expected_positions', 'actual_positions', 'completeness_score',
        'avg_update_rate', 'total_gaps', 'max_gap_seconds', 'avg_gap_seconds',
        'gap_percentage', 'avg_rssi', 'rssi_variance', 'quality_grade'
    ]
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(AircraftSighting)
class AircraftSightingAdmin(admin.ModelAdmin):
    """Admin for individual aircraft position reports."""

    list_display = [
        'timestamp', 'icao_hex', 'callsign', 'altitude_baro',
        'ground_speed', 'distance_nm', 'is_military', 'is_emergency', 'source'
    ]
    list_filter = ['is_military', 'is_emergency', 'source', TimestampDateRangeFilter]
    search_fields = ['icao_hex', 'callsign']
    date_hierarchy = 'timestamp'
    readonly_fields = ['timestamp']
    ordering = ['-timestamp']

    fieldsets = (
        ('Identification', {
            'fields': ('timestamp', 'icao_hex', 'callsign', 'squawk', 'source')
        }),
        ('Position', {
            'fields': ('latitude', 'longitude', 'altitude_baro', 'altitude_geom', 'distance_nm')
        }),
        ('Flight Data', {
            'fields': ('ground_speed', 'track', 'vertical_rate')
        }),
        ('Signal', {
            'fields': ('rssi',)
        }),
        ('Classification', {
            'fields': ('category', 'aircraft_type', 'is_military', 'is_emergency')
        }),
    )


@admin.register(AircraftSession)
class AircraftSessionAdmin(admin.ModelAdmin):
    """Admin for continuous aircraft tracking sessions."""

    list_display = [
        'icao_hex', 'callsign', 'first_seen', 'last_seen',
        'duration_display', 'total_positions', 'is_military'
    ]
    list_filter = ['is_military', FirstSeenDateRangeFilter]
    search_fields = ['icao_hex', 'callsign']
    date_hierarchy = 'first_seen'
    ordering = ['-last_seen']

    inlines = [SessionTrackingQualityInline]

    fieldsets = (
        ('Identification', {
            'fields': ('icao_hex', 'callsign', 'category', 'aircraft_type', 'is_military')
        }),
        ('Timing', {
            'fields': ('first_seen', 'last_seen', 'total_positions')
        }),
        ('Altitude Range', {
            'fields': ('min_altitude', 'max_altitude')
        }),
        ('Distance Range', {
            'fields': ('min_distance_nm', 'max_distance_nm')
        }),
        ('Signal Quality', {
            'fields': ('min_rssi', 'max_rssi', 'max_vertical_rate')
        }),
    )

    @admin.display(description='Duration')
    def duration_display(self, obj):
        """Display session duration in human-readable format."""
        if obj.first_seen and obj.last_seen:
            duration = obj.last_seen - obj.first_seen
            total_seconds = int(duration.total_seconds())
            hours, remainder = divmod(total_seconds, 3600)
            minutes, seconds = divmod(remainder, 60)
            if hours > 0:
                return f"{hours}h {minutes}m {seconds}s"
            elif minutes > 0:
                return f"{minutes}m {seconds}s"
            else:
                return f"{seconds}s"
        return "-"


@admin.register(AircraftInfo)
class AircraftInfoAdmin(admin.ModelAdmin):
    """Admin for cached aircraft information."""

    list_display = [
        'icao_hex', 'registration', 'type_code', 'manufacturer',
        'operator', 'is_military', 'photo_thumbnail_display'
    ]
    list_filter = ['is_military', 'is_interesting', 'is_pia', 'is_ladd']
    search_fields = ['icao_hex', 'registration', 'operator']
    ordering = ['-updated_at']

    actions = ['refresh_aircraft_info']

    fieldsets = (
        ('Identification', {
            'fields': (
                'icao_hex', 'registration', 'source',
                'type_code', 'type_name', 'manufacturer', 'model', 'serial_number'
            )
        }),
        ('History', {
            'fields': ('year_built', 'first_flight_date', 'delivery_date', 'airframe_hours')
        }),
        ('Operator', {
            'fields': (
                'operator', 'operator_icao', 'operator_callsign',
                'owner', 'city', 'state', 'country', 'country_code'
            )
        }),
        ('Flags', {
            'fields': ('category', 'is_military', 'is_interesting', 'is_pia', 'is_ladd')
        }),
        ('Photos', {
            'fields': (
                'photo_url', 'photo_thumbnail_url',
                'photo_photographer', 'photo_source', 'photo_page_link',
                'photo_local_path', 'photo_thumbnail_local_path'
            )
        }),
        ('Cache', {
            'fields': ('extra_data', 'created_at', 'updated_at', 'fetch_failed'),
            'classes': ('collapse',)
        }),
    )

    readonly_fields = ['created_at', 'updated_at']

    @admin.display(description='Photo')
    def photo_thumbnail_display(self, obj):
        """Display photo thumbnail preview."""
        if obj.photo_thumbnail_url:
            return format_html(
                '<img src="{}" style="max-width: 60px; max-height: 40px; object-fit: cover;" />',
                obj.photo_thumbnail_url
            )
        elif obj.photo_url:
            return format_html(
                '<img src="{}" style="max-width: 60px; max-height: 40px; object-fit: cover;" />',
                obj.photo_url
            )
        return "-"

    @admin.action(description="Refresh aircraft info from external sources")
    def refresh_aircraft_info(self, request, queryset):
        """Queue selected aircraft for info refresh."""
        from skyspy.services.aircraft_info import AircraftInfoService

        service = AircraftInfoService()
        refreshed = 0
        failed = 0

        for aircraft_info in queryset:
            try:
                service.refresh_info(aircraft_info.icao_hex)
                refreshed += 1
            except Exception:
                failed += 1

        if refreshed > 0:
            self.message_user(
                request,
                f"Successfully refreshed info for {refreshed} aircraft.",
                messages.SUCCESS
            )
        if failed > 0:
            self.message_user(
                request,
                f"Failed to refresh info for {failed} aircraft.",
                messages.WARNING
            )
