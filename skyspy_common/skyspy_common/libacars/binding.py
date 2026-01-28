"""
Python bindings for libacars library using CFFI with ctypes fallback.

libacars is a C library for decoding various ACARS message payloads including:
- FANS-1/A ADS-C (Automatic Dependent Surveillance - Contract)
- FANS-1/A CPDLC (Controller-Pilot Data Link Communications)
- MIAM (Media Independent Aircraft Messaging)
- Various airline-specific message formats

This module provides:
- CFFI-based bindings (preferred) with ctypes fallback
- Context managers for safe resource management
- LRU caching for decoded messages
- Circuit breaker pattern for error recovery
- Async support via thread pool executor
- Batch decoding for high-throughput scenarios
- Structured logging and metrics for observability
- Comprehensive error handling and classification
"""

import asyncio
import ctypes
import ctypes.util
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Callable, Generator, Optional, TypeVar

from .cache import DecodeCache, LabelFormatCache, get_decode_cache, get_label_cache
from .circuit_breaker import CircuitBreaker, CircuitState, ErrorCategory, get_circuit_breaker
from .exceptions import (
    LibacarsDecodeError,
    LibacarsDisabledError,
    LibacarsError,
    LibacarsLoadError,
    LibacarsMemoryError,
    LibacarsValidationError,
)
from .metrics import (
    MetricsCollector,
    get_metrics_collector,
    record_cache_hit,
    record_cache_miss,
    record_decode_attempt,
    record_decode_failure,
    record_decode_success,
    update_circuit_state,
)
from .validation import validate_acars_message

# Type variable for generic decode result
T = TypeVar("T")

logger = logging.getLogger(__name__)


# =============================================================================
# Configuration
# =============================================================================

# Environment configuration
LIBACARS_DISABLED = os.environ.get("LIBACARS_DISABLED", "").lower() in ("true", "1", "yes")

# Cache configuration
CACHE_ENABLED = os.environ.get("LIBACARS_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
CACHE_MAX_SIZE = int(os.environ.get("LIBACARS_CACHE_MAX_SIZE", "1000"))
CACHE_TTL = float(os.environ.get("LIBACARS_CACHE_TTL", "300"))

# Circuit breaker configuration
CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get("LIBACARS_CIRCUIT_FAILURE_THRESHOLD", "5"))
CIRCUIT_RECOVERY_TIMEOUT = float(os.environ.get("LIBACARS_CIRCUIT_RECOVERY_TIMEOUT", "60"))

# Thread pool configuration
THREAD_POOL_MIN_WORKERS = int(os.environ.get("LIBACARS_THREAD_POOL_MIN", "2"))
THREAD_POOL_MAX_WORKERS = int(os.environ.get("LIBACARS_THREAD_POOL_MAX", "0"))  # 0 = auto

# Decode timeout (seconds)
DECODE_TIMEOUT = float(os.environ.get("LIBACARS_DECODE_TIMEOUT", "5.0"))


# =============================================================================
# CFFI/ctypes setup
# =============================================================================

# Try to use CFFI, fall back to ctypes
_use_cffi = False
_ffi = None
_lib = None

try:
    from cffi import FFI
    _ffi = FFI()
    _use_cffi = True
except ImportError:
    logger.debug("CFFI not available, using ctypes fallback")
    _use_cffi = False


class MsgDir(IntEnum):
    """ACARS message direction enumeration."""

    UNKNOWN = 0
    AIR2GND = 1  # Downlink (aircraft to ground station)
    GND2AIR = 2  # Uplink (ground station to aircraft)


@dataclass
class DecodeResult:
    """Result of a decode operation with metadata."""

    success: bool
    data: Optional[dict | str] = None
    decode_time_ms: float = 0.0
    error: Optional[str] = None
    error_type: Optional[str] = None
    cached: bool = False


