"""
Cannonball Mode models for law enforcement aircraft detection and pattern analysis.

Stores detected patterns, LE aircraft sessions, and generated alerts for
the Cannonball Mode feature which identifies potential law enforcement
and traffic monitoring aircraft.
"""

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


class LEDataSource(models.Model):
    """
    External data source for law enforcement aircraft identification.

    Tracks imported databases like BuzzFeed spy planes, academic research,
    community projects, and FOIA requests.
    """

    SOURCE_TYPES = [
        ("buzzfeed", "BuzzFeed Spy Planes"),
        ("academic", "Academic Research"),
        ("community_project", "Community Project"),
        ("foia", "FOIA Request"),
        ("government", "Government Registry"),
        ("news_investigation", "News Investigation"),
    ]

    name = models.CharField(max_length=100, unique=True)
    source_type = models.CharField(max_length=30, choices=SOURCE_TYPES)
    url = models.URLField(blank=True, null=True)
    description = models.TextField(blank=True)
    record_count = models.IntegerField(default=0)
    confidence_weight = models.FloatField(
        default=1.0,
        help_text="Weight factor for confidence calculations (0.0-2.0)",
    )
    last_fetched = models.DateTimeField(blank=True, null=True)
    last_successful_fetch = models.DateTimeField(blank=True, null=True)
    update_frequency_hours = models.IntegerField(default=168)  # Weekly
    fetch_enabled = models.BooleanField(default=True)
    attribution_text = models.CharField(
        max_length=500,
        blank=True,
        help_text="Required attribution for this data source",
    )
    fetch_errors = models.JSONField(
        default=list,
        blank=True,
        help_text="Recent fetch errors for debugging",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cannonball_le_data_sources"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.get_source_type_display()})"

    def record_fetch_error(self, error_message: str):
        """Record a fetch error for debugging."""
        from django.utils import timezone

        self.fetch_errors = (self.fetch_errors or [])[-9:]  # Keep last 9
        self.fetch_errors.append(
            {
                "timestamp": timezone.now().isoformat(),
                "error": str(error_message)[:500],
            }
        )
        self.last_fetched = timezone.now()
        self.save(update_fields=["fetch_errors", "last_fetched"])

    def record_successful_fetch(self, record_count: int):
        """Record a successful fetch."""
        self.last_fetched = timezone.now()
        self.last_successful_fetch = timezone.now()
        self.record_count = record_count
        self.save(update_fields=["last_fetched", "last_successful_fetch", "record_count"])


class CannonballPattern(models.Model):
    """
    Detected flight patterns that may indicate surveillance or enforcement activity.

    Patterns include: circling, loitering, grid_search, speed_trap, etc.
    """

    PATTERN_TYPES = [
        ("circling", "Circling"),
        ("loitering", "Loitering"),
        ("grid_search", "Grid Search"),
        ("speed_trap", "Speed Trap"),
        ("parallel_highway", "Parallel to Highway"),
        ("surveillance", "General Surveillance"),
        ("pursuit", "Pursuit Pattern"),
        # New enhanced pattern types
        ("stakeout", "Stakeout Loitering"),
        ("racetrack", "Racetrack Orbit"),
        ("highway_tracking", "Highway Tracking"),
        ("area_search", "Expanding Area Search"),
    ]

    CONFIDENCE_LEVELS = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

    icao_hex = models.CharField(max_length=10, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    pattern_type = models.CharField(max_length=30, choices=PATTERN_TYPES)
    confidence = models.CharField(max_length=10, choices=CONFIDENCE_LEVELS, default="medium")
    confidence_score = models.FloatField(default=0.0, help_text="0.0-1.0 confidence score")

    # Pattern location and details
    center_lat = models.FloatField(help_text="Center latitude of pattern")
    center_lon = models.FloatField(help_text="Center longitude of pattern")
    radius_nm = models.FloatField(blank=True, null=True, help_text="Radius in nautical miles for circular patterns")

    # Pattern-specific data
    pattern_data = models.JSONField(
        default=dict, blank=True, help_text="Additional pattern-specific data (orbit count, heading changes, etc.)"
    )

    # Position history snapshot
    position_samples = models.JSONField(
        default=list, blank=True, help_text="Sample positions used to detect this pattern"
    )

    # Timing
    started_at = models.DateTimeField(help_text="When pattern was first detected")
    ended_at = models.DateTimeField(blank=True, null=True, help_text="When pattern ended (null if ongoing)")
    duration_seconds = models.IntegerField(default=0)
    detected_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Related session
    session = models.ForeignKey(
        "CannonballSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="patterns"
    )

    class Meta:
        db_table = "cannonball_patterns"
        ordering = ["-detected_at"]
        indexes = [
            models.Index(fields=["icao_hex", "pattern_type"], name="idx_cb_pattern_icao_type"),
            models.Index(fields=["pattern_type", "detected_at"], name="idx_cb_pattern_type_time"),
            models.Index(fields=["confidence", "detected_at"], name="idx_cb_pattern_conf"),
        ]

    def __str__(self):
        return f"{self.icao_hex} - {self.pattern_type} ({self.confidence}) @ {self.detected_at}"

    @property
    def is_active(self):
        """Check if pattern is still ongoing."""
        return self.ended_at is None

    def end_pattern(self, end_time=None):
        """Mark the pattern as ended."""
        self.ended_at = end_time or timezone.now()
        if self.started_at:
            self.duration_seconds = int((self.ended_at - self.started_at).total_seconds())
        self.save(update_fields=["ended_at", "duration_seconds"])


class CannonballSession(models.Model):
    """
    Tracking session for a potential law enforcement aircraft.

    Groups multiple patterns and detections for a single aircraft
    over a period of time.
    """

    IDENTIFICATION_METHODS = [
        ("callsign", "Callsign Match"),
        ("registration", "Registration Match"),
        ("operator", "Operator ICAO Match"),
        ("pattern", "Behavior Pattern"),
        ("database", "Known LE Database"),
        ("manual", "Manual Identification"),
    ]

    THREAT_LEVELS = [
        ("info", "Info"),
        ("warning", "Warning"),
        ("critical", "Critical"),
    ]

    icao_hex = models.CharField(max_length=10, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    registration = models.CharField(max_length=15, blank=True, null=True)

    # Aircraft identification
    identification_method = models.CharField(max_length=20, choices=IDENTIFICATION_METHODS, default="pattern")
    identification_reason = models.CharField(
        max_length=200, blank=True, null=True, help_text="Why this aircraft was identified as potential LE"
    )

    # Operator info (if known)
    operator_name = models.CharField(max_length=100, blank=True, null=True)
    operator_icao = models.CharField(max_length=10, blank=True, null=True)
    aircraft_type = models.CharField(max_length=50, blank=True, null=True)

    # Session status
    is_active = models.BooleanField(default=True, db_index=True)
    threat_level = models.CharField(max_length=20, choices=THREAT_LEVELS, default="info")
    urgency_score = models.FloatField(default=0.0, help_text="0-100 urgency score")

    # Location tracking
    last_lat = models.FloatField(blank=True, null=True)
    last_lon = models.FloatField(blank=True, null=True)
    last_altitude = models.IntegerField(blank=True, null=True)
    last_ground_speed = models.IntegerField(blank=True, null=True)
    last_track = models.IntegerField(blank=True, null=True)

    # Distance from user (if tracking specific user)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="cannonball_sessions")
    distance_nm = models.FloatField(blank=True, null=True)
    bearing = models.FloatField(blank=True, null=True)
    closing_speed_kts = models.FloatField(blank=True, null=True)

    # Session timing
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)
    session_duration_seconds = models.IntegerField(default=0)

    # Aggregated stats
    pattern_count = models.IntegerField(default=0)
    alert_count = models.IntegerField(default=0)
    position_count = models.IntegerField(default=0)

    # Additional data
    metadata = models.JSONField(default=dict, blank=True, help_text="Additional session metadata")

    class Meta:
        db_table = "cannonball_sessions"
        ordering = ["-last_seen"]
        indexes = [
            models.Index(fields=["icao_hex", "is_active"], name="idx_cb_session_icao_active"),
            models.Index(fields=["threat_level", "is_active"], name="idx_cb_session_threat"),
            models.Index(fields=["user", "is_active"], name="idx_cb_session_user"),
            models.Index(fields=["last_seen"], name="idx_cb_session_last_seen"),
        ]

    def __str__(self):
        status = "Active" if self.is_active else "Ended"
        return f"{self.icao_hex} ({self.threat_level}) - {status}"

    def update_duration(self):
        """Update session duration based on first_seen and last_seen."""
        if self.first_seen:
            self.session_duration_seconds = int((timezone.now() - self.first_seen).total_seconds())
            self.save(update_fields=["session_duration_seconds"])

    def end_session(self):
        """Mark session as ended."""
        self.is_active = False
        self.update_duration()
        self.save(update_fields=["is_active", "session_duration_seconds", "last_seen"])

    def update_position(self, lat, lon, altitude=None, ground_speed=None, track=None):
        """Update last known position."""
        self.last_lat = lat
        self.last_lon = lon
        self.last_altitude = altitude
        self.last_ground_speed = ground_speed
        self.last_track = track
        self.position_count += 1
        self.save(
            update_fields=[
                "last_lat",
                "last_lon",
                "last_altitude",
                "last_ground_speed",
                "last_track",
                "position_count",
                "last_seen",
            ]
        )

    def increment_pattern_count(self):
        """Increment pattern count."""
        self.pattern_count += 1
        self.save(update_fields=["pattern_count"])

    def increment_alert_count(self):
        """Increment alert count."""
        self.alert_count += 1
        self.save(update_fields=["alert_count"])


class CannonballAlert(models.Model):
    """
    Alerts generated from Cannonball analysis.

    Separate from regular AlertHistory to allow specialized
    tracking of LE-related alerts.
    """

    ALERT_TYPES = [
        ("le_detected", "Law Enforcement Detected"),
        ("pattern_detected", "Suspicious Pattern"),
        ("closing_fast", "Aircraft Closing Fast"),
        ("overhead", "Aircraft Overhead"),
        ("new_threat", "New Threat"),
        ("threat_escalated", "Threat Level Escalated"),
        ("threat_cleared", "Threat Cleared"),
    ]

    PRIORITY_CHOICES = [
        ("info", "Info"),
        ("warning", "Warning"),
        ("critical", "Critical"),
    ]

    session = models.ForeignKey(CannonballSession, on_delete=models.CASCADE, related_name="alerts")

    alert_type = models.CharField(max_length=30, choices=ALERT_TYPES)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="info")

    # Alert content
    title = models.CharField(max_length=100)
    message = models.TextField()

    # Location at time of alert
    aircraft_lat = models.FloatField(blank=True, null=True)
    aircraft_lon = models.FloatField(blank=True, null=True)
    aircraft_altitude = models.IntegerField(blank=True, null=True)

    # User location at time of alert (if available)
    user_lat = models.FloatField(blank=True, null=True)
    user_lon = models.FloatField(blank=True, null=True)
    distance_nm = models.FloatField(blank=True, null=True)
    bearing = models.FloatField(blank=True, null=True)

    # Related pattern (if alert was triggered by pattern detection)
    pattern = models.ForeignKey(
        CannonballPattern, on_delete=models.SET_NULL, null=True, blank=True, related_name="alerts"
    )

    # Alert handling
    notified = models.BooleanField(default=False, help_text="Whether notification was sent")
    announced = models.BooleanField(default=False, help_text="Whether TTS announcement was made")
    acknowledged = models.BooleanField(default=False)
    acknowledged_at = models.DateTimeField(blank=True, null=True)

    # User association
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="cannonball_alerts")

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "cannonball_alerts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["session", "created_at"], name="idx_cb_alert_session"),
            models.Index(fields=["alert_type", "created_at"], name="idx_cb_alert_type"),
            models.Index(fields=["priority", "acknowledged"], name="idx_cb_alert_priority"),
            models.Index(fields=["user", "created_at"], name="idx_cb_alert_user"),
        ]

    def __str__(self):
        return f"{self.alert_type} - {self.title} @ {self.created_at}"

    def acknowledge(self, user=None):
        """Mark alert as acknowledged."""
        self.acknowledged = True
        self.acknowledged_at = timezone.now()
        self.save(update_fields=["acknowledged", "acknowledged_at"])


