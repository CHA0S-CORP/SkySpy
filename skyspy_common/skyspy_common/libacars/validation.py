"""
Message validation layer for libacars binding.

Pre-validates messages before sending them to the C library,
catching invalid inputs early and providing meaningful error messages.
"""

from dataclasses import dataclass
from typing import Optional

from .exceptions import LibacarsValidationError


# Validation constants
MAX_MESSAGE_LENGTH = 10_000
MAX_LABEL_LENGTH = 4
MIN_LABEL_LENGTH = 1


@dataclass
class ValidationResult:
    """Result of message validation."""

    is_valid: bool
    error_message: Optional[str] = None
    field: Optional[str] = None

    @property
    def as_tuple(self) -> tuple[bool, Optional[str]]:
        """Return (is_valid, error_message) tuple for backwards compatibility."""
        return (self.is_valid, self.error_message)


def validate_label(label: str | None) -> ValidationResult:
    """
    Validate ACARS message label.

    Args:
        label: The message label to validate (e.g., "H1", "SA")

    Returns:
        ValidationResult with validation status
    """
    if label is None:
        return ValidationResult(
            is_valid=False,
            error_message="Label cannot be None",
            field="label",
        )

    if not isinstance(label, str):
        return ValidationResult(
            is_valid=False,
            error_message=f"Label must be a string, got {type(label).__name__}",
            field="label",
        )

    if len(label) < MIN_LABEL_LENGTH:
        return ValidationResult(
            is_valid=False,
            error_message=f"Label too short (min {MIN_LABEL_LENGTH} chars)",
            field="label",
        )

    if len(label) > MAX_LABEL_LENGTH:
        return ValidationResult(
            is_valid=False,
            error_message=f"Label too long (max {MAX_LABEL_LENGTH} chars)",
            field="label",
        )

    # Check for null bytes
    if "\x00" in label:
        return ValidationResult(
            is_valid=False,
            error_message="Label contains null bytes",
            field="label",
        )

    return ValidationResult(is_valid=True)


def validate_text(text: str | None) -> ValidationResult:
    """
    Validate ACARS message text content.

    Args:
        text: The message text to validate

    Returns:
        ValidationResult with validation status
    """
    if text is None:
        return ValidationResult(
            is_valid=False,
            error_message="Text cannot be None",
            field="text",
        )

    if not isinstance(text, str):
        return ValidationResult(
            is_valid=False,
            error_message=f"Text must be a string, got {type(text).__name__}",
            field="text",
        )

    if not text:
        return ValidationResult(
            is_valid=False,
            error_message="Text cannot be empty",
            field="text",
        )

    if len(text) > MAX_MESSAGE_LENGTH:
        return ValidationResult(
            is_valid=False,
            error_message=f"Text too long ({len(text)} chars, max {MAX_MESSAGE_LENGTH})",
            field="text",
        )

    # Check for null bytes - these can cause issues in C strings
    if "\x00" in text:
        return ValidationResult(
            is_valid=False,
            error_message="Text contains null bytes",
            field="text",
        )

    return ValidationResult(is_valid=True)


def validate_acars_message(label: str | None, text: str | None) -> ValidationResult:
    """
    Validate a complete ACARS message (label and text).

    Args:
        label: The message label
        text: The message text content

    Returns:
        ValidationResult with validation status

    Raises:
        LibacarsValidationError: If raise_on_error=True and validation fails
    """
    label_result = validate_label(label)
    if not label_result.is_valid:
        return label_result

    text_result = validate_text(text)
    if not text_result.is_valid:
        return text_result

    return ValidationResult(is_valid=True)


def validate_and_raise(label: str | None, text: str | None) -> None:
    """
    Validate message and raise exception if invalid.

    This is a convenience function for cases where you want
    exception-based error handling.

    Args:
        label: The message label
        text: The message text content

    Raises:
        LibacarsValidationError: If validation fails
    """
    result = validate_acars_message(label, text)
    if not result.is_valid:
        raise LibacarsValidationError(
            message=result.error_message or "Validation failed",
            field=result.field,
            value=label if result.field == "label" else text,
        )
