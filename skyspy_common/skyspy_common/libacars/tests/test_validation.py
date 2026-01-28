"""
Tests for the validation module.
"""

import pytest

from skyspy_common.libacars.validation import (
    validate_label,
    validate_text,
    validate_acars_message,
    validate_and_raise,
    ValidationResult,
    MAX_MESSAGE_LENGTH,
    MAX_LABEL_LENGTH,
    MIN_LABEL_LENGTH,
)
from skyspy_common.libacars.exceptions import LibacarsValidationError


class TestValidateLabel:
    """Tests for validate_label function."""

    def test_valid_labels(self):
        """Test that valid labels pass validation."""
        valid_labels = ["H1", "SA", "AA", "Q0", "5U", "RA"]
        for label in valid_labels:
            result = validate_label(label)
            assert result.is_valid, f"Label '{label}' should be valid"

    def test_none_label(self):
        """Test that None label fails validation."""
        result = validate_label(None)
        assert not result.is_valid
        assert result.field == "label"
        assert "None" in result.error_message

    def test_empty_label(self):
        """Test that empty label fails validation."""
        result = validate_label("")
        assert not result.is_valid
        assert result.field == "label"
        assert "short" in result.error_message.lower()

    def test_label_too_long(self):
        """Test that label exceeding max length fails."""
        result = validate_label("H" * (MAX_LABEL_LENGTH + 1))
        assert not result.is_valid
        assert result.field == "label"
        assert "long" in result.error_message.lower()

    def test_label_with_null_byte(self):
        """Test that label with null byte fails validation."""
        result = validate_label("H\x001")
        assert not result.is_valid
        assert result.field == "label"
        assert "null" in result.error_message.lower()

    def test_non_string_label(self):
        """Test that non-string label fails validation."""
        result = validate_label(123)  # type: ignore
        assert not result.is_valid
        assert result.field == "label"
        assert "string" in result.error_message.lower()


class TestValidateText:
    """Tests for validate_text function."""

    def test_valid_text(self):
        """Test that valid text passes validation."""
        result = validate_text("This is a valid ACARS message")
        assert result.is_valid

    def test_none_text(self):
        """Test that None text fails validation."""
        result = validate_text(None)
        assert not result.is_valid
        assert result.field == "text"
        assert "None" in result.error_message

    def test_empty_text(self):
        """Test that empty text fails validation."""
        result = validate_text("")
        assert not result.is_valid
        assert result.field == "text"
        assert "empty" in result.error_message.lower()

    def test_text_too_long(self):
        """Test that text exceeding max length fails."""
        result = validate_text("A" * (MAX_MESSAGE_LENGTH + 1))
        assert not result.is_valid
        assert result.field == "text"
        assert "long" in result.error_message.lower()

    def test_text_with_null_byte(self):
        """Test that text with null byte fails validation."""
        result = validate_text("Hello\x00World")
        assert not result.is_valid
        assert result.field == "text"
        assert "null" in result.error_message.lower()

    def test_non_string_text(self):
        """Test that non-string text fails validation."""
        result = validate_text(12345)  # type: ignore
        assert not result.is_valid
        assert result.field == "text"
        assert "string" in result.error_message.lower()

    def test_text_at_max_length(self):
        """Test that text at exactly max length passes."""
        result = validate_text("A" * MAX_MESSAGE_LENGTH)
        assert result.is_valid


class TestValidateAcarsMessage:
    """Tests for validate_acars_message function."""

    def test_valid_message(self):
        """Test that valid label and text pass validation."""
        result = validate_acars_message("H1", "Test message content")
        assert result.is_valid

    def test_invalid_label(self):
        """Test that invalid label causes failure."""
        result = validate_acars_message("", "Test message")
        assert not result.is_valid
        assert result.field == "label"

    def test_invalid_text(self):
        """Test that invalid text causes failure."""
        result = validate_acars_message("H1", "")
        assert not result.is_valid
        assert result.field == "text"

    def test_both_invalid(self):
        """Test that when both are invalid, label error comes first."""
        result = validate_acars_message("", "")
        assert not result.is_valid
        assert result.field == "label"


class TestValidateAndRaise:
    """Tests for validate_and_raise function."""

    def test_valid_message_no_exception(self):
        """Test that valid message doesn't raise."""
        # Should not raise
        validate_and_raise("H1", "Test message content")

    def test_invalid_label_raises(self):
        """Test that invalid label raises LibacarsValidationError."""
        with pytest.raises(LibacarsValidationError) as exc_info:
            validate_and_raise("", "Test message")
        assert exc_info.value.field == "label"

    def test_invalid_text_raises(self):
        """Test that invalid text raises LibacarsValidationError."""
        with pytest.raises(LibacarsValidationError) as exc_info:
            validate_and_raise("H1", "")
        assert exc_info.value.field == "text"

    def test_exception_contains_value(self):
        """Test that exception includes the invalid value."""
        with pytest.raises(LibacarsValidationError) as exc_info:
            validate_and_raise("TOOLONG", "Test")
        # Value should be included in exception
        assert exc_info.value.value == "TOOLONG"


class TestValidationResult:
    """Tests for ValidationResult dataclass."""

    def test_as_tuple_valid(self):
        """Test as_tuple property for valid result."""
        result = ValidationResult(is_valid=True)
        is_valid, error_msg = result.as_tuple
        assert is_valid is True
        assert error_msg is None

    def test_as_tuple_invalid(self):
        """Test as_tuple property for invalid result."""
        result = ValidationResult(
            is_valid=False,
            error_message="Test error",
            field="label",
        )
        is_valid, error_msg = result.as_tuple
        assert is_valid is False
        assert error_msg == "Test error"
