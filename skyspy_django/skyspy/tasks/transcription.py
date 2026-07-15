"""
Audio transcription tasks.

Uses the comprehensive audio service for:
- Transcription via Whisper/ATC-Whisper/external services
- Callsign extraction from transcripts
- S3 and local storage integration
"""

import logging
from datetime import datetime, timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from skyspy.models import AudioTransmission
from skyspy.services.audio import (
    get_audio_url,
    identify_airframes_from_transcript,
    process_transcription,
)
from skyspy.socketio.utils import sync_emit

logger = logging.getLogger(__name__)


@shared_task
def process_transcription_queue():
    """
    Process queued audio transcriptions.

    Picks up audio files that are queued for transcription
    and sends them to the transcription service.
    """
    if not (settings.TRANSCRIPTION_ENABLED or settings.WHISPER_ENABLED or settings.ATC_WHISPER_ENABLED):
        return

    # Get queued transcriptions (batch of 5)
    queued_ids = list(
        AudioTransmission.objects.filter(transcription_status="queued")
        .order_by("transcription_queued_at")
        .values_list("id", flat=True)[:5]
    )

    for transmission_id in queued_ids:
        # Atomically claim the row before dispatching so the next scan
        # (this task runs every 10s) doesn't dispatch it again while the
        # transcription is still in flight
        claimed = AudioTransmission.objects.filter(
            id=transmission_id,
            transcription_status="queued",
        ).update(transcription_status="processing")

        if claimed:
            transcribe_audio.delay(transmission_id)


@shared_task(bind=True, max_retries=3)
def transcribe_audio(self, transmission_id: int):
    """
    Transcribe a single audio file using the audio service.

    Uses the comprehensive audio service which handles:
    - Fetching audio from S3 or local storage
    - Transcription via configured service
    - Callsign extraction from transcript
    - Broadcasting updates via WebSocket
    """
    try:
        transmission = AudioTransmission.objects.get(id=transmission_id)
    except AudioTransmission.DoesNotExist:
        logger.error(f"Transmission {transmission_id} not found")
        return

    if transmission.transcription_status == "completed":
        return

    # Skip if another worker is already transcribing this transmission
    # (transcription_started_at is set once work actually begins; rows
    # merely claimed by the queue scan have no started_at yet)
    if (
        transmission.transcription_status == "processing"
        and transmission.transcription_started_at
        and timezone.now() - transmission.transcription_started_at < timedelta(minutes=10)
        and self.request.retries == 0
    ):
        logger.debug(f"Transmission {transmission_id} already being transcribed, skipping")
        return

    # Broadcast status update
    _broadcast_transcription_update(transmission, "started")

    try:
        # Use audio service for transcription
        success = process_transcription(transmission)

        if success:
            # Refresh from database
            transmission.refresh_from_db()
            _broadcast_transcription_update(transmission, "completed")
            logger.info(f"Transcribed transmission {transmission_id}")
        else:
            transmission.refresh_from_db()
            _broadcast_transcription_update(transmission, "failed")
            # Retry if appropriate
            if self.request.retries < self.max_retries:
                raise Exception(transmission.transcription_error or "Transcription failed")

    # broad: Celery task boundary — transcription failure modes are unknowable; must retry, not crash the worker
    except Exception as e:
        logger.error(f"Failed to transcribe {transmission_id}: {e}")

        # Update status if not already failed
        if transmission.transcription_status != "failed":
            transmission.transcription_status = "failed"
            transmission.transcription_error = str(e)
            transmission.save()

        _broadcast_transcription_update(transmission, "failed")

        # Retry if appropriate
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60)


def _broadcast_transcription_update(transmission, status: str):
    """
    Broadcast transcription status update to WebSocket clients via Socket.IO.
    """
    try:
        event_type = f"audio:transcription_{status}"

        # Get audio URL for completed transcriptions
        audio_url = None
        if status == "completed":
            audio_url = get_audio_url(transmission, signed=True)

        sync_emit(
            event_type,
            {
                "id": transmission.id,
                "filename": transmission.filename,
                "audio_url": audio_url,
                "status": transmission.transcription_status,
                "transcript": transmission.transcript if status == "completed" else None,
                "identified_airframes": transmission.identified_airframes if status == "completed" else None,
                "error": transmission.transcription_error if status == "failed" else None,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room="audio_transmissions",
            namespace="/audio",
        )
    except Exception as e:  # broad: Socket.IO broadcast must never raise into the caller
        logger.warning(f"Failed to broadcast transcription update: {e}")


@shared_task
def extract_callsigns(transmission_id: int):
    """
    Extract aircraft callsigns from transcript using the comprehensive audio service.

    Uses advanced patterns to extract:
    - Airline callsigns (AAL123, UAL456, etc.)
    - N-numbers (N12345, N123AB, etc.)
    - Military callsigns (REACH, NAVY, etc.)
    - Radio callsigns (SPEEDBIRD, SHAMROCK, etc.)
    """
    try:
        transmission = AudioTransmission.objects.get(id=transmission_id)
    except AudioTransmission.DoesNotExist:
        return

    if not transmission.transcript:
        return

    # Use the comprehensive audio service for callsign extraction
    identified = identify_airframes_from_transcript(
        transmission.transcript,
        segments=transmission.transcript_segments,
        duration_seconds=transmission.duration_seconds,
    )

    if identified:
        transmission.identified_airframes = identified
        transmission.save()

        logger.info(f"Extracted {len(identified)} callsigns from transmission {transmission_id}")

        # Broadcast update with identified airframes
        _broadcast_transcription_update(transmission, "completed")
    else:
        logger.debug(f"No callsigns found in transmission {transmission_id}")


@shared_task
def reprocess_all_transcripts():
    """
    Reprocess all completed transcripts to extract callsigns.

    Useful when the callsign extraction algorithm is updated.
    """
    completed = AudioTransmission.objects.filter(transcription_status="completed", transcript__isnull=False).exclude(
        transcript=""
    )

    count = 0
    for transmission in completed:
        identified = identify_airframes_from_transcript(
            transmission.transcript,
            segments=transmission.transcript_segments,
            duration_seconds=transmission.duration_seconds,
        )

        if identified:
            transmission.identified_airframes = identified
            transmission.save()
            count += 1

    logger.info(f"Reprocessed {count} transcripts for callsign extraction")
