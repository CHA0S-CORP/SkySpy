"""
Antenna analytics models for tracking antenna performance over time.
"""
from django.db import models


class AntennaAnalyticsSnapshot(models.Model):
    """
    Periodic snapshot of antenna performance metrics.

    Stores aggregated analytics every 5 minutes for historical trending
    and performance analysis.
    """

    SNAPSHOT_TYPES = [
        ('scheduled', 'Scheduled (5 min)'),
        ('hourly', 'Hourly Aggregate'),
        ('daily', 'Daily Aggregate'),
    ]

    timestamp = models.DateTimeField(db_index=True)
    snapshot_type = models.CharField(
        max_length=20,
        choices=SNAPSHOT_TYPES,
        default='scheduled',
        db_index=True
    )

    # Time window for this snapshot
    window_hours = models.FloatField(default=1.0)

    # Overall range statistics
    max_range_nm = models.FloatField(blank=True, null=True)
    avg_range_nm = models.FloatField(blank=True, null=True)
    min_range_nm = models.FloatField(blank=True, null=True)

    # Range percentiles
    range_p50_nm = models.FloatField(blank=True, null=True)
    range_p75_nm = models.FloatField(blank=True, null=True)
    range_p90_nm = models.FloatField(blank=True, null=True)
    range_p95_nm = models.FloatField(blank=True, null=True)

    # Signal strength (RSSI) statistics
    best_rssi = models.FloatField(blank=True, null=True)  # Least negative
    avg_rssi = models.FloatField(blank=True, null=True)
    worst_rssi = models.FloatField(blank=True, null=True)  # Most negative

    # Coverage statistics
    total_positions = models.IntegerField(default=0)
    unique_aircraft = models.IntegerField(default=0)
    positions_per_hour = models.FloatField(default=0)

    # Direction-based range data (JSON object with 12 sectors: 0, 30, 60, ... 330)
    # Each sector contains: max_range, avg_range, position_count, unique_aircraft
    range_by_direction = models.JSONField(default=dict, blank=True)

    # Coverage analysis
    sectors_with_data = models.IntegerField(default=0)  # Out of 12
    coverage_percentage = models.FloatField(default=0)  # 0-100

    # Performance indicators
    estimated_gain_db = models.FloatField(blank=True, null=True)
    performance_score = models.FloatField(blank=True, null=True)  # 0-100

    class Meta:
        db_table = 'antenna_analytics_snapshots'
        indexes = [
            models.Index(fields=['timestamp', 'snapshot_type'], name='idx_antenna_snap_time_type'),
        ]
        ordering = ['-timestamp']

    def __str__(self):
        return f"Antenna snapshot @ {self.timestamp} ({self.snapshot_type})"

    @classmethod
    def get_latest(cls, snapshot_type='scheduled'):
        """Get the most recent snapshot of the given type."""
        return cls.objects.filter(snapshot_type=snapshot_type).first()

    @classmethod
    def get_range(cls, start_time, end_time, snapshot_type='scheduled'):
        """Get snapshots within a time range."""
        return cls.objects.filter(
            timestamp__gte=start_time,
            timestamp__lte=end_time,
            snapshot_type=snapshot_type
        ).order_by('timestamp')

    def to_dict(self):
        """Convert snapshot to dictionary for API responses."""
        return {
            'timestamp': self.timestamp.isoformat() + 'Z',
            'snapshot_type': self.snapshot_type,
            'window_hours': self.window_hours,
            'range': {
                'max_nm': self.max_range_nm,
                'avg_nm': self.avg_range_nm,
                'min_nm': self.min_range_nm,
                'p50_nm': self.range_p50_nm,
                'p75_nm': self.range_p75_nm,
                'p90_nm': self.range_p90_nm,
                'p95_nm': self.range_p95_nm,
            },
            'signal': {
                'best_rssi': self.best_rssi,
                'avg_rssi': self.avg_rssi,
                'worst_rssi': self.worst_rssi,
            },
            'coverage': {
                'total_positions': self.total_positions,
                'unique_aircraft': self.unique_aircraft,
                'positions_per_hour': self.positions_per_hour,
                'sectors_with_data': self.sectors_with_data,
                'coverage_percentage': self.coverage_percentage,
            },
            'range_by_direction': self.range_by_direction,
            'performance': {
                'estimated_gain_db': self.estimated_gain_db,
                'performance_score': self.performance_score,
            }
        }
