#!/usr/bin/env python3
"""
RTL-Airband Recording Uploader with Prometheus Metrics

Watches for new radio recordings and uploads them to SkySpyAPI.
Provides Prometheus metrics for monitoring upload success/failure rates,
queue depth, and processing times.
"""

import os
import re
import time
import logging
import hashlib
import threading
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass
from typing import Optional

import requests
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    start_http_server,
    Info,
)

# Configuration
RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR", "/recordings"))
FAILED_DIR = RECORDINGS_DIR / "failed"
SKYSPY_API_URL = os.environ.get("SKYSPY_API_URL", "http://skyspy:5000")
UPLOAD_ENDPOINT = f"{SKYSPY_API_URL}/api/v1/audio/upload"

POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "5"))
RETRY_INTERVAL = int(os.environ.get("RETRY_INTERVAL", "60"))
MIN_FILE_SIZE = int(os.environ.get("MIN_FILE_SIZE", "2048"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
UPLOAD_TIMEOUT = int(os.environ.get("UPLOAD_TIMEOUT", "60"))
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9090"))
FILE_STABILITY_SECONDS = int(os.environ.get("FILE_STABILITY_SECONDS", "2"))

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Prometheus Metrics
UPLOADS_TOTAL = Counter(
    "rtl_airband_uploads_total",
    "Total number of upload attempts",
    ["status", "channel"],
)

UPLOADS_SUCCESS = Counter(
    "rtl_airband_uploads_success_total",
    "Total successful uploads",
    ["channel"],
)

UPLOADS_FAILED = Counter(
    "rtl_airband_uploads_failed_total",
    "Total failed uploads",
    ["channel", "reason"],
)

UPLOADS_DISCARDED = Counter(
    "rtl_airband_uploads_discarded_total",
    "Total discarded uploads (empty/too small)",
    ["channel"],
)

UPLOAD_DURATION = Histogram(
    "rtl_airband_upload_duration_seconds",
    "Time spent uploading files",
    ["channel"],
    buckets=(0.5, 1, 2, 5, 10, 30, 60, 120),
)

FILE_SIZE_BYTES = Histogram(
    "rtl_airband_file_size_bytes",
    "Size of uploaded files in bytes",
    ["channel"],
    buckets=(1024, 5120, 10240, 51200, 102400, 512000, 1048576, 5242880),
)

QUEUE_DEPTH = Gauge(
    "rtl_airband_queue_depth",
    "Number of files waiting to be uploaded",
    ["directory"],
)

FAILED_QUEUE_DEPTH = Gauge(
    "rtl_airband_failed_queue_depth",
    "Number of files in failed queue",
)

LAST_UPLOAD_TIMESTAMP = Gauge(
    "rtl_airband_last_upload_timestamp",
    "Unix timestamp of last successful upload",
    ["channel"],
)

LAST_ACTIVITY_TIMESTAMP = Gauge(
    "rtl_airband_last_activity_timestamp",
    "Unix timestamp of last file activity (new file detected)",
)

RETRY_ATTEMPTS = Counter(
    "rtl_airband_retry_attempts_total",
    "Total retry attempts for failed uploads",
    ["channel"],
)

API_RESPONSE_CODES = Counter(
    "rtl_airband_api_response_codes_total",
    "HTTP response codes from API",
    ["code"],
)

UPLOADER_INFO = Info(
    "rtl_airband_uploader",
    "Information about the uploader service",
)


@dataclass
class FileMetadata:
    """Metadata extracted from recording filename."""

    filepath: Path
    filename: str
    channel_name: str
    frequency_mhz: Optional[float]
    timestamp: Optional[datetime]
    file_size: int


def parse_filename(filepath: Path) -> FileMetadata:
    """
    Parse recording filename to extract metadata.
    Format: <channel>_<YYYYMMDD>_<HHMMSS>_<freq_hz>.mp3
    Example: SEA-Twr-16L34R_20260102_120000_119900000.mp3
    """
    filename = filepath.name
    file_size = filepath.stat().st_size if filepath.exists() else 0

    # Extract channel name (everything before the date pattern)
    channel_match = re.match(r"^(.+?)_(\d{8})_(\d{6})_(\d+)\.mp3$", filename)

    if channel_match:
        channel_name = channel_match.group(1)
        date_str = channel_match.group(2)
        time_str = channel_match.group(3)
        freq_hz = int(channel_match.group(4))

        # Parse timestamp
        try:
            timestamp = datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M%S")
        except ValueError:
            timestamp = None

        # Convert frequency to MHz
        frequency_mhz = freq_hz / 1_000_000 if freq_hz > 0 else None
    else:
        # Fallback for non-standard filenames
        channel_name = filepath.stem
        frequency_mhz = None
        timestamp = None

    return FileMetadata(
        filepath=filepath,
        filename=filename,
        channel_name=channel_name,
        frequency_mhz=frequency_mhz,
        timestamp=timestamp,
        file_size=file_size,
    )


def is_file_stable(filepath: Path) -> bool:
    """Check if file hasn't been modified recently (still being written)."""
    try:
        mtime = filepath.stat().st_mtime
        return (time.time() - mtime) >= FILE_STABILITY_SECONDS
    except OSError:
        return False


def is_empty_transmission(filepath: Path) -> bool:
    """Check if file is too small to be a valid transmission."""
    try:
        return filepath.stat().st_size < MIN_FILE_SIZE
    except OSError:
        return True


def save_metadata(metadata: FileMetadata) -> None:
    """Save metadata to a .meta file for retry scenarios."""
    meta_path = metadata.filepath.with_suffix(".meta")
    content = f"""frequency_mhz={metadata.frequency_mhz or ''}
channel_name={metadata.channel_name}
timestamp={metadata.timestamp.isoformat() if metadata.timestamp else ''}
file_size={metadata.file_size}
created={datetime.now().isoformat()}
"""
    meta_path.write_text(content)
    logger.debug(f"Saved metadata: {meta_path}")


def cleanup_files(filepath: Path) -> None:
    """Remove mp3 and associated metadata file."""
    try:
        filepath.unlink(missing_ok=True)
        filepath.with_suffix(".meta").unlink(missing_ok=True)
    except OSError as e:
        logger.warning(f"Failed to cleanup {filepath}: {e}")


def move_to_failed(filepath: Path) -> None:
    """Move file and metadata to failed directory."""
    FAILED_DIR.mkdir(parents=True, exist_ok=True)
    try:
        dest = FAILED_DIR / filepath.name
        filepath.rename(dest)

        meta_path = filepath.with_suffix(".meta")
        if meta_path.exists():
            meta_path.rename(FAILED_DIR / meta_path.name)

        logger.info(f"Moved to failed: {filepath.name}")
    except OSError as e:
        logger.error(f"Failed to move {filepath} to failed dir: {e}")


def upload_file(metadata: FileMetadata) -> bool:
    """
    Upload a recording to SkySpyAPI.
    Returns True on success, False on failure.
    """
    channel = metadata.channel_name

    # Record file size metric
    FILE_SIZE_BYTES.labels(channel=channel).observe(metadata.file_size)

    for attempt in range(1, MAX_RETRIES + 1):
        logger.info(
            f"Uploading {metadata.filename} (attempt {attempt}/{MAX_RETRIES}) - "
            f"{metadata.file_size} bytes, {metadata.frequency_mhz or 'unknown'} MHz"
        )

        UPLOADS_TOTAL.labels(status="attempt", channel=channel).inc()

        if attempt > 1:
            RETRY_ATTEMPTS.labels(channel=channel).inc()

        start_time = time.time()

        try:
            with open(metadata.filepath, "rb") as f:
                files = {"file": (metadata.filename, f, "audio/mpeg")}
                data = {
                    "queue_transcription": "true",
                }

                if metadata.frequency_mhz:
                    data["frequency_mhz"] = str(metadata.frequency_mhz)
                if metadata.channel_name:
                    data["channel_name"] = metadata.channel_name

                response = requests.post(
                    UPLOAD_ENDPOINT,
                    files=files,
                    data=data,
                    timeout=UPLOAD_TIMEOUT,
                )

            duration = time.time() - start_time
            UPLOAD_DURATION.labels(channel=channel).observe(duration)
            API_RESPONSE_CODES.labels(code=str(response.status_code)).inc()

            if response.status_code == 200:
                UPLOADS_SUCCESS.labels(channel=channel).inc()
                UPLOADS_TOTAL.labels(status="success", channel=channel).inc()
                LAST_UPLOAD_TIMESTAMP.labels(channel=channel).set(time.time())
                logger.info(
                    f"Upload successful: {metadata.filename} ({duration:.2f}s)"
                )
                return True

            elif response.status_code == 413:
                UPLOADS_FAILED.labels(channel=channel, reason="file_too_large").inc()
                logger.error(f"File too large, skipping: {metadata.filename}")
                return False

            elif response.status_code == 503:
                UPLOADS_FAILED.labels(channel=channel, reason="service_disabled").inc()
                logger.error("Radio service disabled on API")
                return False

            else:
                logger.warning(
                    f"Upload failed with HTTP {response.status_code}: "
                    f"{response.text[:200] if response.text else 'no response'}"
                )

        except requests.exceptions.Timeout:
            duration = time.time() - start_time
            UPLOAD_DURATION.labels(channel=channel).observe(duration)
            logger.warning(f"Upload timeout after {duration:.2f}s")

        except requests.exceptions.ConnectionError as e:
            logger.warning(f"Connection error: {e}")

        except Exception as e:
            logger.error(f"Unexpected error during upload: {e}")

        # Exponential backoff before retry
        if attempt < MAX_RETRIES:
            backoff = 2**attempt
            logger.info(f"Retrying in {backoff}s...")
            time.sleep(backoff)

    # All retries exhausted
    UPLOADS_FAILED.labels(channel=channel, reason="max_retries").inc()
    UPLOADS_TOTAL.labels(status="failed", channel=channel).inc()
    logger.error(f"Upload failed after {MAX_RETRIES} attempts: {metadata.filename}")
    return False


def process_file(filepath: Path) -> bool:
    """
    Process a single recording file.
    Returns True if file was handled (success or intentionally discarded).
    """
    if not filepath.exists():
        return True

    if filepath.suffix == ".meta":
        return True

    if filepath.suffix != ".mp3":
        return True

    if not is_file_stable(filepath):
        return False

    metadata = parse_filename(filepath)
    channel = metadata.channel_name

    # Check for empty transmissions
    if is_empty_transmission(filepath):
        UPLOADS_DISCARDED.labels(channel=channel).inc()
        logger.info(
            f"Discarding empty transmission: {filepath.name} "
            f"({metadata.file_size} bytes < {MIN_FILE_SIZE} min)"
        )
        cleanup_files(filepath)
        return True

    # Save metadata for retry scenarios
    meta_path = filepath.with_suffix(".meta")
    if not meta_path.exists():
        save_metadata(metadata)

    LAST_ACTIVITY_TIMESTAMP.set(time.time())

    # Attempt upload
    if upload_file(metadata):
        cleanup_files(filepath)
        return True
    else:
        move_to_failed(filepath)
        return True


def update_queue_metrics() -> None:
    """Update queue depth gauges."""
    try:
        main_count = len(list(RECORDINGS_DIR.glob("*.mp3")))
        QUEUE_DEPTH.labels(directory="main").set(main_count)

        if FAILED_DIR.exists():
            failed_count = len(list(FAILED_DIR.glob("*.mp3")))
            FAILED_QUEUE_DEPTH.set(failed_count)
        else:
            FAILED_QUEUE_DEPTH.set(0)
    except Exception as e:
        logger.warning(f"Failed to update queue metrics: {e}")


def process_directory(directory: Path) -> int:
    """Process all mp3 files in a directory. Returns count processed."""
    count = 0
    for filepath in sorted(directory.glob("*.mp3")):
        if process_file(filepath):
            count += 1
    return count


def retry_failed_uploads() -> None:
    """Retry uploads from the failed directory."""
    if not FAILED_DIR.exists():
        return

    failed_files = list(FAILED_DIR.glob("*.mp3"))
    if not failed_files:
        return

    logger.info(f"Retrying {len(failed_files)} failed uploads...")
    processed = 0

    for filepath in sorted(failed_files):
        metadata = parse_filename(filepath)

        if upload_file(metadata):
            cleanup_files(filepath)
            processed += 1
        # Don't move back to failed - it's already there

    if processed > 0:
        logger.info(f"Successfully retried {processed} uploads")


def main() -> None:
    """Main entry point."""
    # Set uploader info
    UPLOADER_INFO.info({
        "version": "1.0.0",
        "recordings_dir": str(RECORDINGS_DIR),
        "api_url": SKYSPY_API_URL,
        "min_file_size": str(MIN_FILE_SIZE),
        "poll_interval": str(POLL_INTERVAL),
        "retry_interval": str(RETRY_INTERVAL),
    })

    # Ensure directories exist
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    FAILED_DIR.mkdir(parents=True, exist_ok=True)

    # Start Prometheus metrics server
    logger.info(f"Starting metrics server on port {METRICS_PORT}")
    start_http_server(METRICS_PORT)

    logger.info(f"RTL-Airband Uploader started")
    logger.info(f"  Recordings dir: {RECORDINGS_DIR}")
    logger.info(f"  API endpoint: {UPLOAD_ENDPOINT}")
    logger.info(f"  Poll interval: {POLL_INTERVAL}s")
    logger.info(f"  Retry interval: {RETRY_INTERVAL}s")
    logger.info(f"  Min file size: {MIN_FILE_SIZE} bytes")
    logger.info(f"  Metrics port: {METRICS_PORT}")

    # Process existing files on startup
    logger.info("Processing existing recordings...")
    existing = process_directory(RECORDINGS_DIR)
    if existing > 0:
        logger.info(f"Processed {existing} existing recordings")

    logger.info("Watching for new recordings...")

    last_retry_time = 0

    # Main loop
    while True:
        try:
            # Update queue metrics
            update_queue_metrics()

            # Process new files
            for filepath in RECORDINGS_DIR.glob("*.mp3"):
                process_file(filepath)

            # Periodic retry of failed uploads
            now = time.time()
            if (now - last_retry_time) >= RETRY_INTERVAL:
                last_retry_time = now
                retry_failed_uploads()

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
