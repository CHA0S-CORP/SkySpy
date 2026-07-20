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

import asyncio
import json
import logging
import re

from django.conf import settings
from langgraph.errors import GraphRecursionError

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
    "- Aircraft identifiers: a user may give an ICAO hex (6 hex chars, e.g. "
    "AC26D7), a tail number/registration (e.g. N882SD, G-ABCD), or a live callsign "
    "(e.g. UAL123). Pass whatever they gave straight to lookup_airframe / "
    "aircraft_track / fetch_airframe_photo — those tools resolve any form to the "
    "hex themselves (US tails convert deterministically, so they resolve even if "
    "never tracked). Never call a tail number an 'ICAO hex', and don't declare an "
    "aircraft unknown just because it isn't live — try lookup_airframe first.\n"
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
    "descent flags — renders a map), detect_unusual_patterns (SCANS every recent "
    "track and ranks aircraft flying strange geometry — orbits, holding, grid/"
    "zig-zag survey lines, or the multi_orbit_survey shape of several orbits joined "
    "by long legs), identify_law_enforcement (police/gov/surveillance classification "
    "by hex/callsign/tail), threat_assessment (live traffic closing on/loitering "
    "over the receiver). Use detect_unusual_patterns for 'is anyone flying a strange/"
    "suspicious pattern' or 'anything surveying the area' (then aircraft_track to "
    "drill into one hit); aircraft_track for a NAMED aircraft's path; and "
    "identify_law_enforcement/threat_assessment for 'is this/anything a police or "
    "surveillance aircraft'; busiest_tails ranks the tail numbers that flew the most "
    "flights in a window (unique_flights = distinct callsigns, flight_legs = separate "
    "flights split on gaps) — use for 'which tail number has the most unique flights', "
    "'busiest aircraft', 'which plane flew the most today'.\n"
    "- Example synthesis — 'anything unusual tonight?': call platform_activity + "
    "time_comparison (vs baseline), find_safety_events (emergencies), and "
    "metric_correlations (odd telemetry); then lead with the one or two genuinely "
    "notable findings, each with its number.\n"
    "\n"
    "AVIATION DOMAIN CONTEXT (use to judge what is NORMAL vs genuinely noteworthy — "
    "always weigh behavior against the aircraft's CLASS):\n"
    "- General aviation (GA): light piston/turboprop singles & twins, helicopters, "
    "gliders. Usually VFR, ~80-200 kt, 1,500-12,000 ft. Orbits, figure-8s, holding, "
    "and repeated circuits near an airport or practice area are typically NORMAL — "
    "flight training, aerial photography, pipeline/traffic watch, banner tow — not a "
    "threat. ADS-B emitter categories A1 (light <15,500 lb) and A7 (rotorcraft) are "
    "almost always GA. Do NOT flag routine GA training/pattern work as suspicious.\n"
    "- Commercial air transport: airliners & cargo (categories A3/A4/A5, heavy jets). "
    "IFR, cruise ~FL280-FL410, 400-500 kt, on filed airways between airports. Steady "
    "high-altitude cruise is EXPECTED. An airliner squawking 7500/7600/7700, holding, "
    "or diverting IS notable.\n"
    "- Military: fighters/transports/tankers/ISR — special-use airspace (MOAs), "
    "refueling tracks, low-level routes, or persistent orbits over an area (ISR/"
    "tanker). Often the genuinely interesting traffic.\n"
    "- Law enforcement / surveillance: Cessnas, PC-12s, helicopters flying tight "
    "repeated orbits or grid lines over a town at ~1,500-5,000 ft AGL. Confirm with "
    "identify_law_enforcement before calling something surveillance.\n"
    "- Same geometry, different meaning: a light GA aircraft orbiting a practice area "
    "is routine; the same orbit by an airliner, or over a sensitive site, is not.\n"
    "\n"
    "FORMATTING: Write your answer in GitHub-flavored Markdown. Use **bold** for "
    "key figures, bullet lists for multiple items, and Markdown tables when "
    "comparing rows of data. Keep it clean and scannable.\n"
    "\n"
    "PHOTOS: fetch_airframe_photo is the ONLY way to show an aircraft image. Call "
    "it whenever the user wants to see a plane — 'show me', 'picture', 'photo', "
    "'image', 'what does it look like', 'let me see it' — passing the hex, tail, or "
    "callsign. Never describe a plane's appearance from memory instead of calling "
    "the tool, and never skip the call because you 'can't display images': the app "
    "renders the image itself from that tool call. Do NOT write a Markdown image, "
    "an image URL, or any http link to a photo. Just say the photo is shown and, if "
    "the tool returns them, credit the photographer/source in one short caption "
    "line. If it returns an error, say no photo is available rather than inventing "
    "one.\n"
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
    "live_aircraft_map with callsigns='UAL1,SWA2' and/or hexes='A9A397,AE1234'. "
    "threat_assessment and detect_unusual_patterns ALSO render a map of exactly the "
    "aircraft they return, each with a link to open the radar page filtered to just "
    "those aircraft — so whenever you list specific aircraft, a matching map appears "
    "automatically (no extra call needed).\n"
    "PLOT TRACKS ON RADAR: When the user wants to SEE where one or MORE aircraft "
    "flew — 'plot N882SD's track', 'show the last 3 hours of these planes on the "
    "radar', 'draw the paths of every military aircraft this morning', 'overlay "
    "their routes on the map' — call plot_tracks with a comma-separated list of "
    "hexes/tails/callsigns and an hours window. It draws each aircraft's historical "
    "flown path as its own coloured line ON THE ACTUAL RADAR SCREEN and zooms to fit "
    "them. Use aircraft_track (not plot_tracks) only for a SINGLE path with "
    "orbit/loiter/climb behaviour flags shown inline in the chat.\n"
    "RADAR FILTER: When the user wants to SEE a CATEGORY or ROLE of live traffic — "
    "'live view of law enforcement aircraft', 'show all GA aircraft', 'military "
    "traffic on the map', 'anything squawking emergency', 'show me widebodies', "
    "'helicopters nearby', 'show 737s within 50nm', 'police/surveillance nearby' — "
    "call radar_filter. It draws the map AND live-filters the actual radar screen. "
    "Pick the RIGHT argument: for a size/body/role WORD (widebody, heavy, airliner, "
    "narrowbody, light, helicopter, glider, drone) use classes='widebody' — do NOT "
    "hand-type a list of type codes, because ADS-B sends variant designators (B77W, "
    "A359, B789) that a base-code list ('B777','A350') will MISS. For an aircraft "
    "FAMILY use type_prefix (e.g. type_prefix='B73' for all 737 variants); for one "
    "exact type use types='C172'. Combine with military / law_enforcement / "
    "emergency / general_aviation / callsign_prefix / alt_min / alt_max / dist_max "
    "for complex filters. ALWAYS use this tool for these asks — NEVER hand-list "
    "aircraft or invent hex codes/callsigns; it returns the real live matches. Then "
    "briefly summarize the count and what stands out (don't re-list every row the "
    "map already shows). Do "
    "NOT write a ```map block or type any lat/lon yourself — hand-authored "
    "coordinates put the map in the wrong place. Just call the tool and briefly "
    "describe what's shown.\n"
    "\n"
    "MORE TOOLS: weather_nearby (current METAR + flight category at the receiver — "
    "'how's the weather / is it VFR here' with no airport named; use airport_weather "
    "when an airport IS named); nearby_advisories (active TFRs + SIGMETs/AIRMETs over "
    "the station — 'any flight restrictions / TFRs / advisories near me'); "
    "turbulence_forecast (turbulence risk score/level from NWS G-AIRMET + PIREP + "
    "winds-aloft shear — no args = near the receiver + which live aircraft are in "
    "moderate+ turbulence; pass lat/lon/altitude_ft for a specific point/flight "
    "level — 'is it bumpy', 'any turbulence', 'which aircraft are in turbulence'); "
    "enroute_structure (published US IFR airways + named waypoints/fixes near a "
    "point, default the receiver — 'what airways/waypoints are near me', 'which "
    "airways cross the area', or to explain a flight's routing over named fixes); "
    "aircraft_dossier (full profile of ONE aircraft — identity + this station's "
    "sighting history + incidents — for 'tell me everything about …', richer than "
    "lookup_airframe); watched_aircraft (the station's watch list + who's live now); "
    "my_alert_rules (the signed-in user's own alert rules + last-fired — 'what am I "
    "alerting on', 'did my alerts fire'); flight_schedule (scheduled airline times "
    "for a flight number — metered, may be unavailable; for a LIVE aircraft's route "
    "prefer lookup_route).\n"
    "DEVELOPER / API: when the user asks how to pull data PROGRAMMATICALLY — 'how "
    "do I get this via the API', 'REST endpoint for X', 'query the API', 'is there "
    "an API for …', 'how do I subscribe to real-time updates', 'websocket/Socket.IO "
    "format', 'what does the aircraft feed emit' — call rest_api_reference (for HTTP "
    "endpoints: path, method, params) and/or socketio_reference (for the real-time "
    "Socket.IO namespaces, subscribe topics, request/response types and broadcast "
    "events). Pass a topic keyword (e.g. 'aircraft', 'acars', 'safety', 'alerts') to "
    "narrow the result. Answer with the concrete endpoint/event names, the exact "
    "request shape, and a short code snippet — never invent an endpoint, event name, "
    "or field the tools didn't return.\n"
    "\n"
    "LINKING: Make entities and views clickable with Markdown links using the "
    "app's hash routes. Aircraft: [CALLSIGN](#airframe?icao=HEX) when you know the "
    "hex, else #airframe?call=CALLSIGN or #airframe?tail=REGISTRATION. Screens: "
    "safety events [here](#history?data=safety), ACARS [log](#history?data=acars), "
    "NOTAMs (#history?data=notams), PIREPs (#history?data=pireps), the live "
    "[map](#map), and [analytics](#analytics). Bare ICAO hex / callsigns / tail "
    "numbers in your text are auto-linked, so you don't have to link every "
    "mention — but do link the key ones and any 'see the …' page references.\n"
    "DEEP LINKS: most screens accept query params so you can link a pre-FILTERED "
    "view. Add `?` then `&`-joined key=value pairs. Useful ones: the map to a set "
    "of aircraft (#map?filter=A0E2E5,AE1234) or one selected (#map?selected=HEX); "
    "the aircraft list filtered + sorted (#aircraft?filter=military&sort=dist); "
    "stats over a window (#stats?range=24h&mil=1), range one of 1h/6h/24h/48h/7d; "
    "the history log filtered (#history?data=acars&airline=UAL, or "
    "#history?data=sessions&q=N123&mil=1); analytics axes "
    "(#analytics?x=distance_nm&y=rssi). Booleans are `=1`. For a LIVE category "
    "view still call radar_filter (it also filters the on-screen radar); use these "
    "links when you're pointing the user at a screen to explore themselves."
)


