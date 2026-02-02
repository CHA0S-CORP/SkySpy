"""
libacars Python binding package.

This package provides Python bindings for the libacars C library, supporting:
- ACARS application decoding (FANS-1/A, CPDLC, ADS-C, MIAM, etc.)
- Message reassembly (multi-block messages)
- Sublabel/MFI extraction
- Async and batch processing
- Prometheus metrics and health monitoring
"""

from .api import (
    # Constants
    LIBACARS_DISABLED,
    BatchMessage,
    BatchResult,
    # Data Types
    DecodeResult,
    LibacarsConfig,
    LibacarsStats,
    # Context & Configuration
    ReassemblyContext,
    # Core Decoding Functions
    decode_acars_apps,
    # Async Variants
    decode_acars_apps_async,
    decode_acars_apps_text,
    decode_acars_apps_text_async,
    # Batch Processing
    decode_batch,
    decode_batch_async,
    # Metrics
    export_prometheus_metrics,
    extract_sublabel_mfi,
    get_backend,
    get_health,
    get_stats,
    # State & Management
    init_binding,
    is_available,
    reset_error_state,
    reset_stats,
    shutdown,
)
from .c_defs import MsgDir
from .cache import (
    CacheStats,
    DecodeCache,
    LabelFormatCache,
    get_decode_cache,
    get_label_cache,
    reset_caches,
)
from .circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerStats,
    CircuitState,
    ErrorCategory,
    get_circuit_breaker,
    reset_circuit_breaker,
)
from .exceptions import (
    LibacarsDecodeError,
    LibacarsDisabledError,
    LibacarsError,
    LibacarsLoadError,
    LibacarsMemoryError,
    LibacarsValidationError,
)
from .metrics import (
    CounterStats,
    HealthChecker,
    MetricsCollector,
    TimingStats,
    get_metrics_collector,
    reset_metrics,
)
from .validation import (
    MAX_LABEL_LENGTH,
    MAX_MESSAGE_LENGTH,
    MIN_LABEL_LENGTH,
    ValidationResult,
    validate_acars_message,
    validate_and_raise,
    validate_label,
    validate_text,
)

__all__ = [
    # Main API
    "decode_acars_apps",
    "decode_acars_apps_text",
    "extract_sublabel_mfi",
    "decode_acars_apps_async",
    "decode_acars_apps_text_async",
    "decode_batch",
    "decode_batch_async",
    # Enums & Classes
    "MsgDir",
    "BatchMessage",
    "BatchResult",
    "DecodeResult",
    "LibacarsStats",
    "ReassemblyContext",
    "LibacarsConfig",
    # Management
    "init_binding",
    "is_available",
    "get_backend",
    "get_stats",
    "reset_stats",
    "reset_error_state",
    "shutdown",
    "get_health",
    "export_prometheus_metrics",
    "LIBACARS_DISABLED",
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
    "MAX_MESSAGE_LENGTH",
    "MAX_LABEL_LENGTH",
    "MIN_LABEL_LENGTH",
    # Cache
    "DecodeCache",
    "LabelFormatCache",
    "CacheStats",
    "get_decode_cache",
    "get_label_cache",
    "reset_caches",
    # Circuit Breaker
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
]
