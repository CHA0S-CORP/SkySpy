"""
Rich message formatters for Discord and Slack.

Creates properly formatted embeds and blocks for
rich notification display in messaging platforms.
"""

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


# Priority to color mapping (Discord uses integers, Slack uses strings)
PRIORITY_COLORS = {
    "info": {"discord": 0x3498DB, "slack": "#3498db", "name": "Blue"},
    "warning": {"discord": 0xF39C12, "slack": "#f39c12", "name": "Orange"},
    "critical": {"discord": 0xE74C3C, "slack": "#e74c3c", "name": "Red"},
}

# Event type icons (emoji)
EVENT_TYPE_ICONS = {
    "alert": "\U0001f514",  # Bell
    "safety": "\U000026a0",  # Warning
    "military": "\U0001f6e1",  # Shield
    "emergency": "\U0001f6a8",  # Rotating light
    "proximity": "\U0001f4cd",  # Pin
    "tcas": "\U00002708",  # Airplane
}


def _format_altitude(altitude: Any) -> str | None:
    """
    Format an altitude value for display.

    Handles the ADS-B "ground" string (aircraft on the ground) and other
    non-numeric values without raising. Returns None if there is nothing
    sensible to display.
    """
    if altitude is None:
        return None
    if isinstance(altitude, str):
        if altitude.strip().lower() == "ground":
            return "Ground"
        try:
            altitude = float(altitude)
        except ValueError:
            return None
    if isinstance(altitude, (int, float)):
        return f"{int(altitude):,} ft"
    return None