# Compact system prompt for small-context models (see ASSISTANT_CONTEXT_WINDOW).
# Keeps the load-bearing rules — never hallucinate facts/codes, resolve any
# identifier form, and let the app (not the model) render photos/maps from tool
# calls — but drops the verbose chart/breakdown/formatting example blocks that an
# 8k model can't spend tokens on anyway.
COMPACT_SYSTEM_PROMPT = (
    "You are SkySpy's analytics assistant. Answer questions about tracked "
    "aircraft and platform activity by calling the provided tools and reasoning "
    "over their results.\n"
    "- Use tools for every fact; never invent numbers, registrations, codes, or "
    "events. If a tool errors or returns no data, say so plainly.\n"
    "- Pick the most specific tool. semantic_* tools FIND content by meaning; the "
    "counts/recency tools (acars_summary, airport_notams, recent_pireps) answer "
    "'how many' / 'at airport X'.\n"
    "- Identifiers: a user may give an ICAO hex, a tail number, or a live "
    "callsign. Pass whatever they gave straight to lookup_airframe / "
    "aircraft_track / fetch_airframe_photo — those tools resolve any form to the "
    "hex. Never call a tail number an 'ICAO hex'.\n"
    "- Never invent the meaning of a code (ACARS label, squawk, category); use the "
    "name/description the tool returns, or report the raw code.\n"
    "- Photos: to show a plane ('show me', 'picture', 'photo', 'what does it look "
    "like') ALWAYS call fetch_airframe_photo with the hex/tail/callsign — it's the "
    "only way to display an image. The app renders it, so do NOT write an image URL "
    "or a Markdown image.\n"
    "- Maps: for 'where' questions call live_aircraft_map / recent_pireps / "
    "aircraft_track — the app renders the map from the tool's coordinates, so "
    "never type lat/lon yourself. To draw where one or many aircraft FLEW on the "
    "radar, call plot_tracks with a comma-separated hex/tail/callsign list.\n"
    "- Surface what's interesting (anomalies, rare/military/law-enforcement "
    "traffic, high/low vs normal), not just a lone number.\n"
    "- Links: point at screens with Markdown hash routes, incl. filtered views — "
    "#airframe?icao=HEX, #map?selected=HEX or #map?filter=HEX1,HEX2, "
    "#aircraft?filter=military&sort=dist, #stats?range=24h, "
    "#history?data=acars. Bare hex/callsign/tail auto-link.\n"
    "- API/dev questions ('how do I pull this via the API', 'REST endpoint', "
    "'websocket/Socket.IO format'): call rest_api_reference and/or "
    "socketio_reference (pass a topic keyword) and answer with the real endpoint/"
    "event names and request shape they return — never invent one.\n"
    "- Be concise: a direct answer first in GitHub-flavored Markdown, then brief "
    "supporting detail."
)

