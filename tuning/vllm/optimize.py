"""
Two-stage Optuna driver.

Stage A — model screen: run each enabled model once at baseline knobs. Captures
the FIXED speed references (from the fastest baseline) and drops models whose
quality is far below the guard floor or whose throughput is far off the pack.

Stage B — Bayesian optimization: TPE over the serving knobs, with the surviving
models as one categorical dimension. Maximizes the blended reward.

Each trial: launch vLLM -> run evals (quality) -> run bench (speed) -> reward ->
teardown. Failures map to the fail sentinel so BO learns to avoid them. State
lives in a SQLite study, so the run is resumable (rerun to continue).

Usage (on the Spark):
  python -m tuning.vllm.optimize --dry-run --model Qwen/Qwen2.5-7B-Instruct
  python -m tuning.vllm.optimize --n-trials 5
  python -m tuning.vllm.optimize --n-trials 40
"""

from __future__ import annotations

import argparse
import json
import logging

import optuna

from . import config, perf, quality, reward
from .launch import LaunchError, ServedModel
from .perf import PerfError
from .quality import QualityError
from .space import Model, TrialConfig, baseline, get_model, load_models, suggest

log = logging.getLogger("vllm-tune")


# --------------------------------------------------------------------------- #
# One evaluation of a concrete config
# --------------------------------------------------------------------------- #
def evaluate(cfg: TrialConfig, refs: tuple[float, float]) -> dict:
    """Launch -> quality -> speed -> reward for one config. Never raises for an
    expected failure (bad launch/eval/bench) — returns a fail record instead."""
    ref_throughput, ref_latency = refs
    try:
        with ServedModel(cfg):
            summary = quality.run_quality(cfg.model.id)
            perf_metrics = perf.run_perf(cfg.model.id)
    except (LaunchError, QualityError, PerfError) as exc:
        log.warning("trial failed for %s: %s", cfg.model.id, str(exc)[:400])
        return {"reward": config.REWARD.fail_sentinel, "failed": True, "error": str(exc)[:400]}

    scored = reward.blended_reward(summary, perf_metrics, ref_throughput, ref_latency)
    scored.update({"failed": False, "summary": summary, "perf": perf_metrics})
    return scored


# --------------------------------------------------------------------------- #
# Stage A — model screen (also sets speed references)
# --------------------------------------------------------------------------- #
def stage_a_screen(models: list[Model]) -> tuple[list[Model], tuple[float, float]]:
    log.info("Stage A: screening %d models at baseline", len(models))
    rows = []
    best_throughput = best_latency = 0.0

    for m in models:
        cfg = baseline(m)
        try:
            with ServedModel(cfg):
                summary = quality.run_quality(m.id)
                perf_metrics = perf.run_perf(m.id)
        except (LaunchError, QualityError, PerfError) as exc:
            log.warning("screen: %s unusable (%s)", m.id, str(exc)[:200])
            rows.append({"model": m, "ok": False})
            continue

        tput, lat = reward.extract_speed(perf_metrics)
        best_throughput = max(best_throughput, tput)
        best_latency = max(best_latency, lat)
        rows.append(
            {
                "model": m,
                "ok": True,
                "quality": reward.quality_score(summary),
                "throughput": tput,
                "latency": lat,
                "summary": summary,
            }
        )
        log.info("screen: %s q=%.3f tput=%.1f tok/s lat=%.1f tok/s", m.id, reward.quality_score(summary), tput, lat)

    # References: prefer env overrides, else the best baseline observed.
    refs = (
        config.REWARD.ref_throughput_tok_s or best_throughput or 1.0,
        config.REWARD.ref_latency_tok_s or best_latency or 1.0,
    )

    ok = [r for r in rows if r.get("ok")]
    if not ok:
        raise SystemExit("Stage A: no model came up cleanly — check the vLLM image / GPU.")

    # Survivors: quality within reach of the floor AND throughput not hopeless
    # (>= 25% of the best). Keep at least the top 2 by quality regardless.
    floor = config.REWARD.q_min * 0.85
    survivors = [r["model"] for r in ok if r["quality"] >= floor and r["throughput"] >= 0.25 * refs[0]]
    if len(survivors) < 2:
        survivors = [r["model"] for r in sorted(ok, key=lambda r: r["quality"], reverse=True)[:2]]

    log.info("Stage A survivors: %s | refs: throughput=%.1f latency=%.1f", [m.id for m in survivors], refs[0], refs[1])
    _write_screen_report(rows, refs, survivors)
    return survivors, refs


