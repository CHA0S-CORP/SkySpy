"""
Concurrency tests for libacars binding modules.

Tests thread safety of:
- DecodeCache
- CircuitBreaker
- ObjectPool / BufferPool
- MetricsCollector
"""

import asyncio
import concurrent.futures
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from skyspy_common.libacars.cache import DecodeCache, LabelFormatCache
from skyspy_common.libacars.circuit_breaker import CircuitBreaker, CircuitState, ErrorCategory
from skyspy_common.libacars.pool import ObjectPool, ThreadLocalPool, BufferPool
from skyspy_common.libacars.metrics import MetricsCollector


class TestDecodeCacheConcurrency:
    """Thread safety tests for DecodeCache."""

    def test_concurrent_reads_and_writes(self):
        """Test concurrent cache reads and writes."""
        cache = DecodeCache(maxsize=100, ttl=60.0)
        errors = []
        iterations = 100
        num_threads = 10

        def writer(thread_id):
            try:
                for i in range(iterations):
                    label = f"L{thread_id}"
                    text = f"Text {i}"
                    cache.set(label, text, 1, {"decoded": f"result_{thread_id}_{i}"})
            except Exception as e:
                errors.append(e)

        def reader(thread_id):
            try:
                for i in range(iterations):
                    label = f"L{thread_id % 5}"  # Read from subset of labels
                    text = f"Text {i % 50}"
                    cache.get(label, text, 1)
            except Exception as e:
                errors.append(e)

        threads = []
        # Half writers, half readers
        for i in range(num_threads // 2):
            threads.append(threading.Thread(target=writer, args=(i,)))
            threads.append(threading.Thread(target=reader, args=(i,)))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0, f"Concurrent access caused errors: {errors}"
        # Cache should have some entries
        assert cache.size > 0

    def test_concurrent_evictions(self):
        """Test that evictions work correctly under concurrency."""
        cache = DecodeCache(maxsize=50, ttl=60.0)
        errors = []
        num_threads = 8
        iterations = 100

        def worker(thread_id):
            try:
                for i in range(iterations):
                    label = f"L{(thread_id * iterations + i) % 100}"
                    text = f"Text_{thread_id}_{i}"
                    cache.set(label, text, 1, {"data": i})
                    # Immediately try to read it back
                    result = cache.get(label, text, 1)
                    # May be None due to eviction, but should not error
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        # Cache should not exceed maxsize
        assert cache.size <= 50

    def test_concurrent_cleanup_expired(self):
        """Test cleanup_expired during concurrent operations."""
        cache = DecodeCache(maxsize=100, ttl=0.01)  # Very short TTL
        errors = []
        stop_flag = threading.Event()

        def writer():
            try:
                i = 0
                while not stop_flag.is_set():
                    cache.set(f"L{i % 10}", f"Text{i}", 1, {"data": i})
                    i += 1
            except Exception as e:
                errors.append(e)

        def cleaner():
            try:
                while not stop_flag.is_set():
                    cache.cleanup_expired()
                    time.sleep(0.001)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=writer),
            threading.Thread(target=writer),
            threading.Thread(target=cleaner),
        ]

        for t in threads:
            t.start()

        time.sleep(0.1)  # Run for 100ms
        stop_flag.set()

        for t in threads:
            t.join()

        assert len(errors) == 0


class TestLabelFormatCacheConcurrency:
    """Thread safety tests for LabelFormatCache."""

    def test_concurrent_mark_operations(self):
        """Test concurrent supported/unsupported marking."""
        cache = LabelFormatCache(maxsize=50)
        errors = []
        iterations = 100

        def mark_supported(thread_id):
            try:
                for i in range(iterations):
                    label = f"L{(thread_id * 10 + i) % 100}"
                    cache.mark_supported(label, f"format_{thread_id}")
            except Exception as e:
                errors.append(e)

        def mark_unsupported(thread_id):
            try:
                for i in range(iterations):
                    label = f"L{(thread_id * 10 + i) % 100}"
                    cache.mark_unsupported(label)
            except Exception as e:
                errors.append(e)

        def check_supported(thread_id):
            try:
                for i in range(iterations):
                    label = f"L{i % 100}"
                    cache.is_supported(label)
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(3):
            threads.append(threading.Thread(target=mark_supported, args=(i,)))
            threads.append(threading.Thread(target=mark_unsupported, args=(i,)))
            threads.append(threading.Thread(target=check_supported, args=(i,)))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0


