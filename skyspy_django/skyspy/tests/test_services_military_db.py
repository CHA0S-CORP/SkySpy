"""
Tests for the military aircraft database service.

Tests military aircraft identification based on:
- ICAO hex code ranges
- Callsign patterns
- Aircraft type codes
- Comprehensive identification
- Special categories (government VIP, stealth, etc.)
"""

from django.test import TestCase

from skyspy.services import military_db


class IdentifyMilitaryByHexTests(TestCase):
    """Tests for ICAO hex-based military identification."""

    def test_returns_none_for_empty_hex(self):
        """Test that None is returned for empty hex."""
        result = military_db.identify_military_by_hex("")
        self.assertIsNone(result)

        result = military_db.identify_military_by_hex(None)
        self.assertIsNone(result)

    def test_identifies_us_military_hex(self):
        """Test identification of US military hex range."""
        # US Military range: 0xADF7C7 - 0xAFFFFF
        result = military_db.identify_military_by_hex("AE1234")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["country"], "USA")
        self.assertEqual(result["source"], "hex_range")

    def test_identifies_uk_raf_hex(self):
        """Test identification of UK RAF hex range."""
        # UK RAF range: 0x43C000 - 0x43CFFF
        result = military_db.identify_military_by_hex("43C500")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["country"], "UK")
        self.assertIn("Royal Air Force", result["service"])

    def test_identifies_german_air_force_hex(self):
        """Test identification of German Air Force hex range."""
        # German range: 0x3F4000 - 0x3F7FFF
        result = military_db.identify_military_by_hex("3F5000")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["country"], "Germany")

    def test_identifies_nato_awacs_hex(self):
        """Test identification of NATO AWACS hex range."""
        # NATO AWACS range: 0x478100 - 0x4781FF
        result = military_db.identify_military_by_hex("478150")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["country"], "NATO")

    def test_returns_none_for_civilian_hex(self):
        """Test that None is returned for civilian hex."""
        # A12345 is typically civilian
        result = military_db.identify_military_by_hex("A12345")

        self.assertIsNone(result)

    def test_handles_invalid_hex_format(self):
        """Test handling of invalid hex format."""
        result = military_db.identify_military_by_hex("ZZZZZZ")

        self.assertIsNone(result)


