"""
Aviation data models for airports, navaids, GeoJSON overlays, and PIREPs.
"""
from django.db import models


class CachedAirport(models.Model):
    """Cached airport data from Aviation Weather Center."""

    AIRPORT_TYPES = [
        ('large_airport', 'Large Airport'),
        ('medium_airport', 'Medium Airport'),
        ('small_airport', 'Small Airport'),
        ('closed', 'Closed'),
        ('heliport', 'Heliport'),
        ('seaplane_base', 'Seaplane Base'),
        ('balloonport', 'Balloonport'),
    ]

    fetched_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Airport identification
    icao_id = models.CharField(max_length=4, unique=True, db_index=True)
    name = models.CharField(max_length=200, blank=True, null=True)

    # Location
    latitude = models.FloatField(db_index=True)
    longitude = models.FloatField(db_index=True)
    elevation_ft = models.IntegerField(blank=True, null=True)

    # Type and classification
    airport_type = models.CharField(max_length=50, choices=AIRPORT_TYPES, blank=True, null=True)
    country = models.CharField(max_length=100, blank=True, null=True)
    region = models.CharField(max_length=100, blank=True, null=True)

    # Additional data
    source_data = models.JSONField(blank=True, null=True)

    class Meta:
        db_table = 'cached_airports'
        indexes = [
            models.Index(fields=['latitude', 'longitude'], name='idx_cached_airport_location'),
        ]

    def __str__(self):
        return f"{self.icao_id} - {self.name}"


class CachedNavaid(models.Model):
    """Cached navigation aid data from Aviation Weather Center."""

    NAVAID_TYPES = [
        ('VOR', 'VOR'),
        ('VORTAC', 'VORTAC'),
        ('VOR-DME', 'VOR-DME'),
        ('TACAN', 'TACAN'),
        ('NDB', 'NDB'),
        ('NDB-DME', 'NDB-DME'),
        ('DME', 'DME'),
        ('ILS', 'ILS'),
        ('LOC', 'Localizer'),
        ('GS', 'Glideslope'),
        ('OM', 'Outer Marker'),
        ('MM', 'Middle Marker'),
        ('IM', 'Inner Marker'),
    ]

    fetched_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Navaid identification
    ident = models.CharField(max_length=10, db_index=True)
    name = models.CharField(max_length=100, blank=True, null=True)
    navaid_type = models.CharField(max_length=20, choices=NAVAID_TYPES, blank=True, null=True, db_index=True)

    # Location
    latitude = models.FloatField(db_index=True)
    longitude = models.FloatField(db_index=True)

    # Technical details
    frequency = models.FloatField(blank=True, null=True)
    channel = models.CharField(max_length=10, blank=True, null=True)

    # Additional data
    source_data = models.JSONField(blank=True, null=True)

    class Meta:
        db_table = 'cached_navaids'
        indexes = [
            models.Index(fields=['latitude', 'longitude'], name='idx_cached_navaid_location'),
            models.Index(fields=['ident', 'navaid_type'], name='idx_cached_navaid_ident_type'),
        ]

    def __str__(self):
        return f"{self.ident} ({self.navaid_type})"


class CachedGeoJSON(models.Model):
    """Cached GeoJSON data for map overlays (states, countries, water bodies)."""

    DATA_TYPES = [
        ('states', 'US States'),
        ('countries', 'Countries'),
        ('water', 'Water Bodies'),
        ('roads', 'Roads'),
        ('terrain', 'Terrain'),
    ]

    fetched_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Data identification
    data_type = models.CharField(max_length=50, choices=DATA_TYPES, db_index=True)
    name = models.CharField(max_length=100, db_index=True)
    code = models.CharField(max_length=10, blank=True, null=True, db_index=True)  # State/country code

    # Bounding box for spatial queries
    bbox_min_lat = models.FloatField(blank=True, null=True)
    bbox_max_lat = models.FloatField(blank=True, null=True)
    bbox_min_lon = models.FloatField(blank=True, null=True)
    bbox_max_lon = models.FloatField(blank=True, null=True)

    # GeoJSON geometry
    geometry = models.JSONField()  # GeoJSON geometry object
    properties = models.JSONField(blank=True, null=True)  # Feature properties

    class Meta:
        db_table = 'cached_geojson'
        indexes = [
            models.Index(fields=['data_type', 'name'], name='idx_cached_geojson_type_name'),
            models.Index(
                fields=['bbox_min_lat', 'bbox_max_lat', 'bbox_min_lon', 'bbox_max_lon'],
                name='idx_cached_geojson_bbox'
            ),
        ]

    def __str__(self):
        return f"{self.data_type} - {self.name}"


