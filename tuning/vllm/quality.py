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


def _kill_stray_eval_containers() -> None:
    """A timed-out `make eval-assistant` leaves a `compose run` container behind
    (it's a detached child of the killed make). Remove it so it can't wedge the
    next trial's compose invocation."""
    ids = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "name=api-test"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.split()
    for cid in ids:
        subprocess.run(["docker", "rm", "-f", cid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def run_quality(model_id: str) -> dict:
    """Return the eval `summary` dict:
    {total, passed, pass_rate, tool_selection_rate, hallucination_cases,
     format_fail_cases, avg_latency_s, avg_steps}.

    Raises QualityError if the suite can't run OR hangs past the wall timeout (so
    the trial gets the fail sentinel rather than blocking the whole sweep — a hung
    pytest fixture/DB setup would otherwise stall a trial for the full timeout).
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
    try:
        proc = subprocess.run(
            cmd,
            cwd=config.REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=config.EVAL_WALL_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        _kill_stray_eval_containers()
        raise QualityError(
            f"eval hung past {config.EVAL_WALL_TIMEOUT_S}s wall timeout for {model_id} "
            f"(likely stuck in fixture/DB setup); killed and failing the trial\n{(exc.stdout or b'')!r:.500}"
        ) from exc

    # The report this run wrote is whatever appeared since `before`.
    new = _reports() - before
    if not new:
        raise QualityError(
            f"no eval report produced (rc={proc.returncode})\n{proc.stdout[-2000:]}\n{proc.stderr[-1000:]}"
        )
    report = json.loads(max(new, key=lambda p: p.stat().st_mtime).read_text())
    return report["summary"]
