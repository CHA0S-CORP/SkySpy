"""
Tests for the rich message formatters service.

Tests Discord and Slack formatting for alerts and safety events.
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase

from skyspy.services.rich_formatters import (
    EVENT_TYPE_ICONS,
    PRIORITY_COLORS,
    DiscordFormatter,
    RichFormatter,
    SlackFormatter,
    rich_formatter,
)


class PriorityColorsTests(TestCase):
    """Tests for priority color mappings."""

    def test_info_colors(self):
        """Test info priority colors."""
        self.assertIn("discord", PRIORITY_COLORS["info"])
        self.assertIn("slack", PRIORITY_COLORS["info"])
        self.assertEqual(PRIORITY_COLORS["info"]["discord"], 0x3498DB)
        self.assertEqual(PRIORITY_COLORS["info"]["slack"], "#3498db")

    def test_warning_colors(self):
        """Test warning priority colors."""
        self.assertEqual(PRIORITY_COLORS["warning"]["discord"], 0xF39C12)

    def test_critical_colors(self):
        """Test critical priority colors."""
        self.assertEqual(PRIORITY_COLORS["critical"]["discord"], 0xE74C3C)


class EventTypeIconsTests(TestCase):
    """Tests for event type icon mappings."""

    def test_alert_icon(self):
        """Test alert icon."""
        self.assertEqual(EVENT_TYPE_ICONS["alert"], "\U0001f514")  # Bell

    def test_safety_icon(self):
        """Test safety icon."""
        self.assertEqual(EVENT_TYPE_ICONS["safety"], "\U000026a0")  # Warning

    def test_emergency_icon(self):
        """Test emergency icon."""
        self.assertEqual(EVENT_TYPE_ICONS["emergency"], "\U0001f6a8")  # Rotating light


class DiscordFormatterAlertTests(TestCase):
    """Tests for DiscordFormatter alert formatting."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = DiscordFormatter()

    def test_format_alert_basic(self):
        """Test basic alert formatting."""
        data = {
            "rule_name": "Test Rule",
            "message": "Test alert message",
            "priority": "warning",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
                "alt": 35000,
                "gs": 450,
            },
        }

        result = self.formatter.format_alert(data)

        self.assertIn("embeds", result)
        self.assertEqual(len(result["embeds"]), 1)

        embed = result["embeds"][0]
        self.assertIn("Test Rule", embed["title"])
        self.assertEqual(embed["description"], "Test alert message")
        self.assertEqual(embed["color"], PRIORITY_COLORS["warning"]["discord"])

    def test_format_alert_fields(self):
        """Test alert fields are included."""
        data = {
            "rule_name": "Test Rule",
            "priority": "info",
            "icao": "ABC123",
            "callsign": "UAL456",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
                "t": "B738",
                "alt": 35000,
                "gs": 450,
                "distance_nm": 5.5,
            },
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]
        fields = embed["fields"]

        # Should have ICAO, Callsign, Type, Altitude, Speed, Distance
        field_names = [f["name"] for f in fields]
        self.assertIn("ICAO", field_names)
        self.assertIn("Callsign", field_names)
        self.assertIn("Type", field_names)
        self.assertIn("Altitude", field_names)
        self.assertIn("Speed", field_names)
        self.assertIn("Distance", field_names)

    def test_format_alert_emergency_squawk(self):
        """Test emergency squawk is highlighted."""
        data = {
            "rule_name": "Emergency",
            "priority": "critical",
            "aircraft": {
                "hex": "ABC123",
                "squawk": "7700",
            },
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]
        fields = embed["fields"]

        squawk_fields = [f for f in fields if "Squawk" in f["name"]]
        self.assertTrue(len(squawk_fields) > 0)
        self.assertEqual(squawk_fields[0]["value"], "7700")

    def test_format_alert_military(self):
        """Test military indicator is shown."""
        data = {
            "rule_name": "Military",
            "priority": "info",
            "aircraft": {
                "hex": "AE1234",
                "military": True,
            },
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]
        fields = embed["fields"]

        military_fields = [f for f in fields if "Military" in f["name"]]
        self.assertTrue(len(military_fields) > 0)

    def test_format_alert_registration_author(self):
        """Test registration is shown in author section."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {
                "hex": "ABC123",
                "r": "N12345",
            },
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]

        self.assertIn("author", embed)
        self.assertEqual(embed["author"]["name"], "N12345")

    def test_format_alert_footer(self):
        """Test footer includes priority."""
        data = {
            "rule_name": "Test",
            "priority": "critical",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]

        self.assertIn("footer", embed)
        self.assertIn("CRITICAL", embed["footer"]["text"])

    def test_format_alert_timestamp(self):
        """Test timestamp is included."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "timestamp": "2024-01-15T12:00:00Z",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]

        self.assertIn("timestamp", embed)


