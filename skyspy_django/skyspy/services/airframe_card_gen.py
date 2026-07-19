"""
Auto-generate reference-library cards for airframe *types* the station sees.

Pipeline (driven daily by ``tasks.airframe_cards.generate_airframe_type_cards``):

1. ``discover_new_types`` — distinct ICAO type designators we've actually tracked
   that are absent from BOTH the curated static library (``CURATED_TYPE_CODES``)
   and the ``AirframeTypeCard`` table, gated on a minimum distinct-tail count so
   we don't burn LLM calls on one-off mis-decodes.
2. ``generate_card`` — ask the LLM for the type's facts + a diagram *archetype*
   (it never draws — see ``airframe_archetypes``), validate/clamp everything,
   pick a representative cached photo, and return an ``AirframeTypeCard``-shaped
   dict.
3. ``store_card`` — upsert the row.

Everything degrades gracefully: no LLM → no-op; an unrecognised type → a low-
confidence "stub" card carrying whatever we already knew plus a generic sketch.
"""

import json
import logging

from django.conf import settings

from skyspy.services import airframe_archetypes as arch
from skyspy.services import web_search
from skyspy.services.llm import llm_client

logger = logging.getLogger(__name__)

# ICAO type designators already in the curated static library
# (web/src/components/v2/screens/airframes/airframesData.js). Kept here so the
# daily job doesn't regenerate a card the front-end would hide anyway (static
# always wins the merge). Keep roughly in sync when the static library grows;
# drift only costs one wasted LLM call per new static type, once.
CURATED_TYPE_CODES = frozenset(
    """
    A320 B738 A359 B77W B789 A388 E75L CRJ9 AT76 DH8D C208 PC12 BE20 GLF6 C25C C172 SR22 F16 F18
    C130 K35R A10 H60 B06 R44 B38M B737 A21N P28A A321 B739 B39M A20N AS50 B763 A319 C152 C182
    E55P C72R E135 CRJ7 CL35 EC30 A332 BCS3 SR20 B752 CL60 BE35 GLF4 DA40 S22T CL30 C56X P28R
    M20P GLF5 GLEX G280 EC35 B407 B753 E545 C150 C750 C82S C700 PA44 C68A B744 GL5T B748 BE36
    B350 A333 SLG4 C82T E145 A35K SW4 PA24 F900 B77L C30J BCS1 T206 SF50 GL7T C550 B788 B772
    C680 P28B E50P P46T A339 H500 C25B P06T R22 RV4 A139 A306 B429 B78X BE30 BE33 BE76 BE99 C162
    C210 C25M C421 C82R DA42 E170 E35L EC45 F2TH FA50 FA7X G2T1 GA6C GA7C H25B H47 H53S P32R PA23
    R66 RV7 TBM7 UH1 V22 WAIX GA8 GALX C560 C525 GLAS C510 C414 C340 GLST TB20 V10 C240 TL30 C206
    HDJT HR20 HROC J328 L8 LJ31 LJ75 LNC2 C180 M4 MD87 MU2 NAVI C177 P208 P210 C17 BE9T BE9L P3
    U16 BE95 PA18 PA22 U2 B764 PA30 PA31 PA32 B762 PA46 B734 PIAT PRM1 PTS2 Q9 B412 B37M YK52
    A109 RV6 ULAC RV8 RV9 S108 B212 S76 B190 E550 E75S EAGL E190 DHC6 SLG2 AS65 F35 CRUZ AS32
    AS30 FDCT G150 CRJ2 AC11 GA5C AA5 T210
    """.split()  # noqa: SIM905 — readable multi-line source mirrors airframesData.js
)


def _norm_type(code: str | None) -> str:
    return (code or "").upper().strip()


def discover_new_types(limit: int = 8, min_tails: int = 1, lookback_hours: int | None = None) -> list[dict]:
    """
    Type designators we've tracked but have no card for yet.

    Returns ``[{"type_code", "tail_count", "sample": AircraftInfo}, ...]`` sorted
    by tail_count desc (most-seen first) — bounded to ``limit``. A type qualifies
    only if it is absent from the curated library AND the ``AirframeTypeCard``
    table AND has at least ``min_tails`` distinct tracked tails.
    """
    from datetime import timedelta

    from django.db.models import Count
    from django.utils import timezone

    from skyspy.models import AircraftInfo, AircraftSession, AirframeTypeCard

    seen = AircraftSession.objects.all()
    if lookback_hours:
        seen = seen.filter(last_seen__gte=timezone.now() - timedelta(hours=lookback_hours))
    seen_hexes = seen.values_list("icao_hex", flat=True).distinct()

    rows = (
        AircraftInfo.objects.filter(icao_hex__in=seen_hexes)
        .exclude(type_code__isnull=True)
        .exclude(type_code="")
        .values("type_code")
        .annotate(n=Count("icao_hex", distinct=True))
        .filter(n__gte=max(1, min_tails))
        .order_by("-n")
    )

    have = {_norm_type(c) for c in AirframeTypeCard.objects.values_list("type_code", flat=True)}
    out = []
    for r in rows:
        tc = _norm_type(r["type_code"])
        if not tc or tc in CURATED_TYPE_CODES or tc in have:
            continue
        sample = (
            AircraftInfo.objects.filter(type_code__iexact=tc, icao_hex__in=seen_hexes)
            .exclude(manufacturer__isnull=True)
            .exclude(manufacturer="")
            .first()
            or AircraftInfo.objects.filter(type_code__iexact=tc, icao_hex__in=seen_hexes).first()
        )
        out.append({"type_code": tc, "tail_count": r["n"], "sample": sample})
        if len(out) >= max(1, limit):
            break
    return out


