"""
Crash-isolated wrapper around the native libacars application decoder.

libacars is a C library reached via CFFI. Certain malformed CPDLC/ARINC/MIAM
payloads make it **segfault** (SIGSEGV) deep in native code — which Python's
``try/except`` cannot catch. Because the dev Celery worker uses a single-process
gevent pool that ALSO runs the aircraft-ingestion tasks, one poisoned ACARS
message would take down the whole worker and stop planes from feeding (and the
un-acked task is redelivered on restart, creating a crash loop).

This module runs the risky ``decode_acars_apps`` call in a short-lived ``spawn``
subprocess. A native crash there kills only the child (non-zero/negative exit
code); the parent observes the failure and returns ``None`` so the caller marks
the message undecodable and moves on. The child imports only the standalone
``skyspy_common.libacars`` package (no Django), so spawn stays cheap.
"""

from __future__ import annotations

import logging
import multiprocessing as mp

logger = logging.getLogger(__name__)

# `spawn` starts a fresh interpreter with no inherited gevent hub or monkeypatch,
# so the isolated decode can't perturb the parent worker's event loop.
_CTX = mp.get_context("spawn")

# Native decode should be near-instant; anything longer is a hang we abandon.
_DECODE_TIMEOUT = 4.0


def _decode_child(label: str, text: str, direction: int, conn) -> None:
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


def safe_decode_acars_apps(label: str, text: str, direction: int = 0, timeout: float = _DECODE_TIMEOUT):
    """Decode ACARS application data in an isolated subprocess.

    Returns the decoded dict, or ``None`` if the message is undecodable, the
    native decoder crashed (segfault), or it timed out. Never raises and never
    lets a native crash reach the calling worker.
    """
    parent_conn = child_conn = proc = None
    try:
        parent_conn, child_conn = _CTX.Pipe(duplex=False)
        proc = _CTX.Process(target=_decode_child, args=(label, text, direction, child_conn), daemon=True)
        proc.start()
        # Close our copy of the child end so poll() sees EOF if the child dies.
        child_conn.close()
        child_conn = None

        result = parent_conn.recv() if parent_conn.poll(timeout) else None
    except (EOFError, OSError):
        # Child died (likely a native crash) before sending anything.
        result = None
    except Exception as e:  # broad: subprocess plumbing must never crash the caller
        logger.debug("safe libacars decode plumbing error: %s", e)
        result = None
    finally:
        for c in (parent_conn, child_conn):
            try:
                if c is not None:
                    c.close()
            except OSError:
                pass
        if proc is not None:
            proc.join(0.2)
            if proc.is_alive():
                proc.terminate()
                proc.join(0.5)
            # A negative exit code means the child was killed by a signal
            # (e.g. -11 = SIGSEGV) — the crash we are isolating.
            if proc.exitcode is not None and proc.exitcode < 0:
                logger.warning(
                    "libacars decode subprocess crashed (signal %s) on label %r — message marked undecodable",
                    -proc.exitcode,
                    label,
                )

    return result if isinstance(result, dict) else None
