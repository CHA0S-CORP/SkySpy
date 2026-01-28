"""
Integration test stubs for libacars binding.

These tests require libacars to be installed and are skipped if unavailable.
Run with: pytest -m integration

To enable these tests, install libacars:
  - macOS: brew install libacars
  - Linux: apt-get install libacars-dev (or build from source)
"""

import pytest
from unittest.mock import patch

# Check if libacars is actually available
try:
    from skyspy_common.libacars import binding as binding_module
    LIBACARS_AVAILABLE = binding_module._libacars_available
except Exception:
    LIBACARS_AVAILABLE = False


# Mark all tests in this module as integration tests
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not LIBACARS_AVAILABLE, reason="libacars not installed"),
]


class TestRealLibacarsDecode:
    """Integration tests using the actual libacars library."""

    def test_decode_known_message(self):
        """Test decoding a known ACARS message format."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir

        # H1 label is commonly used for position reports
        # This is a synthetic example - adjust based on actual message formats
        label = "H1"
        text = "TEST MESSAGE"
        direction = MsgDir.AIR2GND

        result = decode_acars_apps(label, text, direction)

        # Result may be None if libacars doesn't recognize this specific format
        # The test verifies no crashes occur
        if result is not None:
            assert isinstance(result, dict)

    def test_decode_arinc_622_message(self):
        """Test decoding an ARINC 622 format message."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir

        # ARINC 622 uses specific message structure
        label = "AA"
        text = "#DFBA.A320/F.EGLL.LFPG,N12345,1234"
        direction = MsgDir.AIR2GND

        result = decode_acars_apps(label, text, direction)

        # Verify operation completes without error
        # Actual content depends on libacars version and support

    def test_decode_fans_message(self):
        """Test decoding a FANS-1/A message."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir

        # FANS uses H1/H2 labels
        label = "H1"
        text = "FANS POSITION REPORT TEST"
        direction = MsgDir.AIR2GND

        result = decode_acars_apps(label, text, direction)

        # Test runs without crash

    def test_decode_returns_json_structure(self):
        """Test that successful decode returns expected JSON structure."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir

        label = "SA"  # System address message
        text = ".XXXX TEST MESSAGE CONTENT"
        direction = MsgDir.AIR2GND

        result = decode_acars_apps(label, text, direction)

        if result is not None:
            # Libacars returns structured JSON
            assert isinstance(result, dict)
            # May contain 'acars' key or other format-specific keys

    def test_decode_text_returns_string(self):
        """Test that text decode returns a string."""
        from skyspy_common.libacars import decode_acars_apps_text, MsgDir

        label = "H1"
        text = "TEST MESSAGE"
        direction = MsgDir.AIR2GND

        result = decode_acars_apps_text(label, text, direction)

        if result is not None:
            assert isinstance(result, str)


class TestRealLibacarsAsync:
    """Integration tests for async operations with real library."""

    @pytest.mark.asyncio
    async def test_async_decode(self):
        """Test async decode with real library."""
        from skyspy_common.libacars import decode_acars_apps_async, MsgDir

        label = "H1"
        text = "ASYNC TEST MESSAGE"
        direction = MsgDir.AIR2GND

        result = await decode_acars_apps_async(label, text, direction)

        # Verify async wrapper works
        if result is not None:
            assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_async_batch_decode(self):
        """Test async batch decode with real library."""
        from skyspy_common.libacars import decode_batch_async, BatchMessage, MsgDir

        messages = [
            BatchMessage(label="H1", text="Test 1", direction=MsgDir.AIR2GND, id="1"),
            BatchMessage(label="SA", text="Test 2", direction=MsgDir.AIR2GND, id="2"),
            BatchMessage(label="AA", text="Test 3", direction=MsgDir.AIR2GND, id="3"),
        ]

        results = await decode_batch_async(messages)

        assert len(results) == 3
        for result in results:
            assert result.id in ("1", "2", "3")


class TestRealLibacarsBatch:
    """Integration tests for batch operations."""

    def test_batch_decode_multiple_messages(self):
        """Test batch decoding multiple messages."""
        from skyspy_common.libacars import decode_batch, BatchMessage, MsgDir

        messages = [
            BatchMessage(label="H1", text=f"Message {i}", direction=MsgDir.AIR2GND, id=f"msg-{i}")
            for i in range(10)
        ]

        results = decode_batch(messages)

        assert len(results) == 10
        for i, result in enumerate(results):
            assert result.id == f"msg-{i}"

    def test_batch_decode_mixed_labels(self):
        """Test batch with various message labels."""
        from skyspy_common.libacars import decode_batch, BatchMessage, MsgDir

        labels = ["H1", "SA", "AA", "Q0", "5Z", "_d", "B6"]
        messages = [
            BatchMessage(label=label, text=f"Text for {label}", direction=MsgDir.AIR2GND, id=label)
            for label in labels
        ]

        results = decode_batch(messages)

        assert len(results) == len(labels)


class TestRealLibacarsSubLabel:
    """Integration tests for sublabel/MFI extraction."""

    def test_extract_sublabel_mfi(self):
        """Test sublabel/MFI extraction."""
        from skyspy_common.libacars import extract_sublabel_mfi

        # Test with various label formats
        test_cases = [
            ("H1", "POS N12345 W67890"),
            ("AA", ".ABCDE MESSAGE"),
            ("SA", "#CFB.A320"),
        ]

        for label, text in test_cases:
            sublabel, mfi, consumed = extract_sublabel_mfi(label, text)
            # May return None/0 for many cases - just verify no crash
            assert consumed >= 0


