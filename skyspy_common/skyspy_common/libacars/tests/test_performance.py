"""
Performance tests and benchmarks for libacars binding modules.

These tests measure:
- Cache lookup performance
- Circuit breaker overhead
- Object pool efficiency
- Metrics collection overhead
"""

import statistics
import time
from unittest.mock import MagicMock, patch

import pytest

from skyspy_common.libacars.cache import DecodeCache, LabelFormatCache
from skyspy_common.libacars.circuit_breaker import CircuitBreaker, ErrorCategory
from skyspy_common.libacars.pool import ObjectPool, ThreadLocalPool, BufferPool
from skyspy_common.libacars.metrics import MetricsCollector, TimingContext


def measure_time(func, iterations=1000):
    """Measure execution time for a function over multiple iterations."""
    times = []
    for _ in range(iterations):
        start = time.perf_counter()
        func()
        times.append((time.perf_counter() - start) * 1_000_000)  # microseconds
    return {
        "iterations": iterations,
        "total_us": sum(times),
        "avg_us": statistics.mean(times),
        "min_us": min(times),
        "max_us": max(times),
        "stddev_us": statistics.stdev(times) if len(times) > 1 else 0,
        "p50_us": statistics.median(times),
        "p99_us": sorted(times)[int(len(times) * 0.99)] if len(times) >= 100 else max(times),
    }


class TestCachePerformance:
    """Performance benchmarks for DecodeCache."""

    def test_cache_hit_performance(self):
        """Benchmark cache hit latency."""
        cache = DecodeCache(maxsize=1000, ttl=300.0)

        # Pre-populate cache
        for i in range(100):
            cache.set(f"L{i}", f"Text message {i}", 1, {"decoded": f"result_{i}"})

        # Measure cache hits
        def cache_hit():
            cache.get("L50", "Text message 50", 1)

        results = measure_time(cache_hit, iterations=10000)

        # Cache hits should be fast (< 50 microseconds on average)
        assert results["avg_us"] < 50, f"Cache hit too slow: {results['avg_us']:.2f}us"
        print(f"\nCache hit performance: {results['avg_us']:.2f}us avg, {results['p99_us']:.2f}us p99")

    def test_cache_miss_performance(self):
        """Benchmark cache miss latency."""
        cache = DecodeCache(maxsize=1000, ttl=300.0)
        counter = [0]

        def cache_miss():
            counter[0] += 1
            cache.get(f"Miss{counter[0]}", "Some text", 1)

        results = measure_time(cache_miss, iterations=10000)

        # Cache misses should also be fast
        assert results["avg_us"] < 50, f"Cache miss too slow: {results['avg_us']:.2f}us"
        print(f"\nCache miss performance: {results['avg_us']:.2f}us avg, {results['p99_us']:.2f}us p99")

    def test_cache_set_performance(self):
        """Benchmark cache set latency."""
        cache = DecodeCache(maxsize=10000, ttl=300.0)
        counter = [0]

        def cache_set():
            counter[0] += 1
            cache.set(f"L{counter[0]}", f"Text {counter[0]}", 1, {"data": counter[0]})

        results = measure_time(cache_set, iterations=10000)

        # Set operations should be fast
        assert results["avg_us"] < 100, f"Cache set too slow: {results['avg_us']:.2f}us"
        print(f"\nCache set performance: {results['avg_us']:.2f}us avg, {results['p99_us']:.2f}us p99")

    def test_cache_eviction_performance(self):
        """Benchmark cache performance under eviction pressure."""
        cache = DecodeCache(maxsize=100, ttl=300.0)  # Small cache
        counter = [0]

        def cache_set_with_eviction():
            counter[0] += 1
            cache.set(f"L{counter[0]}", f"Text {counter[0]}", 1, {"data": counter[0]})

        # Fill cache first
        for i in range(100):
            cache.set(f"L{i}", f"Text {i}", 1, {"data": i})

        counter[0] = 1000
        results = measure_time(cache_set_with_eviction, iterations=5000)

        # Eviction should not significantly slow down operations
        assert results["avg_us"] < 150, f"Eviction too slow: {results['avg_us']:.2f}us"
        print(f"\nCache with eviction: {results['avg_us']:.2f}us avg, {results['p99_us']:.2f}us p99")

    def test_label_cache_performance(self):
        """Benchmark LabelFormatCache performance."""
        cache = LabelFormatCache(maxsize=200)

        # Pre-populate
        for i in range(100):
            cache.mark_supported(f"L{i:02d}", "format")

        def check_supported():
            cache.is_supported("L50")

        results = measure_time(check_supported, iterations=10000)

        assert results["avg_us"] < 20, f"Label cache check too slow: {results['avg_us']:.2f}us"
        print(f"\nLabel cache check: {results['avg_us']:.2f}us avg, {results['p99_us']:.2f}us p99")


