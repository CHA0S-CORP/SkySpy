"""
Aircraft-related serializers for live tracking, info, and photos.
"""
from rest_framework import serializers
from skyspy.models import AircraftSighting, AircraftSession, AircraftInfo, AirframeSourceData


class AircraftSerializer(serializers.Serializer):
    """Base aircraft data serializer for live tracking."""

    hex = serializers.CharField(
        source='icao_hex',
        help_text="ICAO 24-bit hex identifier"
    )
    flight = serializers.CharField(
        source='callsign',
        required=False,
        allow_null=True,
        help_text="Callsign/flight number"
    )
    type = serializers.CharField(
        source='aircraft_type',
        required=False,
        allow_null=True,
        help_text="Aircraft type code (ICAO)"
    )
    alt = serializers.IntegerField(
        source='altitude_baro',
        required=False,
        allow_null=True,
        help_text="Barometric altitude in feet"
    )
    gs = serializers.FloatField(
        source='ground_speed',
        required=False,
        allow_null=True,
        help_text="Ground speed in knots"
    )
    vr = serializers.IntegerField(
        source='vertical_rate',
        required=False,
        allow_null=True,
        help_text="Vertical rate in feet/minute"
    )
    distance_nm = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Distance from feeder in nautical miles"
    )
    squawk = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Transponder squawk code"
    )
    category = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Aircraft category (A0-D7)"
    )
    rssi = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Signal strength in dBFS"
    )
    lat = serializers.FloatField(
        source='latitude',
        required=False,
        allow_null=True,
        help_text="Latitude in decimal degrees"
    )
    lon = serializers.FloatField(
        source='longitude',
        required=False,
        allow_null=True,
        help_text="Longitude in decimal degrees"
    )
    track = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Ground track in degrees"
    )
    military = serializers.BooleanField(
        source='is_military',
        default=False,
        help_text="Military aircraft flag"
    )
    emergency = serializers.BooleanField(
        source='is_emergency',
        default=False,
        help_text="Emergency squawk detected"
    )


class AircraftListSerializer(serializers.Serializer):
    """Response containing list of aircraft with metadata."""

    aircraft = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of aircraft currently tracked"
    )
    count = serializers.IntegerField(help_text="Number of aircraft in response")
    now = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Unix timestamp from data source"
    )
    messages = serializers.IntegerField(
        default=0,
        help_text="Total messages received by feeder"
    )
    timestamp = serializers.CharField(help_text="ISO 8601 timestamp of response")


class TopAircraftSerializer(serializers.Serializer):
    """Response for top aircraft endpoint with categorized lists."""

    closest = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aircraft closest to feeder"
    )
    highest = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aircraft at highest altitude"
    )
    fastest = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aircraft with highest ground speed"
    )
    climbing = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aircraft with highest climb rate"
    )
    military = serializers.ListField(
        child=serializers.DictField(),
        help_text="Military aircraft detected"
    )
    total = serializers.IntegerField(help_text="Total aircraft currently tracked")
    timestamp = serializers.CharField(help_text="ISO 8601 timestamp")


class AircraftStatsSerializer(serializers.Serializer):
    """Statistical summary of tracked aircraft."""

    total = serializers.IntegerField(help_text="Total aircraft tracked")
    with_position = serializers.IntegerField(help_text="Aircraft with valid position")
    military = serializers.IntegerField(help_text="Military aircraft count")
    emergency = serializers.ListField(
        child=serializers.DictField(),
        help_text="Aircraft squawking emergency"
    )
    categories = serializers.DictField(help_text="Count by aircraft category")
    altitude = serializers.DictField(help_text="Count by altitude band")
    messages = serializers.IntegerField(help_text="Total messages received")
    timestamp = serializers.CharField(help_text="ISO 8601 timestamp")


class MatchedRadioCallSerializer(serializers.Serializer):
    """Radio call matched to an aircraft."""

    id = serializers.IntegerField(help_text="Transmission ID")
    created_at = serializers.CharField(help_text="Transmission timestamp")
    transcript = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Transcribed text"
    )
    frequency_mhz = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Radio frequency"
    )
    channel_name = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Channel name"
    )
    duration_seconds = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Audio duration"
    )
    confidence = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Callsign extraction confidence"
    )
    raw_text = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Raw callsign text from transcript"
    )
    audio_url = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="URL to audio file"
    )


class AirframeSourceDataSerializer(serializers.ModelSerializer):
    """Per-source airframe data showing raw data from each external database."""

    class Meta:
        model = AirframeSourceData
        fields = [
            'source', 'raw_data', 'registration', 'type_code', 'type_name',
            'manufacturer', 'model', 'serial_number', 'year_built',
            'operator', 'operator_icao', 'owner', 'country', 'city', 'state',
            'category', 'is_military', 'is_interesting', 'is_pia', 'is_ladd',
            'fetched_at', 'updated_at',
        ]


