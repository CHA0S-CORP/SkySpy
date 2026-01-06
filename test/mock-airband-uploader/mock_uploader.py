#!/usr/bin/env python3
"""
Mock Airband Transmission Uploader

Generates simulated radio transmission files and uploads them to SkySpyAPI.
Useful for testing the audio pipeline without real RTL-SDR hardware.

Features:
- Generates realistic-looking MP3 files with silence or optional tone
- Simulates various ATC frequencies (Tower, Approach, Ground, etc.)
- Configurable transmission rate and patterns
- Prometheus metrics for monitoring
- Realistic metadata (frequency, channel, timestamps)
"""

import os
import io
import time
import random
import logging
import argparse
import threading
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Optional, Dict, List, Tuple

import requests
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    Info,
    start_http_server,
)

# Optional: pydub for generating actual audio
try:
    from pydub import AudioSegment
    from pydub.generators import Sine, WhiteNoise
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

# Configuration from environment
SKYSPY_API_URL = os.environ.get("SKYSPY_API_URL", "http://localhost:5000")
UPLOAD_ENDPOINT = f"{SKYSPY_API_URL}/api/v1/audio/upload"

METRICS_PORT = int(os.environ.get("METRICS_PORT", "9091"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/tmp/mock-airband"))
UPLOAD_TIMEOUT = int(os.environ.get("UPLOAD_TIMEOUT", "30"))

# Generation settings
MIN_TRANSMISSION_INTERVAL = float(os.environ.get("MIN_TRANSMISSION_INTERVAL", "5"))
MAX_TRANSMISSION_INTERVAL = float(os.environ.get("MAX_TRANSMISSION_INTERVAL", "30"))
MIN_DURATION_SECONDS = float(os.environ.get("MIN_DURATION_SECONDS", "2"))
MAX_DURATION_SECONDS = float(os.environ.get("MAX_DURATION_SECONDS", "15"))

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# =============================================================================
# Frequency Configuration - Seattle Area ATC
# =============================================================================

@dataclass
class FrequencyConfig:
    """Configuration for a simulated radio frequency."""
    freq_hz: int
    channel_name: str
    category: str  # tower, approach, ground, departure, atis, emergency
    weight: float = 1.0  # Relative probability of transmission
    busy_hours: Tuple[int, ...] = (6, 7, 8, 9, 10, 16, 17, 18, 19)  # Peak hours


# Seattle-area frequencies with realistic activity patterns
FREQUENCIES: List[FrequencyConfig] = [
    # KSEA Tower - Very active
    FrequencyConfig(119900000, "SEA-Twr-16L34R", "tower", weight=3.0),
    FrequencyConfig(120950000, "SEA-Twr-16R34L", "tower", weight=2.5),

    # KSEA Ground
    FrequencyConfig(121700000, "SEA-Gnd-East", "ground", weight=2.0),
    FrequencyConfig(121900000, "SEA-Gnd-West", "ground", weight=2.0),

    # KSEA Approach - Very active
    FrequencyConfig(119200000, "SEA-App-Rwy16", "approach", weight=2.5),
    FrequencyConfig(120100000, "SEA-App-199-300", "approach", weight=2.0),
    FrequencyConfig(120400000, "SEA-App-Rwy34", "approach", weight=2.0),
    FrequencyConfig(125600000, "SEA-App-Rwy34-2", "approach", weight=1.5),
    FrequencyConfig(125900000, "SEA-App-Rwy16-2", "approach", weight=1.5),
    FrequencyConfig(126500000, "SEA-App-161-198", "approach", weight=1.5),
    FrequencyConfig(133650000, "SEA-App-Rwy16-3", "approach", weight=1.0),

    # KSEA Departure
    FrequencyConfig(123900000, "SEA-Dep-South", "departure", weight=2.0),
    FrequencyConfig(127100000, "SEA-Dep-North", "departure", weight=2.0),
    FrequencyConfig(128500000, "SEA-Dep-East", "departure", weight=1.5),

    # KSEA ATIS
    FrequencyConfig(118000000, "SEA-ATIS", "atis", weight=0.5),

    # KBFI (Boeing Field)
    FrequencyConfig(118300000, "BFI-Twr-13L31R", "tower", weight=1.5),
    FrequencyConfig(120600000, "BFI-Twr-13R31L", "tower", weight=1.0),
    FrequencyConfig(128000000, "BFI-Gnd", "ground", weight=1.0),

    # Regional
    FrequencyConfig(124700000, "RNT-Tower", "tower", weight=1.0),
    FrequencyConfig(123550000, "Boeing-Ops", "ground", weight=0.5),
    FrequencyConfig(122700000, "Kenmore-Seaplane", "tower", weight=0.3),
    FrequencyConfig(122950000, "Seattle-FSS", "ground", weight=0.3),

    # Emergency - Rare
    FrequencyConfig(121500000, "Guard", "emergency", weight=0.1),
]


# =============================================================================
# Prometheus Metrics
# =============================================================================

TRANSMISSIONS_GENERATED = Counter(
    "mock_airband_transmissions_generated_total",
    "Total mock transmissions generated",
    ["channel", "category"],
)

TRANSMISSIONS_UPLOADED = Counter(
    "mock_airband_transmissions_uploaded_total",
    "Total mock transmissions successfully uploaded",
    ["channel"],
)

TRANSMISSIONS_FAILED = Counter(
    "mock_airband_transmissions_failed_total",
    "Total failed upload attempts",
    ["channel", "reason"],
)

UPLOAD_DURATION = Histogram(
    "mock_airband_upload_duration_seconds",
    "Time to upload mock transmissions",
    ["channel"],
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 30),
)

TRANSMISSION_DURATION = Histogram(
    "mock_airband_transmission_duration_seconds",
    "Duration of generated mock transmissions",
    ["category"],
    buckets=(2, 3, 5, 7, 10, 15, 20, 30),
)

FILE_SIZE_BYTES = Histogram(
    "mock_airband_file_size_bytes",
    "Size of generated mock files",
    ["category"],
    buckets=(5000, 10000, 25000, 50000, 100000, 250000, 500000),
)

GENERATION_RATE = Gauge(
    "mock_airband_generation_rate_per_minute",
    "Current transmission generation rate",
)

UPLOADER_INFO = Info(
    "mock_airband_uploader",
    "Information about the mock uploader service",
)

LAST_GENERATION_TIMESTAMP = Gauge(
    "mock_airband_last_generation_timestamp",
    "Unix timestamp of last generated transmission",
)


# =============================================================================
# Audio Generation
# =============================================================================

def generate_mock_mp3(duration_seconds: float, add_noise: bool = True) -> bytes:
    """
    Generate a mock MP3 file with realistic characteristics.

    If pydub is available, generates actual audio with optional noise/tones.
    Otherwise, generates a minimal valid MP3 file.
    """
    if PYDUB_AVAILABLE:
        return _generate_pydub_audio(duration_seconds, add_noise)
    else:
        return _generate_minimal_mp3(duration_seconds)


def _generate_pydub_audio(duration_seconds: float, add_noise: bool) -> bytes:
    """Generate audio using pydub with optional noise/tones."""
    duration_ms = int(duration_seconds * 1000)

    # Start with silence
    audio = AudioSegment.silent(duration=duration_ms)

    if add_noise:
        # Add low-level white noise to simulate radio static
        noise = WhiteNoise().to_audio_segment(duration=duration_ms)
        noise = noise - 35  # Reduce volume significantly
        audio = audio.overlay(noise)

        # Optionally add a brief tone to simulate voice activity
        if random.random() > 0.3:
            tone_duration = random.randint(500, min(2000, duration_ms - 200))
            tone_start = random.randint(100, max(100, duration_ms - tone_duration - 100))

            # Random frequency in voice range
            tone_freq = random.randint(200, 800)
            tone = Sine(tone_freq).to_audio_segment(duration=tone_duration)
            tone = tone - 20  # Reduce volume
            tone = tone.fade_in(50).fade_out(50)

            audio = audio.overlay(tone, position=tone_start)

    # Export to MP3
    buffer = io.BytesIO()
    audio.export(buffer, format="mp3", bitrate="32k")
    return buffer.getvalue()


def _generate_minimal_mp3(duration_seconds: float) -> bytes:
    """
    Generate a minimal valid MP3 file without pydub.

    Creates a valid but silent MP3 using raw frame construction.
    This is a simplified implementation for environments without ffmpeg.
    """
    # MP3 frame header for 32kbps, 22050Hz, mono
    # This creates valid but minimal/silent MP3 data

    # Frame size calculation: (144 * bitrate / sample_rate) + padding
    # For 32kbps at 22050Hz: (144 * 32000 / 22050) ≈ 209 bytes per frame
    # Each frame represents ~26ms of audio

    frames_needed = int(duration_seconds * 38.28)  # ~38.28 frames per second at 22050Hz

    # Minimal MP3 frame (silent frame)
    # Format: sync word + header + padding + audio data
    frame_header = bytes([
        0xFF, 0xFB,  # Sync word + MPEG1 Layer3
        0x50,        # 32kbps, 22050Hz
        0x00,        # Mono, no padding, no private, no copyright, original
    ])

    # Minimal audio data (mostly zeros = silence)
    frame_data = bytes([0x00] * 205)  # Padding to approximate frame size

    mp3_data = b""
    for _ in range(frames_needed):
        mp3_data += frame_header + frame_data

    return mp3_data


# =============================================================================
# Transmission Generator
# =============================================================================

@dataclass
class MockTransmission:
    """A generated mock transmission."""
    filename: str
    filepath: Path
    frequency_hz: int
    frequency_mhz: float
    channel_name: str
    category: str
    duration_seconds: float
    timestamp: datetime
    file_data: bytes


def select_frequency(current_hour: int) -> FrequencyConfig:
    """
    Select a frequency weighted by activity level and time of day.

    Frequencies are more likely during their busy hours.
    """
    weights = []
    for freq in FREQUENCIES:
        weight = freq.weight
        # Boost weight during busy hours
        if current_hour in freq.busy_hours:
            weight *= 2.0
        # Reduce emergency frequency even more outside testing
        if freq.category == "emergency":
            weight *= 0.1
        weights.append(weight)

    return random.choices(FREQUENCIES, weights=weights, k=1)[0]


def generate_transmission(output_dir: Path) -> MockTransmission:
    """Generate a single mock transmission."""
    current_hour = datetime.now().hour
    freq_config = select_frequency(current_hour)

    # Generate realistic duration
    # Tower/approach transmissions tend to be shorter
    if freq_config.category in ("tower", "approach"):
        duration = random.uniform(MIN_DURATION_SECONDS, min(8, MAX_DURATION_SECONDS))
    elif freq_config.category == "atis":
        # ATIS is longer, continuous
        duration = random.uniform(10, MAX_DURATION_SECONDS)
    else:
        duration = random.uniform(MIN_DURATION_SECONDS, MAX_DURATION_SECONDS)

    # Generate timestamp
    timestamp = datetime.now()

    # Create filename matching rtl-airband scan mode format
    # Format: prefix_freqHz_YYYYMMDD_HHMMSS.mp3
    filename = f"mock_{freq_config.freq_hz}_{timestamp.strftime('%Y%m%d_%H%M%S')}.mp3"
    filepath = output_dir / filename

    # Generate audio data
    add_noise = freq_config.category != "atis"  # ATIS is cleaner
    file_data = generate_mock_mp3(duration, add_noise=add_noise)

    # Record metrics
    TRANSMISSIONS_GENERATED.labels(
        channel=freq_config.channel_name,
        category=freq_config.category
    ).inc()
    TRANSMISSION_DURATION.labels(category=freq_config.category).observe(duration)
    FILE_SIZE_BYTES.labels(category=freq_config.category).observe(len(file_data))
    LAST_GENERATION_TIMESTAMP.set(time.time())

    return MockTransmission(
        filename=filename,
        filepath=filepath,
        frequency_hz=freq_config.freq_hz,
        frequency_mhz=freq_config.freq_hz / 1_000_000,
        channel_name=freq_config.channel_name,
        category=freq_config.category,
        duration_seconds=duration,
        timestamp=timestamp,
        file_data=file_data,
    )


# =============================================================================
# Upload Logic
# =============================================================================

def upload_transmission(transmission: MockTransmission, save_local: bool = False) -> bool:
    """
    Upload a mock transmission to the SkySpyAPI.

    Args:
        transmission: The generated transmission to upload
        save_local: If True, also save the file locally

    Returns:
        True if upload succeeded, False otherwise
    """
    channel = transmission.channel_name

    # Optionally save locally
    if save_local:
        transmission.filepath.parent.mkdir(parents=True, exist_ok=True)
        transmission.filepath.write_bytes(transmission.file_data)
        logger.debug(f"Saved locally: {transmission.filepath}")

    start_time = time.time()

    try:
        files = {
            "file": (transmission.filename, io.BytesIO(transmission.file_data), "audio/mpeg")
        }
        data = {
            "queue_transcription": "false",  # Mock files won't transcribe meaningfully
            "channel_name": transmission.channel_name,
            "frequency_mhz": str(transmission.frequency_mhz),
            "duration_seconds": str(transmission.duration_seconds),
        }

        response = requests.post(
            UPLOAD_ENDPOINT,
            files=files,
            data=data,
            timeout=UPLOAD_TIMEOUT,
        )

        duration = time.time() - start_time
        UPLOAD_DURATION.labels(channel=channel).observe(duration)

        if response.status_code == 200:
            TRANSMISSIONS_UPLOADED.labels(channel=channel).inc()
            logger.info(
                f"Uploaded: {transmission.filename} -> [{channel}] "
                f"({transmission.duration_seconds:.1f}s, {len(transmission.file_data)} bytes)"
            )
            return True
        else:
            reason = f"http_{response.status_code}"
            TRANSMISSIONS_FAILED.labels(channel=channel, reason=reason).inc()
            logger.warning(f"Upload failed HTTP {response.status_code}: {response.text[:100]}")
            return False

    except requests.exceptions.Timeout:
        TRANSMISSIONS_FAILED.labels(channel=channel, reason="timeout").inc()
        logger.warning(f"Upload timeout for {transmission.filename}")
        return False
    except requests.exceptions.ConnectionError as e:
        TRANSMISSIONS_FAILED.labels(channel=channel, reason="connection_error").inc()
        logger.warning(f"Connection error: {e}")
        return False
    except Exception as e:
        TRANSMISSIONS_FAILED.labels(channel=channel, reason="unknown").inc()
        logger.error(f"Upload error: {e}")
        return False


# =============================================================================
# Main Loop
# =============================================================================

def run_generator(
    rate_per_minute: float = 2.0,
    save_local: bool = False,
    dry_run: bool = False,
    burst_mode: bool = False,
    burst_count: int = 10,
) -> None:
    """
    Run the mock transmission generator.

    Args:
        rate_per_minute: Target transmissions per minute
        save_local: Whether to save files locally in addition to uploading
        dry_run: If True, generate files but don't upload
        burst_mode: If True, generate burst_count files quickly then exit
        burst_count: Number of files to generate in burst mode
    """
    output_dir = OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    GENERATION_RATE.set(rate_per_minute)

    if burst_mode:
        logger.info(f"Burst mode: generating {burst_count} transmissions...")
        for i in range(burst_count):
            transmission = generate_transmission(output_dir)
            if dry_run:
                logger.info(f"[DRY RUN] Generated: {transmission.filename}")
                if save_local:
                    transmission.filepath.write_bytes(transmission.file_data)
            else:
                upload_transmission(transmission, save_local=save_local)

            # Small delay between bursts
            if i < burst_count - 1:
                time.sleep(0.5)
        logger.info("Burst complete")
        return

    # Calculate interval from rate
    if rate_per_minute > 0:
        base_interval = 60.0 / rate_per_minute
    else:
        base_interval = 30.0

    logger.info(f"Starting mock generator at ~{rate_per_minute:.1f} transmissions/minute")
    logger.info(f"Base interval: {base_interval:.1f}s (with ±50% jitter)")
    logger.info(f"Loaded {len(FREQUENCIES)} frequency configurations")

    if dry_run:
        logger.info("DRY RUN mode - files will be generated but not uploaded")

    while True:
        try:
            transmission = generate_transmission(output_dir)

            if dry_run:
                logger.info(
                    f"[DRY RUN] {transmission.filename} -> [{transmission.channel_name}] "
                    f"({transmission.duration_seconds:.1f}s)"
                )
                if save_local:
                    transmission.filepath.write_bytes(transmission.file_data)
            else:
                upload_transmission(transmission, save_local=save_local)

            # Add jitter to interval (±50%)
            jitter = random.uniform(0.5, 1.5)
            interval = base_interval * jitter

            # Respect min/max bounds
            interval = max(MIN_TRANSMISSION_INTERVAL, min(MAX_TRANSMISSION_INTERVAL, interval))

            logger.debug(f"Next transmission in {interval:.1f}s")
            time.sleep(interval)

        except KeyboardInterrupt:
            logger.info("Shutting down...")
            break
        except Exception as e:
            logger.error(f"Generator error: {e}")
            time.sleep(5)


def main():
    """Main entry point with CLI argument parsing."""
    parser = argparse.ArgumentParser(
        description="Mock Airband Transmission Uploader - Generate simulated radio transmissions"
    )
    parser.add_argument(
        "--rate", "-r",
        type=float,
        default=2.0,
        help="Transmissions per minute (default: 2.0)"
    )
    parser.add_argument(
        "--api-url",
        type=str,
        default=SKYSPY_API_URL,
        help=f"SkySpyAPI URL (default: {SKYSPY_API_URL})"
    )
    parser.add_argument(
        "--metrics-port", "-p",
        type=int,
        default=METRICS_PORT,
        help=f"Prometheus metrics port (default: {METRICS_PORT})"
    )
    parser.add_argument(
        "--output-dir", "-o",
        type=str,
        default=str(OUTPUT_DIR),
        help=f"Output directory for local files (default: {OUTPUT_DIR})"
    )
    parser.add_argument(
        "--save-local", "-s",
        action="store_true",
        help="Save generated files locally in addition to uploading"
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Generate files without uploading (implies --save-local)"
    )
    parser.add_argument(
        "--burst", "-b",
        type=int,
        default=0,
        metavar="COUNT",
        help="Generate COUNT files quickly then exit (burst mode)"
    )
    parser.add_argument(
        "--no-metrics",
        action="store_true",
        help="Disable Prometheus metrics server"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose/debug logging"
    )

    args = parser.parse_args()

    # Apply settings
    global SKYSPY_API_URL, UPLOAD_ENDPOINT, OUTPUT_DIR
    SKYSPY_API_URL = args.api_url
    UPLOAD_ENDPOINT = f"{SKYSPY_API_URL}/api/v1/audio/upload"
    OUTPUT_DIR = Path(args.output_dir)

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Service info
    UPLOADER_INFO.info({
        "version": "1.0.0",
        "frequencies": str(len(FREQUENCIES)),
        "pydub_available": str(PYDUB_AVAILABLE),
        "api_url": SKYSPY_API_URL,
    })

    logger.info("=" * 60)
    logger.info("Mock Airband Transmission Uploader v1.0.0")
    logger.info("=" * 60)
    logger.info(f"API URL: {SKYSPY_API_URL}")
    logger.info(f"Output directory: {OUTPUT_DIR}")
    logger.info(f"Audio generation: {'pydub (full)' if PYDUB_AVAILABLE else 'minimal (no pydub)'}")

    # Start metrics server
    if not args.no_metrics:
        start_http_server(args.metrics_port)
        logger.info(f"Prometheus metrics: http://localhost:{args.metrics_port}/metrics")

    # Dry run implies save local
    save_local = args.save_local or args.dry_run

    # Run generator
    run_generator(
        rate_per_minute=args.rate,
        save_local=save_local,
        dry_run=args.dry_run,
        burst_mode=args.burst > 0,
        burst_count=args.burst,
    )


if __name__ == "__main__":
    main()
