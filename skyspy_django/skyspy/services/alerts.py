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

from django.db import DatabaseError, transaction
from django.utils import timezone

# Maximum allowed regex pattern length to prevent ReDoS attacks
MAX_REGEX_PATTERN_LENGTH = 500
from skyspy.models import AlertHistory, AlertRule, NotificationConfig
from skyspy.services.alert_cooldowns import cooldown_manager
from skyspy.services.alert_metrics import EvaluationTimer, alert_metrics
from skyspy.services.alert_rule_cache import CompiledRule, rule_cache
from skyspy.services.notifications import _is_safe_url
from skyspy.socketio.utils import sync_emit

logger = logging.getLogger(__name__)

# ADS-B emitter categories treated as general aviation (light/small/rotor).
# Mirrors GA_EMITTER_CATEGORIES in web/src/components/v2/screens/alerts/alertsModel.js
# so the "class" alert filter and the UI role badges agree.
GA_EMITTER_CATEGORIES = frozenset({"A1", "A2", "A7", "B1", "B2", "B4", "B6"})

# Firefighting / air-tanker detection over callsign + owner/operator + any LE
# description. Word-safe \bfire\b so "Firearms" (ATF) can't false-positive;
# "tanker"/"helitack"/"cal fire" catch air-tanker callsigns and fire agencies.
_FIRE_RE = re.compile(r"\bfire\b|tanker|helitack|cal ?fire|air ?attack", re.IGNORECASE)

