"""
Custom exception classes for the libacars binding.

Provides a hierarchy of exceptions for different error scenarios,
enabling better error handling and recovery strategies.
"""


class LibacarsError(Exception):
    """Base exception for all libacars-related errors."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def __str__(self) -> str:
        if self.details:
            return f"{self.message} (details: {self.details})"
        return self.message


class LibacarsLoadError(LibacarsError):
    """
    Raised when the libacars shared library cannot be loaded.

    This typically occurs when:
    - The library is not installed
    - The library is in a non-standard location
    - There are missing dependencies
    """

    def __init__(self, message: str = "Failed to load libacars library", tried_paths: list[str] | None = None):
        super().__init__(message, {"tried_paths": tried_paths or []})
        self.tried_paths = tried_paths or []


class LibacarsDecodeError(LibacarsError):
    """
    Raised when message decoding fails.

    This can occur due to:
    - Malformed message content
    - Unsupported message format
    - Invalid label/text combination
    """

    def __init__(
        self,
        message: str = "Failed to decode ACARS message",
        label: str | None = None,
        text_length: int | None = None,
        direction: str | None = None,
        original_error: Exception | None = None,
    ):
        details = {
            "label": label,
            "text_length": text_length,
            "direction": direction,
        }
        if original_error:
            details["original_error"] = str(original_error)
            details["original_error_type"] = type(original_error).__name__
        super().__init__(message, details)
        self.label = label
        self.text_length = text_length
        self.direction = direction
        self.original_error = original_error


class LibacarsMemoryError(LibacarsError):
    """
    Raised when memory allocation fails in the C library.

    This is a critical error indicating resource exhaustion
    or library state corruption.
    """

    def __init__(self, message: str = "Memory allocation failed in libacars", operation: str | None = None):
        super().__init__(message, {"operation": operation})
        self.operation = operation


class LibacarsValidationError(LibacarsError):
    """
    Raised when input validation fails before calling the C library.

    This helps catch invalid inputs early, before they reach
    the C code where they could cause crashes or undefined behavior.
    """

    def __init__(self, message: str, field: str | None = None, value: str | None = None):
        # Truncate value for display if too long
        display_value = value
        if value and len(value) > 100:
            display_value = value[:100] + "..."
        super().__init__(message, {"field": field, "value": display_value})
        self.field = field
        self.value = value


class LibacarsDisabledError(LibacarsError):
    """
    Raised when libacars is disabled (either by config or due to errors).

    This allows callers to distinguish between "not available" and
    "available but turned off" states.
    """

    def __init__(
        self,
        message: str = "libacars is disabled",
        reason: str = "unknown",
        consecutive_errors: int | None = None,
    ):
        details = {"reason": reason}
        if consecutive_errors is not None:
            details["consecutive_errors"] = consecutive_errors
        super().__init__(message, details)
        self.reason = reason
        self.consecutive_errors = consecutive_errors
