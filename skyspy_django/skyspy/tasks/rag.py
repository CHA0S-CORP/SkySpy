"""
Celery tasks for the airframe RAG index.

Rebuilds/embeds airframe dossiers when the underlying AircraftInfo changes.
The refresh walks recently-updated aircraft and (re)indexes them; the index
step skips re-embedding when a dossier's text is unchanged.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from skyspy.tasks.locks import singleton_task

logger = logging.getLogger(__name__)


@shared_task
def index_airframe_document(icao_hex: str, force: bool = False) -> dict:
    """Index a single airframe dossier (on-demand)."""
    from skyspy.services import airframe_rag

    return airframe_rag.index_aircraft(icao_hex, force=force)


@shared_task
@singleton_task(timeout=1800)
def refresh_airframe_documents(batch_size: int = 200, lookback_hours: int = 25) -> dict:
    """
    Re-index dossiers for aircraft whose info changed recently.

    Runs daily after the info-refresh tasks; only aircraft updated within
    ``lookback_hours`` are considered, so steady-state runs are cheap. Unchanged
    dossiers are skipped without re-embedding.
    """
    from skyspy.models import AircraftInfo
    from skyspy.services import airframe_rag

    cutoff = timezone.now() - timedelta(hours=lookback_hours)
    candidates = (
        AircraftInfo.objects.filter(fetch_failed=False, updated_at__gte=cutoff)
        .values_list("icao_hex", flat=True)
        .order_by("-updated_at")[:batch_size]
    )

    counts = {"indexed": 0, "unchanged": 0, "stored_no_embedding": 0, "missing": 0}
    for icao in candidates:
        try:
            status = airframe_rag.index_aircraft(icao)["status"]
            counts[status] = counts.get(status, 0) + 1
        except Exception as e:  # broad: per-item guard; one failure must not stop the batch
            logger.warning(f"Airframe indexing failed for {icao}: {e}")

    logger.info(f"Airframe RAG refresh: {counts}")
    return counts
