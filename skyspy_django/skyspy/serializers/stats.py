"""
Serializers for gamification and stats API endpoints.
"""
from rest_framework import serializers
from skyspy.models.stats import (
    PersonalRecord, RareSighting, SpottedCount, SpottedAircraft,
    SightingStreak, DailyStats, NotableRegistration, NotableCallsign, RareAircraftType,
)


# ==========================================================================
# Personal Records Serializers
# ==========================================================================

class PersonalRecordSerializer(serializers.ModelSerializer):
    """Serializer for personal record entries."""

    record_type_display = serializers.CharField(
        source='get_record_type_display',
        read_only=True
    )

    class Meta:
        model = PersonalRecord
        fields = [
            'id', 'record_type', 'record_type_display',
            'icao_hex', 'callsign', 'aircraft_type', 'registration', 'operator',
            'value', 'session_id', 'achieved_at',
            'previous_value', 'previous_icao_hex', 'previous_achieved_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class PersonalRecordsResponseSerializer(serializers.Serializer):
    """Response for personal records endpoint."""

    records = PersonalRecordSerializer(many=True, help_text="List of personal records")
    timestamp = serializers.CharField(help_text="Response timestamp")


class NewRecordSerializer(serializers.Serializer):
    """Serializer for a newly set record notification."""

    record_type = serializers.CharField(help_text="Type of record")
    record_type_display = serializers.CharField(help_text="Human-readable record type")
    value = serializers.FloatField(help_text="New record value")
    icao_hex = serializers.CharField(help_text="Aircraft that set the record")
    previous_value = serializers.FloatField(
        allow_null=True,
        help_text="Previous record value"
    )


# ==========================================================================
# Rare Sightings Serializers
# ==========================================================================

class RareSightingSerializer(serializers.ModelSerializer):
    """Serializer for rare sighting entries."""

    rarity_type_display = serializers.CharField(
        source='get_rarity_type_display',
        read_only=True
    )

    class Meta:
        model = RareSighting
        fields = [
            'id', 'rarity_type', 'rarity_type_display',
            'icao_hex', 'callsign', 'registration', 'aircraft_type', 'operator',
            'sighted_at', 'session_id', 'description', 'rarity_score',
            'times_seen', 'last_seen', 'is_acknowledged',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class RareSightingsResponseSerializer(serializers.Serializer):
    """Response for rare sightings endpoint."""

    sightings = RareSightingSerializer(many=True, help_text="List of rare sightings")
    total_count = serializers.IntegerField(help_text="Total matching sightings")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    timestamp = serializers.CharField(help_text="Response timestamp")


class RareSightingAcknowledgeSerializer(serializers.Serializer):
    """Request to acknowledge a rare sighting."""

    sighting_id = serializers.IntegerField(help_text="ID of sighting to acknowledge")


# ==========================================================================
# Collection Stats Serializers
# ==========================================================================

class SpottedAircraftSerializer(serializers.ModelSerializer):
    """Serializer for spotted aircraft entries."""

    class Meta:
        model = SpottedAircraft
        fields = [
            'icao_hex', 'registration', 'aircraft_type', 'manufacturer', 'model',
            'operator', 'operator_icao', 'country', 'is_military',
            'first_seen', 'last_seen', 'times_seen', 'total_positions',
            'max_distance_nm', 'max_altitude', 'max_speed',
        ]
        read_only_fields = fields


class SpottedCountSerializer(serializers.ModelSerializer):
    """Serializer for spotted count aggregations."""

    count_type_display = serializers.CharField(
        source='get_count_type_display',
        read_only=True
    )

    class Meta:
        model = SpottedCount
        fields = [
            'count_type', 'count_type_display', 'identifier', 'display_name',
            'unique_aircraft', 'total_sightings', 'total_sessions',
            'first_seen', 'last_seen',
        ]
        read_only_fields = fields


class MostSeenAircraftSerializer(serializers.Serializer):
    """Summary of most frequently seen aircraft."""

    icao_hex = serializers.CharField(help_text="ICAO hex identifier")
    registration = serializers.CharField(allow_null=True, help_text="Registration")
    operator = serializers.CharField(allow_null=True, help_text="Operator name")
    times_seen = serializers.IntegerField(help_text="Number of times seen")


class FirstLastAircraftSerializer(serializers.Serializer):
    """Summary of first/last aircraft seen."""

    icao_hex = serializers.CharField(help_text="ICAO hex identifier")
    registration = serializers.CharField(allow_null=True, help_text="Registration")
    first_seen = serializers.CharField(allow_null=True, help_text="First seen timestamp")
    last_seen = serializers.CharField(allow_null=True, help_text="Last seen timestamp")


class CollectionStatsResponseSerializer(serializers.Serializer):
    """Response for collection stats endpoint."""

    total_unique_aircraft = serializers.IntegerField(help_text="Total unique aircraft spotted")
    military_aircraft = serializers.IntegerField(help_text="Military aircraft count")
    unique_types = serializers.IntegerField(help_text="Unique aircraft types")
    unique_operators = serializers.IntegerField(help_text="Unique operators")
    unique_countries = serializers.IntegerField(help_text="Unique countries")
    first_aircraft = FirstLastAircraftSerializer(
        allow_null=True,
        help_text="First aircraft ever spotted"
    )
    last_aircraft = FirstLastAircraftSerializer(
        allow_null=True,
        help_text="Most recently spotted aircraft"
    )
    most_seen = MostSeenAircraftSerializer(many=True, help_text="Most frequently seen aircraft")
    timestamp = serializers.CharField(help_text="Response timestamp")


class SpottedByTypeEntrySerializer(serializers.Serializer):
    """Entry in spotted by type list."""

    type_code = serializers.CharField(help_text="Aircraft type code")
    type_name = serializers.CharField(allow_null=True, help_text="Aircraft type name")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft of this type")
    total_sightings = serializers.IntegerField(help_text="Total sightings")
    total_sessions = serializers.IntegerField(help_text="Total sessions")
    first_seen = serializers.CharField(allow_null=True, help_text="First seen timestamp")
    last_seen = serializers.CharField(allow_null=True, help_text="Last seen timestamp")


class SpottedByTypeResponseSerializer(serializers.Serializer):
    """Response for spotted by type endpoint."""

    types = SpottedByTypeEntrySerializer(many=True, help_text="Types with counts")
    total_types = serializers.IntegerField(help_text="Total unique types")
    timestamp = serializers.CharField(help_text="Response timestamp")


class SpottedByOperatorEntrySerializer(serializers.Serializer):
    """Entry in spotted by operator list."""

    operator_code = serializers.CharField(help_text="Operator ICAO code")
    operator_name = serializers.CharField(allow_null=True, help_text="Operator name")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft from operator")
    total_sightings = serializers.IntegerField(help_text="Total sightings")
    total_sessions = serializers.IntegerField(help_text="Total sessions")
    first_seen = serializers.CharField(allow_null=True, help_text="First seen timestamp")
    last_seen = serializers.CharField(allow_null=True, help_text="Last seen timestamp")


class SpottedByOperatorResponseSerializer(serializers.Serializer):
    """Response for spotted by operator endpoint."""

    operators = SpottedByOperatorEntrySerializer(many=True, help_text="Operators with counts")
    total_operators = serializers.IntegerField(help_text="Total unique operators")
    timestamp = serializers.CharField(help_text="Response timestamp")


# ==========================================================================
# Streak Serializers
# ==========================================================================

class SightingStreakSerializer(serializers.ModelSerializer):
    """Serializer for sighting streak entries."""

    streak_type_display = serializers.CharField(
        source='get_streak_type_display',
        read_only=True
    )

    class Meta:
        model = SightingStreak
        fields = [
            'streak_type', 'streak_type_display',
            'current_streak_days', 'current_streak_start', 'last_qualifying_date',
            'best_streak_days', 'best_streak_start', 'best_streak_end',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class StreaksResponseSerializer(serializers.Serializer):
    """Response for streaks endpoint."""

    streaks = SightingStreakSerializer(many=True, help_text="List of streaks")
    timestamp = serializers.CharField(help_text="Response timestamp")


# ==========================================================================
# Daily Stats Serializers
# ==========================================================================

class DailyStatsSerializer(serializers.ModelSerializer):
    """Serializer for daily stats entries."""

    top_types = serializers.SerializerMethodField()
    top_operators = serializers.SerializerMethodField()

    class Meta:
        model = DailyStats
        fields = [
            'date', 'unique_aircraft', 'new_aircraft', 'total_sessions',
            'total_positions', 'military_count',
            'max_distance_nm', 'max_altitude', 'max_speed',
            'top_types', 'top_operators',
        ]
        read_only_fields = fields

    def get_top_types(self, obj):
        """Get top 5 aircraft types."""
        if obj.aircraft_types:
            return dict(list(obj.aircraft_types.items())[:5])
        return {}

    def get_top_operators(self, obj):
        """Get top 5 operators."""
        if obj.operators:
            return dict(list(obj.operators.items())[:5])
        return {}


class DailyStatsEntrySerializer(serializers.Serializer):
    """Single day stats entry."""

    date = serializers.CharField(help_text="Date")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft for the day")
    new_aircraft = serializers.IntegerField(help_text="First-time aircraft")
    total_sessions = serializers.IntegerField(help_text="Total tracking sessions")
    total_positions = serializers.IntegerField(help_text="Total position reports")
    military_count = serializers.IntegerField(help_text="Military aircraft count")
    max_distance_nm = serializers.FloatField(allow_null=True, help_text="Max distance for the day")
    max_altitude = serializers.IntegerField(allow_null=True, help_text="Max altitude for the day")
    max_speed = serializers.FloatField(allow_null=True, help_text="Max speed for the day")
    top_types = serializers.DictField(help_text="Top aircraft types with counts")
    top_operators = serializers.DictField(help_text="Top operators with counts")


class DailyStatsResponseSerializer(serializers.Serializer):
    """Response for daily stats endpoint."""

    days = DailyStatsEntrySerializer(many=True, help_text="Daily stats entries")
    total_days = serializers.IntegerField(help_text="Total days with data")
    timestamp = serializers.CharField(help_text="Response timestamp")


# ==========================================================================
# Lifetime Stats Serializers
# ==========================================================================

class AllTimeRecordSerializer(serializers.Serializer):
    """All-time record entry."""

    value = serializers.FloatField(help_text="Record value")
    icao_hex = serializers.CharField(help_text="Aircraft that holds the record")
    callsign = serializers.CharField(allow_null=True, help_text="Callsign when record was set")
    achieved_at = serializers.CharField(allow_null=True, help_text="When record was achieved")


class FirstSightingSerializer(serializers.Serializer):
    """First sighting info."""

    icao_hex = serializers.CharField(help_text="ICAO hex of first aircraft")
    callsign = serializers.CharField(allow_null=True, help_text="Callsign")
    timestamp = serializers.CharField(allow_null=True, help_text="Timestamp")


class LifetimeStatsResponseSerializer(serializers.Serializer):
    """Response for lifetime stats endpoint."""

    total_unique_aircraft = serializers.IntegerField(help_text="All-time unique aircraft")
    total_sessions = serializers.IntegerField(help_text="All-time tracking sessions")
    total_positions = serializers.IntegerField(help_text="All-time position reports")
    unique_aircraft_types = serializers.IntegerField(help_text="Unique aircraft types spotted")
    unique_operators = serializers.IntegerField(help_text="Unique operators spotted")
    unique_countries = serializers.IntegerField(help_text="Unique countries")
    active_tracking_days = serializers.IntegerField(help_text="Days with activity")
    total_rare_sightings = serializers.IntegerField(help_text="Total rare sightings logged")
    all_time_records = serializers.DictField(
        child=AllTimeRecordSerializer(),
        help_text="All-time records by type"
    )
    first_sighting = FirstSightingSerializer(
        allow_null=True,
        help_text="First ever sighting"
    )
    timestamp = serializers.CharField(help_text="Response timestamp")


# ==========================================================================
# Configuration Serializers
# ==========================================================================

class NotableRegistrationSerializer(serializers.ModelSerializer):
    """Serializer for notable registration patterns."""

    pattern_type_display = serializers.CharField(
        source='get_pattern_type_display',
        read_only=True
    )

    class Meta:
        model = NotableRegistration
        fields = [
            'id', 'name', 'pattern_type', 'pattern_type_display', 'pattern',
            'category', 'description', 'rarity_score', 'is_active',
            'created_at', 'updated_at',
        ]


class NotableCallsignSerializer(serializers.ModelSerializer):
    """Serializer for notable callsign patterns."""

    pattern_type_display = serializers.CharField(
        source='get_pattern_type_display',
        read_only=True
    )

    class Meta:
        model = NotableCallsign
        fields = [
            'id', 'name', 'pattern_type', 'pattern_type_display', 'pattern',
            'category', 'description', 'rarity_score', 'is_active',
            'created_at', 'updated_at',
        ]


class RareAircraftTypeSerializer(serializers.ModelSerializer):
    """Serializer for rare aircraft types."""

    class Meta:
        model = RareAircraftType
        fields = [
            'id', 'type_code', 'type_name', 'manufacturer',
            'category', 'description', 'rarity_score',
            'total_produced', 'currently_active', 'is_active',
            'created_at', 'updated_at',
        ]


# ==========================================================================
# Combined Dashboard Serializer
# ==========================================================================

class GamificationDashboardSerializer(serializers.Serializer):
    """Combined gamification dashboard response."""

    personal_records = PersonalRecordsResponseSerializer(help_text="Personal records")
    recent_rare_sightings = RareSightingsResponseSerializer(help_text="Recent rare sightings")
    collection_stats = CollectionStatsResponseSerializer(help_text="Collection statistics")
    streaks = StreaksResponseSerializer(help_text="Streak information")
    lifetime_stats = LifetimeStatsResponseSerializer(help_text="Lifetime statistics")
    timestamp = serializers.CharField(help_text="Response timestamp")
