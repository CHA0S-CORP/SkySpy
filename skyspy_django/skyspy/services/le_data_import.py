"""
Law enforcement aircraft data import service.

Imports aircraft data from external sources like:
- BuzzFeed spy planes investigation
- Academic research databases
- FOIA document releases
- Community project databases
"""

import csv
import io
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import requests
from django.db import DatabaseError, transaction
from django.utils import timezone

from skyspy.models import CannonballKnownAircraft, LEDataSource

logger = logging.getLogger(__name__)


@dataclass
class ImportResult:
    """Result of an import operation."""

    source_name: str
    success: bool
    records_fetched: int = 0
    records_imported: int = 0
    records_updated: int = 0
    records_skipped: int = 0
    errors: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_name": self.source_name,
            "success": self.success,
            "records_fetched": self.records_fetched,
            "records_imported": self.records_imported,
            "records_updated": self.records_updated,
            "records_skipped": self.records_skipped,
            "errors": self.errors,
            "duration_seconds": self.duration_seconds,
        }


class LEDataImportService:
    """
    Service for importing law enforcement aircraft data from external sources.

    Handles fetching, parsing, deduplication, and merging of aircraft records
    from various public databases.
    """

    # Known external data sources with their configurations
    SOURCES = {
        "buzzfeed_spyplanes": {
            "url": "https://raw.githubusercontent.com/BuzzFeedNews/2016-04-federal-surveillance-planes/master/data/planes.csv",
            "format": "csv",
            "source_type": "buzzfeed",
            "description": "BuzzFeed News investigation into federal surveillance aircraft",
            "attribution": "BuzzFeed News (2016) - Federal Surveillance Planes investigation",
            "mapping": {
                "icao_hex": "adshex",
                "registration": "reg",
                "agency_name": "dept_mapped",
                "aircraft_type": "aircraft_model",
                "notes": lambda row: f"BuzzFeed investigation. Dept: {row.get('dept', '')}",
            },
            "confidence_weight": 0.9,
        },
        "buzzfeed_spyplanes_dhs": {
            "url": "https://raw.githubusercontent.com/BuzzFeedNews/2017-08-dhs-ice-surveillance/master/data/dhs_planes.csv",
            "format": "csv",
            "source_type": "buzzfeed",
            "description": "BuzzFeed News investigation into DHS/ICE surveillance aircraft",
            "attribution": "BuzzFeed News (2017) - DHS/ICE Surveillance Planes investigation",
            "mapping": {
                "icao_hex": "adshex",
                "registration": "registration",
                "agency_name": lambda row: f"DHS - {row.get('agency', 'Unknown')}",
                "aircraft_type": "aircraft_type",
                "notes": lambda row: f"DHS/ICE investigation. Agency: {row.get('agency', '')}",
            },
            "confidence_weight": 0.9,
        },
    }

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update(
            {
                "User-Agent": "SkySpy Aircraft Database (research purposes)",
            }
        )

    def get_or_create_data_source(self, source_name: str) -> LEDataSource | None:
        """Get or create the LEDataSource record for a source."""
        if source_name not in self.SOURCES:
            logger.error(f"Unknown source: {source_name}")
            return None

        config = self.SOURCES[source_name]

        source, created = LEDataSource.objects.get_or_create(
            name=source_name,
            defaults={
                "source_type": config["source_type"],
                "url": config["url"],
                "description": config.get("description", ""),
                "attribution_text": config.get("attribution", ""),
                "confidence_weight": config.get("confidence_weight", 1.0),
                "update_frequency_hours": config.get("update_frequency_hours", 168),
            },
        )

        if created:
            logger.info(f"Created new LEDataSource: {source_name}")

        return source

    def import_source(self, source_name: str, force: bool = False) -> ImportResult:
        """
        Import data from a specific source.

        Args:
            source_name: Name of the source to import
            force: If True, import even if recently fetched

        Returns:
            ImportResult with statistics
        """
        start_time = timezone.now()
        result = ImportResult(source_name=source_name, success=False)

        if source_name not in self.SOURCES:
            result.errors.append(f"Unknown source: {source_name}")
            return result

        config = self.SOURCES[source_name]

        # Get or create the data source record
        data_source = self.get_or_create_data_source(source_name)
        if not data_source:
            result.errors.append("Failed to get data source record")
            return result

        # Check if we should skip (recently fetched)
        if not force and data_source.last_successful_fetch:
            hours_since_fetch = (timezone.now() - data_source.last_successful_fetch).total_seconds() / 3600
            if hours_since_fetch < data_source.update_frequency_hours:
                result.errors.append(
                    f"Skipped - last fetched {hours_since_fetch:.1f} hours ago "
                    f"(threshold: {data_source.update_frequency_hours} hours)"
                )
                result.records_skipped = 1
                return result

        try:
            # Fetch the data
            logger.info(f"Fetching data from {source_name}: {config['url']}")
            response = self._session.get(config["url"], timeout=self.timeout)
            response.raise_for_status()

            # Parse based on format
            if config["format"] == "csv":
                records = self._parse_csv(response.text, config["mapping"])
            else:
                result.errors.append(f"Unsupported format: {config['format']}")
                data_source.record_fetch_error(f"Unsupported format: {config['format']}")
                return result

            result.records_fetched = len(records)

            # Import the records
            imported, updated, skipped, errors = self._import_records(
                records, data_source, config.get("confidence_weight", 1.0)
            )

            result.records_imported = imported
            result.records_updated = updated
            result.records_skipped = skipped
            result.errors.extend(errors)
            result.success = True

            # Update data source stats
            data_source.record_successful_fetch(len(records))

            logger.info(f"Import complete for {source_name}: {imported} imported, {updated} updated, {skipped} skipped")

        except requests.RequestException as e:
            error_msg = f"Failed to fetch {source_name}: {e}"
            logger.error(error_msg)
            result.errors.append(error_msg)
            data_source.record_fetch_error(str(e))

        except Exception as e:  # broad: top-level import guard over fetch/parse/DB with unknowable failure modes
            error_msg = f"Error importing {source_name}: {e}"
            logger.exception(error_msg)
            result.errors.append(error_msg)
            data_source.record_fetch_error(str(e))

        result.duration_seconds = (timezone.now() - start_time).total_seconds()
        return result

    def _parse_csv(self, csv_text: str, mapping: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse CSV data and apply field mapping."""
        records = []

        reader = csv.DictReader(io.StringIO(csv_text))
        for row in reader:
            record = {}
            for target_field, source_field in mapping.items():
                if callable(source_field):
                    record[target_field] = source_field(row)
                elif source_field in row:
                    value = row[source_field].strip() if row[source_field] else ""
                    record[target_field] = value

            # Skip records without ICAO hex
            if record.get("icao_hex"):
                # Normalize ICAO hex to uppercase
                record["icao_hex"] = record["icao_hex"].upper().strip()
                records.append(record)

        return records

    def _import_records(
        self,
        records: list[dict[str, Any]],
        data_source: LEDataSource,
        confidence_weight: float,
    ) -> tuple[int, int, int, list[str]]:
        """
        Import records into the database.

        Returns:
            Tuple of (imported, updated, skipped, errors)
        """
        imported = 0
        updated = 0
        skipped = 0
        errors = []

        with transaction.atomic():
            for record in records:
                try:
                    icao_hex = record.get("icao_hex", "").upper()
                    if not icao_hex or len(icao_hex) < 4:
                        skipped += 1
                        continue

                    # Check for existing record
                    existing = CannonballKnownAircraft.objects.filter(icao_hex=icao_hex).first()

                    if existing:
                        # Update if this source has higher confidence
                        if existing.confidence_score < confidence_weight * 0.8:
                            existing.agency_name = record.get("agency_name") or existing.agency_name
                            existing.registration = record.get("registration") or existing.registration
                            existing.aircraft_type = record.get("aircraft_type") or existing.aircraft_type
                            existing.notes = self._merge_notes(existing.notes, record.get("notes", ""))
                            existing.data_source = data_source
                            existing.confidence_score = self._calculate_confidence(
                                existing, data_source, confidence_weight
                            )
                            existing.evidence_links = self._merge_evidence(
                                existing.evidence_links or [],
                                [{"source": data_source.name, "url": data_source.url}],
                            )
                            existing.save()
                            updated += 1
                        else:
                            # Just update evidence links
                            existing.evidence_links = self._merge_evidence(
                                existing.evidence_links or [],
                                [{"source": data_source.name, "url": data_source.url}],
                            )
                            existing.save(update_fields=["evidence_links"])
                            skipped += 1
                    else:
                        # Create new record
                        CannonballKnownAircraft.objects.create(
                            icao_hex=icao_hex,
                            registration=record.get("registration", ""),
                            agency_name=record.get("agency_name", "Unknown Agency"),
                            agency_type=self._infer_agency_type(record.get("agency_name", "")),
                            aircraft_type=record.get("aircraft_type", ""),
                            source="external_db",
                            source_url=data_source.url,
                            data_source=data_source,
                            confidence_score=confidence_weight * 0.8,
                            evidence_links=[{"source": data_source.name, "url": data_source.url}],
                            notes=record.get("notes", ""),
                        )
                        imported += 1

                except (DatabaseError, ValueError, KeyError, TypeError, AttributeError) as e:
                    errors.append(f"Error importing {record.get('icao_hex', 'unknown')}: {e}")
                    logger.warning(f"Error importing record: {e}")

        return imported, updated, skipped, errors

    def _calculate_confidence(
        self,
        aircraft: CannonballKnownAircraft,
        data_source: LEDataSource,
        source_weight: float,
    ) -> float:
        """
        Calculate confidence score based on multiple factors.

        Factors:
        - Source reliability weight
        - Number of corroborating sources
        - Whether manually verified
        """
        base_score = source_weight * 0.5

        # Bonus for multiple evidence sources
        evidence_count = len(aircraft.evidence_links or [])
        base_score += min(0.3, evidence_count * 0.1)

        # Bonus if manually verified
        if aircraft.verified:
            base_score += 0.2

        return min(1.0, max(0.0, base_score))

    def _merge_notes(self, existing: str | None, new: str) -> str:
        """Merge notes without duplication."""
        if not existing:
            return new
        if not new or new in existing:
            return existing
        return f"{existing}\n---\n{new}"

    def _merge_evidence(self, existing: list[dict], new: list[dict]) -> list[dict]:
        """Merge evidence links without duplication."""
        # Use source name as dedup key
        existing_sources = {e.get("source") for e in existing}
        for item in new:
            if item.get("source") not in existing_sources:
                existing.append(item)
        return existing

    def _infer_agency_type(self, agency_name: str) -> str:
        """Infer agency type from name."""
        name_lower = agency_name.lower()

        # Order matters: check more specific categories first.
        # Word-boundary matching - plain substring checks misclassify
        # (e.g. "ice" inside "police" would flag every PD as federal).
        military_keywords = ["army", "navy", "air force", "marine", "coast guard", "national guard"]
        federal_keywords = ["fbi", "dea", "dhs", "ice", "cbp", "atf", "usms", "federal", "national"]
        state_keywords = ["state police", "state patrol", "highway patrol", "state"]
        local_keywords = ["police", "sheriff", "pd", "county", "city", "municipal"]

        def matches(keywords):
            return any(re.search(rf"\b{re.escape(kw)}\b", name_lower) for kw in keywords)

        if matches(military_keywords):
            return "military"
        if matches(federal_keywords):
            return "federal"
        if matches(state_keywords):
            return "state"
        if matches(local_keywords):
            return "local"

        return "unknown"

    def import_all_sources(self, force: bool = False) -> list[ImportResult]:
        """Import from all configured sources."""
        results = []
        for source_name in self.SOURCES:
            # Check if source is enabled
            data_source = self.get_or_create_data_source(source_name)
            if data_source and data_source.fetch_enabled:
                result = self.import_source(source_name, force=force)
                results.append(result)
        return results

    def deduplicate_and_merge(self, dry_run: bool = True) -> dict[str, int]:
        """
        Find and merge duplicate aircraft records.

        Duplicates are identified by:
        - Same registration (case-insensitive)
        - Similar agency names
        """
        stats = {"duplicates_found": 0, "merged": 0, "errors": 0}

        # Find duplicates by registration
        from django.db.models import Count

        duplicates = (
            CannonballKnownAircraft.objects.exclude(registration="")
            .values("registration")
            .annotate(count=Count("id"))
            .filter(count__gt=1)
        )

        for dup in duplicates:
            registration = dup["registration"]
            records = CannonballKnownAircraft.objects.filter(registration=registration).order_by(
                "-confidence_score", "-verified", "-times_detected"
            )

            if records.count() > 1:
                stats["duplicates_found"] += 1

                if not dry_run:
                    try:
                        # Keep the highest confidence record, merge others into it
                        primary = records.first()
                        to_delete = []

                        for secondary in records[1:]:
                            # Merge evidence links
                            primary.evidence_links = self._merge_evidence(
                                primary.evidence_links or [],
                                secondary.evidence_links or [],
                            )
                            # Merge notes
                            primary.notes = self._merge_notes(primary.notes, secondary.notes)
                            # Update detection count
                            primary.times_detected += secondary.times_detected

                            to_delete.append(secondary.id)

                        primary.save()

                        # Delete merged records
                        CannonballKnownAircraft.objects.filter(id__in=to_delete).delete()
                        stats["merged"] += len(to_delete)

                    except (DatabaseError, ValueError, TypeError, AttributeError) as e:
                        logger.error(f"Error merging duplicates for {registration}: {e}")
                        stats["errors"] += 1

        return stats


# Module-level service instance
_import_service: LEDataImportService | None = None


def get_import_service() -> LEDataImportService:
    """Get or create the import service instance."""
    global _import_service
    if _import_service is None:
        _import_service = LEDataImportService()
    return _import_service