class DiscordFormatterSafetyEventTests(TestCase):
    """Tests for DiscordFormatter safety event formatting."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = DiscordFormatter()

    def test_format_safety_event_basic(self):
        """Test basic safety event formatting."""
        data = {
            "event_type": "tcas",
            "message": "TCAS resolution advisory detected",
            "severity": "warning",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
                "vr": -3000,
            },
        }

        result = self.formatter.format_safety_event(data)

        self.assertIn("embeds", result)
        embed = result["embeds"][0]
        self.assertIn("Safety Event", embed["title"])
        self.assertIn("Tcas", embed["title"])

    def test_format_safety_event_vertical_rate(self):
        """Test vertical rate is shown for TCAS events."""
        data = {
            "event_type": "tcas",
            "message": "TCAS event",
            "severity": "warning",
            "aircraft": {
                "hex": "ABC123",
                "vr": -3000,
            },
        }

        result = self.formatter.format_safety_event(data)
        embed = result["embeds"][0]
        fields = embed["fields"]

        vr_fields = [f for f in fields if "Vertical Rate" in f["name"]]
        self.assertTrue(len(vr_fields) > 0)


class SlackFormatterAlertTests(TestCase):
    """Tests for SlackFormatter alert formatting."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = SlackFormatter()

    def test_format_alert_basic(self):
        """Test basic Slack alert formatting."""
        data = {
            "rule_name": "Test Rule",
            "message": "Test alert message",
            "priority": "warning",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
            },
        }

        result = self.formatter.format_alert(data)

        self.assertIn("blocks", result)
        self.assertIn("attachments", result)

        # Check header block
        header = result["blocks"][0]
        self.assertEqual(header["type"], "header")
        self.assertIn("Test Rule", header["text"]["text"])

    def test_format_alert_fields_section(self):
        """Test alert includes fields section."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "icao": "ABC123",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
                "alt": 35000,
            },
        }

        result = self.formatter.format_alert(data)
        blocks = result["blocks"]

        # Find section with fields
        field_sections = [b for b in blocks if b.get("type") == "section" and "fields" in b]
        self.assertTrue(len(field_sections) > 0)

    def test_format_alert_context(self):
        """Test alert includes context block."""
        data = {
            "rule_name": "Test",
            "priority": "critical",
            "timestamp": "2024-01-15T12:00:00Z",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)
        blocks = result["blocks"]

        # Find context block
        context_blocks = [b for b in blocks if b.get("type") == "context"]
        self.assertTrue(len(context_blocks) > 0)

        # Check priority is in context
        context_text = str(context_blocks[0])
        self.assertIn("CRITICAL", context_text)

    def test_format_alert_color_attachment(self):
        """Test alert includes color attachment."""
        data = {
            "rule_name": "Test",
            "priority": "warning",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)

        self.assertIn("attachments", result)
        self.assertEqual(result["attachments"][0]["color"], PRIORITY_COLORS["warning"]["slack"])


class SlackFormatterSafetyEventTests(TestCase):
    """Tests for SlackFormatter safety event formatting."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = SlackFormatter()

    def test_format_safety_event_basic(self):
        """Test basic safety event formatting."""
        data = {
            "event_type": "emergency",
            "message": "Emergency squawk detected",
            "severity": "critical",
            "aircraft": {
                "hex": "ABC123",
            },
        }

        result = self.formatter.format_safety_event(data)

        self.assertIn("blocks", result)
        header = result["blocks"][0]
        self.assertIn("Safety Event", header["text"]["text"])
        self.assertIn("Emergency", header["text"]["text"])


