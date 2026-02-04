"""
Tests for the template engine service.

Tests variable substitution, nested access, formatting, context building,
and template validation.
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase
from django.utils import timezone

from skyspy.services.template_engine import TemplateEngine, template_engine


class TemplateEngineRenderTests(TestCase):
    """Tests for template rendering."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_render_simple_variable(self):
        """Test rendering simple variable substitution."""
        template = "Aircraft {icao} detected"
        context = {"icao": "ABC123"}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Aircraft ABC123 detected")

    def test_render_multiple_variables(self):
        """Test rendering multiple variables."""
        template = "{callsign} at {altitude} ft"
        context = {"callsign": "UAL456", "altitude": 35000}

        result = self.engine.render(template, context)

        self.assertEqual(result, "UAL456 at 35000 ft")

    def test_render_missing_variable_default(self):
        """Test rendering with missing variable uses default."""
        template = "Aircraft {icao}"
        context = {}

        result = self.engine.render(template, context, default_value="UNKNOWN")

        self.assertEqual(result, "Aircraft UNKNOWN")

    def test_render_variable_with_default(self):
        """Test rendering with inline default value."""
        template = "Squawk: {squawk|1200}"
        context = {}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Squawk: 1200")

    def test_render_variable_default_not_used(self):
        """Test inline default not used when value exists."""
        template = "Squawk: {squawk|1200}"
        context = {"squawk": "7700"}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Squawk: 7700")

    def test_render_nested_variable(self):
        """Test rendering nested variable with dot notation."""
        template = "ICAO: {aircraft.hex}"
        context = {"aircraft": {"hex": "ABC123"}}

        result = self.engine.render(template, context)

        self.assertEqual(result, "ICAO: ABC123")

    def test_render_deeply_nested_variable(self):
        """Test rendering deeply nested variable."""
        template = "Value: {level1.level2.level3}"
        context = {"level1": {"level2": {"level3": "deep_value"}}}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Value: deep_value")

    def test_render_nested_missing(self):
        """Test rendering nested variable that doesn't exist."""
        template = "Value: {aircraft.missing}"
        context = {"aircraft": {"hex": "ABC123"}}

        result = self.engine.render(template, context, default_value="N/A")

        self.assertEqual(result, "Value: N/A")

    def test_render_empty_template(self):
        """Test rendering empty template."""
        result = self.engine.render("", {"key": "value"})

        self.assertEqual(result, "")

    def test_render_no_variables(self):
        """Test rendering template with no variables."""
        template = "Static text only"
        context = {"key": "value"}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Static text only")


class TemplateEngineFormatTests(TestCase):
    """Tests for template formatting options."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_format_thousands_separator(self):
        """Test thousands separator formatting."""
        template = "Altitude: {altitude:,} ft"
        context = {"altitude": 35000}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Altitude: 35,000 ft")

    def test_format_uppercase(self):
        """Test uppercase formatting."""
        template = "ICAO: {icao:upper}"
        context = {"icao": "abc123"}

        result = self.engine.render(template, context)

        self.assertEqual(result, "ICAO: ABC123")

    def test_format_lowercase(self):
        """Test lowercase formatting."""
        template = "Type: {type:lower}"
        context = {"type": "B738"}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Type: b738")

    def test_format_title_case(self):
        """Test title case formatting."""
        template = "Name: {name:title}"
        context = {"name": "united airlines"}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Name: United Airlines")

    def test_format_decimal_places(self):
        """Test decimal places formatting."""
        template = "Distance: {distance:.1f} NM"
        context = {"distance": 5.567}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Distance: 5.6 NM")

    def test_format_two_decimal_places(self):
        """Test two decimal places formatting."""
        template = "Value: {value:.2f}"
        context = {"value": 3.14159}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Value: 3.14")

    def test_format_with_default(self):
        """Test format with default value."""
        template = "Alt: {altitude|0:,} ft"
        context = {}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Alt: 0 ft")

    def test_format_invalid_type(self):
        """Test format with invalid type falls back to string."""
        template = "Value: {value:,}"
        context = {"value": "not_a_number"}

        result = self.engine.render(template, context)

        # Should return string version on format error
        self.assertIn("not_a_number", result)


class TemplateEngineBuildContextAlertTests(TestCase):
    """Tests for building context from alert data."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_build_context_basic(self):
        """Test building basic alert context."""
        alert_data = {
            "rule_name": "Test Rule",
            "rule_type": "icao",
            "priority": "warning",
            "message": "Test message",
            "aircraft": {
                "hex": "abc123",
                "flight": " UAL456 ",
                "alt": 35000,
                "gs": 450,
                "squawk": "1200",
            },
        }

        context = self.engine.build_context_from_alert(alert_data)

        self.assertEqual(context["rule_name"], "Test Rule")
        self.assertEqual(context["rule_type"], "icao")
        self.assertEqual(context["priority"], "warning")
        self.assertEqual(context["icao"], "ABC123")
        self.assertEqual(context["callsign"], "UAL456")  # Trimmed
        self.assertEqual(context["altitude"], 35000)
        self.assertEqual(context["speed"], 450)
        self.assertEqual(context["squawk"], "1200")

    def test_build_context_includes_timestamps(self):
        """Test context includes timestamp fields."""
        alert_data = {
            "aircraft": {},
        }
        ts = datetime(2024, 1, 15, 12, 30, 45)

        context = self.engine.build_context_from_alert(alert_data, timestamp=ts)

        self.assertIn("timestamp", context)
        self.assertIn("time", context)
        self.assertIn("date", context)
        self.assertEqual(context["time"], "12:30:45")
        self.assertEqual(context["date"], "2024-01-15")

    def test_build_context_aircraft_object(self):
        """Test context includes full aircraft object."""
        alert_data = {
            "aircraft": {
                "hex": "ABC123",
                "custom_field": "custom_value",
            },
        }

        context = self.engine.build_context_from_alert(alert_data)

        self.assertIn("aircraft", context)
        self.assertEqual(context["aircraft"]["custom_field"], "custom_value")

    def test_build_context_missing_aircraft(self):
        """Test context building with missing aircraft."""
        alert_data = {
            "rule_name": "Test",
        }

        context = self.engine.build_context_from_alert(alert_data)

        self.assertEqual(context["icao"], "")
        self.assertIsNone(context["callsign"])


