"""Launch+perf smoke on real hardware — no eval stack. Proves the container
lifecycle and vllm bench serve legs against the GB10, coexisting with prod
(low gpu-util, separate port). Run: python -m tuning.vllm.smoke"""

import os

os.environ.setdefault("TUNE_VLLM_IMAGE", "vllm/vllm-openai:latest")

from tuning.vllm import perf  # noqa: E402
from tuning.vllm.launch import ServedModel  # noqa: E402
from tuning.vllm.space import TrialConfig, get_model  # noqa: E402

MODEL = os.environ.get("SMOKE_MODEL", "Qwen/Qwen2.5-7B-Instruct")
GPU_UTIL = float(os.environ.get("SMOKE_GPU_UTIL", "0.25"))  # coexist with prod @0.50


def main() -> None:
    m = get_model(MODEL)
    cfg = TrialConfig(
        model=m,
        max_model_len=16384,
        gpu_memory_utilization=GPU_UTIL,
        max_num_seqs=16,
        max_num_batched_tokens=4096,
        kv_cache_dtype="auto",
        enable_prefix_caching=True,
        enable_chunked_prefill=True,
    )
    print(f"[smoke] launching {m.id} @ util={GPU_UTIL} on port {os.environ.get('TUNE_VLLM_PORT', '8100')}", flush=True)
    with ServedModel(cfg):
        print("[smoke] healthy — running vllm bench serve @ concurrency 1 and N", flush=True)
        metrics = perf.run_perf(m.id)
        print("[smoke] PERF:", metrics, flush=True)
    print("[smoke] done, container torn down", flush=True)


if __name__ == "__main__":
    main()
