"""
API load tests for SkySpy.

Tests concurrent API requests, response time percentiles,
and performance under load conditions.

Run with: pytest -m performance skyspy/tests/performance/test_api_load.py
"""

import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from skyspy.tests.performance.conftest import (
    LoadGenerator,
    PerformanceMetrics,
    generate_aircraft_data,
    timed_operation,
)


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestAircraftAPILoad:
    """Load tests for aircraft API endpoints."""

    # =========================================================================
    # Concurrent Request Tests
    # =========================================================================

    def test_aircraft_list_10_concurrent(self, large_aircraft_cache, load_generator, thresholds):
        """
        Test aircraft list endpoint with 10 concurrent requests.

        Baseline: Should handle 10 concurrent requests with p95 < 100ms
        """
        client = APIClient()

        def make_request():
            response = client.get("/api/v1/aircraft/")
            assert response.status_code == status.HTTP_200_OK
            return response.json()

        metrics = load_generator.run_concurrent(make_request, num_requests=10, operation_name="aircraft_list_10")

        print(f"\n{metrics}")
        assert metrics.success_rate == 100, f"Expected 100% success, got {metrics.success_rate}%"
        assert metrics.p95 < thresholds["api_aircraft_list_p95"], f"p95 {metrics.p95}ms > {thresholds['api_aircraft_list_p95']}ms threshold"

    def test_aircraft_list_50_concurrent(self, large_aircraft_cache, load_generator, thresholds):
        """
        Test aircraft list endpoint with 50 concurrent requests.

        Baseline: Should handle 50 concurrent requests with p95 < 150ms
        """
        client = APIClient()

        def make_request():
            response = client.get("/api/v1/aircraft/")
            assert response.status_code == status.HTTP_200_OK
            return response.json()

        metrics = load_generator.run_concurrent(make_request, num_requests=50, operation_name="aircraft_list_50")

        print(f"\n{metrics}")
        assert metrics.success_rate >= 99, f"Expected >= 99% success, got {metrics.success_rate}%"
        # Allow higher threshold for 50 concurrent
        assert metrics.p95 < thresholds["api_aircraft_list_p95"] * 1.5

    def test_aircraft_list_100_concurrent(self, large_aircraft_cache, thresholds):
        """
        Test aircraft list endpoint with 100 concurrent requests.

        Baseline: Should handle 100 concurrent requests with p95 < 200ms
        This tests the upper limit of concurrent handling.
        """
        generator = LoadGenerator(max_workers=50)  # Higher worker count
        client = APIClient()

        def make_request():
            response = client.get("/api/v1/aircraft/")
            return response.status_code == status.HTTP_200_OK

        metrics = generator.run_concurrent(make_request, num_requests=100, operation_name="aircraft_list_100")

        print(f"\n{metrics}")
        assert metrics.success_rate >= 98, f"Expected >= 98% success, got {metrics.success_rate}%"
        assert metrics.p99 < thresholds["api_aircraft_list_p99"] * 2

    # =========================================================================
    # Large Dataset Tests
    # =========================================================================

    def test_aircraft_list_500_entries(self, large_aircraft_cache, thresholds):
        """
        Test aircraft list with 500+ entries in cache.

        Baseline: Should return 500 aircraft with p95 < 100ms
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_list_500")

        for _ in range(20):  # Run 20 times for stable metrics
            with timed_operation() as timer:
                response = client.get("/api/v1/aircraft/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None if response.status_code == status.HTTP_200_OK else f"Status {response.status_code}",
                })()
            )

            data = response.json()
            assert data["count"] == 500, f"Expected 500 aircraft, got {data['count']}"

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_list_p95"]

    def test_aircraft_list_1500_entries(self, very_large_aircraft_cache, thresholds):
        """
        Test aircraft list with 1500 entries in cache.

        Baseline: Should handle very large datasets with p95 < 200ms
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_list_1500")

        for _ in range(10):
            with timed_operation() as timer:
                response = client.get("/api/v1/aircraft/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

            data = response.json()
            assert data["count"] == 1500

        metrics.finalize()
        print(f"\n{metrics}")
        # Allow 2x threshold for very large dataset
        assert metrics.p95 < thresholds["api_aircraft_list_p95"] * 2

    # =========================================================================
    # Filter Performance Tests
    # =========================================================================

    def test_aircraft_list_with_filters(self, large_aircraft_cache, thresholds):
        """
        Test aircraft list with various filter parameters.

        Baseline: Filtered queries should be fast since filtering happens in memory
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_list_filtered")

        filter_params = [
            "?military=true",
            "?min_alt=30000",
            "?max_distance=50",
            "?category=A3",
            "?military=true&min_alt=20000",
        ]

        for param in filter_params:
            for _ in range(5):
                with timed_operation() as timer:
                    response = client.get(f"/api/v1/aircraft/{param}")

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": response.status_code == status.HTTP_200_OK,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_list_p95"]

    # =========================================================================
    # Detail Endpoint Tests
    # =========================================================================

    def test_aircraft_detail_performance(self, large_aircraft_cache, thresholds):
        """
        Test aircraft detail endpoint performance.

        Baseline: Single aircraft lookup should be fast (p95 < 50ms)
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_detail")

        # Get some aircraft hex codes to look up
        aircraft = large_aircraft_cache[:50]

        for ac in aircraft:
            hex_code = ac["hex"]
            with timed_operation() as timer:
                response = client.get(f"/api/v1/aircraft/{hex_code}/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_detail_p95"]

    def test_aircraft_detail_concurrent(self, large_aircraft_cache, load_generator, thresholds):
        """
        Test aircraft detail endpoint with concurrent requests.

        Baseline: Should handle 50 concurrent detail lookups
        """
        client = APIClient()
        aircraft = large_aircraft_cache[:50]

        def make_request():
            ac = random.choice(aircraft)
            response = client.get(f"/api/v1/aircraft/{ac['hex']}/")
            return response.status_code == status.HTTP_200_OK

        metrics = load_generator.run_concurrent(make_request, num_requests=50, operation_name="aircraft_detail_concurrent")

        print(f"\n{metrics}")
        assert metrics.success_rate == 100

    # =========================================================================
    # Top Aircraft Endpoint Tests
    # =========================================================================

    def test_aircraft_top_performance(self, large_aircraft_cache, thresholds):
        """
        Test aircraft top endpoint performance.

        Baseline: Top aircraft calculation should be fast (p95 < 100ms)
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_top")

        for _ in range(20):
            with timed_operation() as timer:
                response = client.get("/api/v1/aircraft/top/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_list_p95"]

    def test_aircraft_top_with_limit(self, large_aircraft_cache, thresholds):
        """
        Test aircraft top endpoint with various limits.

        Baseline: Different limits should not significantly affect performance
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_top_limits")

        limits = [5, 10, 20, 50]

        for limit in limits:
            for _ in range(5):
                with timed_operation() as timer:
                    response = client.get(f"/api/v1/aircraft/top/?limit={limit}")

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": response.status_code == status.HTTP_200_OK,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_list_p95"]

    # =========================================================================
    # Stats Endpoint Tests
    # =========================================================================

    def test_aircraft_stats_performance(self, large_aircraft_cache, thresholds):
        """
        Test aircraft stats endpoint performance.

        Baseline: Stats aggregation should be fast (p95 < 150ms)
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="aircraft_stats")

        for _ in range(20):
            with timed_operation() as timer:
                response = client.get("/api/v1/aircraft/stats/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_aircraft_stats_p95"]

    def test_aircraft_stats_concurrent(self, large_aircraft_cache, load_generator, thresholds):
        """
        Test aircraft stats endpoint with concurrent requests.

        Baseline: Should handle 30 concurrent stats requests
        """
        client = APIClient()

        def make_request():
            response = client.get("/api/v1/aircraft/stats/")
            return response.status_code == status.HTTP_200_OK

        metrics = load_generator.run_concurrent(make_request, num_requests=30, operation_name="aircraft_stats_concurrent")

        print(f"\n{metrics}")
        assert metrics.success_rate == 100

    # =========================================================================
    # Pagination Performance Tests
    # =========================================================================

    def test_pagination_performance(self, very_large_aircraft_cache, thresholds):
        """
        Test pagination performance with large dataset.

        Baseline: Different pages should have similar response times
        """
        client = APIClient()
        page_metrics = {}

        # Test different page sizes and offsets
        page_configs = [
            (0, 100),   # First 100
            (0, 500),   # First 500
            (500, 100), # 100 starting at 500
            (1000, 100), # 100 starting at 1000
        ]

        for offset, limit in page_configs:
            metrics = PerformanceMetrics(operation_name=f"pagination_{offset}_{limit}")

            for _ in range(10):
                with timed_operation() as timer:
                    response = client.get(f"/api/v1/aircraft/?offset={offset}&limit={limit}")

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": response.status_code == status.HTTP_200_OK,
                        "error": None,
                    })()
                )

            metrics.finalize()
            page_metrics[f"{offset}_{limit}"] = metrics
            print(f"\n{metrics}")

        # Verify all pagination queries are reasonably fast
        for key, metrics in page_metrics.items():
            assert metrics.p95 < thresholds["api_aircraft_list_p95"] * 2, f"Pagination {key} too slow: p95={metrics.p95}ms"


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestAlertAPILoad:
    """Load tests for alert API endpoints."""

    def test_alert_rules_list_performance(self, bulk_alert_rules, thresholds):
        """
        Test alert rules list endpoint performance.

        Baseline: Should list 100+ rules with p95 < 100ms
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="alert_rules_list")

        for _ in range(20):
            with timed_operation() as timer:
                response = client.get("/api/v1/alerts/rules/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_alerts_list_p95"]

    def test_alert_history_performance(self, bulk_alert_history, thresholds):
        """
        Test alert history endpoint performance with 500+ records.

        Baseline: Should list history with p95 < 100ms
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="alert_history")

        for _ in range(20):
            with timed_operation() as timer:
                response = client.get("/api/v1/alerts/history/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_alerts_list_p95"]

    def test_alert_history_filtered(self, bulk_alert_history, thresholds):
        """
        Test alert history with filters.

        Baseline: Filtered queries should be fast
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="alert_history_filtered")

        filter_params = [
            "?priority=critical",
            "?limit=50",
            "?priority=warning&limit=100",
        ]

        for param in filter_params:
            for _ in range(5):
                with timed_operation() as timer:
                    response = client.get(f"/api/v1/alerts/history/{param}")

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": response.status_code == status.HTTP_200_OK,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_alerts_list_p95"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestSafetyAPILoad:
    """Load tests for safety API endpoints."""

    def test_safety_events_list_performance(self, bulk_safety_events, thresholds):
        """
        Test safety events list endpoint performance.

        Baseline: Should list 200+ events with p95 < 100ms
        """
        client = APIClient()
        metrics = PerformanceMetrics(operation_name="safety_events_list")

        for _ in range(20):
            with timed_operation() as timer:
                response = client.get("/api/v1/safety/events/")

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": response.status_code == status.HTTP_200_OK,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["api_safety_list_p95"]

    def test_safety_events_concurrent(self, bulk_safety_events, load_generator, thresholds):
        """
        Test safety events with concurrent requests.

        Baseline: Should handle 30 concurrent requests
        """
        client = APIClient()

        def make_request():
            response = client.get("/api/v1/safety/events/")
            return response.status_code == status.HTTP_200_OK

        metrics = load_generator.run_concurrent(make_request, num_requests=30, operation_name="safety_events_concurrent")

        print(f"\n{metrics}")
        assert metrics.success_rate == 100


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestMixedWorkload:
    """
    Tests simulating real-world mixed API workloads.

    In production, the API will receive a mix of different requests
    simultaneously. These tests verify the system handles this well.
    """

    def test_mixed_workload_simulation(self, large_aircraft_cache, bulk_alert_rules, bulk_safety_events, thresholds):
        """
        Simulate mixed workload with different endpoint types.

        Baseline: Mixed workload should maintain acceptable response times
        """
        client = APIClient()
        aircraft = large_aircraft_cache[:20]

        # Define workload mix (weighted by frequency)
        endpoints = [
            ("/api/v1/aircraft/", 40),        # 40% - Most common
            ("/api/v1/aircraft/stats/", 20),  # 20%
            ("/api/v1/aircraft/top/", 15),    # 15%
            ("/api/v1/alerts/rules/", 10),    # 10%
            ("/api/v1/safety/events/", 10),   # 10%
            (f"/api/v1/aircraft/{aircraft[0]['hex']}/", 5),  # 5% - Detail
        ]

        # Build weighted endpoint list
        weighted_endpoints = []
        for endpoint, weight in endpoints:
            weighted_endpoints.extend([endpoint] * weight)

        generator = LoadGenerator(max_workers=20)

        def make_request():
            endpoint = random.choice(weighted_endpoints)
            response = client.get(endpoint)
            return response.status_code == status.HTTP_200_OK

        metrics = generator.run_concurrent(make_request, num_requests=100, operation_name="mixed_workload")

        print(f"\n{metrics}")
        assert metrics.success_rate >= 99
        assert metrics.p95 < 200  # Allow 200ms for mixed workload

    def test_sustained_load(self, large_aircraft_cache, thresholds):
        """
        Test sustained load over time.

        Baseline: System should maintain performance over 5 seconds at 10 req/s
        """
        client = APIClient()
        generator = LoadGenerator(max_workers=10)

        def make_request():
            response = client.get("/api/v1/aircraft/")
            return response.status_code == status.HTTP_200_OK

        metrics = generator.run_sustained(
            make_request,
            duration_seconds=5,
            target_rps=10,
            operation_name="sustained_load",
        )

        print(f"\n{metrics}")
        print(f"Achieved: {metrics.requests_per_second:.1f} req/s")
        assert metrics.success_rate >= 99
        assert metrics.p95 < thresholds["api_aircraft_list_p95"] * 2
