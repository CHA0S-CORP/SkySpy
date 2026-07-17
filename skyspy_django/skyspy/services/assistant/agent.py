"""
The assistant agent: a LangChain (1.x) tool-calling agent over the read-only
tools in ``tools.py``, backed by any OpenAI-compatible chat model (vLLM in prod,
OpenAI/Ollama in dev via ``LLM_API_URL``).

Public API:
- ``is_available()`` — gated by ASSISTANT_ENABLED + LLM_ENABLED + endpoint config
- ``ask(query)`` — synchronous: returns {answer, steps, sources, status}
- ``astream(query)`` — async generator of {type, ...} events for SSE streaming

Uses LangChain 1.x ``create_agent`` (a LangGraph graph). All LangChain imports
are local to this module so the rest of the codebase stays LangChain-free.
"""

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are SkySpy's analytics assistant. You answer questions about tracked "
    "aircraft and platform activity by calling the provided tools and reasoning "
    "over their results. Rules:\n"
    "- Use tools for any facts; never invent numbers, registrations, or events.\n"
    "- Prefer the most specific tool. Use semantic_airframe_search for fuzzy "
    "airframe questions (owners, trusts, shell companies, types).\n"
    "- Cite ICAO hex codes and the numbers the tools return. If a tool returns "
    "an error or no data, say so plainly rather than guessing.\n"
    "- Be concise: a direct answer first, then brief supporting detail."
)


def is_available() -> bool:
    """True when the assistant is enabled and an LLM endpoint is configured."""
    if not (getattr(settings, "ASSISTANT_ENABLED", False) and getattr(settings, "LLM_ENABLED", False)):
        return False
    api_url = getattr(settings, "LLM_API_URL", "")
    api_key = getattr(settings, "LLM_API_KEY", "")
    # A key is required unless pointing at a local endpoint (vLLM/Ollama).
    return bool(api_key or "localhost" in api_url or "127.0.0.1" in api_url or "vllm" in api_url or "ollama" in api_url)


def _recursion_limit() -> int:
    # Each tool round is ~2 graph steps (model call + tool). Leave headroom.
    return getattr(settings, "ASSISTANT_MAX_STEPS", 6) * 2 + 2


def _build_agent():
    """Construct the LangGraph tool-calling agent (raises on bad config)."""
    from langchain.agents import create_agent
    from langchain_openai import ChatOpenAI

    from skyspy.services.assistant.tools import get_tools

    llm = ChatOpenAI(
        base_url=getattr(settings, "LLM_API_URL", None),
        api_key=getattr(settings, "LLM_API_KEY", "") or "sk-noauth",
        model=getattr(settings, "ASSISTANT_MODEL", None) or settings.LLM_MODEL,
        temperature=0,
        timeout=getattr(settings, "ASSISTANT_TIMEOUT", 60),
        max_retries=1,
    )
    return create_agent(llm, get_tools(), system_prompt=SYSTEM_PROMPT)


def _as_str(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # some models return content parts
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content)


def _tool_messages(messages):
    """Yield (tool_name, observation_str, args) for each ToolMessage in order."""
    # Map tool_call_id -> (name, args) from the AIMessages that requested them.
    call_args = {}
    for m in messages:
        for tc in getattr(m, "tool_calls", None) or []:
            call_args[tc.get("id")] = (tc.get("name"), tc.get("args", {}))
    for m in messages:
        if m.__class__.__name__ == "ToolMessage":
            name = getattr(m, "name", None) or call_args.get(getattr(m, "tool_call_id", None), (None, {}))[0]
            args = call_args.get(getattr(m, "tool_call_id", None), (name, {}))[1]
            yield name, _as_str(getattr(m, "content", "")), args


