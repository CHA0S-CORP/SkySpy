"""
Performance test fixtures and utilities.

Provides:
- Timing utilities for measuring operation performance
- Load generation helpers for concurrent request testing
- Metrics collection for aggregating results
- Bulk data generation fixtures
"""

import asyncio
import random
import statistics
import time
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import pytest
from django.core.cache import cache
from django.db import connection
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from skyspy.models import AircraftInfo, AircraftSession, AircraftSighting, AlertHistory, AlertRule, SafetyEvent
from skyspy.tests.factories import (
    AircraftInfoFactory,
    AircraftSessionFactory,
    AircraftSightingFactory,
    AlertHistoryFactory,
    AlertRuleFactory,
    SafetyEventFactory,
)

# =============================================================================
# Pytest Markers
# =============================================================================


def pytest_configure(config):
    """Register custom markers for performance tests."""
    config.addinivalue_line("markers", "performance: mark test as a performance test")
    config.addinivalue_line("markers", "slow: mark test as slow running")
    config.addinivalue_line("markers", "load: mark test as a load test requiring resources")


# =============================================================================
# Timing Utilities
# =============================================================================


@dataclass
class TimingResult:
    """Result of a timed operation."""

    duration_ms: float
    success: bool
    error: str | None = None
    response_data: Any = None


@dataclass
class PerformanceMetrics:
    """Aggregated performance metrics."""

    operation_name: str
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    durations_ms: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    start_time: float = field(default_factory=time.perf_counter)
    end_time: float = 0

    def record(self, result: TimingResult):
        """Record a timing result."""
        self.total_requests += 1
        if result.success:
            self.successful_requests += 1
            self.durations_ms.append(result.duration_ms)
        else:
            self.failed_requests += 1
            if result.error:
                self.errors.append(result.error)

    def finalize(self):
        """Mark end time and finalize metrics."""
        self.end_time = time.perf_counter()

    @property
    def total_duration_s(self) -> float:
        """Total wall clock duration in seconds."""
        return self.end_time - self.start_time

    @property
    def requests_per_second(self) -> float:
        """Calculate throughput."""
        if self.total_duration_s <= 0:
            return 0
        return self.total_requests / self.total_duration_s

    @property
    def success_rate(self) -> float:
        """Calculate success rate as percentage."""
        if self.total_requests == 0:
            return 0
        return (self.successful_requests / self.total_requests) * 100

    @property
    def p50(self) -> float:
        """50th percentile (median) response time in ms."""
        if not self.durations_ms:
            return 0
        return statistics.median(self.durations_ms)

    @property
    def p95(self) -> float:
        """95th percentile response time in ms."""
        if not self.durations_ms:
            return 0
        sorted_durations = sorted(self.durations_ms)
        idx = int(len(sorted_durations) * 0.95)
        return sorted_durations[min(idx, len(sorted_durations) - 1)]

    @property
    def p99(self) -> float:
        """99th percentile response time in ms."""
        if not self.durations_ms:
            return 0
        sorted_durations = sorted(self.durations_ms)
        idx = int(len(sorted_durations) * 0.99)
        return sorted_durations[min(idx, len(sorted_durations) - 1)]

    @property
    def avg(self) -> float:
        """Average response time in ms."""
        if not self.durations_ms:
            return 0
        return statistics.mean(self.durations_ms)

    @property
    def min(self) -> float:
        """Minimum response time in ms."""
        if not self.durations_ms:
            return 0
        return min(self.durations_ms)

    @property
    def max(self) -> float:
        """Maximum response time in ms."""
        if not self.durations_ms:
            return 0
        return max(self.durations_ms)

    @property
    def std_dev(self) -> float:
        """Standard deviation of response times."""
        if len(self.durations_ms) < 2:
            return 0
        return statistics.stdev(self.durations_ms)

    def summary(self) -> dict:
        """Return summary as dictionary."""
        return {
            "operation": self.operation_name,
            "total_requests": self.total_requests,
            "successful": self.successful_requests,
            "failed": self.failed_requests,
            "success_rate_pct": round(self.success_rate, 2),
            "total_duration_s": round(self.total_duration_s, 3),
            "requests_per_second": round(self.requests_per_second, 2),
            "latency_ms": {
                "min": round(self.min, 2),
                "avg": round(self.avg, 2),
                "p50": round(self.p50, 2),
                "p95": round(self.p95, 2),
                "p99": round(self.p99, 2),
                "max": round(self.max, 2),
                "std_dev": round(self.std_dev, 2),
            },
            "errors": self.errors[:10] if self.errors else [],
        }

    def __str__(self) -> str:
        s = self.summary()
        return (
            f"{s['operation']}: {s['total_requests']} requests, "
            f"{s['success_rate_pct']}% success, "
            f"{s['requests_per_second']} req/s, "
            f"p50={s['latency_ms']['p50']}ms, "
            f"p95={s['latency_ms']['p95']}ms, "
            f"p99={s['latency_ms']['p99']}ms"
        )


