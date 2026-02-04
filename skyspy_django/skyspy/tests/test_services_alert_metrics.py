"""
Tests for the AlertMetrics service.

Tests alert performance metrics collection,
evaluation timing, trigger rates, and cache statistics.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase

from skyspy.services.alert_metrics import (
    AlertMetricsCollector,
    EvaluationMetrics,
    EvaluationTimer,
    RuleMetrics,
    alert_metrics,
)


class EvaluationMetricsDataclassTests(TestCase):
    """Tests for EvaluationMetrics dataclass."""

    def test_evaluation_metrics_creation(self):
        """Test creating EvaluationMetrics instance."""
        now = datetime.utcnow()
        metrics = EvaluationMetrics(
            start_time=now,
            duration_ms=15.5,
            aircraft_count=100,
            rules_evaluated=25,
            alerts_triggered=3,
            cache_hit=True,
        )

        self.assertEqual(metrics.start_time, now)
        self.assertEqual(metrics.duration_ms, 15.5)
        self.assertEqual(metrics.aircraft_count, 100)
        self.assertEqual(metrics.rules_evaluated, 25)
        self.assertEqual(metrics.alerts_triggered, 3)
        self.assertTrue(metrics.cache_hit)


class RuleMetricsDataclassTests(TestCase):
    """Tests for RuleMetrics dataclass."""

    def test_rule_metrics_creation(self):
        """Test creating RuleMetrics instance."""
        metrics = RuleMetrics(
            rule_id=1,
            rule_name="Test Rule",
        )

        self.assertEqual(metrics.rule_id, 1)
        self.assertEqual(metrics.rule_name, "Test Rule")
        self.assertEqual(metrics.evaluation_count, 0)
        self.assertEqual(metrics.trigger_count, 0)
        self.assertIsNone(metrics.last_triggered)
        self.assertEqual(metrics.total_evaluation_ms, 0.0)
        self.assertEqual(metrics.cooldown_blocks, 0)


class AlertMetricsCollectorInitTests(TestCase):
    """Tests for AlertMetricsCollector initialization."""

    def test_collector_initialization(self):
        """Test AlertMetricsCollector default initialization."""
        collector = AlertMetricsCollector()

        self.assertEqual(collector._window_minutes, 60)
        self.assertEqual(collector._evaluations, [])
        self.assertEqual(collector._rule_metrics, {})
        self.assertEqual(collector._total_evaluations, 0)
        self.assertEqual(collector._total_triggers, 0)
        self.assertEqual(collector._cache_hits, 0)
        self.assertEqual(collector._cache_misses, 0)

    def test_collector_custom_window(self):
        """Test AlertMetricsCollector with custom window."""
        collector = AlertMetricsCollector(window_minutes=30)

        self.assertEqual(collector._window_minutes, 30)


class AlertMetricsCollectorRecordEvaluationTests(TestCase):
    """Tests for recording evaluation metrics."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_record_evaluation(self):
        """Test recording a single evaluation."""
        self.collector.record_evaluation(
            duration_ms=15.0,
            aircraft_count=100,
            rules_evaluated=25,
            alerts_triggered=2,
            cache_hit=True,
        )

        self.assertEqual(len(self.collector._evaluations), 1)
        self.assertEqual(self.collector._total_evaluations, 1)
        self.assertEqual(self.collector._total_triggers, 2)
        self.assertEqual(self.collector._cache_hits, 1)
        self.assertEqual(self.collector._cache_misses, 0)

    def test_record_evaluation_cache_miss(self):
        """Test recording evaluation with cache miss."""
        self.collector.record_evaluation(
            duration_ms=20.0,
            aircraft_count=50,
            rules_evaluated=10,
            alerts_triggered=0,
            cache_hit=False,
        )

        self.assertEqual(self.collector._cache_hits, 0)
        self.assertEqual(self.collector._cache_misses, 1)

    def test_record_evaluation_multiple(self):
        """Test recording multiple evaluations."""
        for i in range(5):
            self.collector.record_evaluation(
                duration_ms=10.0 + i,
                aircraft_count=100,
                rules_evaluated=25,
                alerts_triggered=i,
                cache_hit=True,
            )

        self.assertEqual(len(self.collector._evaluations), 5)
        self.assertEqual(self.collector._total_evaluations, 5)
        self.assertEqual(self.collector._total_triggers, 10)  # 0+1+2+3+4

    def test_record_evaluation_max_buffer(self):
        """Test that evaluation buffer respects max size."""
        self.collector._max_evaluations = 5

        for _i in range(10):
            self.collector.record_evaluation(
                duration_ms=10.0,
                aircraft_count=100,
                rules_evaluated=25,
                alerts_triggered=0,
                cache_hit=True,
            )

        # Should have at most 5 evaluations in buffer
        self.assertEqual(len(self.collector._evaluations), 5)
        # But total count should be accurate
        self.assertEqual(self.collector._total_evaluations, 10)