# Valid values for the "class" rule type (aircraft role bucket).
AIRCRAFT_CLASSES = ("commercial", "ga", "fire", "police", "military")


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
        "icao": "hex",
        "callsign": "flight",
        "squawk": "squawk",
        "altitude": "alt",
        "distance": "distance_nm",
        "proximity": "distance_nm",  # Alias for distance
        "speed": "gs",
        "vertical_rate": "vr",
        "type": "t",
        "aircraft_type": "t",  # Alias
        "category": "category",
        "class": "class",  # computed role bucket (commercial/ga/fire/police/military)
        "military": "military",
        "emergency": "squawk",  # Special handling
        "registration": "r",
        "operator": "ownOp",
        # Turbulence risk, overlaid from the turb:by_hex cache (see
        # _overlay_turbulence). turbulence_level is compared by rank, not string.
        "turbulence_score": "turbulence_score",
        "turbulence_level": "turbulence_level",
    }

    # Ordering for turbulence_level so gt/ge/lt comparisons work on the labels.
    TURBULENCE_LEVEL_RANK = {"none": 0, "light": 1, "moderate": 2, "severe": 3}

    # Emergency squawk codes
    EMERGENCY_SQUAWKS = {"7500", "7600", "7700"}

    def __init__(self):
        self._legacy_cooldowns: dict = {}  # Fallback for testing
        self._default_cooldown_seconds = 300  # 5 minutes

    @staticmethod
    def _is_military_aircraft(ac: dict) -> bool:
        """Check if aircraft is military via 'military' key or dbFlags bit 0."""
        if ac.get("military"):
            return True
        db_flags = ac.get("dbFlags", 0)
        return bool(db_flags & 1) if isinstance(db_flags, int) else False

    @staticmethod
    def _classify_aircraft(ac: dict) -> str:
        """Bucket an aircraft into one high-level role class for the "class" rule
        type: military | fire | police | ga | commercial.

        Precedence mirrors the frontend deriveTypeBadges() so an alert rule
        matches the same role badge the UI shows. Fire/police come from the
        (network-free) law-enforcement pattern DB; GA from the ADS-B emitter
        category; everything else is commercial.
        """
        if AlertService._is_military_aircraft(ac):
            return "military"

        # Lazy import: keep the service import graph acyclic (matches socketio idiom).
        from skyspy.services import law_enforcement_db

        le = law_enforcement_db.identify_law_enforcement(
            hex_code=ac.get("hex"),
            callsign=ac.get("flight") or ac.get("callsign"),
            operator=ac.get("ownOp") or ac.get("operator"),
            registration=ac.get("r") or ac.get("registration"),
            category=ac.get("category"),
            type_code=ac.get("t") or ac.get("type"),
            owner=ac.get("ownOp") or ac.get("owner"),
        )
        # Fire before police: air tankers / agency helos may also trip an LE
        # owner match, but "fire" is the more specific role. Scan callsign,
        # owner/operator and any LE description together.
        role_text = " ".join(
            str(v)
            for v in (
                ac.get("flight") or ac.get("callsign"),
                ac.get("ownOp") or ac.get("operator") or ac.get("owner"),
                le.get("category"),
                le.get("description"),
            )
            if v
        )
        if role_text and _FIRE_RE.search(role_text):
            return "fire"
        if le.get("is_law_enforcement"):
            return "police"

        if (ac.get("category") or "").upper() in GA_EMITTER_CATEGORIES:
            return "ga"
        return "commercial"

    @staticmethod
    def _enrich_aircraft_for_alert(ac: dict) -> dict:
        """Return a copy of the aircraft dict with identity fields filled in.

        The live hot stream is minimal — operator / manufacturer / model / owner
        live in the AircraftInfo DB table, not in the position stream. Alerts
        fire off the stream dict, so notifications would otherwise show blanks.
        This does a single cache-first lookup (memory → DB → in-memory DBs;
        external APIs only if the rate limit allows) and overlays any missing
        identity fields WITHOUT clobbering values the stream already carries.
        """
        icao = (ac.get("hex") or "").upper().lstrip("~")
        if len(icao) != 6:
            return ac

        try:
            from skyspy.services import aircraft_info as aircraft_info_service

            info = aircraft_info_service.get_aircraft_info(icao, include_photo=False)
        except (DatabaseError, ConnectionError, OSError, ValueError, KeyError, TypeError) as e:
            logger.debug(f"Aircraft-info enrichment failed for {icao}: {type(e).__name__}: {e}")
            info = None

        if not info:
            return ac

        enriched = dict(ac)
        # (aircraft-dict key, info key) — only set when the stream lacks a value.
        for ac_key, info_key in (
            ("operator", "operator"),
            ("owner", "owner"),
            ("manufacturer", "manufacturer"),
            ("model", "model"),
            ("type_name", "type_name"),
            ("r", "registration"),
            ("t", "type_code"),
        ):
            if not enriched.get(ac_key) and info.get(info_key):
                enriched[ac_key] = info[info_key]
        # Flags: only promote a True from the DB (never downgrade a stream flag).
        if info.get("is_military") and not enriched.get("military"):
            enriched["military"] = True
        for ac_key, info_key in (("ladd", "is_ladd"), ("pia", "is_pia")):
            if info.get(info_key) and not enriched.get(ac_key):
                enriched[ac_key] = True
        return enriched

    @staticmethod
    def _build_airframe_summary(ac: dict) -> dict:
        """Derive a compact airframe summary for notification payloads.

        Surfaces the "who/what" fields — law enforcement, military, operator,
        manufacturer/model — that raw webhook receivers and notification
        templates want. LE is resolved via the network-free pattern DB; all
        other fields are read from the aircraft dict when present.
        """
        from skyspy.services import law_enforcement_db

        try:
            le = law_enforcement_db.identify_law_enforcement(
                hex_code=ac.get("hex"),
                callsign=ac.get("flight") or ac.get("callsign"),
                operator=ac.get("ownOp") or ac.get("operator"),
                registration=ac.get("r") or ac.get("registration"),
                category=ac.get("category"),
                type_code=ac.get("t") or ac.get("type"),
                owner=ac.get("ownOp") or ac.get("owner"),
            )
        except (KeyError, TypeError, ValueError):
            le = {}

        return {
            "operator": ac.get("ownOp") or ac.get("operator") or ac.get("owner"),
            "owner": ac.get("owner") or ac.get("ownOp"),
            "manufacturer": ac.get("manufacturer"),
            "model": ac.get("model"),
            "type_code": ac.get("t") or ac.get("type"),
            "type_name": ac.get("type_name") or ac.get("desc"),
            "registration": ac.get("r") or ac.get("registration"),
            "military": AlertService._is_military_aircraft(ac),
            "law_enforcement": bool(le.get("is_law_enforcement")),
            "law_enforcement_category": le.get("category"),
            "law_enforcement_description": le.get("description"),
            "is_ladd": bool(ac.get("ladd") or ac.get("is_ladd")),
            "is_pia": bool(ac.get("pia") or ac.get("is_pia")),
        }

    def check_alerts(self, aircraft_list: list) -> list:
        """
        Check all active alert rules against aircraft.

        Uses segmented rule lookup for O(1) targeted rule access,
        cached compiled rules for performance, and distributed
        cooldowns for multi-worker consistency.

        The algorithm uses segmented indexes to reduce evaluations from
        O(rules x aircraft) to approximately O(general_rules x aircraft + targeted_rules).

        Returns list of triggered alerts.
        """
        with EvaluationTimer(alert_metrics) as timer:
            timer.set_aircraft_count(len(aircraft_list))

            self._overlay_turbulence(aircraft_list)

            now = timezone.now()
            triggered = []
            rules_evaluated = 0

            # Use segmented lookup: for each aircraft, get only potentially matching rules
            try:
                timer.set_cache_hit(True)
                for ac in aircraft_list:
                    # Get only rules that could potentially match this aircraft
                    # This uses O(1) lookups for ICAO, squawk, and includes general rules
                    candidate_rules = rule_cache.get_rules_for_aircraft(ac)

                    for rule in candidate_rules:
                        # Check if rule is active based on schedule
                        if not rule.is_scheduled_active(now):
                            continue

                        rules_evaluated += 1

                        # Apply pre-filtering based on aircraft capabilities
                        if rule.requires_military:
                            # Check both 'military' key and 'dbFlags' bit 0
                            if not self._is_military_aircraft(ac):
                                continue
                        elif (
                            rule.requires_position
                            and ac.get("distance_nm") is None
                            or rule.requires_altitude
                            and ac.get("alt") is None
                            and ac.get("alt_baro") is None
                            or rule.requires_speed
                            and ac.get("gs") is None
                        ):
                            continue

                        # Quick pre-filter using compiled hints (handles target_icao, target_squawk, etc.)
                        if not rule.can_match(ac):
                            continue

                        # Full condition evaluation - isolated per rule so one
                        # malformed rule cannot abort the whole alert cycle
                        try:
                            if self._check_rule(rule, ac):
                                alert = self._trigger_alert(rule, ac)
                                if alert:
                                    triggered.append(alert)
                                    timer.add_trigger()
                        except (KeyError, TypeError, AttributeError, ValueError, DatabaseError) as e:
                            # DatabaseError included so a transient DB fault while
                            # persisting ONE alert (re-raised by _trigger_alert after
                            # clearing its cooldown) skips only that rule instead of
                            # aborting the remaining rules/aircraft this cycle.
                            logger.warning(
                                f"Skipping rule {rule.id} ('{rule.name}') after evaluation error: "
                                f"{type(e).__name__}: {e}"
                            )
                            continue

            except (KeyError, TypeError, AttributeError, ValueError, ConnectionError, OSError) as e:
                logger.warning(f"Segmented lookup failed, falling back to full iteration: {type(e).__name__}: {e}")
                timer.set_cache_hit(False)
                # Fallback to original algorithm
                triggered = self._check_alerts_full_iteration(aircraft_list, now, timer)

            timer.set_rules_evaluated(rules_evaluated)
            return triggered

    def _overlay_turbulence(self, aircraft_list: list) -> None:
        """Stamp turbulence_score/turbulence_level onto aircraft from the
        turb:by_hex cache written by the scorer task, so turbulence rules can
        evaluate without any per-aircraft weather compute on the hot path.

        Only aircraft with a cached (non-"none") risk are stamped; a cheap
        single cache read gates the whole thing when nothing is flagged.
        """
        from django.core.cache import cache

        from skyspy.tasks.turbulence import CACHE_KEY_BY_HEX

        by_hex = cache.get(CACHE_KEY_BY_HEX)
        if not by_hex:
            return
        for ac in aircraft_list:
            hex_code = (ac.get("hex") or "").upper()
            risk = by_hex.get(hex_code)
            if risk:
                ac["turbulence_score"] = risk.get("score")
                ac["turbulence_level"] = risk.get("level")

    def _check_alerts_full_iteration(self, aircraft_list: list, now, timer: "EvaluationTimer") -> list:
        """
        Fallback method: Check all rules against all aircraft.

        Used when segmented lookup fails.
        """
        rules = self._get_rules_from_db()
        active_rules = [r for r in rules if r.is_scheduled_active(now)]
        triggered = []

        for rule in active_rules:
            # Pre-filter aircraft using optimization hints
            if rule.requires_military:
                # Check both 'military' key and 'dbFlags' bit 0 (same as segmented path)
                candidates = [ac for ac in aircraft_list if self._is_military_aircraft(ac)]
            elif rule.requires_position:
                candidates = [ac for ac in aircraft_list if ac.get("distance_nm") is not None]
            elif rule.requires_altitude:
                candidates = [ac for ac in aircraft_list if ac.get("alt") is not None or ac.get("alt_baro") is not None]
            elif rule.requires_speed:
                candidates = [ac for ac in aircraft_list if ac.get("gs") is not None]
            else:
                candidates = aircraft_list

            # Isolate per rule so one malformed rule cannot abort the whole cycle
            try:
                for ac in candidates:
                    if not rule.can_match(ac):
                        continue

                    if self._check_rule(rule, ac):
                        alert = self._trigger_alert(rule, ac)
                        if alert:
                            triggered.append(alert)
                            timer.add_trigger()
            except (KeyError, TypeError, AttributeError, ValueError, DatabaseError) as e:
                # DatabaseError: see segmented path above — isolate per rule.
                logger.warning(
                    f"Skipping rule {rule.id} ('{rule.name}') after evaluation error: {type(e).__name__}: {e}"
                )
                continue

        return triggered

    def _get_rules_from_db(self) -> list[CompiledRule]:
        """Fallback: get rules directly from database."""
        db_rules = AlertRule.objects.filter(enabled=True).select_related("owner")
        return [CompiledRule.from_db_rule(r) for r in db_rules]

    def _check_rule(self, rule: CompiledRule, aircraft: dict) -> bool:
        """
        Check if aircraft matches a rule.

        Evaluates both simple conditions and complex AND/OR conditions.
        """
        # Check simple conditions
        if (
            rule.rule_type
            and rule.value
            and not self._evaluate_simple_condition(
                aircraft, rule.rule_type, rule.operator, rule.value, compiled_regex=rule.compiled_regex
            )
        ):
            return False

        # Check complex conditions
        return not (rule.conditions and not self._evaluate_complex_conditions(aircraft, rule.conditions))

    def _evaluate_simple_condition(
        self, aircraft: dict, rule_type: str, operator: str, value: str, compiled_regex: re.Pattern | None = None
    ) -> bool:
        """
        Evaluate a simple condition against an aircraft.
        """
        # Get aircraft value based on rule type
        ac_value = self._get_aircraft_value(aircraft, rule_type)

        if ac_value is None:
            # For boolean types (emergency, military), allow None to be treated as False
            if rule_type in ("emergency", "military"):
                ac_value = False
            else:
                return False

        return self._compare_values(ac_value, operator, value, compiled_regex, rule_type)

    def _get_aircraft_value(self, aircraft: dict, rule_type: str):
        """
        Get the relevant value from aircraft data.
        """
        # Computed role bucket (commercial/ga/fire/police/military). Always a
        # string, so simple eq/contains/regex ("in list") comparisons apply.
        if rule_type == "class":
            return self._classify_aircraft(aircraft)

        # Special handling for military type - check both 'military' key and 'dbFlags'
        if rule_type == "military":
            # First check explicit 'military' key
            if "military" in aircraft:
                return aircraft["military"]
            # Fall back to dbFlags (bit 0 = military)
            db_flags = aircraft.get("dbFlags", 0)
            if isinstance(db_flags, int):
                return bool(db_flags & 1)
            return False

        # Special handling for altitude - check both 'alt' and 'alt_baro'.
        # Use explicit None checks so a legitimate 0 ft altitude is preserved.
        if rule_type == "altitude":
            alt = aircraft.get("alt")
            return alt if alt is not None else aircraft.get("alt_baro")

        # Turbulence level compares by rank (none<light<moderate<severe) so the
        # numeric operators work on the label. Missing/none -> rank 0.
        if rule_type == "turbulence_level":
            level = aircraft.get("turbulence_level")
            if level is None:
                return None
            return self.TURBULENCE_LEVEL_RANK.get(str(level).lower(), 0)

        field = self.TYPE_MAPPING.get(rule_type)
        if not field:
            return None

        return aircraft.get(field)

    def _compare_values(
        self,
        ac_value,
        operator: str,
        rule_value: str,
        compiled_regex: re.Pattern | None = None,
        rule_type: str | None = None,
    ) -> bool:
        """
        Compare aircraft value with rule value using operator.
        """
        try:
            # A missing/None rule value can never match. Malformed complex
            # conditions may omit "value" - without this guard the string
            # operations below raise AttributeError and kill the alert cycle.
            if rule_value is None:
                return False

            # Special handling for emergency type
            if rule_type == "emergency":
                is_emergency = str(ac_value) in self.EMERGENCY_SQUAWKS
                expected = rule_value.lower() in ("true", "1", "yes")
                return is_emergency == expected

            # Special handling for military type
            if rule_type == "military":
                is_military = bool(ac_value)
                expected = rule_value.lower() in ("true", "1", "yes")
                return is_military == expected

            # Turbulence level: ac_value is already a rank int; convert the rule
            # value (a label like "moderate", or a numeric rank) to a rank too.
            if rule_type == "turbulence_level":
                rule_value = self.TURBULENCE_LEVEL_RANK.get(str(rule_value).lower(), rule_value)

            if operator == "eq":
                return str(ac_value).upper() == str(rule_value).upper()
            elif operator == "neq":
                return str(ac_value).upper() != str(rule_value).upper()
            elif operator == "lt":
                return float(ac_value) < float(rule_value)
            elif operator in ("le", "lte"):
                return float(ac_value) <= float(rule_value)
            elif operator == "gt":
                return float(ac_value) > float(rule_value)
            elif operator in ("ge", "gte"):
                return float(ac_value) >= float(rule_value)
            elif operator == "contains":
                return rule_value.upper() in str(ac_value).upper()
            elif operator == "startswith":
                return str(ac_value).upper().startswith(rule_value.upper())
            elif operator == "endswith":
                return str(ac_value).upper().endswith(rule_value.upper())
            elif operator == "regex":
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
        logic = conditions.get("logic", "AND").upper()
        groups = conditions.get("groups", [])

        # Default-deny: a conditions dict with no groups is malformed. Returning
        # True here would turn a misconfigured rule into a catch-all that matches
        # every aircraft.
        if not groups:
            return False

        results = [self._evaluate_condition_group(aircraft, group) for group in groups]

        if logic == "AND":
            return all(results)
        else:  # OR
            return any(results)

    def _evaluate_condition_group(self, aircraft: dict, group: dict) -> bool:
        """
        Evaluate a condition group.
        """
        logic = group.get("logic", "AND").upper()
        conditions = group.get("conditions", [])

        # Default-deny: an empty condition group must not match every aircraft.
        if not conditions:
            return False

        results = []
        for cond in conditions:
            result = self._evaluate_simple_condition(
                aircraft, cond.get("type"), cond.get("operator", "eq"), cond.get("value")
            )
            results.append(result)

        if logic == "AND":
            return all(results)
        else:  # OR
            return any(results)

    def _trigger_alert(self, rule: CompiledRule, aircraft: dict) -> dict | None:
        """
        Trigger an alert and record it.

        Uses distributed cooldowns for multi-worker consistency.
        """
        start_time = time.perf_counter()
        icao = aircraft.get("hex", "").upper()

        # Validate ICAO to prevent empty string cooldown keys
        if not icao:
            logger.debug("Skipping alert trigger: missing ICAO hex")
            return None

        # Check suppression windows (if rule has them)
        if self._is_suppressed(rule):
            return None

        # Check cooldown using distributed manager
        can_trigger, last_trigger = cooldown_manager.check_and_set(rule.id, icao, rule.cooldown_seconds)

        if not can_trigger:
            alert_metrics.record_cooldown_block(rule.id, rule.name)
            return None

        # Overlay identity fields (operator / manufacturer / model / owner) from
        # the AircraftInfo DB — the hot stream carries none of these, so without
        # this the notification airframe fields render blank.
        aircraft = self._enrich_aircraft_for_alert(aircraft)

        # Create alert message
        callsign = aircraft.get("flight") or icao
        message = f"Alert '{rule.name}' triggered for {callsign}"

        # Store in history and update rule atomically. On failure, roll back
        # the cooldown that check_and_set just wrote - otherwise a transient
        # DB error would silently suppress this alert (no history row, no
        # broadcast, no notification) for the entire cooldown window.
        try:
            with transaction.atomic():
                AlertHistory.objects.create(
                    rule_id=rule.id,
                    rule_name=rule.name,
                    icao_hex=icao,
                    callsign=aircraft.get("flight"),
                    message=message,
                    priority=rule.priority,
                    aircraft_data=aircraft,
                    # Attribute the alert to the rule owner so history can be
                    # filtered directly by user (owner_id is carried on the
                    # CompiledRule, no extra query needed).
                    user_id=rule.owner_id,
                )

                # Update rule's last_triggered timestamp
                AlertRule.objects.filter(id=rule.id).update(last_triggered=timezone.now())
        except DatabaseError:
            cooldown_manager.clear_one(rule.id, icao)
            raise

        alert_data = {
            "rule_id": rule.id,
            "rule_name": rule.name,
            "icao": icao,
            "callsign": aircraft.get("flight"),
            "message": message,
            "priority": rule.priority,
            "aircraft": aircraft,
            # Derived airframe summary (LE / military / operator / manufacturer,
            # etc.) so raw webhook receivers (n8n) get structured fields and
            # notification templates can reference them without a network call.
            "airframe": self._build_airframe_summary(aircraft),
            "timestamp": timezone.now().isoformat(),
        }

        # Record metrics
        duration_ms = (time.perf_counter() - start_time) * 1000
        alert_metrics.record_trigger(rule.id, rule.name, rule.priority, duration_ms)

        # Broadcast alert via WebSocket after transaction commits.
        # Subscribers join "topic_alerts" (see socketio/namespaces/main.py on_subscribe);
        # there is no per-user room convention, so a single topic emit reaches everyone.
        def emit_alert():
            try:
                sync_emit("alert:triggered", alert_data, room="topic_alerts")
            except (ConnectionError, OSError, RuntimeError) as e:
                logger.warning(f"Failed to broadcast alert: {type(e).__name__}: {e}")

        transaction.on_commit(emit_alert)

        # Send notifications + webhook. The rule's api_url, its notification
        # channels, and the global config are collected and de-duplicated in one
        # place (_send_notification) so a URL configured in two spots only fires
        # once. Plain http(s) URLs are POSTed as JSON; Apprise service URLs
        # (discord://, slack://, …) go through Apprise.
        try:
            db_rule = AlertRule.objects.prefetch_related("notification_channels").get(id=rule.id)
            self._send_notification(alert_data, db_rule, webhook_url=rule.api_url, rule_name=rule.name)
        except AlertRule.DoesNotExist:
            # Fallback to global config + rule webhook only
            self._send_notification(alert_data, None, webhook_url=rule.api_url, rule_name=rule.name)

        return alert_data

    def _is_suppressed(self, rule: CompiledRule) -> bool:
        """
        Check if the rule is currently in a suppression window.

        The rule's suppression_windows are carried on the CompiledRule (cached
        from the DB model), so no DB fetch is needed on the hot path.
        """
        from skyspy.models.alerts import evaluate_suppression_windows

        return evaluate_suppression_windows(rule.suppression_windows)

    def _send_notification(
        self,
        alert_data: dict,
        rule: AlertRule | None = None,
        webhook_url: str | None = None,
        rule_name: str | None = None,
    ):
        """
        Send notifications for an alert, de-duplicated across every source.

        Collects destination URLs from (in priority order):
        1. The rule's own webhook_url (api_url)
        2. Rule-specific notification channels (from DB)
        3. Global config (APPRISE_URLS) if use_global_notifications is True

        Each unique URL fires once. Plain http(s):// URLs are POSTed as JSON
        (send_webhook_task) so raw webhook receivers like n8n get a JSON body;
        Apprise service URLs (discord://, slack://, ntfy://, …) go through
        Apprise. This keeps a URL that appears both as the rule webhook and as a
        channel from delivering twice.
        """
        try:
            # (url, channel_id) pairs, de-duplicated by URL across all sources.
            url_channel_pairs = []
            seen_urls = set()

            # 1. The rule's own webhook URL (highest priority, no channel id).
            if webhook_url:
                webhook_url = webhook_url.strip()
                if webhook_url:
                    url_channel_pairs.append((webhook_url, None))
                    seen_urls.add(webhook_url)

            # 2. Rule-specific notification channels.
            if rule and hasattr(rule, "notification_channels"):
                for channel in rule.notification_channels.filter(enabled=True):
                    if channel.apprise_url and channel.apprise_url not in seen_urls:
                        url_channel_pairs.append((channel.apprise_url, channel.id))
                        seen_urls.add(channel.apprise_url)

            # 3. Global config if enabled for this rule (or if no rule provided).
            use_global = True
            if rule and hasattr(rule, "use_global_notifications"):
                use_global = rule.use_global_notifications

            if use_global:
                config = NotificationConfig.get_config()
                if config.enabled and config.apprise_urls:
                    for url in config.apprise_urls.split(";"):
                        url = url.strip()
                        if url and url not in seen_urls:
                            url_channel_pairs.append((url, None))
                            seen_urls.add(url)

            # If no URLs to notify, skip
            if not url_channel_pairs:
                logger.debug("No notification URLs configured, skipping notification")
                return

            display_name = rule_name or alert_data.get("rule_name", "?")

            # Deliver via Celery so slow/timing-out endpoints never stall the
            # aircraft polling hot path. Each task owns its own logging/retry.
            from skyspy.tasks.notifications import send_notification_task, send_webhook_task

            # Render title/body once for the Apprise channels. We keep the
            # channel selection above rather than routing through
            # notification_dispatcher.dispatch_alert(): that dispatcher selects
            # channels by user preference + global NotificationChannel rows and
            # does NOT honor a rule's notification_channels M2M or
            # use_global_notifications, so switching would silently drop per-rule
            # delivery. See services/notification_dispatcher.py.
            title, body = self._render_alert_message(alert_data)

            for url, channel_id in url_channel_pairs:
                # Isolate each iteration: a failure queueing one destination must
                # not skip delivery to the rest.
                try:
                    if url.lower().startswith(("http://", "https://")):
                        # Raw webhook — POST the alert JSON directly. Apprise
                        # cannot deliver a bare http(s) URL (it needs json://),
                        # so this is the only path that reaches n8n-style hooks.
                        if not _is_safe_url(url):
                            logger.warning(f"Blocked unsafe webhook URL for rule '{display_name}': {url[:100]}")
                            continue
                        send_webhook_task.delay(
                            url=url,
                            data=alert_data,
                            timeout=10.0,
                            rule_id=alert_data.get("rule_id"),
                            rule_name=display_name,
                        )
                    else:
                        send_notification_task.delay(
                            channel_url=url,
                            title=title,
                            body=body,
                            priority=alert_data.get("priority", "info"),
                            event_type="alert",
                            channel_id=channel_id,
                            context=alert_data,
                        )
                except Exception as e:  # broad: broker enqueue must never break the alert hot path
                    logger.error(
                        f"Failed to queue notification for "
                        f"{channel_id if channel_id is not None else url[:50]} "
                        f"(rule '{display_name}'): {type(e).__name__}: {e}"
                    )

        except (DatabaseError, ConnectionError, OSError, ValueError, TypeError) as e:
            logger.error(f"Failed to send notification: {type(e).__name__}: {e}")

    def _render_alert_message(self, alert_data: dict) -> tuple[str, str]:
        """Render notification (title, body) for an alert.

        Uses a matching NotificationTemplate (by event_type "alert" + priority)
        when configured, rendering its variables against the alert context;
        otherwise falls back to the plain default title/body.
        """
        default_title = f"SkysPy Alert: {alert_data['rule_name']}"
        default_body = alert_data.get("message", "")

        try:
            from skyspy.models.notifications import NotificationTemplate
            from skyspy.services.template_engine import template_engine

            template = NotificationTemplate.get_template_for("alert", alert_data.get("priority", "info"))
            if not template:
                return default_title, default_body

            context = template_engine.build_context_from_alert(alert_data)
            title = template_engine.render(template.title_template, context) or default_title
            body = template_engine.render(template.body_template, context) or default_body
            return title, body
        except (DatabaseError, ValueError, KeyError, TypeError) as e:
            logger.warning(f"Alert template render failed, using defaults: {type(e).__name__}: {e}")
            return default_title, default_body

    def _call_webhook(self, url: str, data: dict, rule: CompiledRule):
        """
        Queue webhook delivery as async task.

        This is non-blocking - the actual HTTP call happens in a Celery worker.
        Webhook delivery is handled asynchronously to avoid blocking alert processing.

        Args:
            url: Webhook URL to POST to
            data: Alert data payload
            rule: The compiled rule that triggered the alert
        """
        from skyspy.tasks.notifications import send_webhook_task

        try:
            send_webhook_task.delay(
                url=url,
                data=data,
                timeout=10.0,
                rule_id=rule.id,
                rule_name=rule.name,
            )
            logger.debug(f"Queued webhook for rule {rule.id}")
        except (ConnectionError, OSError, RuntimeError) as e:
            logger.error(f"Failed to queue webhook for rule {rule.id}: {type(e).__name__}: {e}")

    # Public methods for rule testing and management

    def test_rule_against_aircraft(self, rule_data: dict, aircraft_list: list) -> dict:
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
            "would_match": len(matches),
            "matched_aircraft": matches,
            "rule_valid": True,
            "aircraft_tested": len(aircraft_list),
        }

    def _create_temp_rule(self, rule_data: dict) -> CompiledRule:
        """Create a temporary CompiledRule from rule data dict."""
        return CompiledRule(
            id=0,  # Temporary
            name=rule_data.get("name", "Test Rule"),
            rule_type=rule_data.get("type") or rule_data.get("rule_type"),
            operator=rule_data.get("operator", "eq"),
            value=rule_data.get("value"),
            conditions=rule_data.get("conditions"),
            priority=rule_data.get("priority", "info"),
            cooldown_seconds=rule_data.get("cooldown_minutes", 5) * 60,
            api_url=rule_data.get("api_url"),
            owner_id=None,
            visibility="private",
            is_system=False,
            starts_at=None,
            expires_at=None,
        )

    def get_status(self) -> dict:
        """Get alert service status including cache and cooldown info."""
        return {
            "cache": rule_cache.get_status(),
            "cooldowns": cooldown_manager.get_status(),
            "metrics": alert_metrics.get_summary(),
        }

    def clear_cooldowns_for_rule(self, rule_id: int) -> int:
        """Clear all cooldowns for a specific rule."""
        return cooldown_manager.clear_rule(rule_id)

    def invalidate_cache(self):
        """Force cache invalidation."""
        rule_cache.invalidate()


# Global singleton
alert_service = AlertService()
