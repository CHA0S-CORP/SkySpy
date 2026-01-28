"""
Tests for the binding module.

Includes tests with mock library to allow testing without libacars installed.
"""

import asyncio
import json
import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from skyspy_common.libacars import (
    # Core functions
    decode_acars_apps,
    decode_acars_apps_text,
    extract_sublabel_mfi,
    # Async versions
    decode_acars_apps_async,
    decode_acars_apps_text_async,
    # Batch operations
    decode_batch,
    decode_batch_async,
    BatchMessage,
    BatchResult,
    # Types
    MsgDir,
    DecodeResult,
    LibacarsStats,
    # State management
    is_available,
    get_backend,
    get_stats,
    reset_stats,
    reset_error_state,
    # Exceptions
    LibacarsDecodeError,
    LibacarsDisabledError,
    LibacarsValidationError,
)
from skyspy_common.libacars import binding as binding_module


class TestMsgDir:
    """Tests for MsgDir enumeration."""

    def test_values(self):
        """Test enum values match libacars constants."""
        assert MsgDir.UNKNOWN == 0
        assert MsgDir.AIR2GND == 1
        assert MsgDir.GND2AIR == 2

    def test_names(self):
        """Test enum names."""
        assert MsgDir.UNKNOWN.name == "UNKNOWN"
        assert MsgDir.AIR2GND.name == "AIR2GND"
        assert MsgDir.GND2AIR.name == "GND2AIR"


class TestLibacarsStats:
    """Tests for LibacarsStats dataclass."""

    def test_default_values(self):
        """Test default initialization."""
        stats = LibacarsStats()
        assert stats.total_calls == 0
        assert stats.successful == 0
        assert stats.failed == 0
        assert stats.skipped == 0
        assert stats.total_decode_time_ms == 0.0
        assert stats.consecutive_errors == 0

    def test_avg_decode_time_zero_calls(self):
        """Test average time when no calls made."""
        stats = LibacarsStats()
        assert stats.avg_decode_time_ms == 0.0

    def test_avg_decode_time_with_calls(self):
        """Test average time calculation."""
        stats = LibacarsStats(
            total_calls=10,
            skipped=2,
            total_decode_time_ms=80.0,
        )
        # (10 - 2) = 8 actual decodes, 80ms / 8 = 10ms avg
        assert stats.avg_decode_time_ms == 10.0

    def test_success_rate_zero_calls(self):
        """Test success rate when no calls made."""
        stats = LibacarsStats()
        assert stats.success_rate == 0.0

    def test_success_rate_with_calls(self):
        """Test success rate calculation."""
        stats = LibacarsStats(
            total_calls=10,
            skipped=2,
            successful=6,
        )
        # 6 / 8 * 100 = 75%
        assert stats.success_rate == 75.0

    def test_to_dict(self):
        """Test dictionary conversion."""
        stats = LibacarsStats(
            total_calls=100,
            successful=80,
            failed=10,
            skipped=10,
            total_decode_time_ms=900.0,
            consecutive_errors=2,
        )
        d = stats.to_dict()
        assert d["total_calls"] == 100
        assert d["successful"] == 80
        assert d["failed"] == 10
        assert d["skipped"] == 10
        assert d["total_decode_time_ms"] == 900.0
        assert d["consecutive_errors"] == 2
        assert "avg_decode_time_ms" in d
        assert "success_rate" in d


class TestBatchMessage:
    """Tests for BatchMessage dataclass."""

    def test_basic_creation(self):
        """Test basic message creation."""
        msg = BatchMessage(label="H1", text="Test message")
        assert msg.label == "H1"
        assert msg.text == "Test message"
        assert msg.direction == MsgDir.UNKNOWN
        assert msg.id is None

    def test_with_all_fields(self):
        """Test message with all fields."""
        msg = BatchMessage(
            label="SA",
            text="Test",
            direction=MsgDir.AIR2GND,
            id="msg-001",
        )
        assert msg.direction == MsgDir.AIR2GND
        assert msg.id == "msg-001"


