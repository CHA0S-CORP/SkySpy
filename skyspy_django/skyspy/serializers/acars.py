"""
ACARS/VDL2 message serializers.
"""
from rest_framework import serializers
from skyspy.models import AcarsMessage


class AcarsAirlineInfoSerializer(serializers.Serializer):
    """Decoded airline information from callsign."""

    icao = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Airline ICAO code (3 letters)"
    )
    iata = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Airline IATA code (2 letters)"
    )
    name = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Full airline name"
    )
    flight_number = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Flight number portion of callsign"
    )


class AcarsLabelInfoSerializer(serializers.Serializer):
    """Decoded ACARS message label information."""

    name = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Human-readable label name"
    )
    description = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Detailed label description"
    )


class AcarsMessageSerializer(serializers.ModelSerializer):
    """Single ACARS/VDL2 message."""

    airline = AcarsAirlineInfoSerializer(
        required=False,
        allow_null=True,
        help_text="Decoded airline information"
    )
    label_info = AcarsLabelInfoSerializer(
        required=False,
        allow_null=True,
        help_text="Decoded label information"
    )
    decoded_text = serializers.JSONField(
        required=False,
        allow_null=True,
        help_text="Decoded message text fields"
    )
    formatted_text = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Human-readable formatted text"
    )

    class Meta:
        model = AcarsMessage
        fields = [
            'id', 'timestamp', 'source', 'channel', 'frequency',
            'icao_hex', 'registration', 'callsign', 'label',
            'block_id', 'msg_num', 'ack', 'mode', 'text',
            'decoded', 'decoded_text', 'formatted_text',
            'signal_level', 'error_count', 'station_id',
            'airline', 'label_info'
        ]


class AcarsMessagesListSerializer(serializers.Serializer):
    """Response containing ACARS messages."""

    messages = AcarsMessageSerializer(many=True, help_text="ACARS messages")
    count = serializers.IntegerField(help_text="Number of messages")
    filters = serializers.DictField(help_text="Applied filters")


class AcarsStatsSerializer(serializers.Serializer):
    """ACARS service statistics."""

    total_messages = serializers.IntegerField(help_text="Total messages in database")
    last_hour = serializers.IntegerField(help_text="Messages in last hour")
    last_24h = serializers.IntegerField(help_text="Messages in last 24 hours")
    by_source = serializers.DictField(help_text="Count by source")
    top_labels = serializers.ListField(
        child=serializers.DictField(),
        help_text="Most common labels"
    )
    service_stats = serializers.DictField(help_text="Receiver service stats")


class AcarsStatusSerializer(serializers.Serializer):
    """ACARS receiver service status."""

    running = serializers.BooleanField(help_text="Service running status")
    acars = serializers.DictField(help_text="ACARS receiver stats")
    vdlm2 = serializers.DictField(help_text="VDL2 receiver stats")
    buffer_size = serializers.IntegerField(help_text="Messages in memory buffer")


class AcarsLabelsReferenceSerializer(serializers.Serializer):
    """Reference for ACARS message labels."""

    labels = serializers.DictField(help_text="Label code to description mapping")
    sources = serializers.DictField(help_text="Source type descriptions")


# ==============================================================================
# ACARS Stats Serializers
# ==============================================================================

class AcarsLabelStatsSerializer(serializers.Serializer):
    """Statistics for a single message label."""

    label = serializers.CharField(help_text="Message label code")
    count = serializers.IntegerField(help_text="Number of messages")
    name = serializers.CharField(help_text="Human-readable label name")
    description = serializers.CharField(help_text="Label description")
    category = serializers.CharField(help_text="Label category")


class AcarsCategoryStatsSerializer(serializers.Serializer):
    """Statistics for a message category."""

    category = serializers.CharField(help_text="Category identifier")
    name = serializers.CharField(help_text="Category name")
    description = serializers.CharField(help_text="Category description")
    count = serializers.IntegerField(help_text="Number of messages")
    percentage = serializers.FloatField(help_text="Percentage of total messages")


class AcarsFrequencyStatsSerializer(serializers.Serializer):
    """Statistics for a frequency."""

    frequency = serializers.FloatField(help_text="Frequency in MHz")
    frequency_mhz = serializers.CharField(help_text="Formatted frequency string")
    count = serializers.IntegerField(help_text="Number of messages")


class AcarsMessageStatsSerializer(serializers.Serializer):
    """Comprehensive ACARS message statistics."""

    total_messages = serializers.IntegerField(help_text="Total messages in time range")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    by_source = serializers.DictField(help_text="Count by source (ACARS/VDL2)")
    by_label = AcarsLabelStatsSerializer(many=True, help_text="Top labels by count")
    by_category = AcarsCategoryStatsSerializer(many=True, help_text="Messages by category")
    top_frequencies = AcarsFrequencyStatsSerializer(many=True, help_text="Top frequencies")
    messages_with_content = serializers.IntegerField(help_text="Messages with text content")
    content_percentage = serializers.FloatField(help_text="Percentage with content")
    timestamp = serializers.CharField(help_text="Stats generation timestamp")


