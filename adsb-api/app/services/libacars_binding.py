"""
Python ctypes bindings for libacars library.

libacars is a C library for decoding various ACARS message payloads including:
- FANS-1/A ADS-C (Automatic Dependent Surveillance - Contract)
- FANS-1/A CPDLC (Controller-Pilot Data Link Communications)
- MIAM (Media Independent Aircraft Messaging)
- Various airline-specific message formats

This module provides a Python interface to decode ACARS messages that cannot
be decoded with simple regex patterns.
"""
import ctypes
import ctypes.util
import json
import logging
import os
import threading
import time
from typing import Optional
from enum import IntEnum

import sentry_sdk

logger = logging.getLogger(__name__)

# Allow disabling libacars via environment variable for troubleshooting
LIBACARS_DISABLED = os.environ.get("LIBACARS_DISABLED", "").lower() in ("true", "1", "yes")
if LIBACARS_DISABLED:
    logger.info("libacars disabled via LIBACARS_DISABLED environment variable")

# Message direction enum
class MsgDir(IntEnum):
    UNKNOWN = 0
    AIR2GND = 1  # Downlink (aircraft to ground station)
    GND2AIR = 2  # Uplink (ground station to aircraft)


# Try to load libacars
_libacars = None
_libacars_available = False

# Error tracking - disable libacars if too many consecutive errors
_consecutive_errors = 0
_max_consecutive_errors = 5
_libacars_disabled_due_to_errors = False
_error_lock = threading.Lock()

# Performance tracking
_total_decode_calls = 0
_successful_decodes = 0
_failed_decodes = 0
_skipped_decodes = 0
_total_decode_time_ms = 0.0
_stats_lock = threading.Lock()


def _load_libacars():
    """Try to load the libacars shared library."""
    global _libacars, _libacars_available

    if _libacars is not None:
        return _libacars_available

    with sentry_sdk.start_span(op="libacars.load", description="Load libacars library") as span:
        lib_paths = [
            "libacars-2.so",
            "libacars-2.so.2",
            "/usr/local/lib/libacars-2.so",
            "/usr/local/lib/libacars-2.so.2",
            "/usr/lib/libacars-2.so",
            "/usr/lib/libacars-2.so.2",
            "/usr/lib/x86_64-linux-gnu/libacars-2.so",
            "/usr/lib/aarch64-linux-gnu/libacars-2.so",
        ]

        # Also try ctypes.util.find_library
        found = ctypes.util.find_library("acars-2")
        if found:
            lib_paths.insert(0, found)

        span.set_data("lib_paths_searched", len(lib_paths))
        tried_paths = []

        for path in lib_paths:
            tried_paths.append(path)
            try:
                _libacars = ctypes.CDLL(path)
                _libacars_available = True
                logger.info(f"Loaded libacars from {path}")
                span.set_data("loaded_from", path)
                span.set_data("success", True)
                sentry_sdk.set_context("libacars", {
                    "available": True,
                    "library_path": path,
                })
                _setup_function_signatures()
                return True
            except OSError:
                continue

        logger.warning("libacars library not found - advanced ACARS decoding disabled")
        span.set_data("tried_paths", tried_paths)
        span.set_data("success", False)
        sentry_sdk.set_context("libacars", {
            "available": False,
            "tried_paths": tried_paths,
        })
        _libacars_available = False
        return False


# Opaque pointer types
class la_proto_node(ctypes.Structure):
    pass

# la_vstring structure - must match libacars internal layout exactly
# From libacars/vstring.c: str, allocated_size, len
class la_vstring(ctypes.Structure):
    _fields_ = [
        ("str", ctypes.c_char_p),
        ("allocated_size", ctypes.c_size_t),
        ("len", ctypes.c_size_t),
    ]


