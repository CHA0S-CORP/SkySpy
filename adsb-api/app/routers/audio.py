"""
Audio transmission API endpoints for rtl-airband radio.

Provides endpoints for:
- Uploading audio transmissions from rtl-airband
- Retrieving transmission records and transcripts
- Managing transcription queue
- Audio statistics
"""
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Query, Path, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.core.config import get_settings
from app.services import audio as audio_service
from app.services.socketio_manager import get_socketio_manager
from app.schemas import (
    AudioTransmissionResponse,
    AudioTransmissionListResponse,
    AudioUploadResponse,
    AudioStatsResponse,
    SuccessResponse,
    ErrorResponse,
)

router = APIRouter(prefix="/api/v1/audio", tags=["Audio"])
settings = get_settings()


def _transmission_to_response(t) -> dict:
    """Convert AudioTransmission model to response dict."""
    return {
        "id": t.id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "filename": t.filename,
        "s3_key": t.s3_key,
        "s3_url": t.s3_url,
        "file_size_bytes": t.file_size_bytes,
        "duration_seconds": t.duration_seconds,
        "format": t.format,
        "frequency_mhz": t.frequency_mhz,
        "channel_name": t.channel_name,
        "transcription_status": t.transcription_status,
        "transcription_queued_at": (
            t.transcription_queued_at.isoformat() if t.transcription_queued_at else None
        ),
        "transcription_completed_at": (
            t.transcription_completed_at.isoformat() if t.transcription_completed_at else None
        ),
        "transcription_error": t.transcription_error,
        "transcript": t.transcript,
        "transcript_confidence": t.transcript_confidence,
        "transcript_language": t.transcript_language,
        "metadata": t.metadata,
    }


