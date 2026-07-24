"""
vLLM container lifecycle for one trial: build the arg list from a TrialConfig,
`docker run` it on a persistent HF cache, wait until it serves, and always tear
it down afterwards. A launch that OOMs / crashes / never turns healthy raises
`LaunchError`, which the driver maps to the fail sentinel reward.
"""

from __future__ import annotations

import shlex
import subprocess
import time

import httpx

from . import config
from .space import TrialConfig


class LaunchError(RuntimeError):
    """Server failed to come up (OOM, bad flags, crash, or health timeout)."""


def _vllm_args(cfg: TrialConfig) -> list[str]:
    m = cfg.model
    # The vllm/vllm-openai + NVIDIA nvcr images set ENTRYPOINT ["vllm","serve"],
    # so the model is passed positionally as the first arg — NOT another "serve".
    args = [
        m.id,
        "--served-model-name",
        m.id,
        "--trust-remote-code",
        "--max-model-len",
        str(cfg.max_model_len),
        "--gpu-memory-utilization",
        str(cfg.gpu_memory_utilization),
        "--max-num-seqs",
        str(cfg.max_num_seqs),
        "--max-num-batched-tokens",
        str(cfg.max_num_batched_tokens),
        "--kv-cache-dtype",
        cfg.kv_cache_dtype,
        "--enable-auto-tool-choice",
        "--tool-call-parser",
        m.tool_parser,
        "--port",
        "8000",
    ]
    if m.quantization:
        args += ["--quantization", m.quantization]
    if cfg.enable_prefix_caching:
        args.append("--enable-prefix-caching")
    else:
        args.append("--no-enable-prefix-caching")
    if cfg.enable_chunked_prefill:
        args.append("--enable-chunked-prefill")
    if m.extra_args:
        args += shlex.split(m.extra_args)
    return args


def _docker_run_cmd(cfg: TrialConfig) -> list[str]:
    cmd = [
        "docker",
        "run",
        "-d",
        "--rm",
        "--name",
        config.CONTAINER_NAME,
        "--gpus",
        "all",
        "--ipc",
        "host",
        "-p",
        f"{config.TUNE_PORT}:8000",
        "-v",
        f"{config.HF_CACHE_VOLUME}:/root/.cache/huggingface",
    ]
    if config.DOCKER_NETWORK:
        # Join the eval network so make eval-assistant can reach us by name.
        cmd += ["--network", config.DOCKER_NETWORK]
    # GB10/Blackwell: the DeepGemm FP8 MoE kernel crashes ("Unknown SF
    # transformation") on the 30B-A3B-FP8 MoE. Disabling it (as the prod
    # sip-ai-vllm does) falls back to a working backend. Harmless for dense models.
    for kv in config.CONTAINER_ENV:
        cmd += ["-e", kv]
    if config.HUGGING_FACE_HUB_TOKEN:
        cmd += ["-e", f"HUGGING_FACE_HUB_TOKEN={config.HUGGING_FACE_HUB_TOKEN}"]
    cmd += [config.VLLM_IMAGE]
    cmd += _vllm_args(cfg)
    return cmd


def teardown() -> None:
    """Stop the tuner container (best-effort; --rm removes it on stop)."""
    subprocess.run(
        ["docker", "rm", "-f", config.CONTAINER_NAME],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def _container_running() -> bool:
    out = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", config.CONTAINER_NAME],
        capture_output=True,
        text=True,
        check=False,
    )
    return out.returncode == 0 and out.stdout.strip() == "true"


def _tail_logs(n: int = 40) -> str:
    out = subprocess.run(
        ["docker", "logs", "--tail", str(n), config.CONTAINER_NAME],
        capture_output=True,
        text=True,
        check=False,
    )
    return (out.stdout or "") + (out.stderr or "")


def _wait_healthy() -> None:
    """Poll until /health is 200 and the model is listed, or fail."""
    health_url = f"http://localhost:{config.TUNE_PORT}/health"
    models_url = f"{config.ENDPOINT}/models"
    deadline = time.monotonic() + config.LAUNCH_TIMEOUT_S
    while time.monotonic() < deadline:
        if not _container_running():
            raise LaunchError(f"container exited early:\n{_tail_logs()}")
        try:
            if httpx.get(health_url, timeout=5).status_code == 200:
                r = httpx.get(models_url, timeout=5)
                if r.status_code == 200 and r.json().get("data"):
                    return
        except httpx.HTTPError:
            pass  # not up yet
        time.sleep(config.HEALTH_POLL_S)
    raise LaunchError(f"health timeout after {config.LAUNCH_TIMEOUT_S}s:\n{_tail_logs()}")


class ServedModel:
    """Context manager: launches the server on enter, tears it down on exit."""

    def __init__(self, cfg: TrialConfig):
        self.cfg = cfg

    def __enter__(self) -> ServedModel:
        # The GB10's GPU memory is unified and frees lazily after a container
        # dies, so an immediate relaunch can see too little free memory and OOM.
        # Settle after teardown, and retry once (longer settle) on an early exit.
        last: LaunchError | None = None
        for attempt in range(2):
            teardown()
            time.sleep(config.SETTLE_S * (attempt + 1))
            run = subprocess.run(_docker_run_cmd(self.cfg), capture_output=True, text=True, check=False)
            if run.returncode != 0:
                last = LaunchError(f"docker run failed: {run.stderr.strip()}")
                continue
            try:
                _wait_healthy()
                return self
            except LaunchError as exc:
                last = exc
                teardown()
        raise last if last else LaunchError("launch failed")

    def __exit__(self, *exc) -> None:
        teardown()