def _setup_function_signatures():
    """Set up ctypes function signatures for libacars."""
    global _libacars

    if not _libacars:
        return

    # la_acars_decode_apps - decode application layer from label and text
    # la_proto_node *la_acars_decode_apps(char const *label, char const *txt, la_msg_dir msg_dir)
    _libacars.la_acars_decode_apps.argtypes = [
        ctypes.c_char_p,  # label
        ctypes.c_char_p,  # txt
        ctypes.c_int,     # msg_dir
    ]
    _libacars.la_acars_decode_apps.restype = ctypes.POINTER(la_proto_node)

    # la_proto_tree_format_json - format protocol tree as JSON
    # void la_proto_tree_format_json(la_vstring *vstr, la_proto_node const *root)
    _libacars.la_proto_tree_format_json.argtypes = [
        ctypes.POINTER(la_vstring),
        ctypes.POINTER(la_proto_node),
    ]
    _libacars.la_proto_tree_format_json.restype = None

    # la_proto_tree_format_text - format protocol tree as text
    # void la_proto_tree_format_text(la_vstring *vstr, la_proto_node const *root, int indent)
    _libacars.la_proto_tree_format_text.argtypes = [
        ctypes.POINTER(la_vstring),
        ctypes.POINTER(la_proto_node),
        ctypes.c_int,
    ]
    _libacars.la_proto_tree_format_text.restype = None

    # la_proto_tree_destroy - free protocol tree memory
    # void la_proto_tree_destroy(la_proto_node *root)
    _libacars.la_proto_tree_destroy.argtypes = [ctypes.POINTER(la_proto_node)]
    _libacars.la_proto_tree_destroy.restype = None

    # la_vstring_new - create new variable string
    # la_vstring *la_vstring_new()
    _libacars.la_vstring_new.argtypes = []
    _libacars.la_vstring_new.restype = ctypes.POINTER(la_vstring)

    # la_vstring_destroy - free variable string
    # void la_vstring_destroy(la_vstring *vstr, bool destroy_buffer)
    _libacars.la_vstring_destroy.argtypes = [ctypes.POINTER(la_vstring), ctypes.c_bool]
    _libacars.la_vstring_destroy.restype = None

    # la_acars_extract_sublabel_and_mfi - extract sublabel and MFI from H1 messages
    # int la_acars_extract_sublabel_and_mfi(char const *label, la_msg_dir msg_dir,
    #     char const *txt, int len, char *sublabel, char *mfi)
    _libacars.la_acars_extract_sublabel_and_mfi.argtypes = [
        ctypes.c_char_p,  # label
        ctypes.c_int,     # msg_dir
        ctypes.c_char_p,  # txt
        ctypes.c_int,     # len
        ctypes.c_char_p,  # sublabel (output, at least 3 bytes)
        ctypes.c_char_p,  # mfi (output, at least 3 bytes)
    ]
    _libacars.la_acars_extract_sublabel_and_mfi.restype = ctypes.c_int


def is_available() -> bool:
    """Check if libacars is available."""
    if LIBACARS_DISABLED:
        return False
    _load_libacars()
    return _libacars_available


