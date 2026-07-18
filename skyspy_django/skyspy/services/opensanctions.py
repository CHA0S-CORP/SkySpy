"""
OpenSanctions screening — flag aircraft owners appearing on sanctions / PEP /
watchlists.

Feeds a risk signal into ``registration_analysis``. Uses the hosted
OpenSanctions match API (https://www.opensanctions.org/api/), which requires an
API key and is free for non-commercial use. Disabled by default: when
``OPENSANCTIONS_ENABLED`` is off (or no key), ``screen_owner`` returns None and
callers behave exactly as before.

Results are cached aggressively — sanctions lists change slowly and owner names
repeat across an airframe's sightings.
"""

import logging

from django.conf import settings
from django.core.cache import cache

from skyspy.services import http_client

logger = logging.getLogger(__name__)

SOURCE = "opensanctions"
_CACHE_TTL = 60 * 60 * 24  # 1 day
# Score at/above which we treat the top hit as a real match.
_MATCH_THRESHOLD = 0.70


def _is_enabled() -> bool:
    return bool(getattr(settings, "OPENSANCTIONS_ENABLED", False) and getattr(settings, "OPENSANCTIONS_API_KEY", ""))


def screen_owner(name: str) -> dict | None:
    """
    Screen an owner name against sanctions/PEP/watchlists.

    Returns a compact dict {matched, score, caption, topics, datasets} on a hit,
    a dict with matched=False when clean, or None when the feature is disabled or
    the lookup could not be performed.
    """
    if not _is_enabled():
        return None

    name = (name or "").strip()
    if not name:
        return None

    cache_key = f"opensanctions_{name.upper()}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached or None  # empty dict cached as a negative/unavailable result

    base = getattr(settings, "OPENSANCTIONS_API_URL", "https://api.opensanctions.org").rstrip("/")
    scope = getattr(settings, "OPENSANCTIONS_DATASET", "default")
    key = getattr(settings, "OPENSANCTIONS_API_KEY", "")

    payload = http_client.post_json(
        f"{base}/match/{scope}",
        {"queries": {"owner": {"schema": "LegalEntity", "properties": {"name": [name]}}}},
        source=SOURCE,
        headers={"Authorization": f"ApiKey {key}"},
        timeout=12.0,
    )

    results = None
    if isinstance(payload, dict):
        responses = payload.get("responses")
        if isinstance(responses, dict) and isinstance(responses.get("owner"), dict):
            results = responses["owner"].get("results")

    if results is None:
        # Network/auth failure — cache a short negative so we don't hammer on
        # every sighting, but don't poison the day-long cache with a real "clean".
        cache.set(cache_key, {}, 60 * 10)
        return None

    top = results[0] if results else None
    if not top:
        clean = {"matched": False, "score": 0.0, "caption": None, "topics": [], "datasets": []}
        cache.set(cache_key, clean, _CACHE_TTL)
        return clean

    score = float(top.get("score") or 0.0)
    matched = bool(top.get("match")) or score >= _MATCH_THRESHOLD
    result = {
        "matched": matched,
        "score": round(score, 3),
        "caption": top.get("caption"),
        "topics": top.get("topics") or [],
        "datasets": top.get("datasets") or [],
    }
    cache.set(cache_key, result, _CACHE_TTL)
    return result
