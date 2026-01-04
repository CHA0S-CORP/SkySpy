"""
Audio transmission service for rtl-airband radio.

Handles:
- Receiving audio uploads from rtl-airband
- Uploading to S3
- Queueing transcription jobs
"""
import asyncio
import io
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AudioTransmission

logger = logging.getLogger(__name__)
settings = get_settings()

# S3 client (lazy initialized)
_s3_client = None

# Transcription queue
_transcription_queue: asyncio.Queue = None

# Statistics
_stats = {
    "uploads": 0,
    "upload_errors": 0,
    "transcriptions_queued": 0,
    "transcriptions_completed": 0,
    "transcriptions_failed": 0,
}


def _get_s3_client():
    """Get or create S3 client (lazy initialization)."""
    global _s3_client

    if _s3_client is not None:
        return _s3_client

    if not settings.s3_enabled:
        return None

    try:
        import boto3
        from botocore.config import Config

        config = Config(
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'standard'}
        )

        client_kwargs = {
            'service_name': 's3',
            'region_name': settings.s3_region,
            'config': config,
        }

        if settings.s3_access_key and settings.s3_secret_key:
            client_kwargs['aws_access_key_id'] = settings.s3_access_key
            client_kwargs['aws_secret_access_key'] = settings.s3_secret_key

        if settings.s3_endpoint_url:
            client_kwargs['endpoint_url'] = settings.s3_endpoint_url

        _s3_client = boto3.client(**client_kwargs)
        logger.info(f"S3 client initialized for audio: bucket={settings.s3_bucket}")
        return _s3_client

    except ImportError:
        logger.error("boto3 not installed - S3 storage unavailable")
        return None
    except Exception as e:
        logger.error(f"Failed to initialize S3 client: {e}")
        return None


def get_audio_duration(audio_data: bytes) -> Optional[float]:
    """
    Calculate audio duration from raw audio bytes.
    
    Supports MP3, WAV, OGG, and FLAC formats.
    Uses byte-level parsing for fast duration calculation without full decode.
    
    Args:
        audio_data: Raw audio file bytes
        
    Returns:
        Duration in seconds, or None if unable to calculate
    """
    try:
        # Try using mutagen if available (fast, works with all formats)
        try:
            import mutagen
            audio_file = io.BytesIO(audio_data)
            audio = mutagen.File(audio_file)
            if audio and audio.info:
                return float(audio.info.length)
        except ImportError:
            pass
        
        # Fallback: Try MP3 parsing
        duration = _parse_mp3_duration(audio_data)
        if duration:
            return duration
        
        # Fallback: Try WAV parsing
        duration = _parse_wav_duration(audio_data)
        if duration:
            return duration
        
        logger.warning("Could not calculate audio duration from bytes")
        return None
        
    except Exception as e:
        logger.warning(f"Error calculating audio duration: {e}")
        return None


def _parse_mp3_duration(audio_data: bytes) -> Optional[float]:
    """Parse MP3 duration from frame headers (simplified)."""
    try:
        # MP3 frame header: FFFB (sync) + bitrate/samplerate info
        # This is a simplified parser - mutagen is preferred
        bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        samplerates = [44100, 48000, 32100]
        
        # Find first valid frame
        for i in range(len(audio_data) - 4):
            if audio_data[i] == 0xFF and (audio_data[i+1] & 0xE0) == 0xE0:
                # Found sync word
                # This is complex - better to use mutagen
                return None
        return None
    except:
        return None


def _parse_wav_duration(audio_data: bytes) -> Optional[float]:
    """Parse WAV duration from header."""
    try:
        if len(audio_data) < 40:
            return None
            
        # WAV format: check RIFF header
        if audio_data[0:4] != b'RIFF' or audio_data[8:12] != b'WAVE':
            return None
        
        # Find fmt chunk
        pos = 12
        while pos < len(audio_data) - 8:
            chunk_id = audio_data[pos:pos+4]
            chunk_size = int.from_bytes(audio_data[pos+4:pos+8], 'little')
            
            if chunk_id == b'fmt ':
                # Parse format
                num_channels = int.from_bytes(audio_data[pos+8:pos+10], 'little')
                sample_rate = int.from_bytes(audio_data[pos+10:pos+14], 'little')
                bytes_per_sample = int.from_bytes(audio_data[pos+22:pos+24], 'little') // 8 if pos+24 <= len(audio_data) else 2
                
                # Find data chunk
                pos2 = pos + 8 + chunk_size
                while pos2 < len(audio_data) - 8:
                    if audio_data[pos2:pos2+4] == b'data':
                        data_size = int.from_bytes(audio_data[pos2+4:pos2+8], 'little')
                        total_samples = data_size // (num_channels * bytes_per_sample)
                        duration = total_samples / sample_rate
                        return duration
                    pos2 += 8 + int.from_bytes(audio_data[pos2+4:pos2+8], 'little')
                return None
            
            pos += 8 + chunk_size
        return None
    except:
        return None