@router.post(
    "/upload",
    response_model=AudioUploadResponse,
    summary="Upload Audio Transmission",
    description="""
Upload an audio transmission from rtl-airband.

The audio file will be:
1. Saved to local storage
2. Uploaded to S3 (if enabled)
3. Queued for transcription (if enabled)

Supported formats: MP3, WAV, OGG, FLAC

**Note**: This endpoint is typically called by rtl-airband or a relay service,
not directly by end users.
    """,
    responses={
        200: {"description": "Audio uploaded successfully"},
        400: {"description": "Invalid request", "model": ErrorResponse},
        413: {"description": "File too large", "model": ErrorResponse},
        503: {"description": "Service disabled", "model": ErrorResponse},
    }
)
async def upload_audio(
    file: UploadFile = File(..., description="Audio file to upload"),
    frequency_mhz: Optional[float] = Form(
        None, description="Radio frequency in MHz", example=121.5
    ),
    channel_name: Optional[str] = Form(
        None, description="Channel name", example="Guard"
    ),
    duration_seconds: Optional[float] = Form(
        None, description="Audio duration in seconds"
    ),
    queue_transcription: bool = Form(
        True, description="Whether to queue for transcription"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Upload an audio transmission from rtl-airband."""
    logger.info(
        "Audio upload request: filename=%s, channel=%s, frequency=%s",
        file.filename, channel_name, frequency_mhz
    )

    if not settings.radio_enabled:
        logger.warning("Audio upload rejected: radio service disabled")
        raise HTTPException(
            status_code=503,
            detail="Radio audio service is disabled"
        )

    # Validate file type
    content_type = file.content_type or ""
    valid_types = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/x-wav"]
    has_valid_extension = file.filename and file.filename.endswith(
        (".mp3", ".wav", ".ogg", ".flac")
    )
    if content_type not in valid_types and not has_valid_extension:
        logger.warning(
            "Audio upload rejected: invalid format %s for file %s",
            content_type, file.filename
        )
        raise HTTPException(
            status_code=400,
            detail=f"Invalid audio format. Supported: MP3, WAV, OGG, FLAC"
        )

    # Read file content
    audio_data = await file.read()

    # Check file size
    max_size = settings.radio_max_file_size_mb * 1024 * 1024
    if len(audio_data) > max_size:
        logger.warning(
            "Audio upload rejected: file too large (%d bytes, max %d)",
            len(audio_data), max_size
        )
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {settings.radio_max_file_size_mb}MB"
        )

    # Generate filename if not provided
    filename = file.filename or f"transmission_{int(time.time())}.mp3"

    # Create transmission record
    transmission = await audio_service.create_transmission(
        db=db,
        audio_data=audio_data,
        filename=filename,
        frequency_mhz=frequency_mhz,
        channel_name=channel_name,
        duration_seconds=duration_seconds,
        metadata={"content_type": content_type},
        queue_transcription=queue_transcription and settings.transcription_enabled,
    )

    logger.info(
        "Audio uploaded successfully: id=%d, filename=%s, size=%d bytes, transcription_queued=%s",
        transmission.id, transmission.filename, len(audio_data),
        transmission.transcription_status == "queued"
    )

    # Broadcast to socket subscribers
    sio_mgr = get_socketio_manager()
    if sio_mgr:
        await sio_mgr.publish_audio_transmission({
            "id": transmission.id,
            "filename": transmission.filename,
            "s3_url": transmission.s3_url,
            "frequency_mhz": transmission.frequency_mhz,
            "channel_name": transmission.channel_name,
            "duration_seconds": transmission.duration_seconds,
            "transcription_status": transmission.transcription_status,
        })

    return {
        "id": transmission.id,
        "filename": transmission.filename,
        "s3_url": transmission.s3_url,
        "transcription_queued": (
            transmission.transcription_status == "queued"
        ),
        "message": "Audio uploaded successfully",
    }


@router.get(
    "/transmissions",
    response_model=AudioTransmissionListResponse,
    summary="List Audio Transmissions",
    description="""
Get a list of audio transmissions with optional filtering.

Filter by:
- **status**: Transcription status (pending, queued, processing, completed, failed)
- **channel**: Channel name
- **hours**: Time range to query (1-168 hours)
    """,
    responses={
        200: {
            "description": "List of audio transmissions",
            "content": {
                "application/json": {
                    "example": {
                        "transmissions": [
                            {
                                "id": 1,
                                "filename": "transmission_123.mp3",
                                "frequency_mhz": 121.5,
                                "transcription_status": "completed",
                                "transcript": "United 123 cleared for takeoff"
                            }
                        ],
                        "count": 1,
                        "total": 50
                    }
                }
            }
        }
    }
)
async def list_transmissions(
    status: Optional[str] = Query(
        None,
        description="Filter by transcription status",
        enum=["pending", "queued", "processing", "completed", "failed"]
    ),
    channel: Optional[str] = Query(
        None, description="Filter by channel name"
    ),
    hours: int = Query(
        24, ge=1, le=168, description="Hours of history to query"
    ),
    limit: int = Query(
        50, ge=1, le=200, description="Maximum transmissions to return"
    ),
    offset: int = Query(
        0, ge=0, description="Offset for pagination"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get audio transmissions with optional filters."""
    logger.debug(
        "Listing transmissions: status=%s, channel=%s, hours=%d, limit=%d, offset=%d",
        status, channel, hours, limit, offset
    )

    transmissions, total = await audio_service.get_transmissions(
        db=db,
        status=status,
        channel=channel,
        hours=hours,
        limit=limit,
        offset=offset,
    )

    logger.debug("Found %d transmissions (total: %d)", len(transmissions), total)

    return {
        "transmissions": [_transmission_to_response(t) for t in transmissions],
        "count": len(transmissions),
        "total": total,
    }


@router.get(
    "/transmissions/{transmission_id}",
    response_model=AudioTransmissionResponse,
    summary="Get Transmission Details",
    description="Get details of a specific audio transmission including transcript.",
    responses={
        200: {"description": "Transmission details"},
        404: {"description": "Transmission not found", "model": ErrorResponse},
    }
)
async def get_transmission(
    transmission_id: int = Path(..., description="Transmission ID", ge=1),
    db: AsyncSession = Depends(get_db)
):
    """Get a single audio transmission by ID."""
    logger.debug("Fetching transmission id=%d", transmission_id)

    transmission = await audio_service.get_transmission(db, transmission_id)

    if not transmission:
        logger.debug("Transmission id=%d not found", transmission_id)
        raise HTTPException(status_code=404, detail="Transmission not found")

    return _transmission_to_response(transmission)


@router.post(
    "/transmissions/{transmission_id}/transcribe",
    response_model=SuccessResponse,
    summary="Queue Transcription",
    description="""
Queue an audio transmission for transcription.

Use this to retry failed transcriptions or to transcribe transmissions
that were uploaded without automatic transcription.
    """,
    responses={
        200: {"description": "Transcription queued"},
        404: {"description": "Transmission not found", "model": ErrorResponse},
        409: {"description": "Already transcribed", "model": ErrorResponse},
        503: {"description": "Transcription disabled", "model": ErrorResponse},
    }
)
async def queue_transcription(
    transmission_id: int = Path(..., description="Transmission ID", ge=1),
    force: bool = Query(
        False, description="Force re-transcription even if already completed"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Queue a transmission for transcription."""
    logger.info(
        "Transcription queue request: transmission_id=%d, force=%s",
        transmission_id, force
    )

    if not settings.transcription_enabled:
        logger.warning("Transcription queue rejected: service disabled")
        raise HTTPException(
            status_code=503,
            detail="Transcription service is disabled"
        )

    transmission = await audio_service.get_transmission(db, transmission_id)
    if not transmission:
        logger.warning(
            "Transcription queue rejected: transmission id=%d not found",
            transmission_id
        )
        raise HTTPException(status_code=404, detail="Transmission not found")

    if transmission.transcription_status in ("queued", "processing") and not force:
        logger.info(
            "Transcription queue rejected: transmission id=%d already in progress (status=%s)",
            transmission_id, transmission.transcription_status
        )
        raise HTTPException(
            status_code=409,
            detail=f"Transmission already {transmission.transcription_status}. Use force=true to re-queue."
        )

    if transmission.transcription_status == "completed" and not force:
        logger.info(
            "Transcription queue rejected: transmission id=%d already transcribed",
            transmission_id
        )
        raise HTTPException(
            status_code=409,
            detail="Transmission already transcribed. Use force=true to re-transcribe."
        )

    success = await audio_service.queue_transcription_job(db, transmission_id)

    if success:
        logger.info("Transcription queued: transmission_id=%d", transmission_id)
    else:
        logger.error(
            "Failed to queue transcription: transmission_id=%d", transmission_id
        )

    return {
        "success": success,
        "message": "Transcription queued" if success else "Failed to queue transcription",
    }


@router.get(
    "/stats",
    response_model=AudioStatsResponse,
    summary="Get Audio Statistics",
    description="""
Get statistics about audio transmissions and transcriptions.

Includes:
- Total transmission counts
- Transcription status breakdown
- Storage usage
- Channel distribution
    """,
    responses={
        200: {
            "description": "Audio statistics",
            "content": {
                "application/json": {
                    "example": {
                        "total_transmissions": 150,
                        "total_transcribed": 120,
                        "pending_transcription": 5,
                        "failed_transcription": 3,
                        "total_duration_hours": 2.5,
                        "total_size_mb": 45.2,
                        "by_channel": {"Guard": 50, "Tower": 100},
                        "by_status": {"completed": 120, "pending": 5}
                    }
                }
            }
        }
    }
)
async def get_audio_stats(db: AsyncSession = Depends(get_db)):
    """Get audio transmission and transcription statistics."""
    logger.debug("Fetching audio stats")
    stats = await audio_service.get_audio_stats(db)
    logger.debug(
        "Audio stats: total=%s, transcribed=%s",
        stats.get("total_transmissions"), stats.get("total_transcribed")
    )
    return stats


@router.get(
    "/status",
    summary="Get Audio Service Status",
    description="""
Get the current status of the audio/radio service.

Shows:
- Whether the service is enabled
- S3 configuration
- Transcription configuration
- Queue status
    """,
    responses={
        200: {
            "description": "Service status",
            "content": {
                "application/json": {
                    "example": {
                        "radio_enabled": True,
                        "radio_audio_dir": "/data/radio",
                        "transcription_enabled": True,
                        "s3_enabled": True,
                        "queue_size": 3,
                        "uploads": 150,
                        "transcriptions_completed": 120
                    }
                }
            }
        }
    }
)
async def get_audio_status():
    """Get audio service status and configuration."""
    logger.debug("Fetching audio service status")
    return audio_service.get_service_stats()
