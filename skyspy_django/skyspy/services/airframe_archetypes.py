"""
Premade airframe *diagram* sketches for auto-generated type cards.

The LLM is good at facts, bad at drawing. So it never emits SVG or free-form
geometry — it picks one **archetype** from the fixed table below (or emits a
loose ``shape`` dict that we snap onto the nearest legal one). Each archetype is
a ready-made ``<Planform>`` descriptor: the same ``{kind, engines, mount, tail,
sweep, wing, blades}`` vocabulary the curated static library uses, so the
front-end renders an auto card's blueprint through the identical code path.

``ARCHETYPES`` is the menu shown to the model; ``coerce_shape()`` is the guard
that guarantees whatever comes back is renderable.
"""

# ---------------------------------------------------------------------------
# <Planform> shape vocabulary (must match web/.../Planform.jsx + airframesData)
# ---------------------------------------------------------------------------
KINDS = {"jet", "prop", "fighter", "heli"}
MOUNTS = {"wing", "nose", "aft"}
TAILS = {"std", "t", "twin"}
WINGS = {"high", "low"}

# Front-end category ids (web/.../airframesData.js CATEGORIES).
CATEGORIES = {"airliner", "regional", "bizjet", "turboprop", "ga", "military", "rotor"}

# Premade sketches. id -> {label (for the LLM menu), category, shape}. The
# ``shape`` is a complete, renderable <Planform> descriptor.
ARCHETYPES = {
    # ── Jets ────────────────────────────────────────────────────────────────
    "narrowbody_twin_jet": {
        "label": "Narrowbody airliner, 2 underwing turbofans, swept low wing (A320/737)",
        "category": "airliner",
        "shape": {"kind": "jet", "engines": 2, "mount": "wing", "tail": "std", "sweep": 25, "wing": "low"},
    },
    "widebody_twin_jet": {
        "label": "Widebody airliner, 2 large underwing turbofans, highly swept low wing (777/A350/787)",
        "category": "airliner",
        "shape": {"kind": "jet", "engines": 2, "mount": "wing", "tail": "std", "sweep": 32, "wing": "low"},
    },
    "widebody_quad_jet": {
        "label": "Four-engine widebody, underwing turbofans (747/A380/A340)",
        "category": "airliner",
        "shape": {"kind": "jet", "engines": 4, "mount": "wing", "tail": "std", "sweep": 33, "wing": "low"},
    },
    "regional_jet_aft": {
        "label": "Regional jet, 2 rear-fuselage turbofans, T-tail (CRJ/ERJ135)",
        "category": "regional",
        "shape": {"kind": "jet", "engines": 2, "mount": "aft", "tail": "t", "sweep": 24, "wing": "low"},
    },
    "regional_jet_wing": {
        "label": "Regional jet, 2 underwing turbofans (E-Jet/A220)",
        "category": "regional",
        "shape": {"kind": "jet", "engines": 2, "mount": "wing", "tail": "std", "sweep": 26, "wing": "low"},
    },
    "bizjet_twin_aft": {
        "label": "Business jet, 2 rear-fuselage turbofans, T-tail (Citation/Learjet/Gulfstream)",
        "category": "bizjet",
        "shape": {"kind": "jet", "engines": 2, "mount": "aft", "tail": "t", "sweep": 25, "wing": "low"},
    },
    "bizjet_tri_aft": {
        "label": "Large-cabin trijet, 3 rear-fuselage engines, T-tail (Falcon 7X/900)",
        "category": "bizjet",
        "shape": {"kind": "jet", "engines": 3, "mount": "aft", "tail": "t", "sweep": 27, "wing": "low"},
    },
    # ── Turboprops ──────────────────────────────────────────────────────────
    "turboprop_regional_high": {
        "label": "Regional turboprop, 2 wing turboprops, high wing, T-tail (Dash-8/ATR)",
        "category": "turboprop",
        "shape": {"kind": "prop", "engines": 2, "mount": "wing", "tail": "t", "wing": "high"},
    },
    "turboprop_regional_low": {
        "label": "Regional turboprop, 2 wing turboprops, low wing (Saab 340/Metroliner)",
        "category": "turboprop",
        "shape": {"kind": "prop", "engines": 2, "mount": "wing", "tail": "std", "wing": "low"},
    },
    "turboprop_single_low": {
        "label": "Single-engine turboprop, nose prop, low wing (TBM/PC-12/Meridian)",
        "category": "turboprop",
        "shape": {"kind": "prop", "engines": 1, "mount": "nose", "tail": "std", "wing": "low"},
    },
    "utility_single_high": {
        "label": "Single-engine utility, nose engine, high wing (Caravan/Cessna 206)",
        "category": "turboprop",
        "shape": {"kind": "prop", "engines": 1, "mount": "nose", "tail": "std", "wing": "high"},
    },
    "twin_turboprop_biz": {
        "label": "Twin turboprop, 2 wing engines, low wing (King Air)",
        "category": "turboprop",
        "shape": {"kind": "prop", "engines": 2, "mount": "wing", "tail": "std", "wing": "low"},
    },
    # ── General aviation (piston) ───────────────────────────────────────────
    "ga_single_high": {
        "label": "Light single piston, nose prop, high wing (Cessna 172/152/182)",
        "category": "ga",
        "shape": {"kind": "prop", "engines": 1, "mount": "nose", "tail": "std", "wing": "high"},
    },
    "ga_single_low": {
        "label": "Light single piston, nose prop, low wing (Cirrus SR22/Piper PA-28)",
        "category": "ga",
        "shape": {"kind": "prop", "engines": 1, "mount": "nose", "tail": "std", "wing": "low"},
    },
    "ga_twin_piston": {
        "label": "Light twin piston, 2 wing engines, low wing (Baron/Seneca)",
        "category": "ga",
        "shape": {"kind": "prop", "engines": 2, "mount": "wing", "tail": "std", "wing": "low"},
    },
    # ── Military ────────────────────────────────────────────────────────────
    "military_transport_prop": {
        "label": "Military transport, 4 wing turboprops, high wing, T-tail (C-130)",
        "category": "military",
        "shape": {"kind": "prop", "engines": 4, "mount": "wing", "tail": "t", "wing": "high"},
    },
    "military_transport_jet": {
        "label": "Military jet transport/tanker, underwing turbofans, high wing (C-17/KC-135)",
        "category": "military",
        "shape": {"kind": "jet", "engines": 4, "mount": "wing", "tail": "t", "sweep": 25, "wing": "high"},
    },
    "fighter_twin": {
        "label": "Fighter, twin afterburning engines, twin tail, highly swept (F-15/F-18/Su-27)",
        "category": "military",
        "shape": {"kind": "fighter", "engines": 2, "mount": "aft", "tail": "twin", "sweep": 40},
    },
    "fighter_single": {
        "label": "Fighter, single afterburning engine, single tail, swept (F-16/F-35/Gripen)",
        "category": "military",
        "shape": {"kind": "fighter", "engines": 1, "mount": "aft", "tail": "std", "sweep": 40},
    },
    # ── Rotorcraft ──────────────────────────────────────────────────────────
    "heli_light_2blade": {
        "label": "Light helicopter, 2-blade main rotor (R44/Bell 206)",
        "category": "rotor",
        "shape": {"kind": "heli", "blades": 2},
    },
    "heli_medium_4blade": {
        "label": "Medium helicopter, 4-blade main rotor (UH-60/AS365/EC145)",
        "category": "rotor",
        "shape": {"kind": "heli", "blades": 4},
    },
    "heli_heavy_multi": {
        "label": "Heavy helicopter, 5+ blade main rotor (S-92/AW139/CH-53)",
        "category": "rotor",
        "shape": {"kind": "heli", "blades": 5},
    },
}