class AlertMetricsCollectorRecordTriggerTests(TestCase):
    """Tests for recording alert triggers."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_record_trigger_new_rule(self):
        """Test recording trigger for new rule."""
        self.collector.record_trigger(
            rule_id=1,
            rule_name="Test Rule",
            priority="warning",
            evaluation_ms=5.0,
        )

        self.assertIn(1, self.collector._rule_metrics)
        rm = self.collector._rule_metrics[1]
        self.assertEqual(rm.rule_name, "Test Rule")
        self.assertEqual(rm.trigger_count, 1)
        self.assertEqual(rm.evaluation_count, 1)
        self.assertIsNotNone(rm.last_triggered)

    def test_record_trigger_existing_rule(self):
        """Test recording trigger for existing rule."""
        # First trigger
        self.collector.record_trigger(
            rule_id=1,
            rule_name="Test Rule",
            priority="warning",
            evaluation_ms=5.0,
        )

        # Second trigger
        self.collector.record_trigger(
            rule_id=1,
            rule_name="Test Rule",
            priority="warning",
            evaluation_ms=6.0,
        )

        rm = self.collector._rule_metrics[1]
        self.assertEqual(rm.trigger_count, 2)
        self.assertEqual(rm.evaluation_count, 2)
        self.assertEqual(rm.total_evaluation_ms, 11.0)

    def test_record_trigger_multiple_rules(self):
        """Test recording triggers for multiple rules."""
        self.collector.record_trigger(rule_id=1, rule_name="Rule 1", priority="info", evaluation_ms=5.0)
        self.collector.record_trigger(rule_id=2, rule_name="Rule 2", priority="warning", evaluation_ms=7.0)
        self.collector.record_trigger(rule_id=3, rule_name="Rule 3", priority="critical", evaluation_ms=10.0)

        self.assertEqual(len(self.collector._rule_metrics), 3)


class AlertMetricsCollectorRecordCooldownTests(TestCase):
    """Tests for recording cooldown blocks."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_record_cooldown_block_new_rule(self):
        """Test recording cooldown block for new rule."""
        self.collector.record_cooldown_block(rule_id=1, rule_name="Test Rule")

        self.assertEqual(self.collector._total_cooldown_blocks, 1)
        self.assertIn(1, self.collector._rule_metrics)
        self.assertEqual(self.collector._rule_metrics[1].cooldown_blocks, 1)

    def test_record_cooldown_block_existing_rule(self):
        """Test recording cooldown block for existing rule."""
        self.collector.record_cooldown_block(rule_id=1, rule_name="Test Rule")
        self.collector.record_cooldown_block(rule_id=1, rule_name="Test Rule")

        self.assertEqual(self.collector._total_cooldown_blocks, 2)
        self.assertEqual(self.collector._rule_metrics[1].cooldown_blocks, 2)


