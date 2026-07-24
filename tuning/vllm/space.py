"""
Model registry loader + the vLLM launch config type + the Optuna search space.

A `TrialConfig` fully describes one vLLM server launch: which model and which
serving knobs. `suggest()` samples one from an Optuna trial; ranges are
conditional on the chosen model (its ctx_max caps --max-model-len, its declared
quantization is passed through).
"""

from __future__ import annotations

from dataclasses import dataclass

import yaml

from . import config


@dataclass(frozen=True)
class Model:
    id: str
    family: str
    tool_parser: str
    quantization: str | None
    ctx_max: int
    min_gpu_gb: int
    enabled: bool
    notes: str = ""


@dataclass
class TrialConfig:
    """One concrete vLLM launch. Serialized into --flags by launch.py and into a
    reproducible .env by optimize.py."""

    model: Model
    max_model_len: int
    gpu_memory_utilization: float
    max_num_seqs: int
    max_num_batched_tokens: int
    kv_cache_dtype: str  # auto | fp8
    enable_prefix_caching: bool
    enable_chunked_prefill: bool

    def as_params(self) -> dict:
        """Flat dict for logging / Optuna user-attrs / the results table."""
        return {
            "model": self.model.id,
            "max_model_len": self.max_model_len,
            "gpu_memory_utilization": round(self.gpu_memory_utilization, 3),
            "max_num_seqs": self.max_num_seqs,
            "max_num_batched_tokens": self.max_num_batched_tokens,
            "kv_cache_dtype": self.kv_cache_dtype,
            "enable_prefix_caching": self.enable_prefix_caching,
            "enable_chunked_prefill": self.enable_chunked_prefill,
        }


def load_models(only_enabled: bool = True) -> list[Model]:
    with open(config.MODELS_YAML) as f:
        raw = yaml.safe_load(f)
    models = [Model(**m) for m in raw["models"]]
    if only_enabled:
        return [m for m in models if m.enabled]
    return models


def get_model(model_id: str) -> Model:
    for m in load_models(only_enabled=False):
        if m.id == model_id:
            return m
    raise KeyError(f"model {model_id!r} not in {config.MODELS_YAML}")


# --------------------------------------------------------------------------- #
# Knob ranges (conditional on the model)
# --------------------------------------------------------------------------- #
def _max_model_len_choices(model: Model) -> list[int]:
    # The assistant prompt + ~53 tool schemas need well over 8k, so 8192 is the
    # floor. Cap at the model's native ctx_max.
    candidates = [8192, 16384, 32768, 65536, 131072]
    return [c for c in candidates if c <= model.ctx_max] or [min(8192, model.ctx_max)]


def suggest(trial, model: Model) -> TrialConfig:
    """Sample one TrialConfig from an Optuna trial for a fixed model.

    Model is chosen by the caller (categorical over the screen survivors) so the
    conditional ranges below key off a concrete Model.
    """
    return TrialConfig(
        model=model,
        max_model_len=trial.suggest_categorical("max_model_len", _max_model_len_choices(model)),
        # Ceiling capped for the DGX Spark: its 128 GB is UNIFIED (GPU+system), so
        # ~12 GiB is always held by the OS/other containers and >0.88 fails to
        # allocate at startup. Raise the top on a dedicated discrete-GPU box.
        gpu_memory_utilization=trial.suggest_float("gpu_memory_utilization", 0.70, 0.85, step=0.01),
        max_num_seqs=trial.suggest_categorical("max_num_seqs", [8, 16, 32, 64, 128, 256]),
        max_num_batched_tokens=trial.suggest_categorical("max_num_batched_tokens", [2048, 4096, 8192, 16384]),
        kv_cache_dtype=trial.suggest_categorical("kv_cache_dtype", ["auto", "fp8"]),
        enable_prefix_caching=trial.suggest_categorical("enable_prefix_caching", [True, False]),
        enable_chunked_prefill=trial.suggest_categorical("enable_chunked_prefill", [True, False]),
    )


def baseline(model: Model) -> TrialConfig:
    """Default-ish config for the Stage-A model screen: mirrors the compose
    defaults so the screen reflects out-of-the-box behavior."""
    return TrialConfig(
        model=model,
        max_model_len=min(32768, model.ctx_max),
        gpu_memory_utilization=0.80,
        max_num_seqs=64,
        max_num_batched_tokens=8192,
        kv_cache_dtype="auto",
        enable_prefix_caching=True,
        enable_chunked_prefill=True,
    )
