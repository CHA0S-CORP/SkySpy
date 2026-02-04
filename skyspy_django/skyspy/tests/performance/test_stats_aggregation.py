"""
Statistics aggregation performance tests for SkySpy.

Tests statistics calculation with large datasets,
time-series aggregation, geographic aggregation,
and concurrent stats requests.

Run with: pytest -m performance skyspy/tests/performance/test_stats_aggregation.py
"""

import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db.models import Avg, Count, Max, Min, Q
from django.db.models.functions import TruncHour
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from skyspy.models import (
    AircraftInfo,
    AircraftSession,
    AircraftSighting,
    AlertHistory,
    SafetyEvent,
)
from skyspy.tests.performance.conftest import (
    LoadGenerator,
    PerformanceMetrics,
    generate_aircraft_data,
    timed_operation,
)


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestStatsCalculationPerformance:
    """
    Tests for statistics calculation performance.

    These tests verify stats aggregations complete efficiently
    even with large datasets.
    """

    def test_aircraft_stats_large_dataset(self, large_aircraft_cache, thresholds):
        """
        Test aircraft stats calculation with 500+ aircraft.

        Baseline: Stats calculation should complete in < 150ms
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_stats_large")

        for _ in range(20):
            with timed_operation() as timer:
                response = client.get("/api/v1/aircraft/stats/")

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": response.status_code == status.HTTP_200_OK,
                        "error": None,
                    },
                )()
            )

            data = response.json()
            assert data["total"] == 500

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_stats_p95"]

    def test_sighting_aggregation_performance(self, bulk_aircraft_sightings, thresholds):
        """
        Test database aggregation with 1000+ sightings.

        Baseline: Aggregations should complete in < 500ms
        """
        metrics = PerformanceMetrics(operation_name="sighting_aggregation")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                result = AircraftSighting.objects.filter(timestamp__gte=cutoff).aggregate(
                    total=Count("id"),
                    unique_aircraft=Count("icao_hex", distinct=True),
                    avg_altitude=Avg("altitude_baro"),
                    max_altitude=Max("altitude_baro"),
                    min_altitude=Min("altitude_baro"),
                    avg_distance=Avg("distance_nm"),
                    military_count=Count("id", filter=Q(is_military=True)),
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Result: {result}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_session_stats_performance(self, bulk_aircraft_sessions, thresholds):
        """
        Test session statistics calculation.

        Baseline: Session stats should calculate efficiently
        """
        metrics = PerformanceMetrics(operation_name="session_stats")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                AircraftSession.objects.filter(last_seen__gte=cutoff).aggregate(
                    total_sessions=Count("id"),
                    unique_aircraft=Count("icao_hex", distinct=True),
                    avg_positions=Avg("total_positions"),
                    max_positions=Max("total_positions"),
                    avg_duration=Avg(
                        (timezone.now() - AircraftSession.objects.first().first_seen).total_seconds()
                        if AircraftSession.objects.exists()
                        else 0
                    ),
                    military_sessions=Count("id", filter=Q(is_military=True)),
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestTimeSeriesAggregation:
    """
    Tests for time-series aggregation performance.

    These tests verify hourly/daily aggregations perform well
    with large datasets.
    """

    def test_hourly_aggregation_performance(self, bulk_aircraft_sightings, thresholds):
        """
        Test hourly time-series aggregation.

        Baseline: Hourly aggregation should complete in < 500ms
        """
        metrics = PerformanceMetrics(operation_name="hourly_aggregation")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AircraftSighting.objects.filter(timestamp__gte=cutoff)
                    .annotate(hour=TruncHour("timestamp"))
                    .values("hour")
                    .annotate(
                        count=Count("id"),
                        unique_aircraft=Count("icao_hex", distinct=True),
                        avg_altitude=Avg("altitude_baro"),
                        military_count=Count("id", filter=Q(is_military=True)),
                    )
                    .order_by("hour")
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Hours returned: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_category_time_series(self, bulk_aircraft_sightings, thresholds):
        """
        Test time-series aggregation grouped by category.

        Baseline: Category + time aggregation should be efficient
        """
        metrics = PerformanceMetrics(operation_name="category_time_series")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AircraftSighting.objects.filter(timestamp__gte=cutoff)
                    .annotate(hour=TruncHour("timestamp"))
                    .values("hour", "category")
                    .annotate(
                        count=Count("id"),
                        avg_altitude=Avg("altitude_baro"),
                    )
                    .order_by("hour", "category")
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Data points: {len(result)}")
        # Allow more time for complex grouping
        assert metrics.p95 < thresholds["stats_aggregation_p95"] * 2

    def test_peak_tracking_calculation(self, bulk_aircraft_sightings, thresholds):
        """
        Test peak tracking period calculation.

        Baseline: Finding peak periods should be efficient
        """
        metrics = PerformanceMetrics(operation_name="peak_tracking")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                hourly_data = list(
                    AircraftSighting.objects.filter(timestamp__gte=cutoff)
                    .annotate(hour=TruncHour("timestamp"))
                    .values("hour")
                    .annotate(unique_aircraft=Count("icao_hex", distinct=True))
                    .order_by("-unique_aircraft")[:10]
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Peak periods: {len(hourly_data)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestGeographicAggregation:
    """
    Tests for geographic statistics aggregation.

    These tests verify geographic groupings (by country, operator, etc.)
    perform efficiently.
    """

    def test_operator_aggregation(self, bulk_aircraft_info, thresholds):
        """
        Test aggregation by operator.

        Baseline: Operator grouping should be efficient
        """
        metrics = PerformanceMetrics(operation_name="operator_aggregation")

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AircraftInfo.objects.exclude(operator__isnull=True)
                    .values("operator")
                    .annotate(
                        count=Count("id"),
                        military_count=Count("id", filter=Q(is_military=True)),
                    )
                    .order_by("-count")[:20]
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Operators: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_country_aggregation(self, bulk_aircraft_info, thresholds):
        """
        Test aggregation by country.

        Baseline: Country grouping should be efficient
        """
        metrics = PerformanceMetrics(operation_name="country_aggregation")

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AircraftInfo.objects.exclude(country__isnull=True)
                    .values("country")
                    .annotate(
                        count=Count("id"),
                        military_count=Count("id", filter=Q(is_military=True)),
                    )
                    .order_by("-count")[:30]
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Countries: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_aircraft_type_aggregation(self, bulk_aircraft_sessions, thresholds):
        """
        Test aggregation by aircraft type.

        Baseline: Type grouping should be efficient
        """
        metrics = PerformanceMetrics(operation_name="type_aggregation")

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AircraftSession.objects.exclude(aircraft_type__isnull=True)
                    .values("aircraft_type")
                    .annotate(
                        count=Count("id"),
                        unique_aircraft=Count("icao_hex", distinct=True),
                        avg_positions=Avg("total_positions"),
                    )
                    .order_by("-count")[:25]
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Aircraft types: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestConcurrentStatsRequests:
    """
    Tests for concurrent statistics requests.

    These tests verify the system handles multiple simultaneous
    stats requests efficiently.
    """

    def test_concurrent_stats_api_requests(self, large_aircraft_cache, load_generator, thresholds):
        """
        Test concurrent stats API requests.

        Baseline: Should handle 20 concurrent stats requests
        """
        client = APIClient()

        def make_stats_request():
            response = client.get("/api/v1/aircraft/stats/")
            return response.status_code == status.HTTP_200_OK

        metrics = load_generator.run_concurrent(
            make_stats_request,
            num_requests=20,
            operation_name="concurrent_stats",
        )

        print(f"\n{metrics}")
        assert metrics.success_rate == 100
        assert metrics.p95 < thresholds["api_aircraft_stats_p95"] * 2

    def test_concurrent_different_stats_endpoints(self, large_aircraft_cache, bulk_aircraft_sessions, thresholds):
        """
        Test concurrent requests to different stats endpoints.

        Baseline: Mixed stats endpoints should handle concurrently
        """
        client = APIClient()
        endpoints = [
            "/api/v1/aircraft/stats/",
            "/api/v1/aircraft/top/",
        ]

        generator = LoadGenerator(max_workers=10)

        def make_request():
            endpoint = random.choice(endpoints)
            response = client.get(endpoint)
            return response.status_code == status.HTTP_200_OK

        metrics = generator.run_concurrent(
            make_request,
            num_requests=30,
            operation_name="mixed_stats_endpoints",
        )

        print(f"\n{metrics}")
        assert metrics.success_rate >= 99

    def test_stats_under_sustained_load(self, large_aircraft_cache, thresholds):
        """
        Test stats endpoint under sustained load.

        Baseline: Should maintain performance under 5 seconds at 5 req/s
        """
        client = APIClient()
        generator = LoadGenerator(max_workers=10)

        def make_request():
            response = client.get("/api/v1/aircraft/stats/")
            return response.status_code == status.HTTP_200_OK

        metrics = generator.run_sustained(
            make_request,
            duration_seconds=5,
            target_rps=5,
            operation_name="sustained_stats_load",
        )

        print(f"\n{metrics}")
        print(f"Achieved: {metrics.requests_per_second:.1f} req/s")
        assert metrics.success_rate >= 99


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestSafetyStatsPerformance:
    """
    Tests for safety statistics performance.
    """

    def test_safety_event_aggregation(self, bulk_safety_events, thresholds):
        """
        Test safety event aggregation performance.

        Baseline: Safety stats should calculate efficiently
        """
        metrics = PerformanceMetrics(operation_name="safety_aggregation")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                result = SafetyEvent.objects.filter(timestamp__gte=cutoff).aggregate(
                    total=Count("id"),
                    critical=Count("id", filter=Q(severity="critical")),
                    warning=Count("id", filter=Q(severity="warning")),
                    acknowledged=Count("id", filter=Q(acknowledged=True)),
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Result: {result}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_safety_event_by_type(self, bulk_safety_events, thresholds):
        """
        Test safety event grouping by type.

        Baseline: Type grouping should be efficient
        """
        metrics = PerformanceMetrics(operation_name="safety_by_type")
        now = timezone.now()
        cutoff = now - timedelta(hours=24)

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    SafetyEvent.objects.filter(timestamp__gte=cutoff)
                    .values("event_type")
                    .annotate(
                        count=Count("id"),
                        critical=Count("id", filter=Q(severity="critical")),
                    )
                    .order_by("-count")
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Event types: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestAlertStatsPerformance:
    """
    Tests for alert statistics performance.
    """

    def test_alert_history_aggregation(self, bulk_alert_history, thresholds):
        """
        Test alert history aggregation performance.

        Baseline: Alert stats should calculate efficiently
        """
        metrics = PerformanceMetrics(operation_name="alert_aggregation")
        now = timezone.now()
        cutoff = now - timedelta(hours=48)

        for _ in range(10):
            with timed_operation() as timer:
                result = AlertHistory.objects.filter(triggered_at__gte=cutoff).aggregate(
                    total=Count("id"),
                    critical=Count("id", filter=Q(priority="critical")),
                    warning=Count("id", filter=Q(priority="warning")),
                    unique_aircraft=Count("icao_hex", distinct=True),
                    unique_rules=Count("rule_id", distinct=True),
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Result: {result}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_alert_history_by_rule(self, bulk_alert_history, thresholds):
        """
        Test alert history grouping by rule.

        Baseline: Rule grouping should be efficient
        """
        metrics = PerformanceMetrics(operation_name="alert_by_rule")
        now = timezone.now()
        cutoff = now - timedelta(hours=48)

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AlertHistory.objects.filter(triggered_at__gte=cutoff)
                    .values("rule_name")
                    .annotate(
                        count=Count("id"),
                        unique_aircraft=Count("icao_hex", distinct=True),
                    )
                    .order_by("-count")[:20]
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Rules with alerts: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]

    def test_alert_hourly_trend(self, bulk_alert_history, thresholds):
        """
        Test alert hourly trend calculation.

        Baseline: Hourly alert trends should calculate efficiently
        """
        metrics = PerformanceMetrics(operation_name="alert_hourly_trend")
        now = timezone.now()
        cutoff = now - timedelta(hours=48)

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AlertHistory.objects.filter(triggered_at__gte=cutoff)
                    .annotate(hour=TruncHour("triggered_at"))
                    .values("hour")
                    .annotate(
                        count=Count("id"),
                        critical=Count("id", filter=Q(priority="critical")),
                    )
                    .order_by("hour")
                )

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Hours with alerts: {len(result)}")
        assert metrics.p95 < thresholds["stats_aggregation_p95"]
