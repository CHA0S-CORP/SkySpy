"""
PIREP (Pilot Report) decoder service.

Translates aviation abbreviations and codes into human-readable format.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from skyspy.models import CachedPirep

# Turbulence intensity codes and descriptions
TURBULENCE_CODES = {
    "NEG": {"label": "None", "level": 0, "description": "Smooth flight, no turbulence reported"},
    "SMTH": {"label": "Smooth", "level": 0, "description": "Smooth flight, no turbulence reported"},
    "LGT": {"label": "Light", "level": 1, "description": "Slight, erratic changes in altitude/attitude"},
    "LGT-MOD": {
        "label": "Light to Moderate",
        "level": 2,
        "description": "Changes in altitude/attitude, aircraft remains in control",
    },
    "MOD": {"label": "Moderate", "level": 3, "description": "Causes rapid bumps, aircraft remains in positive control"},
    "MOD-SEV": {
        "label": "Moderate to Severe",
        "level": 4,
        "description": "Large, abrupt changes, large airspeed variations",
    },
    "SEV": {"label": "Severe", "level": 5, "description": "Aircraft may be momentarily out of control"},
    "EXTRM": {
        "label": "Extreme",
        "level": 6,
        "description": "Aircraft violently tossed, practically impossible to control",
    },
}

# Turbulence type codes
TURBULENCE_TYPES = {
    "CAT": "Clear Air Turbulence",
    "CHOP": "Chop",
    "LLWS": "Low Level Wind Shear",
    "MWAVE": "Mountain Wave",
}

# Icing intensity codes and descriptions
ICING_CODES = {
    "NEG": {"label": "None", "level": 0, "description": "No icing observed"},
    "TRC": {
        "label": "Trace",
        "level": 1,
        "description": "Ice becomes noticeable, rate of accumulation slightly greater than sublimation",
    },
    "TRC-LGT": {"label": "Trace to Light", "level": 1, "description": "Light ice accumulation beginning"},
    "LGT": {"label": "Light", "level": 2, "description": "May create problem with prolonged exposure (>1hr)"},
    "LGT-MOD": {"label": "Light to Moderate", "level": 2, "description": "Ice accumulation rate increasing"},
    "MOD": {
        "label": "Moderate",
        "level": 3,
        "description": "Short encounters potentially hazardous, use of de-icing/anti-icing recommended",
    },
    "MOD-SEV": {
        "label": "Moderate to Severe",
        "level": 4,
        "description": "Significant ice buildup, immediate action required",
    },
    "SEV": {
        "label": "Severe",
        "level": 5,
        "description": "De-icing/anti-icing equipment fails to reduce or control hazard",
    },
}

# Icing type codes
ICING_TYPES = {
    "RIME": {"label": "Rime", "description": "Rough, milky, opaque ice formed in supercooled droplets"},
    "CLR": {"label": "Clear", "description": "Smooth, glossy, transparent ice, harder to remove"},
    "MXD": {"label": "Mixed", "description": "Combination of rime and clear ice"},
}

# Wind shear intensity codes
WIND_SHEAR_CODES = {
    "NEG": {"label": "None", "level": 0, "description": "No wind shear observed"},
    "LGT": {"label": "Light", "level": 1, "description": "Airspeed changes 15-25kt"},
    "MOD": {"label": "Moderate", "level": 2, "description": "Airspeed changes 25-40kt"},
    "SEV": {"label": "Severe", "level": 3, "description": "Airspeed changes >40kt, potential loss of control"},
}

# Severity level to category mapping
SEVERITY_CATEGORIES = {
    0: "routine",
    1: "routine",
    2: "caution",
    3: "hazardous",
    4: "hazardous",
    5: "severe",
    6: "severe",
}


def decode_turbulence(pirep: CachedPirep) -> dict | None:
    """Decode turbulence information from a PIREP."""
    turb_type = pirep.turbulence_type
    if not turb_type:
        return None

    turb_upper = turb_type.upper()

    # Check for compound codes first (e.g., LGT-MOD, MOD-SEV)
    intensity_info = None
    compound_codes = ["LGT-MOD", "MOD-SEV"]
    for code in compound_codes:
        if code in turb_upper:
            intensity_info = {"code": code, **TURBULENCE_CODES[code]}
            break

    # If no compound code found, check single codes
    if not intensity_info:
        for code, info in TURBULENCE_CODES.items():
            if "-" in code:  # Skip compound codes in this pass
                continue
            if code in turb_upper and (intensity_info is None or info["level"] > intensity_info["level"]):
                intensity_info = {"code": code, **info}

    if not intensity_info:
        intensity_info = {"code": turb_type, "label": turb_type, "level": 0, "description": ""}

    # Check for turbulence type
    turb_category = None
    for type_code, type_label in TURBULENCE_TYPES.items():
        if type_code in turb_upper:
            turb_category = {"code": type_code, "label": type_label}
            break

    result = {
        "code": intensity_info["code"],
        "label": intensity_info["label"],
        "level": intensity_info["level"],
        "description": intensity_info["description"],
    }

    if turb_category:
        result["type"] = turb_category

    # Add altitude range if available
    if pirep.turbulence_base_ft is not None or pirep.turbulence_top_ft is not None:
        result["altitude_range"] = {
            "base_ft": pirep.turbulence_base_ft,
            "top_ft": pirep.turbulence_top_ft,
        }

    if pirep.turbulence_freq:
        result["frequency"] = pirep.turbulence_freq

    return result


def decode_icing(pirep: CachedPirep) -> dict | None:
    """Decode icing information from a PIREP."""
    icing_type = pirep.icing_type
    icing_intensity = pirep.icing_intensity

    if not icing_type and not icing_intensity:
        return None

    # Parse intensity
    ice_upper = (icing_type or icing_intensity or "").upper()

    # Check for compound codes first (e.g., TRC-LGT, LGT-MOD, MOD-SEV)
    intensity_info = None
    compound_codes = ["TRC-LGT", "LGT-MOD", "MOD-SEV"]
    for code in compound_codes:
        if code in ice_upper:
            intensity_info = {"code": code, **ICING_CODES[code]}
            break

    # If no compound code found, check single codes
    if not intensity_info:
        for code, info in ICING_CODES.items():
            if "-" in code:  # Skip compound codes in this pass
                continue
            if code in ice_upper and (intensity_info is None or info["level"] > intensity_info["level"]):
                intensity_info = {"code": code, **info}

    if not intensity_info:
        intensity_info = {
            "code": icing_type or icing_intensity,
            "label": icing_type or icing_intensity,
            "level": 0,
            "description": "",
        }

    # Check for ice type
    ice_type_info = None
    for type_code, type_info in ICING_TYPES.items():
        if type_code in ice_upper:
            ice_type_info = {"code": type_code, **type_info}
            break

    result = {
        "code": intensity_info["code"],
        "label": intensity_info["label"],
        "level": intensity_info["level"],
        "description": intensity_info["description"],
    }

    if ice_type_info:
        result["type"] = ice_type_info

    # Add altitude range if available
    if pirep.icing_base_ft is not None or pirep.icing_top_ft is not None:
        result["altitude_range"] = {
            "base_ft": pirep.icing_base_ft,
            "top_ft": pirep.icing_top_ft,
        }

    return result


def decode_wind_shear(pirep: CachedPirep) -> dict | None:
    """Decode wind shear information from a PIREP (if present in raw text)."""
    raw_text = pirep.raw_text or ""
    raw_upper = raw_text.upper()

    # Check for wind shear indicators
    if "LLWS" not in raw_upper and "/WS" not in raw_upper and "WSHFT" not in raw_upper:
        return None

    # Try to extract wind shear details
    intensity_info = None
    for code, info in WIND_SHEAR_CODES.items():
        if code in raw_upper:
            intensity_info = {"code": code, **info}
            break

    if not intensity_info:
        # Default to moderate if wind shear is reported but intensity not specified
        intensity_info = {"code": "MOD", **WIND_SHEAR_CODES["MOD"]}

    result = {
        "code": intensity_info["code"],
        "label": intensity_info["label"],
        "level": intensity_info["level"],
        "description": intensity_info["description"],
        "reported": True,
    }

    # Check for gain/loss
    if "+LLWS" in raw_upper or "GAIN" in raw_upper:
        result["gain_loss"] = "gain"
    elif "-LLWS" in raw_upper or "LOSS" in raw_upper:
        result["gain_loss"] = "loss"

    return result


def get_max_severity(pirep: CachedPirep) -> str:
    """Get the maximum severity level from a PIREP as a category string."""
    turb = decode_turbulence(pirep)
    icing = decode_icing(pirep)
    ws = decode_wind_shear(pirep)

    levels = []
    if turb:
        levels.append(turb["level"])
    if icing:
        levels.append(icing["level"])
    if ws:
        levels.append(ws["level"])

    # Urgent PIREPs are at least hazardous
    if pirep.report_type == "UUA":
        levels.append(4)

    max_level = max(levels) if levels else 0
    return SEVERITY_CATEGORIES.get(max_level, "routine")


def list_hazards(pirep: CachedPirep) -> list[str]:
    """List all hazards present in a PIREP."""
    hazards = []

    turb = decode_turbulence(pirep)
    if turb and turb["level"] > 0:
        hazards.append("turbulence")

    icing = decode_icing(pirep)
    if icing and icing["level"] > 0:
        hazards.append("icing")

    ws = decode_wind_shear(pirep)
    if ws:
        hazards.append("wind_shear")

    return hazards


def generate_summary(pirep: CachedPirep) -> str:
    """Generate a human-readable summary of a PIREP."""
    parts = []

    # Report type
    if pirep.report_type == "UUA":
        parts.append("URGENT:")

    turb = decode_turbulence(pirep)
    if turb and turb["level"] > 0:
        turb_text = turb["label"].lower() + " turbulence"
        if turb.get("type"):
            turb_text += f" ({turb['type']['label']})"
        parts.append(turb_text)

    icing = decode_icing(pirep)
    if icing and icing["level"] > 0:
        icing_text = icing["label"].lower() + " icing"
        if icing.get("type"):
            icing_text = icing["label"].lower() + " " + icing["type"]["label"].lower() + " icing"
        parts.append(icing_text)

    ws = decode_wind_shear(pirep)
    if ws:
        parts.append("wind shear reported")

    # Add altitude
    altitude_text = ""
    if pirep.flight_level:
        altitude_text = f" at FL{pirep.flight_level}"
    elif pirep.altitude_ft:
        altitude_text = f" at {pirep.altitude_ft:,}ft"

    if not parts:
        return "Routine pilot report" + altitude_text

    # Capitalize first part
    summary = ", ".join(parts)
    summary = summary[0].upper() + summary[1:] if summary else ""

    return summary + altitude_text


def decode_pirep(pirep: CachedPirep) -> dict[str, Any]:
    """
    Decode a PIREP into human-readable format.

    Returns a dictionary with:
    - turbulence: Decoded turbulence info (if present)
    - icing: Decoded icing info (if present)
    - wind_shear: Decoded wind shear info (if present)
    - severity: Overall severity category (routine/caution/hazardous/severe)
    - human_summary: Human-readable summary string
    - hazards: List of hazard types present
    """
    return {
        "turbulence": decode_turbulence(pirep),
        "icing": decode_icing(pirep),
        "wind_shear": decode_wind_shear(pirep),
        "severity": get_max_severity(pirep),
        "human_summary": generate_summary(pirep),
        "hazards": list_hazards(pirep),
    }