class CannonballKnownAircraft(models.Model):
    """
    Database of known law enforcement aircraft.

    Can be populated from external sources or manually curated.
    Used for quick identification of LE aircraft.
    """

    SOURCE_TYPES = [
        ("faa", "FAA Registry"),
        ("opensky", "OpenSky Database"),
        ("manual", "Manual Entry"),
        ("community", "Community Submission"),
        ("research", "Research/FOIA"),
        ("buzzfeed", "BuzzFeed Investigation"),
        ("academic", "Academic Research"),
        ("external_db", "External Database"),
    ]

    AGENCY_TYPES = [
        ("federal", "Federal"),
        ("state", "State"),
        ("local", "Local"),
        ("military", "Military"),
        ("unknown", "Unknown"),
    ]

    icao_hex = models.CharField(max_length=10, unique=True, db_index=True)
    registration = models.CharField(max_length=15, blank=True, null=True, db_index=True)

    # Aircraft details
    aircraft_type = models.CharField(max_length=50, blank=True, null=True)
    aircraft_model = models.CharField(max_length=100, blank=True, null=True)

    # Agency information
    agency_name = models.CharField(max_length=200)
    agency_type = models.CharField(max_length=20, choices=AGENCY_TYPES, default="unknown")
    agency_state = models.CharField(max_length=2, blank=True, null=True, help_text="US state abbreviation")
    agency_city = models.CharField(max_length=100, blank=True, null=True)

    # Source tracking
    source = models.CharField(max_length=20, choices=SOURCE_TYPES, default="manual")
    source_url = models.URLField(blank=True, null=True)
    verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(blank=True, null=True)
    verified_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="verified_cannonball_aircraft"
    )

    # External data source tracking
    data_source = models.ForeignKey(
        LEDataSource,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="aircraft",
        help_text="External data source this record came from",
    )
    confidence_score = models.FloatField(
        default=0.5,
        help_text="Confidence score 0.0-1.0 based on source reliability and corroboration",
    )
    evidence_links = models.JSONField(
        default=list,
        blank=True,
        help_text="Supporting URLs and evidence links",
    )
    external_ids = models.JSONField(
        default=dict,
        blank=True,
        help_text="Source-specific IDs (e.g., {'buzzfeed_id': '123', 'faa_id': 'N12345'})",
    )

    # Usage tracking
    times_detected = models.IntegerField(default=0)
    last_detected = models.DateTimeField(blank=True, null=True)

    # Notes
    notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cannonball_known_aircraft"
        verbose_name_plural = "Cannonball known aircraft"
        ordering = ["agency_name", "registration"]
        indexes = [
            models.Index(fields=["agency_type", "agency_state"], name="idx_cb_known_agency"),
            models.Index(fields=["verified", "times_detected"], name="idx_cb_known_verified"),
        ]

    def __str__(self):
        reg = self.registration or self.icao_hex
        return f"{reg} - {self.agency_name}"

    def record_detection(self):
        """Record a detection of this aircraft."""
        self.times_detected += 1
        self.last_detected = timezone.now()
        self.save(update_fields=["times_detected", "last_detected"])


