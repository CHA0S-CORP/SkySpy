"""
Tests for the NOTAM decoder module.

Tests abbreviation expansion, entity extraction, condition extraction,
category detection, severity calculation, and summary generation.
"""

from unittest.mock import MagicMock

from django.test import TestCase

from skyspy.services.notam_decoder import (
    decode_notam,
    detect_category,
    expand_abbreviations,
    extract_affected_entity,
    extract_condition,
    extract_reason,
    generate_summary,
    get_severity,
)


def create_mock_notam(**kwargs):
    """Create a mock NOTAM object with given attributes."""
    notam = MagicMock()
    notam.text = kwargs.get("text", "")
    notam.notam_type = kwargs.get("notam_type", "D")
    notam.geometry = kwargs.get("geometry")
    notam.location = kwargs.get("location", "KSEA")
    return notam


class AbbreviationExpansionTests(TestCase):
    """Tests for abbreviation expansion."""

    def test_expand_rwy(self):
        """Test expanding RWY to Runway."""
        result = expand_abbreviations("RWY 16L/34R CLSD")
        self.assertIn("Runway", result)

    def test_expand_twy(self):
        """Test expanding TWY to Taxiway."""
        result = expand_abbreviations("TWY A CLSD")
        self.assertIn("Taxiway", result)

    def test_expand_clsd(self):
        """Test expanding CLSD to closed."""
        result = expand_abbreviations("RWY 16L CLSD")
        self.assertIn("closed", result)

    def test_expand_maint(self):
        """Test expanding MAINT to maintenance."""
        result = expand_abbreviations("CLSD FOR MAINT")
        self.assertIn("maintenance", result)

    def test_expand_multiple(self):
        """Test expanding multiple abbreviations."""
        result = expand_abbreviations("RWY 16L CLSD FOR MAINT BTN 0800-1600")
        self.assertIn("Runway", result)
        self.assertIn("closed", result)
        self.assertIn("maintenance", result)
        self.assertIn("between", result)

    def test_expand_navaid(self):
        """Test expanding navaid abbreviations."""
        result = expand_abbreviations("SEA VOR U/S")
        self.assertIn("VOR", result)
        self.assertIn("unserviceable", result)

    def test_expand_lighting(self):
        """Test expanding lighting abbreviations."""
        result = expand_abbreviations("PAPI RWY 16L INOP")
        self.assertIn("PAPI", result)
        self.assertIn("inoperative", result)

    def test_expand_preserves_case(self):
        """Test that expansion preserves surrounding text."""
        result = expand_abbreviations("!JFK RWY 04L CLSD")
        self.assertIn("!JFK", result)
        self.assertIn("Runway", result)


class EntityExtractionTests(TestCase):
    """Tests for affected entity extraction."""

    def test_extract_runway(self):
        """Test extracting runway from NOTAM text."""
        result = extract_affected_entity("RWY 16L/34R CLSD")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "runway")
        self.assertEqual(result["value"], "16L/34R")
        self.assertIn("Runway", result["display"])

    def test_extract_runway_single(self):
        """Test extracting single runway."""
        result = extract_affected_entity("RWY 04L CLSD FOR MAINT")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "runway")
        self.assertEqual(result["value"], "04L")

    def test_extract_taxiway(self):
        """Test extracting taxiway from NOTAM text."""
        result = extract_affected_entity("TWY A CLSD")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "taxiway")
        self.assertEqual(result["value"], "A")
        self.assertIn("Taxiway", result["display"])

    def test_extract_taxiway_with_number(self):
        """Test extracting taxiway with number."""
        result = extract_affected_entity("TWY B5 CLSD")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "taxiway")
        self.assertEqual(result["value"], "B5")

    def test_extract_vor(self):
        """Test extracting VOR navaid."""
        result = extract_affected_entity("SEA VOR U/S")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "navaid")
        self.assertEqual(result["value"], "SEA")

    def test_extract_ils(self):
        """Test extracting ILS."""
        result = extract_affected_entity("ILS RWY 16L U/S")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "navaid")
        self.assertEqual(result["value"], "16L")

    def test_extract_papi(self):
        """Test extracting PAPI lighting."""
        result = extract_affected_entity("PAPI RWY 16R INOP")

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "lighting")

    def test_extract_none(self):
        """Test when no entity found."""
        result = extract_affected_entity("BIRD ACTIVITY REPORTED")
        self.assertIsNone(result)