class RichFormatterTests(TestCase):
    """Tests for RichFormatter factory class."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = RichFormatter()

    def test_format_discord_alert(self):
        """Test formatting Discord alert."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = self.formatter.format("discord", "alert", data)

        self.assertIsNotNone(result)
        self.assertIn("embeds", result)

    def test_format_discord_safety(self):
        """Test formatting Discord safety event."""
        data = {
            "event_type": "safety",
            "severity": "warning",
            "aircraft": {},
        }

        result = self.formatter.format("discord", "safety", data)

        self.assertIsNotNone(result)
        self.assertIn("embeds", result)

    def test_format_slack_alert(self):
        """Test formatting Slack alert."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = self.formatter.format("slack", "alert", data)

        self.assertIsNotNone(result)
        self.assertIn("blocks", result)

    def test_format_slack_safety(self):
        """Test formatting Slack safety event."""
        data = {
            "event_type": "tcas",
            "severity": "warning",
            "aircraft": {},
        }

        result = self.formatter.format("slack", "tcas", data)

        self.assertIsNotNone(result)
        self.assertIn("blocks", result)

    def test_format_unsupported_channel(self):
        """Test formatting unsupported channel returns None."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = self.formatter.format("telegram", "alert", data)

        self.assertIsNone(result)

    def test_format_unsupported_event_type(self):
        """Test formatting unsupported event type returns None."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = self.formatter.format("discord", "unknown_type", data)

        self.assertIsNone(result)

    def test_supports_rich_discord(self):
        """Test supports_rich for Discord."""
        self.assertTrue(self.formatter.supports_rich("discord"))

    def test_supports_rich_slack(self):
        """Test supports_rich for Slack."""
        self.assertTrue(self.formatter.supports_rich("slack"))

    def test_supports_rich_other(self):
        """Test supports_rich for unsupported channels."""
        self.assertFalse(self.formatter.supports_rich("telegram"))
        self.assertFalse(self.formatter.supports_rich("email"))


class GlobalRichFormatterTests(TestCase):
    """Tests for the global rich_formatter singleton."""

    def test_singleton_exists(self):
        """Test global rich_formatter is available."""
        self.assertIsNotNone(rich_formatter)
        self.assertIsInstance(rich_formatter, RichFormatter)

    def test_singleton_formats(self):
        """Test global rich_formatter can format."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = rich_formatter.format("discord", "alert", data)

        self.assertIsNotNone(result)


class DiscordFormatterEdgeCasesTests(TestCase):
    """Edge case tests for Discord formatting."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = DiscordFormatter()

    def test_format_alert_no_aircraft(self):
        """Test alert with empty aircraft data."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)

        self.assertIn("embeds", result)
        # Should have minimal fields but not crash

    def test_format_alert_missing_fields(self):
        """Test alert with missing optional fields."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            # No message, no aircraft
        }

        result = self.formatter.format_alert(data)

        self.assertIn("embeds", result)

    def test_format_alert_default_priority(self):
        """Test alert uses default priority if not specified."""
        data = {
            "rule_name": "Test",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)
        embed = result["embeds"][0]

        # Default is 'info' priority color
        self.assertEqual(embed["color"], PRIORITY_COLORS["info"]["discord"])


class SlackFormatterEdgeCasesTests(TestCase):
    """Edge case tests for Slack formatting."""

    def setUp(self):
        """Set up test fixtures."""
        self.formatter = SlackFormatter()

    def test_format_alert_no_message(self):
        """Test alert without message."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "aircraft": {},
        }

        result = self.formatter.format_alert(data)

        # Should not have a message section block
        [b for b in result["blocks"] if b.get("type") == "section" and "text" in b]
        # The fields section might have text, but not a standalone message
        self.assertIn("blocks", result)

    def test_format_alert_many_fields_limit(self):
        """Test Slack field limit (10 max)."""
        data = {
            "rule_name": "Test",
            "priority": "info",
            "icao": "ABC123",
            "callsign": "UAL456",
            "aircraft": {
                "hex": "ABC123",
                "flight": "UAL456",
                "t": "B738",
                "alt": 35000,
                "gs": 450,
                "distance_nm": 5.5,
                "squawk": "1200",
                "r": "N12345",
                "category": "A3",
                # Many fields
            },
        }

        result = self.formatter.format_alert(data)
        blocks = result["blocks"]

        # Find field sections
        for block in blocks:
            if block.get("type") == "section" and "fields" in block:
                # Slack limits to 10 fields
                self.assertLessEqual(len(block["fields"]), 10)