class TestCircuitBreakerPerformance:
    """Performance benchmarks for CircuitBreaker."""

    def test_can_execute_closed_performance(self):
        """Benchmark can_execute when circuit is closed."""
        breaker = CircuitBreaker(failure_threshold=100)

        results = measure_time(breaker.can_execute, iterations=10000)

        # Should be very fast when closed
        assert results["avg_us"] < 10, f"can_execute too slow: {results['avg_us']:.2f}us"
        print(f"\nCircuit closed can_execute: {results['avg_us']:.2f}us avg")

    def test_record_success_performance(self):
        """Benchmark record_success performance."""
        breaker = CircuitBreaker(failure_threshold=100)

        def record():
            breaker.can_execute()
            breaker.record_success()

        results = measure_time(record, iterations=10000)

        assert results["avg_us"] < 20, f"record_success too slow: {results['avg_us']:.2f}us"
        print(f"\nCircuit record_success: {results['avg_us']:.2f}us avg")

    def test_record_failure_performance(self):
        """Benchmark record_failure performance."""
        breaker = CircuitBreaker(failure_threshold=100000)  # High threshold to stay closed

        error = ValueError("test error")

        def record():
            breaker.can_execute()
            breaker.record_failure(error=error)

        results = measure_time(record, iterations=10000)

        assert results["avg_us"] < 30, f"record_failure too slow: {results['avg_us']:.2f}us"
        print(f"\nCircuit record_failure: {results['avg_us']:.2f}us avg")

    def test_execute_wrapper_overhead(self):
        """Measure overhead of execute() wrapper."""
        breaker = CircuitBreaker(failure_threshold=100)

        def dummy_func():
            return 42

        # Measure with wrapper
        def with_wrapper():
            breaker.execute(dummy_func)

        wrapped_results = measure_time(with_wrapper, iterations=10000)

        # Measure direct call for comparison
        direct_results = measure_time(dummy_func, iterations=10000)

        overhead = wrapped_results["avg_us"] - direct_results["avg_us"]
        print(f"\nCircuit execute overhead: {overhead:.2f}us (direct: {direct_results['avg_us']:.2f}us)")

        # Overhead should be reasonable
        assert overhead < 20, f"Execute wrapper overhead too high: {overhead:.2f}us"


class TestObjectPoolPerformance:
    """Performance benchmarks for ObjectPool."""

    def test_pool_hit_performance(self):
        """Benchmark acquiring from a populated pool."""
        pool = ObjectPool(
            factory=lambda: {},
            max_size=10,
            min_size=10,  # Pre-populate
        )

        def acquire_release():
            obj = pool.acquire()
            pool.release(obj)

        results = measure_time(acquire_release, iterations=10000)

        assert results["avg_us"] < 20, f"Pool acquire/release too slow: {results['avg_us']:.2f}us"
        print(f"\nPool acquire/release (hit): {results['avg_us']:.2f}us avg")

    def test_pool_miss_performance(self):
        """Benchmark acquiring when pool is empty."""
        pool = ObjectPool(
            factory=lambda: {},
            max_size=0,  # No pooling
        )

        def acquire_release():
            obj = pool.acquire()
            pool.release(obj)

        results = measure_time(acquire_release, iterations=10000)

        # Miss creates new object, will be slower
        print(f"\nPool acquire/release (miss): {results['avg_us']:.2f}us avg")

    def test_pool_context_manager_overhead(self):
        """Measure context manager overhead."""
        pool = ObjectPool(
            factory=lambda: {},
            max_size=10,
            min_size=5,
        )

        def with_context():
            with pool.acquire_context() as obj:
                pass

        def manual():
            obj = pool.acquire()
            pool.release(obj)

        context_results = measure_time(with_context, iterations=10000)
        manual_results = measure_time(manual, iterations=10000)

        overhead = context_results["avg_us"] - manual_results["avg_us"]
        print(f"\nContext manager overhead: {overhead:.2f}us")

    def test_thread_local_pool_performance(self):
        """Benchmark ThreadLocalPool."""
        pool = ThreadLocalPool(factory=lambda: {})

        results = measure_time(pool.get, iterations=10000)

        # Thread-local should be very fast after first call
        assert results["avg_us"] < 10, f"ThreadLocalPool too slow: {results['avg_us']:.2f}us"
        print(f"\nThreadLocalPool.get: {results['avg_us']:.2f}us avg")