# Fallback archetype per category when the model gives us nothing usable.
_CATEGORY_DEFAULT = {
    "airliner": "narrowbody_twin_jet",
    "regional": "regional_jet_aft",
    "bizjet": "bizjet_twin_aft",
    "turboprop": "turboprop_regional_high",
    "ga": "ga_single_high",
    "military": "fighter_single",
    "rotor": "heli_medium_4blade",
}


def archetype_menu() -> str:
    """Bulleted archetype list for the LLM prompt (id — description)."""
    return "\n".join(f"- {aid}: {a['label']}" for aid, a in ARCHETYPES.items())


def _clamp(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def coerce_shape(raw: dict | None, *, archetype: str | None = None, category: str | None = None) -> dict:
    """
    Return a guaranteed-renderable ``<Planform>`` shape.

    Priority: an explicit ``archetype`` id → its premade sketch; else a loose
    ``raw`` shape snapped field-by-field onto the legal vocabulary; else the
    per-category default. The result always has a valid ``kind`` and the fields
    that kind needs, so the front-end never sees a malformed descriptor.
    """
    # 1. Named archetype wins outright.
    if archetype and archetype in ARCHETYPES:
        return dict(ARCHETYPES[archetype]["shape"])

    raw = raw if isinstance(raw, dict) else {}
    kind = str(raw.get("kind", "")).lower().strip()

    # 2. No usable kind → fall back to the category default sketch.
    if kind not in KINDS:
        default_id = _CATEGORY_DEFAULT.get((category or "").lower(), "ga_single_high")
        return dict(ARCHETYPES[default_id]["shape"])

    # 3. Snap a loose but kind-valid shape onto the legal vocabulary.
    if kind == "heli":
        return {"kind": "heli", "blades": int(_clamp(raw.get("blades"), 2, 8, 4))}

    mount = str(raw.get("mount", "")).lower().strip()
    if mount not in MOUNTS:
        mount = "nose" if kind == "prop" else "wing"

    tail = str(raw.get("tail", "")).lower().strip()
    if tail not in TAILS:
        tail = "twin" if kind == "fighter" else "std"

    shape = {
        "kind": kind,
        "engines": int(_clamp(raw.get("engines"), 0, 4, 1 if mount == "nose" else 2)),
        "mount": mount,
        "tail": tail,
        "sweep": _clamp(raw.get("sweep"), 0, 55, 40 if kind == "fighter" else 25 if kind == "jet" else 0),
    }
    wing = str(raw.get("wing", "")).lower().strip()
    if wing in WINGS:
        shape["wing"] = wing
    return shape