class DiscordFormatter:
    """
    Formats notifications as Discord embeds.

    Discord embeds support:
    - Title and description
    - Color sidebar
    - Fields (inline or block)
    - Timestamp
    - Footer
    - Author section
    """

    def format_alert(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Format alert data as a Discord embed.

        Args:
            data: Alert context with aircraft, rule_name, priority, etc.

        Returns:
            Discord webhook payload with embeds
        """
        aircraft = data.get("aircraft", {})
        priority = data.get("priority", "info")
        color = PRIORITY_COLORS.get(priority, PRIORITY_COLORS["info"])

        # Build fields
        fields = []

        # ICAO
        icao = data.get("icao") or aircraft.get("hex", "")
        if icao:
            fields.append(
                {
                    "name": "ICAO",
                    "value": icao.upper(),
                    "inline": True,
                }
            )

        # Callsign
        callsign = data.get("callsign") or aircraft.get("flight", "")
        if callsign:
            fields.append(
                {
                    "name": "Callsign",
                    "value": callsign.strip(),
                    "inline": True,
                }
            )

        # Type
        ac_type = aircraft.get("t") or aircraft.get("type", "")
        if ac_type:
            fields.append(
                {
                    "name": "Type",
                    "value": ac_type,
                    "inline": True,
                }
            )

        # Altitude
        altitude = _format_altitude(aircraft.get("alt"))
        if altitude is not None:
            fields.append(
                {
                    "name": "Altitude",
                    "value": altitude,
                    "inline": True,
                }
            )

        # Speed
        speed = aircraft.get("gs")
        if speed is not None:
            fields.append(
                {
                    "name": "Speed",
                    "value": f"{speed:,.0f} kts",
                    "inline": True,
                }
            )

        # Distance
        distance = aircraft.get("distance_nm")
        if distance is not None:
            fields.append(
                {
                    "name": "Distance",
                    "value": f"{distance:.1f} NM",
                    "inline": True,
                }
            )

        # Squawk (if special)
        squawk = aircraft.get("squawk")
        if squawk in ("7500", "7600", "7700"):
            fields.append(
                {
                    "name": "\U0001f6a8 Squawk",
                    "value": squawk,
                    "inline": True,
                }
            )

        # Military indicator
        if aircraft.get("military"):
            fields.append(
                {
                    "name": "\U0001f6e1 Military",
                    "value": "Yes",
                    "inline": True,
                }
            )

        # Build embed
        embed = {
            "title": f"\U0001f514 Alert: {data.get('rule_name', 'Unknown Rule')}",
            "description": data.get("message", ""),
            "color": color["discord"],
            "fields": fields,
            "timestamp": data.get("timestamp") or datetime.utcnow().isoformat() + "Z",
            "footer": {
                "text": f"Priority: {priority.upper()} | SkysPy",
            },
        }

        # Add registration as author if available
        registration = aircraft.get("r")
        if registration:
            embed["author"] = {
                "name": registration,
            }

        return {"embeds": [embed]}

    def format_safety_event(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Format safety event as a Discord embed.
        """
        aircraft = data.get("aircraft", {})
        event_type = data.get("event_type", "safety")
        severity = data.get("severity", "warning")
        color = PRIORITY_COLORS.get(severity, PRIORITY_COLORS["warning"])
        icon = EVENT_TYPE_ICONS.get(event_type, "\U000026a0")

        fields = []

        # ICAO
        icao = data.get("icao_hex") or aircraft.get("hex", "")
        if icao:
            fields.append(
                {
                    "name": "ICAO",
                    "value": icao.upper(),
                    "inline": True,
                }
            )

        # Callsign
        callsign = data.get("callsign") or aircraft.get("flight", "")
        if callsign:
            fields.append(
                {
                    "name": "Callsign",
                    "value": callsign.strip(),
                    "inline": True,
                }
            )

        # Event-specific fields
        if event_type == "tcas" or "vertical_rate" in str(data.get("message", "")).lower():
            vr = aircraft.get("vr")
            if vr is not None:
                fields.append(
                    {
                        "name": "Vertical Rate",
                        "value": f"{vr:+,} ft/min",
                        "inline": True,
                    }
                )

        # Altitude
        altitude = _format_altitude(aircraft.get("alt"))
        if altitude is not None:
            fields.append(
                {
                    "name": "Altitude",
                    "value": altitude,
                    "inline": True,
                }
            )

        embed = {
            "title": f"{icon} Safety Event: {event_type.replace('_', ' ').title()}",
            "description": data.get("message", ""),
            "color": color["discord"],
            "fields": fields,
            "timestamp": data.get("timestamp") or datetime.utcnow().isoformat() + "Z",
            "footer": {
                "text": f"Severity: {severity.upper()} | SkysPy Safety Monitor",
            },
        }

        return {"embeds": [embed]}


class SlackFormatter:
    """
    Formats notifications as Slack Block Kit messages.

    Slack Block Kit supports:
    - Header blocks
    - Section blocks with fields
    - Context blocks
    - Dividers
    - Actions (buttons)
    """

    def format_alert(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Format alert data as Slack blocks.

        Args:
            data: Alert context with aircraft, rule_name, priority, etc.

        Returns:
            Slack webhook payload with blocks
        """
        aircraft = data.get("aircraft", {})
        priority = data.get("priority", "info")
        color = PRIORITY_COLORS.get(priority, PRIORITY_COLORS["info"])

        blocks = []

        # Header
        blocks.append(
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"\U0001f514 Alert: {data.get('rule_name', 'Unknown Rule')}",
                    "emoji": True,
                },
            }
        )

        # Message section
        if data.get("message"):
            blocks.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": data["message"],
                    },
                }
            )

        # Build fields
        fields = []

        icao = data.get("icao") or aircraft.get("hex", "")
        if icao:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*ICAO:* {icao.upper()}",
                }
            )

        callsign = data.get("callsign") or aircraft.get("flight", "")
        if callsign:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Callsign:* {callsign.strip()}",
                }
            )

        ac_type = aircraft.get("t") or aircraft.get("type", "")
        if ac_type:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Type:* {ac_type}",
                }
            )

        altitude = _format_altitude(aircraft.get("alt"))
        if altitude is not None:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Altitude:* {altitude}",
                }
            )

        speed = aircraft.get("gs")
        if speed is not None:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Speed:* {speed:,.0f} kts",
                }
            )

        distance = aircraft.get("distance_nm")
        if distance is not None:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Distance:* {distance:.1f} NM",
                }
            )

        # Add fields in pairs
        if fields:
            blocks.append(
                {
                    "type": "section",
                    "fields": fields[:10],  # Slack limit
                }
            )

        # Context with priority and timestamp
        context_elements = [
            {
                "type": "mrkdwn",
                "text": f"Priority: *{priority.upper()}*",
            },
        ]

        timestamp = data.get("timestamp")
        if timestamp:
            context_elements.append(
                {
                    "type": "mrkdwn",
                    "text": f"Time: {timestamp[:19].replace('T', ' ')} UTC",
                }
            )

        blocks.append(
            {
                "type": "context",
                "elements": context_elements,
            }
        )

        return {
            "blocks": blocks,
            "attachments": [
                {
                    "color": color["slack"],
                }
            ],
        }

    def format_safety_event(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Format safety event as Slack blocks.
        """
        aircraft = data.get("aircraft", {})
        event_type = data.get("event_type", "safety")
        severity = data.get("severity", "warning")
        color = PRIORITY_COLORS.get(severity, PRIORITY_COLORS["warning"])
        icon = EVENT_TYPE_ICONS.get(event_type, "\U000026a0")

        blocks = []

        # Header
        blocks.append(
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{icon} Safety Event: {event_type.replace('_', ' ').title()}",
                    "emoji": True,
                },
            }
        )

        # Message
        if data.get("message"):
            blocks.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": data["message"],
                    },
                }
            )

        # Fields
        fields = []

        icao = data.get("icao_hex") or aircraft.get("hex", "")
        if icao:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*ICAO:* {icao.upper()}",
                }
            )

        callsign = data.get("callsign") or aircraft.get("flight", "")
        if callsign:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Callsign:* {callsign.strip()}",
                }
            )

        altitude = _format_altitude(aircraft.get("alt"))
        if altitude is not None:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Altitude:* {altitude}",
                }
            )

        vr = aircraft.get("vr")
        if vr is not None:
            fields.append(
                {
                    "type": "mrkdwn",
                    "text": f"*Vertical Rate:* {vr:+,} ft/min",
                }
            )

        if fields:
            blocks.append(
                {
                    "type": "section",
                    "fields": fields[:10],
                }
            )

        # Context
        blocks.append(
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Severity: *{severity.upper()}* | SkysPy Safety Monitor",
                    },
                ],
            }
        )

        return {
            "blocks": blocks,
            "attachments": [
                {
                    "color": color["slack"],
                }
            ],
        }


class RichFormatter:
    """
    Factory for rich message formatters.

    Automatically selects the appropriate formatter based on channel type.
    """

    def __init__(self):
        self.discord = DiscordFormatter()
        self.slack = SlackFormatter()

    def format(self, channel_type: str, event_type: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """
        Format notification data for the appropriate channel type.

        Args:
            channel_type: 'discord' or 'slack'
            event_type: 'alert' or 'safety'
            data: Event context data

        Returns:
            Formatted payload or None if channel doesn't support rich formatting
        """
        if channel_type == "discord":
            if event_type == "alert":
                return self.discord.format_alert(data)
            elif event_type in ("safety", "tcas", "emergency", "proximity"):
                return self.discord.format_safety_event(data)

        elif channel_type == "slack":
            if event_type == "alert":
                return self.slack.format_alert(data)
            elif event_type in ("safety", "tcas", "emergency", "proximity"):
                return self.slack.format_safety_event(data)

        return None

    def supports_rich(self, channel_type: str) -> bool:
        """Check if channel type supports rich formatting."""
        return channel_type in ("discord", "slack")


# Global singleton
rich_formatter = RichFormatter()
