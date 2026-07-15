"""
Tests for the PIREP decoder module.

Tests turbulence parsing, icing parsing, wind shear detection,
severity calculations, and human-readable summary generation.
"""

from unittest.mock import MagicMock

from django.test import TestCase

from skyspy.services.pirep_decoder import (
    decode_icing,
    decode_pirep,
    decode_turbulence,
    decode_wind_shear,
    generate_summary,
    get_max_severity,
    list_hazards,
)


def create_mock_pirep(**kwargs):
    """Create a mock PIREP object with given attributes."""
    pirep = MagicMock()
    pirep.turbulence_type = kwargs.get("turbulence_type")
    pirep.turbulence_freq = kwargs.get("turbulence_freq")
    pirep.turbulence_base_ft = kwargs.get("turbulence_base_ft")
    pirep.turbulence_top_ft = kwargs.get("turbulence_top_ft")
    pirep.icing_type = kwargs.get("icing_type")
    pirep.icing_intensity = kwargs.get("icing_intensity")
    pirep.icing_base_ft = kwargs.get("icing_base_ft")
    pirep.icing_top_ft = kwargs.get("icing_top_ft")
    pirep.raw_text = kwargs.get("raw_text", "")
    pirep.report_type = kwargs.get("report_type", "UA")
    pirep.flight_level = kwargs.get("flight_level")
    pirep.altitude_ft = kwargs.get("altitude_ft")
    return pirep


class TurbulenceDecodingTests(TestCase):
    """Tests for turbulence decoding."""

    def test_decode_turbulence_none(self):
        """Test decoding when no turbulence reported."""
        pirep = create_mock_pirep(turbulence_type=None)
        result = decode_turbulence(pirep)
        self.assertIsNone(result)

    def test_decode_turbulence_negative(self):
        """Test decoding negative (none) turbulence."""
        pirep = create_mock_pirep(turbulence_type="NEG")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "NEG")
        self.assertEqual(result["label"], "None")
        self.assertEqual(result["level"], 0)

    def test_decode_turbulence_light(self):
        """Test decoding light turbulence."""
        pirep = create_mock_pirep(turbulence_type="LGT")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "LGT")
        self.assertEqual(result["label"], "Light")
        self.assertEqual(result["level"], 1)
        self.assertIn("erratic changes", result["description"])

    def test_decode_turbulence_moderate(self):
        """Test decoding moderate turbulence."""
        pirep = create_mock_pirep(turbulence_type="MOD")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "MOD")
        self.assertEqual(result["label"], "Moderate")
        self.assertEqual(result["level"], 3)
        self.assertIn("rapid bumps", result["description"])

    def test_decode_turbulence_severe(self):
        """Test decoding severe turbulence."""
        pirep = create_mock_pirep(turbulence_type="SEV")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "SEV")
        self.assertEqual(result["label"], "Severe")
        self.assertEqual(result["level"], 5)
        self.assertIn("out of control", result["description"])

    def test_decode_turbulence_extreme(self):
        """Test decoding extreme turbulence."""
        pirep = create_mock_pirep(turbulence_type="EXTRM")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "EXTRM")
        self.assertEqual(result["label"], "Extreme")
        self.assertEqual(result["level"], 6)

    def test_decode_turbulence_compound_light_mod(self):
        """Test decoding compound turbulence (light to moderate)."""
        pirep = create_mock_pirep(turbulence_type="LGT-MOD")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "LGT-MOD")
        self.assertEqual(result["label"], "Light to Moderate")
        self.assertEqual(result["level"], 2)

    def test_decode_turbulence_compound_mod_sev(self):
        """Test decoding compound turbulence (moderate to severe)."""
        pirep = create_mock_pirep(turbulence_type="MOD-SEV")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "MOD-SEV")
        self.assertEqual(result["label"], "Moderate to Severe")
        self.assertEqual(result["level"], 4)

    def test_decode_turbulence_with_cat(self):
        """Test decoding turbulence with clear air turbulence type."""
        pirep = create_mock_pirep(turbulence_type="MOD CAT")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "MOD")
        self.assertEqual(result["level"], 3)
        self.assertIn("type", result)
        self.assertEqual(result["type"]["code"], "CAT")
        self.assertEqual(result["type"]["label"], "Clear Air Turbulence")

    def test_decode_turbulence_with_chop(self):
        """Test decoding turbulence with chop type."""
        pirep = create_mock_pirep(turbulence_type="LGT CHOP")
        result = decode_turbulence(pirep)

        self.assertEqual(result["code"], "LGT")
        self.assertIn("type", result)
        self.assertEqual(result["type"]["code"], "CHOP")

    def test_decode_turbulence_with_altitude_range(self):
        """Test decoding turbulence with altitude range."""
        pirep = create_mock_pirep(
            turbulence_type="MOD",
            turbulence_base_ft=25000,
            turbulence_top_ft=35000,
        )
        result = decode_turbulence(pirep)

        self.assertIn("altitude_range", result)
        self.assertEqual(result["altitude_range"]["base_ft"], 25000)
        self.assertEqual(result["altitude_range"]["top_ft"], 35000)