def _pick_photo_hex(type_code: str) -> str | None:
    """A tracked tail of this type whose photo is cached, to represent the card."""
    from skyspy.models import AircraftInfo

    qs = AircraftInfo.objects.filter(type_code__iexact=type_code)
    # Prefer a locally/S3-cached photo (served via /api/v1/photos/<hex>).
    hit = (
        qs.exclude(photo_local_path__isnull=True)
        .exclude(photo_local_path="")
        .values_list("icao_hex", flat=True)
        .first()
    )
    if hit:
        return _norm_type(hit)
    # Else any tail with a known external photo URL — the serve view can backfill.
    hit = qs.exclude(photo_url__isnull=True).exclude(photo_url="").values_list("icao_hex", flat=True).first()
    return _norm_type(hit) if hit else None


_SYSTEM_PROMPT = (
    "You are an aviation reference librarian building a factual data card for one ICAO aircraft "
    "TYPE designator. You are given live WEB SOURCES fetched just now — base every figure on them "
    "wherever they cover it, and only fall back to your own knowledge for gaps. Return STRICT JSON "
    "only (no prose, no markdown fences). Use reference figures for a representative variant. Units "
    "are fixed: length_m/span_m/height_m in metres, mtow_kg in kilograms, cruise_kt in knots (true "
    "airspeed), range_nm in nautical miles, ceiling_ft in feet, first_flight is a 4-digit year.\n\n"
    "You do NOT draw. Pick the single best diagram archetype id from this menu — the renderer draws "
    "the blueprint from it:\n{menu}\n\n"
    "category must be one of: airliner, regional, bizjet, turboprop, ga, military, rotor.\n"
    "Set confidence to reflect how well the WEB SOURCES corroborate the figures (well-covered → "
    "0.7-0.95; thin/absent → lower). If neither the sources nor your knowledge identify the "
    "designator, set known=false and confidence<=0.2 and fill only what the hints imply.\n\n"
    "JSON schema:\n"
    '{{"known": bool, "name": str, "manufacturer": str, "category": str, "role": str, '
    '"length_m": num, "span_m": num, "height_m": num, "mtow_kg": num, "cruise_kt": num, '
    '"range_nm": num, "ceiling_ft": num, "first_flight": int, "archetype": str, '
    '"blurb": str, "powerplant": str, "variants": str, "wtc": str, "confidence": num}}\n'
    "blurb <= 280 chars. wtc like 'M — Medium'."
)


def _num(v, lo=None, hi=None):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f == 0:
        return None
    if lo is not None and f < lo:
        return None
    if hi is not None and f > hi:
        return None
    return f


def _parse_json(content: str) -> dict | None:
    text = (content or "").strip()
    if text.startswith("```"):
        # strip ```json ... ``` fences
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text.strip("`")
        if text.lstrip().lower().startswith("json"):
            text = text.lstrip()[4:]
    text = text.strip()
    # Tolerate leading/trailing junk around the object.
    if "{" in text and "}" in text:
        text = text[text.index("{") : text.rindex("}") + 1]
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


def _cache_type_photo(type_code: str, image_url: str) -> bool:
    """
    Download a public type photo into the photo cache under ``TYPE-<code>``.

    Served same-origin at ``/api/v1/photos/TYPE-<code>``. Returns True on success.
    """
    if not image_url:
        return False
    try:
        from skyspy.services import photo_cache

        path = photo_cache.download_photo(image_url, f"TYPE-{type_code}", is_thumbnail=False, force=True)
        return bool(path)
    except Exception as e:  # broad: photo caching is best-effort — external URL is the fallback
        logger.warning("Type-photo cache failed for %s: %s", type_code, e)
        return False