def decode_acars_apps(label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN) -> Optional[dict]:
    """
    Decode ACARS application-layer message content.

    This function uses libacars to decode complex message formats that cannot
    be decoded with simple regex patterns, such as:
    - FANS-1/A ADS-C and CPDLC messages
    - MIAM compressed messages
    - Various airline-specific encoded formats

    Args:
        label: ACARS message label (e.g., "H1", "SA", etc.)
        text: Message text content to decode
        direction: Message direction (air-to-ground or ground-to-air)

    Returns:
        Decoded message as a dict, or None if decoding failed or libacars unavailable
    """
    global _consecutive_errors, _libacars_disabled_due_to_errors
    global _total_decode_calls, _successful_decodes, _failed_decodes, _skipped_decodes, _total_decode_time_ms

    with _stats_lock:
        _total_decode_calls += 1

    # Check if libacars is disabled
    if LIBACARS_DISABLED or _libacars_disabled_due_to_errors:
        with _stats_lock:
            _skipped_decodes += 1
        return None

    if not _load_libacars():
        with _stats_lock:
            _skipped_decodes += 1
        return None

    if not label or not text:
        with _stats_lock:
            _skipped_decodes += 1
        return None

    # Safety check: skip very long messages that could cause issues
    if len(text) > 10000:
        logger.debug("Skipping libacars decode: message too long")
        with _stats_lock:
            _skipped_decodes += 1
        sentry_sdk.set_context("libacars_skip", {
            "reason": "message_too_long",
            "text_length": len(text),
            "label": label,
        })
        return None

    # Safety check: skip messages with null bytes or invalid characters
    if '\x00' in text:
        logger.debug("Skipping libacars decode: message contains null bytes")
        with _stats_lock:
            _skipped_decodes += 1
        sentry_sdk.set_context("libacars_skip", {
            "reason": "null_bytes",
            "label": label,
        })
        return None

    start_time = time.perf_counter()

    with sentry_sdk.start_span(
        op="libacars.decode",
        description=f"Decode ACARS label={label}"
    ) as span:
        span.set_data("label", label)
        span.set_data("text_length", len(text))
        span.set_data("direction", direction.name)

        try:
            # Encode strings to bytes
            label_bytes = label.encode('utf-8')
            text_bytes = text.encode('utf-8')

            # Decode the message
            with sentry_sdk.start_span(op="libacars.decode_apps", description="la_acars_decode_apps"):
                node = _libacars.la_acars_decode_apps(label_bytes, text_bytes, int(direction))

            if not node:
                # Successful call (even if no decode) - reset error counter
                with _error_lock:
                    _consecutive_errors = 0
                span.set_data("result", "no_decode")
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                with _stats_lock:
                    _total_decode_time_ms += elapsed_ms
                return None

            try:
                # Format as JSON
                with sentry_sdk.start_span(op="libacars.format_json", description="Format to JSON"):
                    vstr = _libacars.la_vstring_new()
                    if not vstr:
                        span.set_data("result", "vstring_alloc_failed")
                        return None

                    try:
                        _libacars.la_proto_tree_format_json(vstr, node)
                        # Access the str member directly from the structure
                        json_str = vstr.contents.str

                        if json_str:
                            decoded = json.loads(json_str.decode('utf-8'))
                            # Successful decode - reset error counter
                            with _error_lock:
                                _consecutive_errors = 0

                            elapsed_ms = (time.perf_counter() - start_time) * 1000
                            with _stats_lock:
                                _successful_decodes += 1
                                _total_decode_time_ms += elapsed_ms

                            span.set_data("result", "success")
                            span.set_data("decode_time_ms", round(elapsed_ms, 2))
                            span.set_data("output_keys", list(decoded.keys()) if isinstance(decoded, dict) else None)

                            return decoded

                        span.set_data("result", "empty_json")
                        return None
                    finally:
                        _libacars.la_vstring_destroy(vstr, True)
            finally:
                _libacars.la_proto_tree_destroy(node)

        except json.JSONDecodeError as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            with _stats_lock:
                _failed_decodes += 1
                _total_decode_time_ms += elapsed_ms

            span.set_data("result", "json_decode_error")
            span.set_data("error", str(e))

            sentry_sdk.capture_exception(e)
            sentry_sdk.set_context("libacars_decode_error", {
                "error_type": "json_decode",
                "label": label,
                "text_length": len(text),
                "direction": direction.name,
            })

            logger.warning(f"libacars JSON decode error for label={label}: {e}")
            return None

        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            with _stats_lock:
                _failed_decodes += 1
                _total_decode_time_ms += elapsed_ms

            with _error_lock:
                _consecutive_errors += 1
                current_errors = _consecutive_errors
                if _consecutive_errors >= _max_consecutive_errors:
                    _libacars_disabled_due_to_errors = True

            span.set_data("result", "error")
            span.set_data("error", str(e))
            span.set_data("consecutive_errors", current_errors)

            sentry_sdk.capture_exception(e)
            sentry_sdk.set_context("libacars_decode_error", {
                "error_type": type(e).__name__,
                "label": label,
                "text_length": len(text),
                "direction": direction.name,
                "consecutive_errors": current_errors,
                "max_consecutive_errors": _max_consecutive_errors,
                "will_disable": current_errors >= _max_consecutive_errors,
            })

            logger.warning(f"libacars decode error ({current_errors}/{_max_consecutive_errors}): {e}")

            if current_errors >= _max_consecutive_errors:
                logger.error(
                    f"libacars disabled after {_max_consecutive_errors} consecutive errors. "
                    "Restart the service to re-enable."
                )
                sentry_sdk.capture_message(
                    f"libacars disabled after {_max_consecutive_errors} consecutive errors",
                    level="error"
                )

            return None


