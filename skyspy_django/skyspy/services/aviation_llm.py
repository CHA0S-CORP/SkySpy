"""
LLM-backed plain-English summaries of aviation data.

Turns cryptic aviation text (ACARS messages, PIREPs, NOTAMs, METAR/TAF,
SIGMETs) into short human-readable explanations using the configured
OpenAI-compatible LLM (see ``services/llm.py``).

Every function is a resilience boundary: it gates on ``llm_client.is_available()``
and returns ``None`` on any failure so callers fall back to the existing
rule-based decoders (``pirep_decoder``, ``notam_decoder``, ``acars_decoder``).
Responses are cached by ``LLMClient`` (keyed on the prompt) so identical text is
only summarised once per ``LLM_CACHE_TTL``.
"""

from __future__ import annotations

import json
import logging

from skyspy.services.llm import llm_client

logger = logging.getLogger(__name__)

# Short, factual summaries. Keep tokens low — these are UI captions, not essays.
_SUMMARY_MAX_TOKENS = 180

_SYSTEM_PROMPT = (
    "You are an aviation expert who explains cryptic aviation data to a general "
    "audience. Given a raw aviation message, respond with ONE or TWO plain-English "
    "sentences a non-pilot can understand. Expand abbreviations and codes. State "
    "what it means and why it matters. No preamble, no markdown, no restating the "
    "raw text. If the message is empty or unintelligible, reply exactly: N/A"
)

# Dedicated PIREP decoder prompt. Decodes /OV /TM /FL /TP /SK /WX /TA /WV /TB /IC
# /RM fields into a headlined, labeled plain-language summary; flags UUA as urgent.
_PIREP_SYSTEM_PROMPT = """\
You are a PIREP Decoder — an expert aviation assistant that translates raw
Pilot Reports (PIREPs) into clear, accurate plain-language summaries.

A PIREP is a report of actual in-flight weather conditions transmitted by a
pilot. Your job is to parse the coded format, decode every field, and present
the information in a form any pilot, dispatcher, or briefer can read at a glance.

============================================================
CORE BEHAVIOR
============================================================
- Decode ONLY what is present. Never invent, infer, or "fill in" missing fields.
- If a field is absent, omit it from output (do not write "not reported" unless
  the user asks for a complete field-by-field breakdown).
- Preserve all units and note them explicitly (feet MSL, knots, °C, statute miles).
- All times are UTC (Zulu). All altitudes are MSL unless the report says AGL.
- If the report is malformed, ambiguous, or you are unsure, say so plainly and
  show your best interpretation with the uncertainty flagged.
- Never give a safety recommendation or a go/no-go call. Decode the facts; the
  pilot decides.
- If the input is empty or not a PIREP, reply exactly: N/A

============================================================
REPORT TYPE
============================================================
UA   = Routine PIREP
UUA  = Urgent PIREP. Flag these prominently at the top of your output as
       "⚠ URGENT PIREP". Urgent conditions include: tornado, funnel cloud,
       waterspout; severe or extreme turbulence; severe icing; hail; low-level
       wind shear; volcanic ash; and any other hazard to flight.

============================================================
FIELD REFERENCE (decode each in order)
============================================================
/OV  Location. Fix, VOR/NAVAID identifier, or radial-distance from a fix.
     Example: OKC = Oklahoma City VOR. OKC090025 = 25 NM on the 090° radial
     from OKC. Two fixes joined (e.g., OKC-TUL) = a route segment.

/TM  Time of observation, 4-digit UTC (HHMM). Example: 1516 = 1516Z.

/FL  Altitude in HUNDREDS of feet MSL. Example: 085 = 8,500 ft.
       DURC = during climb   DURD = during descent   UNKN = unknown
       APRX = approximate     Ranges like 080-100 = 8,000–10,000 ft.

/TP  Aircraft type (ICAO code). Example: BE20 = Beechcraft King Air,
     C172 = Cessna 172, B738 = Boeing 737-800. If unknown: UNKN.

/SK  Sky / cloud cover. Coverage + base/top in hundreds of feet MSL.
       SKC/CLR = clear   FEW = few   SCT = scattered
       BKN = broken      OVC = overcast
     Format is often BASE/TOP. Example: BKN040-TOP080 = broken layer, base
     4,000 ft, tops 8,000 ft. OVCUNKN = overcast, tops/bases unknown.

/WX  Weather and flight visibility.
       FV = flight visibility in statute miles (e.g., FV05SM = 5 SM).
     Standard METAR weather codes apply:
       RA rain, SN snow, TS thunderstorm, BR mist, FG fog, HZ haze,
       DZ drizzle, GR hail, GS small hail, FU smoke, PL ice pellets,
       intensity: - light, (none) moderate, + heavy; VC = in the vicinity.

/TA  Outside air temperature in whole °C. "M" prefix = minus.
     Example: 15 = +15°C, M06 = -6°C.

/WV  Wind: direction (° true) + speed (knots). Example: 24045KT = wind from
     240° at 45 kt. May include G for gusts (e.g., 24045G60KT).

/TB  Turbulence. Intensity + optional type + altitude band.
       NEG none    LGT light    MOD moderate    SEV severe    EXTRM extreme
       CHOP = choppy    CAT = clear air turbulence    LLWS = low-level wind shear
     Example: MOD-SEV CAT 300-350 = moderate-to-severe CAT between FL300–FL350.

/IC  Icing. Intensity + type + altitude band.
       NEG none   TRACE   LGT light   MOD moderate   SEV severe
       RIME   CLR (clear)   MX (mixed)
     Example: MOD RIME 050-080 = moderate rime icing, 5,000–8,000 ft.

/RM  Remarks. Free text — decode any known contractions; quote the rest verbatim.

============================================================
COMMON CONTRACTIONS
============================================================
DURGC during climb · DURGD during descent · TOP tops · BLW below · ABV above ·
BTN between · SFC surface · OCNL occasional · CONS continuous · INTMT intermittent ·
LWR lower · UPDFTS updrafts · DNDFTS downdrafts · CB cumulonimbus · TCU towering cumulus.

============================================================
OUTPUT FORMAT
============================================================
1. A one-line headline: report type, aircraft, location, time.
   (Prefix with "⚠ URGENT PIREP" for UUA.)
2. A clean decoded summary in plain language — group logically
   (position/altitude, sky, weather/visibility, temp/wind, turbulence, icing,
   remarks). Use a short labeled list, not dense prose.

If a "turbulence_context" field is provided, it is the model-derived turbulence
risk (NWS G-AIRMET forecast + nearby PIREPs + winds-aloft shear) at this report's
position. Add a brief line noting whether the pilot's report agrees with or
contradicts that forecast risk — but the pilot's first-hand observation always
takes precedence; treat the context as corroboration, not fact.

Keep it accurate, concise, and unambiguous. When in doubt, flag the doubt."""

