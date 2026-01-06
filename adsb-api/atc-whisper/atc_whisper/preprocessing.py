"""Audio preprocessing for ATC airband recordings.

Optimized for Raspberry Pi with minimal dependencies.
Uses scipy for filtering and noisereduce for noise removal.
"""

import io
import struct
import wave
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import BinaryIO

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, resample_poly

from .models import PreprocessConfig

# Target sample rate for Whisper
TARGET_SR = 16000

# Thread pool for CPU-bound preprocessing on RPi
_executor: ThreadPoolExecutor | None = None


def get_executor(max_workers: int = 2) -> ThreadPoolExecutor:
    """Get shared thread pool for preprocessing (RPi-friendly worker count)."""
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=max_workers)
    return _executor


@lru_cache(maxsize=8)
def _get_bandpass_sos(lowcut: float, highcut: float, sr: int, order: int) -> np.ndarray:
    """Cache filter coefficients to avoid recomputation."""
    nyq = sr / 2
    low = max(lowcut / nyq, 0.001)
    high = min(highcut / nyq, 0.999)
    return butter(order, [low, high], btype='band', output='sos')


@lru_cache(maxsize=8)
def _get_highpass_sos(cutoff: float, sr: int, order: int = 2) -> np.ndarray:
    """Cache highpass filter coefficients."""
    nyq = sr / 2
    normalized = max(cutoff / nyq, 0.001)
    return butter(order, normalized, btype='high', output='sos')


def load_audio(source: str | bytes | BinaryIO) -> tuple[np.ndarray, int]:
    """Load audio from file path, bytes, or file-like object.
    
    Returns (audio_array, sample_rate) with audio normalized to float32 [-1, 1].
    """
    if isinstance(source, str):
        sr, audio = wavfile.read(source)
    elif isinstance(source, bytes):
        sr, audio = wavfile.read(io.BytesIO(source))
    else:
        sr, audio = wavfile.read(source)
    
    # Convert to float32
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.int32:
        audio = audio.astype(np.float32) / 2147483648.0
    elif audio.dtype == np.uint8:
        audio = (audio.astype(np.float32) - 128) / 128.0
    elif audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    
    # Convert stereo to mono
    if len(audio.shape) > 1:
        audio = np.mean(audio, axis=1)
    
    return audio, sr


def resample_audio(audio: np.ndarray, sr_orig: int, sr_target: int = TARGET_SR) -> np.ndarray:
    """Resample audio to target sample rate using polyphase filtering.
    
    Efficient for RPi as it uses integer ratios when possible.
    """
    if sr_orig == sr_target:
        return audio
    
    # Find GCD for efficient resampling
    from math import gcd
    g = gcd(sr_orig, sr_target)
    up = sr_target // g
    down = sr_orig // g
    
    # Limit ratio to avoid memory issues on RPi
    if up > 100 or down > 100:
        # Fall back to simple resampling for weird sample rates
        num_samples = int(len(audio) * sr_target / sr_orig)
        indices = np.linspace(0, len(audio) - 1, num_samples)
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)
    
    return resample_poly(audio, up, down).astype(np.float32)


def apply_bandpass(
    audio: np.ndarray, 
    sr: int, 
    lowcut: float = 300.0, 
    highcut: float = 3400.0,
    order: int = 5
) -> np.ndarray:
    """Apply bandpass filter for airband voice frequencies."""
    sos = _get_bandpass_sos(lowcut, highcut, sr, order)
    return sosfilt(sos, audio).astype(np.float32)


def apply_highpass(audio: np.ndarray, sr: int, cutoff: float = 80.0) -> np.ndarray:
    """Remove DC offset and low-frequency rumble."""
    sos = _get_highpass_sos(cutoff, sr)
    return sosfilt(sos, audio).astype(np.float32)


def reduce_noise(
    audio: np.ndarray, 
    sr: int, 
    stationary: bool = True,
    prop_decrease: float = 0.75
) -> np.ndarray:
    """Apply noise reduction optimized for AM airband hiss.
    
    Uses noisereduce library with settings tuned for ATC audio.
    """
    import noisereduce as nr
    
    return nr.reduce_noise(
        y=audio,
        sr=sr,
        stationary=stationary,
        prop_decrease=prop_decrease,
        n_fft=512,  # Smaller FFT for faster processing on RPi
        hop_length=128,
    ).astype(np.float32)


def normalize(audio: np.ndarray, target: float = 0.7) -> np.ndarray:
    """Normalize audio to target peak amplitude."""
    peak = np.max(np.abs(audio))
    if peak > 1e-6:
        audio = audio * (target / peak)
    return audio.astype(np.float32)


def compress_dynamic_range(
    audio: np.ndarray,
    threshold: float = 0.3,
    ratio: float = 4.0
) -> np.ndarray:
    """Simple dynamic range compression for quiet audio.
    
    Helps bring up quiet transmissions while limiting peaks.
    """
    # Calculate envelope using simple abs + smoothing
    envelope = np.abs(audio)
    
    # Apply compression above threshold
    mask = envelope > threshold
    if np.any(mask):
        excess = envelope[mask] - threshold
        compressed_excess = excess / ratio
        gain = np.ones_like(audio)
        gain[mask] = (threshold + compressed_excess) / envelope[mask]
        audio = audio * gain
    
    return audio.astype(np.float32)


def preprocess(
    audio: np.ndarray,
    sr: int,
    config: PreprocessConfig | None = None
) -> np.ndarray:
    """Full preprocessing pipeline for ATC audio.
    
    Pipeline:
    1. Highpass to remove DC/rumble
    2. Bandpass for voice frequencies  
    3. Noise reduction
    4. Dynamic compression (optional)
    5. Normalization
    6. Resample to 16kHz
    
    Args:
        audio: Input audio array (float32, mono)
        sr: Sample rate
        config: Preprocessing configuration
        
    Returns:
        Preprocessed audio at 16kHz
    """
    if config is None:
        config = PreprocessConfig()
    
    # 1. Remove DC offset and rumble
    audio = apply_highpass(audio, sr, config.highpass_hz)
    
    # 2. Bandpass for voice
    audio = apply_bandpass(
        audio, sr, 
        config.lowcut_hz, 
        config.highcut_hz,
        config.filter_order
    )
    
    # 3. Noise reduction
    if config.noise_reduce:
        audio = reduce_noise(
            audio, sr,
            config.noise_reduce_stationary,
            config.noise_prop_decrease
        )
    
    # 4. Dynamic compression for quiet audio
    if config.apply_compression:
        audio = compress_dynamic_range(
            audio,
            config.compression_threshold,
            config.compression_ratio
        )
    
    # 5. Normalize
    audio = normalize(audio, config.normalize_target)
    
    # 6. Resample to 16kHz for Whisper
    audio = resample_audio(audio, sr, TARGET_SR)
    
    return audio


def preprocess_file(
    source: str | bytes | BinaryIO,
    config: PreprocessConfig | None = None
) -> np.ndarray:
    """Load and preprocess audio file.
    
    Convenience function that handles loading and preprocessing.
    """
    audio, sr = load_audio(source)
    return preprocess(audio, sr, config)


def audio_to_wav_bytes(audio: np.ndarray, sr: int = TARGET_SR) -> bytes:
    """Convert float32 audio array to WAV bytes for API submission."""
    # Convert to int16
    audio_int16 = (audio * 32767).astype(np.int16)
    
    # Write to bytes buffer
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio_int16.tobytes())
    
    return buffer.getvalue()
