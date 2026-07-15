"""
Celery tasks for synchronizing law enforcement aircraft data from external sources.

Tasks:
- sync_le_external_sources: Daily sync of all enabled sources
- import_le_source: Import a specific source
- deduplicate_le_database: Deduplicate and merge records
"""

import logging

from celery import shared_task
from django.utils import timezone

from skyspy.models import LEDataSource
from skyspy.services.le_data_import import get_import_service

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=300)
def sync_le_external_sources(self, force: bool = False):
    """
    Sync all enabled external LE data sources.

    This task runs daily (configurable) and imports data from all
    enabled external sources that are due for update.

    Args:
        force: If True, force sync regardless of last fetch time
    """
    try:
        service = get_import_service()

        # Get all enabled sources
        sources = LEDataSource.objects.filter(fetch_enabled=True)

        if sources.count() == 0:
            # Initialize default sources if none exist
            logger.info("No data sources configured, initializing defaults...")
            for source_name in service.SOURCES:
                service.get_or_create_data_source(source_name)
            sources = LEDataSource.objects.filter(fetch_enabled=True)

        results = []
        for source in sources:
            # Check if source is due for update
            if not force and source.last_successful_fetch:
                hours_since = (timezone.now() - source.last_successful_fetch).total_seconds() / 3600
                if hours_since < source.update_frequency_hours:
                    logger.debug(
                        f"Skipping {source.name}: last fetched {hours_since:.1f}h ago "
                        f"(threshold: {source.update_frequency_hours}h)"
                    )
                    continue

            try:
                result = service.import_source(source.name, force=force)
                results.append(result.to_dict())

                if result.success:
                    logger.info(
                        f"Synced {source.name}: {result.records_imported} imported, {result.records_updated} updated"
                    )
                else:
                    logger.warning(f"Failed to sync {source.name}: {result.errors}")

            except Exception as e:  # broad: per-source guard so one source's failure doesn't stop the sync loop
                logger.exception(f"Error syncing {source.name}: {e}")
                results.append(
                    {
                        "source_name": source.name,
                        "success": False,
                        "errors": [str(e)],
                    }
                )

        return {
            "status": "completed",
            "sources_processed": len(results),
            "results": results,
        }

    except Exception as e:  # broad: Celery task top-level guard; retries the task on any failure
        logger.exception(f"Error in sync_le_external_sources: {e}")
        raise self.retry(exc=e)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def import_le_source(self, source_name: str, force: bool = False):
    """
    Import data from a specific external source.

    Args:
        source_name: Name of the source to import (must be in SOURCES)
        force: If True, import even if recently fetched
    """
    try:
        service = get_import_service()
        result = service.import_source(source_name, force=force)

        if result.success:
            logger.info(
                f"Imported {source_name}: {result.records_imported} new, "
                f"{result.records_updated} updated in {result.duration_seconds:.1f}s"
            )
        else:
            logger.warning(f"Import failed for {source_name}: {result.errors}")

        return result.to_dict()

    except Exception as e:  # broad: Celery task top-level guard; retries the task on any failure
        logger.exception(f"Error importing {source_name}: {e}")
        raise self.retry(exc=e)


@shared_task
def deduplicate_le_database(dry_run: bool = True):
    """
    Find and merge duplicate LE aircraft records.

    Args:
        dry_run: If True, only report duplicates without merging

    Returns:
        Statistics about duplicates found/merged
    """
    try:
        service = get_import_service()
        stats = service.deduplicate_and_merge(dry_run=dry_run)

        if dry_run:
            logger.info(f"Deduplication dry run: {stats['duplicates_found']} duplicates found")
        else:
            logger.info(f"Deduplication complete: {stats['merged']} records merged, {stats['errors']} errors")

        return stats

    except Exception as e:  # broad: Celery task top-level guard; logs and re-raises for visibility
        logger.exception(f"Error in deduplicate_le_database: {e}")
        raise


@shared_task
def check_source_health():
    """
    Check health of all external data sources.

    Reports sources that:
    - Haven't been successfully fetched in over 2x their update frequency
    - Have recent fetch errors
    """
    try:
        unhealthy_sources = []

        sources = LEDataSource.objects.filter(fetch_enabled=True)

        for source in sources:
            issues = []

            # Check if overdue for update
            if source.last_successful_fetch:
                hours_since = (timezone.now() - source.last_successful_fetch).total_seconds() / 3600
                if hours_since > source.update_frequency_hours * 2:
                    issues.append(f"Overdue: last successful fetch {hours_since:.1f}h ago")

            # Check for recent errors
            if source.fetch_errors:
                recent_errors = [e for e in source.fetch_errors if e.get("timestamp")]
                if len(recent_errors) >= 3:
                    issues.append(f"Multiple recent errors: {len(recent_errors)}")

            if issues:
                unhealthy_sources.append(
                    {
                        "name": source.name,
                        "issues": issues,
                        "last_successful_fetch": source.last_successful_fetch.isoformat()
                        if source.last_successful_fetch
                        else None,
                        "record_count": source.record_count,
                    }
                )

        if unhealthy_sources:
            logger.warning(f"Unhealthy LE data sources: {unhealthy_sources}")

        return {
            "total_sources": sources.count(),
            "unhealthy_count": len(unhealthy_sources),
            "unhealthy_sources": unhealthy_sources,
        }

    except Exception as e:  # broad: Celery task top-level guard; logs and re-raises for visibility
        logger.exception(f"Error in check_source_health: {e}")
        raise


@shared_task
def refresh_source_metadata():
    """
    Refresh metadata for all data sources.

    Updates record counts and validates source configurations.
    """
    try:
        sources = LEDataSource.objects.all()
        updated = 0

        for source in sources:
            # Count aircraft from this source
            aircraft_count = source.aircraft.count()

            if aircraft_count != source.record_count:
                source.record_count = aircraft_count
                source.save(update_fields=["record_count"])
                updated += 1

        logger.info(f"Refreshed metadata for {sources.count()} sources, {updated} updated")

        return {
            "sources_checked": sources.count(),
            "sources_updated": updated,
        }

    except Exception as e:  # broad: Celery task top-level guard; logs and re-raises for visibility
        logger.exception(f"Error in refresh_source_metadata: {e}")
        raise
