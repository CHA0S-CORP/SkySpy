"""
Shared outbound HTTP client for external data sources.

Consolidates the three ad-hoc retry patterns that grew across the services
layer (``external_db.fetch_with_retry``, ``aircraft_info._http_get_with_retry``,
``photo_cache._http_get_with_retry``) into one place, and adds the resilience
primitives that were missing on several hot callers (Aviationstack,
OpenSky-live, adsb.im routes, OpenFlights, HexDB):

- **Retry** — tenacity exponential backoff on transient failures only
  (timeouts, connect errors, 5xx). 4xx is never retried; 429 honors
  ``Retry-After`` once before giving up to the caller.
- **Distributed rate limiting** — a fixed-window counter in the Django cache
  (Redis in prod), keyed per source, shared across every Celery worker and the
  ASGI process. Prevents a fleet of workers collectively blowing a source's
  quota (e.g. OpenSky's daily credits).
- **Circuit breaker** — after N consecutive failures a source is "opened" for a
  cooldown, so a hard-down upstream fails fast instead of burning the retry
  budget on every call.
- **Single-flight coalescing** — ``single_flight()`` collapses concurrent work
  for the same key (e.g. simultaneous lookups of one ICAO) into a single
  upstream call.

All state lives in the Django cache so it is shared across processes. Every
resilience feature is opt-in per call via the ``source`` argument; omit it and
you get plain retry.
"""

import contextlib
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from django.core.cache import cache
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 15.0
DEFAULT_RETRIES = 3

# Circuit breaker defaults
_CB_FAIL_THRESHOLD = 5
_CB_COOLDOWN_SECONDS = 120

_CB_FAIL_PREFIX = "http:cb:fail:"
_CB_OPEN_PREFIX = "http:cb:open:"
_RATE_PREFIX = "http:rate:"
_FLIGHT_LOCK_PREFIX = "http:sf:lock:"
_FLIGHT_RESULT_PREFIX = "http:sf:res:"

# A request is only worth retrying when the failure is plausibly transient.
_RETRYABLE_STATUS = frozenset({500, 502, 503, 504})


class CircuitOpenError(Exception):
    """Raised when a source's circuit breaker is open (fail-fast)."""


class RateLimitedError(Exception):
    """Raised when a source's local rate-limit window is exhausted."""


class _RetryableHTTP(Exception):
    """Internal marker so tenacity retries only transient upstream failures."""


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(exc, (_RetryableHTTP, httpx.TimeoutException, httpx.TransportError))


# =============================================================================
# Circuit breaker
# =============================================================================


def _circuit_open(source: str) -> bool:
    return cache.get(f"{_CB_OPEN_PREFIX}{source}") is not None


def _record_success(source: str) -> None:
    # Clear the failure streak; a single success closes the breaker.
    with contextlib.suppress(ConnectionError, OSError):  # cache best-effort
        cache.delete(f"{_CB_FAIL_PREFIX}{source}")


def _record_failure(source: str, threshold: int = _CB_FAIL_THRESHOLD, cooldown: int = _CB_COOLDOWN_SECONDS) -> None:
    key = f"{_CB_FAIL_PREFIX}{source}"
    try:
        if not cache.add(key, 1, cooldown):
            try:
                fails = cache.incr(key)
                # incr does NOT reset the key's TTL, so without this the counter
                # would expire `cooldown` seconds after the FIRST failure no matter
                # how many follow — a source failing slowly (one timeout every
                # ~30s) could reset before reaching threshold and never open the
                # breaker. Slide the window on every failure.
                with contextlib.suppress(ConnectionError, OSError):
                    cache.touch(key, cooldown)
            except ValueError:
                cache.add(key, 1, cooldown)
                fails = 1
        else:
            fails = 1
        if fails >= threshold:
            cache.set(f"{_CB_OPEN_PREFIX}{source}", True, cooldown)
            logger.warning(f"Circuit opened for source '{source}' after {fails} consecutive failures")
    except (ConnectionError, OSError):  # pragma: no cover - cache best-effort
        return