class CannonballStats(models.Model):
    """
    Aggregated statistics for Cannonball detections.

    Tracks detection counts, patterns, and trends over time.
    """

    PERIOD_TYPES = [
        ("hourly", "Hourly"),
        ("daily", "Daily"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ]

    period_type = models.CharField(max_length=10, choices=PERIOD_TYPES)
    period_start = models.DateTimeField(db_index=True)
    period_end = models.DateTimeField()

    # User (null for global stats)
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name="cannonball_stats")

    # Detection counts
    total_detections = models.IntegerField(default=0)
    unique_aircraft = models.IntegerField(default=0)
    critical_alerts = models.IntegerField(default=0)
    warning_alerts = models.IntegerField(default=0)
    info_alerts = models.IntegerField(default=0)

    # Pattern counts
    circling_patterns = models.IntegerField(default=0)
    loitering_patterns = models.IntegerField(default=0)
    grid_search_patterns = models.IntegerField(default=0)
    speed_trap_patterns = models.IntegerField(default=0)

    # Top aircraft (most frequently detected)
    top_aircraft = models.JSONField(default=list, blank=True, help_text="List of most frequently detected aircraft")

    # Top agencies
    top_agencies = models.JSONField(default=list, blank=True, help_text="List of most frequently detected agencies")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cannonball_stats"
        ordering = ["-period_start"]
        unique_together = ["period_type", "period_start", "user"]
        indexes = [
            models.Index(fields=["period_type", "period_start"], name="idx_cb_stats_period"),
            models.Index(fields=["user", "period_type"], name="idx_cb_stats_user"),
        ]

    def __str__(self):
        user_str = f" ({self.user.username})" if self.user else " (global)"
        return f"{self.period_type} stats{user_str} - {self.period_start}"