@dataclass
class LibacarsStats:
    """Statistics for libacars operations."""

    total_calls: int = 0
    successful: int = 0
    failed: int = 0
    skipped: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    total_decode_time_ms: float = 0.0
    consecutive_errors: int = 0

    @property
    def avg_decode_time_ms(self) -> float:
        """Calculate average decode time."""
        decode_attempts = self.total_calls - self.skipped - self.cache_hits
        return (self.total_decode_time_ms / decode_attempts) if decode_attempts > 0 else 0.0

    @property
    def success_rate(self) -> float:
        """Calculate success rate as percentage."""
        decode_attempts = self.total_calls - self.skipped
        return (self.successful / decode_attempts * 100) if decode_attempts > 0 else 0.0

    @property
    def cache_hit_rate(self) -> float:
        """Calculate cache hit rate as percentage."""
        total_cache_checks = self.cache_hits + self.cache_misses
        return (self.cache_hits / total_cache_checks * 100) if total_cache_checks > 0 else 0.0

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "total_calls": self.total_calls,
            "successful": self.successful,
            "failed": self.failed,
            "skipped": self.skipped,
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "consecutive_errors": self.consecutive_errors,
            "total_decode_time_ms": round(self.total_decode_time_ms, 2),
            "avg_decode_time_ms": round(self.avg_decode_time_ms, 2),
            "success_rate": round(self.success_rate, 2),
            "cache_hit_rate": round(self.cache_hit_rate, 2),
        }


# =============================================================================
# Global state
# =============================================================================

_libacars: Any = None
_libacars_available = False
_stats = LibacarsStats()
_stats_lock = threading.Lock()
_load_lock = threading.Lock()

# Thread pool for async operations
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()


def _get_optimal_worker_count() -> int:
    """Calculate optimal thread pool worker count."""
    if THREAD_POOL_MAX_WORKERS > 0:
        return THREAD_POOL_MAX_WORKERS
    cpu_count = os.cpu_count() or 1
    return min(32, max(THREAD_POOL_MIN_WORKERS, cpu_count + 4))


def _get_executor() -> ThreadPoolExecutor:
    """Get or create the thread pool executor with optimal sizing."""
    global _executor
    with _executor_lock:
        if _executor is None:
            workers = _get_optimal_worker_count()
            _executor = ThreadPoolExecutor(
                max_workers=workers,
                thread_name_prefix="libacars",
            )
            logger.debug(
                "thread_pool_created",
                extra={"workers": workers},
            )
        return _executor


# =============================================================================
# CFFI definitions
# =============================================================================

_CFFI_CDEF = """
    typedef struct la_proto_node la_proto_node;

    typedef struct {
        char *str;
        size_t allocated_size;
        size_t len;
    } la_vstring;

    typedef enum {
        LA_MSG_DIR_UNKNOWN = 0,
        LA_MSG_DIR_AIR2GND = 1,
        LA_MSG_DIR_GND2AIR = 2
    } la_msg_dir;

    la_proto_node* la_acars_decode_apps(const char *label, const char *txt, la_msg_dir msg_dir);
    void la_proto_tree_format_json(la_vstring *vstr, la_proto_node const *root);
    void la_proto_tree_format_text(la_vstring *vstr, la_proto_node const *root, int indent);
    void la_proto_tree_destroy(la_proto_node *root);
    la_vstring* la_vstring_new(void);
    void la_vstring_destroy(la_vstring *vstr, bool destroy_buffer);
    int la_acars_extract_sublabel_and_mfi(const char *label, la_msg_dir msg_dir,
        const char *txt, int len, char *sublabel, char *mfi);
"""


# ctypes structure definitions (fallback)
class la_proto_node(ctypes.Structure):
    """Opaque pointer type for protocol tree node."""
    pass


class la_vstring(ctypes.Structure):
    """Variable string structure from libacars."""
    _fields_ = [
        ("str", ctypes.c_char_p),
        ("allocated_size", ctypes.c_size_t),
        ("len", ctypes.c_size_t),
    ]


def _get_library_paths() -> list[str]:
    """Get list of possible library paths to try."""
    paths = [
        "libacars-2.so",
        "libacars-2.so.2",
        "/usr/local/lib/libacars-2.so",
        "/usr/local/lib/libacars-2.so.2",
        "/usr/lib/libacars-2.so",
        "/usr/lib/libacars-2.so.2",
        "/usr/lib/x86_64-linux-gnu/libacars-2.so",
        "/usr/lib/aarch64-linux-gnu/libacars-2.so",
        # macOS paths
        "/usr/local/lib/libacars-2.dylib",
        "/opt/homebrew/lib/libacars-2.dylib",
    ]

    # Try ctypes.util.find_library first
    found = ctypes.util.find_library("acars-2")
    if found:
        paths.insert(0, found)

    return paths