def _counts_as_breaker_failure(exc: BaseException) -> bool:
    """Whether an exception should count toward opening the circuit breaker.

    A 4xx (except 429) is a definitive answer about a *specific* resource —
    "not found" / "bad request" — not a sign the source itself is unhealthy.
    Counting it would let a normal stream of 404s (e.g. hexdb's callsign-route
    for unknown callsigns, or an unknown hex) black out an otherwise-healthy
    source for every other lookup. Connection/timeout errors and exhausted-retry
    server errors (5xx / 429, which arrive here as _RetryableHTTP) do count.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        return not (400 <= code < 500 and code != 429)
    return True


# =============================================================================
# Rate limiting (fixed window, shared across processes)
# =============================================================================


def rate_ok(source: str, limit: int, window: int) -> bool:
    """
    Consume one token from ``source``'s fixed window. False when exhausted.

    Uses the Django cache (Redis in prod) so the window is shared across all
    workers. Follows the OpenSky pattern: add-or-incr so a steady trickle of
    requests can never keep the window from expiring.
    """
    key = f"{_RATE_PREFIX}{source}"
    try:
        if cache.add(key, 1, window):
            return True
        try:
            return cache.incr(key) <= limit
        except ValueError:
            # Window expired between add() and incr(); start a fresh one.
            cache.add(key, 1, window)
            return True
    except (ConnectionError, OSError):  # pragma: no cover - fail open if cache down
        return True


# =============================================================================
# Core request
# =============================================================================


def _request(
    method: str,
    url: str,
    *,
    source: str | None,
    params: dict | None,
    headers: dict | None,
    timeout: float,
    retries: int,
    rate: tuple[int, int] | None,
    auth: Any,
    json_body: Any = None,
) -> httpx.Response:
    """Execute one HTTP request with breaker + rate-limit + retry wrapping."""
    if source and _circuit_open(source):
        raise CircuitOpenError(source)
    if source and rate is not None and not rate_ok(source, rate[0], rate[1]):
        raise RateLimitedError(source)

    @retry(
        stop=stop_after_attempt(max(1, retries)),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception(_is_retryable),
        reraise=True,
    )
    def _do() -> httpx.Response:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.request(method, url, params=params, headers=headers, auth=auth, json=json_body)
        if resp.status_code == 429:
            # Honor Retry-After once, then let the caller decide.
            retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
            if retry_after:
                time.sleep(min(retry_after, 30))
            raise _RetryableHTTP(f"429 from {url}")
        if resp.status_code in _RETRYABLE_STATUS:
            raise _RetryableHTTP(f"{resp.status_code} from {url}")
        resp.raise_for_status()
        return resp

    try:
        resp = _do()
    except Exception as exc:
        if source and _counts_as_breaker_failure(exc):
            _record_failure(source)
        raise
    if source:
        _record_success(source)
    return resp


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# =============================================================================
# Public convenience wrappers
# =============================================================================


def get_json(
    url: str,
    *,
    source: str | None = None,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    rate: tuple[int, int] | None = None,
    auth: Any = None,
) -> Any | None:
    """
    GET a URL and return parsed JSON, or None on any failure.

    ``source`` enables the breaker + rate limiter for that logical upstream.
    ``rate`` is ``(limit, window_seconds)``. Never raises: transient errors are
    retried, permanent ones are logged and swallowed to None so callers keep
    their existing "return None on miss" contract.
    """
    try:
        resp = _request(
            "GET",
            url,
            source=source,
            params=params,
            headers=headers,
            timeout=timeout,
            retries=retries,
            rate=rate,
            auth=auth,
        )
        return resp.json()
    except (CircuitOpenError, RateLimitedError) as e:
        logger.debug(f"Skipping {url}: {type(e).__name__}")
        return None
    except (httpx.HTTPError, ConnectionError, OSError, ValueError) as e:
        logger.debug(f"GET {url} failed: {type(e).__name__}: {e}")
        return None


def get_text(
    url: str,
    *,
    source: str | None = None,
    headers: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
) -> str | None:
    """GET a URL and return the response body as text, or None on failure."""
    try:
        resp = _request(
            "GET",
            url,
            source=source,
            params=None,
            headers=headers,
            timeout=timeout,
            retries=retries,
            rate=None,
            auth=None,
        )
        return resp.text
    except (CircuitOpenError, RateLimitedError) as e:
        logger.debug(f"Skipping {url}: {type(e).__name__}")
        return None
    except (httpx.HTTPError, ConnectionError, OSError) as e:
        logger.debug(f"GET(text) {url} failed: {type(e).__name__}: {e}")
        return None


def post_json(
    url: str,
    json_body: Any,
    *,
    source: str | None = None,
    headers: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    rate: tuple[int, int] | None = None,
) -> Any | None:
    """POST a JSON body and return parsed JSON, or None on any failure."""
    try:
        resp = _request(
            "POST",
            url,
            source=source,
            params=None,
            headers=headers,
            timeout=timeout,
            retries=retries,
            rate=rate,
            auth=None,
            json_body=json_body,
        )
        return resp.json()
    except (CircuitOpenError, RateLimitedError) as e:
        logger.debug(f"Skipping {url}: {type(e).__name__}")
        return None
    except (httpx.HTTPError, ConnectionError, OSError, ValueError) as e:
        logger.debug(f"POST {url} failed: {type(e).__name__}: {e}")
        return None


def head_ok(
    url: str,
    *,
    source: str | None = None,
    headers: dict | None = None,
    timeout: float = 10.0,
    retries: int = 2,
    expected_content_type: str | None = None,
) -> bool:
    """HEAD a URL; True if 2xx (and, if given, content-type matches prefix)."""
    try:
        resp = _request(
            "HEAD",
            url,
            source=source,
            params=None,
            headers=headers,
            timeout=timeout,
            retries=retries,
            rate=None,
            auth=None,
        )
    except (CircuitOpenError, RateLimitedError, httpx.HTTPError, ConnectionError, OSError) as e:
        logger.debug(f"HEAD {url} failed: {type(e).__name__}: {e}")
        return False
    if expected_content_type:
        return resp.headers.get("content-type", "").startswith(expected_content_type)
    return True


def download(
    url: str,
    target_path: Path,
    *,
    source: str | None = None,
    timeout: float = 60.0,
    retries: int = 3,
    chunk_size: int = 8192 * 1024,
) -> Path | None:
    """Stream a (possibly large) file to ``target_path``. None on failure."""
    if source and _circuit_open(source):
        logger.debug(f"Skipping download {url}: circuit open for '{source}'")
        return None

    @retry(
        stop=stop_after_attempt(max(1, retries)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception(_is_retryable),
        reraise=True,
    )
    def _do() -> Path:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=timeout, follow_redirects=True) as client, client.stream("GET", url) as resp:
            if resp.status_code in _RETRYABLE_STATUS:
                raise _RetryableHTTP(f"{resp.status_code} from {url}")
            resp.raise_for_status()
            with open(target_path, "wb") as fh:
                for chunk in resp.iter_bytes(chunk_size):
                    fh.write(chunk)
        return target_path

    try:
        result = _do()
    except (httpx.HTTPError, ConnectionError, OSError) as e:
        if source and _counts_as_breaker_failure(e):
            _record_failure(source)
        logger.warning(f"Download {url} failed: {type(e).__name__}: {e}")
        return None
    if source:
        _record_success(source)
    return result


# =============================================================================
# Single-flight coalescing
# =============================================================================


def single_flight(key: str, producer: Callable[[], Any], *, result_ttl: int = 30, wait_timeout: float = 10.0) -> Any:
    """
    Run ``producer`` once for ``key`` even under concurrent callers.

    The first caller acquires a short-lived lock (atomic ``cache.add``), runs
    the producer, and publishes the result. Concurrent callers poll for that
    published result instead of hitting the upstream a second time. If the
    lock holder crashes, the lock TTL lets a later caller retry.

    Falls through to running the producer directly if the cache is unavailable.
    """
    lock_key = f"{_FLIGHT_LOCK_PREFIX}{key}"
    result_key = f"{_FLIGHT_RESULT_PREFIX}{key}"

    try:
        acquired = cache.add(lock_key, 1, max(1, int(wait_timeout) + 1))
    except (ConnectionError, OSError):
        return producer()

    if acquired:
        try:
            result = producer()
            with contextlib.suppress(ConnectionError, OSError):  # pragma: no cover
                cache.set(result_key, {"v": result}, result_ttl)
            return result
        finally:
            with contextlib.suppress(ConnectionError, OSError):  # pragma: no cover
                cache.delete(lock_key)

    # Someone else is producing: poll for their result.
    deadline = time.monotonic() + wait_timeout
    while time.monotonic() < deadline:
        published = cache.get(result_key)
        if published is not None:
            return published["v"]
        if cache.get(lock_key) is None:
            break
        time.sleep(0.05)
    # Producer vanished or timed out without publishing; do it ourselves.
    return producer()
