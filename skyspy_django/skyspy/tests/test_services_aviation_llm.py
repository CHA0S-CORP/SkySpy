"""Tests for the LLM-backed aviation summary service.

The service is pure (no DB); the LLM client is mocked so no network is hit.
"""

from unittest.mock import patch

from skyspy.services import aviation_llm


def _stub(content):
    """Patch llm_client to be available and return a fixed completion."""
    return (
        patch.object(aviation_llm.llm_client, "is_available", return_value=True),
        patch.object(aviation_llm.llm_client, "complete", return_value={"content": content}),
    )


def test_summary_returned_and_cleaned():
    avail, complete = _stub('  "Winds light from the south, clear skies."  ')
    with avail, complete:
        out = aviation_llm.summarize_acars("20012KT", label="H1", callsign="UAL1")
    assert out == "Winds light from the south, clear skies."


def test_na_response_falls_back_to_none():
    avail, complete = _stub("N/A")
    with avail, complete:
        assert aviation_llm.explain_pirep("UA /OV SEA") is None


def test_unavailable_returns_none():
    with patch.object(aviation_llm.llm_client, "is_available", return_value=False):
        assert aviation_llm.summarize_acars("anything") is None
        assert aviation_llm.available() is False


def test_empty_text_returns_none_without_calling_llm():
    with patch.object(aviation_llm.llm_client, "complete") as complete:
        assert aviation_llm.explain("metar", "   ") is None
        complete.assert_not_called()


def test_explain_dispatches_by_kind():
    avail, complete = _stub("Runway 16L is closed for maintenance.")
    with avail, complete:
        assert aviation_llm.explain("notam", "RWY 16L CLSD") == "Runway 16L is closed for maintenance."
        assert aviation_llm.explain("weather-unknown", "x") == "Runway 16L is closed for maintenance."


def test_supported_kinds_stable():
    assert set(aviation_llm.SUPPORTED_KINDS) == {"acars", "pirep", "notam", "metar", "taf", "sigmet"}
