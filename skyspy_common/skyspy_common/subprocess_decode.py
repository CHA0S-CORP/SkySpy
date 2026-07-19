"""
Django-free child entrypoint for crash-isolated libacars decoding.

This module lives in ``skyspy_common`` **on purpose**: the parent process runs
the decode in a ``spawn`` subprocess (see
``skyspy.services.acars_safe_decode``). ``spawn`` starts a fresh interpreter and
unpickles the target function *by qualified name*, which forces the child to
import the module the function is defined in. If that module lived under
``skyspy.services``, the import would run ``skyspy/services/__init__.py`` (which
eagerly imports Django models) *before* ``django.setup()`` — raising
``AppRegistryNotReady`` and killing the child on every decode.

Keeping the entrypoint here means the child imports only ``skyspy_common`` (no
Django), so isolation actually works and stays cheap.
"""

from __future__ import annotations


def decode_child(label: str, text: str, direction: int, conn) -> None:
    """Child entrypoint: decode via libacars and pipe back the dict (or None)."""
    result = None
    try:
        from skyspy_common.libacars import MsgDir, decode_acars_apps

        msg_dir = MsgDir(direction) if direction in (0, 1, 2) else MsgDir.UNKNOWN
        # No shared cache across processes; the parent caches the final decode.
        decoded = decode_acars_apps(label, text, msg_dir, use_cache=False)
        result = decoded if isinstance(decoded, dict) else None
    except Exception:  # broad: child is throwaway; any failure -> None to the parent
        result = None
    finally:
        try:
            conn.send(result)
            conn.close()
        except (OSError, EOFError, BrokenPipeError):
            pass