# Models at/below this context window (tokens) run in compact mode.
_COMPACT_WINDOW_THRESHOLD = 16000


def _context_window() -> int:
    return int(getattr(settings, "ASSISTANT_CONTEXT_WINDOW", 0) or 0)


def compact_mode() -> bool:
    """True when the configured model context window is small enough that the full
    prompt + tool schemas would overflow it — trims prompt, tool descriptions and
    caps. 0/unset means assume a large window (no compaction)."""
    window = _context_window()
    return 0 < window <= _COMPACT_WINDOW_THRESHOLD


def is_available() -> bool:
    """True when the assistant is enabled and an LLM endpoint is configured."""
    if not (getattr(settings, "ASSISTANT_ENABLED", False) and getattr(settings, "LLM_ENABLED", False)):
        return False
    api_url = getattr(settings, "LLM_API_URL", "")
    api_key = getattr(settings, "LLM_API_KEY", "")
    # A key is required unless pointing at a local endpoint (vLLM/Ollama).
    return bool(api_key or "localhost" in api_url or "127.0.0.1" in api_url or "vllm" in api_url or "ollama" in api_url)


def _max_steps() -> int:
    """The tool-call budget for this request. Capped harder in compact mode: a
    small window can't afford many accumulating tool results, so deep chains would
    overflow it before settling on an answer."""
    steps = int(getattr(settings, "ASSISTANT_MAX_STEPS", 20))
    if compact_mode():
        steps = min(steps, int(getattr(settings, "ASSISTANT_MAX_STEPS_COMPACT", 8)))
    return max(1, steps)


def _recursion_limit() -> int:
    # Each tool round is ~2 graph steps (model call + tool). Leave headroom.
    return _max_steps() * 2 + 2


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
    compact = compact_mode()
    prompt = COMPACT_SYSTEM_PROMPT if compact else SYSTEM_PROMPT
    # Tell the model its tool-call budget so it self-paces: prioritize the most
    # informative tools first and stop chaining once it can answer, rather than
    # spending the budget and hitting the recursion limit mid-thought.
    steps = _max_steps()
    prompt = (
        f"{prompt}\n\nBUDGET: you can make about {steps} tool calls for this "
        "question. Prioritize the most informative tools, avoid repeating a call "
        "with the same arguments, and once you have enough to answer, stop and write "
        "the answer."
    )
    return create_agent(llm, get_tools(compact=compact), system_prompt=prompt)


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
    if compact_mode():
        # Carry only the last couple of turns, tightly trimmed, on small windows.
        max_msgs, max_chars = min(max_msgs, 4), min(max_chars, 800)
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

