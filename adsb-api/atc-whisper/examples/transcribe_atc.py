#!/usr/bin/env python3
"""Example: Transcribe ATC recordings from a directory.

Usage:
    python transcribe_atc.py /path/to/recordings --server http://localhost:8080
"""

import argparse
import asyncio
import json
import logging
from pathlib import Path
from datetime import datetime

from atc_whisper import (
    ATCTranscriber,
    ATCPostProcessor,
    TranscriptionConfig,
    PreprocessConfig,
    VADConfig,
    TranscriptionModel,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def transcribe_directory(
    input_dir: Path,
    output_dir: Path,
    server_url: str,
    model: str,
    max_concurrent: int,
):
    """Transcribe all WAV files in a directory."""
    
    # Find all WAV files
    wav_files = list(input_dir.glob("**/*.wav"))
    if not wav_files:
        logger.warning(f"No WAV files found in {input_dir}")
        return
    
    logger.info(f"Found {len(wav_files)} WAV files to process")
    
    # Configure
    config = TranscriptionConfig(
        base_url=server_url,
        model=TranscriptionModel(model),
        max_concurrent=max_concurrent,
    )
    
    preprocess_config = PreprocessConfig(
        noise_prop_decrease=0.75,
        apply_compression=True,
    )
    
    vad_config = VADConfig(
        aggressiveness=2,
        min_silence_ms=400,  # ATC transmissions have distinct gaps
    )
    
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    
    async with ATCTranscriber(config, preprocess_config, vad_config) as transcriber:
        
        async def process_file(wav_path: Path) -> dict:
            """Process a single file."""
            logger.info(f"Processing: {wav_path.name}")
            
            try:
                result = await transcriber.transcribe_file(
                    str(wav_path),
                    segment_by_vad=True,
                )
                
                # Post-process the text
                text = ATCPostProcessor.process(result.full_text)
                
                file_result = {
                    "file": wav_path.name,
                    "path": str(wav_path),
                    "text": text,
                    "segments": [
                        {
                            "start_ms": r.source_segment.start_ms if r.source_segment else 0,
                            "end_ms": r.source_segment.end_ms if r.source_segment else 0,
                            "text": ATCPostProcessor.process(r.text),
                        }
                        for r in result.results
                    ],
                    "duration_seconds": result.total_duration_seconds,
                    "preprocess_ms": result.total_preprocess_ms,
                    "transcribe_ms": result.total_transcribe_ms,
                    "status": "success",
                }
                
                logger.info(
                    f"  ✓ {wav_path.name}: {len(result.results)} segments, "
                    f"{result.total_transcribe_ms:.0f}ms"
                )
                
                return file_result
                
            except Exception as e:
                logger.error(f"  ✗ {wav_path.name}: {e}")
                return {
                    "file": wav_path.name,
                    "path": str(wav_path),
                    "status": "error",
                    "error": str(e),
                }
        
        # Process files with concurrency
        file_results = await asyncio.gather(
            *[process_file(f) for f in wav_files],
            return_exceptions=True,
        )
        
        # Handle any exceptions that weren't caught
        for i, result in enumerate(file_results):
            if isinstance(result, Exception):
                results.append({
                    "file": wav_files[i].name,
                    "status": "error",
                    "error": str(result),
                })
            else:
                results.append(result)
    
    # Write summary
    summary = {
        "timestamp": datetime.now().isoformat(),
        "input_dir": str(input_dir),
        "server": server_url,
        "model": model,
        "total_files": len(wav_files),
        "successful": sum(1 for r in results if r.get("status") == "success"),
        "failed": sum(1 for r in results if r.get("status") == "error"),
        "results": results,
    }
    
    output_file = output_dir / "transcriptions.json"
    with open(output_file, "w") as f:
        json.dump(summary, f, indent=2)
    
    logger.info(f"\nResults written to: {output_file}")
    logger.info(f"Successful: {summary['successful']}/{summary['total_files']}")
    
    # Also write a simple text file with all transcriptions
    text_file = output_dir / "transcriptions.txt"
    with open(text_file, "w") as f:
        for r in results:
            if r.get("status") == "success":
                f.write(f"=== {r['file']} ===\n")
                f.write(r["text"])
                f.write("\n\n")
    
    logger.info(f"Plain text: {text_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe ATC airband recordings"
    )
    parser.add_argument(
        "input_dir",
        type=Path,
        help="Directory containing WAV files",
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=Path("./output"),
        help="Output directory (default: ./output)",
    )
    parser.add_argument(
        "-s", "--server",
        default="http://localhost:8080",
        help="speaches-ai server URL (default: http://localhost:8080)",
    )
    parser.add_argument(
        "-m", "--model",
        default="large-v3",
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3", "turbo"],
        help="Whisper model (default: large-v3)",
    )
    parser.add_argument(
        "-c", "--concurrent",
        type=int,
        default=2,
        help="Max concurrent transcriptions (default: 2, good for RPi)",
    )
    
    args = parser.parse_args()
    
    if not args.input_dir.exists():
        parser.error(f"Input directory does not exist: {args.input_dir}")
    
    asyncio.run(transcribe_directory(
        args.input_dir,
        args.output,
        args.server,
        args.model,
        args.concurrent,
    ))


if __name__ == "__main__":
    main()
