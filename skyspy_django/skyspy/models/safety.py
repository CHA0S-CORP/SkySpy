"""
Safety event model for TCAS conflicts and dangerous flight parameters.
"""
from django.db import models


class SafetyEvent(models.Model):
    """Safety events including TCAS conflicts and dangerous flight parameters."""

    EVENT_TYPES = [
        ('tcas_ra', 'TCAS Resolution Advisory'),
        ('tcas_ta', 'TCAS Traffic Advisory'),
        ('extreme_vs', 'Extreme Vertical Speed'),
        ('vs_reversal', 'Vertical Speed Reversal'),
        ('proximity_conflict', 'Proximity Conflict'),
        ('emergency_squawk', 'Emergency Squawk'),
        ('7500', 'Squawk 7500 (Hijack)'),
        ('7600', 'Squawk 7600 (Radio Failure)'),
        ('7700', 'Squawk 7700 (Emergency)'),
    ]

    SEVERITY_CHOICES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    event_type = models.CharField(max_length=50, choices=EVENT_TYPES, db_index=True)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default='warning')
    icao_hex = models.CharField(max_length=10, db_index=True)
    icao_hex_2 = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    callsign_2 = models.CharField(max_length=10, blank=True, null=True)
    message = models.TextField(blank=True, null=True)
    details = models.JSONField(blank=True, null=True)
    aircraft_snapshot = models.JSONField(blank=True, null=True)  # Telemetry at event time
    aircraft_snapshot_2 = models.JSONField(blank=True, null=True)  # Second aircraft (proximity)
    acknowledged = models.BooleanField(default=False)
    acknowledged_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'safety_events'
        indexes = [
            models.Index(fields=['event_type', 'timestamp'], name='idx_safety_events_type_time'),
        ]
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.event_type} - {self.icao_hex} @ {self.timestamp}"
