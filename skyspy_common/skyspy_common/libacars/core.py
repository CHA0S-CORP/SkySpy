"""
Core library loading and raw binding management.
"""
import ctypes
import ctypes.util
import logging
import threading
import os
from contextlib import contextmanager
from typing import Any, Callable, Generator, Optional

from .c_defs import CFFI_CDEF, la_vstring, la_proto_node, la_reasm_ctx, timeval
from .exceptions import LibacarsMemoryError

logger = logging.getLogger(__name__)

_lib = None
_ffi = None
_backend = "unavailable"  # Fixed: Default matches API expectation
_load_lock = threading.Lock()

def load_libacars() -> bool:
    """Load the libacars library (CFFI with ctypes fallback)."""
    global _lib, _ffi, _backend
    
    with _load_lock:
        if _backend != "unavailable":
            return True

        paths = [
            "libacars-2.so", "libacars-2.so.2",
            "/usr/local/lib/libacars-2.so", "/usr/lib/libacars-2.so",
            "/usr/lib/x86_64-linux-gnu/libacars-2.so",
            "/opt/homebrew/lib/libacars-2.dylib"
        ]
        found = ctypes.util.find_library("acars-2")
        if found:
            paths.insert(0, found)

        # 1. Try CFFI
        try:
            from cffi import FFI
            ffi = FFI()
            ffi.cdef(CFFI_CDEF)
            for path in paths:
                try:
                    _lib = ffi.dlopen(path)
                    _ffi = ffi
                    _backend = "cffi"
                    logger.info(f"Loaded libacars via CFFI from {path}")
                    return True
                except OSError:
                    continue
        except ImportError:
            pass

        # 2. Try ctypes
        for path in paths:
            try:
                _lib = ctypes.CDLL(path)
                _setup_ctypes(_lib)
                _backend = "ctypes"
                logger.info(f"Loaded libacars via ctypes from {path}")
                return True
            except OSError:
                continue
                
        return False

def _setup_ctypes(lib):
    """Configure ctypes argument types."""
    lib.la_acars_decode_apps.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    lib.la_acars_decode_apps.restype = ctypes.POINTER(la_proto_node)

    lib.la_reasm_ctx_new.restype = ctypes.POINTER(la_reasm_ctx)
    lib.la_reasm_ctx_destroy.argtypes = [ctypes.POINTER(la_reasm_ctx)]

    lib.la_acars_apps_parse_and_reassemble.argtypes = [
        ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, 
        ctypes.c_int, ctypes.POINTER(la_reasm_ctx), timeval
    ]
    lib.la_acars_apps_parse_and_reassemble.restype = ctypes.POINTER(la_proto_node)

    lib.la_proto_tree_format_json.argtypes = [ctypes.POINTER(la_vstring), ctypes.POINTER(la_proto_node)]
    lib.la_proto_tree_format_json.restype = ctypes.POINTER(la_vstring)

    lib.la_proto_tree_format_text.argtypes = [ctypes.POINTER(la_vstring), ctypes.POINTER(la_proto_node)]
    lib.la_proto_tree_format_text.restype = ctypes.POINTER(la_vstring)

    lib.la_proto_tree_destroy.argtypes = [ctypes.POINTER(la_proto_node)]
    
    lib.la_vstring_new.restype = ctypes.POINTER(la_vstring)
    lib.la_vstring_destroy.argtypes = [ctypes.POINTER(la_vstring), ctypes.c_bool]

    lib.la_config_set_bool.argtypes = [ctypes.c_char_p, ctypes.c_bool]
    lib.la_config_set_int.argtypes = [ctypes.c_char_p, ctypes.c_long]
    lib.la_config_set_str.argtypes = [ctypes.c_char_p, ctypes.c_char_p]

    lib.la_acars_extract_sublabel_and_mfi.argtypes = [
        ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, 
        ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p
    ]
    lib.la_acars_extract_sublabel_and_mfi.restype = ctypes.c_int

def get_lib():
    if _backend == "unavailable":
        load_libacars()
    return _lib, _ffi, _backend

@contextmanager
def vstring_context() -> Generator[tuple[Any, str], None, None]:
    """
    Context manager for vstring allocation and cleanup.

    Yields a managed (vstring_ptr, backend_type) tuple and ensures
    the vstring is properly destroyed on exit.

    Stores a local reference to lib to prevent issues if shutdown()
    is called from another thread during execution.
    """
    lib, ffi, backend = get_lib()
    if not lib:
        raise RuntimeError("libacars not loaded")

    # Store local reference to lib to ensure cleanup works even if
    # global state changes during execution
    local_lib = lib

    if backend == "cffi":
        vstr = local_lib.la_vstring_new()
        if vstr == ffi.NULL:
            raise LibacarsMemoryError("Failed to allocate vstring")
    else:
        vstr = local_lib.la_vstring_new()
        if not vstr:
            raise LibacarsMemoryError("Failed to allocate vstring")

    try:
        yield vstr, backend
    finally:
        try:
            local_lib.la_vstring_destroy(vstr, True)
        except Exception:
            pass  # Ignore cleanup errors (e.g., during interpreter shutdown)