class TestBufferPoolPerformance:
    """Performance benchmarks for BufferPool."""

    def test_buffer_acquire_release_performance(self):
        """Benchmark buffer pool operations."""
        pool = BufferPool(buffers_per_size=4)

        def acquire_release():
            buf = pool.get_buffer(256)
            pool.release_buffer(buf)

        results = measure_time(acquire_release, iterations=10000)

        assert results["avg_us"] < 50, f"Buffer pool too slow: {results['avg_us']:.2f}us"
        print(f"\nBuffer pool acquire/release: {results['avg_us']:.2f}us avg")

    def test_buffer_size_selection_performance(self):
        """Benchmark buffer size selection."""
        pool = BufferPool()

        sizes = [32, 100, 200, 500, 1000, 2000, 5000]
        for size in sizes:
            def get_buffer(s=size):
                buf = pool.get_buffer(s)
                pool.release_buffer(buf)

            results = measure_time(get_buffer, iterations=1000)
            print(f"\nBuffer size {size}: {results['avg_us']:.2f}us avg")


class TestMetricsPerformance:
    """Performance benchmarks for MetricsCollector."""

    def test_counter_increment_performance(self):
        """Benchmark counter increments."""
        metrics = MetricsCollector()

        def increment():
            metrics.increment("test_counter")

        results = measure_time(increment, iterations=100000)

        assert results["avg_us"] < 5, f"Counter increment too slow: {results['avg_us']:.2f}us"
        print(f"\nCounter increment: {results['avg_us']:.2f}us avg")

    def test_timing_record_performance(self):
        """Benchmark timing recording."""
        metrics = MetricsCollector()

        def record():
            metrics.record_timing("operation", 1.5)

        results = measure_time(record, iterations=100000)

        assert results["avg_us"] < 10, f"Timing record too slow: {results['avg_us']:.2f}us"
        print(f"\nTiming record: {results['avg_us']:.2f}us avg")

    def test_timing_context_overhead(self):
        """Measure timing context manager overhead."""
        metrics = MetricsCollector()

        def noop():
            pass

        def with_timing():
            with metrics.time_operation("test"):
                pass

        noop_results = measure_time(noop, iterations=10000)
        timing_results = measure_time(with_timing, iterations=10000)

        overhead = timing_results["avg_us"] - noop_results["avg_us"]
        print(f"\nTiming context overhead: {overhead:.2f}us")

        # Should be low overhead
        assert overhead < 20, f"Timing context overhead too high: {overhead:.2f}us"

    def test_gauge_set_performance(self):
        """Benchmark gauge updates."""
        metrics = MetricsCollector()
        counter = [0]

        def set_gauge():
            counter[0] += 1
            metrics.set_gauge("test_gauge", float(counter[0]))

        results = measure_time(set_gauge, iterations=100000)

        assert results["avg_us"] < 5, f"Gauge set too slow: {results['avg_us']:.2f}us"
        print(f"\nGauge set: {results['avg_us']:.2f}us avg")

    def test_export_prometheus_performance(self):
        """Benchmark Prometheus export."""
        metrics = MetricsCollector()

        # Add some metrics
        for i in range(10):
            metrics.increment(f"counter_{i}")
            metrics.record_timing(f"timing_{i}", float(i))
            metrics.set_gauge(f"gauge_{i}", float(i))

        results = measure_time(metrics.export_prometheus, iterations=1000)

        # Export is heavier, but should still be reasonable
        print(f"\nPrometheus export: {results['avg_us']:.2f}us avg, {results['p99_us']:.2f}us p99")

    def test_get_all_metrics_performance(self):
        """Benchmark get_all_metrics."""
        metrics = MetricsCollector()

        # Add some metrics
        for i in range(20):
            metrics.increment(f"counter_{i}")
            metrics.record_timing(f"timing_{i}", float(i))
            metrics.set_gauge(f"gauge_{i}", float(i))

        results = measure_time(metrics.get_all_metrics, iterations=1000)

        print(f"\nGet all metrics: {results['avg_us']:.2f}us avg")