@contextmanager
def timed_operation():
    """Context manager for timing operations.

    Usage:
        with timed_operation() as timer:
            result = do_something()
        duration_ms = timer['duration_ms']
    """
    start = time.perf_counter()
    result = {"duration_ms": 0, "error": None, "success": True}
    try:
        yield result
    except Exception as e:
        result["error"] = str(e)
        result["success"] = False
        raise
    finally:
        result["duration_ms"] = (time.perf_counter() - start) * 1000


# =============================================================================
# Load Generation Helpers
# =============================================================================


class LoadGenerator:
    """Helper class for generating concurrent load."""

    def __init__(self, max_workers: int = 10):
        self.max_workers = max_workers

    def run_concurrent(
        self,
        operation: Callable[[], Any],
        num_requests: int,
        operation_name: str = "operation",
    ) -> PerformanceMetrics:
        """
        Run operation concurrently with specified number of requests.

        Args:
            operation: Callable to execute
            num_requests: Total number of requests to make
            operation_name: Name for metrics reporting

        Returns:
            PerformanceMetrics with aggregated results
        """
        metrics = PerformanceMetrics(operation_name=operation_name)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = []
            for _ in range(num_requests):
                future = executor.submit(self._execute_timed, operation)
                futures.append(future)

            for future in as_completed(futures):
                result = future.result()
                metrics.record(result)

        metrics.finalize()
        return metrics

    def run_sustained(
        self,
        operation: Callable[[], Any],
        duration_seconds: float,
        target_rps: float,
        operation_name: str = "operation",
    ) -> PerformanceMetrics:
        """
        Run operation at a sustained rate for a duration.

        Args:
            operation: Callable to execute
            duration_seconds: How long to run
            target_rps: Target requests per second
            operation_name: Name for metrics reporting

        Returns:
            PerformanceMetrics with aggregated results
        """
        metrics = PerformanceMetrics(operation_name=operation_name)
        interval = 1.0 / target_rps if target_rps > 0 else 0.1
        end_time = time.perf_counter() + duration_seconds

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = []

            while time.perf_counter() < end_time:
                future = executor.submit(self._execute_timed, operation)
                futures.append(future)
                time.sleep(interval)

            # Wait for remaining futures
            for future in as_completed(futures, timeout=30):
                try:
                    result = future.result()
                    metrics.record(result)
                except Exception as e:
                    metrics.record(TimingResult(duration_ms=0, success=False, error=str(e)))

        metrics.finalize()
        return metrics

    def _execute_timed(self, operation: Callable[[], Any]) -> TimingResult:
        """Execute operation and return timing result."""
        start = time.perf_counter()
        try:
            result = operation()
            duration_ms = (time.perf_counter() - start) * 1000
            return TimingResult(duration_ms=duration_ms, success=True, response_data=result)
        except Exception as e:
            duration_ms = (time.perf_counter() - start) * 1000
            return TimingResult(duration_ms=duration_ms, success=False, error=str(e))


# =============================================================================
# Data Generation Helpers
# =============================================================================


def generate_aircraft_data(count: int, with_position: bool = True) -> list[dict]:
    """
    Generate mock aircraft data for testing.

    Args:
        count: Number of aircraft to generate
        with_position: Whether to include position data

    Returns:
        List of aircraft dictionaries
    """
    aircraft_types = ["B738", "A320", "B77W", "A321", "E75L", "B39M", "C172", "PA28", "C17", "F16"]
    categories = ["A1", "A2", "A3", "A4", "A5", "B1", "B2"]

    aircraft = []
    for i in range(count):
        icao = f"{i:06X}"
        ac = {
            "hex": icao,
            "flight": f"TST{i:04d}",
            "squawk": f"{random.randint(1000, 7777):04d}",
            "t": random.choice(aircraft_types),
            "category": random.choice(categories),
            "military": random.random() < 0.05,
            "rssi": round(random.uniform(-40, -10), 1),
        }

        if with_position:
            ac.update(
                {
                    "lat": round(random.uniform(25, 49), 6),
                    "lon": round(random.uniform(-125, -65), 6),
                    "alt": random.randint(0, 45000),
                    "gs": round(random.uniform(0, 600), 1),
                    "track": round(random.uniform(0, 360), 1),
                    "vr": random.randint(-4000, 4000),
                    "distance_nm": round(random.uniform(0.1, 250), 1),
                }
            )

        # Small chance of emergency
        if random.random() < 0.01:
            ac["squawk"] = random.choice(["7500", "7600", "7700"])

        aircraft.append(ac)

    return aircraft


