"""
ACARS/VDL2 message model for aircraft data link communications.
"""
from django.db import models


class AcarsMessage(models.Model):
    """ACARS and VDL2 messages received from aircraft."""

    SOURCE_CHOICES = [
        ('acars', 'ACARS'),
        ('vdlm2', 'VDL Mode 2'),
    ]

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    # Message source
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='acars')
    channel = models.CharField(max_length=10, blank=True, null=True)
    frequency = models.FloatField(blank=True, null=True)

    # Aircraft identification
    icao_hex = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    registration = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True, db_index=True)

    # Message content
    label = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    block_id = models.CharField(max_length=5, blank=True, null=True)
    msg_num = models.CharField(max_length=10, blank=True, null=True)
    ack = models.CharField(max_length=5, blank=True, null=True)
    mode = models.CharField(max_length=5, blank=True, null=True)
    text = models.TextField(blank=True, null=True)

    # Decoded content (for known message types)
    decoded = models.JSONField(blank=True, null=True)

    # Signal info
    signal_level = models.FloatField(blank=True, null=True)
    error_count = models.IntegerField(blank=True, null=True)

    # Station info
    station_id = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'acars_messages'
        indexes = [
            models.Index(fields=['icao_hex', 'timestamp'], name='idx_acars_icao_time'),
            models.Index(fields=['label', 'timestamp'], name='idx_acars_label'),
        ]
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.source.upper()} {self.label or 'N/A'} - {self.icao_hex} @ {self.timestamp}"