def decode_acars_apps_text(label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN) -> Optional[str]:
    """
    Decode ACARS application-layer message and return as formatted text.

    Similar to decode_acars_apps but returns human-readable text instead of JSON.

    Args:
        label: ACARS message label
        text: Message text content to decode
        direction: Message direction

    Returns:
        Formatted text string, or None if decoding failed
    """
    global _consecutive_errors, _libacars_disabled_due_to_errors
    global _total_decode_calls, _successful_decodes, _failed_decodes, _skipped_decodes, _total_decode_time_ms

    with _stats_lock:
        _total_decode_calls += 1

    # Check if libacars is disabled
    if LIBACARS_DISABLED or _libacars_disabled_due_to_errors:
        with _stats_lock:
            _skipped_decodes += 1
        return None

    if not _load_libacars():
        with _stats_lock:
            _skipped_decodes += 1
        return None

    if not label or not text:
        with _stats_lock:
            _skipped_decodes += 1
        return None

    # Safety check: skip very long messages that could cause issues
    if len(text) > 10000:
        logger.debug("Skipping libacars decode: message too long")
        with _stats_lock:
            _skipped_decodes += 1
        return None

    # Safety check: skip messages with null bytes or invalid characters
    if '\x00' in text:
        logger.debug("Skipping libacars decode: message contains null bytes")
        with _stats_lock:
            _skipped_decodes += 1
        return None

    start_time = time.perf_counter()

    with sentry_sdk.start_span(
        op="libacars.decode_text",
        description=f"Decode ACARS text label={label}"
    ) as span:
        span.set_data("label", label)
        span.set_data("text_length", len(text))
        span.set_data("direction", direction.name)
        span.set_data("output_format", "text")

        try:
            label_bytes = label.encode('utf-8')
            text_bytes = text.encode('utf-8')

            with sentry_sdk.start_span(op="libacars.decode_apps", description="la_acars_decode_apps"):
                node = _libacars.la_acars_decode_apps(label_bytes, text_bytes, int(direction))

            if not node:
                with _error_lock:
                    _consecutive_errors = 0
                span.set_data("result", "no_decode")
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                with _stats_lock:
                    _total_decode_time_ms += elapsed_ms
                return None

            try:
                with sentry_sdk.start_span(op="libacars.format_text", description="Format to text"):
                    vstr = _libacars.la_vstring_new()
                    if not vstr:
                        span.set_data("result", "vstring_alloc_failed")
                        return None

                    try:
                        _libacars.la_proto_tree_format_text(vstr, node, 0)
                        # Access the str member directly from the structure
                        text_result = vstr.contents.str

                        if text_result:
                            with _error_lock:
                                _consecutive_errors = 0

                            elapsed_ms = (time.perf_counter() - start_time) * 1000
                            decoded_text = text_result.decode('utf-8')

                            with _stats_lock:
                                _successful_decodes += 1
                                _total_decode_time_ms += elapsed_ms

                            span.set_data("result", "success")
                            span.set_data("decode_time_ms", round(elapsed_ms, 2))
                            span.set_data("output_length", len(decoded_text))

                            return decoded_text

                        span.set_data("result", "empty_text")
                        return None
                    finally:
                        _libacars.la_vstring_destroy(vstr, True)
            finally:
                _libacars.la_proto_tree_destroy(node)

        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            with _stats_lock:
                _failed_decodes += 1
                _total_decode_time_ms += elapsed_ms

            with _error_lock:
                _consecutive_errors += 1
                current_errors = _consecutive_errors
                if _consecutive_errors >= _max_consecutive_errors:
                    _libacars_disabled_due_to_errors = True

            span.set_data("result", "error")
            span.set_data("error", str(e))
            span.set_data("consecutive_errors", current_errors)

            sentry_sdk.capture_exception(e)
            sentry_sdk.set_context("libacars_decode_text_error", {
                "error_type": type(e).__name__,
                "label": label,
                "text_length": len(text),
                "direction": direction.name,
                "consecutive_errors": current_errors,
                "max_consecutive_errors": _max_consecutive_errors,
            })

            logger.warning(f"libacars text decode error ({current_errors}/{_max_consecutive_errors}): {e}")

            if current_errors >= _max_consecutive_errors:
                logger.error(
                    f"libacars disabled after {_max_consecutive_errors} consecutive errors. "
                    "Restart the service to re-enable."
                )
                sentry_sdk.capture_message(
                    f"libacars disabled after {_max_consecutive_errors} consecutive errors",
                    level="error"
                )

            return None