def _load_with_cffi(path: str) -> bool:
    """Try to load library using CFFI."""
    global _lib, _ffi
    try:
        _ffi.cdef(_CFFI_CDEF)
        _lib = _ffi.dlopen(path)
        return True
    except Exception as e:
        logger.debug(f"CFFI load failed for {path}: {e}")
        return False


def _setup_ctypes_signatures() -> None:
    """Set up ctypes function signatures for libacars."""
    global _libacars

    if not _libacars:
        return

    _libacars.la_acars_decode_apps.argtypes = [
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.c_int,
    ]
    _libacars.la_acars_decode_apps.restype = ctypes.POINTER(la_proto_node)

    _libacars.la_proto_tree_format_json.argtypes = [
        ctypes.POINTER(la_vstring),
        ctypes.POINTER(la_proto_node),
    ]
    _libacars.la_proto_tree_format_json.restype = None

    _libacars.la_proto_tree_format_text.argtypes = [
        ctypes.POINTER(la_vstring),
        ctypes.POINTER(la_proto_node),
        ctypes.c_int,
    ]
    _libacars.la_proto_tree_format_text.restype = None

    _libacars.la_proto_tree_destroy.argtypes = [ctypes.POINTER(la_proto_node)]
    _libacars.la_proto_tree_destroy.restype = None

    _libacars.la_vstring_new.argtypes = []
    _libacars.la_vstring_new.restype = ctypes.POINTER(la_vstring)

    _libacars.la_vstring_destroy.argtypes = [ctypes.POINTER(la_vstring), ctypes.c_bool]
    _libacars.la_vstring_destroy.restype = None

    _libacars.la_acars_extract_sublabel_and_mfi.argtypes = [
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_char_p,
    ]
    _libacars.la_acars_extract_sublabel_and_mfi.restype = ctypes.c_int


def _load_libacars() -> bool:
    """Try to load the libacars shared library."""
    global _libacars, _libacars_available, _use_cffi, _lib

    with _load_lock:
        if _libacars is not None or (_use_cffi and _lib is not None):
            return _libacars_available

        paths = _get_library_paths()
        tried_paths = []

        for path in paths:
            tried_paths.append(path)

            # Try CFFI first if available
            if _use_cffi and _ffi is not None:
                try:
                    if _load_with_cffi(path):
                        _libacars_available = True
                        logger.info(
                            "libacars_loaded",
                            extra={"path": path, "backend": "cffi"},
                        )
                        return True
                except Exception:
                    pass

            # Fall back to ctypes
            try:
                _libacars = ctypes.CDLL(path)
                _libacars_available = True
                _use_cffi = False
                logger.info(
                    "libacars_loaded",
                    extra={"path": path, "backend": "ctypes"},
                )
                _setup_ctypes_signatures()
                return True
            except OSError:
                continue

        logger.warning(
            "libacars_not_found",
            extra={
                "tried_paths": tried_paths,
                "info": "Advanced ACARS decoding disabled",
            },
        )
        _libacars_available = False
        return False


# =============================================================================
# Context managers for resource cleanup
# =============================================================================

@contextmanager
def _decode_context() -> Generator[tuple[Any, Callable], None, None]:
    """Context manager for decode operations with automatic resource cleanup."""
    vstr = None
    try:
        if _use_cffi and _lib is not None:
            vstr = _lib.la_vstring_new()
            if vstr == _ffi.NULL:
                raise LibacarsMemoryError("Failed to allocate vstring", operation="la_vstring_new")
            yield vstr, lambda v, n: _lib.la_proto_tree_format_json(v, n)
        else:
            vstr = _libacars.la_vstring_new()
            if not vstr:
                raise LibacarsMemoryError("Failed to allocate vstring", operation="la_vstring_new")
            yield vstr, lambda v, n: _libacars.la_proto_tree_format_json(v, n)
    finally:
        if vstr is not None:
            if _use_cffi and _lib is not None:
                if vstr != _ffi.NULL:
                    _lib.la_vstring_destroy(vstr, True)
            else:
                _libacars.la_vstring_destroy(vstr, True)


