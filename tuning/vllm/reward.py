"""
Blended quality+speed reward.

  quality = pass_rate - λ_h * halluc_fraction               (clipped 0..1)
  speed   = α * (throughput_N / ref_throughput)             (aggregate regime)
          + (1-α) * (single_stream_tok_s / ref_latency)     (latency regime)
  reward  = w_q*quality + w_s*speed
            * soft-guard: if quality < Q_MIN, scale reward by (quality / Q_MIN)

References are FIXED (captured from the Stage-A baseline) so the objective is
stationary — BO breaks if the reward surface shifts under it. A ratio >1 means
the config beats the baseline; ratios are capped so one metric can't dominate.

A failed launch / eval / bench yields REWARD.fail_sentinel upstream; this module
only scores successful trials.
"""

from __future__ import annotations

from . import config

RATIO_CAP = 2.0  # a single speed metric can be at most 2x baseline in the blend


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def quality_score(summary: dict) -> float:
    total = summary.get("total") or 0
    pass_rate = summary.get("pass_rate") or 0.0
    halluc = summary.get("hallucination_cases") or 0
    halluc_frac = (halluc / total) if total else 0.0
    q = pass_rate - config.REWARD.lambda_halluc * halluc_frac
    return _clip(q, 0.0, 1.0)


def extract_speed(perf: dict) -> tuple[float, float]:
    """(aggregate_throughput_tok_s, single_stream_tok_s) from a run_perf() blob.

    single-stream tok/s = 1000 / median_tpot_ms (inter-token decode rate at c=1).
    """
    concurrencies = config.BENCH_CONCURRENCIES
    cN = perf[f"c{max(concurrencies)}"]
    c1 = perf[f"c{min(concurrencies)}"]
    throughput = cN.get("output_throughput_tok_s") or 0.0
    tpot = c1.get("median_tpot_ms") or 0.0
    single_stream = (1000.0 / tpot) if tpot else 0.0
    return throughput, single_stream


def speed_score(perf: dict, ref_throughput: float, ref_latency: float) -> float:
    throughput, single_stream = extract_speed(perf)
    a = config.REWARD.alpha_speed
    r_t = _clip(throughput / ref_throughput, 0.0, RATIO_CAP) if ref_throughput else 0.0
    r_l = _clip(single_stream / ref_latency, 0.0, RATIO_CAP) if ref_latency else 0.0
    return a * r_t + (1 - a) * r_l


def blended_reward(summary: dict, perf: dict, ref_throughput: float, ref_latency: float) -> dict:
    """Return {reward, quality, speed, ...} for logging + Optuna."""
    q = quality_score(summary)
    s = speed_score(perf, ref_throughput, ref_latency)
    r = config.REWARD.w_quality * q + config.REWARD.w_speed * s
    if q < config.REWARD.q_min:
        r *= q / config.REWARD.q_min  # soft guard — fast-but-wrong can't win
    return {
        "reward": round(r, 4),
        "quality": round(q, 4),
        "speed": round(s, 4),
        "pass_rate": summary.get("pass_rate"),
        "hallucination_cases": summary.get("hallucination_cases"),
    }
