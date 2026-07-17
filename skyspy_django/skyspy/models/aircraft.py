"""
Aircraft-related models for position tracking, sessions, and cached aircraft information.
"""

from django.db import models


class AircraftSighting(models.Model):
    """Individual aircraft position reports."""

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    icao_hex = models.CharField(max_length=10, null=False, db_index=True)  # TIS-B can have ~ prefix
    callsign = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    squawk = models.CharField(max_length=4, blank=True, null=True)
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    altitude_baro = models.IntegerField(blank=True, null=True)
    altitude_geom = models.IntegerField(blank=True, null=True)
    ground_speed = models.FloatField(blank=True, null=True)
    track = models.FloatField(blank=True, null=True)
    vertical_rate = models.IntegerField(blank=True, null=True)
    distance_nm = models.FloatField(blank=True, null=True)
    rssi = models.FloatField(blank=True, null=True)
    category = models.CharField(max_length=4, blank=True, null=True)
    aircraft_type = models.CharField(max_length=10, blank=True, null=True)
    is_military = models.BooleanField(default=False)
    is_emergency = models.BooleanField(default=False)
    source = models.CharField(max_length=10, default="1090")

    class Meta:
        db_table = "aircraft_sightings"
        indexes = [
            models.Index(fields=["icao_hex", "timestamp"], name="idx_sightings_icao_time"),
        ]
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.icao_hex} @ {self.timestamp}"


class AircraftSession(models.Model):
    """Continuous tracking session for an aircraft."""

    icao_hex = models.CharField(max_length=10, null=False, db_index=True)  # TIS-B can have ~ prefix
    callsign = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    first_seen = models.DateTimeField(auto_now_add=True, db_index=True)
    last_seen = models.DateTimeField(auto_now=True, db_index=True)
    total_positions = models.IntegerField(default=0)
    min_altitude = models.IntegerField(blank=True, null=True)
    max_altitude = models.IntegerField(blank=True, null=True)
    min_distance_nm = models.FloatField(blank=True, null=True)
    max_distance_nm = models.FloatField(blank=True, null=True)
    max_vertical_rate = models.IntegerField(blank=True, null=True)
    min_rssi = models.FloatField(blank=True, null=True)
    max_rssi = models.FloatField(blank=True, null=True)
    is_military = models.BooleanField(default=False)
    category = models.CharField(max_length=4, blank=True, null=True)
    aircraft_type = models.CharField(max_length=10, blank=True, null=True)

    class Meta:
        db_table = "aircraft_sessions"
        indexes = [
            models.Index(fields=["last_seen", "icao_hex"], name="idx_sessions_last_seen_icao"),
            models.Index(fields=["icao_hex"], name="idx_sessions_icao_hex"),
        ]
        ordering = ["-last_seen"]

    def __str__(self):
        return f"{self.icao_hex} session ({self.first_seen} - {self.last_seen})"


