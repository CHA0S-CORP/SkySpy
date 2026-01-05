#!/usr/bin/env python3
"""
RTL-Airband Recording Uploader with Prometheus Metrics

Watches for new radio recordings and uploads them to SkySpyAPI.
Maps raw frequencies in filenames to human-readable channel labels.
"""

import os
import re
import time
import logging
import threading
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass
from typing import Optional, Dict

import requests
from mutagen.mp3 import MP3
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
MIN_DURATION_SECONDS = float(os.environ.get("MIN_DURATION_SECONDS", "2.0"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
UPLOAD_TIMEOUT = int(os.environ.get("UPLOAD_TIMEOUT", "60"))
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9090"))
FILE_STABILITY_SECONDS = int(os.environ.get("FILE_STABILITY_SECONDS", "2"))

# Frequency Map: Hz -> Label
# Matches the "Best Stuff" Optimized Config
FREQ_MAP: Dict[int, str] = {
    # KSEA Tower
    119900000: "SEA-Twr-16L34R",
    120950000: "SEA-Twr-16R34L",
    
    # KSEA Approach/Departure
    119200000: "SEA-App-Rwy16",
    120100000: "SEA-App-199-300",
    120400000: "SEA-App-Rwy34",
    123900000: "SEA-App-Dep",
    125600000: "SEA-App-Rwy34-2",
    125900000: "SEA-App-Rwy16-2",
    126500000: "SEA-App-161-198",
    127100000: "SEA-App-Dep-2",
    128500000: "SEA-App-Dep-3",
    133650000: "SEA-App-Rwy16-3",
    
    # KBFI (Boeing Field)
    118300000: "BFI-Twr-13L31R",
    120600000: "BFI-Twr-13R31L",
    
    # Regional Highlights
    124700000: "RNT-Tower",
    123550000: "Boeing-Ops",
    122700000: "Kenmore-Seaplane",
    
    # Emergency
    121500000: "Guard"
}

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
    ["channel", "reason"],
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
    Parse recording filename to extract metadata and map frequency to label.
    
    Expected format (scan mode + include_freq): 
    prefix_freqHz_YYYYMMDD_HHMMSS.mp3
    Example: airband_119900000_20260104_123005.mp3
    """
    filename = filepath.name
    file_size = filepath.stat().st_size if filepath.exists() else 0
    
    # Regex for Prefix_Freq_Date_Time.mp3
    # Group 1: Prefix (e.g. "airband")
    # Group 2: Freq Hz (e.g. "119900000")
    # Group 3: Date (YYYYMMDD)
    # Group 4: Time (HHMMSS)
    match = re.match(r"^([^_]+)_(\d+)_(\d{8})_(\d{6})\.mp3$", filename)
    
    # Fallback Regex (incase format is Prefix_Date_Time_Freq)
    match_alt = re.match(r"^(.+?)_(\d{8})_(\d{6})_(\d+)\.mp3$", filename)

    channel_name = "Unknown"
    frequency_mhz = None
    timestamp = None
    freq_hz = 0

    if match:
        # Standard Scan Format: airband_119900000_20260104_120000.mp3
        freq_hz = int(match.group(2))
        date_str = match.group(3)
        time_str = match.group(4)
        
    elif match_alt:
        # Alt Format: prefix_20260104_120000_119900000.mp3
        freq_hz = int(match_alt.group(4))
        date_str = match_alt.group(2)
        time_str = match_alt.group(3)
        
    else:
        # Completely unknown format
        return FileMetadata(
            filepath=filepath,
            filename=filename,
            channel_name=filepath.stem,
            frequency_mhz=None,
            timestamp=None,
            file_size=file_size,
        )

    # Resolve Data
    if freq_hz > 0:
        frequency_mhz = freq_hz / 1_000_000
        # Lookup Label in Map
        channel_name = FREQ_MAP.get(freq_hz, f"Unknown-{frequency_mhz:.3f}")
    
    try:
        timestamp = datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M%S")
    except ValueError:
        timestamp = datetime.now()

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


def get_audio_duration(filepath: Path) -> Optional[float]:
    """Get the duration of an MP3 file in seconds."""
    try:
        audio = MP3(filepath)
        return audio.info.length
    except Exception:
        return None


def is_short_transmission(filepath: Path) -> bool:
    """Check if audio duration is less than minimum threshold."""
    duration = get_audio_duration(filepath)
    if duration is None:
        return False  # Can't determine, allow it through
    return duration < MIN_DURATION_SECONDS


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
        # Only log full details on first attempt
        if attempt == 1:
            logger.info(
                f"Uploading {metadata.filename} -> [{channel}] "
                f"({metadata.frequency_mhz} MHz, {metadata.file_size} bytes)"
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
                    "channel_name": metadata.channel_name, # Critical: Send mapped name
                }
                
                if metadata.frequency_mhz:
                    data["frequency_mhz"] = str(metadata.frequency_mhz)
                
                # Send explicit timestamp if we have it
                if metadata.timestamp:
                    data["timestamp_utc"] = metadata.timestamp.isoformat()

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
                logger.warning(f"Upload failed HTTP {response.status_code}: {response.text[:100]}")

        except requests.exceptions.Timeout:
            duration = time.time() - start_time
            UPLOAD_DURATION.labels(channel=channel).observe(duration)
            logger.warning(f"Upload timeout after {duration:.2f}s")
        except requests.exceptions.ConnectionError as e:
            logger.warning(f"Connection error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")

        if attempt < MAX_RETRIES:
            time.sleep(2**attempt)

    UPLOADS_FAILED.labels(channel=channel, reason="max_retries").inc()
    UPLOADS_TOTAL.labels(status="failed", channel=channel).inc()
    logger.error(f"Failed all retries: {metadata.filename}")
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

    # Check for empty transmissions (file size)
    if is_empty_transmission(filepath):
        UPLOADS_DISCARDED.labels(channel=channel, reason="too_small").inc()
        logger.info(
            f"Discarding empty transmission: {filepath.name} "
            f"({metadata.file_size} bytes < {MIN_FILE_SIZE} min)"
        )
        cleanup_files(filepath)
        return True

    # Check for short transmissions (duration < 2s)
    duration = get_audio_duration(filepath)
    if duration is not None and duration < MIN_DURATION_SECONDS:
        UPLOADS_DISCARDED.labels(channel=channel, reason="too_short").inc()
        logger.info(
            f"Discarding short transmission: {filepath.name} "
            f"({duration:.2f}s < {MIN_DURATION_SECONDS}s min)"
        )
        cleanup_files(filepath)
        return True

    # Save metadata backup
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
    except Exception:
        pass


def retry_failed_uploads() -> None:
    """Retry uploads from the failed directory."""
    if not FAILED_DIR.exists():
        return
    
    files = list(FAILED_DIR.glob("*.mp3"))
    if not files:
        return

    logger.info(f"Retrying {len(files)} failed uploads...")
    for filepath in sorted(files):
        # We re-parse so we can apply the map even to old failed files
        metadata = parse_filename(filepath)
        if upload_file(metadata):
            cleanup_files(filepath)


def main() -> None:
    """Main entry point."""
    UPLOADER_INFO.info({"version": "1.1.0", "map_size": str(len(FREQ_MAP))})
    
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    FAILED_DIR.mkdir(parents=True, exist_ok=True)

    logger.info(f"Starting RTL-Airband Uploader v1.1.0")
    logger.info(f"Loaded {len(FREQ_MAP)} frequency mappings")
    
    start_http_server(METRICS_PORT)
    
    # Process backlog
    existing = len(list(RECORDINGS_DIR.glob("*.mp3")))
    if existing > 0:
        logger.info(f"Processing {existing} backlog files...")

    last_retry = 0
    
    while True:
        try:
            update_queue_metrics()
            
            for filepath in RECORDINGS_DIR.glob("*.mp3"):
                process_file(filepath)

            if (time.time() - last_retry) >= RETRY_INTERVAL:
                last_retry = time.time()
                retry_failed_uploads()

        except Exception as e:
            logger.error(f"Loop error: {e}")

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()