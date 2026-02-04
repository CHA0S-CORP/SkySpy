"""
Tests for the law enforcement database service.

Tests identification of law enforcement, federal, and surveillance aircraft:
- Callsign pattern matching
- Operator ICAO code matching
- Aircraft type identification
- Comprehensive identification
- Threat level calculation
- Distance and bearing calculations
"""

from django.test import TestCase

from skyspy.services import law_enforcement_db


class IdentifyByCallsignTests(TestCase):
    """Tests for callsign-based identification."""

    def test_returns_none_for_empty_callsign(self):
        """Test that None is returned for empty callsign."""
        result = law_enforcement_db.identify_by_callsign("")
        self.assertIsNone(result)

        result = law_enforcement_db.identify_by_callsign(None)
        self.assertIsNone(result)

    def test_identifies_chp_callsign(self):
        """Test identification of California Highway Patrol."""
        result = law_enforcement_db.identify_by_callsign("CHP123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["category"], "Police Aviation")
        self.assertIn("California Highway Patrol", result["description"])
        self.assertEqual(result["confidence"], "high")

    def test_identifies_lapd_callsign(self):
        """Test identification of LAPD."""
        result = law_enforcement_db.identify_by_callsign("LAPD1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["category"], "Police Aviation")

    def test_identifies_cbp_callsign(self):
        """Test identification of Customs & Border Protection."""
        result = law_enforcement_db.identify_by_callsign("CBP456")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["category"], "Federal Law Enforcement")

    def test_identifies_fbi_callsign(self):
        """Test identification of FBI."""
        result = law_enforcement_db.identify_by_callsign("FBI789")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["category"], "Federal Law Enforcement")

    def test_identifies_state_police_callsign(self):
        """Test identification of state police."""
        result = law_enforcement_db.identify_by_callsign("TROOPER1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["category"], "State Police")

    def test_identifies_news_helicopter(self):
        """Test identification of news helicopter (not law enforcement)."""
        result = law_enforcement_db.identify_by_callsign("NEWS7")

        self.assertIsNotNone(result)
        self.assertFalse(result["is_law_enforcement"])  # News is not LE
        self.assertTrue(result["is_interest"])
        self.assertEqual(result["category"], "News Media")

    def test_identifies_medical_helicopter(self):
        """Test identification of medical helicopter (not law enforcement)."""
        result = law_enforcement_db.identify_by_callsign("LIFEFLT1")

        self.assertIsNotNone(result)
        self.assertFalse(result["is_law_enforcement"])
        self.assertTrue(result["is_interest"])
        self.assertEqual(result["category"], "Medical")

    def test_case_insensitive_matching(self):
        """Test that callsign matching is case insensitive."""
        result = law_enforcement_db.identify_by_callsign("chp123")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])

    def test_returns_none_for_unmatched_callsign(self):
        """Test that None is returned for unmatched callsign."""
        result = law_enforcement_db.identify_by_callsign("UAL123")

        self.assertIsNone(result)

    def test_generic_police_callsign(self):
        """Test identification of generic police callsign."""
        result = law_enforcement_db.identify_by_callsign("POLICE1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])


class IdentifyByOperatorTests(TestCase):
    """Tests for operator ICAO code identification."""

    def test_returns_none_for_empty_operator(self):
        """Test that None is returned for empty operator."""
        result = law_enforcement_db.identify_by_operator("")
        self.assertIsNone(result)

        result = law_enforcement_db.identify_by_operator(None)
        self.assertIsNone(result)

    def test_identifies_cbp_operator(self):
        """Test identification of CBP operator."""
        result = law_enforcement_db.identify_by_operator("CBP")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["category"], "Federal Law Enforcement")
        self.assertEqual(result["confidence"], "very_high")

    def test_identifies_dhs_operator(self):
        """Test identification of DHS operator."""
        result = law_enforcement_db.identify_by_operator("DHS")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])

    def test_identifies_usms_operator(self):
        """Test identification of US Marshals operator."""
        result = law_enforcement_db.identify_by_operator("USMS")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])
        self.assertIn("Marshals", result["description"])

    def test_case_insensitive_matching(self):
        """Test that operator matching is case insensitive."""
        result = law_enforcement_db.identify_by_operator("cbp")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_law_enforcement"])

    def test_returns_none_for_unmatched_operator(self):
        """Test that None is returned for unmatched operator."""
        result = law_enforcement_db.identify_by_operator("UAL")

        self.assertIsNone(result)


