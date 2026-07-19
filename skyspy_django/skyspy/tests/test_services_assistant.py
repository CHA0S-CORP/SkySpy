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

    def test_plot_tracks_renders_multi_aircraft(self, db):
        from skyspy.tests.factories import AircraftSightingFactory

        # No identifiers, or only unresolvable/untracked ones → clean error.
        assert "error" in json.loads(tools.plot_tracks(""))
        assert "error" in json.loads(tools.plot_tracks("ZZZZZZ"))

        # Two aircraft with stored positions → one coloured track each.
        for i in range(6):
            AircraftSightingFactory(icao_hex="ABC123", latitude=47.0 + i * 0.01, longitude=-122.0 + i * 0.01)
            AircraftSightingFactory(icao_hex="DEF456", latitude=48.0 + i * 0.01, longitude=-123.0 + i * 0.01)
        data = json.loads(tools.plot_tracks("ABC123, DEF456", 24))
        assert data["count"] == 2
        assert set(data["tracks"]) == {"ABC123", "DEF456"}
        pts = data["tracks"]["ABC123"]["pts"]
        # Compact [lat, lon, alt] points, at least a two-point line to draw.
        assert len(pts) >= 2 and len(pts[0]) == 3
        assert data["view"] == "fit"

        # A resolvable-but-untracked hex alongside a real one is reported (in
        # no_track), and an unresolvable token lands in unresolved — neither fatal.
        mixed = json.loads(tools.plot_tracks("ABC123, AAAAAA, ZZZZZZ", 24))
        assert mixed["count"] == 1
        assert mixed["no_track"] == ["AAAAAA"] and mixed["unresolved"] == ["ZZZZZZ"]

    def test_dev_reference_tools_return_json(self, db):
        # REST index is generated from the live OpenAPI schema; filtering narrows it.
        full = json.loads(tools.rest_api_reference())
        assert full["endpoints"] and full["base_url"] == "/api/v1/"
        aircraft = json.loads(tools.rest_api_reference("aircraft"))
        assert aircraft["count"] <= full["count"]
        assert all("aircraft" in (e["path"] + (e["summary"] or "")).lower() for e in aircraft["endpoints"])
        # Socket.IO reference is curated; topic filter trims the catalogs.
        sock = json.loads(tools.socketio_reference())
        assert "positions:update" in sock["broadcast_events"]
        assert "aircraft-snapshot" in sock["request_types"]
        acars = json.loads(tools.socketio_reference("acars"))
        assert all("acars" in (k + v).lower() for k, v in acars["broadcast_events"].items())

    def test_location_and_schedule_tools_return_json(self, db):
        # All return valid JSON even with no cached weather/airspace data.
        assert json.loads(tools.weather_nearby()) is not None
        assert json.loads(tools.nearby_advisories()) is not None
        # Turbulence tool: valid JSON with an assessment + at-risk list even with
        # no advisories/PIREPs cached (defaults to the receiver location).
        turb = json.loads(tools.turbulence_forecast())
        assert "assessment" in turb
        assert turb["assessment"]["level"] == "none"
        assert turb["aircraft_at_risk_count"] == 0
        assert json.loads(tools.watched_aircraft())["count"] == 0
        # Unknown aircraft → clean error, not a crash.
        assert "error" in json.loads(tools.aircraft_dossier("ZZZZZZ"))
        # Schedule API is off in tests → a note, no quota spent.
        assert "error" in json.loads(tools.flight_schedule("UAL123"))

    def test_my_alert_rules_requires_user_and_is_owner_scoped(self, db):
        from django.contrib.auth import get_user_model

        from skyspy.models.alerts import AlertRule

        # Anonymous (no bound user) → explicit note, never another user's rules.
        assert "error" in json.loads(tools.my_alert_rules())

        User = get_user_model()
        mine = User.objects.create_user(username="alice", password="x")
        other = User.objects.create_user(username="bob", password="x")
        AlertRule.objects.create(name="mil", owner=mine, rule_type="military", operator="eq", value="true")
        AlertRule.objects.create(name="bobs", owner=other, rule_type="emergency", operator="eq", value="true")

        token = tools.set_current_user(mine)
        try:
            data = json.loads(tools.my_alert_rules())
        finally:
            tools.reset_current_user(token)
        assert data["count"] == 1 and data["rules"][0]["name"] == "mil"

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


