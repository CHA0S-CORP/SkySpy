"""Async client for speaches-ai transcription service.

Optimized for high throughput with connection pooling and concurrency control.
Compatible with OpenAI Whisper API format.
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
import numpy as np

from .models import (
    BatchResult,
    PreprocessConfig,
    Segment,
    TranscriptionConfig,
    TranscriptionResult,
)
from .preprocessing import audio_to_wav_bytes, preprocess, preprocess_file
from .vad import segment_audio, VADConfig

logger = logging.getLogger(__name__)


class ATCTranscriber:
    """Async client for transcribing ATC audio via speaches-ai.
    
    Features:
    - Connection pooling for RPi efficiency
    - Semaphore-based concurrency control
    - Automatic retry with exponential backoff
    - Integrated preprocessing pipeline
    
    Example:
        async with ATCTranscriber() as transcriber:
            result = await transcriber.transcribe_file("recording.wav")
            print(result.text)
    """
    
    def __init__(
        self,
        config: TranscriptionConfig | None = None,
        preprocess_config: PreprocessConfig | None = None,
        vad_config: VADConfig | None = None,
    ):
        self.config = config or TranscriptionConfig()
        self.preprocess_config = preprocess_config or PreprocessConfig()
        self.vad_config = vad_config or VADConfig()
        
        self._client: httpx.AsyncClient | None = None
        self._semaphore: asyncio.Semaphore | None = None
    
    async def __aenter__(self) -> "ATCTranscriber":
        await self.connect()
        return self
    
    async def __aexit__(self, *args):
        await self.close()
    
    async def connect(self):
        """Initialize HTTP client with connection pooling."""
        if self._client is not None:
            return
        
        # Connection pool limits for RPi
        limits = httpx.Limits(
            max_keepalive_connections=self.config.max_concurrent,
            max_connections=self.config.max_concurrent + 2,
            keepalive_expiry=30.0,
        )
        
        timeout = httpx.Timeout(
            connect=self.config.connect_timeout,
            read=self.config.read_timeout,
            write=30.0,
            pool=10.0,
        )
        
        self._client = httpx.AsyncClient(
            base_url=self.config.base_url,
            limits=limits,
            timeout=timeout,
            http2=True,  # Better multiplexing
        )
        
        self._semaphore = asyncio.Semaphore(self.config.max_concurrent)
    
    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
            self._semaphore = None
    
    async def _transcribe_audio_bytes(
        self,
        audio_bytes: bytes,
        filename: str = "audio.wav"
    ) -> dict:
        """Send audio to speaches-ai and get transcription."""
        if self._client is None:
            raise RuntimeError("Client not connected. Use 'async with' or call connect().")
        
        async with self._semaphore:
            for attempt in range(self.config.max_retries):
                try:
                    response = await self._client.post(
                        "/v1/audio/transcriptions",
                        files={"file": (filename, audio_bytes, "audio/wav")},
                        data={
                            "model": self.config.model.value,
                            "language": self.config.language,
                            "prompt": self.config.prompt,
                            "response_format": "verbose_json",
                        },
                    )
                    response.raise_for_status()
                    return response.json()
                    
                except httpx.HTTPStatusError as e:
                    if e.response.status_code >= 500 and attempt < self.config.max_retries - 1:
                        delay = self.config.retry_delay * (2 ** attempt)
                        logger.warning(f"Server error, retrying in {delay}s: {e}")
                        await asyncio.sleep(delay)
                    else:
                        raise
                        
                except (httpx.ConnectError, httpx.ReadTimeout) as e:
                    if attempt < self.config.max_retries - 1:
                        delay = self.config.retry_delay * (2 ** attempt)
                        logger.warning(f"Connection error, retrying in {delay}s: {e}")
                        await asyncio.sleep(delay)
                    else:
                        raise
    
    async def transcribe(
        self,
        audio: np.ndarray,
        sr: int,
        skip_preprocess: bool = False,
    ) -> TranscriptionResult:
        """Transcribe preprocessed or raw audio.
        
        Args:
            audio: Float32 audio array
            sr: Sample rate
            skip_preprocess: If True, skip preprocessing (audio should be 16kHz)
            
        Returns:
            TranscriptionResult with text and timing info
        """
        t_start = time.perf_counter()
        
        # Preprocess if needed
        if not skip_preprocess:
            audio = preprocess(audio, sr, self.preprocess_config)
        
        t_preprocess = time.perf_counter()
        
        # Convert to WAV bytes
        audio_bytes = audio_to_wav_bytes(audio)
        
        # Transcribe
        response = await self._transcribe_audio_bytes(audio_bytes)
        
        t_transcribe = time.perf_counter()
        
        return TranscriptionResult(
            text=response.get("text", ""),
            segments=response.get("segments", []),
            language=response.get("language", self.config.language),
            duration_seconds=response.get("duration", len(audio) / 16000),
            preprocess_ms=(t_preprocess - t_start) * 1000,
            transcribe_ms=(t_transcribe - t_preprocess) * 1000,
        )
    
    async def transcribe_file(
        self,
        path: str,
        segment_by_vad: bool = False,
    ) -> TranscriptionResult | BatchResult:
        """Transcribe an audio file.
        
        Args:
            path: Path to audio file
            segment_by_vad: If True, segment audio by voice activity first
            
        Returns:
            TranscriptionResult or BatchResult if segmented
        """
        from .preprocessing import load_audio
        
        audio, sr = load_audio(path)
        
        if segment_by_vad:
            return await self.transcribe_segmented(audio, sr)
        else:
            return await self.transcribe(audio, sr)
    
    async def transcribe_segmented(
        self,
        audio: np.ndarray,
        sr: int,
    ) -> BatchResult:
        """Segment audio by VAD and transcribe each segment concurrently.
        
        Best for long recordings with multiple transmissions.
        """
        t_start = time.perf_counter()
        
        # Preprocess full audio first
        preprocessed = preprocess(audio, sr, self.preprocess_config)
        
        t_preprocess = time.perf_counter()
        
        # Segment by voice activity
        segments = segment_audio(preprocessed, 16000, self.vad_config)
        
        if not segments:
            return BatchResult(
                results=[],
                total_duration_seconds=len(audio) / sr,
                total_preprocess_ms=(t_preprocess - t_start) * 1000,
            )
        
        # Transcribe segments concurrently
        async def transcribe_segment(seg: Segment) -> TranscriptionResult:
            audio_bytes = audio_to_wav_bytes(seg.audio)
            t0 = time.perf_counter()
            response = await self._transcribe_audio_bytes(audio_bytes)
            t1 = time.perf_counter()
            
            return TranscriptionResult(
                text=response.get("text", ""),
                segments=response.get("segments", []),
                language=response.get("language", self.config.language),
                duration_seconds=response.get("duration", seg.duration_ms / 1000),
                transcribe_ms=(t1 - t0) * 1000,
                source_segment=seg,
            )
        
        results = await asyncio.gather(*[
            transcribe_segment(seg) for seg in segments
        ])
        
        t_end = time.perf_counter()
        
        return BatchResult(
            results=list(results),
            total_duration_seconds=len(audio) / sr,
            total_preprocess_ms=(t_preprocess - t_start) * 1000,
            total_transcribe_ms=(t_end - t_preprocess) * 1000,
        )
    
    async def transcribe_stream(
        self,
        audio_chunks: AsyncIterator[tuple[np.ndarray, int]],
        preprocess_chunks: bool = True,
    ) -> AsyncIterator[TranscriptionResult]:
        """Transcribe a stream of audio chunks.
        
        Useful for real-time or near-real-time transcription.
        
        Args:
            audio_chunks: Async iterator yielding (audio_array, sample_rate) tuples
            preprocess_chunks: Whether to preprocess each chunk
            
        Yields:
            TranscriptionResult for each chunk
        """
        async for audio, sr in audio_chunks:
            yield await self.transcribe(audio, sr, skip_preprocess=not preprocess_chunks)


class ATCPostProcessor:
    """Post-process ATC transcriptions for better accuracy."""
    
    # Common phonetic alphabet misheards
    PHONETIC_CORRECTIONS = {
        r'\b(alfa|alpha)\b': 'Alpha',
        r'\b(bravo)\b': 'Bravo',
        r'\b(charlie)\b': 'Charlie',
        r'\b(delta)\b': 'Delta',
        r'\b(echo)\b': 'Echo',
        r'\b(foxtrot)\b': 'Foxtrot',
        r'\b(golf)\b': 'Golf',
        r'\b(hotel)\b': 'Hotel',
        r'\b(india)\b': 'India',
        r'\b(juliet|juliett)\b': 'Juliet',
        r'\b(kilo)\b': 'Kilo',
        r'\b(lima)\b': 'Lima',
        r'\b(mike)\b': 'Mike',
        r'\b(november)\b': 'November',
        r'\b(oscar)\b': 'Oscar',
        r'\b(papa)\b': 'Papa',
        r'\b(quebec)\b': 'Quebec',
        r'\b(romeo)\b': 'Romeo',
        r'\b(sierra)\b': 'Sierra',
        r'\b(tango)\b': 'Tango',
        r'\b(uniform)\b': 'Uniform',
        r'\b(victor)\b': 'Victor',
        r'\b(whiskey)\b': 'Whiskey',
        r'\b(xray|x-ray)\b': 'X-ray',
        r'\b(yankee)\b': 'Yankee',
        r'\b(zulu)\b': 'Zulu',
    }
    
    # ATC number corrections
    NUMBER_CORRECTIONS = {
        r'\b(niner|liner)\b': 'niner',
        r'\bfife\b': 'five',
        r'\btree\b': 'three',
    }
    
    # Flight level formatting
    FL_PATTERN = r'flight level\s*(\d)\s*(\d)\s*(\d)'
    FL_REPLACEMENT = r'FL\1\2\3'
    
    @classmethod
    def process(cls, text: str) -> str:
        """Apply ATC-specific corrections to transcription."""
        import re
        
        # Apply number corrections
        for pattern, replacement in cls.NUMBER_CORRECTIONS.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        
        # Format flight levels
        text = re.sub(cls.FL_PATTERN, cls.FL_REPLACEMENT, text, flags=re.IGNORECASE)
        
        # Normalize callsigns (N-numbers)
        text = re.sub(
            r'\b[nN]\s*(\d[\d\s]*[a-zA-Z]{1,2})\b',
            lambda m: 'N' + m.group(1).replace(' ', '').upper(),
            text
        )
        
        return text


# Convenience function for simple usage
async def transcribe_atc_audio(
    source: str | bytes | np.ndarray,
    sr: int | None = None,
    base_url: str = "http://localhost:8080",
    model: str = "large-v3",
    segment: bool = True,
    postprocess: bool = True,
) -> str:
    """Simple async function to transcribe ATC audio.
    
    Args:
        source: File path, audio bytes, or numpy array
        sr: Sample rate (required if source is numpy array)
        base_url: speaches-ai server URL
        model: Whisper model to use
        segment: Whether to segment by VAD
        postprocess: Whether to apply ATC corrections
        
    Returns:
        Transcribed text
    """
    from .models import TranscriptionModel
    from .preprocessing import load_audio
    
    config = TranscriptionConfig(
        base_url=base_url,
        model=TranscriptionModel(model),
    )
    
    async with ATCTranscriber(config) as transcriber:
        if isinstance(source, np.ndarray):
            if sr is None:
                raise ValueError("Sample rate required for numpy array input")
            if segment:
                result = await transcriber.transcribe_segmented(source, sr)
                text = result.full_text
            else:
                result = await transcriber.transcribe(source, sr)
                text = result.text
        else:
            result = await transcriber.transcribe_file(source, segment_by_vad=segment)
            if isinstance(result, BatchResult):
                text = result.full_text
            else:
                text = result.text
    
    if postprocess:
        text = ATCPostProcessor.process(text)
    
    return text