class IcingDecodingTests(TestCase):
    """Tests for icing decoding."""

    def test_decode_icing_none(self):
        """Test decoding when no icing reported."""
        pirep = create_mock_pirep(icing_type=None, icing_intensity=None)
        result = decode_icing(pirep)
        self.assertIsNone(result)

    def test_decode_icing_negative(self):
        """Test decoding negative (none) icing."""
        pirep = create_mock_pirep(icing_type="NEG")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "NEG")
        self.assertEqual(result["label"], "None")
        self.assertEqual(result["level"], 0)

    def test_decode_icing_trace(self):
        """Test decoding trace icing."""
        pirep = create_mock_pirep(icing_type="TRC")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "TRC")
        self.assertEqual(result["label"], "Trace")
        self.assertEqual(result["level"], 1)

    def test_decode_icing_light(self):
        """Test decoding light icing."""
        pirep = create_mock_pirep(icing_type="LGT")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "LGT")
        self.assertEqual(result["label"], "Light")
        self.assertEqual(result["level"], 2)

    def test_decode_icing_moderate(self):
        """Test decoding moderate icing."""
        pirep = create_mock_pirep(icing_type="MOD")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "MOD")
        self.assertEqual(result["label"], "Moderate")
        self.assertEqual(result["level"], 3)

    def test_decode_icing_severe(self):
        """Test decoding severe icing."""
        pirep = create_mock_pirep(icing_type="SEV")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "SEV")
        self.assertEqual(result["label"], "Severe")
        self.assertEqual(result["level"], 5)

    def test_decode_icing_compound_light_mod(self):
        """Test decoding compound icing (light to moderate) is not inflated to moderate."""
        pirep = create_mock_pirep(icing_intensity="LGT-MOD")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "LGT-MOD")
        self.assertEqual(result["label"], "Light to Moderate")
        self.assertEqual(result["level"], 2)

    def test_decode_icing_compound_mod_sev(self):
        """Test decoding compound icing (moderate to severe) is not inflated to severe."""
        pirep = create_mock_pirep(icing_intensity="MOD-SEV")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "MOD-SEV")
        self.assertEqual(result["label"], "Moderate to Severe")
        self.assertEqual(result["level"], 4)

    def test_decode_icing_compound_trc_lgt(self):
        """Test decoding compound icing (trace to light) is not inflated to light."""
        pirep = create_mock_pirep(icing_intensity="TRC-LGT")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "TRC-LGT")
        self.assertEqual(result["label"], "Trace to Light")
        self.assertEqual(result["level"], 1)

    def test_decode_icing_with_rime_type(self):
        """Test decoding icing with rime ice type."""
        pirep = create_mock_pirep(icing_type="MOD RIME")
        result = decode_icing(pirep)

        self.assertEqual(result["code"], "MOD")
        self.assertIn("type", result)
        self.assertEqual(result["type"]["code"], "RIME")
        self.assertEqual(result["type"]["label"], "Rime")

    def test_decode_icing_with_clear_type(self):
        """Test decoding icing with clear ice type."""
        pirep = create_mock_pirep(icing_type="LGT CLR")
        result = decode_icing(pirep)

        self.assertIn("type", result)
        self.assertEqual(result["type"]["code"], "CLR")
        self.assertEqual(result["type"]["label"], "Clear")

    def test_decode_icing_with_mixed_type(self):
        """Test decoding icing with mixed ice type."""
        pirep = create_mock_pirep(icing_type="MOD MXD")
        result = decode_icing(pirep)

        self.assertIn("type", result)
        self.assertEqual(result["type"]["code"], "MXD")
        self.assertEqual(result["type"]["label"], "Mixed")

    def test_decode_icing_with_altitude_range(self):
        """Test decoding icing with altitude range."""
        pirep = create_mock_pirep(
            icing_type="MOD",
            icing_base_ft=10000,
            icing_top_ft=15000,
        )
        result = decode_icing(pirep)

        self.assertIn("altitude_range", result)
        self.assertEqual(result["altitude_range"]["base_ft"], 10000)
        self.assertEqual(result["altitude_range"]["top_ft"], 15000)


