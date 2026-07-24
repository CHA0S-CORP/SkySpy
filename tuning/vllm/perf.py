"""
Speed signal: drive the trial's endpoint with `vllm bench serve` (ships inside
the vLLM image) at two concurrency levels and parse the throughput/latency
metrics.

  concurrency 1  -> single-stream latency regime (TTFT, TPOT, tok/s per stream)
  concurrency N  -> aggregate throughput regime (server output tok/s under load)

We measure the RAW server (chat/completions), not the agent loop — that's the
right signal for serving-config tuning. Prompt shape approximates a real
assistant call: a big system+tools context and a short-ish answer. `bench serve`
can't replay the multi-tool agent, so we use its `random` dataset at
representative lengths (deterministic via --seed) rather than the golden set.
"""

from __future__ import annotations

import json
import os
import subprocess

from . import config


class PerfError(RuntimeError):
    pass


# Representative token lengths for one assistant server call: the fixed system
# prompt + ~53 tool schemas dominate the input; answers are short-ish.
RANDOM_INPUT_LEN = int(os.environ.get("TUNE_BENCH_INPUT_LEN", "4000"))
RANDOM_OUTPUT_LEN = int(os.environ.get("TUNE_BENCH_OUTPUT_LEN", "256"))


def _bench_once(model_id: str, concurrency: int) -> dict:
    result_path = f"/tmp/bench_c{concurrency}.json"
    cmd = [
        "docker",
        "exec",
        config.CONTAINER_NAME,
        "vllm",
        "bench",
        "serve",
        "--backend",
        "openai-chat",
        "--base-url",
        "http://localhost:8000",
        "--endpoint",
        "/v1/chat/completions",
        "--model",
        model_id,
        "--dataset-name",
        "random",
        "--random-input-len",
        str(RANDOM_INPUT_LEN),
        "--random-output-len",
        str(RANDOM_OUTPUT_LEN),
        "--num-prompts",
        str(config.BENCH_NUM_PROMPTS),
        "--max-concurrency",
        str(concurrency),
        "--seed",
        "0",
        "--percentile-metrics",
        "ttft,tpot,itl,e2el",
        "--save-result",
        "--result-dir",
        "/tmp",
        "--result-filename",
        os.path.basename(result_path),
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, check=False, timeout=config.BENCH_TIMEOUT_S
        )
    except subprocess.TimeoutExpired as exc:
        # A bench that hangs (server stalls under concurrency / KV pressure) must
        # fail THIS trial, not crash the whole study — TimeoutExpired isn't a
        # PerfError, so wrap it. Kill the stuck bench exec's server so teardown is clean.
        raise PerfError(f"bench c={concurrency} hung past {config.BENCH_TIMEOUT_S}s") from exc
    if proc.returncode != 0:
        raise PerfError(f"bench c={concurrency} failed:\n{proc.stdout[-1500:]}\n{proc.stderr[-1000:]}")

    cat = subprocess.run(
        ["docker", "exec", config.CONTAINER_NAME, "cat", result_path],
        capture_output=True,
        text=True,
        check=False,
    )
    if cat.returncode != 0:
        raise PerfError(f"could not read {result_path}: {cat.stderr}")
    return json.loads(cat.stdout)


def _summarize(raw: dict) -> dict:
    """Pull the fields we care about out of a bench-serve result blob."""
    return {
        "output_throughput_tok_s": raw.get("output_throughput"),
        "total_throughput_tok_s": raw.get("total_token_throughput"),
        "request_throughput_req_s": raw.get("request_throughput"),
        "median_ttft_ms": raw.get("median_ttft_ms"),
        "median_tpot_ms": raw.get("median_tpot_ms"),
        "p99_ttft_ms": raw.get("p99_ttft_ms"),
        "median_e2el_ms": raw.get("median_e2el_ms"),
    }


def run_perf(model_id: str) -> dict:
    """Return {c1: {...}, cN: {...}} speed metrics for the two concurrencies."""
    out = {}
    for c in config.BENCH_CONCURRENCIES:
        out[f"c{c}"] = _summarize(_bench_once(model_id, c))
    return out