class TestBusiestTails:
    """busiest_tails ranks aircraft by distinct flights (callsigns) and flight legs."""

    def test_empty_window_returns_no_results(self, db):
        data = json.loads(tools.busiest_tails(24))
        assert data["count"] == 0 and data["results"] == []

    def test_ranks_by_unique_flights_and_resolves_registration(self, db):
        from datetime import timedelta

        from django.utils import timezone

        from skyspy.models import AircraftSighting
        from skyspy.tests.factories import AircraftInfoFactory, AircraftSightingFactory

        now = timezone.now()
        # Tail A: three distinct callsigns, and a >15-min gap → 2 flight legs.
        AircraftInfoFactory(icao_hex="AAA111", registration="N111AA")
        for cs in ("AAL1", "AAL2", "AAL3"):
            AircraftSightingFactory(icao_hex="AAA111", callsign=cs)
        # Push the AAL1 sample 30 min back so the leg split sees a gap.
        first = AircraftSighting.objects.filter(icao_hex="AAA111", callsign="AAL1").first()
        AircraftSighting.objects.filter(pk=first.pk).update(timestamp=now - timedelta(minutes=30))

        # Tail B: a single callsign → one unique flight.
        AircraftInfoFactory(icao_hex="BBB222", registration="N222BB")
        for _ in range(2):
            AircraftSightingFactory(icao_hex="BBB222", callsign="SWA9")

        data = json.loads(tools.busiest_tails(24))
        assert data["count"] == 2
        top = data["results"][0]
        assert top["icao_hex"] == "AAA111"
        assert top["registration"] == "N111AA"
        assert top["unique_flights"] == 3
        assert top["flight_legs"] == 2  # AAL1 sample split off by the 30-min gap
        assert data["results"][1]["unique_flights"] == 1

    def test_limit_caps_results(self, db):
        from skyspy.tests.factories import AircraftSightingFactory

        for i in range(4):
            AircraftSightingFactory(icao_hex=f"C0000{i}", callsign=f"CS{i}")
        data = json.loads(tools.busiest_tails(24, limit=2))
        assert data["count"] == 2


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
    @override_settings(FEEDER_LAT=47.9377, FEEDER_LON=-121.9687, ACARS_ENABLED=True, SAFETY_MONITORING_ENABLED=False)
    def test_station_context_grounds_time_and_location(self):
        ctx = json.loads(agent._station_context())
        # Receiver location the model would otherwise have to guess.
        assert ctx["receiver"] == {"lat": 47.9377, "lon": -121.9687}
        # A current-time frame of reference (LLM has no clock).
        assert ctx["utc_now"].endswith("Z") and ctx["units"].startswith("distance nm")
        # Only enabled subsystems are advertised.
        assert "acars" in ctx["features"] and "safety_monitoring" not in ctx["features"]

    @override_settings(FEEDER_LAT=1.0, FEEDER_LON=2.0, ASSISTANT_BRIEFING_ENABLED=False)
    def test_station_context_injected_even_when_briefing_disabled(self):
        # Station/time grounding is independent of the briefing toggle.
        composed = agent._compose_query("how many today?", None)
        assert "<station>" in composed and '"lat":1.0' in composed

    @override_settings(ASSISTANT_CONTEXT_WINDOW=0)
    def test_large_window_is_not_compact(self):
        assert agent.compact_mode() is False

    @override_settings(ASSISTANT_CONTEXT_WINDOW=8192)
    def test_small_window_is_compact(self):
        assert agent.compact_mode() is True

    @override_settings(ASSISTANT_CONTEXT_WINDOW=8192, ASSISTANT_MAX_RESULT_CHARS=6000)
    def test_compact_shrinks_result_cap(self):
        assert tools._max_result_chars() == tools._COMPACT_RESULT_CHARS

    @override_settings(ASSISTANT_CONTEXT_WINDOW=0, ASSISTANT_MAX_STEPS=15, ASSISTANT_MAX_STEPS_COMPACT=8)
    def test_large_window_uses_full_step_budget(self):
        assert agent._max_steps() == 15
        assert agent._recursion_limit() == 15 * 2 + 2

    @override_settings(ASSISTANT_CONTEXT_WINDOW=8192, ASSISTANT_MAX_STEPS=15, ASSISTANT_MAX_STEPS_COMPACT=8)
    def test_compact_caps_step_budget(self):
        assert agent._max_steps() == 8
        assert agent._recursion_limit() == 8 * 2 + 2

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

    # -- recursion-limit graceful degradation (was: hard 503 error, tokens lost) --

    _LOCAL_LLM = {
        "ASSISTANT_ENABLED": True,
        "LLM_ENABLED": True,
        "LLM_API_URL": "http://vllm:8000/v1",
        "LLM_API_KEY": "",
    }

    def test_ask_recursion_limit_degrades_gracefully(self):
        from langgraph.errors import GraphRecursionError

        fake = MagicMock()
        fake.invoke.side_effect = GraphRecursionError("Recursion limit of 22 reached")
        with override_settings(**self._LOCAL_LLM), patch.object(agent, "_build_agent", return_value=fake):
            result = agent.ask("keep chaining tools forever")
        # Not a hard error: a usable message with a distinct non-503 status.
        assert result["status"] == "incomplete"
        assert result["answer"]
        assert result.get("error") is None

    async def test_astream_recursion_limit_preserves_streamed_tokens(self):
        from langgraph.errors import GraphRecursionError

        async def _events(*args, **kwargs):
            chunk = MagicMock()
            chunk.content = "partial answer "
            yield {"event": "on_chat_model_stream", "data": {"chunk": chunk}}
            raise GraphRecursionError("Recursion limit of 22 reached")

        fake = MagicMock()
        fake.astream_events = _events
        with override_settings(**self._LOCAL_LLM), patch.object(agent, "_build_agent", return_value=fake):
            events = [e async for e in agent.astream("loop")]
        types = [e["type"] for e in events]
        # Streamed token survives, no error event, and we still finalize.
        assert "error" not in types
        assert types[-1] == "final"
        assert "partial answer" in events[-1]["answer"]


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