class AcarsAirlineActivitySerializer(serializers.Serializer):
    """Statistics for airline ACARS activity."""

    airline_icao = serializers.CharField(allow_null=True, help_text="Airline ICAO code")
    airline_iata = serializers.CharField(allow_null=True, help_text="Airline IATA code")
    airline_name = serializers.CharField(help_text="Airline name")
    message_count = serializers.IntegerField(help_text="Total messages")
    unique_flights = serializers.IntegerField(help_text="Unique flight callsigns")


class AcarsAirlineStatsSerializer(serializers.Serializer):
    """ACARS statistics grouped by airline."""

    airlines = AcarsAirlineActivitySerializer(many=True, help_text="Airlines by activity")
    total_with_airline_info = serializers.IntegerField(help_text="Messages with airline info")
    total_messages = serializers.IntegerField(help_text="Total messages analyzed")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    timestamp = serializers.CharField(help_text="Stats generation timestamp")


class AcarsTrendIntervalSerializer(serializers.Serializer):
    """Single interval in ACARS trends."""

    timestamp = serializers.CharField(help_text="Interval start timestamp")
    total = serializers.IntegerField(help_text="Total messages")
    acars = serializers.IntegerField(help_text="ACARS messages")
    vdl2 = serializers.IntegerField(help_text="VDL2 messages")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft ICAO codes")
    unique_flights = serializers.IntegerField(help_text="Unique callsigns")


class AcarsHourlyCountSerializer(serializers.Serializer):
    """Hourly message count."""

    hour = serializers.IntegerField(help_text="Hour of day (0-23)")
    count = serializers.IntegerField(help_text="Message count")


class AcarsPeakIntervalSerializer(serializers.Serializer):
    """Peak activity interval."""

    timestamp = serializers.CharField(allow_null=True, help_text="Peak interval timestamp")
    count = serializers.IntegerField(help_text="Message count at peak")


class AcarsTrendsSerializer(serializers.Serializer):
    """ACARS message trends over time."""

    intervals = AcarsTrendIntervalSerializer(many=True, help_text="Time series data")
    interval_type = serializers.CharField(help_text="Interval type (hour/day)")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    total_messages = serializers.IntegerField(help_text="Total messages in range")
    peak_interval = AcarsPeakIntervalSerializer(help_text="Peak activity interval")
    hourly_distribution = AcarsHourlyCountSerializer(many=True, help_text="Messages by hour of day")
    peak_hour = AcarsHourlyCountSerializer(allow_null=True, help_text="Busiest hour of day")
    quietest_hour = AcarsHourlyCountSerializer(allow_null=True, help_text="Quietest hour of day")
    timestamp = serializers.CharField(help_text="Stats generation timestamp")


class AcarsHourlyCategoryTrendSerializer(serializers.Serializer):
    """Category breakdown for an hour."""

    hour = serializers.IntegerField(help_text="Hour of day (0-23)")
    categories = serializers.DictField(help_text="Category counts")
    total = serializers.IntegerField(help_text="Total for hour")


class AcarsCategoryTrendsSerializer(serializers.Serializer):
    """Message category distribution over time."""

    hourly_category_trends = AcarsHourlyCategoryTrendSerializer(
        many=True, help_text="Category breakdown by hour"
    )
    category_totals = serializers.DictField(help_text="Total count per category")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    timestamp = serializers.CharField(help_text="Stats generation timestamp")


class AcarsAirportMentionSerializer(serializers.Serializer):
    """Airport mentioned in messages."""

    airport = serializers.CharField(help_text="Airport ICAO code")
    count = serializers.IntegerField(help_text="Number of mentions")


class AcarsFreeTextAnalysisSerializer(serializers.Serializer):
    """Free text message analysis results."""

    top_airports_mentioned = AcarsAirportMentionSerializer(
        many=True, help_text="Most mentioned airports"
    )
    weather_content = serializers.DictField(help_text="Weather content breakdown")
    message_patterns = serializers.DictField(help_text="Detected message patterns")
    total_analyzed = serializers.IntegerField(help_text="Messages analyzed")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    timestamp = serializers.CharField(help_text="Analysis timestamp")


class AcarsSummaryStatsSerializer(serializers.Serializer):
    """High-level ACARS summary statistics."""

    total_messages = serializers.IntegerField(help_text="Total messages in range")
    last_hour = serializers.IntegerField(help_text="Messages in last hour")
    time_range_hours = serializers.IntegerField(help_text="Time range in hours")
    by_source = serializers.DictField(help_text="Count by source")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    unique_flights = serializers.IntegerField(help_text="Unique flights")
    messages_per_hour = serializers.FloatField(help_text="Average messages per hour")
    top_label = serializers.CharField(allow_null=True, help_text="Most common label")
    top_label_count = serializers.IntegerField(help_text="Count for top label")
    timestamp = serializers.CharField(help_text="Stats generation timestamp")
