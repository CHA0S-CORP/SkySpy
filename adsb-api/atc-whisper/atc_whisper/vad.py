"""Voice Activity Detection for segmenting ATC transmissions.

Uses WebRTC VAD which is lightweight and works well on RPi.
Segments audio by squelch breaks / transmission boundaries.
"""

import numpy as np
import webrtcvad

from .models import Segment, VADConfig
from .preprocessing import resample_audio


def _audio_to_pcm16(audio: np.ndarray) -> bytes:
    """Convert float32 audio to 16-bit PCM bytes."""
    return (audio * 32767).astype(np.int16).tobytes()


def _frames_generator(audio_bytes: bytes, frame_duration_ms: int, sr: int):
    """Generate audio frames of specified duration."""
    frame_size = int(sr * frame_duration_ms / 1000) * 2  # 2 bytes per sample
    offset = 0
    while offset + frame_size <= len(audio_bytes):
        yield audio_bytes[offset:offset + frame_size]
        offset += frame_size


def detect_speech_segments(
    audio: np.ndarray,
    sr: int,
    config: VADConfig | None = None
) -> list[Segment]:
    """Detect speech segments in audio using WebRTC VAD.
    
    Segments audio by voice activity, useful for splitting ATC recordings
    into individual transmissions.
    
    Args:
        audio: Float32 audio array
        sr: Sample rate
        config: VAD configuration
        
    Returns:
        List of Segment objects with start/end times and audio data
    """
    if config is None:
        config = VADConfig()
    
    # WebRTC VAD requires 8000, 16000, 32000, or 48000 Hz
    target_sr = 16000
    if sr not in (8000, 16000, 32000, 48000):
        audio = resample_audio(audio, sr, target_sr)
        sr = target_sr
    
    vad = webrtcvad.Vad(config.aggressiveness)
    
    # Convert to PCM16
    pcm_audio = _audio_to_pcm16(audio)
    
    # Process frames
    frame_duration_ms = config.frame_duration_ms
    samples_per_frame = int(sr * frame_duration_ms / 1000)
    
    speech_frames = []
    for i, frame in enumerate(_frames_generator(pcm_audio, frame_duration_ms, sr)):
        is_speech = vad.is_speech(frame, sr)
        speech_frames.append((i * frame_duration_ms, is_speech))
    
    # Group consecutive speech frames into segments
    segments = []
    in_speech = False
    segment_start = 0
    silence_duration = 0
    
    for frame_time, is_speech in speech_frames:
        if is_speech:
            if not in_speech:
                # Start of new speech segment
                segment_start = max(0, frame_time - config.padding_ms)
                in_speech = True
            silence_duration = 0
        else:
            if in_speech:
                silence_duration += frame_duration_ms
                if silence_duration >= config.min_silence_ms:
                    # End of speech segment
                    segment_end = frame_time - silence_duration + config.padding_ms
                    duration = segment_end - segment_start
                    
                    if duration >= config.min_speech_ms:
                        segments.append(Segment(
                            start_ms=segment_start,
                            end_ms=segment_end
                        ))
                    
                    in_speech = False
                    silence_duration = 0
    
    # Handle final segment if still in speech
    if in_speech:
        segment_end = len(speech_frames) * frame_duration_ms
        duration = segment_end - segment_start
        if duration >= config.min_speech_ms:
            segments.append(Segment(
                start_ms=segment_start,
                end_ms=segment_end + config.padding_ms
            ))
    
    # Extract audio for each segment
    for segment in segments:
        start_sample = int(segment.start_ms * sr / 1000)
        end_sample = min(int(segment.end_ms * sr / 1000), len(audio))
        segment.audio = audio[start_sample:end_sample].copy()
    
    return segments


def merge_close_segments(
    segments: list[Segment],
    max_gap_ms: int = 500
) -> list[Segment]:
    """Merge segments that are close together.
    
    Useful for combining parts of the same transmission that were
    split due to brief pauses.
    """
    if not segments:
        return []
    
    merged = [segments[0]]
    
    for segment in segments[1:]:
        gap = segment.start_ms - merged[-1].end_ms
        if gap <= max_gap_ms:
            # Merge with previous
            merged[-1].end_ms = segment.end_ms
            if merged[-1].audio is not None and segment.audio is not None:
                merged[-1].audio = np.concatenate([merged[-1].audio, segment.audio])
        else:
            merged.append(segment)
    
    return merged


def split_long_segments(
    segments: list[Segment],
    max_duration_ms: int = 30000,
    sr: int = 16000
) -> list[Segment]:
    """Split segments longer than max_duration.
    
    Whisper works best with <30s audio chunks.
    """
    result = []
    
    for segment in segments:
        duration = segment.duration_ms
        if duration <= max_duration_ms:
            result.append(segment)
        else:
            # Split into chunks
            n_chunks = (duration + max_duration_ms - 1) // max_duration_ms
            chunk_duration = duration // n_chunks
            samples_per_chunk = int(chunk_duration * sr / 1000)
            
            for i in range(n_chunks):
                start_ms = segment.start_ms + i * chunk_duration
                end_ms = min(start_ms + chunk_duration, segment.end_ms)
                
                if segment.audio is not None:
                    start_sample = i * samples_per_chunk
                    end_sample = min((i + 1) * samples_per_chunk, len(segment.audio))
                    chunk_audio = segment.audio[start_sample:end_sample]
                else:
                    chunk_audio = None
                
                result.append(Segment(
                    start_ms=start_ms,
                    end_ms=end_ms,
                    audio=chunk_audio
                ))
    
    return result


def segment_audio(
    audio: np.ndarray,
    sr: int,
    config: VADConfig | None = None,
    merge_gap_ms: int = 500,
    max_segment_ms: int = 30000
) -> list[Segment]:
    """Full segmentation pipeline for ATC audio.
    
    Detects speech, merges close segments, and splits long segments.
    
    Args:
        audio: Float32 audio array
        sr: Sample rate  
        config: VAD configuration
        merge_gap_ms: Max gap to merge segments
        max_segment_ms: Max segment duration (Whisper limit ~30s)
        
    Returns:
        List of Segment objects ready for transcription
    """
    segments = detect_speech_segments(audio, sr, config)
    segments = merge_close_segments(segments, merge_gap_ms)
    segments = split_long_segments(segments, max_segment_ms, sr)
    return segments