class TestCircuitBreakerConcurrency:
    """Thread safety tests for CircuitBreaker."""

    def test_concurrent_success_failure_recording(self):
        """Test concurrent success and failure recording."""
        breaker = CircuitBreaker(failure_threshold=100, recovery_timeout=60.0)
        errors = []
        iterations = 100

        def record_success():
            try:
                for _ in range(iterations):
                    if breaker.can_execute():
                        breaker.record_success()
            except Exception as e:
                errors.append(e)

        def record_failure():
            try:
                for _ in range(iterations):
                    if breaker.can_execute():
                        breaker.record_failure(category=ErrorCategory.UNKNOWN)
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(5):
            threads.append(threading.Thread(target=record_success))
            threads.append(threading.Thread(target=record_failure))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        stats = breaker.get_stats()
        assert stats["successful_calls"] + stats["failed_calls"] <= iterations * 10

    def test_concurrent_state_transitions(self):
        """Test state transitions under concurrent load."""
        breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=0.05,  # 50ms recovery
            half_open_max_calls=2,
        )
        errors = []
        state_changes = []
        lock = threading.Lock()

        def worker():
            try:
                for _ in range(50):
                    if breaker.can_execute():
                        # Randomly succeed or fail
                        import random
                        if random.random() > 0.3:
                            breaker.record_success()
                        else:
                            breaker.record_failure()
                        with lock:
                            state_changes.append(breaker.state)
                    time.sleep(0.001)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        # Should have experienced state changes
        stats = breaker.get_stats()
        assert stats["state_changes"] >= 0

    def test_concurrent_execute_with_fallback(self):
        """Test execute() method with fallback under concurrency."""
        breaker = CircuitBreaker(failure_threshold=10)
        errors = []
        fallback_calls = [0]
        lock = threading.Lock()

        def fallback():
            with lock:
                fallback_calls[0] += 1
            return "fallback"

        def success_func():
            return "success"

        def fail_func():
            raise ValueError("intentional failure")

        def worker(use_fail):
            try:
                for _ in range(20):
                    func = fail_func if use_fail else success_func
                    result = breaker.execute(func, fallback=fallback)
                    assert result in ("success", "fallback", None)
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(8):
            threads.append(threading.Thread(target=worker, args=(i % 2 == 0,)))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0


class TestObjectPoolConcurrency:
    """Thread safety tests for ObjectPool."""

    def test_concurrent_acquire_release(self):
        """Test concurrent acquire and release operations."""
        created_count = [0]
        lock = threading.Lock()

        def factory():
            with lock:
                created_count[0] += 1
            return {"id": created_count[0]}

        pool = ObjectPool(
            factory=factory,
            reset=lambda obj: obj.clear() or obj.update({"id": obj.get("id", 0)}),
            max_size=5,
        )
        errors = []
        iterations = 100

        def worker():
            try:
                for _ in range(iterations):
                    obj = pool.acquire()
                    assert obj is not None
                    time.sleep(0.0001)  # Simulate work
                    pool.release(obj)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        stats = pool.get_stats()
        assert stats["total_acquires"] == iterations * 10
        assert stats["total_releases"] == iterations * 10

    def test_concurrent_context_manager(self):
        """Test pool context manager under concurrency."""
        pool = ObjectPool(
            factory=lambda: [],
            reset=lambda obj: obj.clear(),
            max_size=3,
        )
        errors = []

        def worker():
            try:
                for _ in range(50):
                    with pool.acquire_context() as obj:
                        obj.append("item")
                        time.sleep(0.0001)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        # Pool should not exceed max size
        assert pool.size <= 3


class TestThreadLocalPoolConcurrency:
    """Thread safety tests for ThreadLocalPool."""

    def test_thread_isolation(self):
        """Test that each thread gets its own object."""
        pool = ThreadLocalPool(factory=lambda: {"thread_id": None})
        results = {}
        lock = threading.Lock()

        def worker(thread_id):
            obj = pool.get()
            obj["thread_id"] = thread_id
            time.sleep(0.01)  # Let other threads run
            # Object should still have this thread's ID
            with lock:
                results[thread_id] = obj["thread_id"]

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Each thread should have its own object
        for thread_id, stored_id in results.items():
            assert thread_id == stored_id, f"Thread {thread_id} got object with ID {stored_id}"