class ConditionExtractionTests(TestCase):
    """Tests for condition/status extraction."""

    def test_extract_closed(self):
        """Test extracting closed condition."""
        result = extract_condition("RWY 16L CLSD")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "CLSD")
        self.assertEqual(result["label"], "closed")

    def test_extract_unserviceable(self):
        """Test extracting unserviceable condition."""
        result = extract_condition("SEA VOR U/S")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "U/S")
        self.assertEqual(result["label"], "unserviceable")

    def test_extract_ots(self):
        """Test extracting out of service condition."""
        result = extract_condition("PAPI OTS")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "OTS")
        self.assertEqual(result["label"], "out of service")

    def test_extract_inop(self):
        """Test extracting inoperative condition."""
        result = extract_condition("HIRL INOP")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "INOP")
        self.assertEqual(result["label"], "inoperative")

    def test_extract_none(self):
        """Test when no condition found."""
        result = extract_condition("BIRD ACTIVITY REPORTED")
        self.assertIsNone(result)


class ReasonExtractionTests(TestCase):
    """Tests for reason extraction."""

    def test_extract_maintenance(self):
        """Test extracting maintenance reason."""
        result = extract_reason("RWY 16L CLSD FOR MAINT")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "MAINT")
        self.assertEqual(result["label"], "maintenance")

    def test_extract_construction(self):
        """Test extracting construction reason."""
        result = extract_reason("TWY A CLSD CONST")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "CONST")
        self.assertEqual(result["label"], "construction")

    def test_extract_wip(self):
        """Test extracting work in progress reason."""
        result = extract_reason("RWY 04L WIP")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "WIP")
        self.assertEqual(result["label"], "work in progress")

    def test_extract_snow(self):
        """Test extracting snow removal reason."""
        result = extract_reason("RWY 16L CLSD SNOW REMOVAL")

        self.assertIsNotNone(result)
        self.assertEqual(result["label"], "snow removal")

    def test_extract_none(self):
        """Test when no reason found."""
        result = extract_reason("RWY 16L CLSD")
        self.assertIsNone(result)


class CategoryDetectionTests(TestCase):
    """Tests for NOTAM category detection."""

    def test_detect_runway_closure(self):
        """Test detecting runway closure category."""
        result = detect_category("RWY 16L/34R CLSD")
        self.assertEqual(result, "RUNWAY_CLOSURE")

    def test_detect_taxiway_closure(self):
        """Test detecting taxiway closure category."""
        result = detect_category("TWY A CLSD")
        self.assertEqual(result, "TAXIWAY_CLOSURE")

    def test_detect_airport_closure(self):
        """Test detecting airport closure category."""
        result = detect_category("AD CLSD")
        self.assertEqual(result, "AIRPORT_CLOSURE")

    def test_detect_tfr(self):
        """Test detecting TFR category."""
        result = detect_category("TFR IN EFFECT")
        self.assertEqual(result, "TFR")

    def test_detect_lighting(self):
        """Test detecting lighting category."""
        result = detect_category("PAPI RWY 16L INOP")
        self.assertEqual(result, "LIGHTING")

    def test_detect_navaid(self):
        """Test detecting navaid category."""
        result = detect_category("SEA VOR U/S")
        self.assertEqual(result, "NAVAID")

    def test_detect_obstruction(self):
        """Test detecting obstruction category."""
        result = detect_category("CRANE 150FT AGL")
        self.assertEqual(result, "OBSTRUCTION")

    def test_detect_services(self):
        """Test detecting services category."""
        result = detect_category("TWR CLOSED 2200-0600")
        self.assertEqual(result, "SERVICES")

    def test_detect_other(self):
        """Test detecting other/unknown category."""
        result = detect_category("BIRD ACTIVITY REPORTED")
        self.assertEqual(result, "OTHER")