class AircraftInfo(models.Model):
    """Cached aircraft information including photos and airframe data."""

    icao_hex = models.CharField(max_length=10, unique=True, db_index=True)
    registration = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    source = models.CharField(max_length=50, blank=True, null=True)

    # Airframe info
    type_code = models.CharField(max_length=10, blank=True, null=True)
    type_name = models.CharField(max_length=100, blank=True, null=True)
    manufacturer = models.CharField(max_length=100, blank=True, null=True)
    model = models.CharField(max_length=100, blank=True, null=True)
    serial_number = models.CharField(max_length=50, blank=True, null=True)

    # Age and history
    year_built = models.IntegerField(blank=True, null=True)
    first_flight_date = models.CharField(max_length=20, blank=True, null=True)
    delivery_date = models.CharField(max_length=20, blank=True, null=True)
    airframe_hours = models.IntegerField(blank=True, null=True)

    # Operator info
    operator = models.CharField(max_length=100, blank=True, null=True)
    operator_icao = models.CharField(max_length=4, blank=True, null=True)
    operator_callsign = models.CharField(max_length=20, blank=True, null=True)
    owner = models.CharField(max_length=200, blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    state = models.CharField(max_length=10, blank=True, null=True, db_index=True)

    # Privacy & Flags (from tar1090/FAA)
    is_interesting = models.BooleanField(default=False)
    is_pia = models.BooleanField(default=False)  # Privacy ICAO Address
    is_ladd = models.BooleanField(default=False)  # Limiting Aircraft Data Displayed

    # Country and registration
    country = models.CharField(max_length=100, blank=True, null=True)
    country_code = models.CharField(max_length=3, blank=True, null=True)

    # Category
    category = models.CharField(max_length=20, blank=True, null=True)
    is_military = models.BooleanField(default=False)

    # Images
    photo_url = models.CharField(max_length=500, blank=True, null=True)
    photo_thumbnail_url = models.CharField(max_length=500, blank=True, null=True)
    photo_photographer = models.CharField(max_length=100, blank=True, null=True)
    photo_source = models.CharField(max_length=50, blank=True, null=True)
    photo_page_link = models.CharField(max_length=500, blank=True, null=True)

    # Local cached photos
    photo_local_path = models.CharField(max_length=500, blank=True, null=True)
    photo_thumbnail_local_path = models.CharField(max_length=500, blank=True, null=True)

    # Additional data as JSON
    extra_data = models.JSONField(blank=True, null=True)

    # Field-level provenance: maps a merged field name -> the source that won it
    # (e.g. {"registration": "faa", "operator": "opensky"}). Lets the UI/RAG
    # attribute each fact instead of relying on the flat ``source`` string.
    field_sources = models.JSONField(blank=True, null=True)

    # Ownership analysis (derived from owner/city/state via registration_analysis)
    owner_type = models.CharField(max_length=20, blank=True, null=True)  # llc/trust/corporation/...
    is_shell_suspected = models.BooleanField(default=False)
    shell_score = models.FloatField(blank=True, null=True)  # 0..1 shell-company likelihood
    ownership_flags = models.JSONField(blank=True, null=True)  # factors/details from the analysis

    # Cache management
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    fetch_failed = models.BooleanField(default=False)

    class Meta:
        db_table = "aircraft_info"
        indexes = [
            models.Index(fields=["registration"], name="idx_aircraft_info_reg"),
            models.Index(fields=["operator_icao"], name="idx_aircraft_info_operator"),
        ]

    def __str__(self):
        return f"{self.icao_hex} - {self.registration or 'Unknown'}"


class AircraftIncident(models.Model):
    """
    A safety incident/accident record for an airframe, from a public registry.

    Keyed by registration (the stable identity across an airframe's life) and
    linked to ICAO hex when known. One row per source record (e.g. an NTSB
    case), deduped on (source, external_id).
    """

    SOURCE_CHOICES = [
        ("ntsb", "NTSB (US)"),
        ("asn", "Aviation Safety Network"),
    ]

    icao_hex = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    registration = models.CharField(max_length=20, db_index=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="ntsb", db_index=True)
    external_id = models.CharField(max_length=50, db_index=True)  # e.g. NTSB number

    event_type = models.CharField(max_length=50, blank=True, null=True)  # Accident / Incident
    event_date = models.DateTimeField(blank=True, null=True, db_index=True)
    severity = models.CharField(max_length=50, blank=True, null=True)  # highest injury / damage
    city = models.CharField(max_length=100, blank=True, null=True)
    state = models.CharField(max_length=50, blank=True, null=True)
    country = models.CharField(max_length=50, blank=True, null=True)
    make = models.CharField(max_length=100, blank=True, null=True)
    model = models.CharField(max_length=100, blank=True, null=True)
    report_number = models.CharField(max_length=50, blank=True, null=True)
    narrative = models.TextField(blank=True, null=True)
    url = models.CharField(max_length=500, blank=True, null=True)

    # Full source record for audit / RAG.
    raw_data = models.JSONField(default=dict)

    fetched_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aircraft_incident"
        unique_together = [["source", "external_id"]]
        indexes = [
            models.Index(fields=["registration", "event_date"], name="idx_incident_reg_date"),
        ]

    def __str__(self):
        return f"{self.registration} - {self.source}:{self.external_id}"


class AirframeSourceData(models.Model):
    """
    Stores raw airframe data from each data source separately.

    This preserves the original data from each source without merging,
    allowing comparison and audit of data quality across sources.
    """

    SOURCE_CHOICES = [
        ("faa", "FAA Registry"),
        ("adsbx", "ADS-B Exchange"),
        ("tar1090", "tar1090-db"),
        ("opensky", "OpenSky Network"),
        ("hexdb", "HexDB API"),
        ("adsblol", "adsb.lol API"),
        ("adsbdb", "ADSBdb API"),
        ("planespotters", "Planespotters API"),
    ]

    aircraft_info = models.ForeignKey(AircraftInfo, on_delete=models.CASCADE, related_name="source_data")
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, db_index=True)

    # Store the complete raw data as JSON for full preservation
    raw_data = models.JSONField(default=dict)

    # Common extracted fields for querying (optional, derived from raw_data)
    registration = models.CharField(max_length=20, blank=True, null=True)
    type_code = models.CharField(max_length=10, blank=True, null=True)
    type_name = models.CharField(max_length=100, blank=True, null=True)
    manufacturer = models.CharField(max_length=100, blank=True, null=True)
    model = models.CharField(max_length=100, blank=True, null=True)
    serial_number = models.CharField(max_length=50, blank=True, null=True)
    year_built = models.IntegerField(blank=True, null=True)
    operator = models.CharField(max_length=100, blank=True, null=True)
    operator_icao = models.CharField(max_length=4, blank=True, null=True)
    owner = models.CharField(max_length=200, blank=True, null=True)
    country = models.CharField(max_length=100, blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    state = models.CharField(max_length=10, blank=True, null=True)
    category = models.CharField(max_length=20, blank=True, null=True)
    is_military = models.BooleanField(default=False)
    is_interesting = models.BooleanField(default=False)
    is_pia = models.BooleanField(default=False)
    is_ladd = models.BooleanField(default=False)

    # Timestamps
    fetched_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "airframe_source_data"
        unique_together = [["aircraft_info", "source"]]
        indexes = [
            models.Index(fields=["source", "registration"], name="idx_source_data_src_reg"),
        ]

    def __str__(self):
        return f"{self.aircraft_info.icao_hex} - {self.source}"