class TemplateEngineBuildContextSafetyTests(TestCase):
    """Tests for building context from safety events."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_build_context_basic(self):
        """Test building basic safety event context."""
        event_data = {
            "event_type": "tcas",
            "message": "TCAS RA detected",
            "severity": "warning",
            "icao_hex": "ABC123",
            "callsign": "UAL456",
            "aircraft": {
                "alt": 35000,
                "vr": -3000,
            },
        }

        context = self.engine.build_context_from_safety_event(event_data)

        self.assertEqual(context["event_type"], "tcas")
        self.assertEqual(context["event_message"], "TCAS RA detected")
        self.assertEqual(context["severity"], "warning")
        self.assertEqual(context["icao"], "ABC123")
        self.assertEqual(context["callsign"], "UAL456")
        self.assertEqual(context["altitude"], 35000)
        self.assertEqual(context["vertical_rate"], -3000)

    def test_build_context_icao_from_aircraft(self):
        """Test ICAO from aircraft object when not in event."""
        event_data = {
            "event_type": "safety",
            "aircraft": {
                "hex": "DEF456",
                "flight": "DAL789",
            },
        }

        context = self.engine.build_context_from_safety_event(event_data)

        self.assertEqual(context["icao"], "DEF456")
        self.assertEqual(context["callsign"], "DAL789")

    def test_build_context_includes_event_object(self):
        """Test context includes full event object."""
        event_data = {
            "event_type": "custom",
            "custom_field": "custom_value",
            "aircraft": {},
        }

        context = self.engine.build_context_from_safety_event(event_data)

        self.assertIn("event", context)
        self.assertEqual(context["event"]["custom_field"], "custom_value")


class TemplateEngineValidateTests(TestCase):
    """Tests for template validation."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_validate_valid_template(self):
        """Test validating a valid template."""
        template = "Aircraft {icao} at {altitude} ft"

        result = self.engine.validate_template(template)

        self.assertTrue(result["valid"])
        self.assertIn("icao", result["variables"])
        self.assertIn("altitude", result["variables"])
        self.assertEqual(result["errors"], [])

    def test_validate_unknown_variable(self):
        """Test validating template with unknown variable."""
        template = "Value: {unknown_var}"

        result = self.engine.validate_template(template)

        self.assertFalse(result["valid"])
        self.assertIn("unknown_var", result["variables"])
        self.assertTrue(len(result["errors"]) > 0)
        self.assertIn("Unknown variable", result["errors"][0])

    def test_validate_aircraft_nested(self):
        """Test validating aircraft.* variables are valid."""
        template = "ICAO: {aircraft.hex}"

        result = self.engine.validate_template(template)

        self.assertTrue(result["valid"])

    def test_validate_event_nested(self):
        """Test validating event.* variables are valid."""
        template = "Type: {event.event_type}"

        result = self.engine.validate_template(template)

        self.assertTrue(result["valid"])

    def test_validate_includes_length(self):
        """Test validation includes template length."""
        template = "Short template"

        result = self.engine.validate_template(template)

        self.assertEqual(result["template_length"], len(template))

    def test_validate_deduplicates_variables(self):
        """Test validation deduplicates variable names."""
        template = "{icao} and {icao} again"

        result = self.engine.validate_template(template)

        self.assertEqual(result["variables"].count("icao"), 1)