class CachedPirep(models.Model):
    """Cached Pilot Reports (PIREPs) from Aviation Weather Center."""

    REPORT_TYPES = [
        ('UA', 'Routine'),
        ('UUA', 'Urgent'),
    ]

    TURBULENCE_TYPES = [
        ('NEG', 'Negative'),
        ('LGT', 'Light'),
        ('LGT-MOD', 'Light to Moderate'),
        ('MOD', 'Moderate'),
        ('MOD-SEV', 'Moderate to Severe'),
        ('SEV', 'Severe'),
        ('EXTRM', 'Extreme'),
    ]

    ICING_TYPES = [
        ('NEG', 'Negative'),
        ('TRC', 'Trace'),
        ('TRC-LGT', 'Trace to Light'),
        ('LGT', 'Light'),
        ('LGT-MOD', 'Light to Moderate'),
        ('MOD', 'Moderate'),
        ('MOD-SEV', 'Moderate to Severe'),
        ('SEV', 'Severe'),
    ]

    fetched_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # PIREP identification
    pirep_id = models.CharField(max_length=100, unique=True, db_index=True)
    report_type = models.CharField(max_length=10, choices=REPORT_TYPES, default='UA', db_index=True)

    # Location
    latitude = models.FloatField(blank=True, null=True, db_index=True)
    longitude = models.FloatField(blank=True, null=True, db_index=True)
    location = models.CharField(max_length=50, blank=True, null=True)  # e.g., "KSEA"

    # Time
    observation_time = models.DateTimeField(blank=True, null=True, db_index=True)

    # Flight level/altitude
    flight_level = models.IntegerField(blank=True, null=True)  # FL350 = 350
    altitude_ft = models.IntegerField(blank=True, null=True)

    # Aircraft info
    aircraft_type = models.CharField(max_length=10, blank=True, null=True)

    # Weather conditions
    turbulence_type = models.CharField(
        max_length=20,
        choices=TURBULENCE_TYPES,
        blank=True, null=True,
        db_index=True
    )
    turbulence_freq = models.CharField(max_length=20, blank=True, null=True)
    turbulence_base_ft = models.IntegerField(blank=True, null=True)
    turbulence_top_ft = models.IntegerField(blank=True, null=True)

    icing_type = models.CharField(
        max_length=20,
        choices=ICING_TYPES,
        blank=True, null=True,
        db_index=True
    )
    icing_intensity = models.CharField(max_length=20, blank=True, null=True)
    icing_base_ft = models.IntegerField(blank=True, null=True)
    icing_top_ft = models.IntegerField(blank=True, null=True)

    sky_cover = models.CharField(max_length=100, blank=True, null=True)
    visibility_sm = models.FloatField(blank=True, null=True)
    weather = models.CharField(max_length=100, blank=True, null=True)
    temperature_c = models.IntegerField(blank=True, null=True)
    wind_dir = models.IntegerField(blank=True, null=True)
    wind_speed_kt = models.IntegerField(blank=True, null=True)

    # Raw data
    raw_text = models.TextField(blank=True, null=True)
    source_data = models.JSONField(blank=True, null=True)

    # Archive fields
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(blank=True, null=True, db_index=True)
    archive_reason = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'cached_pireps'
        indexes = [
            models.Index(fields=['latitude', 'longitude'], name='idx_cached_pirep_location'),
            models.Index(fields=['observation_time'], name='idx_cached_pirep_time'),
            models.Index(fields=['turbulence_type', 'icing_type'], name='idx_cached_pirep_conditions'),
            models.Index(fields=['is_archived', 'archived_at'], name='idx_pirep_archive'),
        ]
        ordering = ['-observation_time']

    def __str__(self):
        return f"{self.report_type} {self.pirep_id}"