@contextmanager
def _text_decode_context() -> Generator[tuple[Any, Callable], None, None]:
    """Context manager for text decode operations with automatic resource cleanup."""
    vstr = None
    try:
        if _use_cffi and _lib is not None:
            vstr = _lib.la_vstring_new()
            if vstr == _ffi.NULL:
                raise LibacarsMemoryError("Failed to allocate vstring", operation="la_vstring_new")
            yield vstr, lambda v, n, indent=0: _lib.la_proto_tree_format_text(v, n, indent)
        else:
            vstr = _libacars.la_vstring_new()
            if not vstr:
                raise LibacarsMemoryError("Failed to allocate vstring", operation="la_vstring_new")
            yield vstr, lambda v, n, indent=0: _libacars.la_proto_tree_format_text(v, n, indent)
    finally:
        if vstr is not None:
            if _use_cffi and _lib is not None:
                if vstr != _ffi.NULL:
                    _lib.la_vstring_destroy(vstr, True)
            else:
                _libacars.la_vstring_destroy(vstr, True)


# =============================================================================
# Stats recording with metrics integration
# =============================================================================

def _record_success(elapsed_ms: float) -> None:
    """Record a successful decode operation."""
    with _stats_lock:
        _stats.successful += 1
        _stats.total_decode_time_ms += elapsed_ms
        _stats.consecutive_errors = 0

    record_decode_success(elapsed_ms)
    get_circuit_breaker().record_success()


def _record_failure(elapsed_ms: float, error: Exception) -> None:
    """Record a failed decode operation."""
    with _stats_lock:
        _stats.failed += 1
        _stats.total_decode_time_ms += elapsed_ms
        _stats.consecutive_errors += 1

    category = ErrorCategory.from_exception(error)
    record_decode_failure(category.value)

    breaker = get_circuit_breaker()
    breaker.record_failure(error, category)
    update_circuit_state(breaker.state.name.lower())


def _record_skip() -> None:
    """Record a skipped decode operation."""
    with _stats_lock:
        _stats.skipped += 1


def _record_cache_hit() -> None:
    """Record a cache hit."""
    with _stats_lock:
        _stats.cache_hits += 1
        _stats.successful += 1
    record_cache_hit()


def _record_cache_miss() -> None:
    """Record a cache miss."""
    with _stats_lock:
        _stats.cache_misses += 1
    record_cache_miss()


# =============================================================================
# Public API
# =============================================================================

def is_available() -> bool:
    """Check if libacars is available and enabled."""
    if LIBACARS_DISABLED:
        return False

    breaker = get_circuit_breaker()
    if breaker.state == CircuitState.OPEN and not breaker.can_execute():
        return False

    return _load_libacars()


def get_backend() -> str:
    """Get the current backend being used."""
    if not is_available():
        return "unavailable"
    return "cffi" if _use_cffi else "ctypes"


