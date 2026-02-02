"""
NOTAM (Notice to Air Missions) decoder service.

Translates aviation abbreviations and codes into human-readable format.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from skyspy.models.notams import CachedNotam

# Aviation abbreviations dictionary
ABBREVIATIONS = {
    # Runways and taxiways
    "RWY": "Runway",
    "RWYS": "Runways",
    "TWY": "Taxiway",
    "TWYS": "Taxiways",
    "APCH": "Approach",
    "APRON": "Apron",
    "RAMP": "Ramp",
    "THR": "Threshold",
    "THLD": "Threshold",
    "TDZ": "Touchdown Zone",
    "DTHR": "Displaced Threshold",
    # Status conditions
    "CLSD": "closed",
    "CLOSED": "closed",
    "U/S": "unserviceable",
    "OTS": "out of service",
    "INOP": "inoperative",
    "UNREL": "unreliable",
    "WIP": "work in progress",
    "MAINT": "maintenance",
    "CONST": "construction",
    "AVBL": "available",
    "AFT": "after",
    "TIL": "until",
    "WEF": "with effect from",
    "UFN": "until further notice",
    "H24": "24 hours",
    # Directions and positions
    "BTN": "between",
    "ABV": "above",
    "BLW": "below",
    "ADJ": "adjacent",
    "N": "north",
    "S": "south",
    "E": "east",
    "W": "west",
    "NE": "northeast",
    "NW": "northwest",
    "SE": "southeast",
    "SW": "southwest",
    "CL": "centerline",
    "INTXN": "intersection",
    # Altitudes and distances
    "SFC": "surface",
    "AGL": "above ground level",
    "MSL": "mean sea level",
    "AMSL": "above mean sea level",
    "FT": "feet",
    "FL": "flight level",
    "NM": "nautical miles",
    "SM": "statute miles",
    "KT": "knots",
    # Lighting
    "LGTG": "lighting",
    "LGTS": "lights",
    "LGT": "light",
    "HIRL": "high intensity runway lights",
    "MIRL": "medium intensity runway lights",
    "LIRL": "low intensity runway lights",
    "REIL": "runway end identifier lights",
    "PAPI": "PAPI",
    "VASI": "VASI",
    "ALS": "approach lighting system",
    "MALSR": "medium intensity approach lighting system with runway alignment indicator lights",
    "ALSF": "approach lighting system with sequenced flashers",
    "ODALS": "omnidirectional approach lighting system",
    "TDZ/CL": "touchdown zone and centerline lights",
    "RCLS": "runway centerline lights",
    "PCL": "pilot controlled lighting",
    # Navaids
    "VOR": "VOR",
    "VORTAC": "VORTAC",
    "NDB": "NDB",
    "DME": "DME",
    "ILS": "ILS",
    "LOC": "localizer",
    "GS": "glideslope",
    "GP": "glidepath",
    "TACAN": "TACAN",
    "RNAV": "RNAV",
    "GPS": "GPS",
    "LDA": "localizer type directional aid",
    "SDF": "simplified directional facility",
    "OM": "outer marker",
    "MM": "middle marker",
    "IM": "inner marker",
    "LOM": "locator outer marker",
    "LMM": "locator middle marker",
    # TFR and airspace
    "TFR": "Temporary Flight Restriction",
    "NOTAM": "Notice to Air Missions",
    "SUA": "Special Use Airspace",
    "MOA": "Military Operations Area",
    "MTR": "military training route",
    "ADIZ": "Air Defense Identification Zone",
    "ARTCC": "Air Route Traffic Control Center",
    "ATC": "Air Traffic Control",
    "ATCT": "Air Traffic Control Tower",
    "CTL": "control",
    "TWR": "tower",
    "FSS": "flight service station",
    "PPR": "prior permission required",
    "PJE": "parachute jumping exercise",
    # Services and procedures
    "SVC": "service",
    "SVCS": "services",
    "SKED": "scheduled",
    "UNSKED": "unscheduled",
    "EMERG": "emergency",
    "FREQ": "frequency",
    "COM": "communications",
    "PROC": "procedure",
    "IAP": "instrument approach procedure",
    "SID": "standard instrument departure",
    "STAR": "standard terminal arrival route",
    "IFR": "IFR",
    "VFR": "VFR",
    "CTAF": "common traffic advisory frequency",
    "UNICOM": "UNICOM",
    "ATIS": "ATIS",
    "AWOS": "AWOS",
    "ASOS": "ASOS",
    # Obstructions and hazards
    "OBST": "obstruction",
    "TOWER": "tower",
    "CRANE": "crane",
    "LGTED": "lighted",
    "UNLGTD": "unlighted",
    "TEMP": "temporary",
    "PERM": "permanent",
    "BIRD": "bird",
    "WILDLIFE": "wildlife",
    "FOD": "foreign object debris",
    # Airport and general
    "AD": "aerodrome",
    "AP": "airport",
    "ARPT": "airport",
    "AFLD": "airfield",
    "FBO": "fixed-base operator",
    "OPR": "operator",
    "MGR": "manager",
    "ACR": "air carrier",
    "GA": "general aviation",
    "MIL": "military",
    "CIV": "civilian",
    "JT": "joint",
    "RQRD": "required",
    "AUTH": "authorized",
    "ACFT": "aircraft",
    "RTRN": "return",
    "DEP": "departure",
    "ARR": "arrival",
    "ALTN": "alternate",
    "ALTRV": "altitude reservation",
    "FLT": "flight",
    "INCL": "including",
    "EXCL": "excluding",
    "EXCP": "except",
    "EFF": "effective",
    "CTC": "contact",
    "INFO": "information",
    "OPN": "open",
    "RST": "restriction",
    "DAM": "damaged",
    "REPR": "repair",
    "REV": "revised",
    "CNCL": "cancelled",
}

# NOTAM categories with severity and detection patterns
CATEGORIES = {
    "AIRPORT_CLOSURE": {
        "severity": "critical",
        "patterns": [r"AD\s+CLSD", r"AP\s+CLSD", r"ARPT\s+CLSD", r"AIRPORT\s+CLOSED"],
        "label": "Airport Closure",
    },
    "RUNWAY_CLOSURE": {
        "severity": "critical",
        "patterns": [r"RWY\s*\d+[LRC]?(/\d+[LRC]?)?\s+CLSD", r"RUNWAY\s*\d+[LRC]?\s+CLOSED"],
        "label": "Runway Closure",
    },
    "TFR": {
        "severity": "critical",
        "patterns": [r"\bTFR\b", r"FLIGHT\s+RESTRICTION", r"TEMPORARY\s+FLIGHT\s+RESTRICTION"],
        "label": "Temporary Flight Restriction",
    },
    "TAXIWAY_CLOSURE": {
        "severity": "moderate",
        "patterns": [r"TWY\s*[A-Z]+\d*\s+CLSD", r"TAXIWAY\s+[A-Z]+\d*\s+CLOSED"],
        "label": "Taxiway Closure",
    },
    "LIGHTING": {
        "severity": "moderate",
        "patterns": [r"LGTG", r"LGTS", r"HIRL", r"MIRL", r"PAPI", r"VASI", r"REIL", r"ALS\b", r"MALSR", r"RCLS"],
        "label": "Lighting",
    },
    "NAVAID": {
        "severity": "moderate",
        "patterns": [
            r"\bVOR\b",
            r"\bILS\b",
            r"\bDME\b",
            r"\bNDB\b",
            r"\bLOC\b",
            r"GLIDESLOPE",
            r"GLIDE\s+SLOPE",
            r"\bGS\b\s+(?:U/S|OTS|INOP)",
        ],
        "label": "Navaid",
    },
    "SUA": {
        "severity": "moderate",
        "patterns": [r"\bSUA\b", r"\bMOA\b", r"MILITARY\s+OPERATIONS?\s+AREA", r"RESTRICTED\s+AREA", r"\bMTR\b"],
        "label": "Special Use Airspace",
    },
    "OBSTRUCTION": {
        "severity": "advisory",
        "patterns": [r"\bOBST\b", r"\bCRANE\b", r"\bTOWER\b", r"WIND\s+TURBINE"],
        "label": "Obstruction",
    },
    "COMMUNICATIONS": {
        "severity": "advisory",
        "patterns": [r"\bATIS\b", r"\bAWOS\b", r"\bASOS\b", r"\bCTAF\b", r"\bFREQ\b", r"\bCOM\b\s+(?:U/S|OTS|INOP)"],
        "label": "Communications",
    },
    "SERVICES": {
        "severity": "advisory",
        "patterns": [r"\bFUEL\b", r"\bSVC\b", r"\bTWR\b\s+(?:CLSD|CLOSED)", r"TOWER\s+CLOSED", r"\bFBO\b"],
        "label": "Services",
    },
    "AIRSPACE": {
        "severity": "advisory",
        "patterns": [r"CLASS\s+[A-G]", r"AIRSPACE", r"\bCTL\s+ZONE\b", r"CONTROL\s+ZONE"],
        "label": "Airspace",
    },
    "PROCEDURE": {
        "severity": "advisory",
        "patterns": [r"\bIAP\b", r"\bSID\b", r"\bSTAR\b", r"INSTRUMENT\s+APPROACH", r"DEPARTURE\s+PROCEDURE"],
        "label": "Procedure",
    },
    "OTHER": {
        "severity": "advisory",
        "patterns": [],
        "label": "General",
    },
}

# Entity patterns for extraction - ordered from most specific to least specific
# The order matters because we return on first match
ENTITY_PATTERNS = [
    # Navaids (check before runway since they may reference runways)
    ("navaid_ils", r"ILS\s+(?:RWY\s*)?(\d+[LRC]?)"),
    ("navaid_vor", r"(\w{3})\s+VOR"),
    ("navaid_dme", r"(\w{3})\s+DME"),
    # Lighting (check before runway since they reference runways)
    ("lighting_papi", r"PAPI\s+(?:RWY\s*)?(\d+[LRC]?)"),
    ("lighting_vasi", r"VASI\s+(?:RWY\s*)?(\d+[LRC]?)"),
    ("lighting_reil", r"REIL\s+(?:RWY\s*)?(\d+[LRC]?)"),
    # Runway and taxiway (more general patterns)
    ("runway", r"RWY\s*(\d+[LRC]?(?:/\d+[LRC]?)?)"),
    ("taxiway", r"TWY\s*([A-Z]+\d*)"),
]

# Condition patterns
CONDITION_PATTERNS = {
    "CLSD": "closed",
    "CLOSED": "closed",
    "U/S": "unserviceable",
    "OTS": "out of service",
    "INOP": "inoperative",
    "UNAVBL": "unavailable",
    "UNREL": "unreliable",
    "AVBL": "available",
    "OPEN": "open",
    "RESTRICTED": "restricted",
}

# Reason patterns
REASON_PATTERNS = {
    "MAINT": "maintenance",
    "MAINTENANCE": "maintenance",
    "CONST": "construction",
    "CONSTRUCTION": "construction",
    "WIP": "work in progress",
    "SNOW": "snow removal",
    "SNOW REMOVAL": "snow removal",
    "ICE": "ice",
    "REPAIR": "repairs",
    "BIRD": "bird activity",
    "WILDLIFE": "wildlife",
    "VIP": "VIP movement",
    "SPECIAL EVENT": "special event",
    "AIRSHOW": "airshow",
    "MILITARY": "military operations",
    "SECURITY": "security",
    "HAZMAT": "hazardous materials",
    "EMERGENCY": "emergency",
}


def extract_affected_entity(text: str) -> dict | None:
    """Extract the affected entity from NOTAM text."""
    text_upper = text.upper()

    for entity_type, pattern in ENTITY_PATTERNS:
        match = re.search(pattern, text_upper)
        if match:
            value = match.group(1)

            # Parse entity type (e.g., "navaid_vor" -> base="navaid", subtype="vor")
            parts = entity_type.split("_")
            entity_base = parts[0]
            entity_subtype = parts[1].upper() if len(parts) > 1 else ""

            # Build display string based on entity type
            if entity_base == "runway":
                display = f"Runway {value}"
            elif entity_base == "taxiway":
                display = f"Taxiway {value}"
            elif entity_base == "navaid":
                display = f"{entity_subtype} {value}"
            elif entity_base == "lighting":
                display = f"{entity_subtype} Runway {value}"
            else:
                display = value

            return {
                "type": entity_base,
                "value": value,
                "display": display,
            }

    return None


def extract_condition(text: str) -> dict | None:
    """Extract the condition/status from NOTAM text."""
    text_upper = text.upper()

    for code, label in CONDITION_PATTERNS.items():
        if code in text_upper:
            return {"code": code, "label": label}

    return None


def extract_reason(text: str) -> dict | None:
    """Extract the reason from NOTAM text."""
    text_upper = text.upper()

    for code, label in REASON_PATTERNS.items():
        if code in text_upper:
            return {"code": code, "label": label}

    return None


def detect_category(text: str) -> str:
    """Detect the category of a NOTAM based on its text."""
    text_upper = text.upper()

    for category, config in CATEGORIES.items():
        for pattern in config["patterns"]:
            if re.search(pattern, text_upper):
                return category

    return "OTHER"


def get_severity(notam: CachedNotam) -> str:
    """Get the severity level of a NOTAM."""
    # TFRs are always critical
    if notam.notam_type == "TFR" or notam.geometry:
        return "critical"

    category = detect_category(notam.text)
    return CATEGORIES.get(category, CATEGORIES["OTHER"])["severity"]


def expand_abbreviations(text: str) -> str:
    """Expand aviation abbreviations in NOTAM text."""
    result = text

    # Sort by length descending to replace longer abbreviations first
    sorted_abbrevs = sorted(ABBREVIATIONS.items(), key=lambda x: len(x[0]), reverse=True)

    for abbrev, expansion in sorted_abbrevs:
        # Use word boundary matching to avoid partial replacements
        pattern = r"\b" + re.escape(abbrev) + r"\b"
        result = re.sub(pattern, expansion, result, flags=re.IGNORECASE)

    return result


def generate_summary(notam: CachedNotam) -> str:
    """Generate a human-readable summary of a NOTAM."""
    text = notam.text or ""
    text_upper = text.upper()

    # Try to build a summary from extracted components
    entity = extract_affected_entity(text)
    condition = extract_condition(text)
    reason = extract_reason(text)

    parts = []

    if entity:
        parts.append(entity["display"])

    if condition:
        parts.append(condition["label"])

    if reason:
        parts.append(f"for {reason['label']}")

    if parts:
        summary = " ".join(parts)
        return summary[0].upper() + summary[1:]

    # Fall back to category-based summary
    category = detect_category(text)
    category_info = CATEGORIES.get(category, CATEGORIES["OTHER"])

    # Try to extract a brief meaningful snippet
    if "CLSD" in text_upper or "CLOSED" in text_upper:
        return f"{category_info['label']} - closure"
    if "U/S" in text_upper or "OTS" in text_upper or "INOP" in text_upper:
        return f"{category_info['label']} - out of service"

    return category_info["label"]


def decode_notam(notam: CachedNotam) -> dict[str, Any]:
    """
    Decode a NOTAM into human-readable format.

    Returns a dictionary with:
    - affected_entity: What is affected (runway, taxiway, navaid, etc.)
    - condition: Current status (closed, unserviceable, etc.)
    - reason: Why (maintenance, construction, etc.)
    - category: NOTAM category (RUNWAY_CLOSURE, TFR, LIGHTING, etc.)
    - severity: Severity level (critical/moderate/advisory)
    - human_summary: Human-readable summary string
    - expanded_text: Text with abbreviations expanded
    """
    return {
        "affected_entity": extract_affected_entity(notam.text),
        "condition": extract_condition(notam.text),
        "reason": extract_reason(notam.text),
        "category": detect_category(notam.text),
        "category_label": CATEGORIES.get(detect_category(notam.text), CATEGORIES["OTHER"])["label"],
        "severity": get_severity(notam),
        "human_summary": generate_summary(notam),
        "expanded_text": expand_abbreviations(notam.text),
    }