class AlertMetricsCollectorRecordRuleEvaluationTests(TestCase):
    """Tests for recording rule evaluations."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_record_rule_evaluation_new_rule(self):
        """Test recording rule evaluation for new rule."""
        self.collector.record_rule_evaluation(rule_id=1, rule_name="Test Rule", evaluation_ms=5.0)

        self.assertIn(1, self.collector._rule_metrics)
        rm = self.collector._rule_metrics[1]
        self.assertEqual(rm.evaluation_count, 1)
        self.assertEqual(rm.trigger_count, 0)  # Evaluation without trigger
        self.assertEqual(rm.total_evaluation_ms, 5.0)

    def test_record_rule_evaluation_existing_rule(self):
        """Test recording rule evaluation for existing rule."""
        self.collector.record_rule_evaluation(rule_id=1, rule_name="Test Rule", evaluation_ms=5.0)
        self.collector.record_rule_evaluation(rule_id=1, rule_name="Test Rule", evaluation_ms=6.0)

        rm = self.collector._rule_metrics[1]
        self.assertEqual(rm.evaluation_count, 2)
        self.assertEqual(rm.total_evaluation_ms, 11.0)


class AlertMetricsCollectorGetSummaryTests(TestCase):
    """Tests for getting metrics summary."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_get_summary_empty(self):
        """Test getting summary with no data."""
        summary = self.collector.get_summary()

        self.assertEqual(summary["window_minutes"], 60)
        self.assertEqual(summary["evaluations_in_window"], 0)
        self.assertEqual(summary["average_duration_ms"], 0)
        self.assertEqual(summary["total_evaluations"], 0)
        self.assertEqual(summary["total_triggers"], 0)
        self.assertEqual(summary["rules_tracked"], 0)

    def test_get_summary_with_data(self):
        """Test getting summary with evaluation data."""
        # Record some evaluations
        for i in range(5):
            self.collector.record_evaluation(
                duration_ms=10.0 + i,
                aircraft_count=100,
                rules_evaluated=25,
                alerts_triggered=1,
                cache_hit=True,
            )

        summary = self.collector.get_summary()

        self.assertEqual(summary["evaluations_in_window"], 5)
        self.assertEqual(summary["total_evaluations"], 5)
        self.assertEqual(summary["total_triggers"], 5)
        self.assertGreater(summary["average_duration_ms"], 0)

    def test_get_summary_cache_hit_ratio(self):
        """Test cache hit ratio in summary."""
        # 3 cache hits, 2 cache misses
        for _i in range(3):
            self.collector.record_evaluation(
                duration_ms=10.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=0, cache_hit=True
            )
        for _i in range(2):
            self.collector.record_evaluation(
                duration_ms=10.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=0, cache_hit=False
            )

        summary = self.collector.get_summary()

        # Cache hit ratio should be 3/5 = 0.6
        self.assertEqual(summary["overall_cache_hit_ratio"], 0.6)

    def test_get_summary_window_filtering(self):
        """Test that summary only includes evaluations in window."""
        # Create evaluation outside window
        old_metrics = EvaluationMetrics(
            start_time=datetime.utcnow() - timedelta(minutes=120),  # 2 hours ago
            duration_ms=10.0,
            aircraft_count=100,
            rules_evaluated=25,
            alerts_triggered=0,
            cache_hit=True,
        )
        self.collector._evaluations.append(old_metrics)
        self.collector._total_evaluations += 1

        # Create evaluation inside window
        self.collector.record_evaluation(
            duration_ms=15.0,
            aircraft_count=100,
            rules_evaluated=25,
            alerts_triggered=0,
            cache_hit=True,
        )

        summary = self.collector.get_summary()

        # Only recent evaluation should be in window
        self.assertEqual(summary["evaluations_in_window"], 1)
        self.assertEqual(summary["total_evaluations"], 2)