def _photo_fields(type_code: str, image: dict | None) -> dict:
    """Resolve a card's photo: prefer a fetched+cached public type photo, then the
    external URL, else a representative seen-tail's cached photo."""
    if image and image.get("url"):
        cached = _cache_type_photo(type_code, image["url"])
        return {
            "photo_url": (image.get("url") or "")[:1000] or None,
            "photo_full_url": (image.get("full") or image.get("url") or "")[:1000] or None,
            "photo_page": (image.get("page") or "")[:1000] or None,
            "photo_credit": (image.get("credit") or "")[:200] or None,
            "photo_cached": cached,
            "photo_icao_hex": None if cached else _pick_photo_hex(type_code),
        }
    return {
        "photo_url": None,
        "photo_full_url": None,
        "photo_page": None,
        "photo_credit": None,
        "photo_cached": False,
        "photo_icao_hex": _pick_photo_hex(type_code),
    }


def generate_card(type_code: str, sample=None) -> dict | None:
    """
    Build an ``AirframeTypeCard``-shaped dict for ``type_code`` via the LLM,
    grounded on a live web search and carrying a fetched public type photo.

    ``sample`` is an optional ``AircraftInfo`` of that type used to hint the model
    (manufacturer/model/type_name it already resolved). Returns None only if the
    LLM is unavailable or errors; an unrecognised type still yields a low-
    confidence stub dict.
    """
    type_code = _norm_type(type_code)
    if not type_code:
        return None
    if not llm_client.is_available():
        logger.debug("Airframe card-gen skipped for %s: LLM unavailable", type_code)
        return None

    hints = {}
    if sample is not None:
        for k in ("manufacturer", "model", "type_name", "category"):
            v = getattr(sample, k, None)
            if v:
                hints[k] = v

    # Live web search: grounding text + sources + a public lead photo.
    ctx = web_search.gather_airframe_context(type_code, hints) if web_search.is_enabled() else {}
    sources = ctx.get("sources", []) or []
    image = ctx.get("image")
    ctx_text = ctx.get("text") or "(no web sources found — rely on your own knowledge)"

    system = _SYSTEM_PROMPT.format(menu=arch.archetype_menu())
    user = (
        f"ICAO type designator: {type_code}\n"
        f"Hints (may be partial/wrong): {json.dumps(hints)}\n\n"
        f"WEB SOURCES (fetched now):\n{ctx_text}\n\n"
        "Return the JSON card."
    )
    result = llm_client.complete(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=700,
        temperature=0.1,
    )
    if not result or not result.get("content"):
        return None

    data = _parse_json(result["content"])
    if data is None:
        logger.warning("Airframe card-gen: unparseable JSON for %s", type_code)
        return {
            "type_code": type_code,
            "status": "failed",
            "shape": arch.coerce_shape(None, category=hints.get("category")),
            "sources": sources,
            "model_used": getattr(settings, "LLM_MODEL", None),
            **_photo_fields(type_code, image),
        }

    category = str(data.get("category", "")).lower().strip()
    if category not in arch.CATEGORIES:
        category = None

    shape = arch.coerce_shape(data.get("shape"), archetype=data.get("archetype"), category=category)
    known = bool(data.get("known", True))
    confidence = _num(data.get("confidence"), 0, 1)

    name = data.get("name") or hints.get("model") or hints.get("type_name") or type_code
    manufacturer = data.get("manufacturer") or hints.get("manufacturer") or None

    def _txt(v, cap):
        s = str(v).strip() if v else ""
        return s[:cap] or None

    card = {
        "type_code": type_code,
        "name": _txt(name, 120),
        "manufacturer": _txt(manufacturer, 120),
        "category": category,
        "role": _txt(data.get("role"), 120),
        "length_m": _num(data.get("length_m"), 1, 120),
        "span_m": _num(data.get("span_m"), 1, 120),
        "height_m": _num(data.get("height_m"), 1, 40),
        "mtow_kg": _num(data.get("mtow_kg"), 100, 700000),
        "cruise_kt": _num(data.get("cruise_kt"), 20, 700),
        "range_nm": _num(data.get("range_nm"), 10, 12000),
        "ceiling_ft": _num(data.get("ceiling_ft"), 1000, 80000),
        "first_flight": int(_num(data.get("first_flight"), 1900, 2100) or 0) or None,
        "shape": shape,
        "blurb": _txt(data.get("blurb"), 400),
        "powerplant": _txt(data.get("powerplant"), 200),
        "variants": _txt(data.get("variants"), 200),
        "wtc": _txt(data.get("wtc"), 40),
        "sources": sources,
        "confidence": confidence,
        "model_used": getattr(settings, "LLM_MODEL", None),
        "status": "generated" if (known and (confidence is None or confidence > 0.2)) else "stub",
        **_photo_fields(type_code, image),
    }
    return card


def store_card(card: dict) -> "object":
    """Upsert an ``AirframeTypeCard`` from a generate_card() dict."""
    from skyspy.models import AirframeTypeCard

    tc = _norm_type(card.get("type_code"))
    defaults = {k: v for k, v in card.items() if k != "type_code"}
    obj, _ = AirframeTypeCard.objects.update_or_create(type_code=tc, defaults=defaults)
    return obj
