"""
Alert performance metrics collection and reporting.

Tracks evaluation duration, trigger rates, cache hit ratios,
and exposes metrics via API and optionally Prometheus.
"""
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from threading import Lock
from typing import Dict, List, Optional

from django.conf import settings

logger = logging.getLogger(__name__)


@dataclass
class EvaluationMetrics:
    """Metrics for a single evaluation cycle."""
    start_time: datetime
    duration_ms: float
    aircraft_count: int
    rules_evaluated: int
    alerts_triggered: int
    cache_hit: bool


@dataclass
class RuleMetrics:
    """Metrics for a specific rule."""
    rule_id: int
    rule_name: str
    evaluation_count: int = 0
    trigger_count: int = 0
    last_triggered: Optional[datetime] = None
    total_evaluation_ms: float = 0.0
    cooldown_blocks: int = 0  # Times alert was blocked by cooldown


class AlertMetricsCollector:
    """
    Collects and reports alert system performance metrics.

    Tracks:
    - Overall evaluation timing
    - Per-rule trigger rates
    - Cache hit ratios
    - Cooldown effectiveness
    """

    def __init__(self, window_minutes: int = 60):
        self._window_minutes = window_minutes
        self._lock = Lock()

        # Recent evaluation metrics (circular buffer)
        self._evaluations: List[EvaluationMetrics] = []
        self._max_evaluations = 1800  # 1 hour at 2-second intervals

        # Per-rule metrics
        self._rule_metrics: Dict[int, RuleMetrics] = {}

        # Aggregate counters
        self._total_evaluations = 0
        self._total_triggers = 0
        self._total_cooldown_blocks = 0
        self._cache_hits = 0
        self._cache_misses = 0

        # Prometheus metrics (optional)
        self._prometheus_enabled = getattr(settings, 'PROMETHEUS_ENABLED', False)
        self._prom_metrics = None
        if self._prometheus_enabled:
            self._setup_prometheus()

    def _setup_prometheus(self):
        """Initialize Prometheus metrics."""
        try:
            from prometheus_client import Counter, Histogram, Gauge

            self._prom_metrics = {
                'evaluations': Counter(
                    'skyspy_alert_evaluations_total',
                    'Total number of alert evaluation cycles'
                ),
                'triggers': Counter(
                    'skyspy_alert_triggers_total',
                    'Total number of alerts triggered',
                    ['rule_id', 'priority']
                ),
                'cooldown_blocks': Counter(
                    'skyspy_alert_cooldown_blocks_total',
                    'Alerts blocked by cooldown'
                ),
                'evaluation_duration': Histogram(
                    'skyspy_alert_evaluation_duration_seconds',
                    'Alert evaluation cycle duration',
                    buckets=[.001, .005, .01, .025, .05, .075, .1, .25, .5, 1.0]
                ),
                'rules_active': Gauge(
                    'skyspy_alert_rules_active',
                    'Number of active alert rules'
                ),
                'cache_hit_ratio': Gauge(
                    'skyspy_alert_cache_hit_ratio',
                    'Alert rule cache hit ratio'
                ),
            }
        except ImportError:
            logger.debug("prometheus_client not available, Prometheus metrics disabled")
            self._prometheus_enabled = False

    def record_evaluation(
        self,
        duration_ms: float,
        aircraft_count: int,
        rules_evaluated: int,
        alerts_triggered: int,
        cache_hit: bool
    ):
        """Record metrics for a complete evaluation cycle."""
        now = datetime.utcnow()

        metrics = EvaluationMetrics(
            start_time=now,
            duration_ms=duration_ms,
            aircraft_count=aircraft_count,
            rules_evaluated=rules_evaluated,
            alerts_triggered=alerts_triggered,
            cache_hit=cache_hit,
        )

        with self._lock:
            self._evaluations.append(metrics)
            if len(self._evaluations) > self._max_evaluations:
                self._evaluations.pop(0)

            self._total_evaluations += 1
            self._total_triggers += alerts_triggered

            if cache_hit:
                self._cache_hits += 1
            else:
                self._cache_misses += 1

        # Update Prometheus
        if self._prom_metrics:
            self._prom_metrics['evaluations'].inc()
            self._prom_metrics['evaluation_duration'].observe(duration_ms / 1000.0)
            self._prom_metrics['rules_active'].set(rules_evaluated)

            # Update cache hit ratio
            total_cache = self._cache_hits + self._cache_misses
            if total_cache > 0:
                ratio = self._cache_hits / total_cache
                self._prom_metrics['cache_hit_ratio'].set(ratio)

    def record_trigger(
        self,
        rule_id: int,
        rule_name: str,
        priority: str,
        evaluation_ms: float
    ):
        """Record a successful alert trigger."""
        now = datetime.utcnow()

        with self._lock:
            if rule_id not in self._rule_metrics:
                self._rule_metrics[rule_id] = RuleMetrics(
                    rule_id=rule_id,
                    rule_name=rule_name,
                )

            rm = self._rule_metrics[rule_id]
            rm.evaluation_count += 1
            rm.trigger_count += 1
            rm.last_triggered = now
            rm.total_evaluation_ms += evaluation_ms

        # Update Prometheus
        if self._prom_metrics:
            self._prom_metrics['triggers'].labels(
                rule_id=str(rule_id),
                priority=priority
            ).inc()

    def record_cooldown_block(self, rule_id: int, rule_name: str):
        """Record when an alert was blocked by cooldown."""
        with self._lock:
            self._total_cooldown_blocks += 1

            if rule_id not in self._rule_metrics:
                self._rule_metrics[rule_id] = RuleMetrics(
                    rule_id=rule_id,
                    rule_name=rule_name,
                )

            self._rule_metrics[rule_id].cooldown_blocks += 1

        if self._prom_metrics:
            self._prom_metrics['cooldown_blocks'].inc()

    def record_rule_evaluation(
        self,
        rule_id: int,
        rule_name: str,
        evaluation_ms: float
    ):
        """Record a rule evaluation (whether it triggered or not)."""
        with self._lock:
            if rule_id not in self._rule_metrics:
                self._rule_metrics[rule_id] = RuleMetrics(
                    rule_id=rule_id,
                    rule_name=rule_name,
                )

            rm = self._rule_metrics[rule_id]
            rm.evaluation_count += 1
            rm.total_evaluation_ms += evaluation_ms

    def get_summary(self) -> dict:
        """Get a summary of current metrics."""
        with self._lock:
            # Calculate window stats
            window_cutoff = datetime.utcnow() - timedelta(minutes=self._window_minutes)
            recent = [e for e in self._evaluations if e.start_time >= window_cutoff]

            if recent:
                avg_duration = sum(e.duration_ms for e in recent) / len(recent)
                avg_aircraft = sum(e.aircraft_count for e in recent) / len(recent)
                avg_rules = sum(e.rules_evaluated for e in recent) / len(recent)
                total_triggers = sum(e.alerts_triggered for e in recent)
                cache_hits = sum(1 for e in recent if e.cache_hit)
                cache_hit_ratio = cache_hits / len(recent) if recent else 0
            else:
                avg_duration = 0
                avg_aircraft = 0
                avg_rules = 0
                total_triggers = 0
                cache_hit_ratio = 0

            # Overall cache ratio
            total_cache = self._cache_hits + self._cache_misses
            overall_cache_ratio = self._cache_hits / total_cache if total_cache > 0 else 0

            return {
                'window_minutes': self._window_minutes,
                'evaluations_in_window': len(recent),
                'average_duration_ms': round(avg_duration, 2),
                'average_aircraft': round(avg_aircraft, 1),
                'average_rules': round(avg_rules, 1),
                'triggers_in_window': total_triggers,
                'cache_hit_ratio_window': round(cache_hit_ratio, 3),
                'total_evaluations': self._total_evaluations,
                'total_triggers': self._total_triggers,
                'total_cooldown_blocks': self._total_cooldown_blocks,
                'overall_cache_hit_ratio': round(overall_cache_ratio, 3),
                'rules_tracked': len(self._rule_metrics),
            }

    def get_rule_metrics(self, limit: int = 20) -> List[dict]:
        """Get metrics for top rules by trigger count."""
        with self._lock:
            sorted_rules = sorted(
                self._rule_metrics.values(),
                key=lambda r: r.trigger_count,
                reverse=True
            )[:limit]

            return [
                {
                    'rule_id': rm.rule_id,
                    'rule_name': rm.rule_name,
                    'evaluation_count': rm.evaluation_count,
                    'trigger_count': rm.trigger_count,
                    'cooldown_blocks': rm.cooldown_blocks,
                    'trigger_rate': round(
                        rm.trigger_count / rm.evaluation_count * 100, 2
                    ) if rm.evaluation_count > 0 else 0,
                    'avg_evaluation_ms': round(
                        rm.total_evaluation_ms / rm.evaluation_count, 3
                    ) if rm.evaluation_count > 0 else 0,
                    'last_triggered': rm.last_triggered.isoformat() if rm.last_triggered else None,
                }
                for rm in sorted_rules
            ]

    def get_timing_histogram(self, buckets: int = 10) -> dict:
        """Get histogram of evaluation times."""
        with self._lock:
            if not self._evaluations:
                return {'buckets': [], 'min': 0, 'max': 0, 'median': 0}

            durations = [e.duration_ms for e in self._evaluations]
            min_d = min(durations)
            max_d = max(durations)
            sorted_d = sorted(durations)
            median = sorted_d[len(sorted_d) // 2]

            # Create buckets
            bucket_size = (max_d - min_d) / buckets if max_d > min_d else 1
            histogram = defaultdict(int)

            for d in durations:
                bucket = int((d - min_d) / bucket_size)
                bucket = min(bucket, buckets - 1)  # Clamp to last bucket
                histogram[bucket] += 1

            return {
                'buckets': [
                    {
                        'range_start': round(min_d + i * bucket_size, 2),
                        'range_end': round(min_d + (i + 1) * bucket_size, 2),
                        'count': histogram[i],
                    }
                    for i in range(buckets)
                ],
                'min_ms': round(min_d, 2),
                'max_ms': round(max_d, 2),
                'median_ms': round(median, 2),
                'sample_count': len(durations),
            }

    def reset(self):
        """Reset all metrics."""
        with self._lock:
            self._evaluations.clear()
            self._rule_metrics.clear()
            self._total_evaluations = 0
            self._total_triggers = 0
            self._total_cooldown_blocks = 0
            self._cache_hits = 0
            self._cache_misses = 0

        logger.info("Alert metrics reset")


class EvaluationTimer:
    """Context manager for timing alert evaluations."""

    def __init__(self, metrics: AlertMetricsCollector):
        self._metrics = metrics
        self._start_time: float = 0
        self._aircraft_count: int = 0
        self._rules_evaluated: int = 0
        self._alerts_triggered: int = 0
        self._cache_hit: bool = True

    def __enter__(self):
        self._start_time = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = (time.perf_counter() - self._start_time) * 1000
        self._metrics.record_evaluation(
            duration_ms=duration_ms,
            aircraft_count=self._aircraft_count,
            rules_evaluated=self._rules_evaluated,
            alerts_triggered=self._alerts_triggered,
            cache_hit=self._cache_hit,
        )
        return False

    def set_aircraft_count(self, count: int):
        self._aircraft_count = count

    def set_rules_evaluated(self, count: int):
        self._rules_evaluated = count

    def add_trigger(self):
        self._alerts_triggered += 1

    def set_cache_hit(self, hit: bool):
        self._cache_hit = hit


# Global singleton instance
alert_metrics = AlertMetricsCollector()