def _write_screen_report(rows, refs, survivors) -> None:
    config.ensure_dirs()
    out = {
        "refs": {"throughput_tok_s": refs[0], "latency_tok_s": refs[1]},
        "survivors": [m.id for m in survivors],
        "models": [
            {
                "model": r["model"].id,
                "ok": r.get("ok", False),
                "quality": r.get("quality"),
                "throughput": r.get("throughput"),
                "latency": r.get("latency"),
            }
            for r in rows
        ],
    }
    (config.RESULTS_DIR / "stage_a_screen.json").write_text(json.dumps(out, indent=2))


# --------------------------------------------------------------------------- #
# Stage B — Bayesian optimization
# --------------------------------------------------------------------------- #
def make_objective(survivors: list[Model], refs: tuple[float, float]):
    by_id = {m.id: m for m in survivors}

    def objective(trial: optuna.Trial) -> float:
        model_id = trial.suggest_categorical("model", list(by_id))
        cfg = suggest(trial, by_id[model_id])
        result = evaluate(cfg, refs)
        # stash everything for the report / dashboard
        trial.set_user_attr("params", cfg.as_params())
        for k in ("quality", "speed", "pass_rate", "hallucination_cases", "failed", "error"):
            if k in result:
                trial.set_user_attr(k, result[k])
        return result["reward"]

    return objective


def run_study(n_trials: int, survivors: list[Model], refs: tuple[float, float]) -> optuna.Study:
    study = optuna.create_study(
        study_name=config.STUDY_NAME,
        storage=config.STUDY_DB,
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=0, multivariate=True, group=True),
        load_if_exists=True,
    )
    # Seed the study with each survivor's baseline config so the known-good screen
    # points are actually evaluated in-study — otherwise emit_best can miss the
    # true best (the screen baselines never enter the study) and TPE wastes early
    # trials rediscovering them. skip_if_exists avoids re-queueing on resume.
    for m in survivors:
        study.enqueue_trial(baseline(m).as_params(), skip_if_exists=True)
    study.optimize(make_objective(survivors, refs), n_trials=n_trials)
    return study


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
# Scalar knobs map 1:1 to compose env vars; the boolean/quantization flags are
# folded into VLLM_EXTRA_ARGS (a flag string compose splices into the command).
_SCALAR_ENV = {
    "model": "VLLM_MODEL",
    "max_model_len": "VLLM_MAX_MODEL_LEN",
    "gpu_memory_utilization": "VLLM_GPU_MEMORY_UTILIZATION",
    "max_num_seqs": "VLLM_MAX_NUM_SEQS",
    "max_num_batched_tokens": "VLLM_MAX_NUM_BATCHED_TOKENS",
    "kv_cache_dtype": "VLLM_KV_CACHE_DTYPE",
}


def _extra_args(params: dict) -> str:
    """Flag-style args compose can't express as ${VAR} defaults. Tool parser and
    the scalar knobs are set separately, so keep them out of here to avoid dupes."""
    flags = []
    flags.append("--enable-prefix-caching" if params.get("enable_prefix_caching") else "--no-enable-prefix-caching")
    if params.get("enable_chunked_prefill"):
        flags.append("--enable-chunked-prefill")
    quant = get_model(params["model"]).quantization
    if quant:
        flags += ["--quantization", quant]
    return " ".join(flags)


