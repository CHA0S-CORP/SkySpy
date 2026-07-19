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
the message undecodable and moves on.

The child entrypoint lives in ``skyspy_common.subprocess_decode`` (NOT here):
``spawn`` unpickles the target by qualified name, forcing the child to import
the function's module. If the entrypoint lived under ``skyspy.services``, that
import would run ``skyspy/services/__init__.py`` (Django models) before
``django.setup()`` and raise ``AppRegistryNotReady`` on every decode. Keeping it
in the Django-free ``skyspy_common`` package means the child imports only
``skyspy_common.libacars``, so isolation works and spawn stays cheap.
"""

from __future__ import annotations

import hashlib
import logging
import multiprocessing as mp
from collections import OrderedDict

from skyspy_common.subprocess_decode import decode_child

logger = logging.getLogger(__name__)

# `spawn` starts a fresh interpreter with no inherited gevent hub or monkeypatch,
# so the isolated decode can't perturb the parent worker's event loop.
_CTX = mp.get_context("spawn")

# Native decode should be near-instant; anything longer is a hang we abandon.
_DECODE_TIMEOUT = 4.0

# Payloads that segfault/hang libacars are deterministic: the same bytes crash
# every time. Without a memo, a poisoned message re-spawns a subprocess and
# re-crashes on every poll — burning CPU and flooding the log with SIGSEGV
# warnings. Remember the payloads that already failed and short-circuit them to
# ``None`` instead of respawning. Bounded LRU so it can't grow unbounded.
_POISON_MAX = 2048
_poison_seen: OrderedDict[str, None] = OrderedDict()


def _poison_key(label: str, text: str, direction: int) -> str:
    h = hashlib.blake2b(f"{direction}\x00{label}\x00{text}".encode(), digest_size=16)
    return h.hexdigest()


def _mark_poison(key: str) -> None:
    _poison_seen[key] = None
    _poison_seen.move_to_end(key)
    while len(_poison_seen) > _POISON_MAX:
        _poison_seen.popitem(last=False)


def safe_decode_acars_apps(label: str, text: str, direction: int = 0, timeout: float = _DECODE_TIMEOUT):
    """Decode ACARS application data in an isolated subprocess.

    Returns the decoded dict, or ``None`` if the message is undecodable, the
    native decoder crashed (segfault), or it timed out. Never raises and never
    lets a native crash reach the calling worker.
    """
    poison_key = _poison_key(label, text, direction)
    if poison_key in _poison_seen:
        _poison_seen.move_to_end(poison_key)  # keep hot poison from aging out
        return None

    crashed = False
    parent_conn = child_conn = proc = None
    try:
        parent_conn, child_conn = _CTX.Pipe(duplex=False)
        proc = _CTX.Process(target=decode_child, args=(label, text, direction, child_conn), daemon=True)
        proc.start()
        # Close our copy of the child end so poll() sees EOF if the child dies.
        child_conn.close()
        child_conn = None

        result = parent_conn.recv() if parent_conn.poll(timeout) else None
    except (EOFError, OSError):
        # Child died (likely a native crash) before sending anything.
        result = None
        crashed = True
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
                crashed = True  # timed out / hung — don't respawn on this payload
            # A negative exit code means the child was killed by a signal
            # (e.g. -11 = SIGSEGV) — the crash we are isolating.
            if proc.exitcode is not None and proc.exitcode < 0:
                crashed = True
                logger.warning(
                    "libacars decode subprocess crashed (signal %s) on label %r — message marked undecodable",
                    -proc.exitcode,
                    label,
                )

        # Memoize deterministic crashes/hangs so the same payload can't re-crash
        # the subprocess on every poll.
        if crashed:
            _mark_poison(poison_key)

    return result if isinstance(result, dict) else None