def _get_s3_key(filename: str) -> str:
    """Get S3 key for audio file."""
    prefix = settings.radio_s3_prefix.strip("/")
    return f"{prefix}/{filename}"


def _get_s3_url(filename: str) -> str:
    """Get public URL for S3 audio file (non-signed, for public buckets)."""
    key = _get_s3_key(filename)

    if settings.s3_public_url:
        base = settings.s3_public_url.rstrip("/")
        # Remove prefix from key if public URL already includes it
        prefix_with_slash = settings.radio_s3_prefix.strip("/") + "/"
        if settings.radio_s3_prefix and key.startswith(prefix_with_slash):
            key = key[len(prefix_with_slash):]
        return f"{base}/{key}"

    if settings.s3_endpoint_url:
        endpoint = settings.s3_endpoint_url.rstrip("/")
        return f"{endpoint}/{settings.s3_bucket}/{key}"

    return f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com/{key}"


def get_signed_s3_url(filename: str, expires_in: int = 3600) -> Optional[str]:
    """
    Generate a signed URL for S3 audio file access.

    Args:
        filename: The filename in S3
        expires_in: URL expiration time in seconds (default 1 hour)

    Returns:
        Signed URL or None if S3 is not available
    """
    client = _get_s3_client()
    if not client:
        return None

    key = _get_s3_key(filename)

    try:
        url = client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': settings.s3_bucket,
                'Key': key,
            },
            ExpiresIn=expires_in,
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate signed URL for {filename}: {e}")
        return None


def get_local_audio_url(filename: str) -> str:
    """
    Get URL for locally stored audio file (served via API).

    Args:
        filename: The filename

    Returns:
        URL path to access the file via API
    """
    return f"/api/v1/audio/file/{filename}"


def get_audio_url(filename: str, s3_key: Optional[str] = None, signed: bool = True) -> Optional[str]:
    """
    Get accessible URL for an audio file (S3 signed URL or local API URL).

    Args:
        filename: The audio filename
        s3_key: S3 key if stored in S3
        signed: Whether to generate a signed URL for S3 (default True)

    Returns:
        Accessible URL for the audio file
    """
    if s3_key and settings.s3_enabled:
        # S3 storage - generate signed URL for private access
        if signed:
            return get_signed_s3_url(filename)
        else:
            return _get_s3_url(filename)
    else:
        # Local storage - return API endpoint URL
        return get_local_audio_url(filename)


async def upload_to_s3(
    data: bytes,
    filename: str,
    content_type: str = "audio/mpeg"
) -> Optional[str]:
    """
    Upload audio file to S3.

    Args:
        data: Audio file bytes
        filename: Filename to use in S3
        content_type: MIME type of the audio

    Returns:
        S3 URL or None on failure
    """
    client = _get_s3_client()
    if not client:
        logger.warning("S3 client not available, skipping upload")
        return None

    key = _get_s3_key(filename)

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: client.put_object(
                Bucket=settings.s3_bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl='max-age=86400',  # 1 day cache
            )
        )

        url = _get_s3_url(filename)
        _stats["uploads"] += 1
        logger.info(f"Uploaded audio to S3: {key}")
        return url

    except Exception as e:
        _stats["upload_errors"] += 1
        logger.error(f"S3 upload failed for {filename}: {e}")
        return None


async def save_audio_locally(
    audio_data: bytes,
    filename: str
) -> Optional[Path]:
    """
    Save audio file to local storage.

    Args:
        audio_data: Raw audio bytes
        filename: Filename to save as

    Returns:
        Path to saved file or None on failure
    """
    try:
        audio_dir = Path(settings.radio_audio_dir)
        audio_dir.mkdir(parents=True, exist_ok=True)

        file_path = audio_dir / filename
        file_path.write_bytes(audio_data)

        logger.info(f"Saved audio locally: {file_path}")
        return file_path

    except Exception as e:
        logger.error(f"Failed to save audio locally: {e}")
        return None


