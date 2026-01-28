"""
Tests for the exceptions module.
"""

import pytest

from skyspy_common.libacars.exceptions import (
    LibacarsError,
    LibacarsLoadError,
    LibacarsDecodeError,
    LibacarsMemoryError,
    LibacarsValidationError,
    LibacarsDisabledError,
)


class TestLibacarsError:
    """Tests for base LibacarsError class."""

    def test_basic_error(self):
        """Test basic error creation."""
        error = LibacarsError("Test error message")
        assert str(error) == "Test error message"
        assert error.message == "Test error message"
        assert error.details == {}

    def test_error_with_details(self):
        """Test error with details dict."""
        error = LibacarsError("Test error", details={"key": "value"})
        assert "key" in str(error)
        assert error.details == {"key": "value"}

    def test_error_inheritance(self):
        """Test that LibacarsError is an Exception."""
        error = LibacarsError("Test")
        assert isinstance(error, Exception)


class TestLibacarsLoadError:
    """Tests for LibacarsLoadError class."""

    def test_default_message(self):
        """Test default error message."""
        error = LibacarsLoadError()
        assert "load" in str(error).lower()

    def test_with_tried_paths(self):
        """Test error with tried paths."""
        paths = ["/usr/lib/libacars.so", "/usr/local/lib/libacars.so"]
        error = LibacarsLoadError(tried_paths=paths)
        assert error.tried_paths == paths
        assert error.details["tried_paths"] == paths

    def test_custom_message(self):
        """Test custom error message."""
        error = LibacarsLoadError("Custom load error")
        assert "Custom load error" in str(error)


class TestLibacarsDecodeError:
    """Tests for LibacarsDecodeError class."""

    def test_basic_decode_error(self):
        """Test basic decode error."""
        error = LibacarsDecodeError()
        assert "decode" in str(error).lower()

    def test_decode_error_with_context(self):
        """Test decode error with full context."""
        original = ValueError("Inner error")
        error = LibacarsDecodeError(
            message="Decode failed",
            label="H1",
            text_length=100,
            direction="AIR2GND",
            original_error=original,
        )
        assert error.label == "H1"
        assert error.text_length == 100
        assert error.direction == "AIR2GND"
        assert error.original_error is original
        assert "ValueError" in str(error)

    def test_decode_error_details(self):
        """Test that details dict contains all context."""
        error = LibacarsDecodeError(
            label="SA",
            text_length=50,
            direction="GND2AIR",
        )
        assert error.details["label"] == "SA"
        assert error.details["text_length"] == 50
        assert error.details["direction"] == "GND2AIR"


class TestLibacarsMemoryError:
    """Tests for LibacarsMemoryError class."""

    def test_default_message(self):
        """Test default error message."""
        error = LibacarsMemoryError()
        assert "memory" in str(error).lower()

    def test_with_operation(self):
        """Test error with operation context."""
        error = LibacarsMemoryError(operation="la_vstring_new")
        assert error.operation == "la_vstring_new"
        assert error.details["operation"] == "la_vstring_new"


class TestLibacarsValidationError:
    """Tests for LibacarsValidationError class."""

    def test_basic_validation_error(self):
        """Test basic validation error."""
        error = LibacarsValidationError("Invalid input")
        assert "Invalid input" in str(error)

    def test_validation_error_with_field(self):
        """Test validation error with field name."""
        error = LibacarsValidationError(
            message="Label too long",
            field="label",
            value="TOOLONG",
        )
        assert error.field == "label"
        assert error.value == "TOOLONG"

    def test_value_truncation(self):
        """Test that long values are truncated in details."""
        long_value = "A" * 200
        error = LibacarsValidationError(
            message="Text too long",
            field="text",
            value=long_value,
        )
        # Full value stored in attribute
        assert error.value == long_value
        # Truncated in details
        assert len(error.details["value"]) < len(long_value)
        assert error.details["value"].endswith("...")


class TestLibacarsDisabledError:
    """Tests for LibacarsDisabledError class."""

    def test_default_message(self):
        """Test default error message."""
        error = LibacarsDisabledError()
        assert "disabled" in str(error).lower()

    def test_with_reason(self):
        """Test error with reason."""
        error = LibacarsDisabledError(reason="environment_variable")
        assert error.reason == "environment_variable"
        assert error.details["reason"] == "environment_variable"

    def test_with_consecutive_errors(self):
        """Test error with consecutive error count."""
        error = LibacarsDisabledError(
            reason="consecutive_errors",
            consecutive_errors=5,
        )
        assert error.consecutive_errors == 5
        assert error.details["consecutive_errors"] == 5


class TestExceptionHierarchy:
    """Test exception class hierarchy."""

    def test_all_inherit_from_base(self):
        """Test that all custom exceptions inherit from LibacarsError."""
        exceptions = [
            LibacarsLoadError(),
            LibacarsDecodeError(),
            LibacarsMemoryError(),
            LibacarsValidationError("test"),
            LibacarsDisabledError(),
        ]
        for exc in exceptions:
            assert isinstance(exc, LibacarsError)
            assert isinstance(exc, Exception)

    def test_catching_base_catches_all(self):
        """Test that catching LibacarsError catches all subtypes."""
        exceptions_to_test = [
            (LibacarsLoadError, LibacarsLoadError()),
            (LibacarsDecodeError, LibacarsDecodeError()),
            (LibacarsMemoryError, LibacarsMemoryError()),
            (LibacarsValidationError, LibacarsValidationError("test")),
            (LibacarsDisabledError, LibacarsDisabledError()),
        ]

        for exc_class, exc_instance in exceptions_to_test:
            try:
                raise exc_instance
            except LibacarsError:
                pass  # Expected
            except Exception:
                pytest.fail(f"{exc_class.__name__} should be caught by LibacarsError")