class TestIntegratedPerformance:
    """Tests measuring combined component overhead."""

    def test_combined_cache_and_metrics(self):
        """Measure overhead of using cache with metrics."""
        cache = DecodeCache(maxsize=1000, ttl=300.0)
        metrics = MetricsCollector()

        # Pre-populate
        for i in range(100):
            cache.set(f"L{i}", f"Text {i}", 1, {"data": i})

        def cache_only():
            cache.get("L50", "Text 50", 1)

        def cache_with_metrics():
            with metrics.time_operation("cache_lookup"):
                result = cache.get("L50", "Text 50", 1)
            if result:
                metrics.increment("cache_hit")
            else:
                metrics.increment("cache_miss")

        cache_results = measure_time(cache_only, iterations=10000)
        combined_results = measure_time(cache_with_metrics, iterations=10000)

        overhead = combined_results["avg_us"] - cache_results["avg_us"]
        print(f"\nMetrics overhead on cache: {overhead:.2f}us")
        print(f"  Cache only: {cache_results['avg_us']:.2f}us")
        print(f"  With metrics: {combined_results['avg_us']:.2f}us")

    def test_full_decode_path_simulation(self):
        """Simulate full decode path with all components."""
        cache = DecodeCache(maxsize=1000, ttl=300.0)
        breaker = CircuitBreaker(failure_threshold=10)
        metrics = MetricsCollector()

        # Pre-populate cache
        for i in range(100):
            cache.set(f"L{i}", f"Text {i}", 1, {"decoded": i})

        def simulated_decode():
            label, text, direction = "L50", "Text 50", 1

            # Check cache first
            cached = cache.get(label, text, direction)
            if cached:
                metrics.increment("cache_hit")
                return cached

            metrics.increment("cache_miss")

            # Check circuit breaker
            if not breaker.can_execute():
                metrics.increment("circuit_open")
                return None

            # Simulate decode
            with metrics.time_operation("decode"):
                result = {"decoded": "simulated"}

            breaker.record_success()
            cache.set(label, text, direction, result)
            return result

        results = measure_time(simulated_decode, iterations=10000)

        print(f"\nFull decode simulation (cache hit): {results['avg_us']:.2f}us avg")

        # Now test cache miss path
        counter = [0]

        def simulated_decode_miss():
            counter[0] += 1
            label, text, direction = f"Miss{counter[0]}", "Text", 1

            cached = cache.get(label, text, direction)
            if cached:
                metrics.increment("cache_hit")
                return cached

            metrics.increment("cache_miss")

            if not breaker.can_execute():
                metrics.increment("circuit_open")
                return None

            with metrics.time_operation("decode"):
                result = {"decoded": "simulated"}

            breaker.record_success()
            cache.set(label, text, direction, result)
            return result

        miss_results = measure_time(simulated_decode_miss, iterations=10000)

        print(f"Full decode simulation (cache miss): {miss_results['avg_us']:.2f}us avg")


class TestMemoryUsage:
    """Tests for memory efficiency."""

    def test_cache_memory_growth(self):
        """Measure cache memory with increasing entries."""
        import sys

        cache = DecodeCache(maxsize=10000, ttl=300.0)

        sizes = [100, 1000, 5000, 10000]
        for target_size in sizes:
            # Add entries up to target
            for i in range(cache.size, target_size):
                cache.set(f"L{i}", f"Text message number {i}", 1, {"decoded": f"result_{i}"})

            # Estimate memory (rough)
            cache_size = sys.getsizeof(cache._cache)
            print(f"\nCache with {cache.size} entries: ~{cache_size} bytes overhead")

    def test_pool_memory_efficiency(self):
        """Measure pool memory usage."""
        import sys

        pool = ObjectPool(
            factory=lambda: {"data": [0] * 100},  # ~800 bytes per object
            max_size=100,
        )

        # Fill pool
        objects = []
        for _ in range(100):
            objects.append(pool.acquire())

        for obj in objects:
            pool.release(obj)

        pool_overhead = sys.getsizeof(pool._pool)
        print(f"\nPool with {pool.size} objects: ~{pool_overhead} bytes deque overhead")