async def create_transmission(
    db: AsyncSession,
    audio_data: bytes,
    filename: str,
    frequency_mhz: Optional[float] = None,
    channel_name: Optional[str] = None,
    duration_seconds: Optional[float] = None,
    metadata: Optional[dict] = None,
    queue_transcription: bool = True,
) -> AudioTransmission:
    """
    Create an audio transmission record, upload to S3, and optionally queue transcription.

    Args:
        db: Database session
        audio_data: Raw audio bytes
        filename: Filename for the audio
        frequency_mhz: Radio frequency
        channel_name: Channel name
        duration_seconds: Audio duration
        metadata: Additional metadata
        queue_transcription: Whether to queue for transcription

    Returns:
        Created AudioTransmission record
    """
    # Determine format from filename
    file_ext = Path(filename).suffix.lower().lstrip(".")
    audio_format = file_ext if file_ext in ("mp3", "wav", "ogg", "flac") else "mp3"

    # Calculate duration if not provided
    if duration_seconds is None or duration_seconds == 0:
        calculated_duration = get_audio_duration(audio_data)
        if calculated_duration:
            duration_seconds = calculated_duration
            logger.info(f"Calculated audio duration: {duration_seconds:.2f}s for {filename}")
        else:
            duration_seconds = None

    # Upload to S3 or save locally
    s3_url = None
    s3_key = None
    if settings.s3_enabled:
        content_type = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "ogg": "audio/ogg",
            "flac": "audio/flac",
        }.get(audio_format, "audio/mpeg")

        s3_url = await upload_to_s3(audio_data, filename, content_type)
        if s3_url:
            s3_key = _get_s3_key(filename)
    else:
        # Save locally when S3 is disabled
        await save_audio_locally(audio_data, filename)

    # Create database record
    transmission = AudioTransmission(
        filename=filename,
        s3_key=s3_key,
        s3_url=s3_url,
        file_size_bytes=len(audio_data),
        duration_seconds=duration_seconds,
        format=audio_format,
        frequency_mhz=frequency_mhz,
        channel_name=channel_name,
        transcription_status="pending",
        metadata=metadata,
    )

    db.add(transmission)
    await db.commit()
    await db.refresh(transmission)

    logger.info(f"Created audio transmission {transmission.id}: {filename}")

    # Queue for transcription if enabled (whisper or external service)
    if queue_transcription and (settings.transcription_enabled or settings.whisper_enabled):
        await queue_transcription_job(db, transmission.id)

    return transmission


async def queue_transcription_job(db: AsyncSession, transmission_id: int) -> bool:
    """
    Queue a transcription job for an audio transmission.

    Args:
        db: Database session
        transmission_id: ID of the transmission to transcribe

    Returns:
        True if queued successfully
    """
    if not settings.transcription_enabled and not settings.whisper_enabled:
        logger.debug("Transcription is not enabled (neither whisper nor external)")
        return False

    if _transcription_queue is None:
        logger.error("Transcription queue not initialized")
        return False

    try:
        # Add to queue first to ensure it succeeds before updating DB
        await _transcription_queue.put(transmission_id)

        # Update status to queued
        await db.execute(
            update(AudioTransmission)
            .where(AudioTransmission.id == transmission_id)
            .values(
                transcription_status="queued",
                transcription_queued_at=datetime.utcnow()
            )
        )
        await db.commit()

        _stats["transcriptions_queued"] += 1
        logger.info(f"Queued transcription for transmission {transmission_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to queue transcription for {transmission_id}: {e}")
        return False


async def _transcribe_with_whisper(
    client: httpx.AsyncClient,
    audio_data: bytes,
    filename: str,
) -> dict:
    """
    Transcribe audio using local Whisper service.

    The onerahmet/openai-whisper-asr-webservice API requires file upload via multipart form.
    """
    whisper_url = f"{settings.whisper_url}/asr"

    # Determine content type from filename
    ext = Path(filename).suffix.lower().lstrip(".")
    content_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "m4a": "audio/mp4",
        "webm": "audio/webm",
    }.get(ext, "audio/mpeg")

    # Whisper ASR webservice requires multipart file upload
    files = {
        "audio_file": (filename, audio_data, content_type),
    }
    params = {
        "task": "transcribe",
        "language": "en",
        "output": "json",
    }

    response = await client.post(whisper_url, params=params, files=files)
    response.raise_for_status()
    return response.json()