def generate_alert_conditions() -> dict:
    """Generate random complex alert conditions."""
    condition_types = ["icao", "callsign", "squawk", "altitude", "distance", "type", "military"]

    groups = []
    num_groups = random.randint(1, 3)

    for _ in range(num_groups):
        conditions = []
        num_conditions = random.randint(1, 4)

        for _ in range(num_conditions):
            cond_type = random.choice(condition_types)
            if cond_type in ("altitude", "distance"):
                operator = random.choice(["lt", "gt"])
                value = str(random.randint(1000, 40000))
            elif cond_type == "military":
                operator = "eq"
                value = random.choice(["true", "false"])
            else:
                operator = random.choice(["eq", "contains", "startswith"])
                value = f"TEST{random.randint(1, 100)}"

            conditions.append(
                {
                    "type": cond_type,
                    "operator": operator,
                    "value": value,
                }
            )

        groups.append(
            {
                "logic": random.choice(["AND", "OR"]),
                "conditions": conditions,
            }
        )

    return {
        "logic": random.choice(["AND", "OR"]),
        "groups": groups,
    }


# =============================================================================
# Pytest Fixtures
# =============================================================================


@pytest.fixture
def api_client():
    """Provide Django REST Framework test client."""
    return APIClient()


@pytest.fixture
def django_client():
    """Provide Django test client."""
    return Client()


@pytest.fixture
def load_generator():
    """Provide load generator instance."""
    return LoadGenerator(max_workers=20)


@pytest.fixture
def performance_metrics():
    """Factory for creating performance metrics."""

    def _create(name: str) -> PerformanceMetrics:
        return PerformanceMetrics(operation_name=name)

    return _create


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def large_aircraft_cache():
    """Pre-populate cache with large aircraft dataset."""
    aircraft = generate_aircraft_data(500)
    cache.set("current_aircraft", aircraft)
    cache.set("aircraft_timestamp", time.time())
    cache.set("aircraft_messages", random.randint(100000, 999999))
    return aircraft


@pytest.fixture
def very_large_aircraft_cache():
    """Pre-populate cache with very large aircraft dataset (1000+)."""
    aircraft = generate_aircraft_data(1500)
    cache.set("current_aircraft", aircraft)
    cache.set("aircraft_timestamp", time.time())
    cache.set("aircraft_messages", random.randint(100000, 999999))
    return aircraft


@pytest.fixture
def bulk_aircraft_sightings(db):
    """
    Create large batch of aircraft sightings in database.

    Creates 1000+ sightings spread over 24 hours.
    """
    now = timezone.now()
    sightings = []

    # Use bulk_create for performance
    for i in range(1000):
        sightings.append(
            AircraftSighting(
                timestamp=now - timedelta(hours=random.randint(0, 24)),
                icao_hex=f"{i:06X}",
                callsign=f"TST{i:04d}",
                latitude=round(random.uniform(25, 49), 6),
                longitude=round(random.uniform(-125, -65), 6),
                altitude_baro=random.randint(0, 45000),
                ground_speed=round(random.uniform(0, 600), 1),
                track=round(random.uniform(0, 360), 1),
                vertical_rate=random.randint(-4000, 4000),
                distance_nm=round(random.uniform(0.1, 250), 1),
                rssi=round(random.uniform(-40, -10), 1),
                category=random.choice(["A1", "A2", "A3", "A4", "A5"]),
                aircraft_type=random.choice(["B738", "A320", "B77W"]),
                is_military=random.random() < 0.05,
            )
        )

    AircraftSighting.objects.bulk_create(sightings, batch_size=100)
    return AircraftSighting.objects.all()


@pytest.fixture
def bulk_aircraft_sessions(db):
    """
    Create large batch of aircraft sessions in database.

    Creates 500 sessions.
    """
    now = timezone.now()
    sessions = []

    for i in range(500):
        first_seen = now - timedelta(hours=random.randint(1, 48))
        last_seen = first_seen + timedelta(minutes=random.randint(5, 180))

        sessions.append(
            AircraftSession(
                icao_hex=f"{i:06X}",
                callsign=f"TST{i:04d}",
                first_seen=first_seen,
                last_seen=last_seen,
                total_positions=random.randint(10, 1000),
                min_altitude=random.randint(0, 10000),
                max_altitude=random.randint(20000, 45000),
                min_distance_nm=round(random.uniform(0.1, 10), 1),
                max_distance_nm=round(random.uniform(50, 250), 1),
                is_military=random.random() < 0.05,
                category=random.choice(["A1", "A2", "A3", "A4", "A5"]),
                aircraft_type=random.choice(["B738", "A320", "B77W"]),
            )
        )

    AircraftSession.objects.bulk_create(sessions, batch_size=100)
    return AircraftSession.objects.all()


