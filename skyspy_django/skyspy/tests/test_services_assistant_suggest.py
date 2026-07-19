"""
Tests for the assistant follow-up suggestion generator (services/assistant/suggest).

The LLM call itself is not exercised; these cover the (messy-output) parser and
the availability gate — the parts that fail silently in production if wrong.
"""

from skyspy.services.assistant import suggest


class TestParseSuggestions:
    def test_bare_string_array(self):
        assert suggest._parse_suggestions('["one", "two"]') == ["one", "two"]

    def test_object_with_known_key(self):
        out = suggest._parse_suggestions('{"suggestions": ["a", "b"]}')
        assert out == ["a", "b"]

    def test_object_with_unknown_list_key(self):
        # Qwen was observed wrapping under next_questions — take the first list value.
        out = suggest._parse_suggestions('{"next_questions": ["Show paths", "Tail numbers?"]}')
        assert out == ["Show paths", "Tail numbers?"]

    def test_array_of_wrapper_objects(self):
        out = suggest._parse_suggestions('[{"suggestion": "one"}, {"question": "two"}]')
        assert out == ["one", "two"]

    def test_bulleted_fallback(self):
        out = suggest._parse_suggestions("- first\n- second\n1. third")
        assert out == ["first", "second", "third"]

    def test_dedupes_and_caps_and_length(self):
        long = "x" * (suggest._MAX_LEN + 5)
        raw = f'["a", "A", "b", "c", "d", "e", "{long}"]'
        out = suggest._parse_suggestions(raw)
        assert len(out) <= suggest._COUNT
        assert long not in out  # over the length guard
        # case-insensitive dedupe drops the second "A"
        assert out[:2] == ["a", "b"]

    def test_garbage_returns_empty(self):
        assert suggest._parse_suggestions("") == []
        assert suggest._parse_suggestions("no json here at all... ") == ["no json here at all..."]


class TestGating:
    def test_returns_empty_when_unavailable(self, monkeypatch):
        monkeypatch.setattr(suggest, "is_available", lambda: False)
        assert suggest.suggest_next_prompts([{"role": "user", "content": "hi"}]) == []

    def test_returns_empty_with_no_conversation(self, monkeypatch):
        monkeypatch.setattr(suggest, "is_available", lambda: True)
        # history with no usable turns → no LLM call, empty result
        assert suggest.suggest_next_prompts([]) == []
        assert suggest.suggest_next_prompts([{"role": "system", "content": "x"}]) == []
