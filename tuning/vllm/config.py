"""
Central knobs for the tuner. Everything an operator would want to change without
editing logic lives here (or is overridable by the matching env var / CLI flag).

The tuner is meant to run ON the Spark, where Docker + the GPU + the skyspy
checkout all live, so the defaults assume localhost.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent  # tuning/vllm/ -> tuning/ -> repo root
RESULTS_DIR = Path(os.environ.get("TUNE_RESULTS_DIR", HERE / "results"))
STUDY_DB = os.environ.get("TUNE_STUDY_DB", f"sqlite:///{RESULTS_DIR / 'study.db'}")
MODELS_YAML = HERE / "models.yaml"
BENCH_DATASET = RESULTS_DIR / "bench_dataset.json"


# --------------------------------------------------------------------------- #
# vLLM container
# --------------------------------------------------------------------------- #
# The stock `vllm/vllm-openai:latest` is x86_64. On the GB10 (aarch64 + Blackwell
# sm_121) you MUST use an ARM64/Blackwell build. Set TUNE_VLLM_IMAGE to whatever
# already works on the box (check `docker images | grep vllm`). Confirm with
# `docker run --rm --gpus all $TUNE_VLLM_IMAGE --help` before a real run.
VLLM_IMAGE = os.environ.get("TUNE_VLLM_IMAGE", "vllm/vllm-openai:v0.24.0")

# Env vars injected into every tuner vLLM container. VLLM_USE_DEEP_GEMM=0 is
# required on the GB10 (the DeepGemm FP8 MoE kernel asserts on its scale-factor
# layout); mirrors the prod sip-ai-vllm config. Extend via TUNE_VLLM_ENV
# ("A=1,B=2").
CONTAINER_ENV = ["VLLM_USE_DEEP_GEMM=0", "VLLM_ENABLE_CUDA_COMPATIBILITY=0"] + [
    kv for kv in os.environ.get("TUNE_VLLM_ENV", "").split(",") if kv.strip()
]

# Name of the throwaway container the tuner (re)creates each trial. Kept distinct
# from the production `skyspy-vllm` and off the already-running :8010 endpoint.
CONTAINER_NAME = os.environ.get("TUNE_CONTAINER_NAME", "skyspy-vllm-tune")
TUNE_PORT = int(os.environ.get("TUNE_VLLM_PORT", "8100"))
ENDPOINT = f"http://localhost:{TUNE_PORT}/v1"

# When the eval suite runs inside its own container (make eval-assistant on a
# docker network), it can't reach the vLLM via localhost — attach vLLM to that
# network and address it by container name. Set TUNE_DOCKER_NETWORK to the eval
# compose network (e.g. skyspy_test-network). Empty = same-host (localhost).
DOCKER_NETWORK = os.environ.get("TUNE_DOCKER_NETWORK", "")
EVAL_ENDPOINT = f"http://{CONTAINER_NAME}:8000/v1" if DOCKER_NETWORK else ENDPOINT

# Persistent HuggingFace cache so model weights download once, then only load.
HF_CACHE_VOLUME = os.environ.get("TUNE_HF_CACHE", str(Path.home() / ".cache/huggingface"))
HUGGING_FACE_HUB_TOKEN = os.environ.get("HUGGING_FACE_HUB_TOKEN", "")

# How long to wait for the server to report healthy before calling the trial a
# failed launch (big models + cold cache load slowly).
LAUNCH_TIMEOUT_S = int(os.environ.get("TUNE_LAUNCH_TIMEOUT_S", "1200"))
HEALTH_POLL_S = 5
# Seconds to wait after tearing down a container before the next launch, so the
# GB10's unified GPU memory frees. Scaled up on the retry attempt.
SETTLE_S = int(os.environ.get("TUNE_SETTLE_S", "15"))


# --------------------------------------------------------------------------- #
# Signal collection
# --------------------------------------------------------------------------- #
# make eval-assistant runs in the repo's test compose stack; results land here.
EVAL_REPORT_DIR = REPO_ROOT / "test-results" / "assistant-evals"
EVAL_TIMEOUT_S = int(os.environ.get("TUNE_EVAL_TIMEOUT_S", "180"))  # per-request cap passed to pytest
# Wall-clock cap for the whole `make eval-assistant` run. A hung pytest (stuck in
# fixture/DB setup, never hitting the model) must fail the trial fast, not block
# the sweep. Normal eval is ~3-8 min; 15 min catches genuine hangs.
EVAL_WALL_TIMEOUT_S = int(os.environ.get("TUNE_EVAL_WALL_TIMEOUT_S", "900"))

# vllm bench serve concurrency levels: 1 = single-stream latency, N = throughput.
BENCH_CONCURRENCIES = (1, int(os.environ.get("TUNE_BENCH_CONCURRENCY", "8")))
BENCH_NUM_PROMPTS = int(os.environ.get("TUNE_BENCH_PROMPTS", "64"))
# Wall cap per `vllm bench serve` invocation. A bench of a dozen prompts finishes
# in ~1-2 min; 600s catches a stalled server (KV pressure/preemption) so it fails
# the trial instead of hanging (and crashing) the study.
BENCH_TIMEOUT_S = int(os.environ.get("TUNE_BENCH_TIMEOUT_S", "600"))


# --------------------------------------------------------------------------- #
# Reward
# --------------------------------------------------------------------------- #
@dataclass
class RewardConfig:
    w_quality: float = float(os.environ.get("TUNE_W_QUALITY", "0.6"))
    w_speed: float = float(os.environ.get("TUNE_W_SPEED", "0.4"))
    lambda_halluc: float = float(os.environ.get("TUNE_LAMBDA_HALLUC", "0.5"))
    q_min: float = float(os.environ.get("TUNE_Q_MIN", "0.7"))  # soft guard floor
    alpha_speed: float = float(os.environ.get("TUNE_ALPHA_SPEED", "0.5"))  # throughput vs latency mix
    fail_sentinel: float = float(os.environ.get("TUNE_FAIL_SENTINEL", "-1.0"))
    # Fixed speed references (tokens/s), captured from the Stage-A baseline so the
    # reward stays stationary. 0 => auto-fill from the first successful trial.
    ref_throughput_tok_s: float = field(default_factory=lambda: float(os.environ.get("TUNE_REF_THROUGHPUT", "0")))
    ref_latency_tok_s: float = field(default_factory=lambda: float(os.environ.get("TUNE_REF_LATENCY", "0")))


REWARD = RewardConfig()


# --------------------------------------------------------------------------- #
# Study
# --------------------------------------------------------------------------- #
STUDY_NAME = os.environ.get("TUNE_STUDY_NAME", "skyspy-vllm")
DEFAULT_N_TRIALS = int(os.environ.get("TUNE_N_TRIALS", "40"))

# --max-model-len is FIXED (not tuned): the assistant's full-mode prompt peaks
# near ~47k tokens (system ~3k + ~53 tool schemas ~8.5k + briefing + up to 15 tool
# results @6k chars + 16 history msgs @3k chars), and any window <= 16000 drops it
# into degraded COMPACT MODE. We want big context, not a knob that games the short
# evals by shrinking it — so pin it at min(model ctx_max, TARGET). 65536 gives
# headroom over the ~47k peak and prod's 49152. (Tuning it also broke Optuna:
# per-model categorical choices = "dynamic value space" crash.)
TARGET_MODEL_LEN = int(os.environ.get("TUNE_MODEL_LEN", "65536"))


def ensure_dirs() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    EVAL_REPORT_DIR.mkdir(parents=True, exist_ok=True)