# How many aircraft to name in the ground/departure context, and how close an
# airport must be (nm) to count as "where a grounded aircraft is parked".
_GROUND_MAX = 10
_ROUTE_MAX = 8
_GROUND_AIRPORT_NM = 5.0


def _airport_of(lat, lon, airports) -> str | None:
    """Nearest cached airport ICAO within _GROUND_AIRPORT_NM of a ground position."""
    if lat is None or lon is None or not airports:
        return None
    from skyspy.services.geodata import haversine_nm

    best, best_d = None, _GROUND_AIRPORT_NM
    for apt in airports:
        a_lat, a_lon = apt.get("lat"), apt.get("lon")
        if a_lat is None or a_lon is None:
            continue
        d = haversine_nm(lat, lon, a_lat, a_lon)
        if d <= best_d:
            best, best_d = apt.get("icaoId") or apt.get("name"), d
    return best


def _ground_route_context(aircraft_list: list[dict]) -> dict:
    """Where parked aircraft are (nearest airport) and where airborne aircraft
    departed from / are headed (from cached per-flight route_data). Best-effort:
    two cached/DB reads, closest-first, capped. Returns {} on any failure."""
    if not aircraft_list:
        return {}
    from skyspy.services import geodata

    # Closest first so truncation keeps the most relevant aircraft.
    ordered = sorted(aircraft_list, key=lambda a: (a.get("distance_nm") is None, a.get("distance_nm") or 0))

    airports = geodata.get_cached_airports(
        settings.FEEDER_LAT, settings.FEEDER_LON, radius_nm=settings.GEODATA_FETCH_RADIUS_NM, limit=1000
    )

    on_ground = []
    airborne_hexes = []
    for ac in ordered:
        alt = ac.get("alt_baro")
        grounded = alt == "ground" or (isinstance(alt, (int, float)) and alt <= 0)
        cs = (ac.get("flight") or "").strip()
        if grounded:
            if len(on_ground) < _GROUND_MAX:
                apt = _airport_of(ac.get("lat"), ac.get("lon"), airports)
                on_ground.append({"cs": cs or ac.get("hex"), "at": apt} if apt else {"cs": cs or ac.get("hex")})
        elif cs and ac.get("hex"):
            airborne_hexes.append(ac.get("hex"))

    # One query for the route (origin/destination) of the closest airborne aircraft.
    departures = []
    if airborne_hexes:
        from skyspy.models.aircraft import AircraftInfo

        routes = dict(
            AircraftInfo.objects.filter(
                icao_hex__in=airborne_hexes[: _ROUTE_MAX * 3], route_data__isnull=False
            ).values_list("icao_hex", "route_data")
        )
        for hx in airborne_hexes:
            if len(departures) >= _ROUTE_MAX:
                break
            rd = routes.get(hx)
            if not isinstance(rd, dict):
                continue
            origin = (rd.get("origin") or {}).get("icao") or (rd.get("origin") or {}).get("iata")
            dest = (rd.get("destination") or {}).get("icao") or (rd.get("destination") or {}).get("iata")
            if not origin and not dest:
                continue
            departures.append({"cs": rd.get("callsign") or hx, "from": origin, "to": dest})

    ctx = {}
    if on_ground:
        ctx["on_ground"] = on_ground
    if departures:
        ctx["departures"] = departures
    return ctx


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
        # Where parked aircraft sit (airport) + where airborne ones came from / head
        # to — skip in compact mode (tight token budget) since it's the largest block.
        if not compact_mode():
            from django.core.cache import cache as _cache

            snapshot.update(_ground_route_context(_cache.get("current_aircraft", []) or []))
        # Drop empty keys so the block stays terse.
        snapshot = {k: v for k, v in snapshot.items() if v not in (None, "")}
        cap = min(_MAX_BRIEFING_CHARS, 600) if compact_mode() else _MAX_BRIEFING_CHARS
        text = json.dumps(snapshot, default=str, separators=(",", ":"))[:cap] if snapshot else ""
        cache.set(_BRIEFING_CACHE_KEY, text, _BRIEFING_TTL)
        return text
    except Exception as e:  # broad: briefing is a best-effort grounding hint, never fatal
        logger.debug(f"situation briefing unavailable: {type(e).__name__}: {e}")
        return ""


# Query phrasing that clearly asks to SEE an aircraft. Weak models often answer
# such asks in prose instead of calling fetch_airframe_photo; when this matches we
# fold in an explicit directive so the tool actually fires.
_PHOTO_INTENT_RE = re.compile(
    r"\b(?:show|see|view|look at|display|pull up|picture|pic|photo|image|"
    r"what(?:'s| is| does| do)?.{0,20}\blook\b)\b",
    re.IGNORECASE,
)


def _wants_photo(query: str) -> bool:
    return bool(query and _PHOTO_INTENT_RE.search(query))


