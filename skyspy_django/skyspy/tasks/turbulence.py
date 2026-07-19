"""
Per-aircraft turbulence risk scoring task.

Runs off the aircraft hot path: reads the ``current_aircraft`` cache blob that
the polling/stream tasks already maintain, scores each aircraft with a position
via :func:`skyspy.services.turbulence.assess_turbulence` (which shares a coarse
grid cache so nearby aircraft don't recompute), and writes a compact
``turb:by_hex`` map ``{HEX: {"score": int, "level": str}}`` to the cache with a
short TTL.

This NEVER touches ``poll_aircraft``, the ``current_aircraft`` blob, or the
Socket.IO stream — the map/alert layers read ``turb:by_hex`` separately.
"""

import logging

from celery import shared_task
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

CACHE_KEY_BY_HEX = "turb:by_hex"


@shared_task(ignore_result=True)
def score_aircraft_turbulence():
    """Score currently-tracked aircraft and cache per-hex turbulence risk."""
    if not getattr(settings, "TURB_ENABLED", True):
        return {"status": "disabled"}

    aircraft = cache.get("current_aircraft") or []
    if not aircraft:
        cache.set(CACHE_KEY_BY_HEX, {}, _ttl())
        return {"status": "empty", "scored": 0}

    # Lazy import keeps the module import light and avoids any circular deps.
    from skyspy.services.turbulence import assess_turbulence

    by_hex: dict[str, dict] = {}
    scored = 0
    for ac in aircraft:
        hex_code = (ac.get("hex") or "").strip().upper()
        if not hex_code:
            continue
        lat = ac.get("lat")
        lon = ac.get("lon")
        if lat is None or lon is None:
            continue
        alt = ac.get("alt_baro")
        if alt is None:
            alt = ac.get("alt")
        try:
            result = assess_turbulence(float(lat), float(lon), alt)
        except (ValueError, TypeError) as e:
            logger.debug("turbulence scoring skipped for %s: %s", hex_code, e)
            continue

        scored += 1
        # Only cache aircraft with a meaningful signal to keep the map compact.
        if result["level"] != "none":
            by_hex[hex_code] = {"score": result["score"], "level": result["level"]}

    cache.set(CACHE_KEY_BY_HEX, by_hex, _ttl())
    return {"status": "ok", "scored": scored, "flagged": len(by_hex)}


def _ttl() -> int:
    return int(getattr(settings, "TURB_SCORE_TTL", 180))
