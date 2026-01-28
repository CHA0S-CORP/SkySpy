"""
Cannonball Mode models for law enforcement aircraft detection and pattern analysis.

Stores detected patterns, LE aircraft sessions, and generated alerts for
the Cannonball Mode feature which identifies potential law enforcement
and traffic monitoring aircraft.
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class CannonballPattern(models.Model):
    """
    Detected flight patterns that may indicate surveillance or enforcement activity.

    Patterns include: circling, loitering, grid_search, speed_trap, etc.
    """

    PATTERN_TYPES = [
        ('circling', 'Circling'),
        ('loitering', 'Loitering'),
        ('grid_search', 'Grid Search'),
        ('speed_trap', 'Speed Trap'),
        ('parallel_highway', 'Parallel to Highway'),
        ('surveillance', 'General Surveillance'),
        ('pursuit', 'Pursuit Pattern'),
    ]

    CONFIDENCE_LEVELS = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]

    icao_hex = models.CharField(max_length=10, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    pattern_type = models.CharField(max_length=30, choices=PATTERN_TYPES)
    confidence = models.CharField(max_length=10, choices=CONFIDENCE_LEVELS, default='medium')
    confidence_score = models.FloatField(default=0.0, help_text='0.0-1.0 confidence score')

    # Pattern location and details
    center_lat = models.FloatField(help_text='Center latitude of pattern')
    center_lon = models.FloatField(help_text='Center longitude of pattern')
    radius_nm = models.FloatField(blank=True, null=True, help_text='Radius in nautical miles for circular patterns')

    # Pattern-specific data
    pattern_data = models.JSONField(
        default=dict,
        blank=True,
        help_text='Additional pattern-specific data (orbit count, heading changes, etc.)'
    )

    # Position history snapshot
    position_samples = models.JSONField(
        default=list,
        blank=True,
        help_text='Sample positions used to detect this pattern'
    )

    # Timing
    started_at = models.DateTimeField(help_text='When pattern was first detected')
    ended_at = models.DateTimeField(blank=True, null=True, help_text='When pattern ended (null if ongoing)')
    duration_seconds = models.IntegerField(default=0)
    detected_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Related session
    session = models.ForeignKey(
        'CannonballSession',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='patterns'
    )

    class Meta:
        db_table = 'cannonball_patterns'
        ordering = ['-detected_at']
        indexes = [
            models.Index(fields=['icao_hex', 'pattern_type'], name='idx_cb_pattern_icao_type'),
            models.Index(fields=['pattern_type', 'detected_at'], name='idx_cb_pattern_type_time'),
            models.Index(fields=['confidence', 'detected_at'], name='idx_cb_pattern_conf'),
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
        self.save(update_fields=['ended_at', 'duration_seconds'])


class CannonballSession(models.Model):
    """
    Tracking session for a potential law enforcement aircraft.

    Groups multiple patterns and detections for a single aircraft
    over a period of time.
    """

    IDENTIFICATION_METHODS = [
        ('callsign', 'Callsign Match'),
        ('registration', 'Registration Match'),
        ('operator', 'Operator ICAO Match'),
        ('pattern', 'Behavior Pattern'),
        ('database', 'Known LE Database'),
        ('manual', 'Manual Identification'),
    ]

    THREAT_LEVELS = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]

    icao_hex = models.CharField(max_length=10, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    registration = models.CharField(max_length=15, blank=True, null=True)

    # Aircraft identification
    identification_method = models.CharField(
        max_length=20,
        choices=IDENTIFICATION_METHODS,
        default='pattern'
    )
    identification_reason = models.CharField(
        max_length=200,
        blank=True,
        null=True,
        help_text='Why this aircraft was identified as potential LE'
    )

    # Operator info (if known)
    operator_name = models.CharField(max_length=100, blank=True, null=True)
    operator_icao = models.CharField(max_length=10, blank=True, null=True)
    aircraft_type = models.CharField(max_length=50, blank=True, null=True)

    # Session status
    is_active = models.BooleanField(default=True, db_index=True)
    threat_level = models.CharField(max_length=20, choices=THREAT_LEVELS, default='info')
    urgency_score = models.FloatField(default=0.0, help_text='0-100 urgency score')

    # Location tracking
    last_lat = models.FloatField(blank=True, null=True)
    last_lon = models.FloatField(blank=True, null=True)
    last_altitude = models.IntegerField(blank=True, null=True)
    last_ground_speed = models.IntegerField(blank=True, null=True)
    last_track = models.IntegerField(blank=True, null=True)

    # Distance from user (if tracking specific user)
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cannonball_sessions'
    )
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
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text='Additional session metadata'
    )

    class Meta:
        db_table = 'cannonball_sessions'
        ordering = ['-last_seen']
        indexes = [
            models.Index(fields=['icao_hex', 'is_active'], name='idx_cb_session_icao_active'),
            models.Index(fields=['threat_level', 'is_active'], name='idx_cb_session_threat'),
            models.Index(fields=['user', 'is_active'], name='idx_cb_session_user'),
            models.Index(fields=['last_seen'], name='idx_cb_session_last_seen'),
        ]

    def __str__(self):
        status = "Active" if self.is_active else "Ended"
        return f"{self.icao_hex} ({self.threat_level}) - {status}"

    def update_duration(self):
        """Update session duration based on first_seen and last_seen."""
        if self.first_seen:
            self.session_duration_seconds = int((timezone.now() - self.first_seen).total_seconds())
            self.save(update_fields=['session_duration_seconds'])

    def end_session(self):
        """Mark session as ended."""
        self.is_active = False
        self.update_duration()
        self.save(update_fields=['is_active', 'session_duration_seconds', 'last_seen'])

    def update_position(self, lat, lon, altitude=None, ground_speed=None, track=None):
        """Update last known position."""
        self.last_lat = lat
        self.last_lon = lon
        self.last_altitude = altitude
        self.last_ground_speed = ground_speed
        self.last_track = track
        self.position_count += 1
        self.save(update_fields=[
            'last_lat', 'last_lon', 'last_altitude',
            'last_ground_speed', 'last_track', 'position_count', 'last_seen'
        ])

    def increment_pattern_count(self):
        """Increment pattern count."""
        self.pattern_count += 1
        self.save(update_fields=['pattern_count'])

    def increment_alert_count(self):
        """Increment alert count."""
        self.alert_count += 1
        self.save(update_fields=['alert_count'])


class CannonballAlert(models.Model):
    """
    Alerts generated from Cannonball analysis.

    Separate from regular AlertHistory to allow specialized
    tracking of LE-related alerts.
    """

    ALERT_TYPES = [
        ('le_detected', 'Law Enforcement Detected'),
        ('pattern_detected', 'Suspicious Pattern'),
        ('closing_fast', 'Aircraft Closing Fast'),
        ('overhead', 'Aircraft Overhead'),
        ('new_threat', 'New Threat'),
        ('threat_escalated', 'Threat Level Escalated'),
        ('threat_cleared', 'Threat Cleared'),
    ]

    PRIORITY_CHOICES = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]

    session = models.ForeignKey(
        CannonballSession,
        on_delete=models.CASCADE,
        related_name='alerts'
    )

    alert_type = models.CharField(max_length=30, choices=ALERT_TYPES)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='info')

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
        CannonballPattern,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='alerts'
    )

    # Alert handling
    notified = models.BooleanField(default=False, help_text='Whether notification was sent')
    announced = models.BooleanField(default=False, help_text='Whether TTS announcement was made')
    acknowledged = models.BooleanField(default=False)
    acknowledged_at = models.DateTimeField(blank=True, null=True)

    # User association
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cannonball_alerts'
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'cannonball_alerts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['session', 'created_at'], name='idx_cb_alert_session'),
            models.Index(fields=['alert_type', 'created_at'], name='idx_cb_alert_type'),
            models.Index(fields=['priority', 'acknowledged'], name='idx_cb_alert_priority'),
            models.Index(fields=['user', 'created_at'], name='idx_cb_alert_user'),
        ]

    def __str__(self):
        return f"{self.alert_type} - {self.title} @ {self.created_at}"

    def acknowledge(self, user=None):
        """Mark alert as acknowledged."""
        self.acknowledged = True
        self.acknowledged_at = timezone.now()
        self.save(update_fields=['acknowledged', 'acknowledged_at'])


class CannonballKnownAircraft(models.Model):
    """
    Database of known law enforcement aircraft.

    Can be populated from external sources or manually curated.
    Used for quick identification of LE aircraft.
    """

    SOURCE_TYPES = [
        ('faa', 'FAA Registry'),
        ('opensky', 'OpenSky Database'),
        ('manual', 'Manual Entry'),
        ('community', 'Community Submission'),
        ('research', 'Research/FOIA'),
    ]

    AGENCY_TYPES = [
        ('federal', 'Federal'),
        ('state', 'State'),
        ('local', 'Local'),
        ('military', 'Military'),
        ('unknown', 'Unknown'),
    ]

    icao_hex = models.CharField(max_length=10, unique=True, db_index=True)
    registration = models.CharField(max_length=15, blank=True, null=True, db_index=True)

    # Aircraft details
    aircraft_type = models.CharField(max_length=50, blank=True, null=True)
    aircraft_model = models.CharField(max_length=100, blank=True, null=True)

    # Agency information
    agency_name = models.CharField(max_length=200)
    agency_type = models.CharField(max_length=20, choices=AGENCY_TYPES, default='unknown')
    agency_state = models.CharField(max_length=2, blank=True, null=True, help_text='US state abbreviation')
    agency_city = models.CharField(max_length=100, blank=True, null=True)

    # Source tracking
    source = models.CharField(max_length=20, choices=SOURCE_TYPES, default='manual')
    source_url = models.URLField(blank=True, null=True)
    verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(blank=True, null=True)
    verified_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_cannonball_aircraft'
    )

    # Usage tracking
    times_detected = models.IntegerField(default=0)
    last_detected = models.DateTimeField(blank=True, null=True)

    # Notes
    notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cannonball_known_aircraft'
        verbose_name_plural = 'Cannonball known aircraft'
        ordering = ['agency_name', 'registration']
        indexes = [
            models.Index(fields=['agency_type', 'agency_state'], name='idx_cb_known_agency'),
            models.Index(fields=['verified', 'times_detected'], name='idx_cb_known_verified'),
        ]

    def __str__(self):
        reg = self.registration or self.icao_hex
        return f"{reg} - {self.agency_name}"

    def record_detection(self):
        """Record a detection of this aircraft."""
        self.times_detected += 1
        self.last_detected = timezone.now()
        self.save(update_fields=['times_detected', 'last_detected'])


class CannonballStats(models.Model):
    """
    Aggregated statistics for Cannonball detections.

    Tracks detection counts, patterns, and trends over time.
    """

    PERIOD_TYPES = [
        ('hourly', 'Hourly'),
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
        ('monthly', 'Monthly'),
    ]

    period_type = models.CharField(max_length=10, choices=PERIOD_TYPES)
    period_start = models.DateTimeField(db_index=True)
    period_end = models.DateTimeField()

    # User (null for global stats)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='cannonball_stats'
    )

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
    top_aircraft = models.JSONField(
        default=list,
        blank=True,
        help_text='List of most frequently detected aircraft'
    )

    # Top agencies
    top_agencies = models.JSONField(
        default=list,
        blank=True,
        help_text='List of most frequently detected agencies'
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cannonball_stats'
        ordering = ['-period_start']
        unique_together = ['period_type', 'period_start', 'user']
        indexes = [
            models.Index(fields=['period_type', 'period_start'], name='idx_cb_stats_period'),
            models.Index(fields=['user', 'period_type'], name='idx_cb_stats_user'),
        ]

    def __str__(self):
        user_str = f" ({self.user.username})" if self.user else " (global)"
        return f"{self.period_type} stats{user_str} - {self.period_start}"
