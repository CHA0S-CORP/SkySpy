"""
Python bindings for libacars library.

This module provides a compatibility shim that imports from the shared
skyspy_common.libacars package.

libacars is a C library for decoding various ACARS message payloads including:
- FANS-1/A ADS-C (Automatic Dependent Surveillance - Contract)
- FANS-1/A CPDLC (Controller-Pilot Data Link Communications)
- MIAM (Media Independent Aircraft Messaging)
- Various airline-specific message formats

Features:
- CFFI/ctypes dual backend support
- LRU caching for decoded messages
- Circuit breaker for error recovery
- Prometheus metrics export
- Async/batch operation support
"""

import logging

# Re-export everything from the shared package
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
    shutdown,
    # Health and metrics
    get_health,
    export_prometheus_metrics,
    # Exceptions
    LibacarsError,
    LibacarsLoadError,
    LibacarsDecodeError,
    LibacarsMemoryError,
    LibacarsValidationError,
    LibacarsDisabledError,
    # Validation
    validate_acars_message,
    validate_label,
    validate_text,
    validate_and_raise,
    ValidationResult,
    # Cache
    DecodeCache,
    LabelFormatCache,
    CacheStats,
    get_decode_cache,
    get_label_cache,
    reset_caches,
    # Circuit breaker
    CircuitBreaker,
    CircuitState,
    ErrorCategory,
    CircuitBreakerStats,
    get_circuit_breaker,
    reset_circuit_breaker,
    # Metrics
    MetricsCollector,
    TimingStats,
    CounterStats,
    HealthChecker,
    get_metrics_collector,
    reset_metrics,
    # Constants
    LIBACARS_DISABLED,
    MAX_MESSAGE_LENGTH,
    MAX_LABEL_LENGTH,
    MIN_LABEL_LENGTH,
)

logger = logging.getLogger(__name__)

# Export all symbols
__all__ = [
    # Core functions
    "decode_acars_apps",
    "decode_acars_apps_text",
    "extract_sublabel_mfi",
    # Async versions
    "decode_acars_apps_async",
    "decode_acars_apps_text_async",
    # Batch operations
    "decode_batch",
    "decode_batch_async",
    "BatchMessage",
    "BatchResult",
    # Types
    "MsgDir",
    "DecodeResult",
    "LibacarsStats",
    # State management
    "is_available",
    "get_backend",
    "get_stats",
    "reset_stats",
    "reset_error_state",
    "shutdown",
    # Health and metrics
    "get_health",
    "export_prometheus_metrics",
    # Exceptions
    "LibacarsError",
    "LibacarsLoadError",
    "LibacarsDecodeError",
    "LibacarsMemoryError",
    "LibacarsValidationError",
    "LibacarsDisabledError",
    # Validation
    "validate_acars_message",
    "validate_label",
    "validate_text",
    "validate_and_raise",
    "ValidationResult",
    # Cache
    "DecodeCache",
    "LabelFormatCache",
    "CacheStats",
    "get_decode_cache",
    "get_label_cache",
    "reset_caches",
    # Circuit breaker
    "CircuitBreaker",
    "CircuitState",
    "ErrorCategory",
    "CircuitBreakerStats",
    "get_circuit_breaker",
    "reset_circuit_breaker",
    # Metrics
    "MetricsCollector",
    "TimingStats",
    "CounterStats",
    "HealthChecker",
    "get_metrics_collector",
    "reset_metrics",
    # Constants
    "LIBACARS_DISABLED",
    "MAX_MESSAGE_LENGTH",
    "MAX_LABEL_LENGTH",
    "MIN_LABEL_LENGTH",
]
