"""
Audio transmission serializers.
"""
from rest_framework import serializers
from skyspy.models import AudioTransmission


class AudioTransmissionSerializer(serializers.ModelSerializer):
    """Single audio transmission record."""

    metadata = serializers.JSONField(
        source='extra_metadata',
        required=False,
        allow_null=True,
        help_text="Additional metadata"
    )

    class Meta:
        model = AudioTransmission
        fields = [
            'id', 'created_at', 'filename', 's3_key', 's3_url',
            'file_size_bytes', 'duration_seconds', 'format',
            'frequency_mhz', 'channel_name', 'squelch_level',
            'transcription_status', 'transcription_queued_at',
            'transcription_started_at', 'transcription_completed_at',
            'transcription_error', 'transcript', 'transcript_confidence',
            'transcript_language', 'transcript_segments',
            'identified_airframes', 'metadata'
        ]


class AudioTransmissionCreateSerializer(serializers.Serializer):
    """Request body for creating an audio transmission record."""

    frequency_mhz = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Frequency in MHz"
    )
    channel_name = serializers.CharField(
        max_length=100,
        required=False,
        allow_null=True,
        help_text="Channel name"
    )
    duration_seconds = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Audio duration in seconds"
    )
    metadata = serializers.JSONField(
        required=False,
        allow_null=True,
        help_text="Additional metadata"
    )


class AudioTransmissionListSerializer(serializers.Serializer):
    """Response containing list of audio transmissions."""

    transmissions = AudioTransmissionSerializer(
        many=True,
        help_text="Audio transmissions"
    )
    count = serializers.IntegerField(help_text="Number of transmissions returned")
    total = serializers.IntegerField(help_text="Total transmissions matching query")


class AudioUploadSerializer(serializers.Serializer):
    """Response from audio upload endpoint."""

    id = serializers.IntegerField(help_text="Transmission ID")
    filename = serializers.CharField(help_text="Stored filename")
    s3_url = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="S3 URL if uploaded"
    )
    transcription_queued = serializers.BooleanField(
        default=False,
        help_text="Whether transcription was queued"
    )
    message = serializers.CharField(help_text="Status message")


class AudioStatsSerializer(serializers.Serializer):
    """Audio transmission statistics."""

    total_transmissions = serializers.IntegerField(
        help_text="Total transmission records"
    )
    total_transcribed = serializers.IntegerField(
        help_text="Successfully transcribed"
    )
    pending_transcription = serializers.IntegerField(
        help_text="Awaiting transcription"
    )
    failed_transcription = serializers.IntegerField(
        help_text="Failed transcriptions"
    )
    total_duration_hours = serializers.FloatField(
        help_text="Total audio hours"
    )
    total_size_mb = serializers.FloatField(
        help_text="Total storage size in MB"
    )
    by_channel = serializers.DictField(help_text="Count by channel")
    by_status = serializers.DictField(help_text="Count by status")