# Always-on station/time grounding: the fixed frame of reference the model
# otherwise has to guess. The LLM has no clock and no idea where the antenna is,
# which every "now" / "today" / "near me" / "how far" question depends on. Kept
# tiny so it injects even in compact mode, and independent of the
# ASSISTANT_BRIEFING_ENABLED toggle. Cached briefly so "now" stays current.
_STATION_CONTEXT_CACHE_KEY = "assistant:station_context"
_STATION_CONTEXT_TTL = 30  # seconds — time only needs to be roughly current


def _enabled_features() -> list[str]:
    """Which optional subsystems are live, so the model doesn't pitch a disabled
    one (e.g. offer ACARS analysis when ACARS is off)."""
    flags = {
        "acars": bool(getattr(settings, "ACARS_ENABLED", False) or getattr(settings, "AIRFRAMES_ACARS_ENABLED", False)),
        "safety_monitoring": bool(getattr(settings, "SAFETY_MONITORING_ENABLED", False)),
        "assistant_web_search": bool(getattr(settings, "WEB_SEARCH_ENABLED", False)),
    }
    return sorted(k for k, v in flags.items() if v)


def _nearest_place(lat: float, lon: float) -> str | None:
    """A human place label for the receiver — the nearest cached airport ICAO +
    name — so the model can say 'near KPAE (Paine Field)' instead of raw lat/lon.
    Best-effort; None when no airports are cached."""
    try:
        from skyspy.services import geodata
        from skyspy.services.geodata import haversine_nm

        airports = geodata.get_cached_airports(lat, lon, radius_nm=60, limit=200) or []
        airports = [a for a in airports if a.get("lat") is not None and (a.get("icaoId") or a.get("name"))]
        if not airports:
            return None
        apt = min(airports, key=lambda a: haversine_nm(lat, lon, a["lat"], a["lon"]))
        icao, name = apt.get("icaoId"), apt.get("name")
        return f"{icao} ({name})" if icao and name else (icao or name)
    except Exception as e:  # broad: place label is a nicety, never fatal
        logger.debug(f"nearest place unavailable: {type(e).__name__}: {e}")
        return None


def _station_context() -> str:
    """Current UTC time, receiver location (+ nearest place), feed health, units and
    enabled features. Best-effort and cached ~30s (never raises); returns "" only on
    failure."""
    try:
        from django.core.cache import cache

        cached = cache.get(_STATION_CONTEXT_CACHE_KEY)
        if cached is not None:
            return cached

        from django.utils import timezone

        lat, lon = round(float(settings.FEEDER_LAT), 4), round(float(settings.FEEDER_LON), 4)
        # current_aircraft is cached with a 30s TTL by the polling task, so its
        # presence is a live/stale signal — lets the model say "feed looks down"
        # instead of "it's quiet" when there's genuinely no data flowing.
        current = cache.get("current_aircraft")
        ctx = {
            "utc_now": timezone.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "timezone": getattr(settings, "TIME_ZONE", "UTC"),
            "receiver": {"lat": lat, "lon": lon, "near": _nearest_place(lat, lon)},
            "feed": "live" if current else "stale/down",
            "units": "distance nm, altitude ft, speed kt, times UTC",
            "features": _enabled_features(),
        }
        # Drop a null 'near' so the block stays terse when no airport is cached.
        if ctx["receiver"]["near"] is None:
            ctx["receiver"].pop("near")
        text = json.dumps(ctx, default=str, separators=(",", ":"))
        cache.set(_STATION_CONTEXT_CACHE_KEY, text, _STATION_CONTEXT_TTL)
        return text
    except Exception as e:  # broad: grounding hint, never fatal
        logger.debug(f"station context unavailable: {type(e).__name__}: {e}")
        return ""


def _compose_query(query: str, context: str | None) -> str:
    """Fold station/time grounding + the live-situation briefing + optional page
    context into the user turn as clearly-delimited background."""
    parts = []
    station = _station_context()
    if station:
        parts.append(
            "[Station context — the fixed frame of reference for this request. "
            "receiver = your ADS-B antenna's lat/lon (near = nearest airport); all "
            "distances/bearings are from there, so 'near me' / 'overhead' / 'how "
            "far' are relative to it. utc_now is the current time (use it for 'today' "
            "/ 'tonight' / 'this week' and to read UTC timestamps); feed = whether "
            "live data is flowing (if 'stale/down', no aircraft means the feed is "
            "down, not that it's quiet); features = active subsystems — don't offer "
            "one that's absent.]\n"
            f"<station>\n{station}\n</station>"
        )
    if _wants_photo(query):
        parts.append(
            "[If the user is asking to SEE a specific aircraft (its photo/picture/"
            "what it looks like), call fetch_airframe_photo with the hex/tail/"
            "callsign — it's the only way to display an image, so don't describe the "
            "plane's appearance instead. If they just want a list or data, ignore "
            "this note.]"
        )
    briefing = _situation_briefing()
    if briefing:
        parts.append(
            "[Live situation snapshot for grounding — current as of this request. "
            "Use it as background; call tools for anything specific or historical. "
            "on_ground = aircraft parked/taxiing (cs=callsign, at=nearest airport ICAO); "
            "departures = airborne flights with known routing (from/to = origin/dest airport).]\n"
            f"<live_situation>\n{briefing}\n</live_situation>"
        )
    context = (context or "").strip()
    if context:
        cap = min(_MAX_CONTEXT_CHARS, 1000) if compact_mode() else _MAX_CONTEXT_CHARS
        context = context[:cap]
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
        try:
            from skyspy.services.photo_cache import get_signed_photo_url

            signed = get_signed_photo_url(hex_code)
            if signed:
                return signed
        except Exception as e:  # broad: signing must never break answer assembly (keeps ask() non-raising)
            logger.debug(f"photo url signing failed for {hex_code}: {type(e).__name__}: {e}")
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


