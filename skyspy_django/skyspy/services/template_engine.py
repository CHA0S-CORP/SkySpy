"""
Template engine for notification message rendering.

Supports variable substitution in notification templates with
rich context from aircraft data, alerts, and safety events.
"""
import logging
import re
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class TemplateEngine:
    """
    Renders notification templates with variable substitution.

    Supports:
    - {variable} syntax for simple substitution
    - {variable|default} syntax for default values
    - {variable:format} syntax for formatting (e.g., {altitude:,} for thousands separator)
    - Nested object access with dot notation: {aircraft.hex}
    """

    # Pattern to match template variables
    # Matches: {name}, {name|default}, {name:format}, {name|default:format}
    VARIABLE_PATTERN = re.compile(
        r'\{([a-zA-Z_][a-zA-Z0-9_.]*)'  # Variable name (can have dots)
        r'(?:\|([^}:]*?))?'              # Optional default value
        r'(?::([^}]*?))?'                # Optional format spec
        r'\}'
    )

    # Standard variable names and their descriptions
    AVAILABLE_VARIABLES = {
        # Aircraft data
        'icao': 'Aircraft ICAO hex code (e.g., ABC123)',
        'callsign': 'Flight callsign (e.g., UAL123)',
        'flight': 'Alias for callsign',
        'altitude': 'Altitude in feet',
        'speed': 'Ground speed in knots',
        'vertical_rate': 'Vertical rate in ft/min',
        'squawk': 'Transponder squawk code',
        'distance': 'Distance from receiver in nautical miles',
        'bearing': 'Bearing from receiver in degrees',
        'heading': 'Aircraft heading in degrees',
        'registration': 'Aircraft registration (e.g., N12345)',
        'type': 'Aircraft type code (e.g., B738)',
        'category': 'Aircraft category',
        'military': 'Whether aircraft is military (true/false)',
        'latitude': 'Aircraft latitude',
        'longitude': 'Aircraft longitude',

        # Alert context
        'rule_name': 'Name of the triggered alert rule',
        'rule_type': 'Type of the alert rule',
        'priority': 'Alert priority (info, warning, critical)',

        # Safety event context
        'event_type': 'Safety event type',
        'event_message': 'Safety event message',
        'severity': 'Safety event severity',

        # Timing
        'timestamp': 'Event timestamp (ISO format)',
        'timestamp_local': 'Event timestamp in local timezone',
        'time': 'Event time (HH:MM:SS)',
        'date': 'Event date (YYYY-MM-DD)',
    }

    def __init__(self):
        self._custom_formatters: Dict[str, callable] = {}

    def render(
        self,
        template: str,
        context: Dict[str, Any],
        default_value: str = ''
    ) -> str:
        """
        Render a template string with the given context.

        Args:
            template: Template string with {variable} placeholders
            context: Dictionary of variable values
            default_value: Default for missing variables

        Returns:
            Rendered string
        """
        if not template:
            return ''

        def replace_var(match):
            var_name = match.group(1)
            var_default = match.group(2)
            format_spec = match.group(3)

            # Get value using dot notation
            value = self._get_nested_value(context, var_name)

            # Use default if value is None
            if value is None:
                value = var_default if var_default is not None else default_value

            # Apply formatting
            if format_spec and value is not None:
                value = self._apply_format(value, format_spec)
            elif value is not None:
                value = str(value)

            return value if value is not None else ''

        try:
            return self.VARIABLE_PATTERN.sub(replace_var, template)
        except Exception as e:
            logger.warning(f"Template rendering error: {e}")
            return template

    def _get_nested_value(self, context: Dict, var_name: str) -> Any:
        """
        Get a value from context using dot notation.

        Example: _get_nested_value({'aircraft': {'hex': 'ABC'}}, 'aircraft.hex')
        """
        parts = var_name.split('.')
        value = context

        for part in parts:
            if value is None:
                return None
            if isinstance(value, dict):
                value = value.get(part)
            elif hasattr(value, part):
                value = getattr(value, part)
            else:
                return None

        return value

    def _apply_format(self, value: Any, format_spec: str) -> str:
        """
        Apply a format specification to a value.

        Supported formats:
        - ',' : Thousands separator (e.g., 35000 -> 35,000)
        - '.Nf': N decimal places
        - 'upper': Uppercase
        - 'lower': Lowercase
        - 'title': Title case
        """
        try:
            if format_spec == ',':
                return f"{int(value):,}"
            elif format_spec == 'upper':
                return str(value).upper()
            elif format_spec == 'lower':
                return str(value).lower()
            elif format_spec == 'title':
                return str(value).title()
            elif format_spec.endswith('f'):
                # Decimal places: .2f, .1f, etc.
                return f"{float(value):{format_spec}}"
            else:
                # Try standard Python format
                return f"{value:{format_spec}}"
        except (ValueError, TypeError):
            return str(value)

    def build_context_from_alert(
        self,
        alert_data: Dict[str, Any],
        timestamp: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Build a template context from alert data.

        Args:
            alert_data: Alert dictionary with rule_name, aircraft, etc.
            timestamp: Optional override for timestamp

        Returns:
            Context dict suitable for render()
        """
        aircraft = alert_data.get('aircraft', {})
        ts = timestamp or datetime.utcnow()

        context = {
            # Alert info
            'rule_name': alert_data.get('rule_name', ''),
            'rule_type': alert_data.get('rule_type', ''),
            'rule_id': alert_data.get('rule_id'),
            'priority': alert_data.get('priority', 'info'),
            'message': alert_data.get('message', ''),

            # Aircraft data (with multiple access paths for convenience)
            'icao': aircraft.get('hex', '').upper(),
            'callsign': aircraft.get('flight', '').strip() if aircraft.get('flight') else None,
            'flight': aircraft.get('flight', '').strip() if aircraft.get('flight') else None,
            'altitude': aircraft.get('alt'),
            'speed': aircraft.get('gs'),
            'vertical_rate': aircraft.get('vr'),
            'squawk': aircraft.get('squawk'),
            'distance': aircraft.get('distance_nm'),
            'bearing': aircraft.get('bearing'),
            'heading': aircraft.get('track'),
            'registration': aircraft.get('r'),
            'type': aircraft.get('t'),
            'category': aircraft.get('category'),
            'military': aircraft.get('military', False),
            'latitude': aircraft.get('lat'),
            'longitude': aircraft.get('lon'),

            # Full aircraft object for nested access
            'aircraft': aircraft,

            # Timestamps
            'timestamp': ts.isoformat() + 'Z',
            'timestamp_local': ts.strftime('%Y-%m-%d %H:%M:%S'),
            'time': ts.strftime('%H:%M:%S'),
            'date': ts.strftime('%Y-%m-%d'),
        }

        return context

    def build_context_from_safety_event(
        self,
        event_data: Dict[str, Any],
        timestamp: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Build a template context from a safety event.

        Args:
            event_data: Safety event dictionary
            timestamp: Optional override for timestamp

        Returns:
            Context dict suitable for render()
        """
        aircraft = event_data.get('aircraft', {})
        ts = timestamp or datetime.utcnow()

        context = {
            # Event info
            'event_type': event_data.get('event_type', ''),
            'event_message': event_data.get('message', ''),
            'severity': event_data.get('severity', 'warning'),
            'priority': event_data.get('severity', 'warning'),  # Alias

            # Aircraft data
            'icao': event_data.get('icao_hex', '') or aircraft.get('hex', ''),
            'callsign': event_data.get('callsign') or aircraft.get('flight'),
            'flight': event_data.get('callsign') or aircraft.get('flight'),
            'altitude': aircraft.get('alt'),
            'speed': aircraft.get('gs'),
            'vertical_rate': aircraft.get('vr'),
            'squawk': aircraft.get('squawk'),
            'distance': aircraft.get('distance_nm'),

            # Full data
            'aircraft': aircraft,
            'event': event_data,

            # Timestamps
            'timestamp': ts.isoformat() + 'Z',
            'timestamp_local': ts.strftime('%Y-%m-%d %H:%M:%S'),
            'time': ts.strftime('%H:%M:%S'),
            'date': ts.strftime('%Y-%m-%d'),
        }

        return context

    def validate_template(self, template: str) -> Dict[str, Any]:
        """
        Validate a template and return information about it.

        Returns:
            Dict with 'valid', 'variables', and 'errors' keys
        """
        variables = []
        errors = []

        for match in self.VARIABLE_PATTERN.finditer(template):
            var_name = match.group(1)
            variables.append(var_name)

            # Check if variable is known
            base_name = var_name.split('.')[0]
            if base_name not in self.AVAILABLE_VARIABLES and base_name not in ('aircraft', 'event'):
                errors.append(f"Unknown variable: {var_name}")

        return {
            'valid': len(errors) == 0,
            'variables': list(set(variables)),
            'errors': errors,
            'template_length': len(template),
        }

    def get_available_variables(self) -> Dict[str, str]:
        """Get list of available template variables with descriptions."""
        return self.AVAILABLE_VARIABLES.copy()


# Global singleton
template_engine = TemplateEngine()