class PatternAnalytics(models.Model):
    """
    Track pattern detection quality for tuning and improvement.

    Used to gather feedback on false positives and confirmed detections
    to improve pattern detection algorithms.
    """

    icao_hex = models.CharField(max_length=10, db_index=True)
    pattern_type = models.CharField(max_length=30)
    confidence_score = models.FloatField()

    # Feedback
    was_confirmed_le = models.BooleanField(
        null=True,
        blank=True,
        help_text="User confirmation if this was actually LE (null=unknown)",
    )
    false_positive_reported = models.BooleanField(
        default=False,
        help_text="User reported this as a false positive",
    )

    # Pattern metrics
    duration_seconds = models.IntegerField()
    area_nm_sq = models.FloatField(null=True, blank=True, help_text="Area covered in nm²")
    orbit_count = models.IntegerField(null=True, blank=True)
    altitude_consistency = models.FloatField(
        null=True,
        blank=True,
        help_text="Standard deviation of altitude during pattern",
    )

    # Location
    center_lat = models.FloatField()
    center_lon = models.FloatField()

    # Additional metrics
    pattern_metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional pattern-specific metrics for analysis",
    )

    detected_at = models.DateTimeField(auto_now_add=True, db_index=True)
    feedback_at = models.DateTimeField(null=True, blank=True)
    feedback_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pattern_feedback",
    )

    class Meta:
        db_table = "cannonball_pattern_analytics"
        ordering = ["-detected_at"]
        indexes = [
            models.Index(fields=["pattern_type", "was_confirmed_le"], name="idx_cb_pa_type_confirm"),
            models.Index(fields=["false_positive_reported", "detected_at"], name="idx_cb_pa_fp"),
        ]

    def __str__(self):
        status = "Confirmed" if self.was_confirmed_le else "FP" if self.false_positive_reported else "Unverified"
        return f"{self.icao_hex} - {self.pattern_type} ({status})"

    def record_feedback(self, user, is_confirmed_le: bool | None, is_false_positive: bool = False):
        """Record user feedback on this pattern detection."""
        self.was_confirmed_le = is_confirmed_le
        self.false_positive_reported = is_false_positive
        self.feedback_at = timezone.now()
        self.feedback_by = user
        self.save(update_fields=["was_confirmed_le", "false_positive_reported", "feedback_at", "feedback_by"])


