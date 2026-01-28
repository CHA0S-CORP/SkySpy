"""
Audio transmission model for radio recordings and transcription.
"""
from django.db import models


class AudioTransmission(models.Model):
    """Audio transmissions captured from rtl-airband for transcription."""

    FORMAT_CHOICES = [
        ('mp3', 'MP3'),
        ('wav', 'WAV'),
        ('ogg', 'OGG'),
        ('flac', 'FLAC'),
    ]

    TRANSCRIPTION_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('queued', 'Queued'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Audio file info
    filename = models.CharField(max_length=255)
    s3_key = models.CharField(max_length=500, blank=True, null=True)
    s3_url = models.CharField(max_length=500, blank=True, null=True)
    file_size_bytes = models.IntegerField(blank=True, null=True)
    duration_seconds = models.FloatField(blank=True, null=True)
    format = models.CharField(max_length=10, choices=FORMAT_CHOICES, default='mp3')

    # Source info
    frequency_mhz = models.FloatField(blank=True, null=True, db_index=True)
    channel_name = models.CharField(max_length=100, blank=True, null=True)
    squelch_level = models.FloatField(blank=True, null=True)

    # Transcription status
    transcription_status = models.CharField(
        max_length=20,
        choices=TRANSCRIPTION_STATUS_CHOICES,
        default='pending',
        db_index=True
    )
    transcription_queued_at = models.DateTimeField(blank=True, null=True)
    transcription_started_at = models.DateTimeField(blank=True, null=True)
    transcription_completed_at = models.DateTimeField(blank=True, null=True)
    transcription_error = models.TextField(blank=True, null=True)

    # Transcription result
    transcript = models.TextField(blank=True, null=True)
    transcript_confidence = models.FloatField(blank=True, null=True)
    transcript_language = models.CharField(max_length=10, blank=True, null=True)
    transcript_segments = models.JSONField(blank=True, null=True)  # Word-level timestamps

    # Identified airframes from transcript
    identified_airframes = models.JSONField(blank=True, null=True)  # List of callsigns/aircraft

    # Extra metadata
    extra_metadata = models.JSONField(blank=True, null=True)

    class Meta:
        db_table = 'audio_transmissions'
        indexes = [
            models.Index(
                fields=['transcription_status', 'created_at'],
                name='idx_audio_transmission_status'
            ),
            models.Index(fields=['frequency_mhz'], name='idx_audio_transmission_freq'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.filename} ({self.transcription_status})"