def emit_best(study: optuna.Study) -> None:
    config.ensure_dirs()
    best = study.best_trial
    params = best.user_attrs.get("params", {})

    lines = [
        "# Best vLLM config from the SkySpy tuner.",
        f"# reward={best.value:.4f} quality={best.user_attrs.get('quality')} "
        f"speed={best.user_attrs.get('speed')} pass_rate={best.user_attrs.get('pass_rate')}",
        "# Drop these into .env, then: docker compose --profile gpu up -d vllm",
    ]
    for key, env in _SCALAR_ENV.items():
        lines.append(f"{env}={params.get(key)}")
    lines.append(f"VLLM_TOOL_PARSER={get_model(params['model']).tool_parser}")
    lines.append(f"VLLM_EXTRA_ARGS={_extra_args(params)}")
    (config.RESULTS_DIR / "best.env").write_text("\n".join(lines) + "\n")

    # ranked table
    trials = [t for t in study.trials if t.value is not None]
    trials.sort(key=lambda t: t.value, reverse=True)
    table = ["reward\tquality\tspeed\tmodel\tknobs"]
    for t in trials:
        p = t.user_attrs.get("params", {})
        knobs = ",".join(
            f"{k}={p[k]}"
            for k in (
                "max_model_len",
                "gpu_memory_utilization",
                "max_num_seqs",
                "max_num_batched_tokens",
                "kv_cache_dtype",
            )
            if k in p
        )
        table.append(
            f"{t.value:.4f}\t{t.user_attrs.get('quality')}\t{t.user_attrs.get('speed')}\t{p.get('model')}\t{knobs}"
        )
    (config.RESULTS_DIR / "ranked.tsv").write_text("\n".join(table) + "\n")

    print("\n=== best config ===")
    print("\n".join(lines))
    print(f"\nwrote {config.RESULTS_DIR / 'best.env'} and ranked.tsv")
    print(f"dashboard: optuna-dashboard {config.STUDY_DB}")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="Bayesian-tune the vLLM serving config for the SkySpy assistant.")
    ap.add_argument("--n-trials", type=int, default=config.DEFAULT_N_TRIALS, help="Stage-B BO trials")
    ap.add_argument("--dry-run", action="store_true", help="one baseline trial for --model, print reward, exit")
    ap.add_argument("--model", type=str, default="", help="model id for --dry-run")
    ap.add_argument("--skip-screen", action="store_true", help="skip Stage A; use all enabled models as survivors")
    ap.add_argument(
        "--resume",
        action="store_true",
        help="skip Stage A; reuse survivors + speed refs from a prior stage_a_screen.json and "
        "continue the checkpointed Optuna study",
    )
    args = ap.parse_args()
    config.ensure_dirs()

    if args.dry_run:
        model = get_model(args.model) if args.model else load_models()[0]
        log.info("dry-run baseline for %s", model.id)
        # self-referential refs → speed score ~1.0, just proves the pipeline
        result = evaluate(baseline(model), refs=(1.0, 1.0))
        print(json.dumps({k: v for k, v in result.items() if k not in ("summary", "perf")}, indent=2))
        return

    if args.resume:
        rep = json.loads((config.RESULTS_DIR / "stage_a_screen.json").read_text())
        survivors = [get_model(mid) for mid in rep["survivors"]]
        refs = (rep["refs"]["throughput_tok_s"], rep["refs"]["latency_tok_s"])
        log.info("resume: survivors=%s refs=(%.1f, %.1f)", [m.id for m in survivors], *refs)
    elif args.skip_screen:
        survivors = load_models()
        refs = (config.REWARD.ref_throughput_tok_s or 1.0, config.REWARD.ref_latency_tok_s or 1.0)
    else:
        survivors, refs = stage_a_screen(load_models())

    study = run_study(args.n_trials, survivors, refs)
    emit_best(study)


if __name__ == "__main__":
    main()
