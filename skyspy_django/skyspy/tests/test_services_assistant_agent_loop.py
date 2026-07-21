"""
End-to-end tests of the assistant agent loop with a scripted fake LLM.

The REAL LangGraph agent, REAL tools, prompt assembly, streaming and salvage
paths all execute — only the model is scripted (see assistant_fakes). Covers
what the pure-helper tests in test_services_assistant.py can't: the
model→tool→observe→answer loop, astream event sequencing, the recursion-limit
synthesis fallback, and history/budget plumbing into the model's view.
"""

import json

import pytest
from django.test import override_settings

from skyspy.services.assistant import agent
from skyspy.tests.assistant_fakes import (
    LOCAL_LLM_SETTINGS,
    LoopingToolCallModel,
    ScriptedChatModel,
    final_message,
    patched_chat_openai,
    tool_call_message,
)


@pytest.fixture
def local_llm():
    with override_settings(**LOCAL_LLM_SETTINGS):
        yield


@pytest.fixture
def photo_airframe(db):
    """A hex with an AircraftInfo row + photo URL, created OUTSIDE the event
    loop (sync ORM in an async test body raises SynchronousOnlyOperation)."""
    from skyspy.tests.factories import AircraftInfoFactory

    return AircraftInfoFactory(icao_hex="A1B2C3", photo_url="https://example.com/p.jpg").icao_hex


class TestAskLoop:
    def test_multi_tool_chain_executes_real_tools(self, db, local_llm):
        model = ScriptedChatModel(
            [
                tool_call_message("live_traffic_summary", {}, "call_1"),
                tool_call_message("platform_activity", {"hours": 6}, "call_2"),
                final_message("Quiet skies: **0** aircraft tracked right now."),
            ]
        )
        with patched_chat_openai(model):
            result = agent.ask("anything up right now?")

        assert result["status"] == "ok"
        assert "Quiet skies" in result["answer"]
        ran = [s["tool"] for s in result["steps"]]
        assert ran == ["live_traffic_summary", "platform_activity"]
        # The real tools ran: their observations are valid JSON.
        for step in result["steps"]:
            assert step["result_preview"]
        # The agent bound the real toolset to the model.
        assert any(t.name == "live_traffic_summary" for t in model.bound_tools)

    def test_system_prompt_and_budget_reach_the_model(self, db, local_llm):
        model = ScriptedChatModel([final_message("hi")])
        with patched_chat_openai(model):
            agent.ask("hello")
        first_call = model.calls[0]
        system_text = "".join(getattr(m, "content", "") for m in first_call if m.type == "system")
        assert "BUDGET" in system_text
        assert str(agent._max_steps()) in system_text
        assert "SkySpy" in system_text

    def test_history_is_normalized_before_the_model_sees_it(self, db, local_llm):
        junk_history = (
            [{"role": "user", "content": f"turn {i} " + "x" * 5000} for i in range(30)]
            + [{"role": "tool", "content": "ignore me"}]
            + [{"role": "assistant", "content": ""}]
        )
        model = ScriptedChatModel([final_message("ok")])
        with patched_chat_openai(model):
            agent.ask("latest?", history=junk_history)
        seen = model.calls[0]
        human_and_ai = [m for m in seen if m.type in ("human", "ai")]
        max_msgs = agent._max_history_msgs() if hasattr(agent, "_max_history_msgs") else 16
        # Prior turns + the current query only; junk roles and empty turns dropped.
        assert len(human_and_ai) <= max_msgs + 1
        assert all(m.content for m in human_and_ai)

    def test_tool_error_becomes_observation_and_loop_continues(self, db, local_llm):
        # aircraft_track on an unresolvable identifier returns {"error": ...}
        # through _guarded; the loop must carry on to the final answer.
        model = ScriptedChatModel(
            [
                tool_call_message("aircraft_track", {"identifier": "ZZZZZZ"}, "call_1"),
                final_message("Couldn't resolve that aircraft."),
            ]
        )
        with patched_chat_openai(model):
            result = agent.ask("track ZZZZZZ")
        assert result["status"] == "ok"
        assert result["steps"][0]["tool"] == "aircraft_track"
        assert "error" in result["steps"][0]["result_preview"]
        assert "resolve" in result["answer"]

    def test_recursion_limit_synthesizes_from_gathered_data(self, db, local_llm):
        looper = LoopingToolCallModel()
        synthesizer = ScriptedChatModel([final_message("Synthesized: traffic was light.")])
        with override_settings(ASSISTANT_MAX_STEPS=2), patched_chat_openai(looper, synthesizer):
            result = agent.ask("keep digging forever")
        assert result["status"] == "ok"
        assert "Synthesized" in result["answer"]
        # The synthesis model was fed the gathered tool data.
        synth_input = "".join(str(getattr(m, "content", m)) for m in synthesizer.calls[0])
        assert "Data gathered so far" in synth_input

    def test_recursion_limit_without_synthesis_reports_incomplete(self, db, local_llm):
        looper = LoopingToolCallModel()
        broken_synth = ScriptedChatModel([])
        broken_synth.raise_on_call = RuntimeError("synthesis down")
        with override_settings(ASSISTANT_MAX_STEPS=2), patched_chat_openai(looper, broken_synth):
            result = agent.ask("keep digging forever")
        assert result["status"] == "incomplete"
        assert result["answer"]  # apology text, not empty


