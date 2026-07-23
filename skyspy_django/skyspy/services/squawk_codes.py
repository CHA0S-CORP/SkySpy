"""
Static transponder (squawk) code reference.

Well-known 4-digit Mode A codes and what they mean. Pure data + lookup — no
network, no DB — so the assistant's decode_squawk tool is deterministic and
trivially testable. Emergency codes reuse the authoritative severity labels
from services.safety.EMERGENCY_SQUAWKS so the two never drift.
"""

from typing import Any

from skyspy.services.safety import EMERGENCY_SQUAWKS

# US-centric with the common ICAO/European codes a feeder will actually see.
# category: vfr | emergency | special | discrete
WELL_KNOWN_SQUAWKS: dict[str, dict[str, Any]] = {
    "1200": {"meaning": "VFR flight (US) — not in contact with ATC", "category": "vfr"},
    "7000": {"meaning": "VFR flight (Europe/ICAO conspicuity code)", "category": "vfr"},
    "1201": {"meaning": "VFR aircraft within the LAX Special Flight Rules Area", "category": "vfr"},
    "1202": {"meaning": "Gliders not in contact with ATC (US)", "category": "vfr"},
    "1255": {"meaning": "Firefighting aircraft operating in a fire TFR area (US)", "category": "special"},
    "1277": {"meaning": "Search and rescue (SAR) operations (US)", "category": "special"},
    "4000": {"meaning": "Military aircraft on VFR/IFR in a Military Operations Area (US)", "category": "special"},
    "5000": {"meaning": "Military aircraft — NORAD assigned (US)", "category": "special"},
    "7400": {"meaning": "Unmanned aircraft (UAS) with lost command-and-control link", "category": "special"},
    "0000": {
        "meaning": "Non-discrete code — should not be assigned; may indicate a transponder fault (US)",
        "category": "special",
    },
}


def decode(code: str) -> dict[str, Any]:
    """Decode a 4-digit squawk code to meaning/category/severity.

    Always returns a dict; unknown well-formed codes come back as category
    "discrete" with an honest explanation (discrete codes are ATC-assigned for
    radar identification and carry no fixed meaning).
    """
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 4 or any(c not in "01234567" for c in code):
        return {"code": code, "error": "not a valid squawk (4 octal digits, 0000-7777)"}

    if code in EMERGENCY_SQUAWKS:
        e = EMERGENCY_SQUAWKS[code]
        return {
            "code": code,
            "meaning": f"{e['label']} — {e['type'].replace('_', ' ')}",
            "category": "emergency",
            "severity": e["severity"],
        }
    if code in WELL_KNOWN_SQUAWKS:
        return {"code": code, **WELL_KNOWN_SQUAWKS[code]}
    return {
        "code": code,
        "meaning": (
            "Discrete transponder code — assigned by ATC for radar identification; "
            "no fixed meaning. The aircraft is (or was) receiving ATC services."
        ),
        "category": "discrete",
    }
