# vLLM serving-config tuner (DGX Spark)

Bayesian optimization (Optuna TPE) over the vLLM launch flags **and** model
choice for the SkySpy assistant, scored by a **blended quality+speed reward**:

- **quality** — the 16-case golden assistant eval suite (`make eval-assistant`),
  run through the *real* agent against the seeded world. Uses `pass_rate` minus a
  hallucination penalty.
- **speed** — `vllm bench serve` at concurrency **1** (single-stream latency) and
  **N** (aggregate throughput).

```
reward = w_q * quality + w_s * speed          (defaults w_q=0.6, w_s=0.4)
         * soft-guard: if quality < Q_MIN, scale by quality/Q_MIN   (fast-but-wrong can't win)
failed launch / eval / bench -> fail sentinel (BO learns to avoid it)
```

Speed references are **fixed** (captured from the Stage-A baseline) so the reward
surface is stationary — BO breaks otherwise.

## Runs on the Spark

Docker + the GPU + this checkout must all be on the box. The tuner spins its own
throwaway vLLM container (`skyspy-vllm-tune`) on **port 8100**, so it never
touches the production `skyspy-vllm` or the endpoint already serving on `:8010`.

### 0. Recon + image (do this first)

The stock `vllm/vllm-openai:latest` is **x86_64**. The GB10 is **aarch64 +
Blackwell** — you need an ARM64/Blackwell vLLM build.

```bash
uname -m                          # expect aarch64
nvidia-smi                        # GB10 / driver / CUDA
docker images | grep vllm         # reuse whatever already works on the box
docker run --rm --gpus all <image> --help   # sanity
export TUNE_VLLM_IMAGE=<that image>
```

### 1. Install the driver

```bash
cd <repo>/tuning/vllm
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
# gated models (Llama) need a token:
export HUGGING_FACE_HUB_TOKEN=hf_xxx
```

### 2. Dry run — prove the pipeline end to end

```bash
cd <repo>                         # run as a module from repo root
python -m tuning.vllm.optimize --dry-run --model Qwen/Qwen2.5-7B-Instruct
```
Launches one baseline container, runs the evals + bench, prints a reward. Confirms
all three legs wire up.

### 3. Short study, then full run

```bash
python -m tuning.vllm.optimize --n-trials 5     # smoke; Ctrl-C then rerun resumes
python -m tuning.vllm.optimize --n-trials 40    # Stage A screen + Stage B BO
```

Outputs in `tuning/vllm/results/`:
- `best.env` — paste into the repo `.env`, then `docker compose --profile gpu up -d vllm`
- `ranked.tsv` — every trial by reward
- `stage_a_screen.json` — per-model baseline + chosen speed references
- `study.db` — resumable Optuna study → `optuna-dashboard sqlite:///tuning/vllm/results/study.db`

## Configure

- **Models** — `models.yaml`. Add a novel/quantized model = one entry; flip
  `enabled: true`. A single GPU, so no tensor-parallel.
- **Search space** — `space.py` (`suggest()` knob ranges, conditional per model).
- **Reward weights / floors** — `config.py::RewardConfig` or `TUNE_W_QUALITY`,
  `TUNE_W_SPEED`, `TUNE_LAMBDA_HALLUC`, `TUNE_Q_MIN`, `TUNE_ALPHA_SPEED`.
- **Everything else** — `config.py` / `TUNE_*` env vars (image, ports, HF cache,
  concurrency levels, bench prompt lengths, timeouts).

## Files

| file | role |
|------|------|
| `config.py` | central knobs + `TUNE_*` env overrides |
| `models.yaml` | pluggable candidate-model registry |
| `space.py` | `TrialConfig`, model loader, Optuna search space |
| `launch.py` | vLLM container lifecycle (docker run, health wait, teardown) |
| `quality.py` | run golden evals, parse summary |
| `perf.py` | run `vllm bench serve` @1/@N, parse metrics |
| `reward.py` | blended reward + fixed references |
| `optimize.py` | two-stage Optuna driver, reporting, CLI |