def decode_acars_apps(
    label: str,
    text: str,
    direction: MsgDir = MsgDir.UNKNOWN,
    *,
    raise_on_error: bool = False,
    use_cache: bool = True,
    timeout: Optional[float] = None,
) -> Optional[dict]:
    """
    Decode ACARS application-layer message content.

    This function uses libacars to decode complex message formats that cannot
    be decoded with simple regex patterns.

    Args:
        label: ACARS message label (e.g., "H1", "SA", etc.)
        text: Message text content to decode
        direction: Message direction (air-to-ground or ground-to-air)
        raise_on_error: If True, raise exceptions instead of returning None
        use_cache: If True, check cache before decoding
        timeout: Decode timeout in seconds (None = use default)

    Returns:
        Decoded message as a dict, or None if decoding failed
    """
    with _stats_lock:
        _stats.total_calls += 1

    record_decode_attempt()
    metrics = get_metrics_collector()

    # Check if disabled
    if LIBACARS_DISABLED:
        _record_skip()
        if raise_on_error:
            raise LibacarsDisabledError(reason="environment_variable")
        return None

    # Check circuit breaker
    breaker = get_circuit_breaker()
    if not breaker.can_execute():
        _record_skip()
        update_circuit_state(breaker.state.name.lower())
        if raise_on_error:
            raise LibacarsDisabledError(
                reason="circuit_open",
                consecutive_errors=breaker._consecutive_failures,
            )
        return None

    if not _load_libacars():
        _record_skip()
        if raise_on_error:
            raise LibacarsLoadError(tried_paths=_get_library_paths())
        return None

    # Validate input
    validation = validate_acars_message(label, text)
    if not validation.is_valid:
        _record_skip()
        if raise_on_error:
            raise LibacarsValidationError(
                message=validation.error_message or "Validation failed",
                field=validation.field,
                value=label if validation.field == "label" else text,
            )
        return None

    # Check cache
    if use_cache and CACHE_ENABLED:
        cache = get_decode_cache(maxsize=CACHE_MAX_SIZE, ttl=CACHE_TTL)
        cached_result = cache.get(label, text, int(direction))
        if cached_result is not None:
            _record_cache_hit()
            return cached_result
        _record_cache_miss()

    # Check label format cache for known unsupported labels
    label_cache = get_label_cache()
    is_supported = label_cache.is_supported(label)
    if is_supported is False:
        _record_skip()
        return None

    start_time = time.perf_counter()
    node = None

    with metrics.time_operation("decode"):
        try:
            label_bytes = label.encode("utf-8")
            text_bytes = text.encode("utf-8")

            # Decode the message
            if _use_cffi and _lib is not None:
                node = _lib.la_acars_decode_apps(label_bytes, text_bytes, int(direction))
                is_null = node == _ffi.NULL
            else:
                node = _libacars.la_acars_decode_apps(label_bytes, text_bytes, int(direction))
                is_null = not node

            if is_null:
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                with _stats_lock:
                    _stats.total_decode_time_ms += elapsed_ms
                breaker.record_success()  # Null return is not an error

                # Mark label as potentially unsupported if we haven't seen success
                if is_supported is None:
                    label_cache.mark_unsupported(label)

                return None

            try:
                with _decode_context() as (vstr, format_func):
                    format_func(vstr, node)

                    # Extract the JSON string
                    if _use_cffi and _lib is not None:
                        json_str = _ffi.string(vstr.str).decode("utf-8") if vstr.str != _ffi.NULL else None
                    else:
                        json_str = vstr.contents.str.decode("utf-8") if vstr.contents.str else None

                    if json_str:
                        decoded = json.loads(json_str)
                        elapsed_ms = (time.perf_counter() - start_time) * 1000
                        _record_success(elapsed_ms)

                        # Mark label as supported
                        label_cache.mark_supported(label, "acars")

                        # Cache the result
                        if use_cache and CACHE_ENABLED:
                            cache = get_decode_cache()
                            cache.set(label, text, int(direction), decoded)

                        logger.debug(
                            "libacars_decode_success",
                            extra={
                                "label": label,
                                "direction": direction.name,
                                "decode_time_ms": round(elapsed_ms, 2),
                            },
                        )
                        return decoded

                    return None
            finally:
                # Clean up the protocol tree node
                if _use_cffi and _lib is not None:
                    if node != _ffi.NULL:
                        _lib.la_proto_tree_destroy(node)
                else:
                    if node:
                        _libacars.la_proto_tree_destroy(node)

        except json.JSONDecodeError as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            _record_failure(elapsed_ms, e)

            if raise_on_error:
                raise LibacarsDecodeError(
                    message=f"JSON decode error: {e}",
                    label=label,
                    text_length=len(text),
                    direction=direction.name,
                    original_error=e,
                )
            return None

        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            _record_failure(elapsed_ms, e)

            logger.warning(
                "libacars_decode_error",
                extra={
                    "label": label,
                    "direction": direction.name,
                    "error": str(e),
                    "error_type": type(e).__name__,
                },
            )

            if raise_on_error:
                raise LibacarsDecodeError(
                    message=f"Decode error: {e}",
                    label=label,
                    text_length=len(text),
                    direction=direction.name,
                    original_error=e,
                )
            return None


