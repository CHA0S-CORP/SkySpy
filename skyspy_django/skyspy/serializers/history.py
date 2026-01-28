"""
History-related serializers for sightings, sessions, and analytics.
"""
from rest_framework import serializers
from skyspy.models import AircraftSighting, AircraftSession


class SightingSerializer(serializers.ModelSerializer):
    """Single aircraft sighting record."""

    timestamp = serializers.DateTimeField(read_only=True)
    lat = serializers.FloatField(source='latitude')
    lon = serializers.FloatField(source='longitude')
    altitude = serializers.IntegerField(source='altitude_baro')
    gs = serializers.FloatField(source='ground_speed')
    vr = serializers.IntegerField(source='vertical_rate')

    class Meta:
        model = AircraftSighting
        fields = [
            'id', 'timestamp', 'icao_hex', 'callsign', 'lat', 'lon',
            'altitude', 'gs', 'vr', 'distance_nm', 'is_military', 'squawk'
        ]


class SightingsListSerializer(serializers.Serializer):
    """Response containing list of sightings."""

    sightings = SightingSerializer(many=True, help_text="List of sightings")
    count = serializers.IntegerField(help_text="Number of sightings returned")
    total = serializers.IntegerField(help_text="Total sightings matching query")


class SessionSerializer(serializers.ModelSerializer):
    """Aircraft tracking session record."""

    duration_min = serializers.SerializerMethodField()
    positions = serializers.IntegerField(source='total_positions')
    min_alt = serializers.IntegerField(source='min_altitude')
    max_alt = serializers.IntegerField(source='max_altitude')
    max_vr = serializers.IntegerField(source='max_vertical_rate')
    type = serializers.CharField(source='aircraft_type')
    safety_event_count = serializers.IntegerField(default=0, read_only=True)

    class Meta:
        model = AircraftSession
        fields = [
            'id', 'icao_hex', 'callsign', 'first_seen', 'last_seen',
            'duration_min', 'positions', 'min_distance_nm', 'max_distance_nm',
            'min_alt', 'max_alt', 'max_vr', 'min_rssi', 'max_rssi',
            'is_military', 'type', 'safety_event_count'
        ]

    def get_duration_min(self, obj):
        """Calculate session duration in minutes."""
        if obj.first_seen and obj.last_seen:
            delta = obj.last_seen - obj.first_seen
            return round(delta.total_seconds() / 60, 1)
        return 0.0


class SessionsListSerializer(serializers.Serializer):
    """Response containing list of sessions."""

    sessions = SessionSerializer(many=True, help_text="List of sessions")
    count = serializers.IntegerField(help_text="Number of sessions returned")


class HistoryStatsSerializer(serializers.Serializer):
    """Historical statistics."""

    total_sightings = serializers.IntegerField(help_text="Total sighting records")
    total_sessions = serializers.IntegerField(help_text="Total tracking sessions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft seen")
    military_sessions = serializers.IntegerField(help_text="Military aircraft sessions")
    time_range_hours = serializers.IntegerField(help_text="Statistics time range")
    avg_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Average altitude in feet"
    )
    max_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Maximum altitude in feet"
    )
    min_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Minimum altitude in feet"
    )
    avg_distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Average distance in nautical miles"
    )
    max_distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Maximum distance in nautical miles"
    )
    avg_speed = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Average ground speed in knots"
    )
    max_speed = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Maximum ground speed in knots"
    )
    filters_applied = serializers.DictField(
        required=False,
        allow_null=True,
        help_text="Filters that were applied"
    )


class TrendIntervalSerializer(serializers.Serializer):
    """Single interval in trend data."""

    timestamp = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Interval start timestamp"
    )
    position_count = serializers.IntegerField(help_text="Position reports in interval")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft in interval")
    military_count = serializers.IntegerField(help_text="Military aircraft count")
    avg_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Average altitude"
    )
    max_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Maximum altitude"
    )
    avg_distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Average distance"
    )
    max_distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Maximum distance"
    )
    avg_speed = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Average speed"
    )
    max_speed = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Maximum speed"
    )


class TrendSummarySerializer(serializers.Serializer):
    """Summary of trend data."""

    total_unique_aircraft = serializers.IntegerField(
        help_text="Total unique aircraft in range"
    )
    peak_concurrent = serializers.IntegerField(help_text="Peak concurrent aircraft")
    peak_interval = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Interval with peak aircraft"
    )
    total_intervals = serializers.IntegerField(help_text="Number of intervals")


class TrendsSerializer(serializers.Serializer):
    """Response for trends endpoint."""

    intervals = TrendIntervalSerializer(many=True, help_text="Trend data per interval")
    interval_type = serializers.CharField(help_text="Interval type (15min, hour, day)")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    summary = TrendSummarySerializer(help_text="Summary statistics")


class TopPerformerEntrySerializer(serializers.Serializer):
    """Single entry in top performers list."""

    icao_hex = serializers.CharField(help_text="Aircraft ICAO hex")
    callsign = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Flight callsign"
    )
    aircraft_type = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Aircraft type code"
    )
    is_military = serializers.BooleanField(help_text="Military aircraft flag")
    first_seen = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="First seen timestamp"
    )
    last_seen = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Last seen timestamp"
    )
    duration_min = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Tracking duration in minutes"
    )
    positions = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Position report count"
    )
    min_distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Minimum distance"
    )
    max_distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Maximum distance"
    )
    min_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Minimum altitude"
    )
    max_altitude = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Maximum altitude"
    )
    max_speed = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Maximum ground speed"
    )


class TopPerformersSerializer(serializers.Serializer):
    """Response for top performers endpoint."""

    longest_tracked = TopPerformerEntrySerializer(
        many=True,
        help_text="Longest tracked sessions"
    )
    furthest_distance = TopPerformerEntrySerializer(
        many=True,
        help_text="Furthest distance sessions"
    )
    highest_altitude = TopPerformerEntrySerializer(
        many=True,
        help_text="Highest altitude sessions"
    )
    most_positions = TopPerformerEntrySerializer(
        many=True,
        help_text="Most positions sessions"
    )
    closest_approach = TopPerformerEntrySerializer(
        many=True,
        help_text="Closest approach sessions"
    )
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    limit = serializers.IntegerField(help_text="Max entries per category")