@pytest.fixture
def bulk_aircraft_info(db):
    """
    Create large batch of aircraft info records.

    Creates 500 records.
    """
    records = []

    for i in range(500):
        records.append(
            AircraftInfo(
                icao_hex=f"{i:06X}",
                registration=f"N{random.randint(10000, 99999)}",
                type_code=random.choice(["B738", "A320", "B77W", "A321", "E75L"]),
                type_name=random.choice(["Boeing 737-800", "Airbus A320", "Boeing 777-300ER"]),
                manufacturer=random.choice(["Boeing", "Airbus", "Embraer"]),
                operator=random.choice(["United Airlines", "Delta Air Lines", "American Airlines"]),
                country="United States",
                is_military=random.random() < 0.05,
            )
        )

    AircraftInfo.objects.bulk_create(records, batch_size=100)
    return AircraftInfo.objects.all()


@pytest.fixture
def bulk_alert_rules(db):
    """
    Create large batch of alert rules for testing.

    Creates 100+ rules with various conditions.
    """
    rules = []
    rule_types = ["icao", "callsign", "squawk", "altitude", "distance", "type", "military"]

    for i in range(100):
        if i % 3 == 0:
            # Complex condition rule
            rules.append(
                AlertRule(
                    name=f"Complex Rule {i}",
                    conditions=generate_alert_conditions(),
                    enabled=True,
                    priority=random.choice(["info", "warning", "critical"]),
                    cooldown_minutes=random.randint(1, 30),
                )
            )
        else:
            # Simple condition rule
            rule_type = random.choice(rule_types)
            if rule_type == "altitude":
                value = str(random.randint(10000, 40000))
                operator = random.choice(["lt", "gt"])
            elif rule_type == "distance":
                value = str(random.randint(5, 50))
                operator = random.choice(["lt", "gt"])
            elif rule_type == "military":
                value = "true"
                operator = "eq"
            else:
                value = f"TEST{i:04d}"
                operator = random.choice(["eq", "startswith", "contains"])

            rules.append(
                AlertRule(
                    name=f"Simple Rule {i}",
                    rule_type=rule_type,
                    operator=operator,
                    value=value,
                    enabled=True,
                    priority=random.choice(["info", "warning", "critical"]),
                    cooldown_minutes=random.randint(1, 30),
                )
            )

    AlertRule.objects.bulk_create(rules, batch_size=50)
    return AlertRule.objects.filter(enabled=True)


@pytest.fixture
def bulk_safety_events(db):
    """
    Create large batch of safety events for testing.

    Creates 200 events spread over 24 hours.
    """
    now = timezone.now()
    events = []
    event_types = ["tcas_ra", "tcas_ta", "extreme_vs", "proximity_conflict", "emergency_squawk", "7700"]

    for i in range(200):
        events.append(
            SafetyEvent(
                timestamp=now - timedelta(hours=random.randint(0, 24)),
                event_type=random.choice(event_types),
                severity=random.choice(["info", "warning", "critical"]),
                icao_hex=f"{i:06X}",
                callsign=f"TST{i:04d}",
                message=f"Test safety event {i}",
                details={"test": True, "event_id": i},
                aircraft_snapshot={
                    "hex": f"{i:06X}",
                    "flight": f"TST{i:04d}",
                    "alt": random.randint(1000, 45000),
                    "lat": round(random.uniform(25, 49), 6),
                    "lon": round(random.uniform(-125, -65), 6),
                },
            )
        )

    SafetyEvent.objects.bulk_create(events, batch_size=50)
    return SafetyEvent.objects.all()


@pytest.fixture
def bulk_alert_history(db, bulk_alert_rules):
    """
    Create large batch of alert history records.

    Creates 500 history entries.
    """
    rules = list(bulk_alert_rules)
    now = timezone.now()
    history = []

    for i in range(500):
        rule = random.choice(rules)
        history.append(
            AlertHistory(
                rule=rule,
                rule_name=rule.name,
                icao_hex=f"{i:06X}",
                callsign=f"TST{i:04d}",
                message=f"Alert triggered for test aircraft {i}",
                priority=rule.priority,
                aircraft_data={
                    "hex": f"{i:06X}",
                    "flight": f"TST{i:04d}",
                    "alt": random.randint(1000, 45000),
                },
                triggered_at=now - timedelta(hours=random.randint(0, 48)),
            )
        )

    AlertHistory.objects.bulk_create(history, batch_size=100)
    return AlertHistory.objects.all()