class TestAstreamLoop:
    async def test_event_sequence_tool_then_tokens_then_final(self, db, local_llm):
        model = ScriptedChatModel(
            [
                tool_call_message("live_traffic_summary", {}, "call_1"),
                final_message("Nothing tracked right now."),
            ]
        )
        with patched_chat_openai(model):
            events = [e async for e in agent.astream("what's up?")]

        types = [e["type"] for e in events]
        assert types[-1] == "final"
        assert "tool" in types
        assert types.index("tool") < types.index("final")
        final = events[-1]
        assert "Nothing tracked" in final["answer"]
        tool_events = [e for e in events if e["type"] == "tool"]
        assert tool_events[0]["tool"] == "live_traffic_summary"

    async def test_pre_tool_tokens_are_dropped_from_final(self, db, local_llm):
        # A token-bearing "thinking" turn before a tool call must not leak into
        # final.answer (agent clears accumulated text on tool start).
        thinking = final_message("let me check the traffic")
        thinking.tool_calls = [{"name": "live_traffic_summary", "args": {}, "id": "call_1", "type": "tool_call"}]
        model = ScriptedChatModel([thinking, final_message("Zero aircraft.")])
        with patched_chat_openai(model):
            events = [e async for e in agent.astream("count?")]
        assert "let me check" not in events[-1]["answer"]
        assert "Zero aircraft" in events[-1]["answer"]

    async def test_photo_event_from_tool_call(self, photo_airframe, local_llm):
        model = ScriptedChatModel(
            [
                tool_call_message("fetch_airframe_photo", {"aircraft": photo_airframe}, "call_1"),
                final_message("Photo shown above."),
            ]
        )
        with patched_chat_openai(model):
            events = [e async for e in agent.astream(f"show me {photo_airframe}")]
        # Whether or not a cached photo exists, the loop must complete cleanly...
        assert events[-1]["type"] == "final"
        photo_events = [e for e in events if e["type"] == "photo"]
        # ...and any photo event must carry a src for the app to render.
        for pe in photo_events:
            assert pe.get("src")

    async def test_map_event_carries_seeded_coordinates(self, transactional_db, local_llm, seeded_world):
        # transactional_db: the agent runs sync tools on worker threads, whose DB
        # connections can't see an uncommitted test transaction — transactional
        # mode commits the seeds so the threaded tool actually finds them.
        model = ScriptedChatModel(
            [
                tool_call_message("plot_tracks", {"identifiers": seeded_world["orbit_hex"]}, "call_1"),
                final_message("Track plotted."),
            ]
        )
        with patched_chat_openai(model):
            events = [e async for e in agent.astream("plot the orbiter")]
        track_events = [e for e in events if e["type"] == "radar_tracks"]
        assert track_events, "plot_tracks should emit a radar_tracks event"
        tracks = track_events[0]["tracks"]
        assert seeded_world["orbit_hex"] in tracks
        pts = tracks[seeded_world["orbit_hex"]]["pts"]
        assert len(pts) >= 4
        # Seeded orbit sits near (47.5, -122.3).
        assert abs(pts[0][0] - 47.5) < 0.1 and abs(pts[0][1] - (-122.3)) < 0.1

    async def test_recursion_limit_streams_synthesis_not_error(self, db, local_llm):
        looper = LoopingToolCallModel()
        synthesizer = ScriptedChatModel([final_message("Best-effort: nothing notable.")])
        with override_settings(ASSISTANT_MAX_STEPS=2), patched_chat_openai(looper, synthesizer):
            events = [e async for e in agent.astream("loop forever")]
        types = [e["type"] for e in events]
        assert "error" not in types
        assert types[-1] == "final"
        assert "Best-effort" in events[-1]["answer"]

    async def test_user_contextvar_reset_after_stream(self, db, local_llm):
        from skyspy.services.assistant import tools as tool_mod

        model = ScriptedChatModel([final_message("done")])
        with patched_chat_openai(model):
            async for _ in agent.astream("hello"):
                pass
        assert tool_mod._get_user() is None