# Dedicated ACARS decoder prompt. Identifies the message type/label, decodes the
# envelope (tail/flight/direction), OOOI events, position reports, PDC/ATIS/WX,
# and free text; quotes airline-proprietary/corrupt segments verbatim.
_ACARS_SYSTEM_PROMPT = """\
You are an ACARS Decoder — an expert aviation assistant that translates raw
ACARS (Aircraft Communications Addressing and Reporting System) messages into
clear, accurate plain-language summaries.

ACARS is a digital datalink for short messages between aircraft and ground
stations (airline operations, dispatch, ATC). Messages carry OOOI flight
events, position reports, weather and clearance requests, free-text crew/dispatch
exchanges, and automated engine/maintenance data. Your job is to identify the
message type, decode the labels and fields, and present the content plainly.

============================================================
CORE BEHAVIOR
============================================================
- Decode ONLY what is present. Never invent registrations, times, or values.
- All times are UTC (Zulu) unless the message states otherwise.
- Decode latitude/longitude, altitudes, fuel, and ETAs with their units.
- Many operators use custom/proprietary formats. If a segment is airline-specific
  or unrecognized, decode what you can and quote the rest verbatim, clearly marked
  as raw/uninterpreted rather than guessing.
- ACARS is not a safety-of-life channel and messages can be garbled; if a field
  looks corrupted or ambiguous, flag it rather than smoothing it over.
- Decode the facts; do not infer intent or operational decisions beyond the text.
- If the input is empty or not an ACARS message, reply exactly: N/A

============================================================
MESSAGE ENVELOPE (common header fields)
============================================================
Typical decoded ACARS frames include some of:
  - Mode / Aircraft registration (tail number, e.g., .N123AB — the leading dot
    is the ACARS registration prefix).
  - Label — 2-character message type identifier (see table).
  - Block ID / MSN — message sequence number.
  - Flight ID / Flight number (e.g., AAL123 / UAL456).
  - Downlink (aircraft→ground) or Uplink (ground→aircraft) direction.
  - Text block — the message body.

============================================================
COMMON LABELS (message type)
============================================================
  Q0  Link test                         5Z  Airline-designated (ops/company)
  H1  General message / HF datalink      SA  Media advisory (link mgmt)
  _d  General downlink / OOOI report     C1–C5  ATC / CPDLC-related
  10/11/12/13  Telex / free text         B*  Oceanic / ADS-C position
  20/21  ATIS / weather request/reply    30/31  Clearance (PDC) request/reply
  80/81  Departure / arrival report      RA/RB  Request / response
Recognize the label to set expectations for the body. If a label is unfamiliar,
say so and decode the body on its own merits.

============================================================
OOOI FLIGHT EVENTS (the core automated report set)
============================================================
  OUT  Aircraft left the gate / brakes released (block-out).
  OFF  Aircraft airborne / wheels off (takeoff).
  ON   Aircraft touched down / wheels on (landing).
  IN   Aircraft arrived at the gate / brakes set (block-in).
Each event typically carries a UTC time and often fuel remaining and a station
identifier. Decode station codes (IATA/ICAO) and present the event timeline.

============================================================
POSITION REPORT FIELDS
============================================================
  - Position: latitude/longitude, often as N/S DDMM(.m) and E/W DDDMM(.m).
      Example: N4012.3 W07401.5 → 40°12.3′N, 074°01.5′W.
  - Altitude / Flight level: e.g., FL350 = 35,000 ft; or feet as written.
  - Waypoint / fix names, next fix and ETA, following fix.
  - Ground speed, Mach, heading, wind, and SAT/OAT where present.
  - Fuel remaining (kg or lb — note which if stated).
  - Time over the reported point (UTC).

============================================================
OTHER COMMON BODY CONTENTS
============================================================
  - PDC  Pre-Departure Clearance (uplink): route, SID, initial altitude,
    squawk/transponder code, departure frequency.
  - ATIS  Automatic Terminal Information Service text (winds, visibility,
    active runway, approach in use, information letter).
  - WX / METAR / TAF  requested weather uplinked to the flight deck.
  - Free text  dispatch↔crew messages: connections, gates, delays, fuel,
    maintenance write-ups. Decode abbreviations; quote the rest verbatim.
  - Engine / ACMS / AIDS reports  automated performance and fault snapshots —
    identify parameters where labeled (N1, N2, EGT, fuel flow, vibration),
    and mark raw values you cannot confidently map.

============================================================
COMMON ABBREVIATIONS
============================================================
DEP departure · ARR arrival · DEST destination · ALTN alternate · ETA/ETD
estimated time of arrival/departure · ATA/ATD actual time · FOB fuel on board ·
EFOB estimated fuel on board · BLK block time · TAX taxi · T/O takeoff ·
LDG landing · GA go-around · POS position · WPT waypoint · NXT next · RTE route ·
SID standard instrument departure · STAR standard arrival · SQ/XPDR squawk ·
FL flight level · GS ground speed · HDG heading · SAT/OAT static/outside air
temp · TAS/CAS true/calibrated airspeed · RWY runway · GATE/STND gate/stand ·
PAX passengers · CREW crew · MX/MEL maintenance / minimum equipment list ·
ACK acknowledged · UNA unable · WCO will comply.

============================================================
OUTPUT FORMAT
============================================================
1. Headline: aircraft (tail/flight), message type/label, and direction
   (downlink/uplink) in one line.
2. Decoded content: a short labeled summary grouped by what the message carries
   (event/time, position/altitude, fuel, route, clearance, or free text).
3. Raw/uninterpreted: quote any airline-specific or corrupted segments verbatim,
   clearly marked as not decoded.
If a "turbulence_context" field is provided, it is the model-derived turbulence
risk (NWS G-AIRMET + nearby PIREPs + winds-aloft shear) at this message's
position. If the risk is moderate or greater, add one short line noting the
rough-air conditions along the aircraft's track — never invent it if absent.
Keep it accurate and concise. When in doubt, flag the doubt."""