class RegistrationAnalysis(models.Model):
    """
    FAA registration analysis for shell company detection.

    Analyzes aircraft registrations to identify potential shell companies
    commonly used by law enforcement to obscure aircraft ownership.
    """

    RISK_LEVELS = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

    icao_hex = models.CharField(max_length=10, unique=True, db_index=True)
    registration = models.CharField(max_length=20, db_index=True)
    owner_name = models.CharField(max_length=200)
    owner_address = models.TextField(blank=True)
    owner_city = models.CharField(max_length=100, blank=True)
    owner_state = models.CharField(max_length=2, blank=True)
    owner_zip = models.CharField(max_length=20, blank=True)

    # Analysis scores (0.0-1.0)
    llc_no_web_presence = models.FloatField(
        default=0.0,
        help_text="Score for LLC with no web presence (0.0-1.0)",
    )
    registered_agent_address = models.FloatField(
        default=0.0,
        help_text="Score for using registered agent address (0.0-1.0)",
    )
    po_box_address = models.FloatField(
        default=0.0,
        help_text="Score for PO Box address (0.0-1.0)",
    )
    multiple_transfers = models.FloatField(
        default=0.0,
        help_text="Score for multiple recent ownership transfers (0.0-1.0)",
    )
    trust_ownership = models.FloatField(
        default=0.0,
        help_text="Score for trust-based ownership (0.0-1.0)",
    )
    generic_llc_name = models.FloatField(
        default=0.0,
        help_text="Score for generic aviation LLC name pattern (0.0-1.0)",
    )

    # Aggregate scores
    shell_company_score = models.FloatField(
        default=0.0,
        help_text="Weighted aggregate shell company likelihood score (0.0-1.0)",
    )
    risk_level = models.CharField(
        max_length=10,
        choices=RISK_LEVELS,
        default="low",
    )

    # Review tracking
    manually_reviewed = models.BooleanField(default=False)
    is_confirmed_le = models.BooleanField(
        null=True,
        blank=True,
        help_text="Manual confirmation of LE ownership (null=unknown)",
    )
    review_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registration_reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # FAA data
    faa_last_action_date = models.DateField(null=True, blank=True)
    certificate_issue_date = models.DateField(null=True, blank=True)
    aircraft_type = models.CharField(max_length=50, blank=True)
    aircraft_manufacturer = models.CharField(max_length=100, blank=True)
    aircraft_model = models.CharField(max_length=50, blank=True)
    aircraft_year = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cannonball_registration_analysis"
        verbose_name_plural = "Registration analyses"
        ordering = ["-shell_company_score", "-updated_at"]
        indexes = [
            models.Index(fields=["shell_company_score", "risk_level"], name="idx_cb_reg_score"),
            models.Index(fields=["registration"], name="idx_cb_reg_registration"),
            models.Index(fields=["is_confirmed_le", "manually_reviewed"], name="idx_cb_reg_review"),
        ]

    def __str__(self):
        return f"{self.registration} - {self.owner_name[:50]} ({self.risk_level})"

    def calculate_shell_score(self):
        """Calculate the aggregate shell company score from individual factors."""
        weights = {
            "llc_no_web_presence": 0.15,
            "registered_agent_address": 0.25,
            "po_box_address": 0.10,
            "multiple_transfers": 0.20,
            "trust_ownership": 0.15,
            "generic_llc_name": 0.15,
        }

        score = (
            self.llc_no_web_presence * weights["llc_no_web_presence"]
            + self.registered_agent_address * weights["registered_agent_address"]
            + self.po_box_address * weights["po_box_address"]
            + self.multiple_transfers * weights["multiple_transfers"]
            + self.trust_ownership * weights["trust_ownership"]
            + self.generic_llc_name * weights["generic_llc_name"]
        )

        self.shell_company_score = min(1.0, max(0.0, score))

        # Determine risk level
        if self.shell_company_score >= 0.7:
            self.risk_level = "high"
        elif self.shell_company_score >= 0.4:
            self.risk_level = "medium"
        else:
            self.risk_level = "low"

        return self.shell_company_score


