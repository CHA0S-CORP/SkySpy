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
from typing import Optional
from enum import IntEnum

logger = logging.getLogger(__name__)

# Allow disabling libacars via environment variable for troubleshooting
LIBACARS_DISABLED = os.environ.get("LIBACARS_DISABLED", "").lower() in ("true", "1", "yes")
if LIBACARS_DISABLED:
    logger.info("libacars disabled via LIBACARS_DISABLED environment variable")

# Message direction enum
class MsgDir(IntEnum):
    UNKNOWN = 0
    AIR2GND = 1  # Uplink (air to ground)
    GND2AIR = 2  # Downlink (ground to air)


# Try to load libacars
_libacars = None
_libacars_available = False

# Error tracking - disable libacars if too many consecutive errors
_consecutive_errors = 0
_max_consecutive_errors = 5
_libacars_disabled_due_to_errors = False


def _load_libacars():
    """Try to load the libacars shared library."""
    global _libacars, _libacars_available

    if _libacars is not None:
        return _libacars_available

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

    for path in lib_paths:
        try:
            _libacars = ctypes.CDLL(path)
            _libacars_available = True
            logger.info(f"Loaded libacars from {path}")
            _setup_function_signatures()
            return True
        except OSError:
            continue

    logger.warning("libacars library not found - advanced ACARS decoding disabled")
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

    # Check if libacars is disabled
    if LIBACARS_DISABLED or _libacars_disabled_due_to_errors:
        return None

    if not _load_libacars():
        return None

    if not label or not text:
        return None

    # Safety check: skip very long messages that could cause issues
    if len(text) > 10000:
        logger.debug("Skipping libacars decode: message too long")
        return None

    # Safety check: skip messages with null bytes or invalid characters
    if '\x00' in text:
        logger.debug("Skipping libacars decode: message contains null bytes")
        return None

    try:
        # Encode strings to bytes
        label_bytes = label.encode('utf-8')
        text_bytes = text.encode('utf-8')

        # Decode the message
        node = _libacars.la_acars_decode_apps(label_bytes, text_bytes, int(direction))

        if not node:
            # Successful call (even if no decode) - reset error counter
            _consecutive_errors = 0
            return None

        try:
            # Format as JSON
            vstr = _libacars.la_vstring_new()
            if not vstr:
                return None

            try:
                _libacars.la_proto_tree_format_json(vstr, node)
                # Access the str member directly from the structure
                json_str = vstr.contents.str

                if json_str:
                    decoded = json.loads(json_str.decode('utf-8'))
                    # Successful decode - reset error counter
                    _consecutive_errors = 0
                    return decoded
                return None
            finally:
                _libacars.la_vstring_destroy(vstr, True)
        finally:
            _libacars.la_proto_tree_destroy(node)

    except Exception as e:
        _consecutive_errors += 1
        logger.warning(f"libacars decode error ({_consecutive_errors}/{_max_consecutive_errors}): {e}")

        # Disable libacars if too many consecutive errors
        if _consecutive_errors >= _max_consecutive_errors:
            _libacars_disabled_due_to_errors = True
            logger.error(
                f"libacars disabled after {_max_consecutive_errors} consecutive errors. "
                "Restart the service to re-enable."
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

    # Check if libacars is disabled
    if LIBACARS_DISABLED or _libacars_disabled_due_to_errors:
        return None

    if not _load_libacars():
        return None

    if not label or not text:
        return None

    # Safety check: skip very long messages that could cause issues
    if len(text) > 10000:
        logger.debug("Skipping libacars decode: message too long")
        return None

    # Safety check: skip messages with null bytes or invalid characters
    if '\x00' in text:
        logger.debug("Skipping libacars decode: message contains null bytes")
        return None

    try:
        label_bytes = label.encode('utf-8')
        text_bytes = text.encode('utf-8')

        node = _libacars.la_acars_decode_apps(label_bytes, text_bytes, int(direction))

        if not node:
            _consecutive_errors = 0
            return None

        try:
            vstr = _libacars.la_vstring_new()
            if not vstr:
                return None

            try:
                _libacars.la_proto_tree_format_text(vstr, node, 0)
                # Access the str member directly from the structure
                text_result = vstr.contents.str

                if text_result:
                    _consecutive_errors = 0
                    return text_result.decode('utf-8')
                return None
            finally:
                _libacars.la_vstring_destroy(vstr, True)
        finally:
            _libacars.la_proto_tree_destroy(node)

    except Exception as e:
        _consecutive_errors += 1
        logger.warning(f"libacars text decode error ({_consecutive_errors}/{_max_consecutive_errors}): {e}")

        if _consecutive_errors >= _max_consecutive_errors:
            _libacars_disabled_due_to_errors = True
            logger.error(
                f"libacars disabled after {_max_consecutive_errors} consecutive errors. "
                "Restart the service to re-enable."
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
            return (
                sublabel.value.decode('utf-8') if sublabel.value else None,
                mfi.value.decode('utf-8') if mfi.value else None,
                consumed
            )
        return None, None, 0

    except Exception as e:
        logger.debug(f"libacars extract error: {e}")
        return None, None, 0
