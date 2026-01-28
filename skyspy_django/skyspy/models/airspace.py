"""
Airspace models for advisories (G-AIRMETs, SIGMETs) and static boundaries (Class B/C/D).
"""
from django.db import models
from django.core.exceptions import ValidationError


class AirspaceAdvisory(models.Model):
    """Active airspace advisories (G-AIRMETs, SIGMETs) from Aviation Weather Center."""

    ADVISORY_TYPES = [
        ('GAIRMET', 'G-AIRMET'),
        ('SIGMET', 'SIGMET'),
        ('CONVECTIVE_SIGMET', 'Convective SIGMET'),
        ('CWA', 'Center Weather Advisory'),
        ('AIRMET', 'AIRMET'),
    ]

    HAZARD_TYPES = [
        ('IFR', 'IFR Conditions'),
        ('TURB', 'Turbulence'),
        ('TURB-LO', 'Low-Level Turbulence'),
        ('TURB-HI', 'High-Level Turbulence'),
        ('ICE', 'Icing'),
        ('MT_OBSC', 'Mountain Obscuration'),
        ('SFC_WND', 'Surface Wind'),
        ('LLWS', 'Low-Level Wind Shear'),
        ('TS', 'Thunderstorm'),
        ('VOLCANIC_ASH', 'Volcanic Ash'),
        ('TROPICAL_CYCLONE', 'Tropical Cyclone'),
    ]

    fetched_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Advisory identification
    advisory_id = models.CharField(max_length=50, db_index=True)
    advisory_type = models.CharField(max_length=20, choices=ADVISORY_TYPES, db_index=True)
    hazard = models.CharField(max_length=20, choices=HAZARD_TYPES, blank=True, null=True, db_index=True)
    severity = models.CharField(max_length=20, blank=True, null=True)

    # Time validity
    valid_from = models.DateTimeField(blank=True, null=True, db_index=True)
    valid_to = models.DateTimeField(blank=True, null=True, db_index=True)

    # Altitude range
    lower_alt_ft = models.IntegerField(blank=True, null=True)
    upper_alt_ft = models.IntegerField(blank=True, null=True)

    # Geographic info
    region = models.CharField(max_length=20, blank=True, null=True)
    polygon = models.JSONField(blank=True, null=True)  # GeoJSON polygon coordinates

    # Raw data
    raw_text = models.TextField(blank=True, null=True)
    source_data = models.JSONField(blank=True, null=True)

    class Meta:
        db_table = 'airspace_advisories'
        indexes = [
            models.Index(fields=['valid_from', 'valid_to'], name='idx_airspace_advisory_valid'),
            models.Index(fields=['advisory_type', 'hazard'], name='idx_airspace_advisory_type'),
        ]
        ordering = ['-fetched_at']

    def __str__(self):
        return f"{self.advisory_type} {self.hazard or ''} - {self.advisory_id}"

    def clean(self):
        if self.lower_alt_ft is not None and self.upper_alt_ft is not None:
            if self.upper_alt_ft < self.lower_alt_ft:
                raise ValidationError({'upper_alt_ft': 'Upper altitude must be greater than or equal to lower altitude'})


class AirspaceBoundary(models.Model):
    """Static airspace boundary data (Class B/C/D, MOAs, Restricted)."""

    AIRSPACE_CLASSES = [
        ('B', 'Class B'),
        ('C', 'Class C'),
        ('D', 'Class D'),
        ('E', 'Class E'),
        ('MOA', 'Military Operations Area'),
        ('RESTRICTED', 'Restricted'),
        ('PROHIBITED', 'Prohibited'),
        ('WARNING', 'Warning'),
        ('ALERT', 'Alert'),
        ('TFR', 'Temporary Flight Restriction'),
    ]

    SOURCE_CHOICES = [
        ('faa', 'FAA'),
        ('openaip', 'OpenAIP'),
        ('embedded', 'Embedded'),
    ]

    fetched_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Airspace identification
    name = models.CharField(max_length=100)
    icao = models.CharField(max_length=4, blank=True, null=True, db_index=True)
    airspace_class = models.CharField(max_length=20, choices=AIRSPACE_CLASSES, db_index=True)

    # Altitude range
    floor_ft = models.IntegerField(default=0)
    ceiling_ft = models.IntegerField(default=0)

    # Geographic info
    center_lat = models.FloatField(db_index=True)
    center_lon = models.FloatField(db_index=True)
    radius_nm = models.FloatField(blank=True, null=True)  # For circular airspaces (Class D)
    polygon = models.JSONField(blank=True, null=True)  # GeoJSON polygon coordinates

    # Additional info
    controlling_agency = models.CharField(max_length=100, blank=True, null=True)
    schedule = models.CharField(max_length=200, blank=True, null=True)

    # Source tracking
    source = models.CharField(max_length=50, choices=SOURCE_CHOICES, default='faa')
    source_id = models.CharField(max_length=100, blank=True, null=True)  # External ID

    # Cache management
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'airspace_boundaries'
        indexes = [
            models.Index(fields=['airspace_class'], name='idx_airspace_boundary_class'),
            models.Index(fields=['center_lat', 'center_lon'], name='idx_airspace_boundary_loc'),
        ]

    def __str__(self):
        return f"{self.airspace_class} - {self.name}"

    def clean(self):
        if self.ceiling_ft < self.floor_ft:
            raise ValidationError({'ceiling_ft': 'Ceiling altitude must be greater than or equal to floor altitude'})
