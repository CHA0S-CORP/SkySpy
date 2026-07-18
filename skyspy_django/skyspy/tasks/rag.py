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


@shared_task
def index_rag_document(kind: str, ref_id: str, force: bool = False) -> str:
    """Index a single non-airframe source row (ACARS/NOTAM/PIREP) on-demand."""
    from skyspy.models import AcarsMessage, CachedNotam, CachedPirep, RagDocument
    from skyspy.services import rag

    if kind == RagDocument.KIND_ACARS:
        row = AcarsMessage.objects.filter(pk=ref_id).first()
        return rag.index_acars_message(row, force=force) if row else "missing"
    if kind == RagDocument.KIND_NOTAM:
        row = CachedNotam.objects.filter(notam_id=ref_id).first()
        return rag.index_notam(row, force=force) if row else "missing"
    if kind == RagDocument.KIND_PIREP:
        row = CachedPirep.objects.filter(pirep_id=ref_id).first()
        return rag.index_pirep(row, force=force) if row else "missing"
    return "unknown_kind"


@shared_task
@singleton_task(timeout=1800)
def refresh_rag_documents(batch_size: int = 300, lookback_hours: int = 25) -> dict:
    """
    Embed recently-ingested ACARS messages, NOTAMs, PIREPs, safety events and
    NTSB incidents into the generic RAG index so the assistant can
    semantic-search their content.

    Only rows touched within ``lookback_hours`` are considered and unchanged
    documents are skipped without re-embedding, so steady-state runs are cheap.
    Empty-text rows (e.g. ACARS with no free text) index as "empty" and are
    counted but not embedded.
    """
    from skyspy.models import AcarsMessage, AircraftIncident, CachedNotam, CachedPirep, SafetyEvent
    from skyspy.services import rag

    cutoff = timezone.now() - timedelta(hours=lookback_hours)
    counts = {}

    def _run(rows, indexer):
        for row in rows:
            try:
                status = indexer(row)
                counts[status] = counts.get(status, 0) + 1
            except Exception as e:  # broad: per-item guard; one failure must not stop the batch
                logger.warning(f"RAG indexing failed for {row}: {e}")

    _run(
        AcarsMessage.objects.filter(timestamp__gte=cutoff)
        .exclude(text__isnull=True)
        .exclude(text="")
        .order_by("-timestamp")[:batch_size],
        rag.index_acars_message,
    )
    _run(
        CachedNotam.objects.filter(fetched_at__gte=cutoff, is_archived=False).order_by("-fetched_at")[:batch_size],
        rag.index_notam,
    )
    _run(
        CachedPirep.objects.filter(fetched_at__gte=cutoff).order_by("-fetched_at")[:batch_size],
        rag.index_pirep,
    )
    _run(
        SafetyEvent.objects.filter(timestamp__gte=cutoff).order_by("-timestamp")[:batch_size],
        rag.index_safety_event,
    )
    # Incidents are keyed on fetch time (their historical event_date can be years old).
    _run(
        AircraftIncident.objects.filter(fetched_at__gte=cutoff).order_by("-fetched_at")[:batch_size],
        rag.index_incident,
    )

    logger.info(f"RAG document refresh: {counts}")
    return counts
