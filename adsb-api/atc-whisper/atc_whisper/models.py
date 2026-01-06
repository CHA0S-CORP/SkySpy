"""Data models for ATC whisper transcription."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TranscriptionModel(str, Enum):
    """Available Whisper models on speaches-ai."""
    TINY = "tiny"
    BASE = "base"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE_V2 = "large-v2"
    LARGE_V3 = "large-v3"
    DISTIL_LARGE_V3 = "distil-large-v3"
    TURBO = "turbo"


@dataclass
class PreprocessConfig:
    """Audio preprocessing configuration optimized for ATC airband."""
    # Bandpass filter for airband voice (AM typically 300-3400Hz)
    lowcut_hz: float = 300.0
    highcut_hz: float = 3400.0
    filter_order: int = 5
    
    # Noise reduction
    noise_reduce: bool = True
    noise_reduce_stationary: bool = True
    noise_prop_decrease: float = 0.75
    
    # Normalization target (linear, not dB)
    normalize_target: float = 0.7
    
    # High-pass to remove DC offset and low rumble
    highpass_hz: float = 80.0
    
    # Compression for quiet audio (simple limiter)
    apply_compression: bool = True
    compression_threshold: float = 0.3
    compression_ratio: float = 4.0


@dataclass
class VADConfig:
    """Voice activity detection configuration."""
    # WebRTC VAD aggressiveness (0-3, higher = more aggressive filtering)
    aggressiveness: int = 2
    
    # Minimum speech segment duration (ms)
    min_speech_ms: int = 200
    
    # Minimum silence duration to split segments (ms)
    min_silence_ms: int = 300
    
    # Padding around speech segments (ms)
    padding_ms: int = 150
    
    # Frame duration for VAD (must be 10, 20, or 30ms)
    frame_duration_ms: int = 30


@dataclass
class TranscriptionConfig:
    """Configuration for speaches-ai transcription."""
    base_url: str = "http://localhost:8080"
    model: TranscriptionModel = TranscriptionModel.LARGE_V3
    language: str = "en"
    
    # Timeout settings (seconds)
    connect_timeout: float = 10.0
    read_timeout: float = 60.0
    
    # Retry settings
    max_retries: int = 3
    retry_delay: float = 1.0
    
    # Request concurrency limit
    max_concurrent: int = 4
    
    # ATC-specific prompt for better transcription
    prompt: str = (
        "Air traffic control communication. "
        "Callsigns, altitudes in feet, headings, frequencies. "
        "Phonetic alphabet: alpha bravo charlie delta echo foxtrot golf hotel "
        "india juliet kilo lima mike november oscar papa quebec romeo sierra "
        "tango uniform victor whiskey xray yankee zulu. "
        "Niner for nine, tree for three, fife for five."
    )


@dataclass
class Segment:
    """A detected speech segment."""
    start_ms: int
    end_ms: int
    audio: Any = None  # numpy array
    
    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass
class TranscriptionResult:
    """Result from transcription."""
    text: str
    segments: list[dict] = field(default_factory=list)
    language: str = "en"
    duration_seconds: float = 0.0
    
    # Timing info
    preprocess_ms: float = 0.0
    transcribe_ms: float = 0.0
    
    # Original segment info if from segmented audio
    source_segment: Segment | None = None


@dataclass
class BatchResult:
    """Result from batch transcription."""
    results: list[TranscriptionResult]
    total_duration_seconds: float = 0.0
    total_preprocess_ms: float = 0.0
    total_transcribe_ms: float = 0.0
    
    @property
    def full_text(self) -> str:
        """Concatenate all transcription texts."""
        return " ".join(r.text.strip() for r in self.results if r.text.strip())
