"""
Tests for the LLM assistant (tools + agent glue).

No live model is needed: tool wrappers are tested against the real services,
agent helpers against synthetic step traces, and gating/degradation against
settings. Full agent-loop behavior (tool selection by a real model) is covered
by the e2e verification in the plan, not here.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from django.test import override_settings

from skyspy.services.assistant import agent, tools

# ---------------------------------------------------------------------------
# Tool wrappers — every tool returns a valid, compact JSON string and never raises
# ---------------------------------------------------------------------------


class TestToolShapes:
    def test_no_arg_and_hours_tools_return_json(self, db):
        for fn in [
            tools.platform_activity,
            tools.safety_summary,
            tools.flight_patterns,
            tools.geographic_breakdown,
            tools.time_comparison,
            tools.acars_summary,
            tools.collection_stats,
            tools.live_traffic_summary,
        ]:
            out = fn() if fn.__name__ in ("time_comparison", "collection_stats", "live_traffic_summary") else fn(24)
            assert isinstance(out, str), fn.__name__
            json.loads(out)  # must parse

    def test_search_tools_return_json(self, db):
        assert json.loads(tools.lookup_airframe("ABC123")) is not None
        assert json.loads(tools.lookup_route("AAL100")) is not None
        assert json.loads(tools.find_sightings("ABC123", 24)) is not None
        assert json.loads(tools.find_safety_events(24)) is not None
        assert json.loads(tools.find_incidents("N12345")) is not None
        assert json.loads(tools.semantic_airframe_search("trust owned jet", 3)) is not None

    def test_new_insight_tools_return_json(self, db):
        # Correlation: no fields → matrix; both fields → scatter; bad field → error.
        assert json.loads(tools.metric_correlations()) is not None
        assert json.loads(tools.metric_correlations("altitude_baro", "distance_nm", 24)) is not None
        assert "error" in json.loads(tools.metric_correlations("bogus", "distance_nm"))
        # Detection tools resolve identifiers; unknown ones return a clean error.
        assert "error" in json.loads(tools.aircraft_track("ZZZZZZ"))
        assert "error" in json.loads(tools.identify_law_enforcement("ZZZZZZ"))
        assert json.loads(tools.threat_assessment()) is not None
        assert json.loads(tools.semantic_event_search("close proximity conflict", 3)) is not None

    def test_resolve_to_hex_accepts_hex_and_us_tail(self, db):
        # A raw hex passes through; a US N-number resolves deterministically even
        # when the aircraft was never tracked and isn't in any DB.
        assert tools._resolve_to_hex("AC26D7") == "AC26D7"
        assert tools._resolve_to_hex("N882SD") == "AC26D7"
        assert tools._resolve_to_hex("not-a-plane") is None

    def test_lookup_airframe_resolves_tail_number(self, db):
        # The failing case: a tail must not be treated as an unknown ICAO hex.
        data = json.loads(tools.lookup_airframe("N882SD"))
        assert "error" not in data
        assert data["icao_hex"] == "AC26D7"

    def test_track_pattern_flags_orbit(self):
        # A closed loop (returns near its start after a long path) → orbit_or_loiter.
        import math

        loop = [
            {"lat": 34.0 + 0.05 * math.sin(t), "lon": -118.0 + 0.05 * math.cos(t), "vertical_rate": 0}
            for t in [i * math.pi / 6 for i in range(13)]
        ]
        assert tools._track_pattern(loop)["orbit_or_loiter"] is True
        # A straight departing line does not.
        line = [{"lat": 34.0 + 0.2 * i, "lon": -118.0, "vertical_rate": -4000} for i in range(6)]
        pat = tools._track_pattern(line)
        assert pat["orbit_or_loiter"] is False
        assert pat["rapid_descent"] is True

    def test_guard_converts_exceptions_to_error_json(self):
        # Force the underlying service to raise; the guard must return error JSON.
        with patch("skyspy.services.stats_cache.calculate_history_stats", side_effect=RuntimeError("boom")):
            out = tools.platform_activity(24)
        data = json.loads(out)
        assert "error" in data and data["tool"] == "platform_activity"

    def test_result_is_capped(self):
        big = {"x": "y" * 20000}
        out = tools._json(big)
        assert len(out) <= tools._MAX_RESULT_CHARS + 40
        assert "_truncated" in out

    def test_hours_clamped(self):
        assert tools._clamp_hours(99999) == 720
        assert tools._clamp_hours(0) == 1
        assert tools._clamp_hours("bad") == 24


# ---------------------------------------------------------------------------
# get_tools() — LangChain wrapping (requires langchain; skip if unavailable)
# ---------------------------------------------------------------------------


class TestGetTools:
    def test_wraps_all_functions_with_descriptions(self):
        pytest.importorskip("langchain_core")
        lc_tools = tools.get_tools()
        assert len(lc_tools) == len(tools.TOOL_FUNCS)
        names = {t.name for t in lc_tools}
        assert {"platform_activity", "semantic_airframe_search", "lookup_airframe"} <= names
        # Every tool exposes a non-empty description (the docstring the model reads).
        assert all(t.description for t in lc_tools)

    def test_compact_descriptions_are_shorter(self):
        pytest.importorskip("langchain_core")
        full = {t.name: t.description for t in tools.get_tools(compact=False)}
        compact = {t.name: t.description for t in tools.get_tools(compact=True)}
        assert full.keys() == compact.keys()
        # Compact keeps every tool but trims each multi-sentence docstring.
        assert all(d for d in compact.values())
        assert all(len(compact[n]) <= len(full[n]) for n in full)
        assert sum(len(d) for d in compact.values()) < sum(len(d) for d in full.values())


class TestCompactMode:
    @override_settings(ASSISTANT_CONTEXT_WINDOW=0)
    def test_large_window_is_not_compact(self):
        assert agent.compact_mode() is False

    @override_settings(ASSISTANT_CONTEXT_WINDOW=8192)
    def test_small_window_is_compact(self):
        assert agent.compact_mode() is True

    @override_settings(ASSISTANT_CONTEXT_WINDOW=8192, ASSISTANT_MAX_RESULT_CHARS=6000)
    def test_compact_shrinks_result_cap(self):
        assert tools._max_result_chars() == tools._COMPACT_RESULT_CHARS

    @override_settings(ASSISTANT_CONTEXT_WINDOW=8192, ASSISTANT_MAX_HISTORY_MSGS=16, ASSISTANT_MAX_HISTORY_CHARS=3000)
    def test_compact_trims_history(self):
        history = [{"role": "user", "content": "x" * 5000} for _ in range(20)]
        out = agent._normalize_history(history)
        assert len(out) <= 4
        assert all(len(m["content"]) <= 800 for m in out)

    # ---------------------------------------------------------------------------
    # Agent helpers + gating
    # ---------------------------------------------------------------------------

    @staticmethod
    def _tool_msg(name, content, call_id="c1"):
        class ToolMessage:  # name-based detection in agent._tool_messages
            def __init__(self):
                self.name = name
                self.content = content
                self.tool_call_id = call_id
                self.tool_calls = []

        return ToolMessage()

    @staticmethod
    def _ai_msg(tool_calls):
        m = MagicMock()
        m.__class__.__name__ = "AIMessage"
        m.tool_calls = tool_calls
        return m

    def test_extract_sources_from_messages(self):
        messages = [
            self._ai_msg([{"id": "c1", "name": "lookup_airframe", "args": {"icao_hex": "A835AF"}}]),
            self._tool_msg("lookup_airframe", json.dumps({"icao_hex": "A835AF", "registration": "N628TS"}), "c1"),
            self._tool_msg("semantic_airframe_search", json.dumps({"results": [{"icao_hex": "ABC123"}]}), "c2"),
            self._tool_msg("platform_activity", json.dumps({"total": 5}), "c3"),  # no icao/reg -> ignored
        ]
        keys = {s["icao_hex"] for s in agent._extract_sources(messages)}
        assert "A835AF" in keys and "ABC123" in keys

    def test_summarize_steps(self):
        messages = [
            self._ai_msg([{"id": "c1", "name": "safety_summary", "args": {"hours": 24}}]),
            self._tool_msg("safety_summary", '{"total_events":3}', "c1"),
        ]
        summ = agent._summarize_steps(messages)
        assert summ[0]["tool"] == "safety_summary"
        assert summ[0]["args"] == {"hours": 24}

    @override_settings(ASSISTANT_ENABLED=False)
    def test_unavailable_when_disabled(self):
        assert agent.is_available() is False
        assert agent.ask("anything")["status"] == "unavailable"

    @override_settings(ASSISTANT_ENABLED=True, LLM_ENABLED=True, LLM_API_URL="http://vllm:8000/v1", LLM_API_KEY="")
    def test_available_for_local_endpoint_without_key(self):
        assert agent.is_available() is True

    @override_settings(
        ASSISTANT_ENABLED=True, LLM_ENABLED=True, LLM_API_URL="https://api.openai.com/v1", LLM_API_KEY=""
    )
    def test_unavailable_for_remote_without_key(self):
        assert agent.is_available() is False

    def test_empty_query(self):
        assert agent.ask("   ")["status"] == "empty_query"


# ---------------------------------------------------------------------------
# Golden coverage — the toolset must cover the intents we expect to be asked
# ---------------------------------------------------------------------------


class TestGoldenCoverage:
    @pytest.mark.parametrize(
        "keyword,expected_tool",
        [
            ("military", "geographic_breakdown"),
            ("safety", "safety_summary"),
            ("trust", "semantic_airframe_search"),
            ("route", "lookup_route"),
            ("incident", "find_incidents"),
            ("acars", "acars_summary"),
        ],
    )
    def test_intent_has_a_tool(self, keyword, expected_tool):
        by_name = {fn.__name__: (fn.__doc__ or "") for fn in tools.TOOL_FUNCS}
        assert expected_tool in by_name
        # The concept appears somewhere in the toolset's descriptions.
        assert any(keyword.lower() in doc.lower() for doc in by_name.values())