# Markdown image syntax: ![alt](url) — always model-authored, since real photos
# render from the fetch_airframe_photo tool call, not from the answer text.
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
# A bare http(s) link to an image file — the model hallucinating a photo URL.
_IMAGE_URL_RE = re.compile(r"https?://\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?", re.IGNORECASE)
# Markdown link whose target is an image URL: [text](http://…jpg)
_MD_IMAGE_LINK_RE = re.compile(r"\[([^\]]*)\]\(https?://[^)]+\.(?:jpe?g|png|webp|gif)(?:\?[^)]*)?\)", re.IGNORECASE)


def _strip_photo_urls(text: str) -> str:
    """Remove model-authored photo image markup from an answer.

    Small models ignore the "don't write an image URL" instruction and emit a
    Markdown image or a bare photo link, which renders as a broken/wrong image
    (the real photo is rendered separately from the tool call). Strip those; keep
    the app's internal anchor links (#hex, #map, …) and non-image URLs intact.
    """
    if not text:
        return text
    # Drop full ![alt](url) images first, else the image-link regex below would
    # strip the inner (url) and leave a stray "!alt".
    text = _MD_IMAGE_RE.sub("", text)
    # Keep the link text but drop the image target for [text](…jpg) links.
    text = _MD_IMAGE_LINK_RE.sub(r"\1", text)
    text = _IMAGE_URL_RE.sub("", text)
    # Collapse whitespace/blank lines left behind by removals.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_photos(messages) -> list[dict]:
    """Photo render payloads for each successful fetch_airframe_photo call."""
    photos = []
    for name, obs, _args in _tool_messages(messages):
        if name == _PHOTO_TOOL:
            photo = _photo_from_obs(obs)
            if photo:
                photos.append(photo)
    return photos


# Tools whose map points are aircraft (so the render carries per-aircraft
# identifiers and a radar deep-link filtering to exactly those aircraft).
_AIRCRAFT_MAP_TOOLS = ("live_aircraft_map", "radar_filter", "threat_assessment", "detect_unusual_patterns")
_MAP_TOOLS = (*_AIRCRAFT_MAP_TOOLS, "recent_pireps", "aircraft_track")

# Tools that also drive the live radar (filter/zoom) via a map_command event.
_RADAR_TOOLS = ("radar_filter",)

# Tools that push historical flown-path polylines onto the radar (radar_tracks).
_RADAR_TRACK_TOOLS = ("plot_tracks",)


def _aircraft_point(a: dict, lat, lon, *, military=None) -> dict:
    """One aircraft marker for a map render, from a tool result row."""
    return {
        "lat": lat,
        "lon": lon,
        "hex": a.get("hex") or a.get("icao_hex"),
        "callsign": a.get("callsign"),
        "track": a.get("track"),
        "altitude": a.get("altitude"),
        "distance_nm": a.get("distance_nm"),
        "military": bool(a.get("military") if military is None else military),
        "kind": "aircraft",
    }


def _filter_ids(points: list[dict]) -> list[str]:
    """Identifiers (hex preferred, else callsign) for aircraft points — used to
    deep-link the radar page to exactly the aircraft on this map."""
    ids, seen = [], set()
    for p in points:
        ident = (p.get("hex") or p.get("callsign") or "").strip()
        key = ident.upper()
        if ident and key not in seen:
            seen.add(key)
            ids.append(ident)
    return ids


def _radar_from_obs(obs: str) -> dict | None:
    """Extract the live-radar command ({label, match, view}) from a radar tool
    observation, for the frontend to apply to the actual radar screen."""
    try:
        data = json.loads(obs)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    radar = data.get("radar")
    if not isinstance(radar, dict) or not isinstance(radar.get("match"), dict):
        return None
    return {
        "label": radar.get("label") or data.get("label") or "Filtered aircraft",
        "match": radar["match"],
        "view": radar.get("view") or "fit",
        "count": data.get("count"),
    }


def _tracks_from_obs(obs: str) -> dict | None:
    """Extract historical flown-path polylines ({label, tracks, view}) from a
    plot_tracks observation, for the frontend to draw on the live radar screen.
    ``tracks`` maps ICAO hex → {cs, pts:[[lat,lon,alt], ...]}."""
    try:
        data = json.loads(obs)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    tracks = data.get("tracks")
    if not isinstance(tracks, dict) or not tracks:
        return None
    return {
        "label": data.get("label") or "Historical tracks",
        "tracks": tracks,
        "view": data.get("view") or "fit",
        "count": data.get("count"),
    }


