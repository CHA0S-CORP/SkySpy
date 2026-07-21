"""
Scripted fake chat models for exercising the real assistant agent loop
(agent.ask / agent.astream) without a live LLM.

ScriptedChatModel plays back a fixed list of AIMessages — tool-call turns first,
a plain final answer last — while the real LangGraph agent, real tools, prompt
assembly and streaming plumbing all run for real. patched_chat_openai() swaps it
in at the point agent.py constructs ChatOpenAI (a function-local import, so
patching the langchain_openai module attribute covers both _build_agent and
_force_final_answer).

Every model here terminates deterministically — no unbounded loops (see the
hanging-test landmine in tests/CLAUDE.md). LoopingToolCallModel "never finishes"
but the agent's recursion limit bounds it.
"""

import json
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

# Shared settings override for agent tests: assistant on, pointed at a local-style
# endpoint (no key needed — "vllm" in the URL passes agent.is_available()).
LOCAL_LLM_SETTINGS = {
    "ASSISTANT_ENABLED": True,
    "LLM_ENABLED": True,
    "LLM_API_URL": "http://vllm:8000/v1",
    "LLM_API_KEY": "",
    "LLM_MODEL": "test-model",
    # Keep autodetect from probing the fake endpoint during tests.
    "ASSISTANT_CONTEXT_WINDOW_AUTO": False,
}


def tool_call_message(name: str, args: dict | None = None, call_id: str = "call_1") -> AIMessage:
    """An AIMessage turn that calls one tool."""
    return AIMessage(content="", tool_calls=[{"name": name, "args": args or {}, "id": call_id, "type": "tool_call"}])


def final_message(text: str) -> AIMessage:
    """A plain final-answer turn."""
    return AIMessage(content=text)


class ScriptedChatModel(BaseChatModel):
    """Plays back a fixed script of AIMessages, one per model call.

    Records every incoming message list in ``self.calls`` (for prompt/history
    assertions) and the tools bound by the agent in ``self.bound_tools``. When
    the script runs out the last entry repeats — so a graph that makes one extra
    model call still terminates.
    """

    script: list = []
    calls: list = []
    bound_tools: list = []
    raise_on_call: Any = None  # exception instance to raise instead of answering

    def __init__(self, script: list | None = None, **kwargs):
        super().__init__(script=list(script or []), calls=[], bound_tools=[], **kwargs)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):
        self.bound_tools = list(tools)
        return self

    def _next(self, messages) -> AIMessage:
        self.calls.append(list(messages))
        if self.raise_on_call is not None:
            raise self.raise_on_call
        idx = min(len(self.calls) - 1, len(self.script) - 1)
        return self.script[idx] if self.script else AIMessage(content="")

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        msg = self._next(messages)
        if getattr(msg, "tool_calls", None):
            # One chunk carrying the whole tool call (chunked tool-call deltas
            # add nothing for a scripted fake).
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    tool_call_chunks=[
                        {
                            "name": tc["name"],
                            "args": json.dumps(tc["args"]),
                            "id": tc["id"],
                            "index": i,
                            "type": "tool_call_chunk",
                        }
                        for i, tc in enumerate(msg.tool_calls)
                    ],
                )
            )
            return
        # Word-split chunks so astream_events emits several on_chat_model_stream
        # deltas, like a real streaming backend.
        words = msg.content.split(" ") if msg.content else [""]
        for i, word in enumerate(words):
            yield ChatGenerationChunk(message=AIMessageChunk(content=word if i == 0 else f" {word}"))


class LoopingToolCallModel(ScriptedChatModel):
    """Always returns another tool call, never a final answer — deterministically
    drives the agent into its recursion limit (GraphRecursionError)."""

    tool_name: str = "live_traffic_summary"
    tool_args: dict = {}

    def _next(self, messages) -> AIMessage:
        self.calls.append(list(messages))
        return tool_call_message(self.tool_name, dict(self.tool_args), call_id=f"call_{len(self.calls)}")


@contextmanager
def patched_chat_openai(*models):
    """Patch langchain_openai.ChatOpenAI so each construction returns the next
    fake in ``models`` (last one repeats). Construction 1 is the agent LLM;
    construction 2 is the tool-less _force_final_answer synthesis LLM."""
    seq = list(models)
    count = {"n": 0}

    def _factory(**kwargs):
        model = seq[min(count["n"], len(seq) - 1)]
        count["n"] += 1
        return model

    with patch("langchain_openai.ChatOpenAI", side_effect=_factory):
        yield