class TestCompactModeLoop:
    def test_compact_prompt_and_budget_cap(self, db, local_llm):
        model = ScriptedChatModel([final_message("terse")])
        with (
            override_settings(ASSISTANT_CONTEXT_WINDOW=8000, ASSISTANT_MAX_STEPS_COMPACT=3),
            patched_chat_openai(model),
        ):
            agent.ask("hello")
        system_text = "".join(getattr(m, "content", "") for m in model.calls[0] if m.type == "system")
        # Compact prompt, compact budget — the full prompt's example blocks absent.
        assert "WORKED EXAMPLES" not in system_text
        assert "about 3 tool calls" in system_text


class TestUsageAccounting:
    def test_usage_summed_from_ai_messages(self):
        from langchain_core.messages import AIMessage, HumanMessage

        msgs = [
            HumanMessage(content="q"),
            AIMessage(content="", usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}),
            AIMessage(content="done", usage_metadata={"input_tokens": 150, "output_tokens": 30, "total_tokens": 180}),
        ]
        usage = agent._extract_usage(msgs)
        assert usage["input_tokens"] == 250
        assert usage["output_tokens"] == 50
        assert usage["total_tokens"] == 300

    def test_no_usage_metadata_returns_none(self):
        from langchain_core.messages import AIMessage

        assert agent._extract_usage([AIMessage(content="x")]) is None
        assert agent._extract_usage([]) is None


class TestValidationForgiveness:
    def test_bad_args_return_corrective_observation(self, db):
        from skyspy.services.assistant.tools import get_tools

        tool = next(t for t in get_tools() if t.name == "platform_activity")
        out = tool.run({"hours": {"not": "a number"}})
        data = json.loads(out)
        assert "invalid arguments" in data["error"]
        assert "platform_activity" in data["error"]
        assert data["expected_arguments"]

    def test_descriptions_carry_category_tags(self):
        from skyspy.services.assistant.tools import get_tools

        tools = get_tools()
        by_name = {t.name: t.description for t in tools}
        assert by_name["decode_squawk"].startswith("[aviation reference]")
        assert by_name["live_traffic_summary"].startswith("[live traffic]")
        # Compact mode keeps the tags too.
        compact = {t.name: t.description for t in get_tools(compact=True)}
        assert compact["decode_squawk"].startswith("[aviation reference]")
