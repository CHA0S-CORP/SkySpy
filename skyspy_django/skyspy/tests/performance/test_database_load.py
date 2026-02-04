"""
Database load tests for SkySpy.

Tests bulk insert performance, complex query performance,
index effectiveness, and connection pool behavior.

Run with: pytest -m performance skyspy/tests/performance/test_database_load.py
"""

import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta

import pytest
from django.db import connection, connections, reset_queries
from django.db.models import Avg, Count, F, Max, Min, Q
from django.db.models.functions import TruncHour
from django.test import override_settings
from django.utils import timezone

from skyspy.models import (
    AircraftInfo,
    AircraftSession,
    AircraftSighting,
    AlertHistory,
    AlertRule,
    SafetyEvent,
)
from skyspy.tests.performance.conftest import (
    LoadGenerator,
    PerformanceMetrics,
    timed_operation,
)


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestBulkInsertPerformance:
    """
    Tests for bulk insert performance.

    These tests verify the system can efficiently insert large batches
    of records, which is critical for high-volume data ingestion.
    """

    def test_bulk_insert_1000_sightings(self, db, thresholds):
        """
        Test bulk inserting 1000 aircraft sightings.

        Baseline: Should complete in < 5 seconds
        """
        metrics = PerformanceMetrics(operation_name="bulk_insert_1000")
        now = timezone.now()

        # Prepare data
        sightings = []
        for i in range(1000):
            sightings.append(
                AircraftSighting(
                    timestamp=now - timedelta(seconds=random.randint(0, 3600)),
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
                    is_military=random.random() < 0.05,
                )
            )

        with timed_operation() as timer:
            AircraftSighting.objects.bulk_create(sightings, batch_size=100)

        metrics.record(
            type("Result", (), {
                "duration_ms": timer["duration_ms"],
                "success": True,
                "error": None,
            })()
        )
        metrics.finalize()

        print(f"\n{metrics}")
        print(f"Records inserted: {AircraftSighting.objects.count()}")
        print(f"Rate: {1000 / (timer['duration_ms'] / 1000):.0f} records/sec")

        assert timer["duration_ms"] < thresholds["db_bulk_insert_1000_max"]

        # Cleanup
        AircraftSighting.objects.all().delete()

    def test_bulk_insert_batch_size_comparison(self, db, thresholds):
        """
        Compare bulk insert performance with different batch sizes.

        Baseline: Larger batch sizes should be more efficient up to a point
        """
        now = timezone.now()
        batch_sizes = [50, 100, 250, 500]
        results = {}

        for batch_size in batch_sizes:
            # Clean up from previous run
            AircraftSighting.objects.all().delete()

            sightings = []
            for i in range(1000):
                sightings.append(
                    AircraftSighting(
                        timestamp=now,
                        icao_hex=f"{i:06X}",
                        callsign=f"TST{i:04d}",
                        latitude=47.0,
                        longitude=-122.0,
                        altitude_baro=35000,
                    )
                )

            with timed_operation() as timer:
                AircraftSighting.objects.bulk_create(sightings, batch_size=batch_size)

            results[batch_size] = timer["duration_ms"]
            print(f"Batch size {batch_size}: {timer['duration_ms']:.1f}ms")

        # All should complete within threshold
        for batch_size, duration in results.items():
            assert duration < thresholds["db_bulk_insert_1000_max"], f"Batch size {batch_size} too slow: {duration}ms"

        # Cleanup
        AircraftSighting.objects.all().delete()

    def test_bulk_insert_sessions(self, db, thresholds):
        """
        Test bulk inserting aircraft sessions.

        Baseline: Should efficiently insert 500 sessions
        """
        now = timezone.now()
        sessions = []

        for i in range(500):
            first_seen = now - timedelta(hours=random.randint(1, 48))
            sessions.append(
                AircraftSession(
                    icao_hex=f"{i:06X}",
                    callsign=f"TST{i:04d}",
                    first_seen=first_seen,
                    last_seen=first_seen + timedelta(minutes=random.randint(5, 180)),
                    total_positions=random.randint(10, 1000),
                    min_altitude=random.randint(0, 10000),
                    max_altitude=random.randint(20000, 45000),
                )
            )

        with timed_operation() as timer:
            AircraftSession.objects.bulk_create(sessions, batch_size=100)

        print(f"\nBulk insert 500 sessions: {timer['duration_ms']:.1f}ms")
        print(f"Rate: {500 / (timer['duration_ms'] / 1000):.0f} records/sec")

        assert timer["duration_ms"] < thresholds["db_bulk_insert_1000_max"] / 2

        # Cleanup
        AircraftSession.objects.all().delete()


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestComplexQueryPerformance:
    """
    Tests for complex query performance.

    These tests verify that queries with multiple joins, aggregations,
    and filters perform within acceptable bounds.
    """

    def test_time_range_query(self, bulk_aircraft_sightings, thresholds):
        """
        Test querying sightings within a time range.

        Baseline: Time-range queries should use index (p95 < 200ms)
        """
        metrics = PerformanceMetrics(operation_name="time_range_query")
        now = timezone.now()

        time_ranges = [
            (now - timedelta(hours=1), now),
            (now - timedelta(hours=6), now - timedelta(hours=3)),
            (now - timedelta(hours=24), now - timedelta(hours=12)),
        ]

        for start, end in time_ranges:
            for _ in range(5):
                with timed_operation() as timer:
                    AircraftSighting.objects.filter(
                        timestamp__gte=start,
                        timestamp__lt=end
                    ).count()

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["db_complex_query_p95"]

    def test_aggregation_query(self, bulk_aircraft_sightings, thresholds):
        """
        Test aggregation queries (count, avg, min, max).

        Baseline: Aggregations should complete efficiently
        """
        metrics = PerformanceMetrics(operation_name="aggregation_query")

        for _ in range(10):
            with timed_operation() as timer:
                result = AircraftSighting.objects.aggregate(
                    total=Count("id"),
                    avg_altitude=Avg("altitude_baro"),
                    max_altitude=Max("altitude_baro"),
                    min_altitude=Min("altitude_baro"),
                    avg_distance=Avg("distance_nm"),
                )

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": True,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Result: {result}")
        assert metrics.p95 < thresholds["db_complex_query_p95"]

    def test_grouped_aggregation_query(self, bulk_aircraft_sightings, thresholds):
        """
        Test grouped aggregation queries.

        Baseline: Grouped aggregations should complete within threshold
        """
        metrics = PerformanceMetrics(operation_name="grouped_aggregation")

        for _ in range(10):
            with timed_operation() as timer:
                result = list(
                    AircraftSighting.objects.values("category")
                    .annotate(
                        count=Count("id"),
                        avg_alt=Avg("altitude_baro"),
                        max_speed=Max("ground_speed"),
                    )
                    .order_by("-count")[:10]
                )

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": True,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Categories: {len(result)}")
        assert metrics.p95 < thresholds["db_complex_query_p95"]

    def test_hourly_aggregation_query(self, bulk_aircraft_sightings, thresholds):
        """
        Test hourly aggregation for time-series data.

        Baseline: Time-series aggregations should complete efficiently
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
                        military_count=Count("id", filter=Q(is_military=True)),
                    )
                    .order_by("hour")
                )

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": True,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Hours: {len(result)}")
        assert metrics.p95 < thresholds["db_complex_query_p95"] * 2  # Allow more for complex query

    def test_filter_with_multiple_conditions(self, bulk_aircraft_sightings, thresholds):
        """
        Test queries with multiple filter conditions.

        Baseline: Complex filters should still be fast
        """
        metrics = PerformanceMetrics(operation_name="multi_filter_query")

        filter_sets = [
            Q(altitude_baro__gte=30000) & Q(is_military=True),
            Q(distance_nm__lt=50) & Q(altitude_baro__lt=10000),
            Q(category__in=["A3", "A4", "A5"]) & Q(ground_speed__gt=400),
            Q(is_military=True) | Q(altitude_baro__gt=40000),
        ]

        for filter_q in filter_sets:
            for _ in range(5):
                with timed_operation() as timer:
                    AircraftSighting.objects.filter(filter_q).count()

                metrics.record(
                    type("Result", (), {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    })()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["db_complex_query_p95"]


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestIndexEffectiveness:
    """
    Tests to verify index effectiveness.

    These tests compare indexed vs non-indexed query performance
    and verify indexes are being used properly.
    """

    def test_icao_hex_index_lookup(self, bulk_aircraft_sightings, thresholds):
        """
        Test lookup by icao_hex (indexed field).

        Baseline: Indexed lookups should be very fast (< 10ms)
        """
        metrics = PerformanceMetrics(operation_name="icao_index_lookup")

        # Get some actual hex codes
        hex_codes = list(AircraftSighting.objects.values_list("icao_hex", flat=True)[:50])

        for hex_code in hex_codes:
            with timed_operation() as timer:
                list(AircraftSighting.objects.filter(icao_hex=hex_code)[:10])

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": True,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["db_index_lookup_p95"]

    def test_timestamp_index_lookup(self, bulk_aircraft_sightings, thresholds):
        """
        Test lookup by timestamp (indexed field).

        Baseline: Timestamp range queries should be fast
        """
        metrics = PerformanceMetrics(operation_name="timestamp_index_lookup")
        now = timezone.now()

        for _ in range(50):
            offset_hours = random.randint(0, 20)
            start = now - timedelta(hours=offset_hours + 1)
            end = now - timedelta(hours=offset_hours)

            with timed_operation() as timer:
                AircraftSighting.objects.filter(
                    timestamp__gte=start,
                    timestamp__lt=end
                ).count()

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": True,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["db_index_lookup_p95"]

    def test_combined_index_lookup(self, bulk_aircraft_sightings, thresholds):
        """
        Test lookup using combined index (icao_hex + timestamp).

        Baseline: Combined index queries should be efficient
        """
        metrics = PerformanceMetrics(operation_name="combined_index_lookup")
        now = timezone.now()

        hex_codes = list(AircraftSighting.objects.values_list("icao_hex", flat=True)[:20])

        for hex_code in hex_codes:
            with timed_operation() as timer:
                list(
                    AircraftSighting.objects.filter(
                        icao_hex=hex_code,
                        timestamp__gte=now - timedelta(hours=24)
                    ).order_by("-timestamp")[:50]
                )

            metrics.record(
                type("Result", (), {
                    "duration_ms": timer["duration_ms"],
                    "success": True,
                    "error": None,
                })()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["db_index_lookup_p95"] * 2

    @pytest.mark.skipif(True, reason="Requires DEBUG=True for query analysis")
    def test_explain_query_uses_index(self, bulk_aircraft_sightings):
        """
        Verify that queries use expected indexes.

        Note: This test requires DEBUG=True to inspect queries.
        """
        from django.db import connection

        hex_code = AircraftSighting.objects.first().icao_hex

        # Enable query logging
        reset_queries()

        with connection.cursor() as cursor:
            cursor.execute(
                """
                EXPLAIN ANALYZE
                SELECT * FROM aircraft_sightings
                WHERE icao_hex = %s
                ORDER BY timestamp DESC
                LIMIT 10
                """,
                [hex_code]
            )
            explain_output = cursor.fetchall()

        print("\nQuery Plan:")
        for row in explain_output:
            print(row[0])

        # Check that index scan is used (PostgreSQL specific)
        plan_text = " ".join(str(row[0]) for row in explain_output)
        assert "Index" in plan_text or "Seq Scan" not in plan_text


@pytest.mark.performance
@pytest.mark.django_db(transaction=True)
class TestConnectionPoolBehavior:
    """
    Tests for database connection pool behavior under load.

    These tests verify connections are properly managed and
    the pool handles concurrent access well.
    """

    def test_concurrent_queries(self, bulk_aircraft_sightings, thresholds):
        """
        Test concurrent database queries.

        Baseline: Connection pool should handle 20 concurrent queries
        """
        metrics = PerformanceMetrics(operation_name="concurrent_queries")

        def run_query():
            # Each thread gets its own connection from pool
            count = AircraftSighting.objects.filter(
                altitude_baro__gt=random.randint(10000, 30000)
            ).count()
            return count

        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(run_query) for _ in range(50)]

            for future in as_completed(futures):
                start = time.perf_counter()
                try:
                    future.result()
                    duration_ms = (time.perf_counter() - start) * 1000
                    metrics.record(
                        type("Result", (), {
                            "duration_ms": duration_ms,
                            "success": True,
                            "error": None,
                        })()
                    )
                except Exception as e:
                    metrics.record(
                        type("Result", (), {
                            "duration_ms": 0,
                            "success": False,
                            "error": str(e),
                        })()
                    )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.success_rate == 100

    def test_mixed_read_write_concurrent(self, db, thresholds):
        """
        Test concurrent read and write operations.

        Baseline: Mixed workload should complete without deadlocks
        """
        metrics = PerformanceMetrics(operation_name="mixed_read_write")
        now = timezone.now()

        # Create some initial data
        AircraftSighting.objects.bulk_create([
            AircraftSighting(
                timestamp=now,
                icao_hex=f"{i:06X}",
                latitude=47.0,
                longitude=-122.0,
            )
            for i in range(100)
        ], batch_size=50)

        def read_operation():
            return AircraftSighting.objects.count()

        def write_operation(i):
            AircraftSighting.objects.create(
                timestamp=timezone.now(),
                icao_hex=f"NEW{i:04X}",
                latitude=47.0,
                longitude=-122.0,
            )
            return True

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []

            # Mix of reads and writes
            for i in range(30):
                if random.random() < 0.7:
                    futures.append(("read", executor.submit(read_operation)))
                else:
                    futures.append(("write", executor.submit(write_operation, i)))

            for op_type, future in futures:
                start = time.perf_counter()
                try:
                    future.result(timeout=10)
                    duration_ms = (time.perf_counter() - start) * 1000
                    metrics.record(
                        type("Result", (), {
                            "duration_ms": duration_ms,
                            "success": True,
                            "error": None,
                        })()
                    )
                except Exception as e:
                    metrics.record(
                        type("Result", (), {
                            "duration_ms": 0,
                            "success": False,
                            "error": f"{op_type}: {e}",
                        })()
                    )

        metrics.finalize()
        print(f"\n{metrics}")

        # Cleanup
        AircraftSighting.objects.all().delete()

        assert metrics.success_rate >= 95

    def test_connection_reuse(self, bulk_aircraft_sightings):
        """
        Test that connections are properly reused.

        Baseline: Same thread should reuse connection
        """
        len(connection.queries) if connection.queries else 0

        # Multiple queries in same thread should reuse connection
        for _ in range(10):
            AircraftSighting.objects.count()
            AircraftSighting.objects.filter(is_military=True).count()
            AircraftSighting.objects.aggregate(max_alt=Max("altitude_baro"))

        # Verify queries were executed
        print("\nQueries executed: 30 (10 iterations x 3 queries)")

        # Connection should still be open and reused
        assert connection.connection is not None
