# ATC Whisper

Lightweight async library for transcribing ATC (Air Traffic Control) airband AM recordings via [speaches-ai](https://github.com/speaches-ai/speaches). Optimized for Raspberry Pi and resource-constrained devices.

## Features

- **ATC-Optimized Preprocessing**: Bandpass filtering for airband frequencies (300-3400Hz), noise reduction for AM hiss, dynamic compression for quiet transmissions
- **Voice Activity Detection**: Segment recordings by squelch breaks / transmission boundaries using WebRTC VAD
- **Async & Concurrent**: Connection pooling, semaphore-based concurrency control, optimized for high throughput
- **Lightweight**: Minimal dependencies, runs efficiently on RPi 4/5
- **OpenAI-Compatible**: Works with any Whisper API (speaches-ai, faster-whisper-server, etc.)

## Installation

```bash
pip install atc-whisper
```

Or from source:

```bash
git clone https://github.com/yourusername/atc-whisper.git
cd atc-whisper
pip install -e .
```

### RPi-Specific Notes

On Raspberry Pi, you may need to install some system dependencies:

```bash
# For scipy/numpy performance
sudo apt install libopenblas-dev libatlas-base-dev

# For webrtcvad
sudo apt install python3-dev
```

## Quick Start

### Simple Usage

```python
import asyncio
from atc_whisper import transcribe_atc_audio

# Transcribe a file
text = asyncio.run(transcribe_atc_audio(
    "recording.wav",
    base_url="http://localhost:8080",  # Your speaches-ai server
    segment=True,  # Split by transmissions
))
print(text)
```

### Full Control

```python
import asyncio
from atc_whisper import (
    ATCTranscriber,
    TranscriptionConfig,
    PreprocessConfig,
    VADConfig,
)

async def main():
    # Configure transcription
    config = TranscriptionConfig(
        base_url="http://192.168.1.100:8080",
        model="large-v3",
        max_concurrent=2,  # Limit for RPi
    )
    
    # Optional: tune preprocessing
    preprocess_config = PreprocessConfig(
        noise_prop_decrease=0.8,  # More aggressive noise reduction
        apply_compression=True,
    )
    
    # Optional: tune VAD
    vad_config = VADConfig(
        aggressiveness=2,
        min_speech_ms=150,
        min_silence_ms=400,
    )
    
    async with ATCTranscriber(config, preprocess_config, vad_config) as transcriber:
        # Transcribe with segmentation
        result = await transcriber.transcribe_file(
            "long_recording.wav",
            segment_by_vad=True,
        )
        
        print(f"Full transcript: {result.full_text}")
        print(f"Segments: {len(result.results)}")
        print(f"Total time: {result.total_transcribe_ms:.0f}ms")
        
        # Individual segments with timestamps
        for r in result.results:
            if r.source_segment:
                start = r.source_segment.start_ms / 1000
                print(f"[{start:.1f}s] {r.text}")

asyncio.run(main())
```

### Preprocessing Only

If you want to preprocess audio and send it elsewhere:

```python
from atc_whisper import preprocess_file, audio_to_wav_bytes, PreprocessConfig

# Load and preprocess
config = PreprocessConfig(
    lowcut_hz=300,
    highcut_hz=3400,
    noise_reduce=True,
)

audio = preprocess_file("noisy_recording.wav", config)

# Convert to WAV bytes for API
wav_bytes = audio_to_wav_bytes(audio)

# Send to your API...
```

### Segment Detection Only

```python
from atc_whisper import load_audio, segment_audio, VADConfig

audio, sr = load_audio("recording.wav")

config = VADConfig(
    aggressiveness=2,
    min_silence_ms=300,
)

segments = segment_audio(audio, sr, config)

for seg in segments:
    print(f"Transmission: {seg.start_ms}ms - {seg.end_ms}ms ({seg.duration_ms}ms)")
```

### Batch Processing

```python
import asyncio
from pathlib import Path
from atc_whisper import ATCTranscriber, TranscriptionConfig

async def process_directory(directory: str):
    config = TranscriptionConfig(
        base_url="http://localhost:8080",
        max_concurrent=4,  # Process 4 files concurrently
    )
    
    async with ATCTranscriber(config) as transcriber:
        wav_files = list(Path(directory).glob("*.wav"))
        
        async def process_file(path):
            result = await transcriber.transcribe_file(str(path), segment_by_vad=True)
            return path.name, result.full_text
        
        results = await asyncio.gather(*[process_file(f) for f in wav_files])
        
        for filename, text in results:
            print(f"{filename}: {text[:100]}...")

asyncio.run(process_directory("/path/to/recordings"))
```

### Real-time Streaming

```python
import asyncio
import numpy as np
from atc_whisper import ATCTranscriber

async def transcribe_stream():
    async with ATCTranscriber() as transcriber:
        
        async def audio_source():
            # Your audio source - e.g., from SDR, soundcard, etc.
            while True:
                # Yield (audio_chunk, sample_rate) tuples
                chunk = np.random.randn(16000 * 5).astype(np.float32)  # 5 seconds
                yield chunk, 16000
                await asyncio.sleep(5)
        
        async for result in transcriber.transcribe_stream(audio_source()):
            print(f"Transcribed: {result.text}")

asyncio.run(transcribe_stream())
```

## Configuration Reference

### TranscriptionConfig

| Parameter | Default | Description |
|-----------|---------|-------------|
| `base_url` | `http://localhost:8080` | speaches-ai server URL |
| `model` | `large-v3` | Whisper model |
| `language` | `en` | Language code |
| `max_concurrent` | `4` | Max concurrent requests |
| `connect_timeout` | `10.0` | Connection timeout (seconds) |
| `read_timeout` | `60.0` | Read timeout (seconds) |
| `max_retries` | `3` | Retry count on failure |
| `prompt` | *(ATC-specific)* | Initial prompt for Whisper |

### PreprocessConfig

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lowcut_hz` | `300.0` | Bandpass low cutoff |
| `highcut_hz` | `3400.0` | Bandpass high cutoff |
| `noise_reduce` | `True` | Enable noise reduction |
| `noise_prop_decrease` | `0.75` | Noise reduction strength (0-1) |
| `apply_compression` | `True` | Dynamic range compression |
| `normalize_target` | `0.7` | Peak normalization target |

### VADConfig

| Parameter | Default | Description |
|-----------|---------|-------------|
| `aggressiveness` | `2` | VAD aggressiveness (0-3) |
| `min_speech_ms` | `200` | Min speech segment duration |
| `min_silence_ms` | `300` | Min silence to split segments |
| `padding_ms` | `150` | Padding around segments |

## Performance on Raspberry Pi

Tested on RPi 4 (4GB):

- Preprocessing: ~0.3x realtime (30s audio in ~10s)
- Network: Limited by your speaches-ai server
- Memory: ~200MB peak for typical recordings

Tips for RPi:
- Set `max_concurrent=2` to avoid overwhelming the network/CPU
- Use `model="small"` or `model="base"` if your server is also RPi-based
- Consider running speaches-ai on a more powerful machine and using the RPi as a client

## License

MIT