class AircraftInfoSerializer(serializers.ModelSerializer):
    """Detailed aircraft registration and airframe information."""

    age_years = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()
    photo_thumbnail_url = serializers.SerializerMethodField()
    cached_at = serializers.DateTimeField(source='updated_at', read_only=True)
    matched_radio_calls = MatchedRadioCallSerializer(
        many=True,
        required=False,
        allow_null=True
    )
    source_data = AirframeSourceDataSerializer(
        many=True,
        read_only=True,
        help_text="Raw data from each external source"
    )

    class Meta:
        model = AircraftInfo
        fields = [
            'icao_hex', 'registration', 'type_code', 'type_name',
            'manufacturer', 'model', 'serial_number', 'year_built',
            'age_years', 'first_flight_date', 'delivery_date', 'airframe_hours',
            'operator', 'operator_icao', 'operator_callsign', 'owner',
            'country', 'country_code', 'category', 'is_military',
            'photo_url', 'photo_thumbnail_url', 'photo_photographer',
            'photo_source', 'extra_data', 'cached_at', 'fetch_failed',
            'matched_radio_calls', 'source_data',
        ]

    def get_age_years(self, obj):
        """Calculate aircraft age in years."""
        if obj.year_built:
            from datetime import datetime
            current_year = datetime.now().year
            return current_year - obj.year_built
        return None

    def get_photo_url(self, obj):
        """Return cached photo URL if available, otherwise external URL."""
        from django.conf import settings
        from pathlib import Path

        if not obj.icao_hex:
            return obj.photo_url

        if settings.PHOTO_CACHE_ENABLED:
            if settings.S3_ENABLED:
                # For S3: use photo_cache service to get URL (with existence check)
                from skyspy.services.photo_cache import get_photo_url as get_cached_url
                cached_url = get_cached_url(obj.icao_hex, is_thumbnail=False, verify_exists=True)
                if cached_url:
                    return cached_url
            else:
                # For local: verify file actually exists
                cache_dir = Path(settings.PHOTO_CACHE_DIR)
                photo_path = cache_dir / f"{obj.icao_hex.upper()}.jpg"
                if photo_path.exists() and photo_path.stat().st_size > 0:
                    return f"/api/v1/photos/{obj.icao_hex.upper()}"

        # Fall back to external URL
        return obj.photo_url

    def get_photo_thumbnail_url(self, obj):
        """Return cached thumbnail URL if available, otherwise external URL."""
        from django.conf import settings
        from pathlib import Path

        if not obj.icao_hex:
            return obj.photo_thumbnail_url

        if settings.PHOTO_CACHE_ENABLED:
            if settings.S3_ENABLED:
                # For S3: use photo_cache service to get URL (with existence check)
                from skyspy.services.photo_cache import get_photo_url as get_cached_url
                cached_url = get_cached_url(obj.icao_hex, is_thumbnail=True, verify_exists=True)
                if cached_url:
                    return cached_url
            else:
                # For local: verify file actually exists
                cache_dir = Path(settings.PHOTO_CACHE_DIR)
                thumb_path = cache_dir / f"{obj.icao_hex.upper()}_thumb.jpg"
                if thumb_path.exists() and thumb_path.stat().st_size > 0:
                    return f"/api/v1/photos/{obj.icao_hex.upper()}/thumb"

        # Fall back to external URL
        return obj.photo_thumbnail_url


class AircraftPhotoSerializer(serializers.Serializer):
    """Aircraft photo information."""

    icao_hex = serializers.CharField(help_text="ICAO hex identifier")
    photo_url = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Full-size photo URL"
    )
    thumbnail_url = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Thumbnail URL"
    )
    photographer = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Photographer credit"
    )
    source = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Photo source"
    )


class BulkAircraftInfoSerializer(serializers.Serializer):
    """Response for bulk aircraft info lookup."""

    aircraft = serializers.DictField(
        help_text="Map of ICAO hex to aircraft info"
    )
    found = serializers.IntegerField(help_text="Number of aircraft found in cache")
    requested = serializers.IntegerField(
        help_text="Number of valid ICAO codes requested"
    )


class AircraftInfoCacheStatsSerializer(serializers.Serializer):
    """Statistics about aircraft info cache."""

    total_cached = serializers.IntegerField(help_text="Total aircraft in cache")
    failed_lookups = serializers.IntegerField(help_text="Failed lookup count")
    with_photos = serializers.IntegerField(help_text="Aircraft with photos cached")
    cache_duration_hours = serializers.IntegerField(help_text="Cache TTL in hours")
    retry_after_hours = serializers.IntegerField(
        help_text="Retry failed lookups after hours"
    )
