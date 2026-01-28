"""
NOTAM serializers for the API.
"""
from rest_framework import serializers
from skyspy.models.notams import CachedNotam, CachedAirline, CachedAircraftType


class CachedNotamSerializer(serializers.ModelSerializer):
    """Serializer for cached NOTAM data."""

    is_active = serializers.BooleanField(read_only=True)
    is_tfr = serializers.BooleanField(read_only=True)

    class Meta:
        model = CachedNotam
        fields = [
            'notam_id', 'notam_type', 'classification', 'location',
            'latitude', 'longitude', 'radius_nm',
            'floor_ft', 'ceiling_ft',
            'effective_start', 'effective_end', 'is_permanent',
            'text', 'reason', 'geometry',
            'is_active', 'is_tfr',
            'fetched_at', 'created_at',
        ]


class NotamResponseSerializer(serializers.Serializer):
    """Response serializer for NOTAM list."""

    notam_id = serializers.CharField(help_text="Unique NOTAM identifier")
    notam_type = serializers.CharField(help_text="NOTAM type (D, FDC, TFR, GPS)")
    classification = serializers.CharField(
        required=False, allow_null=True,
        help_text="NOTAM classification"
    )
    location = serializers.CharField(help_text="ICAO location identifier")
    latitude = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Latitude coordinate"
    )
    longitude = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Longitude coordinate"
    )
    radius_nm = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Radius in nautical miles (for TFRs)"
    )
    floor_ft = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="Floor altitude in feet"
    )
    ceiling_ft = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="Ceiling altitude in feet"
    )
    effective_start = serializers.CharField(help_text="Effective start time (ISO format)")
    effective_end = serializers.CharField(
        required=False, allow_null=True,
        help_text="Effective end time (ISO format)"
    )
    is_permanent = serializers.BooleanField(help_text="Whether NOTAM is permanent")
    text = serializers.CharField(help_text="NOTAM text content")
    geometry = serializers.JSONField(
        required=False, allow_null=True,
        help_text="GeoJSON geometry for TFR boundaries"
    )
    reason = serializers.CharField(
        required=False, allow_null=True,
        help_text="TFR reason (VIP, disaster, etc.)"
    )
    is_active = serializers.BooleanField(help_text="Whether NOTAM is currently active")
    is_tfr = serializers.BooleanField(help_text="Whether this is a TFR")
    distance_nm = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Distance from search center in nm"
    )


class NotamListResponseSerializer(serializers.Serializer):
    """Response wrapper for NOTAM list."""

    notams = NotamResponseSerializer(many=True, help_text="List of NOTAMs")
    count = serializers.IntegerField(help_text="Number of NOTAMs returned")
    timestamp = serializers.CharField(help_text="Response timestamp")


class TfrResponseSerializer(serializers.Serializer):
    """Response serializer for TFR list."""

    notam_id = serializers.CharField(help_text="Unique NOTAM identifier")
    location = serializers.CharField(help_text="ICAO location identifier")
    latitude = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Center latitude"
    )
    longitude = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Center longitude"
    )
    radius_nm = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Radius in nautical miles"
    )
    floor_ft = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="Floor altitude in feet"
    )
    ceiling_ft = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="Ceiling altitude in feet"
    )
    effective_start = serializers.CharField(help_text="Effective start time")
    effective_end = serializers.CharField(
        required=False, allow_null=True,
        help_text="Effective end time"
    )
    reason = serializers.CharField(
        required=False, allow_null=True,
        help_text="TFR reason"
    )
    text = serializers.CharField(help_text="TFR text")
    geometry = serializers.JSONField(
        required=False, allow_null=True,
        help_text="GeoJSON boundary geometry"
    )
    is_active = serializers.BooleanField(help_text="Whether TFR is currently active")
    distance_nm = serializers.FloatField(
        required=False, allow_null=True,
        help_text="Distance from search center in nm"
    )


class TfrListResponseSerializer(serializers.Serializer):
    """Response wrapper for TFR list."""

    tfrs = TfrResponseSerializer(many=True, help_text="List of TFRs")
    count = serializers.IntegerField(help_text="Number of TFRs returned")
    timestamp = serializers.CharField(help_text="Response timestamp")


class NotamStatsSerializer(serializers.Serializer):
    """Statistics about cached NOTAMs."""

    total_notams = serializers.IntegerField(help_text="Total NOTAMs in cache")
    active_notams = serializers.IntegerField(help_text="Currently active NOTAMs")
    active_tfrs = serializers.IntegerField(help_text="Currently active TFRs")
    by_type = serializers.DictField(help_text="Count by NOTAM type")
    last_refresh = serializers.CharField(
        required=False, allow_null=True,
        help_text="Last cache refresh time"
    )
    refresh_interval_minutes = serializers.IntegerField(
        help_text="Cache refresh interval in minutes"
    )


class CachedAirlineSerializer(serializers.ModelSerializer):
    """Serializer for cached airline data."""

    class Meta:
        model = CachedAirline
        fields = [
            'icao_code', 'iata_code', 'name', 'callsign',
            'country', 'active', 'fetched_at',
        ]


class CachedAircraftTypeSerializer(serializers.ModelSerializer):
    """Serializer for cached aircraft type data."""

    class Meta:
        model = CachedAircraftType
        fields = [
            'icao_code', 'iata_code', 'name', 'manufacturer', 'fetched_at',
        ]
