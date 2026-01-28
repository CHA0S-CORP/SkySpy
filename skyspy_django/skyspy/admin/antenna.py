"""
Django admin configuration for antenna analytics models.
"""
from django.contrib import admin

from skyspy.models import AntennaAnalyticsSnapshot
from skyspy.admin.filters import TimestampDateRangeFilter


@admin.register(AntennaAnalyticsSnapshot)
class AntennaAnalyticsSnapshotAdmin(admin.ModelAdmin):
    """Admin for antenna performance analytics snapshots."""

    list_display = [
        'timestamp', 'snapshot_type', 'max_range_nm', 'avg_range_nm',
        'unique_aircraft', 'performance_score', 'coverage_percentage'
    ]
    list_filter = ['snapshot_type', TimestampDateRangeFilter]
    date_hierarchy = 'timestamp'
    ordering = ['-timestamp']

    fieldsets = (
        ('Snapshot Info', {
            'fields': ('timestamp', 'snapshot_type', 'window_hours')
        }),
        ('Range Statistics', {
            'fields': (
                'max_range_nm', 'avg_range_nm', 'min_range_nm',
                'range_p50_nm', 'range_p75_nm', 'range_p90_nm', 'range_p95_nm'
            )
        }),
        ('Signal Statistics', {
            'fields': ('best_rssi', 'avg_rssi', 'worst_rssi')
        }),
        ('Coverage Statistics', {
            'fields': (
                'total_positions', 'unique_aircraft', 'positions_per_hour',
                'sectors_with_data', 'coverage_percentage', 'range_by_direction'
            )
        }),
        ('Performance', {
            'fields': ('estimated_gain_db', 'performance_score')
        }),
    )

    readonly_fields = [
        'timestamp', 'snapshot_type', 'window_hours',
        'max_range_nm', 'avg_range_nm', 'min_range_nm',
        'range_p50_nm', 'range_p75_nm', 'range_p90_nm', 'range_p95_nm',
        'best_rssi', 'avg_rssi', 'worst_rssi',
        'total_positions', 'unique_aircraft', 'positions_per_hour',
        'sectors_with_data', 'coverage_percentage', 'range_by_direction',
        'estimated_gain_db', 'performance_score'
    ]

    def has_add_permission(self, request):
        """Disable adding - snapshots are created automatically."""
        return False

    def has_change_permission(self, request, obj=None):
        """Disable editing - snapshots are readonly."""
        return False

    def has_delete_permission(self, request, obj=None):
        """Allow deleting old snapshots for cleanup."""
        return True
