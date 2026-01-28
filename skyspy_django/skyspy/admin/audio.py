"""
Django admin configuration for audio transmission models.
"""
from django.contrib import admin, messages
from django.utils import timezone

from skyspy.models import AudioTransmission
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import DateRangeFilter, TranscriptionStatusFilter


class CreatedAtDateRangeFilter(DateRangeFilter):
    """Date range filter using 'created_at' field."""
    date_field = 'created_at'


@admin.register(AudioTransmission)
class AudioTransmissionAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for audio transmissions and transcriptions."""

    list_display = [
        'created_at', 'filename', 'duration_display', 'frequency_mhz',
        'channel_name', 'transcription_status', 'transcript_preview'
    ]
    list_filter = [TranscriptionStatusFilter, 'format', 'frequency_mhz', CreatedAtDateRangeFilter]
    search_fields = ['filename', 'channel_name', 'transcript']
    date_hierarchy = 'created_at'
    ordering = ['-created_at']

    actions = ['queue_for_transcription', 'export_as_csv']

    fieldsets = (
        ('Audio File', {
            'fields': (
                'created_at', 'filename', 's3_key', 's3_url',
                'file_size_bytes', 'duration_seconds', 'format'
            )
        }),
        ('Source', {
            'fields': ('frequency_mhz', 'channel_name', 'squelch_level')
        }),
        ('Transcription Status', {
            'fields': (
                'transcription_status', 'transcription_queued_at',
                'transcription_started_at', 'transcription_completed_at',
                'transcription_error'
            )
        }),
        ('Transcription Result', {
            'fields': (
                'transcript', 'transcript_confidence',
                'transcript_language', 'transcript_segments'
            ),
            'classes': ('collapse',)
        }),
        ('Analysis', {
            'fields': ('identified_airframes', 'extra_metadata'),
            'classes': ('collapse',)
        }),
    )

    readonly_fields = [
        'created_at', 'transcription_started_at', 'transcription_completed_at'
    ]

    @admin.display(description='Duration')
    def duration_display(self, obj):
        """Display duration in mm:ss format."""
        if obj.duration_seconds is not None:
            total_seconds = int(obj.duration_seconds)
            minutes, seconds = divmod(total_seconds, 60)
            return f"{minutes:02d}:{seconds:02d}"
        return "-"

    @admin.display(description='Transcript')
    def transcript_preview(self, obj):
        """Display first 100 characters of transcript."""
        if obj.transcript:
            preview = obj.transcript[:100]
            if len(obj.transcript) > 100:
                preview += "..."
            return preview
        return "-"

    @admin.action(description="Queue selected for transcription")
    def queue_for_transcription(self, request, queryset):
        """Queue selected audio transmissions for transcription."""
        updated = queryset.filter(
            transcription_status__in=['pending', 'failed']
        ).update(
            transcription_status='queued',
            transcription_queued_at=timezone.now()
        )
        self.message_user(
            request,
            f"{updated} audio transmission(s) queued for transcription.",
            messages.SUCCESS
        )
