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
    "airframe questions (owners, trusts, shell companies, types), and the other "
    "semantic_* search tools to FIND content by topic/meaning rather than by an "
    "exact id: semantic_acars_search over datalink message text, "
    "semantic_notam_search over NOTAMs, semantic_pirep_search over pilot reports, "
    "and semantic_event_search over past safety events + NTSB incident history "
    "(use it for 'have we seen … before' / 'prior accidents like …' questions). "
    "For open-ended 'find something interesting/unusual in the ACARS' asks with no "
    "specific search term, call notable_acars_messages (it ranks by anomaly "
    "keywords, free-text and rarity) instead of semantic search. "
    "Reach for the counts/recency tools (acars_summary, airport_notams, "
    "recent_pireps) when the ask is 'how many' or 'at airport X', not 'about'.\n"
    "- Cite ICAO hex codes and the numbers the tools return. If a tool returns "
    "an error or no data, say so plainly rather than guessing.\n"
    "- Never invent the meaning of a code (ACARS label, squawk, category). Use "
    "the name/description a tool returns; if none is given, report the raw code "
    "without explaining it. (e.g. ACARS label 'H1' is an HF datalink/position "
    "message, NOT a 'heartbeat'.)\n"
    "- Be concise: a direct answer first, then brief supporting detail.\n"
    "\n"
    "INSIGHT: Don't just report a single number — surface what's INTERESTING. When "
    "it helps, chain tools and synthesize across them: compare the current window "
    "to a baseline (time_comparison, or platform_activity over a longer span) and "
    "say whether it's high/low/normal; look for statistical relationships with "
    "metric_correlations (Pearson r over telemetry — |r|>0.5 notable, >0.8 strong; "
    "leave the fields empty to scan the whole matrix); flag anomalies, outliers and "
    "rare/military/law-enforcement/surveillance traffic proactively. State what is "
    "unusual and why, not only what happened.\n"
    "- Behavior & detection tools: metric_correlations (relationships in "
    "telemetry), aircraft_track (an aircraft's flown path + orbit/loiter/climb/"
    "descent flags — renders a map), identify_law_enforcement (police/gov/"
    "surveillance classification by hex/callsign/tail), threat_assessment (live "
    "traffic closing on/loitering over the receiver). Use aircraft_track for 'is "
    "anything orbiting/holding/loitering' and identify_law_enforcement/"
    "threat_assessment for 'is this/anything a police or surveillance aircraft'.\n"
    "- Example synthesis — 'anything unusual tonight?': call platform_activity + "
    "time_comparison (vs baseline), find_safety_events (emergencies), and "
    "metric_correlations (odd telemetry); then lead with the one or two genuinely "
    "notable findings, each with its number.\n"
    "\n"
    "FORMATTING: Write your answer in GitHub-flavored Markdown. Use **bold** for "
    "key figures, bullet lists for multiple items, and Markdown tables when "
    "comparing rows of data. Keep it clean and scannable.\n"
    "\n"
    "PHOTOS: When the user asks what an aircraft looks like (or a photo would help "
    "identify it), call fetch_airframe_photo. The app renders the image itself "
    "from that tool call — do NOT write a Markdown image, an image URL, or any "
    "http link to a photo. Just say the photo is shown and, if the tool returns "
    "them, credit the photographer/source in one short caption line. If it "
    "returns an error, say no photo is available rather than inventing one.\n"
    "\n"
    "CHARTS: When the data is naturally visual (a trend over time, a breakdown by "
    "category, a ranking, or a distribution), include a chart by emitting a fenced "
    "code block with the language `chart` containing a single JSON object. Put it "
    "after the relevant text. Schema:\n"
    "```chart\n"
    '{"type":"bar|hbar|line|area|pie|scatter","title":"Short title","xKey":"label",'
    '"series":[{"name":"Sightings","key":"value"}],'
    '"data":[{"label":"KSEA","value":123},{"label":"KBFI","value":88}]}\n'
    "```\n"
    "Choosing a type: `line`/`area` for time series (use acars_timeline / "
    "time_comparison data); `bar` for a few categories; `hbar` (horizontal) for "
    "rankings/top-N where labels are long (operators, types, airports); `pie` for "
    "parts of a whole (single series); `scatter` for the relationship between two "
    "numeric fields (set xKey to the numeric x field and one series `key` to the y "
    "field, e.g. distance vs altitude). Rules: only use real numbers returned by "
    "tools; `data` rows are objects keyed by `xKey` plus each series `key`. Emit at "
    "most one or two charts, and only when they add insight — never for a single "
    "number. Still give the text answer as well.\n"
    "\n"
    "BREAKDOWN BLOCKS: For richer summaries you can also emit these fenced blocks, "
    "each a single JSON object (same rules as charts: real tool numbers only, at "
    "most one or two per answer, and still give the prose answer). Put the block "
    "after the relevant text.\n"
    "- `stats` — a grid of KPI cards for an at-a-glance summary:\n"
    "```stats\n"
    '{"title":"Last 24h","cards":[{"label":"Aircraft","value":1823,"sub":"unique","delta":12.5},'
    '{"label":"Military","value":46,"tone":"warn"},{"label":"Emergencies","value":0,"tone":"ok"}]}\n'
    "```\n"
    "  Each card: label, value (number or short string); optional sub (sublabel), "
    "delta (percent change, shows ▲/▼), tone (ok|info|warn|danger).\n"
    "- `timeline` — a chronological list of events (sightings, safety events, steps):\n"
    "```timeline\n"
    '{"title":"Safety events","events":[{"time":"14:32Z","title":"TCAS RA","desc":"UAL123 vs SWA88","tone":"danger"},'
    '{"time":"13:10Z","title":"Squawk 7700","tone":"warn"}]}\n'
    "```\n"
    "- `compare` — side-by-side comparison across attributes (richer than a table):\n"
    "```compare\n"
    '{"title":"Type comparison","attributes":["Range","Seats","Cruise"],'
    '"items":[{"name":"A320","values":["3300 nm","150","450 kt"]},'
    '{"name":"B737","values":["3500 nm","162","453 kt"]}]}\n'
    "```\n"
    "  attributes = the row labels; each item has name + values aligned to attributes.\n"
    "- `callout` — a highlighted box for a key takeaway or warning, optional steps:\n"
    "```callout\n"
    '{"tone":"warn","title":"Heads up","body":"3 aircraft squawking 7600 in the last hour.",'
    '"steps":["Check the safety log","Confirm on the map"]}\n'
    "```\n"
    "When to reach for them (prefer a block over a plain sentence/list here): "
    "whenever your answer reports several related figures, use a `stats` grid "
    "instead of listing them in prose; for anything ordered in time (recent "
    "events, a sequence of sightings, steps) use a `timeline`; when contrasting "
    "2+ aircraft/types/airports use `compare`; for one standout takeaway or a "
    "short procedure use a `callout`. Emit the block AND a one-line prose lead-in. "
    "Aim to include at least one chart or breakdown block whenever the answer is "
    "more than a single figure — but never wrap a lone number in one.\n"
    "\n"
    "MAPS: When the question is about WHERE aircraft (or PIREPs) are, call "
    "live_aircraft_map (or recent_pireps) — the app renders the map from the tool "
    "call using the exact coordinates. To map specific aircraft, call "
    "live_aircraft_map with callsigns='UAL1,SWA2' and/or hexes='A9A397,AE1234'. Do "
    "NOT write a ```map block or type any lat/lon yourself — hand-authored "
    "coordinates put the map in the wrong place. Just call the tool and briefly "
    "describe what's shown.\n"
    "\n"
    "LINKING: Make entities and views clickable with Markdown links using the "
    "app's hash routes. Aircraft: [CALLSIGN](#airframe?icao=HEX) when you know the "
    "hex, else #airframe?call=CALLSIGN or #airframe?tail=REGISTRATION. Screens: "
    "safety events [here](#history?data=safety), ACARS [log](#history?data=acars), "
    "NOTAMs (#history?data=notams), PIREPs (#history?data=pireps), the live "
    "[map](#map), and [analytics](#analytics). Bare ICAO hex / callsigns / tail "
    "numbers in your text are auto-linked, so you don't have to link every "
    "mention — but do link the key ones and any 'see the …' page references."
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