# Dedicated NOTAM decoder prompt. Handles both ICAO Q-line/A)-G) and US-domestic
# keyword formats; expands contractions, decodes date-time groups and vertical
# limits, flags PERM/EST, and spells out the operational impact.
_NOTAM_SYSTEM_PROMPT = """\
You are a NOTAM Decoder — an expert aviation assistant that translates raw
NOTAMs (Notices to Air Missions) into clear, accurate plain-language summaries.

A NOTAM is a notice of any change or hazard in the airspace system — closed
runways, unserviceable navaids, obstacles, airspace restrictions, and more.
Your job is to parse the coded format, expand every abbreviation, decode the
times and limits, and present the notice so a pilot or dispatcher grasps it at
a glance without misreading anything safety-critical.

============================================================
CORE BEHAVIOR
============================================================
- Decode ONLY what is present. Never invent or infer missing data.
- Expand every contraction (see list) but keep the exact facts intact.
- All times are UTC (Zulu) unless a NOTAM explicitly states local.
- Convert the compact date-time groups (YYMMDDHHMM) into readable form,
  e.g., 2607181200 → 18 Jul 2026, 1200Z.
- Flag "PERM" (permanent) and "EST" (estimated end time — subject to change).
- State altitude limits clearly (AGL vs MSL vs flight level) as written.
- If a NOTAM is malformed or ambiguous, say so and show your best reading with
  the uncertainty flagged. Never omit a safety-relevant detail to look tidy.
- Decode the facts; never advise whether a flight is legal or safe to conduct.
- If the input is empty or not a NOTAM, reply exactly: N/A

============================================================
NOTAM FORMATS YOU MAY RECEIVE
============================================================
1. ICAO NOTAM  — Q-line plus lettered fields A) through G).
2. US Domestic — keyword format: !LOC, then location, keyword, and text.
     Types: D (Distant), FDC (Flight Data Center — regulatory/procedural,
     e.g., amended approach procedures, TFRs), and Pointer NOTAMs.
Identify which format you're reading and decode accordingly.

============================================================
NOTAM IDENTIFIER & TYPE
============================================================
Example: A0123/26 = Series A, number 0123, year 2026.
Action suffix:
  NOTAMN = New notice
  NOTAMR = Replaces a prior NOTAM (references the one it supersedes)
  NOTAMC = Cancels a prior NOTAM

============================================================
ICAO FIELDS (decode each)
============================================================
Q)  Qualifier line, slash-separated:
    FIR / Q-code / Traffic / Purpose / Scope / Lower / Upper / Coordinates+Radius
    - FIR: Flight Information Region (e.g., EGTT).
    - Q-code: five characters "Q" + 4 letters. Letters 2–3 = SUBJECT
      (what it's about), letters 4–5 = CONDITION/STATUS (what changed).
        Common subjects: MR runway, MX taxiway, MS stopway/apron,
          IG glidepath, IL ILS, ID DME, IV VOR, IN navaid, OB obstacle,
          FA aerodrome, LC closed, PA/PI approach procedures.
        Common conditions: LC closed, LT limited, AS unserviceable,
          CS installation change, HW work in progress, AU not available,
          CN cancelled, TT triggered by TFR, XX plain language in E).
      If you don't recognize a Q-code, say so and rely on field E).
    - Traffic: I = IFR, V = VFR, IV = both.
    - Purpose: N immediate attention, B operational, O flight ops, M misc.
    - Scope: A aerodrome, E en-route, W nav warning, AE both.
    - Lower/Upper: vertical limits in hundreds of feet (000 to 999).
    - Coordinates+radius: lat/long + radius in NM (e.g., 5129N00028W005).

A)  Location — ICAO identifier(s) of the aerodrome or FIR affected.
B)  Valid FROM — date-time group YYMMDDHHMM UTC.
C)  Valid TILL — date-time group, or PERM (permanent), or ...EST (estimated).
D)  Schedule — active periods within the B–C window (e.g., "MON-FRI 0600-1800",
     "DAILY 2200-0500", "SR-SS" sunrise to sunset). Decode day/time patterns.
E)  Plain-text body — the actual notice, heavily abbreviated. Expand fully.
F)  Lower limit — for airspace/obstacle NOTAMs (e.g., SFC, 3000FT AMSL).
G)  Upper limit — for airspace/obstacle NOTAMs (e.g., FL120, 5000FT AGL).

============================================================
US DOMESTIC (keyword) DECODING
============================================================
Structure: !LOC ACCOUNTABLE-LOC AFFECTED-FACILITY KEYWORD text  effective-times
Keywords indicate the subject: RWY, TWY, APRON, AD, OBST, NAV, COM, SVC,
  AIRSPACE, ODP, SID, STAR, IAP, CHART, DATA, (U) unverified, (O) other.
FDC NOTAMs carry regulatory/procedural changes and TFRs — decode the affected
procedure or TFR area, altitudes, and times precisely.

============================================================
COMMON CONTRACTIONS
============================================================
RWY runway · TWY taxiway · AD aerodrome · APRON apron · APCH approach ·
DEP departure · ARR arrival · CLSD closed · U/S unserviceable · UNAVBL
unavailable · AVBL available · WIP work in progress · MAINT maintenance ·
OBST obstacle · OBSC obscured · PSN position · ACFT aircraft · BTN between ·
DUE due to · EXC except · TEMPO temporary · PERM permanent · EST estimated ·
LGT/LGTD light/lighted · PAPI precision approach path indicator · VASI ·
ILS/LOC/GP/DME/VOR/NDB navaids · TORA/TODA/ASDA/LDA declared distances ·
THR threshold · DTHR displaced threshold · CL centerline · ELEV elevation ·
AMSL above mean sea level · AGL above ground level · SFC surface · FL flight
level · SR sunrise · SS sunset · H24 24-hour · O/T other times · FREQ frequency ·
TFC traffic · TWR tower · GND ground · FIR flight information region · CTR
control zone · CTA control area · TMA terminal area · TFR temporary flight
restriction · NM nautical miles · RADIUS radius · WEF with effect from.

============================================================
OUTPUT FORMAT
============================================================
1. Headline: NOTAM ID + type, affected location, and the core change in one line.
2. Effective window: valid-from → valid-till in readable UTC (note PERM/EST and
   any active schedule from field D).
3. What it means: a short labeled summary — subject, condition, altitudes/area,
   and any operational impact spelled out in plain English.
Keep it precise and unambiguous. When in doubt, flag the doubt."""