class TestRealLibacarsStatistics:
    """Integration tests for statistics tracking with real library."""

    def test_stats_tracking(self):
        """Test that statistics are tracked during real decodes."""
        from skyspy_common.libacars import (
            decode_acars_apps,
            get_stats,
            reset_stats,
            MsgDir,
        )

        reset_stats()

        # Perform some decodes
        for i in range(5):
            decode_acars_apps("H1", f"Test message {i}", MsgDir.AIR2GND)

        stats = get_stats()

        assert stats["total_calls"] == 5
        # Other stats depend on decode success/failure


class TestRealLibacarsResilience:
    """Integration tests for error handling with real library."""

    def test_malformed_message_handling(self):
        """Test that malformed messages are handled gracefully."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir

        # Various potentially problematic inputs
        test_inputs = [
            ("H1", ""),  # Empty text (should fail validation)
            ("", "Some text"),  # Empty label (should fail validation)
            ("H1", "A" * 100000),  # Very long message
            ("H1", "\x00\x01\x02"),  # Binary data
            ("XX", "Random"),  # Unknown label
        ]

        for label, text in test_inputs:
            # Should not raise unhandled exception
            try:
                result = decode_acars_apps(label, text, MsgDir.AIR2GND)
                # Result may be None
            except Exception as e:
                # Only validation errors are acceptable
                assert "validation" in str(type(e)).lower() or "libacars" in str(type(e)).lower()

    def test_rapid_sequential_decodes(self):
        """Test rapid sequential decodes don't cause issues."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir

        for i in range(100):
            decode_acars_apps("H1", f"Message {i}", MsgDir.AIR2GND)

        # Should complete without issues


class TestRealLibacarsCache:
    """Integration tests for caching with real library."""

    def test_cache_integration(self):
        """Test cache works correctly with real decodes."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir
        from skyspy_common.libacars.cache import get_decode_cache, reset_caches

        reset_caches()
        cache = get_decode_cache()

        label = "H1"
        text = "Cached test message"
        direction = MsgDir.AIR2GND

        # First decode
        result1 = decode_acars_apps(label, text, direction, use_cache=True)

        # Second decode (should hit cache if first succeeded)
        result2 = decode_acars_apps(label, text, direction, use_cache=True)

        # Results should be identical
        if result1 is not None:
            assert result1 == result2

        # Check cache stats
        stats = cache.get_stats()
        # Should have at least one operation recorded


class TestRealLibacarsCircuitBreaker:
    """Integration tests for circuit breaker with real library."""

    def test_circuit_breaker_integration(self):
        """Test circuit breaker doesn't interfere with normal operation."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir
        from skyspy_common.libacars.circuit_breaker import get_circuit_breaker, reset_circuit_breaker

        reset_circuit_breaker()
        breaker = get_circuit_breaker()

        # Should start closed
        assert breaker.is_closed

        # Perform some decodes
        for i in range(10):
            decode_acars_apps("H1", f"Test {i}", MsgDir.AIR2GND)

        # Circuit should remain closed after successful operations
        stats = breaker.get_stats()
        # Check operations were tracked


class TestRealLibacarsMetrics:
    """Integration tests for metrics with real library."""

    def test_metrics_collection(self):
        """Test metrics are collected during real operations."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir
        from skyspy_common.libacars.metrics import get_metrics_collector, reset_metrics

        reset_metrics()
        metrics = get_metrics_collector()

        # Perform some decodes
        for i in range(5):
            decode_acars_apps("H1", f"Test {i}", MsgDir.AIR2GND)

        # Check metrics were recorded
        all_metrics = metrics.get_all_metrics()
        assert "counters" in all_metrics
        assert "timings" in all_metrics

    def test_prometheus_export(self):
        """Test Prometheus export format."""
        from skyspy_common.libacars import decode_acars_apps, MsgDir
        from skyspy_common.libacars.metrics import get_metrics_collector, reset_metrics

        reset_metrics()
        metrics = get_metrics_collector()

        # Perform some operations
        decode_acars_apps("H1", "Test", MsgDir.AIR2GND)

        # Export
        output = metrics.export_prometheus()

        assert isinstance(output, str)
        assert "libacars" in output  # Prefix should be present


class TestRealLibacarsHealth:
    """Integration tests for health checks."""

    def test_health_check(self):
        """Test health check returns valid status."""
        from skyspy_common.libacars import get_health

        health = get_health()

        assert isinstance(health, dict)
        assert "healthy" in health
        assert "checks" in health


# Fixtures for integration tests

@pytest.fixture(autouse=True)
def reset_state():
    """Reset all state before each integration test."""
    from skyspy_common.libacars import reset_stats, reset_error_state
    from skyspy_common.libacars.cache import reset_caches
    from skyspy_common.libacars.circuit_breaker import reset_circuit_breaker
    from skyspy_common.libacars.metrics import reset_metrics
    from skyspy_common.libacars.pool import reset_pools

    reset_stats()
    reset_error_state()
    reset_caches()
    reset_circuit_breaker()
    reset_metrics()
    reset_pools()

    yield

    # Cleanup after test
    reset_caches()
    reset_circuit_breaker()
    reset_metrics()
    reset_pools()