# Cap injected page context so a huge DOM snapshot can't blow the context window.
_MAX_CONTEXT_CHARS = 4000

# Conversation-memory caps (how many prior turns to carry + per-message cap) are
# overridable via ASSISTANT_MAX_HISTORY_MSGS / ASSISTANT_MAX_HISTORY_CHARS so
# large-context models can carry longer chats.
_DEFAULT_MAX_HISTORY_MSGS = 16
_DEFAULT_MAX_HISTORY_CHARS = 3000


def _normalize_history(history) -> list[dict]:
    """Sanitize client-supplied prior turns into a clean [{role, content}] list.

    Keeps only user/assistant turns with non-empty text, trims each, and caps the
    number carried so a long chat can't blow the model's context window.
    """
    if not isinstance(history, list):
        return []
    max_msgs = int(getattr(settings, "ASSISTANT_MAX_HISTORY_MSGS", _DEFAULT_MAX_HISTORY_MSGS))
    max_chars = int(getattr(settings, "ASSISTANT_MAX_HISTORY_CHARS", _DEFAULT_MAX_HISTORY_CHARS))
    out = []
    for m in history[-max_msgs:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        out.append({"role": role, "content": content[:max_chars]})
    return out


def _build_messages(query: str, context: str | None, history) -> list[dict]:
    """Prior turns + the current (context-folded) user turn, for the agent graph."""
    messages = _normalize_history(history)
    messages.append({"role": "user", "content": _compose_query(query, context)})
    return messages


# Cap + short cache for the auto-injected live-situation briefing.
_MAX_BRIEFING_CHARS = 1500
_BRIEFING_CACHE_KEY = "assistant:situation_briefing"
_BRIEFING_TTL = 20  # seconds


def _situation_briefing() -> str:
    """A compact snapshot of the live picture, injected so every answer is grounded
    without spending a tool round-trip. Best-effort and cached briefly; returns ""
    when disabled or unavailable (never raises)."""
    if not getattr(settings, "ASSISTANT_BRIEFING_ENABLED", True):
        return ""
    try:
        from django.core.cache import cache

        cached = cache.get(_BRIEFING_CACHE_KEY)
        if cached is not None:
            return cached

        from skyspy.services import stats_cache

        stats = stats_cache.get_aircraft_stats() or {}
        safety = stats_cache.calculate_safety_stats(1) or {}
        top = stats_cache.get_top_aircraft() or {}
        snapshot = {
            "now_tracked": stats.get("total") or stats.get("aircraft_count"),
            "with_position": stats.get("with_position"),
            "military": stats.get("military"),
            "emergency": stats.get("emergency"),
            "safety_events_last_hour": safety.get("total") or safety.get("total_events"),
            "closest": (top.get("closest") or {}).get("callsign") if isinstance(top.get("closest"), dict) else None,
        }
        # Drop empty keys so the block stays terse.
        snapshot = {k: v for k, v in snapshot.items() if v not in (None, "")}
        text = json.dumps(snapshot, default=str, separators=(",", ":"))[:_MAX_BRIEFING_CHARS] if snapshot else ""
        cache.set(_BRIEFING_CACHE_KEY, text, _BRIEFING_TTL)
        return text
    except Exception as e:  # broad: briefing is a best-effort grounding hint, never fatal
        logger.debug(f"situation briefing unavailable: {type(e).__name__}: {e}")
        return ""


def _compose_query(query: str, context: str | None) -> str:
    """Fold the live-situation briefing + optional page context into the user turn
    as clearly-delimited background."""
    parts = []
    briefing = _situation_briefing()
    if briefing:
        parts.append(
            "[Live situation snapshot for grounding — current as of this request. "
            "Use it as background; call tools for anything specific or historical.]\n"
            f"<live_situation>\n{briefing}\n</live_situation>"
        )
    context = (context or "").strip()
    if context:
        context = context[:_MAX_CONTEXT_CHARS]
        parts.append(
            "[The user is currently viewing a page in the SkySpy app. Use the page "
            "context below as background — they may or may not be asking about it. "
            "Prefer your tools for authoritative data; treat the snapshot as a hint "
            "about what they're looking at.]\n"
            f"<page_context>\n{context}\n</page_context>"
        )
    if not parts:
        return query
    return "\n\n".join(parts) + f"\n\nUser question: {query}"


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


_PHOTO_TOOL = "fetch_airframe_photo"


def _photo_src(icao_hex: str) -> str:
    """Deterministic <img> src for an airframe photo (never model-generated).

    Resolution order:
    1. Explicit ASSISTANT_PHOTO_BASE_URL override → <base>/<HEX>.jpg
    2. S3 enabled → a signed (presigned) URL for the object, generated from the
       S3 config — works with private buckets and needs no separate setting.
    3. Otherwise → same-origin /api/v1/photos/<hex> (streams the cached image).
    """
    hex_code = (icao_hex or "").upper()
    base = (getattr(settings, "ASSISTANT_PHOTO_BASE_URL", "") or "").strip()
    if base:
        return f"{base.rstrip('/')}/{hex_code}.jpg"
    if getattr(settings, "S3_ENABLED", False):
        from skyspy.services.photo_cache import get_signed_photo_url

        signed = get_signed_photo_url(hex_code)
        if signed:
            return signed
    return f"/api/v1/photos/{hex_code}"


def _photo_from_obs(obs: str) -> dict | None:
    """Build a photo render payload from a fetch_airframe_photo observation."""
    try:
        data = json.loads(obs)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or data.get("error"):
        return None
    icao = data.get("icao_hex")
    if not icao:
        return None
    return {
        "src": _photo_src(icao),
        "alt": data.get("registration") or data.get("label") or icao,
        "photographer": data.get("photographer"),
        "source": data.get("source"),
    }


def _extract_photos(messages) -> list[dict]:
    """Photo render payloads for each successful fetch_airframe_photo call."""
    photos = []
    for name, obs, _args in _tool_messages(messages):
        if name == _PHOTO_TOOL:
            photo = _photo_from_obs(obs)
            if photo:
                photos.append(photo)
    return photos


_MAP_TOOLS = ("live_aircraft_map", "recent_pireps", "aircraft_track")


def _map_from_obs(name: str, obs: str) -> dict | None:
    """Build a map render payload (real coords) from a map-tool observation.

    The coordinates come straight from the tool, never from model-authored JSON —
    the model used to round/hallucinate them into a ```map block, putting the map
    in the wrong place.
    """
    try:
        data = json.loads(obs)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None

    points = []
    if name == "live_aircraft_map":
        title = "Live traffic"
        for a in data.get("aircraft") or []:
            lat, lon = a.get("lat"), a.get("lon")
            if lat is None or lon is None:
                continue
            points.append(
                {
                    "lat": lat,
                    "lon": lon,
                    "hex": a.get("hex"),
                    "callsign": a.get("callsign"),
                    "track": a.get("track"),
                    "altitude": a.get("altitude"),
                    "distance_nm": a.get("distance_nm"),
                    "military": bool(a.get("military")),
                    "kind": "aircraft",
                }
            )
    elif name == "recent_pireps":
        title = "Recent PIREPs"
        for p in data.get("pireps") or []:
            lat, lon = p.get("lat"), p.get("lon")
            if lat is None or lon is None:
                continue
            points.append(
                {
                    "lat": lat,
                    "lon": lon,
                    "label": p.get("location"),
                    "altitude": p.get("flight_level"),
                    "kind": "pirep",
                }
            )
    elif name == "aircraft_track":
        # An ordered flown path — rendered as a connected polyline, not markers.
        title = f"Track {data.get('icao_hex') or data.get('identifier') or ''}".strip()
        for p in data.get("track") or []:
            lat, lon = p.get("lat"), p.get("lon")
            if lat is None or lon is None:
                continue
            points.append(
                {
                    "lat": lat,
                    "lon": lon,
                    "altitude": p.get("altitude"),
                    "track": p.get("track"),
                    "kind": "track",
                }
            )
        if not points:
            return None
        return {"title": title, "points": points, "polyline": True}
    else:
        return None

    if not points:
        return None
    return {"title": title, "points": points}


def _extract_maps(messages) -> list[dict]:
    """Map render payloads for each map-tool call that returned positioned points."""
    maps = []
    for name, obs, _args in _tool_messages(messages):
        if name in _MAP_TOOLS:
            m = _map_from_obs(name, obs)
            if m:
                maps.append(m)
    return maps


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


def ask(query: str, context: str | None = None, history=None) -> dict:
    """
    Answer a question with the tool-calling agent (synchronous).

    ``context`` is optional background about the page the user is viewing.
    ``history`` is the prior conversation ([{role, content}, ...]) so the agent
    remembers earlier turns. Returns {answer, steps, sources, status}. Never raises.
    """
    query = (query or "").strip()
    if not query:
        return {"answer": None, "steps": [], "sources": [], "status": "empty_query"}
    if not is_available():
        return {"answer": None, "steps": [], "sources": [], "status": "unavailable"}

    try:
        graph = _build_agent()
        result = graph.invoke(
            {"messages": _build_messages(query, context, history)},
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
        "photos": _extract_photos(messages),
        "maps": _extract_maps(messages),
        "status": "ok",
    }


async def astream(query: str, context: str | None = None, history=None):
    """
    Async generator of streaming events for SSE:
      {"type": "tool", "tool", "args"} | {"type": "token", "text"} |
      {"type": "photo", "src", "alt", "photographer", "source"} |
      {"type": "map", "title", "points"} |
      {"type": "final", "answer", "sources", "photos", "maps"} | {"type": "error"|"unavailable"}

    ``context`` is optional page background; ``history`` is the prior conversation
    ([{role, content}, ...]) so the agent remembers earlier turns.
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

    final_text, seen_sources, sources, photos, maps = [], set(), [], [], []
    try:
        async for event in graph.astream_events(
            {"messages": _build_messages(query, context, history)},
            version="v2",
            config={"recursion_limit": _recursion_limit()},
        ):
            kind = event.get("event")
            if kind == "on_tool_start":
                yield {"type": "tool", "tool": event.get("name"), "args": event.get("data", {}).get("input")}
            elif kind == "on_tool_end":
                obs = _as_str(_obs_output(event))
                # Render airframe photos from the tool call itself (deterministic,
                # server-templated src) instead of trusting a model-emitted URL.
                tool_name = event.get("name")
                if tool_name == _PHOTO_TOOL:
                    photo = _photo_from_obs(obs)
                    if photo:
                        photos.append(photo)
                        yield {"type": "photo", **photo}
                # Render maps from the tool call (exact coords) instead of trusting
                # a model-authored ```map block with rounded/invented coordinates.
                if tool_name in _MAP_TOOLS:
                    m = _map_from_obs(tool_name, obs)
                    if m:
                        maps.append(m)
                        yield {"type": "map", **m}
                for s in _sources_from_obs(obs):
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

    yield {
        "type": "final",
        "answer": "".join(final_text),
        "sources": sources,
        "photos": photos,
        "maps": maps,
    }


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