# Per-kind system-prompt overrides. Kinds not listed use ``_SYSTEM_PROMPT``.
_SYSTEM_PROMPTS = {
    "pirep": _PIREP_SYSTEM_PROMPT,
    "acars": _ACARS_SYSTEM_PROMPT,
    "notam": _NOTAM_SYSTEM_PROMPT,
}

# Per-kind output token budgets. Kinds with a dedicated decoder prompt emit a
# structured labeled list, so they need more room than the one-line default.
_KIND_MAX_TOKENS = {"pirep": 450, "acars": 500, "notam": 500}

# Per-kind hint prepended to the user content to steer the model.
_KIND_HINTS = {
    "acars": "This is an ACARS/VDL2 datalink message sent between an aircraft and ground.",
    "pirep": "This is a PIREP (pilot report) of in-flight weather conditions.",
    "notam": "This is a NOTAM (Notice to Air Missions) about airspace/airport status.",
    "metar": "This is a METAR (current surface weather observation for an airport).",
    "taf": "This is a TAF (terminal aerodrome forecast for an airport).",
    "sigmet": "This is a SIGMET/AIRMET advisory of hazardous en-route weather.",
}


def available() -> bool:
    """Whether LLM summaries can be produced (LLM enabled + configured)."""
    return llm_client.is_available()


def _summarize(kind: str, raw_text: str, context: dict | None = None) -> str | None:
    """Core helper: build a prompt and return a cleaned one-line summary or None."""
    if not raw_text or not raw_text.strip():
        return None
    if not llm_client.is_available():
        return None

    system_prompt = _SYSTEM_PROMPTS.get(kind, _SYSTEM_PROMPT)
    parts = []
    # Kinds with a dedicated system prompt already carry their own framing, so the
    # generic "This is a ..." hint would just be noise.
    if kind not in _SYSTEM_PROMPTS:
        parts.append(_KIND_HINTS.get(kind, f"This is aviation data of type '{kind}'."))
    if context:
        # Structured hints (already-decoded fields) help the model be accurate.
        clean = {k: v for k, v in context.items() if v not in (None, "", [], {})}
        if clean:
            parts.append("Known decoded fields: " + json.dumps(clean, default=str)[:800])
    parts.append("Raw message:\n" + raw_text.strip()[:2000])

    response = llm_client.complete(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        max_tokens=_KIND_MAX_TOKENS.get(kind, _SUMMARY_MAX_TOKENS),
    )
    if not response:
        return None

    summary = (response.get("content") or "").strip()
    # Models sometimes wrap in quotes or restate "N/A".
    summary = summary.strip('"').strip()
    if not summary or summary.upper() in {"N/A", "NA", "NONE"}:
        return None
    return summary


def summarize_acars(
    text: str,
    *,
    label: str | None = None,
    callsign: str | None = None,
    decoded: dict | None = None,
    lat=None,
    lon=None,
    altitude_ft=None,
) -> str | None:
    """Plain-English summary of an ACARS/VDL2 message body. When lat/lon are given
    (e.g. from a position report), the turbulence-risk picture at that position is
    injected so the summary can flag rough-air conditions."""
    ctx = {"label": label, "callsign": callsign, "decoded": decoded}
    turb = _turbulence_context(lat, lon, altitude_ft)
    if turb:
        ctx["turbulence_context"] = turb
    return _summarize("acars", text, ctx)


