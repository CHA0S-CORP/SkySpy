"""
Serializers for Cannonball Mode API endpoints.
"""
from rest_framework import serializers
from skyspy.models import (
    CannonballPattern, CannonballSession, CannonballAlert,
    CannonballKnownAircraft, CannonballStats,
)


class CannonballPatternSerializer(serializers.ModelSerializer):
    """Serializer for detected flight patterns."""

    is_active = serializers.ReadOnlyField()

    class Meta:
        model = CannonballPattern
        fields = [
            'id', 'icao_hex', 'callsign', 'pattern_type', 'confidence',
            'confidence_score', 'center_lat', 'center_lon', 'radius_nm',
            'pattern_data', 'started_at', 'ended_at', 'duration_seconds',
            'detected_at', 'session', 'is_active',
        ]
        read_only_fields = ['id', 'detected_at', 'is_active']


class CannonballPatternSummarySerializer(serializers.ModelSerializer):
    """Lightweight pattern serializer for nested views."""

    class Meta:
        model = CannonballPattern
        fields = [
            'id', 'pattern_type', 'confidence', 'confidence_score',
            'detected_at', 'duration_seconds',
        ]


class CannonballSessionSerializer(serializers.ModelSerializer):
    """Serializer for LE aircraft tracking sessions."""

    patterns = CannonballPatternSummarySerializer(many=True, read_only=True)
    threat_level_display = serializers.CharField(
        source='get_threat_level_display', read_only=True
    )

    class Meta:
        model = CannonballSession
        fields = [
            'id', 'icao_hex', 'callsign', 'registration',
            'identification_method', 'identification_reason',
            'operator_name', 'operator_icao', 'aircraft_type',
            'is_active', 'threat_level', 'threat_level_display', 'urgency_score',
            'last_lat', 'last_lon', 'last_altitude', 'last_ground_speed', 'last_track',
            'distance_nm', 'bearing', 'closing_speed_kts',
            'first_seen', 'last_seen', 'session_duration_seconds',
            'pattern_count', 'alert_count', 'position_count',
            'patterns', 'metadata',
        ]
        read_only_fields = [
            'id', 'first_seen', 'last_seen', 'session_duration_seconds',
            'pattern_count', 'alert_count', 'position_count', 'patterns',
        ]


class CannonballSessionListSerializer(serializers.ModelSerializer):
    """Lightweight session serializer for list views."""

    class Meta:
        model = CannonballSession
        fields = [
            'id', 'icao_hex', 'callsign', 'is_active',
            'threat_level', 'urgency_score',
            'distance_nm', 'bearing', 'closing_speed_kts',
            'last_seen', 'pattern_count', 'alert_count',
        ]


class CannonballAlertSerializer(serializers.ModelSerializer):
    """Serializer for Cannonball alerts."""

    session_icao = serializers.CharField(source='session.icao_hex', read_only=True)
    session_callsign = serializers.CharField(source='session.callsign', read_only=True)

    class Meta:
        model = CannonballAlert
        fields = [
            'id', 'session', 'session_icao', 'session_callsign',
            'alert_type', 'priority', 'title', 'message',
            'aircraft_lat', 'aircraft_lon', 'aircraft_altitude',
            'user_lat', 'user_lon', 'distance_nm', 'bearing',
            'pattern', 'notified', 'announced',
            'acknowledged', 'acknowledged_at',
            'created_at',
        ]
        read_only_fields = [
            'id', 'session_icao', 'session_callsign',
            'notified', 'announced', 'created_at',
        ]


class CannonballAlertListSerializer(serializers.ModelSerializer):
    """Lightweight alert serializer for list views."""

    session_icao = serializers.CharField(source='session.icao_hex', read_only=True)

    class Meta:
        model = CannonballAlert
        fields = [
            'id', 'session_icao', 'alert_type', 'priority',
            'title', 'distance_nm', 'acknowledged', 'created_at',
        ]


class CannonballKnownAircraftSerializer(serializers.ModelSerializer):
    """Serializer for known LE aircraft database."""

    class Meta:
        model = CannonballKnownAircraft
        fields = [
            'id', 'icao_hex', 'registration', 'aircraft_type', 'aircraft_model',
            'agency_name', 'agency_type', 'agency_state', 'agency_city',
            'source', 'source_url', 'verified', 'verified_at',
            'times_detected', 'last_detected', 'notes',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'verified_at', 'times_detected', 'last_detected',
            'created_at', 'updated_at',
        ]


class CannonballKnownAircraftCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating known LE aircraft entries."""

    class Meta:
        model = CannonballKnownAircraft
        fields = [
            'icao_hex', 'registration', 'aircraft_type', 'aircraft_model',
            'agency_name', 'agency_type', 'agency_state', 'agency_city',
            'source', 'source_url', 'notes',
        ]


class CannonballStatsSerializer(serializers.ModelSerializer):
    """Serializer for Cannonball statistics."""

    class Meta:
        model = CannonballStats
        fields = [
            'id', 'period_type', 'period_start', 'period_end',
            'total_detections', 'unique_aircraft',
            'critical_alerts', 'warning_alerts', 'info_alerts',
            'circling_patterns', 'loitering_patterns',
            'grid_search_patterns', 'speed_trap_patterns',
            'top_aircraft', 'top_agencies', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class CannonballThreatSerializer(serializers.Serializer):
    """Serializer for real-time threat data from cache."""

    icao_hex = serializers.CharField()
    callsign = serializers.CharField(allow_null=True)
    lat = serializers.FloatField(allow_null=True)
    lon = serializers.FloatField(allow_null=True)
    altitude = serializers.IntegerField(allow_null=True)
    ground_speed = serializers.IntegerField(allow_null=True)
    track = serializers.IntegerField(allow_null=True)
    distance_nm = serializers.FloatField(allow_null=True)
    bearing = serializers.FloatField(allow_null=True)
    closing_speed = serializers.FloatField(allow_null=True)
    threat_level = serializers.CharField()
    urgency_score = serializers.FloatField()
    is_known_le = serializers.BooleanField(default=False)
    identification_method = serializers.CharField(allow_null=True)
    identification_reason = serializers.CharField(allow_null=True)
    operator_name = serializers.CharField(allow_null=True)
    agency_name = serializers.CharField(allow_null=True)
    agency_type = serializers.CharField(allow_null=True)
    patterns = serializers.ListField(child=serializers.DictField(), default=list)


class CannonballLocationUpdateSerializer(serializers.Serializer):
    """Serializer for user location updates."""

    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    heading = serializers.FloatField(min_value=0, max_value=360, required=False)
    speed = serializers.FloatField(min_value=0, required=False)


class CannonballSettingsSerializer(serializers.Serializer):
    """Serializer for Cannonball mode settings."""

    max_range_nm = serializers.FloatField(min_value=1, max_value=100, default=15)
    alert_distance_nm = serializers.FloatField(min_value=0.5, max_value=50, default=5)
    voice_enabled = serializers.BooleanField(default=True)
    show_all_aircraft = serializers.BooleanField(default=False)
    patterns_enabled = serializers.ListField(
        child=serializers.ChoiceField(choices=[
            'circling', 'loitering', 'grid_search', 'speed_trap'
        ]),
        default=['circling', 'loitering', 'grid_search', 'speed_trap']
    )
