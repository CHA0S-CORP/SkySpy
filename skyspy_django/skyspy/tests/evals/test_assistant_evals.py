"""
Real-LLM assistant evals against the Spark vLLM endpoint.

Never runs in CI: every test is marked `eval` and skips unless
ASSISTANT_EVAL_URL is set (the OpenAI-compatible base URL, e.g.
http://spark:8000/v1). Run via:

    make eval-assistant ASSISTANT_EVAL_URL=http://spark:8000/v1

Optional env: ASSISTANT_EVAL_MODEL (defaults to the served model id reported by
the endpoint / LLM_MODEL setting). Each case runs against the deterministic
seeded_world dataset; results append to a session report written to
test-results/assistant-evals/ for drift tracking across runs.
"""

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from django.test import override_settings

from skyspy.tests.evals import runner

EVAL_URL = os.environ.get("ASSISTANT_EVAL_URL", "")
EVAL_MODEL = os.environ.get("ASSISTANT_EVAL_MODEL", "")

pytestmark = [
    pytest.mark.eval,
    pytest.mark.skipif(not EVAL_URL, reason="ASSISTANT_EVAL_URL not set — real-LLM evals are opt-in"),
]

CASES = runner.load_cases()


def _eval_settings() -> dict:
    settings = {
        "ASSISTANT_ENABLED": True,
        "LLM_ENABLED": True,
        "LLM_API_URL": EVAL_URL,
        "LLM_API_KEY": os.environ.get("ASSISTANT_EVAL_API_KEY", ""),
        "ASSISTANT_TIMEOUT": int(os.environ.get("ASSISTANT_EVAL_TIMEOUT", "120")),
        "ASSISTANT_CONTEXT_WINDOW": 0,
        "ASSISTANT_CONTEXT_WINDOW_AUTO": True,
    }
    if EVAL_MODEL:
        settings["ASSISTANT_MODEL"] = EVAL_MODEL
    return settings


@pytest.fixture(scope="session")
def eval_report():
    """Session accumulator — writes the JSON report + console table at the end."""
    records = []
    yield records
    if not records:
        return
    summary = runner.summarize(records)
    out_dir = Path(os.environ.get("EVAL_REPORT_DIR", "test-results/assistant-evals"))
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out_path = out_dir / f"eval-{stamp}.json"
    out_path.write_text(
        json.dumps({"endpoint": EVAL_URL, "model": EVAL_MODEL or None, "summary": summary, "cases": records}, indent=2)
    )
    print(f"\n=== assistant eval summary ({out_path}) ===")
    print(json.dumps(summary, indent=2))
    for r in records:
        flag = "PASS" if r["passed"] else "FAIL"
        detail = ""
        if not r["passed"]:
            parts = []
            if not r["tool_pass"]:
                parts.append(f"tools={r['tools_called']}")
            if r["missing_facts"]:
                parts.append(f"missing={r['missing_facts']}")
            if r["hallucination_hits"]:
                parts.append(f"hallucinated={r['hallucination_hits']}")
            if r["format_fails"]:
                parts.append(f"format={r['format_fails']}")
            detail = " " + "; ".join(parts)
        print(f"  [{flag}] {r['id']} ({r['latency_s']}s, {r['steps']} steps){detail}")


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_assistant_eval(case, seeded_world, eval_report):
    with override_settings(**_eval_settings()):
        record = runner.run_case(case)
    eval_report.append(record)
    assert record["status"] == "ok", f"agent status {record['status']}: {record['answer_excerpt']}"
    assert record["tool_pass"], f"tool selection failed — called {record['tools_called']}"
    assert not record["missing_facts"], f"answer missing {record['missing_facts']}: {record['answer_excerpt']}"
    assert not record["hallucination_hits"], f"hallucinated {record['hallucination_hits']}: {record['answer_excerpt']}"
    assert not record["format_fails"], f"format violations {record['format_fails']}"
