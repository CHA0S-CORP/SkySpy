"""
Celery tasks for syncing aircraft incident/accident records (NTSB).

Incidents are slow-changing public records, so we enrich lazily: a periodic
task walks known airframes that have a registration and no recent incident
check, and upserts their NTSB records. Guarded by ``singleton_task`` so an
overrun never stacks.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from skyspy.tasks.locks import singleton_task

logger = logging.getLogger(__name__)

# Re-check an airframe's incidents at most this often (records rarely change).
INCIDENT_REFRESH_DAYS = 30


@shared_task
def sync_incidents_for_aircraft(registration: str, icao_hex: str | None = None) -> dict:
    """Sync NTSB incidents for a single registration (on-demand)."""
    from skyspy.services import incidents

    count = incidents.sync_incidents_for_registration(registration, icao_hex)
    return {"registration": registration, "synced": count}


@shared_task
@singleton_task(timeout=1800)
def refresh_aircraft_incidents(batch_size: int = 50) -> dict:
    """
    Periodically enrich incidents for tracked airframes.

    Picks registrations that have never been checked or whose newest incident
    row is older than INCIDENT_REFRESH_DAYS, oldest-first, and syncs a batch.
    """
    from skyspy.models import AircraftIncident, AircraftInfo

    cutoff = timezone.now() - timedelta(days=INCIDENT_REFRESH_DAYS)

    # Registrations already checked recently (skip them this pass).
    recently_checked = set(
        AircraftIncident.objects.filter(source="ntsb", updated_at__gte=cutoff).values_list("registration", flat=True)
    )

    candidates = (
        AircraftInfo.objects.exclude(registration__isnull=True)
        .exclude(registration="")
        .exclude(registration__in=recently_checked)
        .values_list("registration", "icao_hex")
        .order_by("updated_at")[:batch_size]
    )

    checked = 0
    found = 0
    for registration, icao_hex in candidates:
        try:
            found += sync_incidents_for_aircraft.run(registration, icao_hex)["synced"]
            checked += 1
        except Exception as e:  # broad: per-item guard; one bad reg must not stop the batch
            logger.warning(f"Incident sync failed for {registration}: {e}")

    logger.info(f"Incident refresh: checked {checked} airframes, upserted {found} incident(s)")
    return {"checked": checked, "incidents": found}