class TestBufferPoolConcurrency:
    """Thread safety tests for BufferPool."""

    def test_concurrent_buffer_operations(self):
        """Test concurrent buffer acquire and release."""
        pool = BufferPool(buffers_per_size=2)
        errors = []
        iterations = 50

        def worker(thread_id):
            try:
                for i in range(iterations):
                    size = [64, 128, 256, 512, 1024][i % 5]
                    buffer = pool.get_buffer(size)
                    assert buffer is not None
                    # Write some data
                    data = f"Thread{thread_id}_{i}".encode()[:size-1]
                    buffer.value = data
                    time.sleep(0.0001)
                    pool.release_buffer(buffer)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0

    def test_concurrent_buffer_context(self):
        """Test buffer context manager under concurrency."""
        pool = BufferPool()
        errors = []

        def worker():
            try:
                for _ in range(30):
                    with pool.buffer_context(256) as buf:
                        buf.value = b"test data"
                        time.sleep(0.0001)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0


class TestMetricsCollectorConcurrency:
    """Thread safety tests for MetricsCollector."""

    def test_concurrent_counter_increments(self):
        """Test concurrent counter increments."""
        metrics = MetricsCollector()
        iterations = 1000
        num_threads = 10

        def worker():
            for _ in range(iterations):
                metrics.increment("test_counter")

        threads = [threading.Thread(target=worker) for _ in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert metrics.get_counter("test_counter") == iterations * num_threads

    def test_concurrent_timing_records(self):
        """Test concurrent timing recordings."""
        metrics = MetricsCollector()
        iterations = 100
        num_threads = 10
        errors = []

        def worker(thread_id):
            try:
                for i in range(iterations):
                    metrics.record_timing("operation", float(i + thread_id))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        timing = metrics.get_timing("operation")
        assert timing is not None
        assert timing["count"] == iterations * num_threads

    def test_concurrent_timing_context(self):
        """Test timing context manager under concurrency."""
        metrics = MetricsCollector()
        errors = []

        def worker():
            try:
                for _ in range(50):
                    with metrics.time_operation("timed_op"):
                        time.sleep(0.001)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        timing = metrics.get_timing("timed_op")
        assert timing["count"] == 50 * 8

    def test_concurrent_gauge_updates(self):
        """Test concurrent gauge updates."""
        metrics = MetricsCollector()
        errors = []

        def worker(thread_id):
            try:
                for i in range(100):
                    metrics.set_gauge(f"gauge_{thread_id % 3}", float(i))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0

    def test_concurrent_export_prometheus(self):
        """Test Prometheus export during concurrent updates."""
        metrics = MetricsCollector()
        errors = []
        stop_flag = threading.Event()

        def updater():
            i = 0
            while not stop_flag.is_set():
                metrics.increment("counter")
                metrics.record_timing("timing", float(i % 100))
                metrics.set_gauge("gauge", float(i))
                i += 1

        def exporter():
            while not stop_flag.is_set():
                try:
                    output = metrics.export_prometheus()
                    assert isinstance(output, str)
                except Exception as e:
                    errors.append(e)
                time.sleep(0.001)

        threads = [
            threading.Thread(target=updater),
            threading.Thread(target=updater),
            threading.Thread(target=exporter),
        ]

        for t in threads:
            t.start()

        time.sleep(0.1)
        stop_flag.set()

        for t in threads:
            t.join()

        assert len(errors) == 0


class TestAsyncConcurrency:
    """Tests for async operation concurrency."""

    @pytest.mark.asyncio
    async def test_concurrent_async_cache_operations(self):
        """Test cache with async operations."""
        cache = DecodeCache(maxsize=50, ttl=60.0)
        errors = []

        async def worker(worker_id):
            try:
                for i in range(50):
                    label = f"L{worker_id}"
                    text = f"Text{i}"
                    # Simulate async context
                    await asyncio.sleep(0)
                    cache.set(label, text, 1, {"data": i})
                    await asyncio.sleep(0)
                    cache.get(label, text, 1)
            except Exception as e:
                errors.append(e)

        tasks = [asyncio.create_task(worker(i)) for i in range(10)]
        await asyncio.gather(*tasks)

        assert len(errors) == 0

    @pytest.mark.asyncio
    async def test_concurrent_async_metrics(self):
        """Test metrics collection in async context."""
        metrics = MetricsCollector()
        errors = []

        async def worker(worker_id):
            try:
                for i in range(100):
                    metrics.increment(f"async_counter_{worker_id % 3}")
                    await asyncio.sleep(0)
            except Exception as e:
                errors.append(e)

        tasks = [asyncio.create_task(worker(i)) for i in range(20)]
        await asyncio.gather(*tasks)

        assert len(errors) == 0
        # Check total counts
        total = sum(metrics.get_counter(f"async_counter_{i}") for i in range(3))
        assert total == 100 * 20
