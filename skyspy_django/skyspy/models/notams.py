"""
NOTAM (Notice to Air Missions) models.

Stores cached NOTAM and TFR data from FAA Aviation Weather API.
"""
from django.db import models


class CachedNotam(models.Model):
    """Cached NOTAM data from FAA Aviation Weather Center."""

    NOTAM_TYPES = [
        ('D', 'NOTAM D'),
        ('FDC', 'FDC NOTAM'),
        ('TFR', 'Temporary Flight Restriction'),
        ('GPS', 'GPS NOTAM'),
        ('MIL', 'Military NOTAM'),
        ('POINTER', 'Pointer NOTAM'),
    ]

    CLASSIFICATION_CHOICES = [
        ('FDC', 'Flight Data Center'),
        ('INTL', 'International'),
        ('DOM', 'Domestic'),
        ('MIL', 'Military'),
    ]

    # NOTAM identification
    notam_id = models.CharField(max_length=50, unique=True, db_index=True)
    notam_type = models.CharField(max_length=10, choices=NOTAM_TYPES, db_index=True)
    classification = models.CharField(
        max_length=20,
        choices=CLASSIFICATION_CHOICES,
        blank=True, null=True
    )

    # Location
    location = models.CharField(max_length=10, db_index=True)  # ICAO identifier
    latitude = models.FloatField(blank=True, null=True, db_index=True)
    longitude = models.FloatField(blank=True, null=True, db_index=True)
    radius_nm = models.FloatField(blank=True, null=True)  # For TFRs

    # Altitude restrictions (for TFRs)
    floor_ft = models.IntegerField(blank=True, null=True)
    ceiling_ft = models.IntegerField(blank=True, null=True)

    # Time validity
    effective_start = models.DateTimeField(db_index=True)
    effective_end = models.DateTimeField(blank=True, null=True, db_index=True)
    is_permanent = models.BooleanField(default=False)

    # NOTAM content
    text = models.TextField()
    raw_text = models.TextField(blank=True, null=True)
    keywords = models.JSONField(blank=True, null=True)  # Extracted keywords

    # TFR specific fields
    geometry = models.JSONField(blank=True, null=True)  # GeoJSON for TFR boundaries
    reason = models.CharField(max_length=200, blank=True, null=True)  # VIP, disaster, etc.

    # Metadata
    source_data = models.JSONField(blank=True, null=True)  # Raw API response
    fetched_at = models.DateTimeField(auto_now=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Archive fields
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(blank=True, null=True, db_index=True)
    archive_reason = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'cached_notams'
        indexes = [
            models.Index(fields=['location', 'effective_start'], name='idx_notam_loc_start'),
            models.Index(fields=['notam_type', 'effective_start'], name='idx_notam_type_start'),
            models.Index(fields=['latitude', 'longitude'], name='idx_notam_location'),
            models.Index(fields=['effective_end', 'effective_start'], name='idx_notam_validity'),
            models.Index(fields=['is_archived', 'archived_at'], name='idx_notam_archive'),
        ]
        ordering = ['-effective_start']

    def __str__(self):
        return f"{self.notam_type} {self.notam_id} - {self.location}"

    @property
    def is_active(self):
        """Check if NOTAM is currently active."""
        from django.utils import timezone
        now = timezone.now()
        if self.effective_start > now:
            return False
        if self.effective_end and self.effective_end < now:
            return False
        return True

    @property
    def is_tfr(self):
        """Check if this is a TFR NOTAM."""
        return self.notam_type == 'TFR' or (self.geometry is not None)


class CachedAirline(models.Model):
    """Cached airline data from OpenFlights database."""

    icao_code = models.CharField(max_length=4, unique=True, db_index=True)
    iata_code = models.CharField(max_length=3, blank=True, null=True, db_index=True)
    name = models.CharField(max_length=200)
    callsign = models.CharField(max_length=100, blank=True, null=True)
    country = models.CharField(max_length=100, blank=True, null=True)
    active = models.BooleanField(default=True)

    # Metadata
    source_data = models.JSONField(blank=True, null=True)
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cached_airlines'
        indexes = [
            models.Index(fields=['iata_code'], name='idx_airline_iata'),
            models.Index(fields=['callsign'], name='idx_airline_callsign'),
        ]

    def __str__(self):
        return f"{self.icao_code} - {self.name}"


class CachedAircraftType(models.Model):
    """Cached aircraft type data from OpenFlights database."""

    icao_code = models.CharField(max_length=10, unique=True, db_index=True)
    iata_code = models.CharField(max_length=5, blank=True, null=True, db_index=True)
    name = models.CharField(max_length=200)
    manufacturer = models.CharField(max_length=100, blank=True, null=True)

    # Metadata
    source_data = models.JSONField(blank=True, null=True)
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cached_aircraft_types'
        indexes = [
            models.Index(fields=['iata_code'], name='idx_actype_iata'),
            models.Index(fields=['manufacturer'], name='idx_actype_mfr'),
        ]

    def __str__(self):
        return f"{self.icao_code} - {self.name}"