def decode_acars_apps_text(
    label: str,
    text: str,
    direction: MsgDir = MsgDir.UNKNOWN,
    *,
    raise_on_error: bool = False,
    timeout: Optional[float] = None,
) -> Optional[str]:
    """
    Decode ACARS application-layer message and return as formatted text.

    Args:
        label: ACARS message label
        text: Message text content to decode
        direction: Message direction
        raise_on_error: If True, raise exceptions instead of returning None
        timeout: Decode timeout in seconds

    Returns:
        Formatted text string, or None if decoding failed
    """
    with _stats_lock:
        _stats.total_calls += 1

    record_decode_attempt()

    # Check if disabled
    if LIBACARS_DISABLED:
        _record_skip()
        if raise_on_error:
            raise LibacarsDisabledError(reason="environment_variable")
        return None

    # Check circuit breaker
    breaker = get_circuit_breaker()
    if not breaker.can_execute():
        _record_skip()
        if raise_on_error:
            raise LibacarsDisabledError(reason="circuit_open")
        return None

    if not _load_libacars():
        _record_skip()
        if raise_on_error:
            raise LibacarsLoadError(tried_paths=_get_library_paths())
        return None

    # Validate input
    validation = validate_acars_message(label, text)
    if not validation.is_valid:
        _record_skip()
        if raise_on_error:
            raise LibacarsValidationError(
                message=validation.error_message or "Validation failed",
                field=validation.field,
            )
        return None

    start_time = time.perf_counter()
    node = None

    try:
        label_bytes = label.encode("utf-8")
        text_bytes = text.encode("utf-8")

        # Decode the message
        if _use_cffi and _lib is not None:
            node = _lib.la_acars_decode_apps(label_bytes, text_bytes, int(direction))
            is_null = node == _ffi.NULL
        else:
            node = _libacars.la_acars_decode_apps(label_bytes, text_bytes, int(direction))
            is_null = not node

        if is_null:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            with _stats_lock:
                _stats.total_decode_time_ms += elapsed_ms
            breaker.record_success()
            return None

        try:
            with _text_decode_context() as (vstr, format_func):
                format_func(vstr, node, 0)

                # Extract the text string
                if _use_cffi and _lib is not None:
                    text_result = _ffi.string(vstr.str).decode("utf-8") if vstr.str != _ffi.NULL else None
                else:
                    text_result = vstr.contents.str.decode("utf-8") if vstr.contents.str else None

                if text_result:
                    elapsed_ms = (time.perf_counter() - start_time) * 1000
                    _record_success(elapsed_ms)
                    return text_result

                return None
        finally:
            if _use_cffi and _lib is not None:
                if node != _ffi.NULL:
                    _lib.la_proto_tree_destroy(node)
            else:
                if node:
                    _libacars.la_proto_tree_destroy(node)

    except Exception as e:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        _record_failure(elapsed_ms, e)

        if raise_on_error:
            raise LibacarsDecodeError(
                message=f"Text decode error: {e}",
                label=label,
                text_length=len(text),
                direction=direction.name,
                original_error=e,
            )
        return None


def extract_sublabel_mfi(
    label: str,
    text: str,
    direction: MsgDir = MsgDir.UNKNOWN,
) -> tuple[Optional[str], Optional[str], int]:
    """
    Extract sublabel and MFI from H1 messages.

    Args:
        label: ACARS message label
        text: Message text content
        direction: Message direction

    Returns:
        Tuple of (sublabel, mfi, bytes_consumed) or (None, None, 0) if extraction failed
    """
    if not _load_libacars():
        return None, None, 0

    if not label or not text:
        return None, None, 0

    try:
        label_bytes = label.encode("utf-8")
        text_bytes = text.encode("utf-8")

        if _use_cffi and _lib is not None:
            sublabel = _ffi.new("char[3]")
            mfi = _ffi.new("char[3]")
            consumed = _lib.la_acars_extract_sublabel_and_mfi(
                label_bytes,
                int(direction),
                text_bytes,
                len(text_bytes),
                sublabel,
                mfi,
            )

            if consumed > 0:
                result_sublabel = _ffi.string(sublabel).decode("utf-8") if sublabel[0] != b"\x00" else None
                result_mfi = _ffi.string(mfi).decode("utf-8") if mfi[0] != b"\x00" else None
                return (result_sublabel, result_mfi, consumed)
        else:
            sublabel = ctypes.create_string_buffer(3)
            mfi = ctypes.create_string_buffer(3)

            consumed = _libacars.la_acars_extract_sublabel_and_mfi(
                label_bytes,
                int(direction),
                text_bytes,
                len(text_bytes),
                sublabel,
                mfi,
            )

            if consumed > 0:
                result_sublabel = sublabel.value.decode("utf-8") if sublabel.value else None
                result_mfi = mfi.value.decode("utf-8") if mfi.value else None
                return (result_sublabel, result_mfi, consumed)

        return None, None, 0

    except Exception as e:
        logger.debug("libacars_extract_error", extra={"label": label, "error": str(e)})
        return None, None, 0


# =============================================================================
# Async support
# =============================================================================

