"""
Alert evaluation service.

Evaluates aircraft against user-defined alert rules
and triggers notifications when conditions are met.

Features:
- Distributed Redis cooldowns for multi-worker consistency
- Cached compiled rules for performance
- Performance metrics collection
- Suppression window support
"""
import logging
import re
import time
from datetime import datetime
from typing import Optional, List

from django.utils import timezone

# Maximum allowed regex pattern length to prevent ReDoS attacks
MAX_REGEX_PATTERN_LENGTH = 500
from channels.layers import get_channel_layer

from skyspy.models import AlertRule, AlertHistory, NotificationConfig, NotificationLog, NotificationChannel
from skyspy.utils import sync_group_send
from skyspy.services.alert_cooldowns import cooldown_manager
from skyspy.services.alert_rule_cache import rule_cache, CompiledRule
from skyspy.services.alert_metrics import alert_metrics, EvaluationTimer

logger = logging.getLogger(__name__)


class AlertService:
    """
    Service for evaluating and triggering alert rules.

    Uses:
    - Distributed Redis cooldowns (alert_cooldowns.py)
    - Cached compiled rules (alert_rule_cache.py)
    - Performance metrics (alert_metrics.py)
    """

    # Field mapping from rule types to aircraft data keys
    TYPE_MAPPING = {
        'icao': 'hex',
        'callsign': 'flight',
        'squawk': 'squawk',
        'altitude': 'alt',
        'distance': 'distance_nm',
        'proximity': 'distance_nm',  # Alias for distance
        'speed': 'gs',
        'vertical_rate': 'vr',
        'type': 't',
        'aircraft_type': 't',  # Alias
        'category': 'category',
        'military': 'military',
        'emergency': 'squawk',  # Special handling
        'registration': 'r',
        'operator': 'ownOp',
    }

    # Emergency squawk codes
    EMERGENCY_SQUAWKS = {'7500', '7600', '7700'}

    def __init__(self):
        self._legacy_cooldowns: dict = {}  # Fallback for testing
        self._default_cooldown_seconds = 300  # 5 minutes

    def check_alerts(self, aircraft_list: list) -> list:
        """
        Check all active alert rules against aircraft.

        Uses cached compiled rules for performance and distributed
        cooldowns for multi-worker consistency.

        Returns list of triggered alerts.
        """
        with EvaluationTimer(alert_metrics) as timer:
            timer.set_aircraft_count(len(aircraft_list))

            # Get cached rules
            try:
                rules = rule_cache.get_active_rules()
                timer.set_cache_hit(True)
            except Exception as e:
                logger.warning(f"Cache miss, falling back to DB: {e}")
                rules = self._get_rules_from_db()
                timer.set_cache_hit(False)

            now = timezone.now()

            # Filter by schedule
            active_rules = [r for r in rules if r.is_scheduled_active(now)]
            timer.set_rules_evaluated(len(active_rules))

            triggered = []

            for rule in active_rules:
                # Pre-filter aircraft using optimization hints
                if rule.requires_military:
                    candidates = [ac for ac in aircraft_list if ac.get('military')]
                elif rule.requires_position:
                    candidates = [ac for ac in aircraft_list if ac.get('distance_nm') is not None]
                elif rule.requires_altitude:
                    # Check both 'alt' and 'alt_baro' since ADS-B data uses alt_baro
                    candidates = [ac for ac in aircraft_list if ac.get('alt') is not None or ac.get('alt_baro') is not None]
                elif rule.requires_speed:
                    candidates = [ac for ac in aircraft_list if ac.get('gs') is not None]
                else:
                    candidates = aircraft_list

                for ac in candidates:
                    # Quick pre-filter using compiled hints
                    if not rule.can_match(ac):
                        continue

                    # Full condition evaluation
                    if self._check_rule(rule, ac):
                        alert = self._trigger_alert(rule, ac)
                        if alert:
                            triggered.append(alert)
                            timer.add_trigger()

            return triggered

    def _get_rules_from_db(self) -> List[CompiledRule]:
        """Fallback: get rules directly from database."""
        db_rules = AlertRule.objects.filter(enabled=True).select_related('owner')
        return [CompiledRule.from_db_rule(r) for r in db_rules]

    def _check_rule(self, rule: CompiledRule, aircraft: dict) -> bool:
        """
        Check if aircraft matches a rule.

        Evaluates both simple conditions and complex AND/OR conditions.
        """
        # Check simple conditions
        if rule.rule_type and rule.value:
            if not self._evaluate_simple_condition(
                aircraft, rule.rule_type, rule.operator, rule.value,
                compiled_regex=rule.compiled_regex
            ):
                return False

        # Check complex conditions
        if rule.conditions:
            if not self._evaluate_complex_conditions(aircraft, rule.conditions):
                return False

        return True

    def _evaluate_simple_condition(
        self,
        aircraft: dict,
        rule_type: str,
        operator: str,
        value: str,
        compiled_regex: Optional[re.Pattern] = None
    ) -> bool:
        """
        Evaluate a simple condition against an aircraft.
        """
        # Get aircraft value based on rule type
        ac_value = self._get_aircraft_value(aircraft, rule_type)

        if ac_value is None:
            # For boolean types (emergency, military), allow None to be treated as False
            if rule_type in ('emergency', 'military'):
                ac_value = False
            else:
                return False

        return self._compare_values(ac_value, operator, value, compiled_regex, rule_type)

    def _get_aircraft_value(self, aircraft: dict, rule_type: str):
        """
        Get the relevant value from aircraft data.
        """
        # Special handling for military type - check both 'military' key and 'dbFlags'
        if rule_type == 'military':
            # First check explicit 'military' key
            if 'military' in aircraft:
                return aircraft['military']
            # Fall back to dbFlags (bit 0 = military)
            db_flags = aircraft.get('dbFlags', 0)
            if isinstance(db_flags, int):
                return bool(db_flags & 1)
            return False

        # Special handling for altitude - check both 'alt' and 'alt_baro'
        if rule_type == 'altitude':
            return aircraft.get('alt') or aircraft.get('alt_baro')

        field = self.TYPE_MAPPING.get(rule_type)
        if not field:
            return None

        return aircraft.get(field)

    def _compare_values(
        self,
        ac_value,
        operator: str,
        rule_value: str,
        compiled_regex: Optional[re.Pattern] = None,
        rule_type: Optional[str] = None
    ) -> bool:
        """
        Compare aircraft value with rule value using operator.
        """
        try:
            # Special handling for emergency type
            if rule_type == 'emergency':
                is_emergency = str(ac_value) in self.EMERGENCY_SQUAWKS
                expected = rule_value.lower() in ('true', '1', 'yes')
                return is_emergency == expected

            # Special handling for military type
            if rule_type == 'military':
                is_military = bool(ac_value)
                expected = rule_value.lower() in ('true', '1', 'yes')
                return is_military == expected

            if operator == 'eq':
                return str(ac_value).upper() == str(rule_value).upper()
            elif operator == 'neq':
                return str(ac_value).upper() != str(rule_value).upper()
            elif operator == 'lt':
                return float(ac_value) < float(rule_value)
            elif operator in ('le', 'lte'):
                return float(ac_value) <= float(rule_value)
            elif operator == 'gt':
                return float(ac_value) > float(rule_value)
            elif operator in ('ge', 'gte'):
                return float(ac_value) >= float(rule_value)
            elif operator == 'contains':
                return rule_value.upper() in str(ac_value).upper()
            elif operator == 'startswith':
                return str(ac_value).upper().startswith(rule_value.upper())
            elif operator == 'endswith':
                return str(ac_value).upper().endswith(rule_value.upper())
            elif operator == 'regex':
                # Validate regex pattern length to prevent ReDoS
                if len(rule_value) > MAX_REGEX_PATTERN_LENGTH:
                    logger.warning(f"Regex pattern too long ({len(rule_value)} chars), skipping")
                    return False
                if compiled_regex:
                    return bool(compiled_regex.match(str(ac_value)))
                # Compile with error handling for invalid patterns
                try:
                    pattern = re.compile(rule_value, re.IGNORECASE)
                    return bool(pattern.match(str(ac_value)))
                except re.error as e:
                    logger.warning(f"Invalid regex pattern '{rule_value[:50]}...': {e}")
                    return False
            else:
                return False
        except (ValueError, TypeError):
            return False

    def _evaluate_complex_conditions(self, aircraft: dict, conditions: dict) -> bool:
        """
        Evaluate complex AND/OR conditions.
        """
        logic = conditions.get('logic', 'AND').upper()
        groups = conditions.get('groups', [])

        if not groups:
            return True

        results = [
            self._evaluate_condition_group(aircraft, group)
            for group in groups
        ]

        if logic == 'AND':
            return all(results)
        else:  # OR
            return any(results)

    def _evaluate_condition_group(self, aircraft: dict, group: dict) -> bool:
        """
        Evaluate a condition group.
        """
        logic = group.get('logic', 'AND').upper()
        conditions = group.get('conditions', [])

        if not conditions:
            return True

        results = []
        for cond in conditions:
            result = self._evaluate_simple_condition(
                aircraft,
                cond.get('type'),
                cond.get('operator', 'eq'),
                cond.get('value')
            )
            results.append(result)

        if logic == 'AND':
            return all(results)
        else:  # OR
            return any(results)

    def _trigger_alert(self, rule: CompiledRule, aircraft: dict) -> Optional[dict]:
        """
        Trigger an alert and record it.

        Uses distributed cooldowns for multi-worker consistency.
        """
        start_time = time.perf_counter()
        icao = aircraft.get('hex', '').upper()

        # Check suppression windows (if rule has them)
        if self._is_suppressed(rule):
            return None

        # Check cooldown using distributed manager
        can_trigger, last_trigger = cooldown_manager.check_and_set(
            rule.id, icao, rule.cooldown_seconds
        )

        if not can_trigger:
            alert_metrics.record_cooldown_block(rule.id, rule.name)
            return None

        # Create alert message
        callsign = aircraft.get('flight') or icao
        message = f"Alert '{rule.name}' triggered for {callsign}"

        # Store in history
        AlertHistory.objects.create(
            rule_id=rule.id,
            rule_name=rule.name,
            icao_hex=icao,
            callsign=aircraft.get('flight'),
            message=message,
            priority=rule.priority,
            aircraft_data=aircraft,
        )

        # Update rule's last_triggered timestamp
        AlertRule.objects.filter(id=rule.id).update(last_triggered=timezone.now())

        alert_data = {
            'rule_id': rule.id,
            'rule_name': rule.name,
            'icao': icao,
            'callsign': aircraft.get('flight'),
            'message': message,
            'priority': rule.priority,
            'aircraft': aircraft,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }

        # Record metrics
        duration_ms = (time.perf_counter() - start_time) * 1000
        alert_metrics.record_trigger(rule.id, rule.name, rule.priority, duration_ms)

        # Broadcast alert via WebSocket
        try:
            channel_layer = get_channel_layer()
            sync_group_send(
                channel_layer,
                'alerts_all',
                {
                    'type': 'alert_triggered',
                    'data': alert_data
                }
            )

            # Also broadcast to owner-specific channel if rule has owner
            if rule.owner_id:
                sync_group_send(
                    channel_layer,
                    f'alerts_user_{rule.owner_id}',
                    {
                        'type': 'alert_triggered',
                        'data': alert_data
                    }
                )
        except Exception as e:
            logger.warning(f"Failed to broadcast alert: {e}")

        # Send notification - fetch rule from DB to get notification channels
        try:
            db_rule = AlertRule.objects.prefetch_related('notification_channels').get(id=rule.id)
            self._send_notification(alert_data, db_rule)
        except AlertRule.DoesNotExist:
            # Fallback to global config only
            self._send_notification(alert_data, None)

        # Call webhook if configured
        if rule.api_url:
            self._call_webhook(rule.api_url, alert_data)

        return alert_data

    def _is_suppressed(self, rule: CompiledRule) -> bool:
        """
        Check if the rule is currently in a suppression window.

        Suppression windows are stored in the database model, but we need
        to fetch them. For now, return False as suppression windows
        will be implemented in the model changes.
        """
        # This will be implemented when suppression_windows field is added
        # to AlertRule model
        return False

    def _send_notification(self, alert_data: dict, rule: Optional[AlertRule] = None):
        """
        Send notification via Apprise to rule-specific channels and/or global config.

        Priority order:
        1. Rule-specific notification channels (from DB)
        2. Global config (APPRISE_URLS from NotificationConfig) if use_global_notifications is True
        """
        try:
            import apprise

            # Determine notification type based on priority
            notify_type = apprise.NotifyType.INFO
            if alert_data['priority'] == 'warning':
                notify_type = apprise.NotifyType.WARNING
            elif alert_data['priority'] == 'critical':
                notify_type = apprise.NotifyType.FAILURE

            urls_to_notify = []
            channel_ids = []

            # 1. Get rule-specific notification channels
            if rule and hasattr(rule, 'notification_channels'):
                for channel in rule.notification_channels.filter(enabled=True):
                    if channel.apprise_url and channel.apprise_url not in urls_to_notify:
                        urls_to_notify.append(channel.apprise_url)
                        channel_ids.append(channel.id)

            # 2. Get global config if enabled for this rule (or if no rule provided)
            use_global = True
            if rule and hasattr(rule, 'use_global_notifications'):
                use_global = rule.use_global_notifications

            if use_global:
                config = NotificationConfig.get_config()
                if config.enabled and config.apprise_urls:
                    for url in config.apprise_urls.split(';'):
                        url = url.strip()
                        if url and url not in urls_to_notify:
                            urls_to_notify.append(url)

            # If no URLs to notify, skip
            if not urls_to_notify:
                logger.debug("No notification URLs configured, skipping notification")
                return

            # Create Apprise object and add all URLs
            apobj = apprise.Apprise()
            for url in urls_to_notify:
                apobj.add(url)

            # Send notification
            apobj.notify(
                title=f"SkysPy Alert: {alert_data['rule_name']}",
                body=alert_data['message'],
                notify_type=notify_type
            )

            # Log notification for each channel
            for i, url in enumerate(urls_to_notify):
                channel_id = channel_ids[i] if i < len(channel_ids) else None
                NotificationLog.objects.create(
                    notification_type='alert',
                    icao_hex=alert_data['icao'],
                    callsign=alert_data.get('callsign'),
                    message=alert_data['message'],
                    details=alert_data,
                    channel_id=channel_id,
                    channel_url=url,
                    status='sent',
                )

        except ImportError:
            logger.debug("Apprise not installed, skipping notification")
        except Exception as e:
            logger.error(f"Failed to send notification: {e}")

    def _call_webhook(self, url: str, data: dict):
        """
        Call external webhook with alert data.
        """
        try:
            import httpx
            response = httpx.post(url, json=data, timeout=10.0)
            logger.debug(f"Webhook response: {response.status_code}")
        except Exception as e:
            logger.error(f"Webhook call failed: {e}")

    # Public methods for rule testing and management

    def test_rule_against_aircraft(
        self,
        rule_data: dict,
        aircraft_list: list
    ) -> dict:
        """
        Test a rule configuration against aircraft data without saving.

        Args:
            rule_data: Rule configuration dict
            aircraft_list: List of aircraft to test against

        Returns:
            Dict with test results
        """
        # Create a temporary compiled rule
        temp_rule = self._create_temp_rule(rule_data)

        matches = []
        for ac in aircraft_list:
            if temp_rule.can_match(ac) and self._check_rule(temp_rule, ac):
                matches.append(ac)

        return {
            'would_match': len(matches),
            'matched_aircraft': matches,
            'rule_valid': True,
            'aircraft_tested': len(aircraft_list),
        }

    def _create_temp_rule(self, rule_data: dict) -> CompiledRule:
        """Create a temporary CompiledRule from rule data dict."""
        return CompiledRule(
            id=0,  # Temporary
            name=rule_data.get('name', 'Test Rule'),
            rule_type=rule_data.get('type') or rule_data.get('rule_type'),
            operator=rule_data.get('operator', 'eq'),
            value=rule_data.get('value'),
            conditions=rule_data.get('conditions'),
            priority=rule_data.get('priority', 'info'),
            cooldown_seconds=rule_data.get('cooldown_minutes', 5) * 60,
            api_url=rule_data.get('api_url'),
            owner_id=None,
            visibility='private',
            is_system=False,
            starts_at=None,
            expires_at=None,
        )

    def get_status(self) -> dict:
        """Get alert service status including cache and cooldown info."""
        return {
            'cache': rule_cache.get_status(),
            'cooldowns': cooldown_manager.get_status(),
            'metrics': alert_metrics.get_summary(),
        }

    def clear_cooldowns_for_rule(self, rule_id: int) -> int:
        """Clear all cooldowns for a specific rule."""
        return cooldown_manager.clear_rule(rule_id)

    def invalidate_cache(self):
        """Force cache invalidation."""
        rule_cache.invalidate()


# Global singleton
alert_service = AlertService()
