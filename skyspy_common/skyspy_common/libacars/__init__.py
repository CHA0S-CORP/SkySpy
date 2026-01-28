"""
libacars Python binding package.

This package provides Python bindings for the libacars C library,
enabling decoding of complex ACARS message formats.

Features:
- CFFI/ctypes dual backend support
- LRU caching for decoded messages
- Circuit breaker for error recovery
- Object pooling for performance
- Prometheus metrics export
- Async/batch operation support

Basic usage:
    from skyspy_common.libacars import decode_acars_apps, MsgDir, is_available

    if is_available():
        result = decode_acars_apps("H1", message_text, MsgDir.AIR2GND)
        if result:
            print(result)

Async usage:
    from skyspy_common.libacars import decode_acars_apps_async, MsgDir

    result = await decode_acars_apps_async("H1", message_text, MsgDir.AIR2GND)

Batch usage:
    from skyspy_common.libacars import decode_batch, BatchMessage

    messages = [
        BatchMessage(label="H1", text=text1),
        BatchMessage(label="SA", text=text2),
    ]
    results = decode_batch(messages)

With caching:
    result = decode_acars_apps("H1", text, MsgDir.AIR2GND, use_cache=True)

Health and metrics:
    from skyspy_common.libacars import get_health, export_prometheus_metrics

    health = get_health()
    metrics_output = export_prometheus_metrics()
"""

from .binding import (
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
    # Types and enums
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
    # Constants
    LIBACARS_DISABLED,
)

from .exceptions import (
    LibacarsError,
    LibacarsLoadError,
    LibacarsDecodeError,
    LibacarsMemoryError,
    LibacarsValidationError,
    LibacarsDisabledError,
)

from .validation import (
    validate_acars_message,
    validate_label,
    validate_text,
    validate_and_raise,
    ValidationResult,
    MAX_MESSAGE_LENGTH,
    MAX_LABEL_LENGTH,
    MIN_LABEL_LENGTH,
)

# Cache module exports
from .cache import (
    DecodeCache,
    LabelFormatCache,
    CacheEntry,
    CacheStats,
    get_decode_cache,
    get_label_cache,
    reset_caches,
)

# Circuit breaker exports
from .circuit_breaker import (
    CircuitBreaker,
    CircuitState,
    ErrorCategory,
    CircuitBreakerStats,
    get_circuit_breaker,
    reset_circuit_breaker,
)

# Object pool exports
from .pool import (
    ObjectPool,
    ThreadLocalPool,
    BufferPool,
    PoolStats,
    get_buffer_pool,
    reset_pools,
)

# Metrics exports
from .metrics import (
    MetricsCollector,
    TimingStats,
    CounterStats,
    TimingContext,
    HealthChecker,
    get_metrics_collector,
    reset_metrics,
    record_decode_attempt,
    record_decode_success,
    record_decode_failure,
    record_cache_hit,
    record_cache_miss,
    update_circuit_state,
)

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
    # Types and enums
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
    "CacheEntry",
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
    # Object pool
    "ObjectPool",
    "ThreadLocalPool",
    "BufferPool",
    "PoolStats",
    "get_buffer_pool",
    "reset_pools",
    # Metrics
    "MetricsCollector",
    "TimingStats",
    "CounterStats",
    "TimingContext",
    "HealthChecker",
    "get_metrics_collector",
    "reset_metrics",
    "record_decode_attempt",
    "record_decode_success",
    "record_decode_failure",
    "record_cache_hit",
    "record_cache_miss",
    "update_circuit_state",
    # Constants
    "LIBACARS_DISABLED",
    "MAX_MESSAGE_LENGTH",
    "MAX_LABEL_LENGTH",
    "MIN_LABEL_LENGTH",
]
