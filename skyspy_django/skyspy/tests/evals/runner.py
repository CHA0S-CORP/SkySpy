"""
Eval runner: load golden cases, run them through the REAL agent, score the
results. No LLM mocking here — this module is only imported by the eval-marked
tests, which skip entirely unless ASSISTANT_EVAL_URL is set.

Scoring dimensions per case:
- tool selection: expected_tools.any_of intersects / all_of subset of the tools
  the agent actually called (from result["steps"])
- groundedness:   every must_contain entry present in the answer (an entry that
  is a list = any-of, case-insensitive)
- hallucination:  no must_not_contain entry present
- format:         no model-authored image URLs; ```chart blocks parse as JSON
- cost:           wall latency + tool-call count (+ token usage when reported)
"""

import json
import re
import time
from pathlib import Path

import yaml

GOLDEN_PATH = Path(__file__).parent / "golden" / "assistant_evals.yaml"

_IMAGE_URL_RE = re.compile(r"!\[[^\]]*\]\([^)]+\)|https?://\S+\.(?:png|jpe?g|gif|webp)", re.IGNORECASE)
_CHART_BLOCK_RE = re.compile(r"```chart\s*\n(.*?)```", re.DOTALL)


def load_cases() -> list[dict]:
    with open(GOLDEN_PATH) as f:
        return yaml.safe_load(f)


def _contains(answer_lower: str, entry) -> bool:
    if isinstance(entry, (list, tuple)):
        return any(str(alt).lower() in answer_lower for alt in entry)
    return str(entry).lower() in answer_lower


def score_case(case: dict, result: dict, latency_s: float) -> dict:
    answer = result.get("answer") or ""
    answer_lower = answer.lower()
    called = [s.get("tool") for s in result.get("steps") or []]

    expected = case.get("expected_tools") or {}
    any_of = expected.get("any_of") or []
    all_of = expected.get("all_of") or []
    tool_pass = True
    if any_of:
        tool_pass = bool(set(any_of) & set(called))
    if all_of:
        tool_pass = tool_pass and set(all_of).issubset(set(called))

    missing = [e for e in (case.get("must_contain") or []) if not _contains(answer_lower, e)]
    leaked = [e for e in (case.get("must_not_contain") or []) if _contains(answer_lower, e)]

    format_fails = []
    checks = case.get("format") or []
    if "no_image_urls" in checks and _IMAGE_URL_RE.search(answer):
        format_fails.append("no_image_urls")
    if "valid_chart_blocks" in checks:
        blocks = _CHART_BLOCK_RE.findall(answer)
        for b in blocks:
            try:
                json.loads(b.strip())
            except (ValueError, TypeError):
                format_fails.append("valid_chart_blocks")
                break

    passed = bool(
        result.get("status") == "ok" and answer and tool_pass and not missing and not leaked and not format_fails
    )
    return {
        "id": case["id"],
        "passed": passed,
        "status": result.get("status"),
        "tool_pass": tool_pass,
        "tools_called": called,
        "missing_facts": missing,
        "hallucination_hits": leaked,
        "format_fails": format_fails,
        "latency_s": round(latency_s, 2),
        "steps": len(called),
        "usage": result.get("usage"),
        "answer_excerpt": answer[:400],
    }


def run_case(case: dict) -> dict:
    """Execute one golden case against the real agent and score it."""
    from skyspy.services.assistant import agent

    start = time.monotonic()
    result = agent.ask(case["question"], history=case.get("history"))
    return score_case(case, result, time.monotonic() - start)


def summarize(records: list[dict]) -> dict:
    n = len(records)
    passed = sum(1 for r in records if r["passed"])
    return {
        "total": n,
        "passed": passed,
        "pass_rate": round(passed / n, 3) if n else 0.0,
        "tool_selection_rate": round(sum(1 for r in records if r["tool_pass"]) / n, 3) if n else 0.0,
        "hallucination_cases": sum(1 for r in records if r["hallucination_hits"]),
        "format_fail_cases": sum(1 for r in records if r["format_fails"]),
        "avg_latency_s": round(sum(r["latency_s"] for r in records) / n, 2) if n else 0.0,
        "avg_steps": round(sum(r["steps"] for r in records) / n, 1) if n else 0.0,
    }