async def _transcribe_with_external_service(
    client: httpx.AsyncClient,
    audio_data: bytes,
    filename: str,
) -> dict:
    """
    Transcribe audio using external transcription service (Speaches.ai compatible).

    Uses OpenAI-compatible /v1/audio/transcriptions endpoint with multipart form data.
    """
    # Determine content type from filename
    ext = Path(filename).suffix.lower().lstrip(".")
    content_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "m4a": "audio/mp4",
        "webm": "audio/webm",
    }.get(ext, "audio/mpeg")

    # Build endpoint URL (ensure it ends with /v1/audio/transcriptions)
    base_url = settings.transcription_service_url.rstrip("/")
    if not base_url.endswith("/v1/audio/transcriptions"):
        if base_url.endswith("/v1"):
            endpoint = f"{base_url}/audio/transcriptions"
        else:
            endpoint = f"{base_url}/v1/audio/transcriptions"
    else:
        endpoint = base_url

    # Prepare multipart form data
    files = {
        "file": (filename, audio_data, content_type),
    }
    data = {
        "model": settings.transcription_model or "Systran/faster-whisper-small.en",
        "language": "en",
    }

    # Add API key header if configured
    headers = {}
    if settings.transcription_api_key:
        headers["Authorization"] = f"Bearer {settings.transcription_api_key}"

    response = await client.post(endpoint, files=files, data=data, headers=headers)
    response.raise_for_status()
    return response.json()


async def _fetch_audio_data(
    client: httpx.AsyncClient,
    filename: str,
    s3_key: Optional[str],
) -> Optional[bytes]:
    """
    Fetch audio data from S3 or local storage.

    Args:
        client: HTTP client for fetching from URLs
        filename: The audio filename
        s3_key: S3 key if stored in S3

    Returns:
        Audio bytes or None if fetch failed
    """
    try:
        if s3_key and settings.s3_enabled:
            # Fetch from S3 using signed URL
            audio_url = get_signed_s3_url(filename)
            if not audio_url:
                logger.error(f"Failed to generate signed URL for {filename}")
                return None
            response = await client.get(audio_url)
            response.raise_for_status()
            return response.content
        else:
            # Read from local storage
            audio_path = Path(settings.radio_audio_dir) / filename
            if not audio_path.exists():
                logger.error(f"Local audio file not found: {audio_path}")
                return None
            return audio_path.read_bytes()
    except Exception as e:
        logger.error(f"Failed to fetch audio data for {filename}: {e}")
        return None


async def process_transcription(
    db_session_factory,
    transmission_id: int
) -> bool:
    """
    Process a transcription job.

    Args:
        db_session_factory: Async session factory
        transmission_id: ID of the transmission to transcribe

    Returns:
        True if transcription succeeded
    """
    # Check if we have a transcription service configured
    if not settings.whisper_enabled and not settings.transcription_service_url:
        logger.error("No transcription service configured (whisper or external)")
        return False

    async with db_session_factory() as db:
        # Get transmission
        result = await db.execute(
            select(AudioTransmission).where(AudioTransmission.id == transmission_id)
        )
        transmission = result.scalar_one_or_none()

        if not transmission:
            logger.error(f"Transmission {transmission_id} not found")
            return False

        # Update status to processing
        transmission.transcription_status = "processing"
        transmission.transcription_started_at = datetime.utcnow()
        await db.commit()

        try:
            # Call transcription service
            async with httpx.AsyncClient(timeout=120.0) as client:
                # Both whisper and external service need audio file data
                audio_data = await _fetch_audio_data(
                    client, transmission.filename, transmission.s3_key
                )
                if not audio_data:
                    raise ValueError("Failed to fetch audio data")

                if settings.whisper_enabled:
                    # Whisper service uses multipart file upload
                    result_data = await _transcribe_with_whisper(
                        client, audio_data, transmission.filename
                    )
                else:
                    # External service (Speaches.ai compatible)
                    result_data = await _transcribe_with_external_service(
                        client, audio_data, transmission.filename
                    )

                # Update with transcription result
                transmission.transcription_status = "completed"
                transmission.transcription_completed_at = datetime.utcnow()
                transmission.transcript = result_data.get("text", "")
                transmission.transcript_confidence = result_data.get("confidence")
                transmission.transcript_language = result_data.get("language", "en")
                transmission.transcript_segments = result_data.get("segments")

                await db.commit()
                _stats["transcriptions_completed"] += 1
                logger.info(f"Transcription completed for {transmission_id}")
                return True

        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP {e.response.status_code}"
            transmission.transcription_status = "failed"
            transmission.transcription_error = error_msg
            await db.commit()
            _stats["transcriptions_failed"] += 1
            logger.error(f"Transcription failed for {transmission_id}: {error_msg}")
            return False

        except Exception as e:
            transmission.transcription_status = "failed"
            transmission.transcription_error = str(e)
            await db.commit()
            _stats["transcriptions_failed"] += 1
            logger.error(f"Transcription failed for {transmission_id}: {e}")
            return False


