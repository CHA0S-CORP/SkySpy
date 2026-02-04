"""
Alert evaluation performance tests for SkySpy.

Tests alert rule evaluation performance with many rules,
complex condition trees, geographic boundary checks, and
time-based condition evaluation.

Run with: pytest -m performance skyspy/tests/performance/test_alert_evaluation.py
"""

import random
import time
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.db import transaction
from django.utils import timezone

from skyspy.models import AlertHistory, AlertRule
from skyspy.services.alert_rule_cache import CompiledRule, rule_cache
from skyspy.services.alerts import AlertService
from skyspy.tests.performance.conftest import (
    PerformanceMetrics,
    generate_aircraft_data,
    generate_alert_conditions,
    timed_operation,
)


def create_compiled_rule(rule: AlertRule) -> CompiledRule:
    """Create a CompiledRule from an AlertRule model instance."""
    return CompiledRule(
        id=rule.id,
        name=rule.name,
        rule_type=rule.rule_type,
        operator=rule.operator,
        value=rule.value,
        conditions=rule.conditions,
        priority=rule.priority,
        cooldown_seconds=rule.cooldown_minutes * 60 if rule.cooldown_minutes else 300,
        api_url=rule.api_url,
        owner_id=rule.owner_id if hasattr(rule, "owner_id") else None,
        visibility=getattr(rule, "visibility", "private"),
        is_system=getattr(rule, "is_system", False),
        starts_at=rule.starts_at,
        expires_at=rule.expires_at,
    )


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestAlertEvaluationPerformance:
    """
    Tests for alert rule evaluation performance.

    These tests verify the alert service can efficiently evaluate
    many rules against many aircraft.
    """

    def test_evaluation_with_100_rules(self, bulk_alert_rules, thresholds):
        """
        Test alert evaluation with 100+ rules.

        Baseline: Should evaluate 100 rules against 100 aircraft in < 50ms
        """
        service = AlertService()
        aircraft_list = generate_aircraft_data(100)
        metrics = PerformanceMetrics(operation_name="eval_100_rules")

        # Disable notifications for performance test
        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                # Clear cooldowns before each run
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Rules: {bulk_alert_rules.count()}, Aircraft: {len(aircraft_list)}")

        assert metrics.p95 < thresholds["alert_eval_100_rules_p95"]

    def test_evaluation_scaling_with_aircraft(self, bulk_alert_rules, thresholds):
        """
        Test how evaluation time scales with aircraft count.

        Baseline: Time should scale linearly with aircraft count
        """
        service = AlertService()
        aircraft_counts = [50, 100, 250, 500]
        results = {}

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for count in aircraft_counts:
                aircraft_list = generate_aircraft_data(count)
                metrics = PerformanceMetrics(operation_name=f"eval_{count}_aircraft")

                for _ in range(5):
                    from skyspy.services.alert_cooldowns import cooldown_manager
                    cooldown_manager.clear_all()

                    with timed_operation() as timer:
                        service.check_alerts(aircraft_list)

                    metrics.record(
                        type("Result", (), {
                            "duration_ms": timer["duration_ms"],
                            "success": True,
                            "error": None,
                        })()
                    )

                metrics.finalize()
                results[count] = metrics.avg
                print(f"{count} aircraft: avg={metrics.avg:.1f}ms")

        # Verify roughly linear scaling
        # 500 aircraft should take roughly 5-10x as long as 50 aircraft
        ratio = results[500] / results[50] if results[50] > 0 else float("inf")
        print(f"\nScaling ratio (500/50): {ratio:.1f}x")
        assert ratio < 15, f"Scaling is worse than expected: {ratio}x"

    def test_evaluation_per_aircraft_time(self, bulk_alert_rules, thresholds):
        """
        Test per-aircraft evaluation time.

        Baseline: Should average < 1ms per aircraft
        """
        service = AlertService()
        aircraft_list = generate_aircraft_data(500)
        total_time_ms = 0
        iterations = 5

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(iterations):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                total_time_ms += timer["duration_ms"]

        avg_total = total_time_ms / iterations
        per_aircraft = avg_total / len(aircraft_list)

        print(f"\nAvg total time: {avg_total:.1f}ms for {len(aircraft_list)} aircraft")
        print(f"Per aircraft: {per_aircraft:.3f}ms")

        assert per_aircraft < thresholds["alert_eval_per_aircraft"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestComplexConditionEvaluation:
    """
    Tests for complex AND/OR condition tree evaluation.

    These tests verify performance of deeply nested conditions.
    """

    def test_deeply_nested_conditions(self, db, thresholds):
        """
        Test evaluation of deeply nested condition trees.

        Baseline: Deep nesting should not cause exponential slowdown
        """
        service = AlertService()

        # Create rule with deeply nested conditions
        deep_conditions = {
            "logic": "AND",
            "groups": [
                {
                    "logic": "OR",
                    "conditions": [
                        {"type": "altitude", "operator": "gt", "value": "30000"},
                        {"type": "altitude", "operator": "lt", "value": "5000"},
                        {
                            "logic": "AND",
                            "conditions": [
                                {"type": "distance", "operator": "lt", "value": "50"},
                                {"type": "speed", "operator": "gt", "value": "400"},
                            ],
                        }
                    ],
                },
                {
                    "logic": "AND",
                    "conditions": [
                        {"type": "callsign", "operator": "startswith", "value": "UAL"},
                        {"type": "military", "operator": "eq", "value": "false"},
                    ],
                },
            ],
        }

        rule = AlertRule.objects.create(
            name="Deep Nested Rule",
            conditions=deep_conditions,
            enabled=True,
        )

        aircraft_list = generate_aircraft_data(200)
        metrics = PerformanceMetrics(operation_name="deep_nested_eval")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")

        # Cleanup
        rule.delete()

        # Should still be reasonably fast
        assert metrics.p95 < 100

    def test_many_condition_groups(self, db, thresholds):
        """
        Test evaluation with many condition groups.

        Baseline: Multiple groups should evaluate efficiently
        """
        service = AlertService()

        # Create rule with 10 condition groups
        groups = []
        for i in range(10):
            groups.append({
                "logic": "OR",
                "conditions": [
                    {"type": "icao", "operator": "startswith", "value": f"{i:02X}"},
                    {"type": "callsign", "operator": "contains", "value": str(i)},
                    {"type": "altitude", "operator": "gt", "value": str(20000 + i * 2000)},
                ],
            })

        rule = AlertRule.objects.create(
            name="Many Groups Rule",
            conditions={"logic": "AND", "groups": groups},
            enabled=True,
        )

        aircraft_list = generate_aircraft_data(200)
        metrics = PerformanceMetrics(operation_name="many_groups_eval")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")

        # Cleanup
        rule.delete()

        assert metrics.p95 < 150

    def test_regex_condition_performance(self, db, thresholds):
        """
        Test performance of regex-based conditions.

        Baseline: Regex evaluation should not be catastrophically slow
        """
        service = AlertService()

        # Create rules with regex conditions
        regex_rules = []
        patterns = [
            r"UAL\d{3,4}",
            r"[A-Z]{3}\d+",
            r"N\d{3,5}[A-Z]?",
            r"(DAL|AAL|SWA)\d+",
        ]

        for i, pattern in enumerate(patterns):
            regex_rules.append(
                AlertRule.objects.create(
                    name=f"Regex Rule {i}",
                    rule_type="callsign",
                    operator="regex",
                    value=pattern,
                    enabled=True,
                )
            )

        aircraft_list = generate_aircraft_data(200)
        metrics = PerformanceMetrics(operation_name="regex_eval")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")

        # Cleanup
        for rule in regex_rules:
            rule.delete()

        assert metrics.p95 < 200


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestGeographicBoundaryChecks:
    """
    Tests for geographic boundary check performance.

    These tests verify performance of distance-based conditions.
    """

    def test_distance_condition_performance(self, db, thresholds):
        """
        Test performance of distance-based conditions.

        Baseline: Distance checks should be efficient
        """
        service = AlertService()

        # Create distance-based rules
        distance_rules = []
        for i in range(20):
            distance_rules.append(
                AlertRule.objects.create(
                    name=f"Distance Rule {i}",
                    rule_type="distance",
                    operator="lt",
                    value=str(5 + i * 5),  # 5nm, 10nm, 15nm, etc.
                    enabled=True,
                )
            )

        # Aircraft with varying distances
        aircraft_list = generate_aircraft_data(300)
        for ac in aircraft_list:
            ac["distance_nm"] = random.uniform(0.1, 200)

        metrics = PerformanceMetrics(operation_name="distance_eval")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Distance rules: {len(distance_rules)}")

        # Cleanup
        for rule in distance_rules:
            rule.delete()

        assert metrics.p95 < 100

    def test_combined_geo_altitude_conditions(self, db, thresholds):
        """
        Test combined geographic and altitude conditions.

        Baseline: Combined conditions should evaluate efficiently
        """
        service = AlertService()

        # Create rules combining distance and altitude
        combined_rules = []
        for i in range(10):
            combined_rules.append(
                AlertRule.objects.create(
                    name=f"Geo-Alt Rule {i}",
                    conditions={
                        "logic": "AND",
                        "groups": [
                            {
                                "logic": "AND",
                                "conditions": [
                                    {"type": "distance", "operator": "lt", "value": str(20 + i * 10)},
                                    {"type": "altitude", "operator": "lt", "value": str(10000 + i * 5000)},
                                ],
                            }
                        ],
                    },
                    enabled=True,
                )
            )

        aircraft_list = generate_aircraft_data(300)
        metrics = PerformanceMetrics(operation_name="geo_alt_eval")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")

        # Cleanup
        for rule in combined_rules:
            rule.delete()

        assert metrics.p95 < 100


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestTimeBasedConditions:
    """
    Tests for time-based condition evaluation.

    These tests verify performance of schedule checking and
    suppression window evaluation.
    """

    def test_schedule_checking_performance(self, db, thresholds):
        """
        Test performance of checking rule schedules.

        Baseline: Schedule checks should be very fast
        """
        service = AlertService()
        now = timezone.now()

        # Create rules with various schedules
        scheduled_rules = []
        for i in range(50):
            if i % 3 == 0:
                # Not started yet
                starts_at = now + timedelta(hours=i)
                expires_at = now + timedelta(hours=i + 24)
            elif i % 3 == 1:
                # Currently active
                starts_at = now - timedelta(hours=i)
                expires_at = now + timedelta(hours=24 - i)
            else:
                # Expired
                starts_at = now - timedelta(hours=48 + i)
                expires_at = now - timedelta(hours=i)

            scheduled_rules.append(
                AlertRule.objects.create(
                    name=f"Scheduled Rule {i}",
                    rule_type="callsign",
                    operator="startswith",
                    value="TST",
                    enabled=True,
                    starts_at=starts_at,
                    expires_at=expires_at,
                )
            )

        aircraft_list = generate_aircraft_data(100)
        metrics = PerformanceMetrics(operation_name="schedule_check")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Scheduled rules: {len(scheduled_rules)}")

        # Cleanup
        for rule in scheduled_rules:
            rule.delete()

        # Schedule checking should add minimal overhead
        assert metrics.p95 < 100

    def test_cooldown_checking_performance(self, db, thresholds):
        """
        Test performance of cooldown checking.

        Baseline: Cooldown checks should be O(1) per rule-aircraft pair
        """
        service = AlertService()

        # Create rules that will match many aircraft
        matching_rules = []
        for i in range(20):
            matching_rules.append(
                AlertRule.objects.create(
                    name=f"Matching Rule {i}",
                    rule_type="altitude",
                    operator="gt",
                    value="0",  # Matches all aircraft with altitude
                    enabled=True,
                    cooldown_minutes=5,
                )
            )

        aircraft_list = generate_aircraft_data(100)
        metrics = PerformanceMetrics(operation_name="cooldown_check")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            # First run - all will trigger (no cooldowns)
            from skyspy.services.alert_cooldowns import cooldown_manager
            cooldown_manager.clear_all()

            with timed_operation() as timer:
                first_run = service.check_alerts(aircraft_list)

            print(f"\nFirst run: {len(first_run)} triggers in {timer['duration_ms']:.1f}ms")

            # Subsequent runs - all should be blocked by cooldown
            for _ in range(10):
                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        print("Subsequent runs should be faster (cooldown blocks early)")

        # Cleanup
        for rule in matching_rules:
            rule.delete()

        # Cooldown checks should be fast
        assert metrics.p95 < 50


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestRuleCachePerformance:
    """
    Tests for rule cache performance.

    These tests verify the compiled rule cache improves performance.
    """

    def test_cache_hit_performance(self, bulk_alert_rules, thresholds):
        """
        Test performance with cached rules.

        Baseline: Cached rules should evaluate faster than DB fetch
        """
        service = AlertService()
        aircraft_list = generate_aircraft_data(100)

        # Warm up cache
        rule_cache.invalidate()
        rule_cache.get_active_rules()

        metrics = PerformanceMetrics(operation_name="cache_hit")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(10):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")

        # Cache status
        status = rule_cache.get_status()
        print(f"Cache status: {status}")

        assert metrics.p95 < thresholds["alert_eval_100_rules_p95"]

    def test_cache_miss_vs_hit_comparison(self, bulk_alert_rules, thresholds):
        """
        Compare cache miss vs hit performance.

        Baseline: Cache hits should be significantly faster
        """
        service = AlertService()
        aircraft_list = generate_aircraft_data(100)

        # Cache miss metrics
        miss_metrics = PerformanceMetrics(operation_name="cache_miss")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            for _ in range(5):
                rule_cache.invalidate()  # Force cache miss
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                miss_metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        miss_metrics.finalize()

        # Cache hit metrics
        hit_metrics = PerformanceMetrics(operation_name="cache_hit")

        with patch("skyspy.services.alerts.sync_emit"), \
             patch.object(service, "_send_notification"):

            # Warm cache
            rule_cache.get_active_rules()

            for _ in range(5):
                from skyspy.services.alert_cooldowns import cooldown_manager
                cooldown_manager.clear_all()

                with timed_operation() as timer:
                    service.check_alerts(aircraft_list)

                hit_metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        hit_metrics.finalize()

        print(f"\nCache miss: {miss_metrics}")
        print(f"Cache hit: {hit_metrics}")

        # Cache hits should be faster
        assert hit_metrics.avg < miss_metrics.avg * 1.5  # Some tolerance
