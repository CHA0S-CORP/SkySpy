"""
Tests for the LE Data Import Service.

Tests external data source imports, deduplication, and confidence calculations.
"""

from datetime import timedelta
from unittest.mock import MagicMock, Mock, patch

import pytest
from django.test import TestCase
from django.utils import timezone

from skyspy.models import CannonballKnownAircraft, LEDataSource
from skyspy.services.le_data_import import ImportResult, LEDataImportService, get_import_service


class LEDataImportServiceTests(TestCase):
    """Tests for LEDataImportService."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = LEDataImportService(timeout=5)

    def tearDown(self):
        """Clean up after tests."""
        LEDataSource.objects.all().delete()
        CannonballKnownAircraft.objects.all().delete()

    # =========================================================================
    # Data Source Management Tests
    # =========================================================================

    def test_get_or_create_data_source_creates_new(self):
        """Test creating a new data source."""
        source = self.service.get_or_create_data_source("buzzfeed_spyplanes")

        self.assertIsNotNone(source)
        self.assertEqual(source.name, "buzzfeed_spyplanes")
        self.assertEqual(source.source_type, "buzzfeed")
        self.assertTrue(source.fetch_enabled)

    def test_get_or_create_data_source_returns_existing(self):
        """Test returning existing data source."""
        # Create source first
        LEDataSource.objects.create(
            name="buzzfeed_spyplanes",
            source_type="buzzfeed",
            url="https://example.com",
            record_count=100,
        )

        source = self.service.get_or_create_data_source("buzzfeed_spyplanes")

        self.assertEqual(source.record_count, 100)
        self.assertEqual(LEDataSource.objects.filter(name="buzzfeed_spyplanes").count(), 1)

    def test_get_or_create_data_source_unknown_source(self):
        """Test handling unknown source name."""
        source = self.service.get_or_create_data_source("unknown_source")

        self.assertIsNone(source)

    # =========================================================================
    # CSV Parsing Tests
    # =========================================================================

    def test_parse_csv_basic(self):
        """Test basic CSV parsing."""
        csv_text = "adshex,reg,dept_mapped\nA12345,N12345,FBI\nB67890,N67890,DHS"
        mapping = {
            "icao_hex": "adshex",
            "registration": "reg",
            "agency_name": "dept_mapped",
        }

        records = self.service._parse_csv(csv_text, mapping)

        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["icao_hex"], "A12345")
        self.assertEqual(records[0]["registration"], "N12345")
        self.assertEqual(records[0]["agency_name"], "FBI")

    def test_parse_csv_with_callable_mapping(self):
        """Test CSV parsing with callable field mapping."""
        csv_text = "adshex,dept,role\nA12345,FBI,Surveillance"
        mapping = {
            "icao_hex": "adshex",
            "notes": lambda row: f"Dept: {row.get('dept', '')} - {row.get('role', '')}",
        }

        records = self.service._parse_csv(csv_text, mapping)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["notes"], "Dept: FBI - Surveillance")

    def test_parse_csv_normalizes_icao_hex(self):
        """Test that ICAO hex is normalized to uppercase."""
        csv_text = "adshex,reg\na12345,N12345"
        mapping = {"icao_hex": "adshex", "registration": "reg"}

        records = self.service._parse_csv(csv_text, mapping)

        self.assertEqual(records[0]["icao_hex"], "A12345")

    def test_parse_csv_skips_empty_icao(self):
        """Test that records without ICAO hex are skipped."""
        csv_text = "adshex,reg\n,N12345\nA12345,N67890"
        mapping = {"icao_hex": "adshex", "registration": "reg"}

        records = self.service._parse_csv(csv_text, mapping)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["icao_hex"], "A12345")

    # =========================================================================
    # Import Records Tests
    # =========================================================================

    def test_import_records_creates_new(self):
        """Test importing new aircraft records."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
            confidence_weight=0.9,
        )
        records = [
            {"icao_hex": "A12345", "registration": "N12345", "agency_name": "FBI"},
            {"icao_hex": "B67890", "registration": "N67890", "agency_name": "DHS"},
        ]

        imported, updated, skipped, errors = self.service._import_records(records, source, 0.9)

        self.assertEqual(imported, 2)
        self.assertEqual(updated, 0)
        self.assertEqual(skipped, 0)
        self.assertEqual(len(errors), 0)
        self.assertEqual(CannonballKnownAircraft.objects.count(), 2)

    def test_import_records_updates_existing_lower_confidence(self):
        """Test that existing records with lower confidence get updated."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
        )
        # Create existing record with low confidence
        CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            registration="N12345",
            agency_name="Unknown Agency",
            confidence_score=0.3,
        )

        records = [{"icao_hex": "A12345", "registration": "N12345", "agency_name": "FBI"}]

        imported, updated, skipped, errors = self.service._import_records(records, source, 0.9)

        self.assertEqual(imported, 0)
        self.assertEqual(updated, 1)

        aircraft = CannonballKnownAircraft.objects.get(icao_hex="A12345")
        self.assertEqual(aircraft.agency_name, "FBI")

    def test_import_records_skips_existing_higher_confidence(self):
        """Test that existing records with higher confidence are not overwritten."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
        )
        # Create existing record with high confidence
        CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            registration="N12345",
            agency_name="FBI Verified",
            confidence_score=0.95,
        )

        records = [{"icao_hex": "A12345", "registration": "N67890", "agency_name": "Unknown"}]

        imported, updated, skipped, errors = self.service._import_records(records, source, 0.7)

        self.assertEqual(imported, 0)
        self.assertEqual(updated, 0)
        self.assertEqual(skipped, 1)

        aircraft = CannonballKnownAircraft.objects.get(icao_hex="A12345")
        self.assertEqual(aircraft.agency_name, "FBI Verified")

    def test_import_records_skips_invalid_icao(self):
        """Test that records with invalid ICAO hex are skipped."""
        source = LEDataSource.objects.create(name="test", source_type="foia")
        records = [
            {"icao_hex": "AB", "agency_name": "Test"},  # Too short
            {"icao_hex": "", "agency_name": "Test"},  # Empty
        ]

        imported, updated, skipped, errors = self.service._import_records(records, source, 0.9)

        self.assertEqual(imported, 0)
        self.assertEqual(skipped, 2)

    # =========================================================================
    # Agency Type Inference Tests
    # =========================================================================

    def test_infer_agency_type_federal(self):
        """Test inferring federal agency type."""
        self.assertEqual(self.service._infer_agency_type("FBI"), "federal")
        self.assertEqual(self.service._infer_agency_type("DEA"), "federal")
        self.assertEqual(self.service._infer_agency_type("DHS Aviation"), "federal")
        self.assertEqual(self.service._infer_agency_type("Federal Bureau"), "federal")

    def test_infer_agency_type_military(self):
        """Test inferring military agency type."""
        self.assertEqual(self.service._infer_agency_type("US Army"), "military")
        self.assertEqual(self.service._infer_agency_type("Air Force"), "military")
        self.assertEqual(self.service._infer_agency_type("National Guard"), "military")

    def test_infer_agency_type_state(self):
        """Test inferring state agency type."""
        self.assertEqual(self.service._infer_agency_type("State Police"), "state")
        self.assertEqual(self.service._infer_agency_type("Highway Patrol"), "state")
        self.assertEqual(self.service._infer_agency_type("State Patrol"), "state")

    def test_infer_agency_type_local(self):
        """Test inferring local agency type."""
        self.assertEqual(self.service._infer_agency_type("Police Department"), "local")
        self.assertEqual(self.service._infer_agency_type("Sheriff Office"), "local")
        self.assertEqual(self.service._infer_agency_type("City PD"), "local")
        self.assertEqual(self.service._infer_agency_type("County Sheriff"), "local")

    def test_infer_agency_type_unknown(self):
        """Test defaulting to unknown for unrecognized agencies."""
        self.assertEqual(self.service._infer_agency_type("Aviation LLC"), "unknown")
        self.assertEqual(self.service._infer_agency_type("Private Company"), "unknown")

    # =========================================================================
    # Evidence Merging Tests
    # =========================================================================

    def test_merge_evidence_adds_new(self):
        """Test adding new evidence to list."""
        existing = [{"source": "source1", "url": "http://1.com"}]
        new = [{"source": "source2", "url": "http://2.com"}]

        result = self.service._merge_evidence(existing, new)

        self.assertEqual(len(result), 2)

    def test_merge_evidence_deduplicates(self):
        """Test that duplicate sources are not added."""
        existing = [{"source": "source1", "url": "http://1.com"}]
        new = [{"source": "source1", "url": "http://1-updated.com"}]

        result = self.service._merge_evidence(existing, new)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["url"], "http://1.com")

    # =========================================================================
    # Notes Merging Tests
    # =========================================================================

    def test_merge_notes_combines(self):
        """Test combining notes."""
        result = self.service._merge_notes("Note 1", "Note 2")

        self.assertIn("Note 1", result)
        self.assertIn("Note 2", result)

    def test_merge_notes_handles_empty_existing(self):
        """Test merging when existing notes are empty."""
        result = self.service._merge_notes(None, "New note")
        self.assertEqual(result, "New note")

        result = self.service._merge_notes("", "New note")
        self.assertEqual(result, "New note")

    def test_merge_notes_skips_duplicate(self):
        """Test that duplicate notes are not added."""
        result = self.service._merge_notes("Same note", "Same note")
        self.assertEqual(result, "Same note")

    # =========================================================================
    # Full Import Flow Tests
    # =========================================================================

    @patch.object(LEDataImportService, "_session")
    def test_import_source_success(self, mock_session):
        """Test successful source import."""
        # Mock the HTTP response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.text = "adshex,reg,dept_mapped\nA12345,N12345,FBI"
        mock_response.raise_for_status = Mock()
        mock_session.get.return_value = mock_response

        result = self.service.import_source("buzzfeed_spyplanes", force=True)

        self.assertTrue(result.success)
        self.assertEqual(result.records_fetched, 1)
        self.assertEqual(result.records_imported, 1)

    @patch.object(LEDataImportService, "_session")
    def test_import_source_skips_recent_fetch(self, mock_session):
        """Test that recent fetches are skipped."""
        # Create source with recent fetch
        LEDataSource.objects.create(
            name="buzzfeed_spyplanes",
            source_type="buzzfeed",
            last_successful_fetch=timezone.now(),
            update_frequency_hours=168,
        )

        result = self.service.import_source("buzzfeed_spyplanes", force=False)

        self.assertFalse(result.success)
        self.assertEqual(result.records_skipped, 1)
        mock_session.get.assert_not_called()

    @patch.object(LEDataImportService, "_session")
    def test_import_source_handles_http_error(self, mock_session):
        """Test handling HTTP errors."""
        import requests

        mock_session.get.side_effect = requests.RequestException("Network error")

        result = self.service.import_source("buzzfeed_spyplanes", force=True)

        self.assertFalse(result.success)
        self.assertTrue(any("Network error" in e for e in result.errors))

    def test_import_source_unknown_source(self):
        """Test importing unknown source."""
        result = self.service.import_source("unknown_source")

        self.assertFalse(result.success)
        self.assertTrue(any("Unknown source" in e for e in result.errors))

    # =========================================================================
    # Confidence Calculation Tests
    # =========================================================================

    def test_calculate_confidence_base(self):
        """Test base confidence calculation."""
        source = LEDataSource.objects.create(name="test", source_type="foia")
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_links=[],
            verified=False,
        )

        confidence = self.service._calculate_confidence(aircraft, source, 0.8)

        self.assertGreater(confidence, 0.0)
        self.assertLessEqual(confidence, 1.0)

    def test_calculate_confidence_with_verification_bonus(self):
        """Test confidence bonus for verified aircraft."""
        source = LEDataSource.objects.create(name="test", source_type="foia")
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_links=[],
            verified=True,
        )

        confidence = self.service._calculate_confidence(aircraft, source, 0.8)

        self.assertGreater(confidence, 0.5)  # Should have verification bonus

    def test_calculate_confidence_with_multiple_sources(self):
        """Test confidence bonus for multiple evidence sources."""
        source = LEDataSource.objects.create(name="test", source_type="foia")
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_links=[
                {"source": "source1"},
                {"source": "source2"},
                {"source": "source3"},
            ],
            verified=False,
        )

        confidence = self.service._calculate_confidence(aircraft, source, 0.5)

        # Should be higher due to multiple sources
        base_aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="B12345",
            agency_name="FBI",
            evidence_links=[],
            verified=False,
        )
        base_confidence = self.service._calculate_confidence(base_aircraft, source, 0.5)

        self.assertGreater(confidence, base_confidence)


