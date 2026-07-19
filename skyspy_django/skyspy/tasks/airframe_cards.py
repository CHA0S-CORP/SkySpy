"""
Celery tasks for auto-generated airframe *type* cards.

``generate_airframe_type_cards`` runs daily: it discovers ICAO type designators
the station has tracked but has no reference card for, then has the LLM write a
factual card + pick a diagram archetype (see ``services.airframe_card_gen`` /
``services.airframe_archetypes``). Bounded per run so it back-fills the catalogue
a few types at a time instead of hammering the LLM.
"""

import logging

from celery import shared_task
from django.conf import settings

from skyspy.tasks.locks import singleton_task

logger = logging.getLogger(__name__)


@shared_task
def generate_airframe_type_card(type_code: str, force: bool = False) -> dict:
    """Generate/refresh a single type card on demand."""
    from skyspy.models import AirframeTypeCard
    from skyspy.services import airframe_card_gen as gen

    tc = (type_code or "").upper().strip()
    if not tc:
        return {"status": "skipped", "reason": "no_type_code"}
    if not force and AirframeTypeCard.objects.filter(type_code=tc).exists():
        return {"status": "exists", "type_code": tc}

    sample = None
    from skyspy.models import AircraftInfo

    sample = AircraftInfo.objects.filter(type_code__iexact=tc).exclude(manufacturer="").first()
    card = gen.generate_card(tc, sample=sample)
    if card is None:
        return {"status": "unavailable", "type_code": tc}
    obj = gen.store_card(card)
    return {"status": obj.status, "type_code": tc}


@shared_task
@singleton_task(timeout=1800)
def generate_airframe_type_cards(batch_size: int | None = None, min_tails: int | None = None) -> dict:
    """
    Back-fill reference cards for newly-seen airframe types (daily).

    No-op unless ``AIRFRAME_CARD_GEN_ENABLED`` and the LLM is configured.
    Processes at most ``batch_size`` types per run, most-seen first.
    """
    from skyspy.services import airframe_card_gen as gen
    from skyspy.services.llm import llm_client

    if not getattr(settings, "AIRFRAME_CARD_GEN_ENABLED", False):
        return {"status": "disabled"}
    if not llm_client.is_available():
        return {"status": "llm_unavailable"}

    batch_size = batch_size or getattr(settings, "AIRFRAME_CARD_GEN_BATCH", 8)
    min_tails = min_tails if min_tails is not None else getattr(settings, "AIRFRAME_CARD_GEN_MIN_TAILS", 1)

    candidates = gen.discover_new_types(limit=batch_size, min_tails=min_tails)
    counts = {"generated": 0, "stub": 0, "failed": 0, "unavailable": 0}
    for c in candidates:
        try:
            card = gen.generate_card(c["type_code"], sample=c["sample"])
            if card is None:
                counts["unavailable"] += 1
                continue
            card["seen_tail_count"] = c["tail_count"]
            obj = gen.store_card(card)
            counts[obj.status] = counts.get(obj.status, 0) + 1
        except Exception as e:  # broad: per-item guard; one bad type must not stop the batch
            logger.warning("Airframe card-gen failed for %s: %s", c.get("type_code"), e)
            counts["failed"] += 1

    logger.info("Airframe type-card generation: %s (candidates=%d)", counts, len(candidates))
    return {"status": "ok", "candidates": len(candidates), **counts}
