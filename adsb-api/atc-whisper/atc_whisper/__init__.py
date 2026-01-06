"""ATC Whisper - Lightweight async ATC airband transcription via speaches-ai.

Optimized for Raspberry Pi and other resource-constrained devices.

Example usage:
    
    # Simple usage
    import asyncio
    from atc_whisper import transcribe_atc_audio
    
    text = asyncio.run(transcribe_atc_audio("recording.wav"))
    print(text)
    
    # Full control
    from atc_whisper import ATCTranscriber, TranscriptionConfig
    
    config = TranscriptionConfig(
        base_url="http://my-server:8080",
        model="large-v3",
    )
    
    async with ATCTranscriber(config) as transcriber:
        result = await transcriber.transcribe_file(
            "recording.wav",
            segment_by_vad=True
        )
        print(result.full_text)
"""

__version__ = "0.1.0"

from .client import (
    ATCPostProcessor,
    ATCTranscriber,
    transcribe_atc_audio,
)
from .models import (
    BatchResult,
    PreprocessConfig,
    Segment,
    TranscriptionConfig,
    TranscriptionModel,
    TranscriptionResult,
    VADConfig,
)
from .preprocessing import (
    apply_bandpass,
    apply_highpass,
    audio_to_wav_bytes,
    compress_dynamic_range,
    load_audio,
    normalize,
    preprocess,
    preprocess_file,
    reduce_noise,
    resample_audio,
)
from .vad import (
    detect_speech_segments,
    merge_close_segments,
    segment_audio,
    split_long_segments,
)

__all__ = [
    # Version
    "__version__",
    # Main client
    "ATCTranscriber",
    "ATCPostProcessor",
    "transcribe_atc_audio",
    # Models
    "BatchResult",
    "PreprocessConfig",
    "Segment",
    "TranscriptionConfig",
    "TranscriptionModel",
    "TranscriptionResult",
    "VADConfig",
    # Preprocessing
    "apply_bandpass",
    "apply_highpass",
    "audio_to_wav_bytes",
    "compress_dynamic_range",
    "load_audio",
    "normalize",
    "preprocess",
    "preprocess_file",
    "reduce_noise",
    "resample_audio",
    # VAD
    "detect_speech_segments",
    "merge_close_segments",
    "segment_audio",
    "split_long_segments",
]