class IdentifyMilitaryByCallsignTests(TestCase):
    """Tests for callsign-based military identification."""

    def test_returns_none_for_empty_callsign(self):
        """Test that None is returned for empty callsign."""
        result = military_db.identify_military_by_callsign("")
        self.assertIsNone(result)

        result = military_db.identify_military_by_callsign(None)
        self.assertIsNone(result)

    def test_identifies_reach_callsign(self):
        """Test identification of REACH callsign (Air Mobility Command)."""
        result = military_db.identify_military_by_callsign("REACH123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "US Air Force")
        self.assertIn("Mobility", result["mission_type"])

    def test_identifies_rch_callsign(self):
        """Test identification of RCH callsign (Air Mobility Command)."""
        result = military_db.identify_military_by_callsign("RCH456")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "US Air Force")

    def test_identifies_evac_callsign(self):
        """Test identification of EVAC callsign (Medical Evacuation)."""
        result = military_db.identify_military_by_callsign("EVAC1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertIn("Medical", result["mission_type"])

    def test_identifies_sam_callsign(self):
        """Test identification of SAM callsign (Special Air Mission)."""
        result = military_db.identify_military_by_callsign("SAM1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "US Government")
        self.assertIn("Special Air Mission", result["mission_type"])

    def test_identifies_spar_callsign(self):
        """Test identification of SPAR callsign (VIP Transport)."""
        result = military_db.identify_military_by_callsign("SPAR1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertIn("VIP", result["mission_type"])

    def test_identifies_navy_callsign(self):
        """Test identification of NAVY callsign."""
        result = military_db.identify_military_by_callsign("NAVY123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "US Navy")

    def test_identifies_coast_guard_callsign(self):
        """Test identification of Coast Guard callsign."""
        result = military_db.identify_military_by_callsign("USCG123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "US Coast Guard")

    def test_identifies_raf_callsign(self):
        """Test identification of RAF callsign."""
        result = military_db.identify_military_by_callsign("RRR123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "Royal Air Force")

    def test_identifies_nato_awacs_callsign(self):
        """Test identification of NATO AWACS callsign."""
        result = military_db.identify_military_by_callsign("NATO1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["service"], "NATO")

    def test_case_insensitive_matching(self):
        """Test that callsign matching is case insensitive."""
        result = military_db.identify_military_by_callsign("reach123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])

    def test_returns_none_for_civilian_callsign(self):
        """Test that None is returned for civilian callsign."""
        result = military_db.identify_military_by_callsign("UAL123")

        self.assertIsNone(result)


class GetMilitaryAircraftTypeTests(TestCase):
    """Tests for military aircraft type lookup."""

    def test_returns_none_for_empty_type(self):
        """Test that None is returned for empty type."""
        result = military_db.get_military_aircraft_type("")
        self.assertIsNone(result)

        result = military_db.get_military_aircraft_type(None)
        self.assertIsNone(result)

    def test_identifies_f16(self):
        """Test identification of F-16."""
        result = military_db.get_military_aircraft_type("F16")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["name"], "F-16 Fighting Falcon")
        self.assertIn("Fighter", result["role"])

    def test_identifies_f22(self):
        """Test identification of F-22."""
        result = military_db.get_military_aircraft_type("F22")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["name"], "F-22 Raptor")
        self.assertIn("Stealth", result["role"])

    def test_identifies_f35(self):
        """Test identification of F-35 variants."""
        for variant in ["F35", "F35A", "F35B", "F35C"]:
            result = military_db.get_military_aircraft_type(variant)
            self.assertIsNotNone(result)
            self.assertTrue(result["is_military"])
            self.assertIn("F-35", result["name"])

    def test_identifies_c17(self):
        """Test identification of C-17."""
        result = military_db.get_military_aircraft_type("C17")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_military"])
        self.assertEqual(result["name"], "C-17 Globemaster III")
        self.assertIn("Airlifter", result["role"])

    def test_identifies_tankers(self):
        """Test identification of aerial refueling tankers."""
        for tanker in ["KC10", "KC135", "KC46"]:
            result = military_db.get_military_aircraft_type(tanker)
            self.assertIsNotNone(result)
            self.assertIn("Refueling", result["role"])

    def test_identifies_awacs(self):
        """Test identification of AWACS aircraft."""
        result = military_db.get_military_aircraft_type("E3")

        self.assertIsNotNone(result)
        self.assertIn("Airborne Early Warning", result["role"])

    def test_identifies_helicopters(self):
        """Test identification of military helicopters."""
        for heli in ["UH60", "CH47", "AH64", "V22"]:
            result = military_db.get_military_aircraft_type(heli)
            self.assertIsNotNone(result)
            self.assertTrue(result["is_military"])

    def test_case_insensitive_lookup(self):
        """Test that lookup is case insensitive."""
        result = military_db.get_military_aircraft_type("f16")

        self.assertIsNotNone(result)
        self.assertEqual(result["type_code"], "F16")

    def test_returns_none_for_civilian_type(self):
        """Test that None is returned for civilian type."""
        result = military_db.get_military_aircraft_type("B738")

        self.assertIsNone(result)


class IdentifyAircraftTests(TestCase):
    """Tests for comprehensive military aircraft identification."""

    def test_returns_default_with_no_identifiers(self):
        """Test that default result is returned with no matches."""
        result = military_db.identify_aircraft()

        self.assertFalse(result["is_military"])
        self.assertEqual(result["confidence"], "none")
        self.assertEqual(result["identifiers"], [])

    def test_identifies_by_hex_alone(self):
        """Test identification by hex alone."""
        result = military_db.identify_aircraft(icao_hex="AE1234")

        self.assertTrue(result["is_military"])
        self.assertEqual(result["confidence"], "high")
        self.assertIn("hex_range", result["identifiers"])
        self.assertEqual(result["country"], "USA")

    def test_identifies_by_callsign_alone(self):
        """Test identification by callsign alone."""
        result = military_db.identify_aircraft(callsign="REACH123")

        self.assertTrue(result["is_military"])
        self.assertEqual(result["confidence"], "medium")
        self.assertIn("callsign_pattern", result["identifiers"])

    def test_identifies_by_type_alone(self):
        """Test identification by type alone."""
        result = military_db.identify_aircraft(type_code="F16")

        self.assertTrue(result["is_military"])
        self.assertEqual(result["confidence"], "medium")
        self.assertIn("aircraft_type", result["identifiers"])
        self.assertIn("F-16", result["aircraft_name"])

    def test_combines_hex_and_callsign(self):
        """Test that hex and callsign increase confidence."""
        result = military_db.identify_aircraft(icao_hex="AE1234", callsign="REACH123")

        self.assertTrue(result["is_military"])
        self.assertEqual(result["confidence"], "very_high")
        self.assertIn("hex_range", result["identifiers"])
        self.assertIn("callsign_pattern", result["identifiers"])

    def test_includes_all_identifiers(self):
        """Test that all matching identifiers are included."""
        result = military_db.identify_aircraft(
            icao_hex="AE1234",
            callsign="REACH123",
            type_code="C17",
        )

        self.assertTrue(result["is_military"])
        self.assertIn("hex_range", result["identifiers"])
        self.assertIn("callsign_pattern", result["identifiers"])
        self.assertIn("aircraft_type", result["identifiers"])


class GetInterestingCategoryTests(TestCase):
    """Tests for interesting aircraft category identification."""

    def test_returns_none_for_empty_type(self):
        """Test that None is returned for empty type."""
        result = military_db.get_interesting_category("")
        self.assertIsNone(result)

        result = military_db.get_interesting_category(None)
        self.assertIsNone(result)

    def test_identifies_government_vip(self):
        """Test identification of government VIP aircraft."""
        for vip_type in ["VC25", "C32", "C40", "C37"]:
            result = military_db.get_interesting_category(vip_type)
            self.assertEqual(result, "government_vip")

    def test_identifies_military_special(self):
        """Test identification of special military aircraft."""
        for special_type in ["E3", "E8", "RC135", "U2", "P8"]:
            result = military_db.get_interesting_category(special_type)
            self.assertEqual(result, "military_special")

    def test_identifies_stealth(self):
        """Test identification of stealth aircraft."""
        for stealth_type in ["F22", "F35", "F35A", "F35B", "F35C", "B2"]:
            result = military_db.get_interesting_category(stealth_type)
            self.assertEqual(result, "stealth")

    def test_case_insensitive_lookup(self):
        """Test that lookup is case insensitive."""
        result = military_db.get_interesting_category("vc25")
        self.assertEqual(result, "government_vip")

    def test_returns_none_for_uninteresting(self):
        """Test that None is returned for non-interesting type."""
        result = military_db.get_interesting_category("C17")
        self.assertIsNone(result)


class GetAllMilitaryPatternsTests(TestCase):
    """Tests for getting all military patterns."""

    def test_returns_all_pattern_types(self):
        """Test that all pattern types are returned."""
        result = military_db.get_all_military_patterns()

        self.assertIn("hex_ranges", result)
        self.assertIn("callsign_patterns", result)
        self.assertIn("aircraft_types", result)
        self.assertIn("interesting_categories", result)

    def test_hex_ranges_have_required_fields(self):
        """Test that hex ranges have required fields."""
        result = military_db.get_all_military_patterns()

        for hex_range in result["hex_ranges"]:
            self.assertIn("start", hex_range)
            self.assertIn("end", hex_range)
            self.assertIn("country", hex_range)
            self.assertIn("service", hex_range)
            # Verify hex format
            self.assertEqual(len(hex_range["start"]), 6)
            self.assertEqual(len(hex_range["end"]), 6)

    def test_callsign_patterns_have_required_fields(self):
        """Test that callsign patterns have required fields."""
        result = military_db.get_all_military_patterns()

        for pattern in result["callsign_patterns"]:
            self.assertIn("pattern", pattern)
            self.assertIn("service", pattern)
            self.assertIn("mission", pattern)

    def test_aircraft_types_have_required_fields(self):
        """Test that aircraft types have required fields."""
        result = military_db.get_all_military_patterns()

        for type_code, info in result["aircraft_types"].items():
            self.assertIsInstance(type_code, str)
            self.assertIn("name", info)
            self.assertIn("role", info)


class MilitaryHexRangesTests(TestCase):
    """Tests for military hex range coverage."""

    def test_us_military_range_boundaries(self):
        """Test US military hex range boundaries."""
        # Just inside lower bound
        result = military_db.identify_military_by_hex("ADF7C7")
        self.assertIsNotNone(result)
        self.assertEqual(result["country"], "USA")

        # Just inside upper bound
        result = military_db.identify_military_by_hex("AFFFFF")
        self.assertIsNotNone(result)
        self.assertEqual(result["country"], "USA")

    def test_no_overlap_between_ranges(self):
        """Test that there's no overlap in hex ranges across different countries.

        Ranges for the same country MAY intentionally overlap (e.g., a broad
        'US Military' range and a more specific 'US Air Force' sub-range).
        """
        ranges = military_db.MILITARY_HEX_RANGES
        for i, (start1, end1, country1, _) in enumerate(ranges):
            for j, (start2, end2, country2, _) in enumerate(ranges):
                if i != j and country1 != country2:
                    # Ranges for different countries should not overlap
                    if start1 <= start2:
                        self.assertLess(end1, start2, f"Overlap between ranges {i} and {j}")
                    else:
                        self.assertLess(end2, start1, f"Overlap between ranges {i} and {j}")


class EdgeCaseTests(TestCase):
    """Edge case tests for military database."""

    def test_whitespace_handling_callsign(self):
        """Test that whitespace is handled in callsign."""
        result = military_db.identify_military_by_callsign("  REACH123  ")
        self.assertIsNotNone(result)

    def test_whitespace_handling_type(self):
        """Test that whitespace is handled in type code."""
        result = military_db.get_military_aircraft_type("  F16  ")
        self.assertIsNotNone(result)

    def test_partial_callsign_match(self):
        """Test that partial callsign requires proper format."""
        # REACH without digits should not match REACH\d+ pattern
        result = military_db.identify_military_by_callsign("REACH")
        # Depends on pattern definition - REACH\d+$ requires at least one digit
        self.assertIsNone(result)

    def test_service_preservation_in_combined_identification(self):
        """Test that service info is preserved in combined identification."""
        # Hex gives country, callsign gives service
        result = military_db.identify_aircraft(
            icao_hex="AE1234",  # USA from hex
            callsign="REACH123",  # US Air Force from callsign
        )

        self.assertEqual(result["country"], "USA")
        self.assertEqual(result["service"], "US Air Force")

    def test_mission_type_included(self):
        """Test that mission type is included when identified by callsign."""
        result = military_db.identify_aircraft(callsign="EVAC1")

        self.assertIn("mission_type", result)
        self.assertIn("Medical", result["mission_type"])
