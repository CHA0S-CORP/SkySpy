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


def test_pirep_injects_turbulence_context():
    """explain_pirep with a position injects the turbulence-risk picture into the
    prompt so the model can corroborate the pilot report."""
    avail, complete = _stub("Moderate turbulence reported, matches G-AIRMET.")
    fake = {"level": "moderate", "score": 55, "sources": {"gairmet": [{"hazard": "TURB"}], "pireps": []}}
    with (
        avail,
        complete as complete_mock,
        patch("skyspy.services.turbulence.assess_turbulence", return_value=fake),
    ):
        out = aviation_llm.explain_pirep("UA /OV SEA /TB MOD", lat=47.5, lon=-122.3, altitude_ft=35000)
    assert out
    # The turbulence context reached the user prompt.
    user_msg = complete_mock.call_args[0][0][1]["content"]
    assert "turbulence_context" in user_msg


def test_acars_summary_injects_turbulence_context():
    """summarize_acars with a position injects the turbulence-risk picture into
    the prompt so the summary can flag rough-air conditions."""
    avail, complete = _stub("Position report over the Rockies, moderate turbulence area.")
    fake = {"level": "moderate", "score": 55, "sources": {"gairmet": [{"hazard": "TURB"}], "pireps": []}}
    with (
        avail,
        complete as complete_mock,
        patch("skyspy.services.turbulence.assess_turbulence", return_value=fake),
    ):
        out = aviation_llm.summarize_acars("POS N4000 W10500", label="H1", lat=40.0, lon=-105.0)
    assert out
    user_msg = complete_mock.call_args[0][0][1]["content"]
    assert "turbulence_context" in user_msg


def test_acars_analysis_returns_turbulence_field():
    """analyze_acars surfaces a deterministic turbulence block (not LLM-derived)
    in its structured output so the UI can render a reliable badge."""
    avail, complete = _stub('{"headline": "Position report", "summary": "Over CO", "fields": []}')
    fake = {"level": "moderate", "score": 55, "sources": {"gairmet": [{"hazard": "TURB"}], "pireps": []}}
    with (
        avail,
        complete,
        patch("skyspy.services.turbulence.assess_turbulence", return_value=fake),
    ):
        out = aviation_llm.analyze_acars("POS N4000 W10500", lat=40.0, lon=-105.0)
    assert out and out.get("turbulence") == {
        "level": "moderate",
        "score": 55,
        "gairmet_hazards": ["TURB"],
        "nearby_pirep_turb": False,
    }


def test_turbulence_context_none_when_no_position():
    assert aviation_llm._turbulence_context(None, None) is None


def test_turbulence_context_none_when_risk_none():
    with patch(
        "skyspy.services.turbulence.assess_turbulence",
        return_value={"level": "none", "score": 0, "sources": {}},
    ):
        assert aviation_llm._turbulence_context(47.5, -122.3) is None