class SeverityTests(TestCase):
    """Tests for severity calculation."""

    def test_severity_tfr_critical(self):
        """Test that TFRs are critical severity."""
        notam = create_mock_notam(notam_type="TFR")
        result = get_severity(notam)
        self.assertEqual(result, "critical")

    def test_severity_with_geometry_critical(self):
        """Test that NOTAMs with geometry are critical."""
        notam = create_mock_notam(
            text="SOMETHING", geometry={"type": "Polygon", "coordinates": []}
        )
        result = get_severity(notam)
        self.assertEqual(result, "critical")

    def test_severity_runway_closure_critical(self):
        """Test that runway closures are critical."""
        notam = create_mock_notam(text="RWY 16L CLSD")
        result = get_severity(notam)
        self.assertEqual(result, "critical")

    def test_severity_taxiway_closure_moderate(self):
        """Test that taxiway closures are moderate."""
        notam = create_mock_notam(text="TWY A CLSD")
        result = get_severity(notam)
        self.assertEqual(result, "moderate")

    def test_severity_lighting_moderate(self):
        """Test that lighting issues are moderate."""
        notam = create_mock_notam(text="PAPI RWY 16L INOP")
        result = get_severity(notam)
        self.assertEqual(result, "moderate")

    def test_severity_obstruction_advisory(self):
        """Test that obstructions are advisory."""
        notam = create_mock_notam(text="CRANE 150FT AGL")
        result = get_severity(notam)
        self.assertEqual(result, "advisory")


class SummaryGenerationTests(TestCase):
    """Tests for human-readable summary generation."""

    def test_summary_runway_closure(self):
        """Test summary for runway closure."""
        notam = create_mock_notam(text="RWY 16L/34R CLSD FOR MAINT")
        result = generate_summary(notam)

        self.assertIn("Runway", result)
        self.assertIn("16L/34R", result)
        self.assertIn("closed", result)
        self.assertIn("maintenance", result)

    def test_summary_taxiway_closure(self):
        """Test summary for taxiway closure."""
        notam = create_mock_notam(text="TWY A CLSD")
        result = generate_summary(notam)

        self.assertIn("Taxiway", result)
        self.assertIn("closed", result)

    def test_summary_navaid_unserviceable(self):
        """Test summary for navaid issue."""
        notam = create_mock_notam(text="SEA VOR U/S")
        result = generate_summary(notam)

        self.assertIn("unserviceable", result)

    def test_summary_no_details(self):
        """Test summary when details cannot be extracted."""
        notam = create_mock_notam(text="BIRD ACTIVITY REPORTED")
        result = generate_summary(notam)

        # Should return a category-based summary
        self.assertIsNotNone(result)
        self.assertTrue(len(result) > 0)


class FullDecodingTests(TestCase):
    """Tests for the complete decode_notam function."""

    def test_decode_notam_full(self):
        """Test full NOTAM decoding."""
        notam = create_mock_notam(text="RWY 16L/34R CLSD FOR MAINT 0800-1600")
        result = decode_notam(notam)

        self.assertIn("affected_entity", result)
        self.assertIn("condition", result)
        self.assertIn("reason", result)
        self.assertIn("category", result)
        self.assertIn("category_label", result)
        self.assertIn("severity", result)
        self.assertIn("human_summary", result)
        self.assertIn("expanded_text", result)

        self.assertEqual(result["category"], "RUNWAY_CLOSURE")
        self.assertEqual(result["severity"], "critical")
        self.assertIn("Runway", result["expanded_text"])

    def test_decode_notam_tfr(self):
        """Test decoding TFR NOTAM."""
        notam = create_mock_notam(
            text="TFR IN EFFECT FOR VIP MOVEMENT",
            notam_type="TFR",
        )
        result = decode_notam(notam)

        self.assertEqual(result["category"], "TFR")
        self.assertEqual(result["severity"], "critical")

    def test_decode_notam_lighting(self):
        """Test decoding lighting NOTAM."""
        notam = create_mock_notam(text="PAPI RWY 16L INOP")
        result = decode_notam(notam)

        self.assertEqual(result["category"], "LIGHTING")
        self.assertEqual(result["severity"], "moderate")
        self.assertIn("inoperative", result["expanded_text"])

    def test_decode_notam_expands_all_abbreviations(self):
        """Test that all abbreviations in text are expanded."""
        notam = create_mock_notam(text="RWY 16L CLSD FOR MAINT BTN 0800-1600 WEF 01JAN")
        result = decode_notam(notam)

        expanded = result["expanded_text"]
        self.assertIn("Runway", expanded)
        self.assertIn("closed", expanded)
        self.assertIn("maintenance", expanded)
        self.assertIn("between", expanded)
        self.assertIn("with effect from", expanded)
