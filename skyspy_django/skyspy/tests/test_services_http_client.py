"""
Tests for the shared HTTP client (services/http_client.py).

Covers retry-on-transient, no-retry-on-4xx, distributed rate limiting,
circuit breaker, and single-flight coalescing. httpx is patched at the
module boundary; time.sleep is neutralized so tenacity backoff is instant.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache

from skyspy.services import http_client


def _response(status_code=200, json_data=None, headers=None):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.json.return_value = json_data if json_data is not None else {}

    def raise_for_status():
        if status_code >= 400:
            raise httpx.HTTPStatusError("err", request=MagicMock(), response=resp)

    resp.raise_for_status.side_effect = raise_for_status
    return resp


def _patch_client(side_effect):
    """Patch httpx.Client so .request() yields from side_effect (list or callable)."""
    client = MagicMock()
    client.request.side_effect = side_effect
    cm = MagicMock()
    cm.__enter__.return_value = client
    cm.__exit__.return_value = False
    return patch.object(http_client.httpx, "Client", return_value=cm), client


@pytest.fixture(autouse=True)
def _no_sleep():
    with patch("time.sleep"):
        yield


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


class TestRetry:
    def test_retries_5xx_then_succeeds(self):
        seq = [_response(503), _response(200, {"ok": True})]
        cm_patch, client = _patch_client(seq)
        with cm_patch:
            result = http_client.get_json("https://x/y", retries=3)
        assert result == {"ok": True}
        assert client.request.call_count == 2

    def test_no_retry_on_404(self):
        cm_patch, client = _patch_client([_response(404)])
        with cm_patch:
            result = http_client.get_json("https://x/y", retries=3)
        assert result is None
        assert client.request.call_count == 1

    def test_gives_up_after_retries(self):
        cm_patch, client = _patch_client(lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectTimeout("t")))
        with cm_patch:
            result = http_client.get_json("https://x/y", retries=3)
        assert result is None
        assert client.request.call_count == 3


class TestRateLimit:
    def test_window_blocks_over_limit(self):
        cm_patch, client = _patch_client(lambda *a, **k: _response(200, {"n": 1}))
        with cm_patch:
            r1 = http_client.get_json("https://x/y", source="src", rate=(2, 60))
            r2 = http_client.get_json("https://x/y", source="src", rate=(2, 60))
            r3 = http_client.get_json("https://x/y", source="src", rate=(2, 60))
        assert r1 == {"n": 1}
        assert r2 == {"n": 1}
        assert r3 is None  # third call blocked by the window
        assert client.request.call_count == 2


class TestCircuitBreaker:
    def test_opens_after_threshold(self):
        cm_patch, client = _patch_client(lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
        with cm_patch:
            for _ in range(http_client._CB_FAIL_THRESHOLD):
                http_client.get_json("https://x/y", source="flaky", retries=1)
            calls_before = client.request.call_count
            # Breaker is now open: next call must fast-fail without hitting httpx.
            result = http_client.get_json("https://x/y", source="flaky", retries=1)
        assert result is None
        assert http_client._circuit_open("flaky") is True
        assert client.request.call_count == calls_before

    def test_success_resets_failures(self):
        http_client._record_failure("s1")
        http_client._record_failure("s1")
        http_client._record_success("s1")
        assert cache.get(f"{http_client._CB_FAIL_PREFIX}s1") is None


class TestSingleFlight:
    def test_producer_runs_once_and_caches(self):
        calls = {"n": 0}

        def produce():
            calls["n"] += 1
            return {"v": calls["n"]}

        first = http_client.single_flight("key1", produce, result_ttl=30)
        assert first == {"v": 1}
        assert calls["n"] == 1

    def test_falls_through_when_cache_down(self):
        with patch.object(http_client.cache, "add", side_effect=ConnectionError):
            result = http_client.single_flight("key2", lambda: "direct")
        assert result == "direct"