def _map_from_obs(name: str, obs: str) -> dict | None:
    """Build a map render payload (real coords) from a map-tool observation.

    The coordinates come straight from the tool, never from model-authored JSON —
    the model used to round/hallucinate them into a ```map block, putting the map
    in the wrong place. Aircraft maps also carry a ``filter`` id list so the UI
    can link to the radar page showing only these aircraft.
    """
    try:
        data = json.loads(obs)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None

    points = []
    if name in ("live_aircraft_map", "radar_filter"):
        title = data.get("label") if name == "radar_filter" else "Live traffic"
        for a in data.get("aircraft") or []:
            lat, lon = a.get("lat"), a.get("lon")
            if lat is None or lon is None:
                continue
            points.append(_aircraft_point(a, lat, lon))
    elif name == "threat_assessment":
        title = "Threat & surveillance aircraft"
        for a in data.get("threats") or []:
            lat, lon = a.get("lat"), a.get("lon")
            if lat is None or lon is None:
                continue
            # Flag LE/surveillance in the alert colour on the map.
            mil = bool(a.get("is_law_enforcement") or a.get("is_surveillance_type"))
            points.append(_aircraft_point(a, lat, lon, military=mil))
    elif name == "detect_unusual_patterns":
        title = "Unusual flight patterns"
        for a in data.get("results") or []:
            center = a.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
            if lat is None or lon is None:
                continue
            points.append(_aircraft_point(a, lat, lon, military=bool(a.get("is_military"))))
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
    payload = {"title": title, "points": points}
    if name in _AIRCRAFT_MAP_TOOLS:
        ids = _filter_ids(points)
        if ids:
            payload["filter"] = ids
    # radar_filter carries the full match spec so "Open in radar" filters to ALL
    # matches (not just the sample points shown inline).
    if name == "radar_filter" and isinstance(data.get("radar"), dict):
        payload["radar"] = data["radar"]
    return payload


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


def _force_final_answer(query: str, context: str | None, history, gathered: list[str]) -> str:
    """Last-resort synthesis when the tool-call budget is exhausted.

    The react agent hit the recursion limit mid-chain, so its last turn was a
    tool call, not an answer — returning a bare "I couldn't settle" apology
    throws away everything it already gathered. Instead make ONE more model call
    with NO tools bound, feeding the accumulated tool outputs, and ask it to
    answer directly from that data. Returns "" on any failure so the caller can
    fall back to the apology string.
    """
    if not gathered:
        return ""
    try:
        from langchain_openai import ChatOpenAI

        llm = ChatOpenAI(
            base_url=getattr(settings, "LLM_API_URL", None),
            api_key=getattr(settings, "LLM_API_KEY", "") or "sk-noauth",
            model=getattr(settings, "ASSISTANT_MODEL", None) or settings.LLM_MODEL,
            temperature=0,
            timeout=getattr(settings, "ASSISTANT_TIMEOUT", 60),
            max_retries=1,
        )
        # Cap total gathered data so the synthesis call can't itself overflow the
        # context window (esp. compact/RPi models).
        cap = int(getattr(settings, "ASSISTANT_MAX_RESULT_CHARS", 6000))
        blob = "\n\n".join(g for g in gathered if g)[: cap * 3]
        messages = _normalize_history(history)
        messages.append(
            {
                "role": "system",
                "content": (
                    "You have run out of tool budget. Using ONLY the data already gathered "
                    "below, give the best possible direct answer to the user's question. Be "
                    "concise and specific. Do NOT mention tools, budgets, or that you were "
                    "interrupted — just answer."
                ),
            }
        )
        messages.append({"role": "user", "content": _compose_query(query, context)})
        messages.append({"role": "user", "content": f"Data gathered so far:\n{blob}"})
        out = llm.invoke(messages)
        return _as_str(getattr(out, "content", "")) or ""
    except Exception as e:  # broad: best-effort fallback; must never raise
        logger.warning("assistant force-final synthesis failed: %s: %s", type(e).__name__, e)
        return ""


def ask(query: str, context: str | None = None, history=None, user=None) -> dict:
    """
    Answer a question with the tool-calling agent (synchronous).

    ``context`` is optional background about the page the user is viewing.
    ``history`` is the prior conversation ([{role, content}, ...]) so the agent
    remembers earlier turns. ``user`` is the authenticated request user, bound for
    owner-scoped tools (e.g. my_alert_rules). Returns {answer, steps, sources,
    status}. Never raises.
    """
    query = (query or "").strip()
    if not query:
        return {"answer": None, "steps": [], "sources": [], "status": "empty_query"}
    if not is_available():
        return {"answer": None, "steps": [], "sources": [], "status": "unavailable"}

    from skyspy.services.assistant.tools import reset_current_user, set_current_user

    token = set_current_user(user)
    try:
        graph = _build_agent()
        # Stream state snapshots (not just the final return) so that if the agent
        # hits the recursion limit we still hold the last full message state — and
        # can synthesize a final answer from the tool data it already gathered
        # instead of discarding everything.
        last_state = None
        for last_state in graph.stream(  # noqa: B007 — used after the loop (recursion fallback)
            {"messages": _build_messages(query, context, history)},
            stream_mode="values",
            config={"recursion_limit": _recursion_limit()},
        ):
            pass
        result = last_state or {}
    except GraphRecursionError:
        # The agent chained more tool calls than ASSISTANT_MAX_STEPS allows without
        # settling on an answer. Force a final tool-less synthesis from the data
        # gathered so far rather than erroring out with a bare apology.
        logger.warning("assistant.ask hit recursion limit (%s steps)", _recursion_limit())
        partial_messages = (last_state or {}).get("messages", []) if isinstance(last_state, dict) else []
        gathered = [obs for _name, obs, _args in _tool_messages(partial_messages)]
        answer = _force_final_answer(query, context, history, gathered)
        return {
            "answer": answer
            or (
                "I gathered a lot of data but couldn't settle on a final answer within my "
                "step budget. Try narrowing the question, or raise ASSISTANT_MAX_STEPS."
            ),
            "steps": [],
            "sources": [],
            "status": "incomplete" if not answer else "ok",
        }
    except Exception as e:  # broad: agent/LLM/endpoint failure modes are unknowable
        logger.warning(f"assistant.ask failed: {type(e).__name__}: {e}")
        return {"answer": None, "steps": [], "sources": [], "status": "error", "error": str(e)}
    finally:
        reset_current_user(token)

    messages = result.get("messages", [])
    answer = _strip_photo_urls(_as_str(getattr(messages[-1], "content", ""))) if messages else None
    return {
        "answer": answer,
        "steps": _summarize_steps(messages),
        "sources": _extract_sources(messages),
        "photos": _extract_photos(messages),
        "maps": _extract_maps(messages),
        "status": "ok",
    }


