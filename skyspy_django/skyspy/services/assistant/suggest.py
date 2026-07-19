"""
Suggested next prompts — a SEPARATE, tool-free LLM context from the main agent.

The tool-calling agent (``agent.py``) answers questions; this module runs an
independent lightweight completion whose only job is to propose 2-4 short
follow-up questions the user might ask next, given the conversation so far. It
shares the OpenAI-compatible endpoint but NOT the agent's system prompt, tools,
or context window — so generating suggestions can never call a tool, spend the
agent's step budget, or pollute the answer context.

Public API:
- ``suggest_next_prompts(history, context=None)`` — returns list[str] (never raises)
"""

import json
import logging
import re

from django.conf import settings

from skyspy.services.assistant.agent import _normalize_history, compact_mode, is_available

logger = logging.getLogger(__name__)

# How many suggestions to return, and a per-suggestion length guard.
_COUNT = 4
_MAX_LEN = 90

SUGGEST_SYSTEM_PROMPT = (
    "You suggest what the user could usefully ask NEXT in a conversation with "
    "SkySpy's aircraft-tracking analytics assistant (it can look up airframes, "
    "live traffic, safety events, ACARS, weather/NOTAMs, flight patterns and "
    "surveillance/law-enforcement aircraft).\n"
    "Given the conversation, propose short, specific follow-up questions that "
    "build naturally on what was just discussed — drill deeper, pivot to a "
    "related angle, or ask for a chart/map/photo of the same subject. Reuse the "
    "concrete entities already mentioned (tail numbers, hex codes, airports, "
    "operators) rather than inventing new ones.\n"
    "Rules: each suggestion is a single question the user would type, under 12 "
    "words, no numbering or quotes. Do not repeat a question already asked.\n"
    f"Respond with ONLY a JSON array of {_COUNT} strings, nothing else."
)


def _build_llm():
    """A minimal chat client for suggestions — no tools, small + cheap."""
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        base_url=getattr(settings, "LLM_API_URL", None),
        api_key=getattr(settings, "LLM_API_KEY", "") or "sk-noauth",
        model=getattr(settings, "ASSISTANT_MODEL", None) or settings.LLM_MODEL,
        temperature=0.7,  # a little variety in the proposed questions
        max_tokens=200,
        timeout=getattr(settings, "ASSISTANT_TIMEOUT", 60),
        max_retries=1,
    )


def _render_conversation(history) -> str:
    """Compact transcript of the recent turns for the suggestion prompt."""
    turns = _normalize_history(history)
    if not turns:
        return ""
    lines = [f"{'User' if t['role'] == 'user' else 'Assistant'}: {t['content']}" for t in turns]
    return "\n".join(lines)


# Keys a model might wrap a suggestion string under when it ignores "array of
# strings" and returns objects instead (e.g. [{"suggestion": "..."}]).
_STRING_KEYS = ("suggestion", "question", "prompt", "text", "q", "suggestions")
# Keys a model might use for the top-level list when it wraps in an object.
_LIST_KEYS = ("suggestions", "questions", "prompts", "next", "items")


def _coerce_item(x) -> str | None:
    """Pull a plain question string out of a str or a wrapper object."""
    if isinstance(x, str):
        return x
    if isinstance(x, dict):
        for k in _STRING_KEYS:
            v = x.get(k)
            if isinstance(v, str):
                return v
        # Otherwise take the first string value present.
        for v in x.values():
            if isinstance(v, str):
                return v
    return None


def _parse_suggestions(text: str) -> list[str]:
    """Extract a clean list of short questions from (often messy) model output.

    Handles a bare JSON array of strings, an array of wrapper objects, an object
    with a list under a known key, or a plain bulleted/numbered list.
    """
    text = (text or "").strip()
    items: list[str] = []

    # Preferred path: a JSON array or object somewhere in the response.
    match = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            # Prefer a known key, else the first list value in the object
            # (models wrap under all sorts of keys: next_questions, results, …).
            picked = next((parsed[k] for k in _LIST_KEYS if isinstance(parsed.get(k), list)), None)
            if picked is None:
                picked = next((v for v in parsed.values() if isinstance(v, list)), None)
            if picked is not None:
                parsed = picked
        if isinstance(parsed, list):
            items = [c for c in (_coerce_item(x) for x in parsed) if c]

    # Fallback: one suggestion per line, stripped of bullets/numbering.
    if not items:
        for line in text.splitlines():
            cleaned = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip().strip('"')
            if cleaned and not cleaned.startswith(("{", "[")):
                items.append(cleaned)

    out: list[str] = []
    seen = set()
    for raw in items:
        s = raw.strip().strip('"').strip()
        if not s or len(s) > _MAX_LEN:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= _COUNT:
            break
    return out


def suggest_next_prompts(history, context: str | None = None) -> list[str]:
    """Propose follow-up questions for the current conversation. Never raises.

    ``history`` is the prior conversation ([{role, content}, ...]); ``context``
    is optional background about the page the user is viewing. Returns [] when
    the assistant is unavailable, there is no conversation yet, or on any error.
    """
    if not is_available():
        return []
    conversation = _render_conversation(history)
    if not conversation:
        return []

    user_parts = [f"Conversation so far:\n{conversation}"]
    if context and not compact_mode():
        user_parts.append(f"\nThe user is currently viewing:\n{str(context)[:800]}")
    user_parts.append("\nSuggest the next questions.")

    try:
        llm = _build_llm()
        result = llm.invoke(
            [
                {"role": "system", "content": SUGGEST_SYSTEM_PROMPT},
                {"role": "user", "content": "".join(user_parts)},
            ]
        )
        content = getattr(result, "content", "")
        if isinstance(content, list):  # some providers return content blocks
            content = " ".join(str(c) for c in content)
        return _parse_suggestions(content)
    except Exception as e:  # broad: LLM/endpoint failure modes are unknowable
        logger.warning(f"assistant.suggest failed: {type(e).__name__}: {e}")
        return []
