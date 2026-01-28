"""
Gamification and stats models for personal records, achievements, rare sightings, and collection tracking.
"""
from django.db import models
from django.utils import timezone


class PersonalRecord(models.Model):
    """
    Personal records / achievements for all-time bests.
    Tracks things like furthest aircraft, highest altitude, fastest, etc.
    """
    RECORD_TYPES = [
        ('max_distance', 'Furthest Aircraft Tracked'),
        ('max_altitude', 'Highest Altitude Aircraft'),
        ('max_speed', 'Fastest Aircraft Tracked'),
        ('longest_session', 'Longest Tracking Session'),
        ('most_positions', 'Most Positions for Single Aircraft'),
        ('closest_approach', 'Closest Approach'),
        ('max_vertical_rate', 'Fastest Climb Rate'),
        ('max_descent_rate', 'Fastest Descent Rate'),
        ('earliest_morning', 'Earliest Morning Sighting'),
        ('latest_night', 'Latest Night Sighting'),
    ]

    record_type = models.CharField(max_length=50, choices=RECORD_TYPES, unique=True, db_index=True)

    # The aircraft that set the record
    icao_hex = models.CharField(max_length=10, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True)
    aircraft_type = models.CharField(max_length=10, blank=True, null=True)
    registration = models.CharField(max_length=20, blank=True, null=True)
    operator = models.CharField(max_length=100, blank=True, null=True)

    # The record value (interpretation depends on record_type)
    value = models.FloatField()

    # For session-based records
    session_id = models.IntegerField(blank=True, null=True)

    # When the record was set
    achieved_at = models.DateTimeField(db_index=True)

    # Previous record (for comparison)
    previous_value = models.FloatField(blank=True, null=True)
    previous_icao_hex = models.CharField(max_length=10, blank=True, null=True)
    previous_achieved_at = models.DateTimeField(blank=True, null=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'personal_records'
        indexes = [
            models.Index(fields=['record_type', 'achieved_at'], name='idx_records_type_achieved'),
        ]

    def __str__(self):
        return f"{self.get_record_type_display()}: {self.value} by {self.icao_hex}"


class RareSighting(models.Model):
    """
    Notable/rare aircraft sightings.
    Tracks first-time sightings, rare types, special registrations, etc.
    """
    RARITY_TYPES = [
        ('first_hex', 'First Time Hex Seen'),
        ('first_registration', 'First Time Registration Seen'),
        ('first_type', 'First Time Aircraft Type Seen'),
        ('first_operator', 'First Time Operator Seen'),
        ('rare_type', 'Rare Aircraft Type'),
        ('government', 'Government/State Aircraft'),
        ('military', 'Military Aircraft'),
        ('test_flight', 'Test Flight'),
        ('special_livery', 'Special Livery'),
        ('unusual_callsign', 'Unusual Callsign Pattern'),
        ('notable_registration', 'Notable Registration'),
        ('air_ambulance', 'Air Ambulance/HEMS'),
        ('law_enforcement', 'Law Enforcement'),
        ('firefighting', 'Firefighting Aircraft'),
        ('historic', 'Historic Aircraft'),
    ]

    rarity_type = models.CharField(max_length=50, choices=RARITY_TYPES, db_index=True)

    # Aircraft identification
    icao_hex = models.CharField(max_length=10, db_index=True)
    callsign = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    registration = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    aircraft_type = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    operator = models.CharField(max_length=100, blank=True, null=True)

    # Sighting details
    sighted_at = models.DateTimeField(db_index=True)
    session_id = models.IntegerField(blank=True, null=True)

    # Why it's notable
    description = models.TextField(blank=True, null=True)
    rarity_score = models.IntegerField(default=1)  # 1-10 rarity scale

    # For tracking how often we've seen this
    times_seen = models.IntegerField(default=1)
    last_seen = models.DateTimeField(blank=True, null=True)

    # Metadata
    is_acknowledged = models.BooleanField(default=False)  # User has seen/dismissed this
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rare_sightings'
        indexes = [
            models.Index(fields=['rarity_type', 'sighted_at'], name='idx_rare_type_sighted'),
            models.Index(fields=['icao_hex', 'rarity_type'], name='idx_rare_icao_type'),
        ]

    def __str__(self):
        return f"{self.get_rarity_type_display()}: {self.icao_hex} ({self.registration or 'N/A'})"


class SpottedCount(models.Model):
    """
    Collection/spotting statistics aggregated by category.
    Tracks "spotted" counts by airline, aircraft type, etc.
    """
    COUNT_TYPES = [
        ('operator', 'By Operator/Airline'),
        ('aircraft_type', 'By Aircraft Type'),
        ('manufacturer', 'By Manufacturer'),
        ('country', 'By Country'),
        ('category', 'By Category'),
    ]

    count_type = models.CharField(max_length=50, choices=COUNT_TYPES, db_index=True)
    identifier = models.CharField(max_length=100, db_index=True)  # e.g., "AAL" for American Airlines
    display_name = models.CharField(max_length=200, blank=True, null=True)  # e.g., "American Airlines"

    # Counts
    unique_aircraft = models.IntegerField(default=0)  # Unique ICAO hexes
    total_sightings = models.IntegerField(default=0)  # Total position reports
    total_sessions = models.IntegerField(default=0)  # Total tracking sessions

    # First and last seen
    first_seen = models.DateTimeField(blank=True, null=True)
    last_seen = models.DateTimeField(blank=True, null=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'spotted_counts'
        unique_together = ['count_type', 'identifier']
        indexes = [
            models.Index(fields=['count_type', 'unique_aircraft'], name='idx_spotted_type_count'),
            models.Index(fields=['count_type', 'last_seen'], name='idx_spotted_type_last'),
        ]

    def __str__(self):
        return f"{self.get_count_type_display()} - {self.display_name or self.identifier}: {self.unique_aircraft}"


class SpottedAircraft(models.Model):
    """
    Individual aircraft spotted in collection.
    Tracks each unique aircraft the user has seen.
    """
    icao_hex = models.CharField(max_length=10, unique=True, db_index=True)
    registration = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    aircraft_type = models.CharField(max_length=10, blank=True, null=True, db_index=True)
    manufacturer = models.CharField(max_length=100, blank=True, null=True)
    model = models.CharField(max_length=100, blank=True, null=True)
    operator = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    operator_icao = models.CharField(max_length=4, blank=True, null=True)
    country = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    is_military = models.BooleanField(default=False)

    # Sighting stats
    first_seen = models.DateTimeField(db_index=True)
    last_seen = models.DateTimeField(db_index=True)
    times_seen = models.IntegerField(default=1)  # Number of sessions
    total_positions = models.IntegerField(default=0)  # Total position reports

    # Best stats for this aircraft
    max_distance_nm = models.FloatField(blank=True, null=True)
    max_altitude = models.IntegerField(blank=True, null=True)
    max_speed = models.FloatField(blank=True, null=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'spotted_aircraft'
        indexes = [
            models.Index(fields=['first_seen'], name='idx_spotted_ac_first'),
            models.Index(fields=['last_seen'], name='idx_spotted_ac_last'),
            models.Index(fields=['times_seen'], name='idx_spotted_ac_times'),
            models.Index(fields=['aircraft_type', 'times_seen'], name='idx_spotted_ac_type_times'),
        ]

    def __str__(self):
        return f"{self.icao_hex} - {self.registration or 'Unknown'} (seen {self.times_seen}x)"


class SightingStreak(models.Model):
    """
    Streak tracking for consecutive days meeting certain criteria.
    """
    STREAK_TYPES = [
        ('any_sighting', 'Any Aircraft Sighting'),
        ('military', 'Military Aircraft Sighting'),
        ('unique_new', 'New Unique Aircraft'),
        ('rare_type', 'Rare Aircraft Type'),
        ('high_altitude', 'High Altitude Sighting (40k+)'),
        ('long_range', 'Long Range Sighting (100nm+)'),
    ]

    streak_type = models.CharField(max_length=50, choices=STREAK_TYPES, unique=True, db_index=True)

    # Current streak
    current_streak_days = models.IntegerField(default=0)
    current_streak_start = models.DateField(blank=True, null=True)
    last_qualifying_date = models.DateField(blank=True, null=True)

    # Best streak
    best_streak_days = models.IntegerField(default=0)
    best_streak_start = models.DateField(blank=True, null=True)
    best_streak_end = models.DateField(blank=True, null=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sighting_streaks'

    def __str__(self):
        return f"{self.get_streak_type_display()}: {self.current_streak_days} days (best: {self.best_streak_days})"


class DailyStats(models.Model):
    """
    Daily aggregated statistics for tracking activity over time.
    """
    date = models.DateField(unique=True, db_index=True)

    # Counts
    unique_aircraft = models.IntegerField(default=0)
    new_aircraft = models.IntegerField(default=0)  # First-time sightings
    total_sessions = models.IntegerField(default=0)
    total_positions = models.IntegerField(default=0)
    military_count = models.IntegerField(default=0)

    # Records for the day
    max_distance_nm = models.FloatField(blank=True, null=True)
    max_altitude = models.IntegerField(blank=True, null=True)
    max_speed = models.FloatField(blank=True, null=True)

    # Type counts (JSON for flexibility)
    aircraft_types = models.JSONField(default=dict)  # {type: count}
    operators = models.JSONField(default=dict)  # {operator: count}

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'daily_stats'
        ordering = ['-date']

    def __str__(self):
        return f"Stats for {self.date}: {self.unique_aircraft} aircraft"


class NotableRegistration(models.Model):
    """
    Configuration for notable registration patterns to detect.
    """
    PATTERN_TYPES = [
        ('prefix', 'Registration Prefix'),
        ('regex', 'Regular Expression'),
        ('exact', 'Exact Match'),
        ('contains', 'Contains String'),
    ]

    name = models.CharField(max_length=100)
    pattern_type = models.CharField(max_length=20, choices=PATTERN_TYPES, default='prefix')
    pattern = models.CharField(max_length=100)  # The actual pattern to match

    category = models.CharField(max_length=50)  # e.g., "government", "military", "test_flight"
    description = models.TextField(blank=True, null=True)
    rarity_score = models.IntegerField(default=5)  # 1-10 rarity

    is_active = models.BooleanField(default=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notable_registrations'
        indexes = [
            models.Index(fields=['is_active', 'pattern_type'], name='idx_notable_active_type'),
        ]

    def __str__(self):
        return f"{self.name} ({self.pattern_type}: {self.pattern})"


class NotableCallsign(models.Model):
    """
    Configuration for notable callsign patterns to detect.
    """
    PATTERN_TYPES = [
        ('prefix', 'Callsign Prefix'),
        ('regex', 'Regular Expression'),
        ('exact', 'Exact Match'),
        ('contains', 'Contains String'),
    ]

    name = models.CharField(max_length=100)
    pattern_type = models.CharField(max_length=20, choices=PATTERN_TYPES, default='prefix')
    pattern = models.CharField(max_length=100)

    category = models.CharField(max_length=50)  # e.g., "military", "government", "test"
    description = models.TextField(blank=True, null=True)
    rarity_score = models.IntegerField(default=5)

    is_active = models.BooleanField(default=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notable_callsigns'
        indexes = [
            models.Index(fields=['is_active', 'pattern_type'], name='idx_callsign_active_type'),
        ]

    def __str__(self):
        return f"{self.name} ({self.pattern_type}: {self.pattern})"


class RareAircraftType(models.Model):
    """
    Configuration for aircraft types considered rare.
    """
    type_code = models.CharField(max_length=10, unique=True, db_index=True)
    type_name = models.CharField(max_length=100, blank=True, null=True)
    manufacturer = models.CharField(max_length=100, blank=True, null=True)

    category = models.CharField(max_length=50, blank=True, null=True)  # e.g., "military", "historic", "rare"
    description = models.TextField(blank=True, null=True)
    rarity_score = models.IntegerField(default=5)  # 1-10 rarity

    # How many exist / produced
    total_produced = models.IntegerField(blank=True, null=True)
    currently_active = models.IntegerField(blank=True, null=True)

    is_active = models.BooleanField(default=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rare_aircraft_types'

    def __str__(self):
        return f"{self.type_code} - {self.type_name or 'Unknown'} (rarity: {self.rarity_score})"