# Structured ACARS analysis — same decoding knowledge as the prose decoder, but
# emitted as strict JSON the UI can render as fielded rows / badges / notes.
_ACARS_ANALYSIS_SYSTEM_PROMPT = (
    "You are an ACARS/VDL2 datalink decoder. Decode the raw message into STRICT JSON. "
    "Output ONLY a single JSON object — no markdown, no code fences, no text outside the JSON.\n\n"
    "Schema:\n"
    "{\n"
    '  "headline": string,               // one short line naming what this message is\n'
    '  "message_type": {"code": string|null, "name": string|null, "direction": "Uplink"|"Downlink"|null},\n'
    '  "aircraft": string|null,          // tail / flight / callsign if present\n'
    '  "summary": string,                // ONE plain-English sentence a non-pilot understands\n'
    '  "fields": [ {"label": string, "value": string, "note": string|null} ],  // decoded values\n'
    '  "airports": [ {"code": string, "note": string|null} ],  // airports/stations referenced\n'
    '  "notes": [ string ]               // caveats: unrecognized codes, corruption, proprietary bits\n'
    "}\n\n"
    "RULES:\n"
    "- Decode ONLY what is present; never invent values. Always include units in field values "
    "(ft, kt, °C, kg, UTC).\n"
    "- Group OOOI events, position, altitude/speed, fuel, temperatures, times, and clearance data "
    "into separate `fields` entries with clear labels.\n"
    "- If a code is non-standard or looks corrupted, still list it and explain the uncertainty in a "
    "note — do NOT present a guessed correction as fact.\n"
    '- Empty arrays are valid. If the message is empty or unintelligible, set headline to "N/A" and '
    "leave the arrays empty.\n"
    '- If a "turbulence_context" field is provided (model-derived turbulence risk at the message '
    "position from NWS G-AIRMET + PIREPs + winds-aloft shear), and this is a position/weather "
    'report, add ONE `notes` entry summarizing the rough-air risk (e.g. "Moderate turbulence '
    'forecast at this position (G-AIRMET TURB)"). Do not invent it if the field is absent.'
)

_ACARS_ANALYSIS_MAX_TOKENS = 700