class IsSurveillanceTypeTests(TestCase):
    """Tests for surveillance aircraft type identification."""

    def test_returns_false_for_empty_type(self):
        """Test that False is returned for empty type."""
        result = law_enforcement_db.is_surveillance_type("")
        self.assertFalse(result)

        result = law_enforcement_db.is_surveillance_type(None)
        self.assertFalse(result)

    def test_identifies_cessna_208(self):
        """Test identification of Cessna 208 (surveillance platform)."""
        result = law_enforcement_db.is_surveillance_type("C208")
        self.assertTrue(result)

    def test_identifies_king_air(self):
        """Test identification of King Air (surveillance platform)."""
        result = law_enforcement_db.is_surveillance_type("BE20")
        self.assertTrue(result)

    def test_identifies_ec135(self):
        """Test identification of EC135 (police helicopter)."""
        result = law_enforcement_db.is_surveillance_type("EC35")
        self.assertTrue(result)

    def test_case_insensitive_matching(self):
        """Test that type matching is case insensitive."""
        result = law_enforcement_db.is_surveillance_type("c208")
        self.assertTrue(result)

    def test_returns_false_for_non_surveillance(self):
        """Test that False is returned for non-surveillance aircraft."""
        result = law_enforcement_db.is_surveillance_type("B738")
        self.assertFalse(result)


class IsHelicopterTests(TestCase):
    """Tests for helicopter identification."""

    def test_identifies_by_category(self):
        """Test helicopter identification by category code."""
        result = law_enforcement_db.is_helicopter(category="A7")
        self.assertTrue(result)

    def test_identifies_by_type_code(self):
        """Test helicopter identification by type code."""
        result = law_enforcement_db.is_helicopter(type_code="EC35")
        self.assertTrue(result)

    def test_returns_false_for_fixed_wing(self):
        """Test that fixed wing returns False."""
        result = law_enforcement_db.is_helicopter(category="A3", type_code="B738")
        self.assertFalse(result)

    def test_handles_none_values(self):
        """Test that None values are handled."""
        result = law_enforcement_db.is_helicopter(category=None, type_code=None)
        self.assertFalse(result)


class IdentifyLawEnforcementTests(TestCase):
    """Tests for comprehensive law enforcement identification."""

    def test_returns_default_result_with_no_identifiers(self):
        """Test that default result is returned with no matches."""
        result = law_enforcement_db.identify_law_enforcement()

        self.assertFalse(result["is_law_enforcement"])
        self.assertFalse(result["is_helicopter"])
        self.assertFalse(result["is_surveillance_type"])
        self.assertFalse(result["is_interest"])
        self.assertEqual(result["confidence"], "none")
        self.assertEqual(result["identifiers"], [])

    def test_identifies_by_operator(self):
        """Test identification by operator ICAO."""
        result = law_enforcement_db.identify_law_enforcement(operator="CBP")

        self.assertTrue(result["is_law_enforcement"])
        self.assertTrue(result["is_interest"])
        self.assertEqual(result["confidence"], "very_high")
        self.assertIn("operator", result["identifiers"])

    def test_identifies_by_callsign(self):
        """Test identification by callsign pattern."""
        result = law_enforcement_db.identify_law_enforcement(callsign="CHP123")

        self.assertTrue(result["is_law_enforcement"])
        self.assertTrue(result["is_interest"])
        self.assertIn("callsign", result["identifiers"])

    def test_combines_multiple_identifiers(self):
        """Test that multiple identifiers increase confidence."""
        result = law_enforcement_db.identify_law_enforcement(
            operator="CBP",
            callsign="CBP456",
        )

        self.assertTrue(result["is_law_enforcement"])
        self.assertEqual(result["confidence"], "very_high")
        self.assertIn("operator", result["identifiers"])
        self.assertIn("callsign", result["identifiers"])

    def test_identifies_helicopter(self):
        """Test helicopter identification."""
        result = law_enforcement_db.identify_law_enforcement(category="A7")

        self.assertTrue(result["is_helicopter"])
        self.assertTrue(result["is_interest"])
        self.assertIn("helicopter", result["identifiers"])

    def test_identifies_surveillance_type(self):
        """Test surveillance aircraft type identification."""
        result = law_enforcement_db.identify_law_enforcement(type_code="C208")

        self.assertTrue(result["is_surveillance_type"])
        self.assertTrue(result["is_interest"])
        self.assertIn("surveillance_type", result["identifiers"])

    def test_low_confidence_for_surveillance_only(self):
        """Test that surveillance type alone gives low confidence."""
        result = law_enforcement_db.identify_law_enforcement(type_code="C208")

        self.assertEqual(result["confidence"], "low")