async def astream(query: str, context: str | None = None, history=None, user=None):
    """
    Async generator of streaming events for SSE:
      {"type": "tool", "tool", "args"} | {"type": "token", "text"} |
      {"type": "photo", "src", "alt", "photographer", "source"} |
      {"type": "map", "title", "points"} |
      {"type": "final", "answer", "sources", "photos", "maps"} | {"type": "error"|"unavailable"}

    ``context`` is optional page background; ``history`` is the prior conversation
    ([{role, content}, ...]) so the agent remembers earlier turns. ``user`` is the
    authenticated request user, bound for owner-scoped tools.
    """
    query = (query or "").strip()
    if not query:
        yield {"type": "error", "message": "empty query"}
        return
    if not is_available():
        yield {"type": "unavailable"}
        return

    from skyspy.services.assistant.tools import reset_current_user, set_current_user

    token = set_current_user(user)
    try:
        graph = _build_agent()
    except Exception as e:  # broad: construction can fail on bad config
        logger.warning(f"assistant.astream build failed: {type(e).__name__}: {e}")
        reset_current_user(token)
        yield {"type": "error", "message": str(e)}
        return

    final_text, seen_sources, sources, photos, maps = [], set(), [], [], []
    # Raw tool outputs, kept so a recursion-limit hit can synthesize a final answer
    # from the data already gathered instead of apologizing (see except below).
    gathered: list[str] = []
    # Fallback for backends that don't emit per-token deltas: the content of the
    # last model turn, captured at on_chat_model_end. Without it final.answer would
    # be "" on non-streaming endpoints even though sync ask() returns text.
    last_model_text = ""
    try:
        async for event in graph.astream_events(
            {"messages": _build_messages(query, context, history)},
            version="v2",
            config={"recursion_limit": _recursion_limit()},
        ):
            kind = event.get("event")
            if kind == "on_tool_start":
                # Any tokens streamed before a tool call are intermediate reasoning,
                # not the final answer — drop them so final.answer holds only the
                # last model turn's text (matches sync ask()'s last-message behavior).
                final_text.clear()
                last_model_text = ""
                yield {"type": "tool", "tool": event.get("name"), "args": event.get("data", {}).get("input")}
            elif kind == "on_tool_end":
                obs = _as_str(_obs_output(event))
                if obs:
                    gathered.append(obs)
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
                # Live-radar control (filter/zoom) from the tool call — the dock
                # applies this to the actual radar screen.
                if tool_name in _RADAR_TOOLS:
                    cmd = _radar_from_obs(obs)
                    if cmd:
                        yield {"type": "map_command", **cmd}
                # Historical flown-path polylines drawn on the actual radar screen.
                if tool_name in _RADAR_TRACK_TOOLS:
                    trk = _tracks_from_obs(obs)
                    if trk:
                        yield {"type": "radar_tracks", **trk}
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
            elif kind == "on_chat_model_end":
                # Capture the full turn text as a fallback for non-streaming backends
                # (no on_chat_model_stream deltas). Reset per turn like final_text.
                out = event.get("data", {}).get("output")
                last_model_text = _as_str(getattr(out, "content", "")) if out is not None else last_model_text
    except GraphRecursionError:
        # The agent chained more tool calls than ASSISTANT_MAX_STEPS allows without
        # settling on an answer. Don't discard what already streamed — fall through
        # and finalize with whatever tokens/sources/photos/maps we accumulated.
        logger.warning("assistant.astream hit recursion limit (%s steps)", _recursion_limit())
        if not final_text:
            # Synthesize a final answer from the gathered tool data (blocking LLM
            # call, so off-thread to avoid stalling the event loop).
            synthesized = await asyncio.to_thread(_force_final_answer, query, context, history, gathered)
            final_text.append(
                synthesized
                or (
                    "I gathered a lot of data but couldn't settle on a final answer within my "
                    "step budget. Try narrowing the question, or raise ASSISTANT_MAX_STEPS."
                )
            )
    except Exception as e:  # broad: streaming loop must end cleanly
        logger.warning(f"assistant.astream failed: {type(e).__name__}: {e}")
        yield {"type": "error", "message": str(e)}
        return
    finally:
        reset_current_user(token)

    yield {
        "type": "final",
        "answer": _strip_photo_urls("".join(final_text) or last_model_text),
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