def _parse_json_object(content: str) -> dict | None:
    """Best-effort parse of a JSON object from an LLM reply (handles code fences)."""
    if not content:
        return None
    c = content.strip()
    if c.startswith("```"):
        c = c.strip("`").strip()
    if c[:4].lower() == "json":
        c = c[4:].strip()
    start, end = c.find("{"), c.rfind("}")
    candidate = c[start : end + 1] if start != -1 and end > start else c
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def analyze_acars(
    text: str,
    *,
    label: str | None = None,
    callsign: str | None = None,
    decoded: dict | None = None,
    lat=None,
    lon=None,
    altitude_ft=None,
) -> dict | None:
    """Structured (JSON) decode of an ACARS/VDL2 message for rich UI rendering.

    Returns a normalized dict (headline / message_type / aircraft / summary / fields /
    airports / notes) or ``None`` when the LLM is unavailable or the message is empty.
    When lat/lon are given (e.g. from a position report), the turbulence-risk picture
    at that position is injected so the analysis can flag rough-air conditions.
    """
    if not text or not text.strip() or not llm_client.is_available():
        return None

    ctx = {"label": label, "callsign": callsign, "decoded": decoded}
    turb = _turbulence_context(lat, lon, altitude_ft)
    if turb:
        ctx["turbulence_context"] = turb
    ctx = {k: v for k, v in ctx.items() if v not in (None, "", [], {})}
    parts = []
    if ctx:
        parts.append("Known decoded fields: " + json.dumps(ctx, default=str)[:800])
    parts.append("Raw ACARS message:\n" + text.strip()[:2000])

    response = llm_client.complete(
        [
            {"role": "system", "content": _ACARS_ANALYSIS_SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        max_tokens=_ACARS_ANALYSIS_MAX_TOKENS,
    )
    if not response:
        return None

    data = _parse_json_object(response.get("content") or "")
    if not isinstance(data, dict):
        return None

    headline = (data.get("headline") or "").strip()
    fields = [
        {"label": str(f.get("label") or "").strip(), "value": str(f.get("value") or "").strip(), "note": f.get("note")}
        for f in (data.get("fields") or [])
        if isinstance(f, dict) and f.get("label") and f.get("value")
    ]
    airports = [
        {"code": str(a.get("code") or "").strip().upper(), "note": a.get("note")}
        for a in (data.get("airports") or [])
        if isinstance(a, dict) and a.get("code")
    ]
    notes = [n.strip() for n in (data.get("notes") or []) if isinstance(n, str) and n.strip()]

    # Nothing usable came back.
    if (not headline or headline.upper() in {"N/A", "NA", "NONE"}) and not fields:
        return None

    mt = data.get("message_type") if isinstance(data.get("message_type"), dict) else None
    return {
        "headline": headline or None,
        "message_type": {
            "code": (mt or {}).get("code"),
            "name": (mt or {}).get("name"),
            "direction": (mt or {}).get("direction"),
        }
        if mt
        else None,
        "aircraft": (data.get("aircraft") or None),
        "summary": (data.get("summary") or "").strip() or None,
        "fields": fields,
        "airports": airports,
        "notes": notes,
        # Deterministic turbulence risk at the message position (not LLM-derived),
        # so the UI can render a reliable badge. None when no position / calm.
        "turbulence": turb,
    }


def _turbulence_context(lat, lon, altitude_ft=None) -> dict | None:
    """Best-effort turbulence risk at a report's position, to ground PIREP/ACARS
    LLM analysis in the current NWS G-AIRMET + PIREP + winds-aloft picture. Returns
    a compact dict (level/score + hazard hits) or None when unavailable."""
    if lat is None or lon is None:
        return None
    try:
        from skyspy.services.turbulence import assess_turbulence

        result = assess_turbulence(float(lat), float(lon), altitude_ft)
    except (ValueError, TypeError, ImportError):
        return None
    if not result or result.get("level") == "none":
        return None
    sources = result.get("sources") or {}
    return {
        "level": result.get("level"),
        "score": result.get("score"),
        "gairmet_hazards": [h.get("hazard") for h in (sources.get("gairmet") or [])][:3],
        "nearby_pirep_turb": bool(sources.get("pireps")),
    }


def explain_pirep(raw_text: str, *, decoded: dict | None = None, lat=None, lon=None, altitude_ft=None) -> str | None:
    """Plain-English explanation of a PIREP. ``decoded`` = pirep_decoder output.
    When lat/lon are given, the current turbulence-risk picture at that position
    is injected so the model can corroborate or contrast the pilot's report."""
    context = {"decoded": decoded}
    turb = _turbulence_context(lat, lon, altitude_ft)
    if turb:
        context["turbulence_context"] = turb
    return _summarize("pirep", raw_text, context)


def explain_notam(raw_text: str, *, decoded: dict | None = None) -> str | None:
    """Plain-English explanation of a NOTAM. ``decoded`` = notam_decoder output."""
    return _summarize("notam", raw_text, {"decoded": decoded})


_NOTAM_BRIEF_SYSTEM_PROMPT = (
    "You are a flight-operations briefer. From a raw NOTAM produce a structured "
    "briefing for a ground-based traffic observer (not a pilot planning a flight). "
    "Respond with ONLY a JSON object, no markdown fences, with exactly these keys:\n"
    '  "headline": one line (<= 120 chars) stating the core restriction — area, '
    "altitude band, and active window.\n"
    '  "summary": 2-3 plain-language sentences. Expand SFC/MSL/AGL/VOR/USC and every '
    "contraction. Never assert facts not present in the source.\n"
    '  "restrictions": array of 2-4 short strings — the key operating restrictions.\n'
    '  "implications": array of 2-3 short strings — what it means for someone watching '
    "ADS-B traffic in the area.\n"
    "Ground every statement in the NOTAM text. If the input is empty or not a NOTAM, "
    'return {"headline":"","summary":"","restrictions":[],"implications":[]}.'
)


def brief_notam(raw_text: str, *, decoded: dict | None = None) -> dict | None:
    """Structured plain-language briefing for one NOTAM.

    Returns ``{headline, summary, restrictions[], implications[]}`` or ``None``
    when the LLM is unavailable, the text is empty, or the response can't be
    parsed as the expected JSON shape. Callers fall back to the single-string
    :func:`explain_notam` / rule-based summary.
    """
    if not raw_text or not raw_text.strip():
        return None
    if not llm_client.is_available():
        return None

    parts = []
    if decoded:
        clean = {k: v for k, v in decoded.items() if v not in (None, "", [], {})}
        if clean:
            parts.append("Known decoded fields: " + json.dumps(clean, default=str)[:800])
    parts.append("Raw NOTAM:\n" + raw_text.strip()[:2000])

    response = llm_client.complete(
        [
            {"role": "system", "content": _NOTAM_BRIEF_SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        max_tokens=600,
    )
    if not response:
        return None

    content = (response.get("content") or "").strip()
    if not content:
        return None
    # Models occasionally wrap JSON in ```json fences despite instructions.
    if content.startswith("```"):
        content = content.strip("`")
        content = content[4:] if content.lower().startswith("json") else content
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        data = json.loads(content[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return None

    headline = (data.get("headline") or "").strip()
    summary = (data.get("summary") or "").strip()
    restrictions = [str(r).strip() for r in (data.get("restrictions") or []) if str(r).strip()]
    implications = [str(r).strip() for r in (data.get("implications") or []) if str(r).strip()]
    if not headline and not summary:
        return None
    return {
        "headline": headline,
        "summary": summary,
        "restrictions": restrictions[:4],
        "implications": implications[:3],
    }


_AIRMET_BRIEF_SYSTEM_PROMPT = (
    "You are a flight-operations briefer. From a G-AIRMET (graphical AIRMET) forecast "
    "hazard advisory produce a structured briefing for someone watching ADS-B traffic on "
    "the ground (not a pilot planning a flight). Respond with ONLY a JSON object, no "
    "markdown fences, with exactly these keys:\n"
    '  "headline": one line (<= 120 chars) — the hazard, the altitude band it affects, and '
    "how long it is valid.\n"
    '  "summary": 2-3 plain-language sentences. Expand every contraction (TURB=turbulence, '
    "ICE=icing, IFR=instrument flight rules, MT OBSC=mountain obscuration, LLWS=low-level "
    "wind shear, FZLVL=freezing level, SFC WND=surface winds). Explain what the hazard is "
    "and what conditions produce it. Never assert facts not present in the source.\n"
    '  "hazard_detail": one sentence describing the hazard type in aviation terms (what a '
    "pilot would experience).\n"
    '  "altitude_note": one short string describing the affected altitude band in plain terms '
    '(e.g. "Surface up to 12,000 ft" or "FL180 and above"), or "" if unknown.\n'
    '  "operational_impact": array of 2-3 short strings — how this affects aircraft operating '
    "in the area (aircraft types most affected, likely reroutes/altitude changes).\n"
    '  "safety_tips": array of 1-2 short strings — what a ground observer might notice in the '
    "ADS-B picture (deviations, altitude changes, holding).\n"
    "Ground every statement in the advisory data. If the input is empty or not an AIRMET, "
    'return {"headline":"","summary":"","hazard_detail":"","altitude_note":"","operational_impact":[],"safety_tips":[]}.'
)


def brief_airmet(
    raw_text: str | None,
    *,
    hazard: str | None = None,
    severity: str | None = None,
    lower_alt_ft: int | None = None,
    upper_alt_ft: int | None = None,
    region: str | None = None,
    valid_to=None,
) -> dict | None:
    """Structured plain-language briefing for one G-AIRMET advisory.

    Returns ``{headline, summary, hazard_detail, altitude_note, operational_impact[],
    safety_tips[]}`` or ``None`` when the LLM is unavailable or the response can't be
    parsed. Unlike the raw-text decoders, AIRMETs often carry little/no raw text, so
    the structured advisory fields (hazard, severity, altitude band) are the primary
    input and ``raw_text`` is optional context.
    """
    if not llm_client.is_available():
        return None

    fields = {
        "hazard": hazard,
        "severity": severity,
        "lower_alt_ft": lower_alt_ft,
        "upper_alt_ft": upper_alt_ft,
        "region": region,
        "valid_to": str(valid_to) if valid_to else None,
    }
    clean = {k: v for k, v in fields.items() if v not in (None, "", [], {})}
    if not clean and not (raw_text and raw_text.strip()):
        return None

    parts = ["Advisory fields: " + json.dumps(clean, default=str)[:800]]
    if raw_text and raw_text.strip():
        parts.append("Raw AIRMET text:\n" + raw_text.strip()[:2000])

    response = llm_client.complete(
        [
            {"role": "system", "content": _AIRMET_BRIEF_SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        max_tokens=600,
    )
    if not response:
        return None

    data = _parse_json_object(response.get("content") or "")
    if not data:
        return None

    headline = (data.get("headline") or "").strip()
    summary = (data.get("summary") or "").strip()
    if not headline and not summary:
        return None
    impact = [str(r).strip() for r in (data.get("operational_impact") or []) if str(r).strip()]
    tips = [str(r).strip() for r in (data.get("safety_tips") or []) if str(r).strip()]
    return {
        "headline": headline,
        "summary": summary,
        "hazard_detail": (data.get("hazard_detail") or "").strip(),
        "altitude_note": (data.get("altitude_note") or "").strip(),
        "operational_impact": impact[:3],
        "safety_tips": tips[:2],
    }


def explain_weather(raw_text: str, *, kind: str = "metar") -> str | None:
    """Plain-English explanation of a METAR/TAF/SIGMET raw string."""
    kind = kind.lower()
    if kind not in ("metar", "taf", "sigmet"):
        kind = "metar"
    return _summarize(kind, raw_text)


# Flight-history narrative. Unlike the decoders above this consumes structured
# observation data (not a cryptic string) and produces a short readable story of
# where/when a single airframe has been seen by this ground station.
_FLIGHT_HISTORY_SYSTEM_PROMPT = (
    "You are an aviation analyst writing a detailed, play-by-play flight-history "
    "briefing for one aircraft, based ONLY on structured observation data captured "
    "by a single ground-based ADS-B receiver. Write an event-driven timeline, not a "
    "terse summary.\n\n"
    "STRUCTURE (one sentence per line — each line becomes a timeline entry):\n"
    "1. OPENING LINE: identity + the overall span — what the airframe is "
    "(type/operator/age/registration), when it was first seen here, how many times it "
    "has been tracked, and the most recent observation.\n"
    "2. PER-SESSION LINES: walk 'recent_sessions' in chronological order (oldest "
    "first) and write ONE sentence per notable pass, narrating it like an event. Lead "
    "each with THAT pass's own callsign, then describe what THAT pass's numbers show: "
    "the time first seen, the altitude envelope as motion (min→max = a climb, max→min = "
    "a descent, low min near the surface = a departure/arrival, min≈max at high level = "
    "level cruise), and the closest approach to the station. Prefer flight-level phrasing "
    "for high altitudes (e.g. 35,000 ft = FL350). The voice reads like: '<callsign> "
    "departed, climbing to <its max altitude> and passing <its closest_nm> off the "
    "antenna.' or 'Returned as <callsign>, holding <altitude> in level cruise.' or "
    "'Descended through <altitude> inbound as <callsign>.'\n"
    "VOICE EXAMPLES SHOW SENTENCE SHAPE ONLY — never copy their placeholder wording, "
    "and NEVER borrow an altitude, distance, time, place, or callsign that is not in "
    "this aircraft's data. Every number and callsign in a per-session line must come "
    "from that same session's fields.\n"
    "3. CLOSING LINE(S): what stands out across all passes — callsign changes, the "
    "altitude/distance envelope, transponder (squawk) codes, airports referenced in "
    "datalink messages, and any recorded safety events.\n\n"
    "STRICT RULES:\n"
    "- Ground EVERY statement in the supplied data. Never invent airports, routes, "
    "operators, times, headings, geographic locations (no 'over the city', 'LA basin', "
    "etc.), or counts that are not present. Describe altitude 'motion' ONLY as implied "
    "by each session's own min/max envelope — do not fabricate specific waypoints or "
    "maneuvers.\n"
    "- This station sees aircraft only when they are within radio range; frame the "
    "history as local observations ('first seen here', 'tracked N times', 'passed "
    "within N nm'), not as the aircraft's complete life story or its true departure/"
    "arrival airport unless a datalink airport is actually present.\n"
    "- Always write callsigns exactly as given (e.g. SKW3479), so each is easy to spot.\n"
    "- If emergency_squawks or safety_events are present, give them their own line, "
    "stated plainly and prominently as observed facts (e.g. 'squawked 7700, a general "
    "emergency') — these are the most important thing in the briefing. Do NOT speculate "
    "beyond the data.\n"
    "- Aim for 4 to 8 sentences total, scaling with how much real activity there is. "
    "Be vivid but factual. No markdown, no bullet points, no preamble.\n"
    "- If the data shows essentially no meaningful history, reply exactly: N/A"
)

_FLIGHT_HISTORY_MAX_TOKENS = 520


_FLIGHT_HISTORY_APPEND_SYSTEM_PROMPT = (
    "You are CONTINUING an existing event-driven flight-history briefing for one "
    "aircraft, using ONLY new observation data captured since the briefing was last "
    "written. You are given the PRIOR briefing text and the NEW session data.\n\n"
    "Write ONE new sentence PER new pass (each becomes its own timeline entry), "
    "narrating it like an event: lead with the callsign, then the time first seen, the "
    "altitude envelope as motion (min→max = a climb, max→min = a descent, low min near "
    "the surface = a departure/arrival, steady high = level cruise, FL350 style for high "
    "altitudes), and the closest approach. Give any new emergency squawk or safety event "
    "its own prominent line.\n\n"
    "STRICT RULES:\n"
    "- Do NOT repeat, restate, rewrite, or re-summarise anything already in the prior "
    "briefing. The prior sentences are final and must not be regenerated.\n"
    "- Do NOT recompute lifetime totals or averages. Describe only the new sessions.\n"
    "- Ground every statement in the new data; never invent callsigns, airports, times, "
    "or maneuvers. Infer altitude motion ONLY from each session's own min/max envelope.\n"
    "- Write callsigns exactly as given. Continue the same voice ('Later returned as…', "
    "'On a subsequent pass…'). No preamble, no markdown.\n"
    "- If there is no meaningful new activity, reply exactly: N/A"
)


def flight_history_append(prior_summary: str, new_context: dict) -> str | None:
    """Generate ONLY the new sentences to append to an existing flight-history briefing.

    Given the prior briefing and observation data for sessions not yet covered,
    returns a short continuation that never rewrites prior events, or ``None`` when
    the LLM is unavailable or there is nothing new worth adding.
    """
    if not new_context or not llm_client.is_available():
        return None

    clean = {k: v for k, v in new_context.items() if v not in (None, "", [], {})}
    if not clean:
        return None

    user_content = (
        "PRIOR BRIEFING (do not repeat or rewrite this):\n"
        + (prior_summary or "").strip()[:1800]
        + "\n\nNEW observation data since then (JSON):\n"
        + json.dumps(clean, default=str)[:2500]
        + "\n\nWrite only the new sentence(s) describing the new activity."
    )

    response = llm_client.complete(
        [
            {"role": "system", "content": _FLIGHT_HISTORY_APPEND_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_tokens=320,
    )
    if not response:
        return None

    summary = (response.get("content") or "").strip().strip('"').strip()
    if not summary or summary.upper() in {"N/A", "NA", "NONE"}:
        return None
    return summary


def flight_history_summary(context: dict) -> str | None:
    """Narrative flight-history summary for one airframe from structured data.

    ``context`` carries the airframe identity plus this station's observation
    record (session/sighting counts, first/last seen, callsigns, altitude and
    distance envelope, ACARS airports). Returns a short paragraph or ``None``
    when the LLM is unavailable or there is nothing worth summarising.
    """
    if not context or not llm_client.is_available():
        return None

    clean = {k: v for k, v in context.items() if v not in (None, "", [], {})}
    if not clean:
        return None

    user_content = (
        "Observation data for one aircraft (JSON):\n"
        + json.dumps(clean, default=str)[:3500]
        + "\n\nWrite the flight-history briefing."
    )

    response = llm_client.complete(
        [
            {"role": "system", "content": _FLIGHT_HISTORY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_tokens=_FLIGHT_HISTORY_MAX_TOKENS,
    )
    if not response:
        return None

    summary = (response.get("content") or "").strip().strip('"').strip()
    if not summary or summary.upper() in {"N/A", "NA", "NONE"}:
        return None
    return summary


# Safety-event narrative. Consumes structured conflict/emergency data (not a
# cryptic string) and produces a short readable explanation of what happened.
_SAFETY_EVENT_SYSTEM_PROMPT = (
    "You are an air-traffic-safety analyst explaining ONE detected safety event to "
    "a curious aviation enthusiast watching ADS-B traffic. You are given structured "
    "data about the event (type, severity, the involved aircraft, and separation / "
    "closest-point-of-approach numbers). Write 2 to 4 plain-English sentences.\n\n"
    "STRICT RULES:\n"
    "- Ground EVERY statement in the supplied data. Never invent callsigns, "
    "altitudes, distances, times, or intentions that are not present.\n"
    "- Expand the event type (e.g., 'proximity_conflict' = two aircraft predicted to "
    "pass unusually close; 'tcas_ra' = onboard collision-avoidance Resolution "
    "Advisory; squawk 7700/7600/7500 = general emergency / radio failure / hijack).\n"
    "- State what the separation numbers mean: horizontal separation in nautical "
    "miles, vertical separation in feet, closure rate in knots, and time to the "
    "closest point of approach in seconds. Explain why the event was flagged.\n"
    "- Be factual and calm. No markdown, no bullet points, no preamble, no go/no-go "
    "or blame judgements. This is an observation, not an incident ruling.\n"
    "- If the data is too sparse to say anything meaningful, reply exactly: N/A"
)

_SAFETY_EVENT_MAX_TOKENS = 320


def summarize_safety_event(context: dict) -> str | None:
    """Plain-English explanation of one safety event from structured data.

    ``context`` carries the event type/severity, the involved aircraft, and the
    separation / CPA numbers. Returns a short paragraph or ``None`` when the LLM
    is unavailable or there is nothing meaningful to say.
    """
    if not context or not llm_client.is_available():
        return None

    clean = {k: v for k, v in context.items() if v not in (None, "", [], {})}
    if not clean:
        return None

    user_content = (
        "Safety event data (JSON):\n"
        + json.dumps(clean, default=str)[:2500]
        + "\n\nExplain what this event is and why it was flagged."
    )

    response = llm_client.complete(
        [
            {"role": "system", "content": _SAFETY_EVENT_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_tokens=_SAFETY_EVENT_MAX_TOKENS,
    )
    if not response:
        return None

    summary = (response.get("content") or "").strip().strip('"').strip()
    if not summary or summary.upper() in {"N/A", "NA", "NONE"}:
        return None
    return summary


# Kinds the generic /aviation/explain/ endpoint knows how to steer.
SUPPORTED_KINDS = ("acars", "pirep", "notam", "metar", "taf", "sigmet")


def explain(kind: str, text: str, context: dict | None = None) -> str | None:
    """Generic dispatcher used by the API. Unknown kinds fall back to a generic prompt."""
    kind = (kind or "").lower().strip()
    ctx = context or {}
    if kind == "acars":
        return summarize_acars(
            text,
            **{k: ctx.get(k) for k in ("label", "callsign", "decoded", "lat", "lon", "altitude_ft") if k in ctx},
        )
    if kind == "pirep":
        return explain_pirep(
            text,
            decoded=ctx.get("decoded"),
            lat=ctx.get("lat"),
            lon=ctx.get("lon"),
            altitude_ft=ctx.get("altitude_ft"),
        )
    if kind == "notam":
        return explain_notam(text, decoded=ctx.get("decoded"))
    if kind in ("metar", "taf", "sigmet"):
        return explain_weather(text, kind=kind)
    return _summarize(kind or "aviation", text, context)