class WindShearDecodingTests(TestCase):
    """Tests for wind shear decoding."""

    def test_decode_wind_shear_none(self):
        """Test decoding when no wind shear in raw text."""
        pirep = create_mock_pirep(raw_text="UA /OV SEA/TM 1423/FL350/TP B737/TB MOD")
        result = decode_wind_shear(pirep)
        self.assertIsNone(result)

    def test_decode_wind_shear_llws(self):
        """Test decoding low level wind shear."""
        pirep = create_mock_pirep(raw_text="UA /OV SEA/TM 1423/FL020/WS LLWS")
        result = decode_wind_shear(pirep)

        self.assertIsNotNone(result)
        self.assertTrue(result["reported"])

    def test_decode_wind_shear_with_ws_tag(self):
        """Test decoding wind shear from /WS tag."""
        pirep = create_mock_pirep(raw_text="UA /OV SEA/TM 1423/FL020/WS SEV")
        result = decode_wind_shear(pirep)

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "SEV")
        self.assertEqual(result["level"], 3)

    def test_decode_wind_shear_gain(self):
        """Test decoding wind shear with gain."""
        pirep = create_mock_pirep(raw_text="UA /OV SEA/TM 1423/FL020/WS +LLWS GAIN")
        result = decode_wind_shear(pirep)

        self.assertIsNotNone(result)
        self.assertEqual(result["gain_loss"], "gain")

    def test_decode_wind_shear_loss(self):
        """Test decoding wind shear with loss."""
        pirep = create_mock_pirep(raw_text="UA /OV SEA/TM 1423/FL020/WS -LLWS LOSS")
        result = decode_wind_shear(pirep)

        self.assertIsNotNone(result)
        self.assertEqual(result["gain_loss"], "loss")


class SeverityTests(TestCase):
    """Tests for severity calculation."""

    def test_severity_routine(self):
        """Test severity for routine PIREP with no hazards."""
        pirep = create_mock_pirep(turbulence_type=None, icing_type=None)
        result = get_max_severity(pirep)
        self.assertEqual(result, "routine")

    def test_severity_from_turbulence(self):
        """Test severity from turbulence."""
        pirep = create_mock_pirep(turbulence_type="MOD")
        result = get_max_severity(pirep)
        self.assertEqual(result, "hazardous")

    def test_severity_from_icing(self):
        """Test severity from icing."""
        pirep = create_mock_pirep(icing_type="MOD")
        result = get_max_severity(pirep)
        self.assertEqual(result, "hazardous")

    def test_severity_from_severe_turbulence(self):
        """Test severity from severe turbulence."""
        pirep = create_mock_pirep(turbulence_type="SEV")
        result = get_max_severity(pirep)
        self.assertEqual(result, "severe")

    def test_severity_urgent_pirep(self):
        """Test severity for urgent PIREP."""
        pirep = create_mock_pirep(turbulence_type=None, report_type="UUA")
        result = get_max_severity(pirep)
        self.assertEqual(result, "hazardous")

    def test_severity_max_of_multiple_hazards(self):
        """Test severity takes max of multiple hazards."""
        pirep = create_mock_pirep(turbulence_type="LGT", icing_type="SEV")
        result = get_max_severity(pirep)
        self.assertEqual(result, "severe")