class GetThreatLevelTests(TestCase):
    """Tests for threat level calculation."""

    def test_confirmed_le_close_is_critical(self):
        """Test that close confirmed LE is critical threat."""
        le_info = {"is_law_enforcement": True, "is_helicopter": False, "is_surveillance_type": False}

        result = law_enforcement_db.get_threat_level({}, distance_nm=1.5, le_info=le_info)

        self.assertEqual(result, "critical")

    def test_confirmed_le_medium_is_warning(self):
        """Test that medium-distance confirmed LE is warning."""
        le_info = {"is_law_enforcement": True, "is_helicopter": False, "is_surveillance_type": False}

        result = law_enforcement_db.get_threat_level({}, distance_nm=3.5, le_info=le_info)

        self.assertEqual(result, "warning")

    def test_confirmed_le_far_is_info(self):
        """Test that far confirmed LE is info."""
        le_info = {"is_law_enforcement": True, "is_helicopter": False, "is_surveillance_type": False}

        result = law_enforcement_db.get_threat_level({}, distance_nm=10.0, le_info=le_info)

        self.assertEqual(result, "info")

    def test_helicopter_close_is_warning(self):
        """Test that close helicopter is warning."""
        le_info = {"is_law_enforcement": False, "is_helicopter": True, "is_surveillance_type": False}

        result = law_enforcement_db.get_threat_level({}, distance_nm=2.0, le_info=le_info)

        self.assertEqual(result, "warning")

    def test_helicopter_far_is_info(self):
        """Test that far helicopter is info."""
        le_info = {"is_law_enforcement": False, "is_helicopter": True, "is_surveillance_type": False}

        result = law_enforcement_db.get_threat_level({}, distance_nm=5.0, le_info=le_info)

        self.assertEqual(result, "info")

    def test_surveillance_close_is_warning(self):
        """Test that close surveillance aircraft is warning."""
        le_info = {"is_law_enforcement": False, "is_helicopter": False, "is_surveillance_type": True}

        result = law_enforcement_db.get_threat_level({}, distance_nm=3.0, le_info=le_info)

        self.assertEqual(result, "warning")

    def test_unknown_is_info(self):
        """Test that unknown aircraft is info."""
        le_info = {"is_law_enforcement": False, "is_helicopter": False, "is_surveillance_type": False}

        result = law_enforcement_db.get_threat_level({}, distance_nm=1.0, le_info=le_info)

        self.assertEqual(result, "info")

    def test_computes_le_info_if_not_provided(self):
        """Test that le_info is computed if not provided."""
        aircraft_data = {
            "hex": "A12345",
            "flight": "CHP123",
            "category": "A7",
        }

        result = law_enforcement_db.get_threat_level(aircraft_data, distance_nm=1.5)

        # Should be computed and find CHP callsign
        self.assertEqual(result, "critical")


class CalculateBearingTests(TestCase):
    """Tests for bearing calculation."""

    def test_bearing_north(self):
        """Test bearing due north."""
        result = law_enforcement_db.calculate_bearing(47.0, -122.0, 48.0, -122.0)

        # Should be approximately 0 (north)
        self.assertAlmostEqual(result, 0, delta=1)

    def test_bearing_east(self):
        """Test bearing due east."""
        result = law_enforcement_db.calculate_bearing(47.0, -122.0, 47.0, -121.0)

        # Should be approximately 90 (east)
        self.assertAlmostEqual(result, 90, delta=5)

    def test_bearing_south(self):
        """Test bearing due south."""
        result = law_enforcement_db.calculate_bearing(47.0, -122.0, 46.0, -122.0)

        # Should be approximately 180 (south)
        self.assertAlmostEqual(result, 180, delta=1)

    def test_bearing_west(self):
        """Test bearing due west."""
        result = law_enforcement_db.calculate_bearing(47.0, -122.0, 47.0, -123.0)

        # Should be approximately 270 (west)
        self.assertAlmostEqual(result, 270, delta=5)

    def test_bearing_is_positive(self):
        """Test that bearing is always positive (0-360)."""
        result = law_enforcement_db.calculate_bearing(47.0, -122.0, 46.5, -122.5)

        self.assertGreaterEqual(result, 0)
        self.assertLess(result, 360)


class HaversineDistanceTests(TestCase):
    """Tests for haversine distance calculation."""

    def test_same_point_returns_zero(self):
        """Test that distance between same point is zero."""
        result = law_enforcement_db.haversine_distance(47.0, -122.0, 47.0, -122.0)

        self.assertAlmostEqual(result, 0.0, places=5)

    def test_known_distance(self):
        """Test known distance calculation."""
        # Seattle to Portland is approximately 145nm
        result = law_enforcement_db.haversine_distance(47.6062, -122.3321, 45.5152, -122.6784)

        self.assertGreater(result, 140)
        self.assertLess(result, 150)

    def test_distance_is_symmetric(self):
        """Test that distance A->B equals B->A."""
        dist_ab = law_enforcement_db.haversine_distance(47.0, -122.0, 48.0, -121.0)
        dist_ba = law_enforcement_db.haversine_distance(48.0, -121.0, 47.0, -122.0)

        self.assertAlmostEqual(dist_ab, dist_ba, places=5)