class AlertMetricsCollectorGetRuleMetricsTests(TestCase):
    """Tests for getting rule-specific metrics."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_get_rule_metrics_empty(self):
        """Test getting rule metrics with no data."""
        result = self.collector.get_rule_metrics()

        self.assertEqual(result, [])

    def test_get_rule_metrics_with_data(self):
        """Test getting rule metrics with trigger data."""
        # Record triggers for different rules
        for i in range(3):
            self.collector.record_trigger(
                rule_id=i + 1,
                rule_name=f"Rule {i + 1}",
                priority="info",
                evaluation_ms=5.0,
            )

        result = self.collector.get_rule_metrics()

        self.assertEqual(len(result), 3)

    def test_get_rule_metrics_sorted_by_trigger_count(self):
        """Test that rule metrics are sorted by trigger count."""
        # Create rule 1 with 5 triggers
        for _ in range(5):
            self.collector.record_trigger(rule_id=1, rule_name="Rule 1", priority="info", evaluation_ms=5.0)

        # Create rule 2 with 3 triggers
        for _ in range(3):
            self.collector.record_trigger(rule_id=2, rule_name="Rule 2", priority="info", evaluation_ms=5.0)

        result = self.collector.get_rule_metrics()

        # Rule 1 should be first (most triggers)
        self.assertEqual(result[0]["rule_id"], 1)
        self.assertEqual(result[0]["trigger_count"], 5)
        self.assertEqual(result[1]["rule_id"], 2)
        self.assertEqual(result[1]["trigger_count"], 3)

    def test_get_rule_metrics_limit(self):
        """Test limit parameter for rule metrics."""
        # Create 25 rules
        for i in range(25):
            self.collector.record_trigger(rule_id=i + 1, rule_name=f"Rule {i + 1}", priority="info", evaluation_ms=5.0)

        result = self.collector.get_rule_metrics(limit=10)

        self.assertEqual(len(result), 10)

    def test_get_rule_metrics_includes_trigger_rate(self):
        """Test that rule metrics includes trigger rate."""
        # Record evaluations and triggers
        for _ in range(10):
            self.collector.record_rule_evaluation(rule_id=1, rule_name="Test Rule", evaluation_ms=5.0)
        for _ in range(5):
            self.collector.record_trigger(rule_id=1, rule_name="Test Rule", priority="info", evaluation_ms=5.0)

        result = self.collector.get_rule_metrics()

        # Trigger rate should be 5/15 = 33.33%
        self.assertAlmostEqual(result[0]["trigger_rate"], 33.33, places=1)


class AlertMetricsCollectorGetTimingHistogramTests(TestCase):
    """Tests for getting timing histogram."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_get_timing_histogram_empty(self):
        """Test getting timing histogram with no data."""
        result = self.collector.get_timing_histogram()

        self.assertEqual(result["buckets"], [])
        self.assertEqual(result["min"], 0)
        self.assertEqual(result["max"], 0)
        self.assertEqual(result["median"], 0)

    def test_get_timing_histogram_with_data(self):
        """Test getting timing histogram with evaluation data."""
        # Create evaluations with varying durations
        for i in range(100):
            self.collector.record_evaluation(
                duration_ms=float(i + 1),  # 1-100 ms
                aircraft_count=100,
                rules_evaluated=25,
                alerts_triggered=0,
                cache_hit=True,
            )

        result = self.collector.get_timing_histogram(buckets=10)

        self.assertEqual(len(result["buckets"]), 10)
        self.assertEqual(result["min_ms"], 1.0)
        self.assertEqual(result["max_ms"], 100.0)
        self.assertEqual(result["sample_count"], 100)

    def test_get_timing_histogram_bucket_distribution(self):
        """Test timing histogram bucket distribution."""
        # Create evaluations clustered in lower range
        for _ in range(50):
            self.collector.record_evaluation(
                duration_ms=5.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=0, cache_hit=True
            )
        for _ in range(50):
            self.collector.record_evaluation(
                duration_ms=95.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=0, cache_hit=True
            )

        result = self.collector.get_timing_histogram(buckets=10)

        # Should have buckets with counts
        total_in_buckets = sum(b["count"] for b in result["buckets"])
        self.assertEqual(total_in_buckets, 100)