class HazardListTests(TestCase):
    """Tests for hazard list generation."""

    def test_hazards_empty(self):
        """Test hazards list when no hazards present."""
        pirep = create_mock_pirep(turbulence_type=None, icing_type=None)
        result = list_hazards(pirep)
        self.assertEqual(result, [])

    def test_hazards_turbulence_only(self):
        """Test hazards list with turbulence only."""
        pirep = create_mock_pirep(turbulence_type="MOD", icing_type=None)
        result = list_hazards(pirep)
        self.assertEqual(result, ["turbulence"])

    def test_hazards_icing_only(self):
        """Test hazards list with icing only."""
        pirep = create_mock_pirep(turbulence_type=None, icing_type="MOD")
        result = list_hazards(pirep)
        self.assertEqual(result, ["icing"])

    def test_hazards_multiple(self):
        """Test hazards list with multiple hazards."""
        pirep = create_mock_pirep(
            turbulence_type="MOD",
            icing_type="LGT",
            raw_text="UA /OV SEA/TM 1423/FL020/WS LLWS",
        )
        result = list_hazards(pirep)
        self.assertIn("turbulence", result)
        self.assertIn("icing", result)
        self.assertIn("wind_shear", result)

    def test_hazards_excludes_neg(self):
        """Test that NEG (negative/none) hazards are excluded."""
        pirep = create_mock_pirep(turbulence_type="NEG", icing_type="NEG")
        result = list_hazards(pirep)
        self.assertEqual(result, [])


class SummaryGenerationTests(TestCase):
    """Tests for human-readable summary generation."""

    def test_summary_routine(self):
        """Test summary for routine PIREP."""
        pirep = create_mock_pirep(turbulence_type=None, icing_type=None)
        result = generate_summary(pirep)
        self.assertIn("Routine", result)

    def test_summary_turbulence(self):
        """Test summary with turbulence."""
        pirep = create_mock_pirep(turbulence_type="MOD")
        result = generate_summary(pirep)
        self.assertIn("moderate", result.lower())
        self.assertIn("turbulence", result.lower())

    def test_summary_icing(self):
        """Test summary with icing."""
        pirep = create_mock_pirep(icing_type="LGT RIME")
        result = generate_summary(pirep)
        self.assertIn("icing", result.lower())

    def test_summary_with_altitude(self):
        """Test summary includes altitude."""
        pirep = create_mock_pirep(turbulence_type="MOD", flight_level=350)
        result = generate_summary(pirep)
        self.assertIn("FL350", result)

    def test_summary_urgent(self):
        """Test summary for urgent PIREP."""
        pirep = create_mock_pirep(turbulence_type="SEV", report_type="UUA")
        result = generate_summary(pirep)
        self.assertIn("URGENT", result)

    def test_summary_multiple_hazards(self):
        """Test summary with multiple hazards."""
        pirep = create_mock_pirep(turbulence_type="MOD", icing_type="LGT")
        result = generate_summary(pirep)
        self.assertIn("turbulence", result.lower())
        self.assertIn("icing", result.lower())


class FullDecodingTests(TestCase):
    """Tests for the complete decode_pirep function."""

    def test_decode_pirep_full(self):
        """Test full PIREP decoding."""
        pirep = create_mock_pirep(
            turbulence_type="MOD CAT",
            icing_type="LGT RIME",
            flight_level=350,
            report_type="UA",
        )
        result = decode_pirep(pirep)

        self.assertIn("turbulence", result)
        self.assertIn("icing", result)
        self.assertIn("wind_shear", result)
        self.assertIn("severity", result)
        self.assertIn("human_summary", result)
        self.assertIn("hazards", result)

        self.assertEqual(result["turbulence"]["code"], "MOD")
        self.assertEqual(result["icing"]["code"], "LGT")
        self.assertEqual(result["severity"], "hazardous")
        self.assertIn("turbulence", result["hazards"])
        self.assertIn("icing", result["hazards"])

    def test_decode_pirep_empty(self):
        """Test decoding PIREP with no hazards."""
        pirep = create_mock_pirep()
        result = decode_pirep(pirep)

        self.assertIsNone(result["turbulence"])
        self.assertIsNone(result["icing"])
        self.assertIsNone(result["wind_shear"])
        self.assertEqual(result["severity"], "routine")
        self.assertEqual(result["hazards"], [])
