"""
High-level Python API for libacars.
"""
import asyncio
import ctypes
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass, fields
from typing import Optional, Union, Any, List

import weakref

from .core import load_libacars, get_lib, vstring_context
from .c_defs import MsgDir, timeval
from .exceptions import (
    LibacarsDecodeError, LibacarsDisabledError, LibacarsValidationError, LibacarsLoadError
)
from .validation import validate_acars_message, validate_label, validate_text
from .metrics import (
    get_metrics_collector, 
    record_decode_success, 
    record_decode_failure, 
    record_decode_attempt,
    record_cache_hit,
    record_cache_miss,
    update_circuit_state
)
from .cache import get_decode_cache, get_label_cache
from .circuit_breaker import get_circuit_breaker, CircuitState, ErrorCategory

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration & Constants
# =============================================================================

LIBACARS_DISABLED = os.environ.get("LIBACARS_DISABLED", "").lower() in ("true", "1", "yes")
CACHE_ENABLED = os.environ.get("LIBACARS_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
CACHE_MAX_SIZE = int(os.environ.get("LIBACARS_CACHE_MAX_SIZE", "1000"))
CACHE_TTL = float(os.environ.get("LIBACARS_CACHE_TTL", "300"))
DECODE_TIMEOUT = float(os.environ.get("LIBACARS_DECODE_TIMEOUT", "5.0"))
THREAD_POOL_MIN_WORKERS = int(os.environ.get("LIBACARS_THREAD_POOL_MIN", "2"))
THREAD_POOL_MAX_WORKERS = int(os.environ.get("LIBACARS_THREAD_POOL_MAX", "0"))

# =============================================================================
# State & Stats
# =============================================================================

@dataclass
class LibacarsStats:
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
        attempts = self.total_calls - self.skipped - self.cache_hits
        return (self.total_decode_time_ms / attempts) if attempts > 0 else 0.0

    @property
    def success_rate(self) -> float:
        attempts = self.total_calls - self.skipped
        return (self.successful / attempts * 100) if attempts > 0 else 0.0

    @property
    def cache_hit_rate(self) -> float:
        total = self.cache_hits + self.cache_misses
        return (self.cache_hits / total * 100) if total > 0 else 0.0

    def to_dict(self) -> dict:
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

# Initial global stats object
_stats = LibacarsStats()
_stats_lock = threading.Lock()
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()

def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            max_w = THREAD_POOL_MAX_WORKERS if THREAD_POOL_MAX_WORKERS > 0 else (os.cpu_count() or 1) + 4
            _executor = ThreadPoolExecutor(
                max_workers=min(32, max(THREAD_POOL_MIN_WORKERS, max_w)), 
                thread_name_prefix="libacars"
            )
        return _executor

def _record_op(success: bool, elapsed_ms: float = 0.0, error: Exception = None, cached: bool = False):
    """Record a decode operation result with proper locking."""
    with _stats_lock:
        if cached:
            _stats.successful += 1
            _stats.cache_hits += 1
            _stats.consecutive_errors = 0
        elif success:
            _stats.successful += 1
            _stats.total_decode_time_ms += elapsed_ms
            _stats.consecutive_errors = 0
        else:
            _stats.failed += 1
            _stats.total_decode_time_ms += elapsed_ms
            _stats.consecutive_errors += 1

    if cached:
        record_cache_hit()
        get_circuit_breaker().record_success()
    elif success:
        record_decode_success(elapsed_ms)
        get_circuit_breaker().record_success()
    else:
        cat = ErrorCategory.from_exception(error) if error else ErrorCategory.UNKNOWN
        record_decode_failure(cat.value)
        breaker = get_circuit_breaker()
        breaker.record_failure(error, cat)
        update_circuit_state(breaker.state.name.lower())


def _record_skip():
    """Record a skipped decode operation."""
    with _stats_lock:
        _stats.skipped += 1

# =============================================================================
# Public Classes
# =============================================================================

@dataclass
class DecodeResult:
    success: bool
    data: Optional[Union[dict, str]] = None
    decode_time_ms: float = 0.0
    error: Optional[str] = None
    cached: bool = False

@dataclass
class BatchMessage:
    label: str
    text: str
    direction: MsgDir = MsgDir.UNKNOWN
    id: Optional[str] = None
    reg: Optional[str] = None
    timestamp: Optional[float] = None

@dataclass
class BatchResult:
    id: Optional[str]
    success: bool
    data: Optional[Union[dict, str]] = None
    error: Optional[str] = None
    cached: bool = False
    decode_time_ms: float = 0.0

class ReassemblyContext:
    """Context for reassembling multi-part ACARS messages."""

    # Class-level weak set to track instances for cleanup
    _instances: weakref.WeakSet = weakref.WeakSet()

    def __init__(self):
        lib, _, _ = get_lib()
        if not lib:
            raise LibacarsDisabledError("libacars not available")
        self._ptr = lib.la_reasm_ctx_new()
        # Store reference to lib to avoid relying on get_lib() in __del__
        self._lib = lib
        self._destroyed = False
        ReassemblyContext._instances.add(self)

    def destroy(self) -> None:
        """Explicitly destroy the reassembly context."""
        if not self._destroyed and self._lib and self._ptr:
            try:
                self._lib.la_reasm_ctx_destroy(self._ptr)
            except Exception:
                pass  # Ignore errors during cleanup
            self._destroyed = True
            self._ptr = None

    def __del__(self):
        self.destroy()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.destroy()
        return False

class LibacarsConfig:
    """Configuration interface for libacars library settings."""

    @staticmethod
    def set(name: str, value: Union[bool, int, str]) -> bool:
        """
        Set a libacars configuration option.

        Args:
            name: Configuration option name
            value: Configuration value (bool, int, or str)

        Returns:
            True if configuration was set successfully, False otherwise
        """
        lib, _, _ = get_lib()
        if not lib:
            return False
        try:
            c_name = name.encode('utf-8')
            if isinstance(value, bool):
                return bool(lib.la_config_set_bool(c_name, value))
            elif isinstance(value, int):
                return bool(lib.la_config_set_int(c_name, value))
            elif isinstance(value, str):
                return bool(lib.la_config_set_str(c_name, value.encode('utf-8')))
            return False
        except Exception as e:
            logger.debug(f"Failed to set config {name}: {e}")
            return False

# =============================================================================
# Core Decoding
# =============================================================================

def decode_acars_apps(
    label: str,
    text: str,
    direction: MsgDir = MsgDir.UNKNOWN,
    *,
    reg: Optional[str] = None,
    reassembly_ctx: Optional[ReassemblyContext] = None,
    timestamp: Optional[float] = None,
    use_cache: bool = True,
    raise_on_error: bool = False,
    timeout: Optional[float] = None
) -> Optional[dict]:
    """
    Decode ACARS application-layer message content.

    Args:
        label: ACARS message label (e.g., "H1", "SA")
        text: Message text content to decode
        direction: Message direction (air-to-ground or ground-to-air)
        reg: Aircraft registration (for reassembly)
        reassembly_ctx: Context for multi-part message reassembly
        timestamp: Message timestamp (for reassembly)
        use_cache: Whether to use decode cache
        raise_on_error: If True, raise exceptions instead of returning None
        timeout: Decode timeout in seconds (unused, for API compatibility)

    Returns:
        Decoded message as a dict, or None if decoding failed
    """
    with _stats_lock:
        _stats.total_calls += 1
    record_decode_attempt()

    if LIBACARS_DISABLED:
        _record_skip()
        if raise_on_error:
            raise LibacarsDisabledError("Disabled via env")
        return None

    breaker = get_circuit_breaker()
    if not breaker.can_execute():
        _record_skip()
        if raise_on_error:
            raise LibacarsDisabledError(
                reason="circuit_open", consecutive_errors=breaker._consecutive_failures
            )
        return None

    # Check cache before validation (cached results were already validated)
    if use_cache and CACHE_ENABLED and not reassembly_ctx:
        cache = get_decode_cache(maxsize=CACHE_MAX_SIZE, ttl=CACHE_TTL)
        cached_result = cache.get(label, text, int(direction))
        if cached_result is not None:
            _record_op(success=True, cached=True)
            return cached_result
        with _stats_lock:
            _stats.cache_misses += 1
        record_cache_miss()

    validation = validate_acars_message(label, text)
    if not validation.is_valid:
        _record_skip()
        if raise_on_error:
            raise LibacarsValidationError(
                message=validation.error_message or "Validation failed",
                field=validation.field,
                value=text
            )
        return None

    if get_label_cache().is_supported(label) is False:
        _record_skip()
        return None

    lib, ffi, backend = get_lib()
    if not lib:
        _record_skip()
        if raise_on_error:
            raise LibacarsLoadError("Library load failed")
        return None
    
    start_t = time.perf_counter()
    try:
        label_b = label.encode("utf-8")
        text_b = text.encode("utf-8")
        reg_b = reg.encode("utf-8") if reg else None
        
        node = None
        
        if reassembly_ctx and reg_b and timestamp:
            tv_sec = int(timestamp)
            tv_usec = int((timestamp - tv_sec) * 1_000_000)
            if backend == "cffi":
                rx_time = ffi.new("timeval *", [tv_sec, tv_usec])[0]
                node = lib.la_acars_apps_parse_and_reassemble(reg_b, label_b, text_b, int(direction), reassembly_ctx._ptr, rx_time)
            else:
                rx_time = timeval(tv_sec, tv_usec)
                node = lib.la_acars_apps_parse_and_reassemble(reg_b, label_b, text_b, int(direction), reassembly_ctx._ptr, rx_time)
        else:
            node = lib.la_acars_decode_apps(label_b, text_b, int(direction))

        if not node or (backend == "cffi" and node == ffi.NULL):
            _record_op(True, (time.perf_counter() - start_t)*1000)
            if not reassembly_ctx: get_label_cache().mark_unsupported(label)
            return None

        try:
            with vstring_context() as (vstr, be):
                lib.la_proto_tree_format_json(vstr, node)
                raw_json = None
                if be == "cffi":
                    if vstr.str != ffi.NULL: raw_json = ffi.string(vstr.str).decode('utf-8')
                else:
                    if vstr.contents.str: raw_json = vstr.contents.str.decode('utf-8')

                if raw_json:
                    result = json.loads(raw_json)
                    _record_op(True, (time.perf_counter() - start_t)*1000)
                    get_label_cache().mark_supported(label, "acars")
                    if use_cache and not reassembly_ctx:
                        get_decode_cache().set(label, text, int(direction), result)
                    return result
                return None
        finally:
            lib.la_proto_tree_destroy(node)

    except Exception as e:
        _record_op(False, (time.perf_counter() - start_t)*1000, e)
        logger.warning(f"libacars decode error: {e}")
        if raise_on_error: 
            raise LibacarsDecodeError(
                message=str(e), label=label, direction=direction.name, original_error=e
            )
        return None

def decode_acars_apps_text(
    label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN,
    *, raise_on_error: bool = False, timeout: Optional[float] = None
) -> Optional[str]:
    """
    Decode ACARS application-layer message and return as formatted text.

    Args:
        label: ACARS message label
        text: Message text content to decode
        direction: Message direction
        raise_on_error: If True, raise exceptions instead of returning None
        timeout: Decode timeout (unused, for API compatibility)

    Returns:
        Formatted text string, or None if decoding failed
    """
    with _stats_lock:
        _stats.total_calls += 1

    if LIBACARS_DISABLED:
        _record_skip()
        if raise_on_error:
            raise LibacarsDisabledError("Disabled via env")
        return None

    validation = validate_acars_message(label, text)
    if not validation.is_valid:
        _record_skip()
        if raise_on_error:
            raise LibacarsValidationError(
                message=validation.error_message or "Validation failed",
                field=validation.field,
                value=text
            )
        return None

    lib, ffi, backend = get_lib()
    if not lib:
        _record_skip()
        if raise_on_error:
            raise LibacarsLoadError("Library load failed")
        return None

    start_t = time.perf_counter()
    try:
        node = lib.la_acars_decode_apps(label.encode("utf-8"), text.encode("utf-8"), int(direction))
        if not node or (backend == "cffi" and node == ffi.NULL):
            return None

        try:
            with vstring_context() as (vstr, be):
                lib.la_proto_tree_format_text(vstr, node)
                res = None
                if be == "cffi":
                    if vstr.str != ffi.NULL: res = ffi.string(vstr.str).decode('utf-8')
                else:
                    if vstr.contents.str: res = vstr.contents.str.decode('utf-8')
                
                if res: _record_op(True, (time.perf_counter() - start_t)*1000)
                return res
        finally:
            lib.la_proto_tree_destroy(node)
    except Exception as e:
        _record_op(False, (time.perf_counter() - start_t)*1000, e)
        if raise_on_error: raise e
        return None

def extract_sublabel_mfi(label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN) -> tuple[Optional[str], Optional[str], int]:
    """
    Extract sublabel and MFI from ACARS messages.

    Returns:
        Tuple of (sublabel, mfi, bytes_consumed) or (None, None, 0) if extraction failed
    """
    lib, ffi, backend = get_lib()
    if not lib or not label or not text:
        return None, None, 0

    # Validate inputs
    label_result = validate_label(label)
    text_result = validate_text(text)
    if not label_result.is_valid or not text_result.is_valid:
        return None, None, 0

    try:
        l_b = label.encode("utf-8")
        t_b = text.encode("utf-8")

        if backend == "cffi":
            sub = ffi.new("char[4]")
            mfi = ffi.new("char[4]")
            ret = lib.la_acars_extract_sublabel_and_mfi(l_b, int(direction), t_b, len(t_b), sub, mfi)
            # CFFI: sub[0] is an integer (byte value), compare to 0 not b'\0'
            s_str = ffi.string(sub).decode('utf-8') if sub[0] != 0 else None
            m_str = ffi.string(mfi).decode('utf-8') if mfi[0] != 0 else None
            return s_str, m_str, ret
        else:
            sub = ctypes.create_string_buffer(4)
            mfi = ctypes.create_string_buffer(4)
            ret = lib.la_acars_extract_sublabel_and_mfi(l_b, int(direction), t_b, len(t_b), sub, mfi)
            s_str = sub.value.decode('utf-8') if sub.value else None
            m_str = mfi.value.decode('utf-8') if mfi.value else None
            return s_str, m_str, ret
    except Exception:
        return None, None, 0

async def decode_acars_apps_async(
    label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN,
    timeout: Optional[float] = None, **kwargs
) -> Optional[dict]:
    """Async version of decode_acars_apps using thread pool executor."""
    eff_timeout = timeout if timeout is not None else DECODE_TIMEOUT
    loop = asyncio.get_running_loop()

    try:
        return await asyncio.wait_for(
            loop.run_in_executor(
                _get_executor(),
                lambda: decode_acars_apps(label, text, direction, **kwargs)
            ),
            timeout=eff_timeout
        )
    except asyncio.TimeoutError:
        if kwargs.get('raise_on_error'):
            raise LibacarsDecodeError(
                message=f"Timed out after {eff_timeout}s",
                label=label,
                text_length=len(text),
                direction=direction.name,
            )
        return None


async def decode_acars_apps_text_async(
    label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN,
    timeout: Optional[float] = None, **kwargs
) -> Optional[str]:
    """Async version of decode_acars_apps_text using thread pool executor."""
    eff_timeout = timeout if timeout is not None else DECODE_TIMEOUT
    loop = asyncio.get_running_loop()

    try:
        return await asyncio.wait_for(
            loop.run_in_executor(
                _get_executor(),
                lambda: decode_acars_apps_text(label, text, direction, **kwargs)
            ),
            timeout=eff_timeout
        )
    except asyncio.TimeoutError:
        if kwargs.get('raise_on_error'):
            raise LibacarsDecodeError(
                message=f"Timed out after {eff_timeout}s",
                label=label,
                text_length=len(text),
                direction=direction.name,
            )
        return None

def decode_batch(
    messages: List[BatchMessage], output_format: str = "json", use_cache: bool = True
) -> List[BatchResult]:
    results = []
    func = decode_acars_apps if output_format == "json" else decode_acars_apps_text
    
    for msg in messages:
        start = time.perf_counter()
        try:
            cached = False
            data = None
            
            if output_format == "json" and use_cache and CACHE_ENABLED and not (msg.reg and msg.timestamp):
                cache = get_decode_cache()
                data = cache.get(msg.label, msg.text, int(msg.direction))
                if data: cached = True

            if not data:
                kwargs = {}
                if output_format == "json":
                    kwargs = {"reg": msg.reg, "timestamp": msg.timestamp, "use_cache": use_cache}
                data = func(msg.label, msg.text, msg.direction, **kwargs)

            results.append(BatchResult(
                id=msg.id, success=data is not None, data=data, 
                cached=cached, decode_time_ms=(time.perf_counter()-start)*1000
            ))
        except Exception as e:
            results.append(BatchResult(
                id=msg.id, success=False, error=str(e), 
                decode_time_ms=(time.perf_counter()-start)*1000
            ))
    return results

async def decode_batch_async(
    messages: List[BatchMessage], output_format: str = "json", max_concurrency: int = 4
) -> List[BatchResult]:
    sem = asyncio.Semaphore(max_concurrency)
    
    async def _process(msg):
        async with sem:
            start = time.perf_counter()
            try:
                if output_format == "json":
                    data = await decode_acars_apps_async(
                        msg.label, msg.text, msg.direction, 
                        reg=msg.reg, timestamp=msg.timestamp
                    )
                else:
                    data = await decode_acars_apps_text_async(msg.label, msg.text, msg.direction)
                return BatchResult(
                    id=msg.id, success=data is not None, data=data,
                    decode_time_ms=(time.perf_counter()-start)*1000
                )
            except Exception as e:
                return BatchResult(
                    id=msg.id, success=False, error=str(e),
                    decode_time_ms=(time.perf_counter()-start)*1000
                )
    
    return await asyncio.gather(*[_process(m) for m in messages])

# =============================================================================
# Management
# =============================================================================

def init_binding():
    load_libacars()

def is_available() -> bool:
    return not LIBACARS_DISABLED and get_lib()[0] is not None

def get_backend() -> str:
    return get_lib()[2]

def get_stats() -> dict:
    with _stats_lock: 
        stats = _stats.to_dict()
    
    breaker = get_circuit_breaker()
    cache = get_decode_cache() if CACHE_ENABLED else None
    
    return {
        "available": is_available(),
        "disabled_env": LIBACARS_DISABLED,
        "backend": get_backend(),
        "circuit_state": breaker.state.name.lower(),
        "cache_enabled": CACHE_ENABLED,
        "cache_size": cache.size if cache else 0,
        **stats,
        "circuit_breaker": breaker.get_stats(),
        "cache": cache.get_stats() if cache else {}
    }

def reset_stats():
    # Fixed: Update the existing object instead of creating a new one to preserve references
    with _stats_lock:
        _stats.total_calls = 0
        _stats.successful = 0
        _stats.failed = 0
        _stats.skipped = 0
        _stats.cache_hits = 0
        _stats.cache_misses = 0
        _stats.total_decode_time_ms = 0.0
        _stats.consecutive_errors = 0
        
    if CACHE_ENABLED: 
        get_decode_cache().reset_stats()

def reset_error_state():
    with _stats_lock: 
        _stats.consecutive_errors = 0
    get_circuit_breaker().reset()

def shutdown():
    global _executor
    with _executor_lock:
        if _executor: 
            _executor.shutdown(wait=True)
            _executor = None

def get_health() -> dict:
    breaker = get_circuit_breaker()
    lib, _, backend = get_lib()
    return {
        "healthy": lib is not None and breaker.state != CircuitState.OPEN,
        "available": lib is not None,
        "backend": backend,
        "circuit_state": breaker.state.name.lower()
    }

def export_prometheus_metrics() -> str:
    return get_metrics_collector().export_prometheus()