class RegistrationTransfer(models.Model):
    """
    Track ownership transfer history for aircraft registrations.

    Multiple recent transfers can be an indicator of shell company activity.
    """

    registration = models.CharField(max_length=20, db_index=True)
    previous_owner = models.CharField(max_length=200)
    new_owner = models.CharField(max_length=200)
    transfer_date = models.DateField()
    days_since_last_transfer = models.IntegerField(
        null=True,
        blank=True,
        help_text="Days between this transfer and the previous one",
    )

    # Additional context
    previous_owner_type = models.CharField(
        max_length=20,
        blank=True,
        choices=[
            ("individual", "Individual"),
            ("corporation", "Corporation"),
            ("llc", "LLC"),
            ("trust", "Trust"),
            ("government", "Government"),
            ("unknown", "Unknown"),
        ],
    )
    new_owner_type = models.CharField(
        max_length=20,
        blank=True,
        choices=[
            ("individual", "Individual"),
            ("corporation", "Corporation"),
            ("llc", "LLC"),
            ("trust", "Trust"),
            ("government", "Government"),
            ("unknown", "Unknown"),
        ],
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cannonball_registration_transfers"
        ordering = ["-transfer_date"]
        indexes = [
            models.Index(fields=["registration", "transfer_date"], name="idx_cb_transfer_reg_date"),
        ]

    def __str__(self):
        return f"{self.registration}: {self.previous_owner[:30]} -> {self.new_owner[:30]}"


class CommunitySubmission(models.Model):
    """
    Community-submitted law enforcement aircraft identifications.

    Allows users to submit aircraft they believe to be LE, with
    evidence and review workflow.
    """

    STATUS_CHOICES = [
        ("pending", "Pending Review"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("duplicate", "Duplicate"),
        ("needs_info", "Needs More Information"),
    ]

    AGENCY_TYPES = [
        ("federal", "Federal"),
        ("state", "State"),
        ("local", "Local"),
        ("military", "Military"),
        ("unknown", "Unknown"),
    ]

    EVIDENCE_TYPES = [
        ("flight_pattern", "Observed Flight Pattern"),
        ("callsign", "LE Callsign Observed"),
        ("news", "News Report"),
        ("foia", "FOIA Document"),
        ("registry", "Registry Research"),
        ("livery", "Aircraft Livery/Markings"),
        ("public_records", "Public Records"),
        ("other", "Other"),
    ]

    # Aircraft identification
    icao_hex = models.CharField(max_length=10, db_index=True)
    registration = models.CharField(max_length=20, blank=True, null=True)
    callsign_observed = models.CharField(max_length=20, blank=True, null=True)

    # Agency information
    agency_name = models.CharField(max_length=200)
    agency_type = models.CharField(max_length=20, choices=AGENCY_TYPES, default="unknown")
    agency_state = models.CharField(max_length=2, blank=True, null=True)
    agency_city = models.CharField(max_length=100, blank=True, null=True)

    # Evidence
    evidence_type = models.CharField(max_length=30, choices=EVIDENCE_TYPES)
    evidence_description = models.TextField(
        help_text="Detailed description of the evidence supporting this submission",
    )
    evidence_url = models.URLField(
        blank=True,
        null=True,
        help_text="URL to supporting evidence (news article, document, etc.)",
    )
    additional_evidence = models.JSONField(
        default=list,
        blank=True,
        help_text="Additional evidence URLs and descriptions",
    )

    # Submission tracking
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cannonball_submissions",
    )
    submitted_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_hash = models.CharField(
        max_length=64,
        blank=True,
        help_text="Hashed IP for abuse prevention (no PII stored)",
    )

    # Review workflow
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cannonball_reviews",
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    review_notes = models.TextField(
        blank=True,
        help_text="Internal notes about the review decision",
    )

    # Auto-calculated confidence
    confidence_score = models.FloatField(
        default=0.5,
        help_text="Auto-calculated confidence based on submitter reputation and evidence",
    )

    # Link to created aircraft record (if approved)
    created_aircraft = models.ForeignKey(
        CannonballKnownAircraft,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="community_submissions",
    )

    class Meta:
        db_table = "cannonball_community_submissions"
        ordering = ["-submitted_at"]
        indexes = [
            models.Index(fields=["status", "submitted_at"], name="idx_cb_sub_status"),
            models.Index(fields=["icao_hex", "status"], name="idx_cb_sub_icao"),
            models.Index(fields=["submitted_by", "submitted_at"], name="idx_cb_sub_user"),
        ]

    def __str__(self):
        return f"{self.icao_hex} - {self.agency_name} ({self.get_status_display()})"


class SubmitterReputation(models.Model):
    """
    Track user reputation for community submissions.

    Used to weight submission confidence and identify trusted contributors.
    """

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="cannonball_reputation",
    )

    # Submission stats
    total_submissions = models.IntegerField(default=0)
    approved_submissions = models.IntegerField(default=0)
    rejected_submissions = models.IntegerField(default=0)
    pending_submissions = models.IntegerField(default=0)

    # Calculated reputation
    reputation_score = models.FloatField(
        default=0.5,
        help_text="Reputation score 0.0-1.0 based on approval rate and history",
    )

    # Status flags
    is_trusted = models.BooleanField(
        default=False,
        help_text="Trusted submitters have higher confidence on their submissions",
    )
    is_banned = models.BooleanField(
        default=False,
        help_text="Banned users cannot submit new aircraft",
    )
    ban_reason = models.TextField(blank=True)
    ban_expires_at = models.DateTimeField(null=True, blank=True)

    # Activity tracking
    first_submission_at = models.DateTimeField(null=True, blank=True)
    last_submission_at = models.DateTimeField(null=True, blank=True)
    last_approved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cannonball_submitter_reputation"

    def __str__(self):
        status = "Trusted" if self.is_trusted else "Banned" if self.is_banned else "Normal"
        return f"{self.user.username} - {self.reputation_score:.2f} ({status})"

    def calculate_reputation(self):
        """
        Calculate reputation score based on submission history.

        Score formula:
        - Base: 0.5
        - +0.1 for every 3 approved submissions
        - -0.15 for every rejected submission
        - Cap at 0.1-1.0
        """
        if self.total_submissions == 0:
            self.reputation_score = 0.5
            return self.reputation_score

        # Calculate approval rate
        approval_rate = self.approved_submissions / max(1, self.total_submissions)

        # Start with approval rate
        score = 0.3 + (approval_rate * 0.5)

        # Bonus for volume of approved submissions
        score += min(0.2, self.approved_submissions * 0.02)

        # Penalty for rejections (harsher to discourage spam)
        score -= self.rejected_submissions * 0.05

        self.reputation_score = max(0.1, min(1.0, score))
        return self.reputation_score

    def record_submission_result(self, was_approved: bool):
        """Update stats after a submission is reviewed."""
        self.total_submissions = self.approved_submissions + self.rejected_submissions + self.pending_submissions

        if was_approved:
            self.approved_submissions += 1
            self.last_approved_at = timezone.now()
        else:
            self.rejected_submissions += 1

        self.pending_submissions = max(0, self.pending_submissions - 1)
        self.calculate_reputation()
        self.save()