def _extract_sources(messages) -> list[dict]:
    """Pull cited airframes (icao/registration) out of tool observations."""
    sources, seen = [], set()
    for _name, obs, _args in _tool_messages(messages):
        try:
            data = json.loads(obs)
        except (ValueError, TypeError):
            continue
        candidates = data.get("results") or [data] if isinstance(data, dict) else []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            icao, reg = item.get("icao_hex"), item.get("registration")
            key = icao or reg
            if key and key not in seen:
                seen.add(key)
                sources.append({"icao_hex": icao, "registration": reg})
    return sources


def _summarize_steps(messages) -> list[dict]:
    """Compact trace of which tools ran with what args (result trimmed)."""
    return [{"tool": name, "args": args, "result_preview": obs[:200]} for name, obs, args in _tool_messages(messages)]


def ask(query: str) -> dict:
    """
    Answer a question with the tool-calling agent (synchronous).

    Returns {answer, steps, sources, status}. Never raises.
    """
    query = (query or "").strip()
    if not query:
        return {"answer": None, "steps": [], "sources": [], "status": "empty_query"}
    if not is_available():
        return {"answer": None, "steps": [], "sources": [], "status": "unavailable"}

    try:
        graph = _build_agent()
        result = graph.invoke(
            {"messages": [{"role": "user", "content": query}]},
            config={"recursion_limit": _recursion_limit()},
        )
    except Exception as e:  # broad: agent/LLM/endpoint failure modes are unknowable
        logger.warning(f"assistant.ask failed: {type(e).__name__}: {e}")
        return {"answer": None, "steps": [], "sources": [], "status": "error", "error": str(e)}

    messages = result.get("messages", [])
    answer = _as_str(getattr(messages[-1], "content", "")) if messages else None
    return {
        "answer": answer,
        "steps": _summarize_steps(messages),
        "sources": _extract_sources(messages),
        "status": "ok",
    }


async def astream(query: str):
    """
    Async generator of streaming events for SSE:
      {"type": "tool", "tool", "args"} | {"type": "token", "text"} |
      {"type": "final", "answer", "sources"} | {"type": "error"|"unavailable"}
    """
    query = (query or "").strip()
    if not query:
        yield {"type": "error", "message": "empty query"}
        return
    if not is_available():
        yield {"type": "unavailable"}
        return

    try:
        graph = _build_agent()
    except Exception as e:  # broad: construction can fail on bad config
        logger.warning(f"assistant.astream build failed: {type(e).__name__}: {e}")
        yield {"type": "error", "message": str(e)}
        return

    final_text, seen_sources, sources = [], set(), []
    try:
        async for event in graph.astream_events(
            {"messages": [{"role": "user", "content": query}]},
            version="v2",
            config={"recursion_limit": _recursion_limit()},
        ):
            kind = event.get("event")
            if kind == "on_tool_start":
                yield {"type": "tool", "tool": event.get("name"), "args": event.get("data", {}).get("input")}
            elif kind == "on_tool_end":
                for s in _sources_from_obs(_as_str(_obs_output(event))):
                    key = s.get("icao_hex") or s.get("registration")
                    if key and key not in seen_sources:
                        seen_sources.add(key)
                        sources.append(s)
            elif kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                text = _as_str(getattr(chunk, "content", "")) if chunk is not None else ""
                if text:
                    final_text.append(text)
                    yield {"type": "token", "text": text}
    except Exception as e:  # broad: streaming loop must end cleanly
        logger.warning(f"assistant.astream failed: {type(e).__name__}: {e}")
        yield {"type": "error", "message": str(e)}
        return

    yield {"type": "final", "answer": "".join(final_text), "sources": sources}


def _obs_output(event):
    out = event.get("data", {}).get("output")
    return getattr(out, "content", out)


def _sources_from_obs(obs: str) -> list[dict]:
    try:
        data = json.loads(obs)
    except (ValueError, TypeError):
        return []
    candidates = data.get("results") or [data] if isinstance(data, dict) else []
    result = []
    for item in candidates:
        if isinstance(item, dict) and (item.get("icao_hex") or item.get("registration")):
            result.append({"icao_hex": item.get("icao_hex"), "registration": item.get("registration")})
    return result
