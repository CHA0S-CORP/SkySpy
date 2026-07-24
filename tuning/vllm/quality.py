"""
Quality signal: run the golden assistant eval suite against the trial's endpoint
and return its summary.

Reuses the existing `make eval-assistant` target (runs the 16 golden cases
through the REAL agent in the repo's test compose stack, writing a JSON report to
test-results/assistant-evals/). We shell out, then read the newest report.
"""

from __future__ import annotations

import json
import subprocess

from . import config


class QualityError(RuntimeError):
    pass


def _reports() -> set:
    return set(config.EVAL_REPORT_DIR.glob("eval-*.json"))


def run_quality(model_id: str) -> dict:
    """Return the eval `summary` dict:
    {total, passed, pass_rate, tool_selection_rate, hallucination_cases,
     format_fail_cases, avg_latency_s, avg_steps}.

    Raises QualityError if the suite can't run (so the trial gets the fail
    sentinel rather than a misleading 0).
    """
    config.EVAL_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    before = _reports()

    cmd = [
        "make",
        "eval-assistant",
        f"ASSISTANT_EVAL_URL={config.EVAL_ENDPOINT}",
        f"ASSISTANT_EVAL_MODEL={model_id}",
        f"ASSISTANT_EVAL_TIMEOUT={config.EVAL_TIMEOUT_S}",
    ]
    proc = subprocess.run(
        cmd,
        cwd=config.REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=config.EVAL_TIMEOUT_S * 20,
    )

    # The report this run wrote is whatever appeared since `before`.
    new = _reports() - before
    if not new:
        raise QualityError(
            f"no eval report produced (rc={proc.returncode})\n{proc.stdout[-2000:]}\n{proc.stderr[-1000:]}"
        )
    report = json.loads(max(new, key=lambda p: p.stat().st_mtime).read_text())
    return report["summary"]
