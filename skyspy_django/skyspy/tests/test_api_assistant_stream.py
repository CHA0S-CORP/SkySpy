"""
Error-path tests for the assistant API endpoints — especially the SSE stream.

The happy path of the agent loop is covered in
test_services_assistant_agent_loop.py; here we prove the ENDPOINTS degrade
cleanly: disabled feature, LLM timeouts, mid-stream failures, malformed bodies,
and client aborts (including the user-contextvar reset). pytest-style only
(never APITestCase — see tests/CLAUDE.md).
"""

import json

import httpx
import pytest
from django.test import override_settings

from skyspy.services.assistant import agent
from skyspy.tests.assistant_fakes import (
    LOCAL_LLM_SETTINGS,
    ScriptedChatModel,
    final_message,
    patched_chat_openai,
    tool_call_message,
)

ASK_URL = "/api/v1/assistant/ask/"
STREAM_URL = "/api/v1/assistant/stream/"

# Endpoint tests run with the dev bypass on (DEV_MODE) so CanUseAssistant lets
# an anonymous test client through; the auth gate itself is covered separately
# below and in test_api_llm_gating.py.
DEV_LLM_SETTINGS = {**LOCAL_LLM_SETTINGS, "DEV_MODE": True}


async def _drain(resp) -> str:
    """Read a StreamingHttpResponse body — async generator streams have an
    async iterator; early-refusal responses (built from a plain list, e.g. the
    403 frame) are sync-iterable."""
    content = resp.streaming_content
    chunks = [c async for c in content] if hasattr(content, "__aiter__") else list(content)
    return b"".join(chunks).decode()


def _parse_sse(payload: str) -> list[dict]:
    """Parse SSE text into the list of data-frame dicts."""
    events = []
    for block in payload.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                text = line[len("data: ") :]
                if text and text != "{}":
                    events.append(json.loads(text))
    return events


class TestAskEndpoint:
    def test_forbidden_when_feature_disabled(self, api_client, db):
        # ASSISTANT_ENABLED=False in test settings → the permission gate 403s
        # before the agent is ever consulted.
        resp = api_client.post(ASK_URL, {"query": "hi"}, format="json")
        assert resp.status_code in (401, 403)

    def test_unavailable_when_llm_off(self, api_client, db):
        # Feature on + dev bypass, but no LLM endpoint → clean 503 body.
        with override_settings(**{**DEV_LLM_SETTINGS, "LLM_ENABLED": False}):
            resp = api_client.post(ASK_URL, {"query": "hi"}, format="json")
        assert resp.status_code == 503
        assert resp.data["status"] == "unavailable"

    def test_ok_with_scripted_agent(self, api_client, db):
        model = ScriptedChatModel([final_message("All quiet.")])
        with override_settings(**DEV_LLM_SETTINGS), patched_chat_openai(model):
            resp = api_client.post(ASK_URL, {"query": "anything up?"}, format="json")
        assert resp.status_code == 200
        assert resp.data["status"] == "ok"
        assert "All quiet" in resp.data["answer"]

    def test_llm_connect_timeout_is_5xx_not_crash(self, api_client, db):
        model = ScriptedChatModel([])
        model.raise_on_call = httpx.ConnectTimeout("connect timed out")
        with override_settings(**DEV_LLM_SETTINGS), patched_chat_openai(model):
            resp = api_client.post(ASK_URL, {"query": "hello"}, format="json")
        assert resp.status_code == 503
        assert resp.data["status"] == "error"
        assert "timed out" in resp.data["error"]

    def test_garbage_body_is_handled(self, api_client, db):
        with override_settings(**DEV_LLM_SETTINGS):
            resp = api_client.post(ASK_URL, {"query": "   "}, format="json")
        assert resp.status_code == 200
        assert resp.data["status"] == "empty_query"


class TestStreamEndpoint:
    async def test_stream_is_sse_and_finishes_with_done(self, async_client, db):
        model = ScriptedChatModel([final_message("streamed answer")])
        with override_settings(**DEV_LLM_SETTINGS), patched_chat_openai(model):
            resp = await async_client.post(
                STREAM_URL, data=json.dumps({"query": "hi"}), content_type="application/json"
            )
            assert resp["Content-Type"] == "text/event-stream"
            payload = await _drain(resp)
        events = _parse_sse(payload)
        assert events[-1]["type"] == "final"
        assert "streamed answer" in events[-1]["answer"]
        assert "event: done" in payload  # explicit terminator frame

    async def test_stream_forbidden_when_feature_disabled(self, async_client, db):
        # Feature off → the stream 403s with an error frame, never a hang.
        resp = await async_client.post(STREAM_URL, data=json.dumps({"query": "hi"}), content_type="application/json")
        assert resp.status_code == 403
        payload = await _drain(resp)
        events = _parse_sse(payload)
        assert any(e["type"] == "error" for e in events)

    async def test_stream_unavailable_when_llm_off(self, async_client, db):
        with override_settings(**{**DEV_LLM_SETTINGS, "LLM_ENABLED": False}):
            resp = await async_client.post(
                STREAM_URL, data=json.dumps({"query": "hi"}), content_type="application/json"
            )
            payload = await _drain(resp)
        events = _parse_sse(payload)
        assert any(e["type"] == "unavailable" for e in events)

    async def test_llm_failure_mid_stream_emits_error_and_ends(self, async_client, db):
        model = ScriptedChatModel([])
        model.raise_on_call = httpx.ReadTimeout("read timed out")
        with override_settings(**DEV_LLM_SETTINGS), patched_chat_openai(model):
            resp = await async_client.post(
                STREAM_URL, data=json.dumps({"query": "hi"}), content_type="application/json"
            )
            payload = await _drain(resp)
        events = _parse_sse(payload)
        # A clean error event, then the stream terminates (no hang, no 500).
        assert any(e["type"] == "error" for e in events)
        assert "event: done" in payload

    async def test_malformed_json_body_treated_as_empty(self, async_client, db):
        with override_settings(**DEV_LLM_SETTINGS):
            resp = await async_client.post(STREAM_URL, data="{not json", content_type="application/json")
            payload = await _drain(resp)
        events = _parse_sse(payload)
        # Empty query → error event, not a crash.
        assert events and events[-1]["type"] in ("error", "unavailable")

    async def test_get_method_rejected(self, async_client, db):
        resp = await async_client.get(STREAM_URL)
        assert resp.status_code == 405


class TestStreamAbort:
    async def test_client_abort_resets_user_contextvar(self, db):
        """Closing the generator mid-stream must run agent.astream's finally
        (reset_current_user) — a leaked contextvar would cross-contaminate the
        next request's owner-scoped tools."""
        from skyspy.services.assistant import tools as tool_mod

        model = ScriptedChatModel(
            [
                tool_call_message("live_traffic_summary", {}, "call_1"),
                final_message("never fully consumed"),
            ]
        )
        with override_settings(**LOCAL_LLM_SETTINGS), patched_chat_openai(model):
            gen = agent.astream("hello")
            first = await gen.__anext__()
            assert first["type"] in ("tool", "token")
            await gen.aclose()
        assert tool_mod._get_user() is None

    async def test_abort_before_any_event_is_clean(self, db):
        model = ScriptedChatModel([final_message("unused")])
        with override_settings(**LOCAL_LLM_SETTINGS), patched_chat_openai(model):
            gen = agent.astream("hello")
            await gen.aclose()  # closed before first __anext__ — must not raise