# =============================================================================
# Performance Thresholds
# =============================================================================

import os

from django.conf import settings

# Check if running in test mode (SQLite, no Redis)
# Test environments are much slower than production, so use relaxed thresholds
_is_test_environment = (
    getattr(settings, "DATABASES", {}).get("default", {}).get("ENGINE", "").endswith("sqlite3")
    or not getattr(settings, "REDIS_URL", None)
    or os.environ.get("CI") == "true"
)

# Production thresholds - strict for optimized environments
_PRODUCTION_THRESHOLDS = {
    # API response times
    "api_aircraft_list_p95": 100,  # 100ms for aircraft list
    "api_aircraft_list_p99": 200,
    "api_aircraft_detail_p95": 50,  # 50ms for single aircraft
    "api_aircraft_stats_p95": 150,  # 150ms for stats
    "api_alerts_list_p95": 100,
    "api_safety_list_p95": 100,
    # Database operations
    "db_bulk_insert_1000_max": 5000,  # 5s max for 1000 inserts
    "db_complex_query_p95": 200,  # 200ms for complex queries
    "db_index_lookup_p95": 10,  # 10ms for indexed lookups
    # Alert evaluation
    "alert_eval_100_rules_p95": 50,  # 50ms for 100 rules
    "alert_eval_per_aircraft": 1,  # 1ms per aircraft
    # Complex condition evaluation thresholds
    "alert_deep_nested_p95": 100,
    "alert_many_groups_p95": 150,
    "alert_regex_p95": 200,
    "alert_distance_p95": 100,
    "alert_geo_altitude_p95": 150,
    "alert_schedule_p95": 50,
    "alert_cooldown_p95": 50,
    "alert_cache_hit_p95": 20,
    "alert_cache_miss_p95": 100,
    # WebSocket
    "ws_connect_p95": 100,  # 100ms connection time
    "ws_message_latency_p95": 50,  # 50ms message delivery
    "ws_broadcast_latency_p95": 100,
    # Stats aggregation
    "stats_aggregation_p95": 500,  # 500ms for aggregations
}

# Test environment thresholds - relaxed for SQLite/no-Redis environments
# These are significantly higher because test environments run on:
# - SQLite (not PostgreSQL)
# - No Redis caching
# - Single-threaded test runner
# - No query optimization
_TEST_THRESHOLDS = {
    # API response times (10x relaxed)
    "api_aircraft_list_p95": 2000,
    "api_aircraft_list_p99": 5000,
    "api_aircraft_detail_p95": 1000,
    "api_aircraft_stats_p95": 3000,
    "api_alerts_list_p95": 2000,
    "api_safety_list_p95": 2000,
    # Database operations (5x relaxed)
    "db_bulk_insert_1000_max": 25000,
    "db_complex_query_p95": 2000,
    "db_index_lookup_p95": 100,
    # Alert evaluation (200x relaxed for SQLite without Redis)
    "alert_eval_100_rules_p95": 15000,
    "alert_eval_per_aircraft": 200,
    # Complex condition evaluation thresholds (50x relaxed for test env)
    "alert_deep_nested_p95": 5000,  # 50x from 100ms
    "alert_many_groups_p95": 7500,  # 50x from 150ms
    "alert_regex_p95": 10000,  # 50x from 200ms
    "alert_distance_p95": 5000,  # 50x from 100ms
    "alert_geo_altitude_p95": 7500,  # 50x from 150ms
    "alert_schedule_p95": 5000,  # 100x from 50ms
    "alert_cooldown_p95": 5000,  # 100x from 50ms
    "alert_cache_hit_p95": 15000,  # Use same as alert_eval_100_rules_p95
    "alert_cache_miss_p95": 20000,  # Higher than cache hit
    # WebSocket (10x relaxed)
    "ws_connect_p95": 1000,
    "ws_message_latency_p95": 500,
    "ws_broadcast_latency_p95": 1000,  # 10x from 100ms
    # Stats aggregation (10x relaxed)
    "stats_aggregation_p95": 10000,
}

# Select appropriate thresholds based on environment
THRESHOLDS = _TEST_THRESHOLDS if _is_test_environment else _PRODUCTION_THRESHOLDS


@pytest.fixture
def thresholds():
    """Provide performance thresholds."""
    return THRESHOLDS