async def decode_acars_apps_async(
    label: str,
    text: str,
    direction: MsgDir = MsgDir.UNKNOWN,
    *,
    raise_on_error: bool = False,
    use_cache: bool = True,
    timeout: Optional[float] = None,
) -> Optional[dict]:
    """
    Async version of decode_acars_apps.

    Offloads the decode operation to a thread pool to avoid blocking
    the event loop for high-throughput scenarios.
    """
    effective_timeout = timeout if timeout is not None else DECODE_TIMEOUT
    loop = asyncio.get_event_loop()

    try:
        return await asyncio.wait_for(
            loop.run_in_executor(
                _get_executor(),
                lambda: decode_acars_apps(
                    label, text, direction,
                    raise_on_error=raise_on_error,
                    use_cache=use_cache,
                ),
            ),
            timeout=effective_timeout,
        )
    except asyncio.TimeoutError:
        if raise_on_error:
            raise LibacarsDecodeError(
                message=f"Decode timed out after {effective_timeout}s",
                label=label,
                text_length=len(text),
                direction=direction.name,
            )
        return None


async def decode_acars_apps_text_async(
    label: str,
    text: str,
    direction: MsgDir = MsgDir.UNKNOWN,
    *,
    raise_on_error: bool = False,
    timeout: Optional[float] = None,
) -> Optional[str]:
    """Async version of decode_acars_apps_text."""
    effective_timeout = timeout if timeout is not None else DECODE_TIMEOUT
    loop = asyncio.get_event_loop()

    try:
        return await asyncio.wait_for(
            loop.run_in_executor(
                _get_executor(),
                lambda: decode_acars_apps_text(
                    label, text, direction,
                    raise_on_error=raise_on_error,
                ),
            ),
            timeout=effective_timeout,
        )
    except asyncio.TimeoutError:
        if raise_on_error:
            raise LibacarsDecodeError(
                message=f"Decode timed out after {effective_timeout}s",
                label=label,
                text_length=len(text),
                direction=direction.name,
            )
        return None


# =============================================================================
# Batch decoding
# =============================================================================

@dataclass
class BatchMessage:
    """Input for batch decoding."""

    label: str
    text: str
    direction: MsgDir = MsgDir.UNKNOWN
    id: Optional[str] = None


@dataclass
class BatchResult:
    """Result of batch decoding."""

    id: Optional[str]
    success: bool
    data: Optional[dict | str] = None
    error: Optional[str] = None
    cached: bool = False
    decode_time_ms: float = 0.0


def decode_batch(
    messages: list[BatchMessage],
    *,
    output_format: str = "json",
    use_cache: bool = True,
) -> list[BatchResult]:
    """
    Decode multiple messages in a batch.

    Args:
        messages: List of messages to decode
        output_format: "json" or "text"
        use_cache: Whether to use caching

    Returns:
        List of BatchResult objects in the same order as input
    """
    results = []
    decode_func = decode_acars_apps if output_format == "json" else decode_acars_apps_text

    for msg in messages:
        start_time = time.perf_counter()
        try:
            # Check cache first for json format
            cached = False
            if output_format == "json" and use_cache and CACHE_ENABLED:
                cache = get_decode_cache()
                cached_result = cache.get(msg.label, msg.text, int(msg.direction))
                if cached_result is not None:
                    elapsed_ms = (time.perf_counter() - start_time) * 1000
                    results.append(BatchResult(
                        id=msg.id,
                        success=True,
                        data=cached_result,
                        cached=True,
                        decode_time_ms=elapsed_ms,
                    ))
                    continue

            data = decode_func(msg.label, msg.text, msg.direction, use_cache=use_cache)
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            results.append(BatchResult(
                id=msg.id,
                success=data is not None,
                data=data,
                cached=False,
                decode_time_ms=elapsed_ms,
            ))
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            results.append(BatchResult(
                id=msg.id,
                success=False,
                error=str(e),
                decode_time_ms=elapsed_ms,
            ))

    return results


