"""
Django admin classes for SkySpy engagement tracking models.
"""
from django.contrib import admin

from skyspy.models import AircraftFavorite, SessionTrackingQuality
from skyspy.admin.filters import DateRangeFilter, QualityGradeFilter


class CreatedAtDateRangeFilter(DateRangeFilter):
    """Date range filter for created_at field."""
    title = 'created at'
    parameter_name = 'created_at_range'
    date_field = 'created_at'


class CompletenessScoreFilter(admin.SimpleListFilter):
    """Filter by completeness score range."""
    title = 'completeness score'
    parameter_name = 'completeness_range'

    def lookups(self, request, model_admin):
        return (
            ('90_100', '90-100% (Excellent)'),
            ('70_89', '70-89% (Good)'),
            ('50_69', '50-69% (Fair)'),
            ('0_49', '0-49% (Poor)'),
        )

    def queryset(self, request, queryset):
        if self.value() == '90_100':
            return queryset.filter(completeness_score__gte=90)
        elif self.value() == '70_89':
            return queryset.filter(completeness_score__gte=70, completeness_score__lt=90)
        elif self.value() == '50_69':
            return queryset.filter(completeness_score__gte=50, completeness_score__lt=70)
        elif self.value() == '0_49':
            return queryset.filter(completeness_score__lt=50)
        return queryset


@admin.register(AircraftFavorite)
class AircraftFavoriteAdmin(admin.ModelAdmin):
    """Admin for AircraftFavorite model."""
    list_display = (
        'icao_hex', 'registration', 'user', 'session_key_display',
        'times_seen', 'last_seen_at', 'notify_on_detection'
    )
    list_filter = ('notify_on_detection', CreatedAtDateRangeFilter)
    search_fields = ('icao_hex', 'registration', 'callsign', 'user__username', 'notes')
    fieldsets = (
        (None, {
            'fields': ('icao_hex', 'registration', 'callsign')
        }),
        ('Owner', {
            'fields': ('user', 'session_key'),
        }),
        ('Notes', {
            'fields': ('notes',),
        }),
        ('Stats', {
            'fields': ('times_seen', 'last_seen_at', 'total_tracking_minutes'),
        }),
        ('Notifications', {
            'fields': ('notify_on_detection',),
        }),
    )
    raw_id_fields = ('user',)

    @admin.display(description='Session Key')
    def session_key_display(self, obj):
        """Display truncated session key (first 8 characters)."""
        if obj.session_key:
            return obj.session_key[:8] + '...'
        return '-'


@admin.register(SessionTrackingQuality)
class SessionTrackingQualityAdmin(admin.ModelAdmin):
    """Admin for SessionTrackingQuality model."""
    list_display = (
        'session', 'quality_grade', 'completeness_score',
        'actual_positions', 'total_gaps', 'max_gap_seconds'
    )
    list_filter = (QualityGradeFilter, CompletenessScoreFilter)
    search_fields = ('session__icao_hex',)
    fieldsets = (
        ('Session', {
            'fields': ('session',),
        }),
        ('Position Metrics', {
            'fields': (
                'expected_positions', 'actual_positions',
                'completeness_score', 'avg_update_rate'
            ),
        }),
        ('Gap Metrics', {
            'fields': (
                'total_gaps', 'max_gap_seconds',
                'avg_gap_seconds', 'gap_percentage'
            ),
        }),
        ('Signal Quality', {
            'fields': ('avg_rssi', 'rssi_variance'),
        }),
        ('Grade', {
            'fields': ('quality_grade', 'calculated_at'),
        }),
    )

    def get_readonly_fields(self, request, obj=None):
        """Make all fields readonly since quality metrics are calculated."""
        if obj:
            return (
                'session', 'expected_positions', 'actual_positions',
                'completeness_score', 'avg_update_rate', 'total_gaps',
                'max_gap_seconds', 'avg_gap_seconds', 'gap_percentage',
                'avg_rssi', 'rssi_variance', 'quality_grade', 'calculated_at'
            )
        return ()

    def has_add_permission(self, request):
        """Prevent manual creation since metrics are calculated."""
        return False