class LEDataSourceModelTests(TestCase):
    """Tests for LEDataSource model methods."""

    def test_record_fetch_error(self):
        """Test recording fetch errors."""
        source = LEDataSource.objects.create(
            name="test",
            source_type="foia",
        )

        source.record_fetch_error("Connection timeout")

        self.assertEqual(len(source.fetch_errors), 1)
        self.assertIn("Connection timeout", source.fetch_errors[0]["error"])
        self.assertIsNotNone(source.last_fetched)

    def test_record_fetch_error_limits_history(self):
        """Test that error history is limited to 10 entries."""
        source = LEDataSource.objects.create(
            name="test",
            source_type="foia",
            fetch_errors=[{"error": f"Error {i}"} for i in range(10)],
        )

        source.record_fetch_error("New error")

        self.assertEqual(len(source.fetch_errors), 10)
        self.assertIn("New error", source.fetch_errors[-1]["error"])

    def test_record_successful_fetch(self):
        """Test recording successful fetch."""
        source = LEDataSource.objects.create(
            name="test",
            source_type="foia",
        )

        source.record_successful_fetch(100)

        self.assertEqual(source.record_count, 100)
        self.assertIsNotNone(source.last_fetched)
        self.assertIsNotNone(source.last_successful_fetch)


class GetImportServiceTests(TestCase):
    """Tests for get_import_service singleton."""

    def test_returns_same_instance(self):
        """Test that get_import_service returns singleton."""
        service1 = get_import_service()
        service2 = get_import_service()

        self.assertIs(service1, service2)

    def test_returns_correct_type(self):
        """Test that get_import_service returns LEDataImportService."""
        service = get_import_service()

        self.assertIsInstance(service, LEDataImportService)