# ---------------------------------------------------------------------------
# Photo URLs the model hallucinates into the answer text are stripped — the
# real photo renders from the fetch_airframe_photo tool call, not the text.
# ---------------------------------------------------------------------------


class TestStripPhotoUrls:
    def test_strips_markdown_image(self):
        out = agent._strip_photo_urls("Photo:\n\n![A6-EDA](https://cdn.planespotters.net/x/a.jpg)\n\nAn A380.")
        assert "planespotters" not in out
        assert "!" not in out
        assert "An A380." in out

    def test_keeps_link_text_drops_image_target(self):
        out = agent._strip_photo_urls("See [this photo](https://airport-data.com/1234.jpg) of it.")
        assert out == "See this photo of it."

    def test_strips_bare_image_url(self):
        out = agent._strip_photo_urls("Photo: https://cdn.jetphotos.com/full/1_2.jpg by Jane.")
        assert "jetphotos" not in out
        assert "by Jane." in out

    def test_preserves_internal_anchor_links(self):
        text = "The A380 (hex [A6EDA](#A6EDA)) is on the [map](#map)."
        assert agent._strip_photo_urls(text) == text

    def test_empty_is_safe(self):
        assert agent._strip_photo_urls("") == ""
        assert agent._strip_photo_urls(None) is None


class TestPhotoIntent:
    @pytest.mark.parametrize(
        "query,expected",
        [
            ("show me a photo of N882SD", True),
            ("what does A6EDA look like", True),
            ("can I see a picture of ASA111", True),
            ("pull up an image of the A380", True),
            ("what is the busiest hour today", False),
            ("list military aircraft nearby", False),
            ("how many emergencies this week", False),
        ],
    )
    def test_wants_photo(self, query, expected):
        assert agent._wants_photo(query) is expected

    def test_photo_intent_injects_directive(self):
        composed = agent._compose_query("show me a photo of N882SD", None)
        assert "fetch_airframe_photo" in composed
        assert "User question:" in composed

    def test_no_directive_for_data_query(self):
        composed = agent._compose_query("how many emergencies this week", None)
        assert "fetch_airframe_photo" not in composed


class TestGroundRouteContext:
    """Ground aircraft → nearest airport, airborne → origin/dest from route_data."""

    def test_empty_list(self):
        assert agent._ground_route_context([]) == {}

    def test_grounded_aircraft_matched_to_airport(self, db):
        from skyspy.models.aviation import CachedAirport

        CachedAirport.objects.create(
            icao_id="KLAX", name="Los Angeles Intl", latitude=33.9416, longitude=-118.4085, airport_type="large"
        )
        with override_settings(FEEDER_LAT=33.94, FEEDER_LON=-118.40):
            ctx = agent._ground_route_context(
                [{"hex": "A1B2C3", "flight": "SWA100", "lat": 33.9416, "lon": -118.4085, "alt_baro": "ground"}]
            )
        assert ctx["on_ground"] == [{"cs": "SWA100", "at": "KLAX"}]

    def test_airborne_route_from_info(self, db):
        from skyspy.models.aircraft import AircraftInfo

        AircraftInfo.objects.create(
            icao_hex="DEAD01",
            route_callsign="UAL5",
            route_data={
                "callsign": "UAL5",
                "origin": {"icao": "KSFO"},
                "destination": {"icao": "KJFK"},
            },
        )
        ctx = agent._ground_route_context(
            [{"hex": "DEAD01", "flight": "UAL5", "lat": 34.0, "lon": -118.0, "alt_baro": 35000, "distance_nm": 12}]
        )
        assert ctx["departures"] == [{"cs": "UAL5", "from": "KSFO", "to": "KJFK"}]