class TestBatchResult:
    """Tests for BatchResult dataclass."""

    def test_success_result(self):
        """Test successful result."""
        result = BatchResult(
            id="msg-001",
            success=True,
            data={"decoded": "data"},
        )
        assert result.success
        assert result.data == {"decoded": "data"}
        assert result.error is None

    def test_failure_result(self):
        """Test failure result."""
        result = BatchResult(
            id="msg-001",
            success=False,
            error="Decode failed",
        )
        assert not result.success
        assert result.data is None
        assert result.error == "Decode failed"


class TestDecodeWithMockLibrary:
    """Tests using mocked library for decode operations."""

    @pytest.fixture
    def mock_libacars(self):
        """Create a mock libacars library."""
        mock_lib = MagicMock()

        # Mock vstring structure
        mock_vstr = MagicMock()
        mock_vstr.contents.str = b'{"acars": {"label": "H1", "text": "test"}}'
        mock_lib.la_vstring_new.return_value = mock_vstr

        # Mock node (non-null)
        mock_node = MagicMock()
        mock_lib.la_acars_decode_apps.return_value = mock_node

        return mock_lib

    def test_decode_validation_failure(self):
        """Test that validation failures return None."""
        # Empty label
        result = decode_acars_apps("", "Test message")
        assert result is None

        # Empty text
        result = decode_acars_apps("H1", "")
        assert result is None

        # Label too long
        result = decode_acars_apps("TOOLONG", "Test message")
        assert result is None

    def test_decode_validation_raises_when_requested(self, mock_libacars_available):
        """Test that validation failures raise when raise_on_error=True."""
        with pytest.raises(LibacarsValidationError):
            decode_acars_apps("", "Test", raise_on_error=True)

    def test_decode_with_null_bytes(self):
        """Test that messages with null bytes are rejected."""
        result = decode_acars_apps("H1", "Hello\x00World")
        assert result is None

    def test_decode_when_circuit_open(self):
        """Test that decode returns None when circuit breaker is open."""
        from skyspy_common.libacars.circuit_breaker import get_circuit_breaker, reset_circuit_breaker
        reset_circuit_breaker()
        breaker = get_circuit_breaker()
        breaker.force_open()  # Force circuit to open state

        result = decode_acars_apps("H1", "Test message")
        assert result is None

    def test_decode_raises_when_circuit_open(self):
        """Test that decode raises LibacarsDisabledError when circuit is open."""
        from skyspy_common.libacars.circuit_breaker import get_circuit_breaker, reset_circuit_breaker
        reset_circuit_breaker()
        breaker = get_circuit_breaker()
        breaker.force_open()  # Force circuit to open state

        with pytest.raises(LibacarsDisabledError) as exc_info:
            decode_acars_apps("H1", "Test message", raise_on_error=True)
        assert exc_info.value.reason == "circuit_open"


class TestStateManagement:
    """Tests for state management functions."""

    def test_reset_stats(self):
        """Test that reset_stats clears statistics."""
        reset_stats()
        stats = get_stats()
        assert stats["total_calls"] == 0
        assert stats["successful"] == 0
        assert stats["failed"] == 0

    def test_reset_error_state(self):
        """Test that reset_error_state re-enables library."""
        from skyspy_common.libacars.circuit_breaker import get_circuit_breaker, reset_circuit_breaker
        reset_circuit_breaker()
        breaker = get_circuit_breaker()

        # Force circuit to open state and add errors
        breaker.force_open()
        binding_module._stats.consecutive_errors = 10

        reset_error_state()

        # Circuit should be reset to closed
        assert breaker.is_closed
        assert binding_module._stats.consecutive_errors == 0

    def test_get_stats_returns_dict(self):
        """Test that get_stats returns a dictionary with expected keys."""
        stats = get_stats()
        expected_keys = [
            "available",
            "disabled_env",
            "backend",
            "circuit_state",
            "cache_enabled",
            "cache_size",
            "total_calls",
            "successful",
            "failed",
            "skipped",
            "consecutive_errors",
            "total_decode_time_ms",
            "avg_decode_time_ms",
            "success_rate",
            "circuit_breaker",
            "cache",
        ]
        for key in expected_keys:
            assert key in stats, f"Missing key: {key}"

    def test_get_backend_when_unavailable(self):
        """Test get_backend when library is not available."""
        with patch.object(binding_module, '_libacars_available', False):
            with patch.object(binding_module, 'LIBACARS_DISABLED', True):
                backend = get_backend()
                assert backend == "unavailable"