class TemplateEngineAvailableVariablesTests(TestCase):
    """Tests for available variables listing."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_get_available_variables(self):
        """Test getting available variables."""
        variables = self.engine.get_available_variables()

        self.assertIn("icao", variables)
        self.assertIn("callsign", variables)
        self.assertIn("altitude", variables)
        self.assertIn("rule_name", variables)
        self.assertIn("timestamp", variables)

    def test_available_variables_have_descriptions(self):
        """Test all variables have descriptions."""
        variables = self.engine.get_available_variables()

        for name, description in variables.items():
            self.assertIsInstance(description, str)
            self.assertTrue(len(description) > 0, f"Variable {name} has empty description")

    def test_get_available_returns_copy(self):
        """Test get_available_variables returns a copy."""
        vars1 = self.engine.get_available_variables()
        vars2 = self.engine.get_available_variables()

        # Modifying one shouldn't affect the other
        vars1["new_key"] = "new_value"
        self.assertNotIn("new_key", vars2)


class GlobalTemplateEngineTests(TestCase):
    """Tests for the global template_engine singleton."""

    def test_singleton_exists(self):
        """Test global template_engine is available."""
        self.assertIsNotNone(template_engine)
        self.assertIsInstance(template_engine, TemplateEngine)

    def test_singleton_renders(self):
        """Test global template_engine can render."""
        result = template_engine.render("Test {value}", {"value": "123"})

        self.assertEqual(result, "Test 123")


class TemplateEngineEdgeCasesTests(TestCase):
    """Edge case tests for template engine."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = TemplateEngine()

    def test_render_none_value(self):
        """Test rendering None value."""
        template = "Value: {value}"
        context = {"value": None}

        result = self.engine.render(template, context, default_value="N/A")

        self.assertEqual(result, "Value: N/A")

    def test_render_empty_string_value(self):
        """Test rendering empty string value."""
        template = "Value: {value}"
        context = {"value": ""}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Value: ")

    def test_render_boolean_value(self):
        """Test rendering boolean value."""
        template = "Military: {military}"
        context = {"military": True}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Military: True")

    def test_render_integer_value(self):
        """Test rendering integer value."""
        template = "Count: {count}"
        context = {"count": 42}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Count: 42")

    def test_render_float_value(self):
        """Test rendering float value."""
        template = "Distance: {distance}"
        context = {"distance": 5.5}

        result = self.engine.render(template, context)

        self.assertEqual(result, "Distance: 5.5")

    def test_render_complex_template(self):
        """Test rendering complex template."""
        template = "Alert: {rule_name}\nAircraft {icao:upper} ({callsign|Unknown}) at {altitude:,} ft, {distance:.1f} NM away"
        context = {
            "rule_name": "Military Watch",
            "icao": "ae1234",
            "callsign": "EVAC01",
            "altitude": 25000,
            "distance": 12.345,
        }

        result = self.engine.render(template, context)

        self.assertIn("Military Watch", result)
        self.assertIn("AE1234", result)
        self.assertIn("EVAC01", result)
        self.assertIn("25,000", result)
        self.assertIn("12.3", result)

    def test_get_nested_value_with_object_attribute(self):
        """Test nested value retrieval from object attributes."""

        class MockAircraft:
            hex = "ABC123"
            flight = "UAL456"

        template = "ICAO: {aircraft.hex}"
        context = {"aircraft": MockAircraft()}

        result = self.engine.render(template, context)

        self.assertEqual(result, "ICAO: ABC123")

    def test_render_template_error_handling(self):
        """Test template rendering handles errors gracefully."""
        # Malformed template shouldn't crash
        template = "Test {unclosed"
        context = {"value": "test"}

        # Should return original template on parse error
        result = self.engine.render(template, context)
        self.assertIsInstance(result, str)