def extract_sublabel_mfi(label: str, text: str, direction: MsgDir = MsgDir.UNKNOWN) -> tuple[Optional[str], Optional[str], int]:
    """
    Extract sublabel and MFI from H1 messages.

    For H1 messages, the first few characters may contain a sublabel and
    Message Function Identifier (MFI). This function extracts them.

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

    with sentry_sdk.start_span(
        op="libacars.extract_sublabel_mfi",
        description=f"Extract sublabel/MFI label={label}"
    ) as span:
        span.set_data("label", label)
        span.set_data("text_length", len(text))
        span.set_data("direction", direction.name)

        try:
            label_bytes = label.encode('utf-8')
            text_bytes = text.encode('utf-8')

            # Allocate output buffers
            sublabel = ctypes.create_string_buffer(3)
            mfi = ctypes.create_string_buffer(3)

            consumed = _libacars.la_acars_extract_sublabel_and_mfi(
                label_bytes,
                int(direction),
                text_bytes,
                len(text_bytes),
                sublabel,
                mfi
            )

            if consumed > 0:
                result_sublabel = sublabel.value.decode('utf-8') if sublabel.value else None
                result_mfi = mfi.value.decode('utf-8') if mfi.value else None

                span.set_data("result", "success")
                span.set_data("sublabel", result_sublabel)
                span.set_data("mfi", result_mfi)
                span.set_data("bytes_consumed", consumed)

                return (result_sublabel, result_mfi, consumed)

            span.set_data("result", "no_match")
            return None, None, 0

        except Exception as e:
            span.set_data("result", "error")
            span.set_data("error", str(e))

            sentry_sdk.capture_exception(e)
            sentry_sdk.set_context("libacars_extract_error", {
                "error_type": type(e).__name__,
                "label": label,
                "text_length": len(text),
                "direction": direction.name,
            })

            logger.debug(f"libacars extract error: {e}")
            return None, None, 0


def reset_error_state() -> None:
    """
    Reset the error tracking state to re-enable libacars.

    Call this function to re-enable libacars after it has been disabled
    due to consecutive errors, without needing to restart the service.
    """
    global _consecutive_errors, _libacars_disabled_due_to_errors

    with _error_lock:
        _consecutive_errors = 0
        _libacars_disabled_due_to_errors = False

    logger.info("libacars error state reset - library re-enabled")

    sentry_sdk.capture_message("libacars error state reset - library re-enabled", level="info")
    sentry_sdk.set_context("libacars_state", {
        "disabled_due_to_errors": False,
        "consecutive_errors": 0,
        "reset_performed": True,
    })


def get_stats() -> dict:
    """
    Get libacars performance and usage statistics.

    Returns a dictionary with decode statistics useful for monitoring
    and debugging. This data is also available in Sentry context.

    Returns:
        Dictionary with statistics including:
        - available: Whether libacars is loaded
        - disabled: Whether libacars is currently disabled
        - total_calls: Total decode attempts
        - successful: Successful decodes
        - failed: Failed decodes (errors)
        - skipped: Skipped decodes (disabled, missing input, etc.)
        - consecutive_errors: Current consecutive error count
        - avg_decode_time_ms: Average decode time in milliseconds
    """
    with _stats_lock:
        total = _total_decode_calls
        successful = _successful_decodes
        failed = _failed_decodes
        skipped = _skipped_decodes
        total_time = _total_decode_time_ms

    with _error_lock:
        consecutive = _consecutive_errors
        disabled_errors = _libacars_disabled_due_to_errors

    # Calculate average decode time (only for calls that actually decoded)
    decode_attempts = total - skipped
    avg_time = (total_time / decode_attempts) if decode_attempts > 0 else 0.0

    stats = {
        "available": _libacars_available,
        "disabled_env": LIBACARS_DISABLED,
        "disabled_errors": disabled_errors,
        "total_calls": total,
        "successful": successful,
        "failed": failed,
        "skipped": skipped,
        "consecutive_errors": consecutive,
        "max_consecutive_errors": _max_consecutive_errors,
        "total_decode_time_ms": round(total_time, 2),
        "avg_decode_time_ms": round(avg_time, 2),
        "success_rate": round((successful / decode_attempts * 100), 2) if decode_attempts > 0 else 0.0,
    }

    # Update Sentry context with current stats
    sentry_sdk.set_context("libacars_stats", stats)

    return stats


def reset_stats() -> None:
    """
    Reset all performance statistics counters.

    Useful for getting fresh statistics after a deployment or
    when investigating performance issues.
    """
    global _total_decode_calls, _successful_decodes, _failed_decodes, _skipped_decodes, _total_decode_time_ms

    with _stats_lock:
        _total_decode_calls = 0
        _successful_decodes = 0
        _failed_decodes = 0
        _skipped_decodes = 0
        _total_decode_time_ms = 0.0

    logger.info("libacars statistics reset")
    sentry_sdk.capture_message("libacars statistics reset", level="info")