class GetDirectionNameTests(TestCase):
    """Tests for direction name conversion."""

    def test_north(self):
        """Test north direction."""
        result = law_enforcement_db.get_direction_name(0)
        self.assertEqual(result, "N")

        result = law_enforcement_db.get_direction_name(360)
        self.assertEqual(result, "N")

    def test_east(self):
        """Test east direction."""
        result = law_enforcement_db.get_direction_name(90)
        self.assertEqual(result, "E")

    def test_south(self):
        """Test south direction."""
        result = law_enforcement_db.get_direction_name(180)
        self.assertEqual(result, "S")

    def test_west(self):
        """Test west direction."""
        result = law_enforcement_db.get_direction_name(270)
        self.assertEqual(result, "W")

    def test_intermediate_directions(self):
        """Test intermediate directions."""
        result = law_enforcement_db.get_direction_name(45)
        self.assertEqual(result, "NE")

        result = law_enforcement_db.get_direction_name(135)
        self.assertEqual(result, "SE")

        result = law_enforcement_db.get_direction_name(225)
        self.assertEqual(result, "SW")

        result = law_enforcement_db.get_direction_name(315)
        self.assertEqual(result, "NW")


class GetTrendTests(TestCase):
    """Tests for trend determination."""

    def test_approaching(self):
        """Test approaching trend."""
        result = law_enforcement_db.get_trend(current_distance=3.0, previous_distance=4.0)

        self.assertEqual(result, "approaching")

    def test_departing(self):
        """Test departing trend."""
        result = law_enforcement_db.get_trend(current_distance=5.0, previous_distance=4.0)

        self.assertEqual(result, "departing")

    def test_holding(self):
        """Test holding trend."""
        result = law_enforcement_db.get_trend(current_distance=4.0, previous_distance=4.0)

        self.assertEqual(result, "holding")

    def test_unknown_without_previous(self):
        """Test unknown trend without previous distance."""
        result = law_enforcement_db.get_trend(current_distance=4.0, previous_distance=None)

        self.assertEqual(result, "unknown")

    def test_small_change_is_holding(self):
        """Test that small changes are considered holding."""
        result = law_enforcement_db.get_trend(current_distance=4.05, previous_distance=4.0)

        self.assertEqual(result, "holding")


class GetAllPatternsTests(TestCase):
    """Tests for getting all patterns."""

    def test_returns_all_pattern_types(self):
        """Test that all pattern types are returned."""
        result = law_enforcement_db.get_all_patterns()

        self.assertIn("callsign_patterns", result)
        self.assertIn("operators", result)
        self.assertIn("surveillance_types", result)
        self.assertIn("helicopter_categories", result)

    def test_callsign_patterns_have_required_fields(self):
        """Test that callsign patterns have required fields."""
        result = law_enforcement_db.get_all_patterns()

        for pattern in result["callsign_patterns"]:
            self.assertIn("pattern", pattern)
            self.assertIn("category", pattern)
            self.assertIn("description", pattern)

    def test_operators_have_required_fields(self):
        """Test that operators have required fields."""
        result = law_enforcement_db.get_all_patterns()

        for code, info in result["operators"].items():
            self.assertIsInstance(code, str)
            self.assertIn("category", info)
            self.assertIn("description", info)

    def test_surveillance_types_have_required_fields(self):
        """Test that surveillance types have required fields."""
        result = law_enforcement_db.get_all_patterns()

        for type_code, info in result["surveillance_types"].items():
            self.assertIsInstance(type_code, str)
            self.assertIn("name", info)
            self.assertIn("role", info)


class EdgeCaseTests(TestCase):
    """Edge case tests for law enforcement database."""

    def test_whitespace_handling(self):
        """Test that whitespace is handled correctly."""
        result = law_enforcement_db.identify_by_callsign("  CHP123  ")
        self.assertIsNotNone(result)

        result = law_enforcement_db.identify_by_operator("  CBP  ")
        self.assertIsNotNone(result)

    def test_numeric_only_callsign_not_matched(self):
        """Test that numeric-only callsigns don't match police patterns."""
        result = law_enforcement_db.identify_by_callsign("12345")
        self.assertIsNone(result)

    def test_partial_match_not_triggered(self):
        """Test that partial matches don't trigger."""
        # "CHPX" should not match CHP pattern (needs digits)
        result = law_enforcement_db.identify_by_callsign("CHPX")
        # Depends on pattern - CHP\d* matches CHP with zero or more digits
        # So "CHPX" would NOT match because X is not a digit
        self.assertIsNone(result)