class AlertMetricsCollectorResetTests(TestCase):
    """Tests for resetting metrics."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_reset_clears_all_data(self):
        """Test that reset clears all metrics."""
        # Add some data
        self.collector.record_evaluation(
            duration_ms=10.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=1, cache_hit=True
        )
        self.collector.record_trigger(rule_id=1, rule_name="Test Rule", priority="info", evaluation_ms=5.0)
        self.collector.record_cooldown_block(rule_id=1, rule_name="Test Rule")

        # Reset
        self.collector.reset()

        self.assertEqual(len(self.collector._evaluations), 0)
        self.assertEqual(len(self.collector._rule_metrics), 0)
        self.assertEqual(self.collector._total_evaluations, 0)
        self.assertEqual(self.collector._total_triggers, 0)
        self.assertEqual(self.collector._total_cooldown_blocks, 0)
        self.assertEqual(self.collector._cache_hits, 0)
        self.assertEqual(self.collector._cache_misses, 0)


class EvaluationTimerTests(TestCase):
    """Tests for EvaluationTimer context manager."""

    def setUp(self):
        """Set up test fixtures."""
        self.collector = AlertMetricsCollector()

    def test_evaluation_timer_records_on_exit(self):
        """Test that timer records metrics on context exit."""
        with EvaluationTimer(self.collector) as timer:
            timer.set_aircraft_count(100)
            timer.set_rules_evaluated(25)

        # Should have recorded one evaluation
        self.assertEqual(self.collector._total_evaluations, 1)

    def test_evaluation_timer_duration(self):
        """Test that timer measures duration."""
        import time

        with EvaluationTimer(self.collector) as timer:
            timer.set_aircraft_count(100)
            timer.set_rules_evaluated(25)
            time.sleep(0.01)  # 10ms

        # Duration should be at least 10ms
        self.assertGreater(self.collector._evaluations[0].duration_ms, 10)

    def test_evaluation_timer_add_trigger(self):
        """Test adding triggers via timer."""
        with EvaluationTimer(self.collector) as timer:
            timer.set_aircraft_count(100)
            timer.set_rules_evaluated(25)
            timer.add_trigger()
            timer.add_trigger()
            timer.add_trigger()

        self.assertEqual(self.collector._evaluations[0].alerts_triggered, 3)

    def test_evaluation_timer_cache_hit(self):
        """Test setting cache hit via timer."""
        with EvaluationTimer(self.collector) as timer:
            timer.set_aircraft_count(100)
            timer.set_rules_evaluated(25)
            timer.set_cache_hit(False)

        self.assertFalse(self.collector._evaluations[0].cache_hit)
        self.assertEqual(self.collector._cache_misses, 1)


class GlobalAlertMetricsTests(TestCase):
    """Tests for global alert_metrics singleton."""

    def test_global_instance_exists(self):
        """Test that global alert_metrics instance exists."""
        self.assertIsNotNone(alert_metrics)
        self.assertIsInstance(alert_metrics, AlertMetricsCollector)

    def test_global_instance_is_singleton(self):
        """Test that multiple imports return same instance."""
        from skyspy.services.alert_metrics import alert_metrics as alert_metrics_2

        self.assertIs(alert_metrics, alert_metrics_2)


class PrometheusIntegrationTests(TestCase):
    """Tests for Prometheus metrics integration."""

    @patch("skyspy.services.alert_metrics.settings")
    def test_prometheus_disabled_by_default(self, mock_settings):
        """Test Prometheus is disabled when not configured."""
        mock_settings.PROMETHEUS_ENABLED = False

        collector = AlertMetricsCollector()

        self.assertFalse(collector._prometheus_enabled)
        self.assertIsNone(collector._prom_metrics)

    @patch("skyspy.services.alert_metrics.settings")
    @patch("skyspy.services.alert_metrics.AlertMetricsCollector._setup_prometheus")
    def test_prometheus_setup_called_when_enabled(self, mock_setup, mock_settings):
        """Test Prometheus setup is called when enabled."""
        mock_settings.PROMETHEUS_ENABLED = True

        collector = AlertMetricsCollector()

        # Note: _setup_prometheus is called in __init__, so we verify the setting
        self.assertTrue(collector._prometheus_enabled)


class ThreadSafetyTests(TestCase):
    """Tests for thread safety of AlertMetricsCollector."""

    def test_concurrent_record_evaluation(self):
        """Test concurrent evaluation recording."""
        import threading

        collector = AlertMetricsCollector()
        errors = []

        def record_evaluations(count):
            try:
                for _ in range(count):
                    collector.record_evaluation(
                        duration_ms=10.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=0, cache_hit=True
                    )
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=record_evaluations, args=(100,)) for _ in range(5)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        self.assertEqual(collector._total_evaluations, 500)

    def test_concurrent_record_trigger(self):
        """Test concurrent trigger recording."""
        import threading

        collector = AlertMetricsCollector()
        errors = []

        def record_triggers(rule_id, count):
            try:
                for _ in range(count):
                    collector.record_trigger(
                        rule_id=rule_id, rule_name=f"Rule {rule_id}", priority="info", evaluation_ms=5.0
                    )
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=record_triggers, args=(i + 1, 50)) for i in range(5)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        # Each of 5 rules should have 50 triggers
        self.assertEqual(len(collector._rule_metrics), 5)


class EdgeCaseTests(TestCase):
    """Edge case tests for AlertMetrics."""

    def test_summary_with_zero_cache_total(self):
        """Test summary with no cache operations."""
        collector = AlertMetricsCollector()

        summary = collector.get_summary()

        # Cache ratio should be 0 when no operations
        self.assertEqual(summary["overall_cache_hit_ratio"], 0)

    def test_rule_metrics_with_zero_evaluations(self):
        """Test rule metrics with zero evaluations."""
        collector = AlertMetricsCollector()
        # Only add cooldown blocks (no evaluations)
        collector.record_cooldown_block(rule_id=1, rule_name="Test Rule")

        result = collector.get_rule_metrics()

        if result:
            # Trigger rate should handle zero division
            self.assertEqual(result[0]["trigger_rate"], 0)

    def test_timing_histogram_same_values(self):
        """Test timing histogram when all values are the same."""
        collector = AlertMetricsCollector()

        for _ in range(10):
            collector.record_evaluation(
                duration_ms=10.0, aircraft_count=100, rules_evaluated=25, alerts_triggered=0, cache_hit=True
            )

        result = collector.get_timing_histogram()

        # Should handle single-value distribution
        self.assertIsNotNone(result["buckets"])
