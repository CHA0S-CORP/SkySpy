"""
Aviation data serializers for airspace, airports, navaids, and PIREPs.
"""
from rest_framework import serializers
from skyspy.models import (
    AirspaceAdvisory,
    AirspaceBoundary,
    CachedAirport,
    CachedNavaid,
    CachedGeoJSON,
    CachedPirep
)


class AirspaceAdvisorySerializer(serializers.ModelSerializer):
    """Active airspace advisory."""

    class Meta:
        model = AirspaceAdvisory
        fields = [
            'id', 'fetched_at', 'advisory_id', 'advisory_type', 'hazard',
            'severity', 'valid_from', 'valid_to', 'lower_alt_ft',
            'upper_alt_ft', 'region', 'polygon', 'raw_text', 'source_data'
        ]


class AirspaceBoundarySerializer(serializers.ModelSerializer):
    """Static airspace boundary."""

    class Meta:
        model = AirspaceBoundary
        fields = [
            'id', 'fetched_at', 'name', 'icao', 'airspace_class',
            'floor_ft', 'ceiling_ft', 'center_lat', 'center_lon',
            'radius_nm', 'polygon', 'controlling_agency', 'schedule',
            'source', 'source_id', 'updated_at'
        ]


class CachedAirportSerializer(serializers.ModelSerializer):
    """Cached airport data."""

    class Meta:
        model = CachedAirport
        fields = [
            'id', 'fetched_at', 'icao_id', 'name', 'latitude', 'longitude',
            'elevation_ft', 'airport_type', 'country', 'region', 'source_data'
        ]


class CachedNavaidSerializer(serializers.ModelSerializer):
    """Cached navigation aid data."""

    class Meta:
        model = CachedNavaid
        fields = [
            'id', 'fetched_at', 'ident', 'name', 'navaid_type',
            'latitude', 'longitude', 'frequency', 'channel', 'source_data'
        ]


class CachedGeoJSONSerializer(serializers.ModelSerializer):
    """Cached GeoJSON overlay data."""

    class Meta:
        model = CachedGeoJSON
        fields = [
            'id', 'fetched_at', 'data_type', 'name', 'code',
            'bbox_min_lat', 'bbox_max_lat', 'bbox_min_lon', 'bbox_max_lon',
            'geometry', 'properties'
        ]


class CachedPirepSerializer(serializers.ModelSerializer):
    """Cached PIREP data."""

    class Meta:
        model = CachedPirep
        fields = [
            'id', 'fetched_at', 'pirep_id', 'report_type', 'latitude',
            'longitude', 'location', 'observation_time', 'flight_level',
            'altitude_ft', 'aircraft_type', 'turbulence_type',
            'turbulence_freq', 'turbulence_base_ft', 'turbulence_top_ft',
            'icing_type', 'icing_intensity', 'icing_base_ft', 'icing_top_ft',
            'sky_cover', 'visibility_sm', 'weather', 'temperature_c',
            'wind_dir', 'wind_speed_kt', 'raw_text', 'source_data'
        ]


class AviationDataSerializer(serializers.Serializer):
    """Generic aviation data response."""

    data = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aviation data items"
    )
    count = serializers.IntegerField(help_text="Number of items")
    source = serializers.CharField(
        default="aviationweather.gov",
        help_text="Data source"
    )
    cached = serializers.BooleanField(
        default=False,
        help_text="Whether data is from cache"
    )
    cache_age_seconds = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Cache age if cached"
    )