async def init_transcription_queue():
    """Initialize the transcription queue."""
    global _transcription_queue
    _transcription_queue = asyncio.Queue()
    logger.info("Transcription queue initialized")


async def process_transcription_queue(db_session_factory):
    """
    Background task to process transcription queue.

    Args:
        db_session_factory: Async session factory
    """
    global _transcription_queue

    if _transcription_queue is None:
        await init_transcription_queue()

    logger.info("Transcription queue processor started")

    while True:
        try:
            # Wait for next job
            try:
                transmission_id = await asyncio.wait_for(
                    _transcription_queue.get(),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                continue

            # Process transcription
            await process_transcription(db_session_factory, transmission_id)
            _transcription_queue.task_done()

            # Small delay between jobs
            await asyncio.sleep(0.5)

        except asyncio.CancelledError:
            logger.info("Transcription queue processor stopping")
            break
        except Exception as e:
            logger.error(f"Error in transcription queue processor: {e}")
            await asyncio.sleep(1)


async def get_transmission(
    db: AsyncSession,
    transmission_id: int
) -> Optional[AudioTransmission]:
    """Get a single transmission by ID."""
    result = await db.execute(
        select(AudioTransmission).where(AudioTransmission.id == transmission_id)
    )
    return result.scalar_one_or_none()


async def get_transmissions(
    db: AsyncSession,
    status: Optional[str] = None,
    channel: Optional[str] = None,
    hours: int = 24,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[AudioTransmission], int]:
    """
    Get audio transmissions with optional filters.

    Returns:
        Tuple of (transmissions, total_count)
    """
    from datetime import timedelta

    query = select(AudioTransmission)
    count_query = select(func.count(AudioTransmission.id))

    # Time filter
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    query = query.where(AudioTransmission.created_at >= cutoff)
    count_query = count_query.where(AudioTransmission.created_at >= cutoff)

    # Status filter
    if status:
        query = query.where(AudioTransmission.transcription_status == status)
        count_query = count_query.where(AudioTransmission.transcription_status == status)

    # Channel filter
    if channel:
        query = query.where(AudioTransmission.channel_name == channel)
        count_query = count_query.where(AudioTransmission.channel_name == channel)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated results
    query = query.order_by(AudioTransmission.created_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    transmissions = list(result.scalars().all())

    return transmissions, total


async def get_audio_stats(db: AsyncSession) -> dict:
    """Get audio transmission statistics."""
    from datetime import timedelta

    # Total counts by status
    status_query = select(
        AudioTransmission.transcription_status,
        func.count(AudioTransmission.id)
    ).group_by(AudioTransmission.transcription_status)

    status_result = await db.execute(status_query)
    by_status = {row[0]: row[1] for row in status_result}

    # Channel counts
    channel_query = select(
        AudioTransmission.channel_name,
        func.count(AudioTransmission.id)
    ).where(
        AudioTransmission.channel_name.isnot(None)
    ).group_by(AudioTransmission.channel_name)

    channel_result = await db.execute(channel_query)
    by_channel = {row[0]: row[1] for row in channel_result}

    # Totals
    total_query = select(
        func.count(AudioTransmission.id),
        func.sum(AudioTransmission.duration_seconds),
        func.sum(AudioTransmission.file_size_bytes)
    )
    total_result = await db.execute(total_query)
    totals = total_result.one()

    total_count = totals[0] or 0
    total_duration = totals[1] or 0
    total_size = totals[2] or 0

    return {
        "total_transmissions": total_count,
        "total_transcribed": by_status.get("completed", 0),
        "pending_transcription": by_status.get("pending", 0) + by_status.get("queued", 0),
        "failed_transcription": by_status.get("failed", 0),
        "total_duration_hours": round(total_duration / 3600, 2) if total_duration else 0,
        "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size else 0,
        "by_channel": by_channel,
        "by_status": by_status,
        "service_stats": _stats.copy(),
    }


def get_service_stats() -> dict:
    """Get service-level statistics."""
    return {
        "radio_enabled": settings.radio_enabled,
        "radio_audio_dir": settings.radio_audio_dir,
        "transcription_enabled": settings.transcription_enabled or settings.whisper_enabled,
        "whisper_enabled": settings.whisper_enabled,
        "whisper_url": settings.whisper_url if settings.whisper_enabled else None,
        "s3_enabled": settings.s3_enabled,
        "s3_prefix": settings.radio_s3_prefix,
        "queue_size": _transcription_queue.qsize() if _transcription_queue else 0,
        **_stats,
    }