class TestBatchDecoding:
    """Tests for batch decoding functionality."""

    def test_decode_batch_empty(self):
        """Test batch decode with empty list."""
        results = decode_batch([])
        assert results == []

    def test_decode_batch_validation_failures(self):
        """Test batch decode handles validation failures."""
        messages = [
            BatchMessage(label="", text="Test", id="msg-1"),  # Invalid label
            BatchMessage(label="H1", text="", id="msg-2"),    # Invalid text
        ]
        results = decode_batch(messages)
        assert len(results) == 2
        assert not results[0].success
        assert not results[1].success

    def test_decode_batch_preserves_ids(self):
        """Test that batch results preserve message IDs."""
        messages = [
            BatchMessage(label="H1", text="Test1", id="id-001"),
            BatchMessage(label="SA", text="Test2", id="id-002"),
        ]
        results = decode_batch(messages)
        assert results[0].id == "id-001"
        assert results[1].id == "id-002"


class TestAsyncDecoding:
    """Tests for async decoding functionality."""

    @pytest.mark.asyncio
    async def test_async_decode_validation_failure(self):
        """Test async decode with validation failure."""
        result = await decode_acars_apps_async("", "Test")
        assert result is None

    @pytest.mark.asyncio
    async def test_async_decode_raises_when_requested(self, mock_libacars_available):
        """Test async decode raises on validation failure."""
        with pytest.raises(LibacarsValidationError):
            await decode_acars_apps_async("", "Test", raise_on_error=True)

    @pytest.mark.asyncio
    async def test_async_batch_empty(self):
        """Test async batch decode with empty list."""
        results = await decode_batch_async([])
        assert results == []

    @pytest.mark.asyncio
    async def test_async_batch_validation_failures(self):
        """Test async batch handles validation failures."""
        messages = [
            BatchMessage(label="", text="Test", id="msg-1"),
        ]
        results = await decode_batch_async(messages)
        assert len(results) == 1
        assert not results[0].success


class TestExtractSublabelMfi:
    """Tests for extract_sublabel_mfi function."""

    def test_extract_with_invalid_input(self):
        """Test extraction with invalid input returns defaults."""
        result = extract_sublabel_mfi("", "")
        assert result == (None, None, 0)

        result = extract_sublabel_mfi(None, "Test")  # type: ignore
        assert result == (None, None, 0)

        result = extract_sublabel_mfi("H1", None)  # type: ignore
        assert result == (None, None, 0)


class TestDecodeText:
    """Tests for text decoding functionality."""

    def test_decode_text_validation_failure(self):
        """Test text decode with validation failure."""
        result = decode_acars_apps_text("", "Test")
        assert result is None

    def test_decode_text_raises_when_requested(self, mock_libacars_available):
        """Test text decode raises on validation failure."""
        with pytest.raises(LibacarsValidationError):
            decode_acars_apps_text("", "Test", raise_on_error=True)

    @pytest.mark.asyncio
    async def test_async_text_decode_validation_failure(self):
        """Test async text decode with validation failure."""
        result = await decode_acars_apps_text_async("", "Test")
        assert result is None