async def decode_batch_async(
    messages: list[BatchMessage],
    *,
    output_format: str = "json",
    max_concurrency: int = 4,
    use_cache: bool = True,
) -> list[BatchResult]:
    """
    Async batch decoding with concurrency control.

    Args:
        messages: List of messages to decode
        output_format: "json" or "text"
        max_concurrency: Maximum concurrent decode operations
        use_cache: Whether to use caching

    Returns:
        List of BatchResult objects in the same order as input
    """
    semaphore = asyncio.Semaphore(max_concurrency)
    decode_func = decode_acars_apps_async if output_format == "json" else decode_acars_apps_text_async

    async def decode_one(msg: BatchMessage) -> BatchResult:
        async with semaphore:
            start_time = time.perf_counter()
            try:
                data = await decode_func(msg.label, msg.text, msg.direction, use_cache=use_cache)
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                return BatchResult(
                    id=msg.id,
                    success=data is not None,
                    data=data,
                    decode_time_ms=elapsed_ms,
                )
            except Exception as e:
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                return BatchResult(
                    id=msg.id,
                    success=False,
                    error=str(e),
                    decode_time_ms=elapsed_ms,
                )

    tasks = [decode_one(msg) for msg in messages]
    return await asyncio.gather(*tasks)


# =============================================================================
# State management
# =============================================================================

def reset_error_state() -> None:
    """Reset the error tracking state to re-enable libacars."""
    with _stats_lock:
        _stats.consecutive_errors = 0

    breaker = get_circuit_breaker()
    breaker.reset()
    update_circuit_state("closed")

    logger.info("libacars_error_state_reset", extra={"info": "Library re-enabled"})


def get_stats() -> dict:
    """Get libacars performance and usage statistics."""
    with _stats_lock:
        stats_copy = LibacarsStats(
            total_calls=_stats.total_calls,
            successful=_stats.successful,
            failed=_stats.failed,
            skipped=_stats.skipped,
            cache_hits=_stats.cache_hits,
            cache_misses=_stats.cache_misses,
            total_decode_time_ms=_stats.total_decode_time_ms,
            consecutive_errors=_stats.consecutive_errors,
        )

    breaker = get_circuit_breaker()
    cache = get_decode_cache() if CACHE_ENABLED else None

    return {
        "available": _libacars_available,
        "disabled_env": LIBACARS_DISABLED,
        "backend": get_backend(),
        "circuit_state": breaker.state.name.lower(),
        "cache_enabled": CACHE_ENABLED,
        "cache_size": cache.size if cache else 0,
        **stats_copy.to_dict(),
        "circuit_breaker": breaker.get_stats(),
        "cache": cache.get_stats() if cache else {},
    }


def reset_stats() -> None:
    """Reset all performance statistics counters."""
    global _stats

    with _stats_lock:
        _stats = LibacarsStats()

    # Reset cache stats
    if CACHE_ENABLED:
        cache = get_decode_cache()
        cache.reset_stats()

    # Reset metrics
    from .metrics import reset_metrics
    reset_metrics()

    logger.info("libacars_stats_reset")


def shutdown() -> None:
    """Clean up resources (thread pool, caches, etc.)."""
    global _executor

    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=True)
            _executor = None

    # Clear caches
    from .cache import reset_caches
    reset_caches()

    # Reset circuit breaker
    from .circuit_breaker import reset_circuit_breaker
    reset_circuit_breaker()

    logger.info("libacars_shutdown")


def get_health() -> dict:
    """
    Get health status of the libacars binding.

    Returns:
        Dictionary with health status and details
    """
    breaker = get_circuit_breaker()

    is_healthy = (
        _libacars_available
        and not LIBACARS_DISABLED
        and breaker.state != CircuitState.OPEN
    )

    issues = []
    if LIBACARS_DISABLED:
        issues.append("Disabled via environment variable")
    if not _libacars_available:
        issues.append("Library not loaded")
    if breaker.state == CircuitState.OPEN:
        issues.append(f"Circuit breaker open: {breaker.get_failure_analysis()['likely_cause']}")

    return {
        "healthy": is_healthy,
        "available": _libacars_available,
        "disabled": LIBACARS_DISABLED,
        "circuit_state": breaker.state.name.lower(),
        "issues": issues,
        "backend": get_backend(),
    }


def export_prometheus_metrics() -> str:
    """Export all metrics in Prometheus format."""
    metrics = get_metrics_collector()

    # Update gauges with current state
    breaker = get_circuit_breaker()
    state_values = {"closed": 0, "half_open": 1, "open": 2}
    metrics.set_gauge("circuit_state", state_values.get(breaker.state.name.lower(), -1))
    metrics.set_gauge("available", 1 if _libacars_available else 0)

    if CACHE_ENABLED:
        cache = get_decode_cache()
        metrics.set_gauge("cache_size", cache.size)

    return metrics.export_prometheus()
