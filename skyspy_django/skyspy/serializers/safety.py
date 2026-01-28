"""
Safety event serializers for TCAS and conflict monitoring.
"""
from rest_framework import serializers
from skyspy.models import SafetyEvent


class SafetyEventSerializer(serializers.ModelSerializer):
    """Single safety event record."""

    icao = serializers.CharField(source='icao_hex', read_only=True)
    icao_2 = serializers.CharField(source='icao_hex_2', read_only=True)
    timestamp = serializers.DateTimeField(read_only=True)

    class Meta:
        model = SafetyEvent
        fields = [
            'id', 'event_type', 'severity', 'icao', 'icao_2',
            'callsign', 'callsign_2', 'message', 'details',
            'aircraft_snapshot', 'aircraft_snapshot_2',
            'acknowledged', 'acknowledged_at', 'timestamp'
        ]


class SafetyEventsListSerializer(serializers.Serializer):
    """Response containing safety events."""

    events = SafetyEventSerializer(many=True, help_text="Safety events")
    count = serializers.IntegerField(help_text="Number of events")


class SafetyStatsSerializer(serializers.Serializer):
    """Safety monitoring statistics."""

    monitoring_enabled = serializers.BooleanField(
        help_text="Whether safety monitoring is active"
    )
    thresholds = serializers.DictField(help_text="Current safety thresholds")
    time_range_hours = serializers.IntegerField(
        default=24,
        help_text="Statistics time range"
    )
    events_by_type = serializers.DictField(help_text="Event count by type")
    events_by_severity = serializers.DictField(help_text="Event count by severity")
    events_by_type_severity = serializers.DictField(
        help_text="Per-type severity breakdown"
    )
    total_events = serializers.IntegerField(help_text="Total events in time range")
    unique_aircraft = serializers.IntegerField(
        help_text="Unique aircraft involved in events"
    )
    event_rate_per_hour = serializers.FloatField(help_text="Average events per hour")
    events_by_hour = serializers.ListField(
        child=serializers.DictField(),
        help_text="Hourly event distribution"
    )
    top_aircraft = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aircraft with most events"
    )
    recent_events = serializers.ListField(
        child=serializers.DictField(),
        help_text="Most recent events"
    )
    monitor_state = serializers.DictField(help_text="Monitor internal state")
    timestamp = serializers.CharField(help_text="Response timestamp")


class AircraftSafetyStatsSerializer(serializers.Serializer):
    """Safety statistics for a specific aircraft."""

    icao_hex = serializers.CharField(help_text="Aircraft ICAO hex")
    callsign = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Last known callsign"
    )
    total_events = serializers.IntegerField(
        help_text="Total events involving this aircraft"
    )
    events_by_type = serializers.DictField(help_text="Events by type")
    events_by_severity = serializers.DictField(help_text="Events by severity")
    worst_severity = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Worst severity level"
    )
    last_event_time = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Most recent event timestamp"
    )
    last_event_type = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Most recent event type"
    )


class AircraftSafetyStatsListSerializer(serializers.Serializer):
    """Response for aircraft safety statistics."""

    aircraft = AircraftSafetyStatsSerializer(
        many=True,
        help_text="Aircraft statistics"
    )
    total_aircraft = serializers.IntegerField(help_text="Total unique aircraft")
    time_range_hours = serializers.IntegerField(help_text="Statistics time range")
    timestamp = serializers.CharField(help_text="Response timestamp")
