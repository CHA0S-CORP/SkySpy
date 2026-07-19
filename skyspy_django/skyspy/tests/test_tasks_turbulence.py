"""
Tests for the per-aircraft turbulence scoring Celery task.
"""

from django.core.cache import cache

from skyspy.tasks import turbulence as turb_task
from skyspy.tasks.turbulence import CACHE_KEY_BY_HEX, score_aircraft_turbulence


def test_score_empty_when_no_aircraft():
    cache.set("current_aircraft", [])
    result = score_aircraft_turbulence()
    assert result["status"] == "empty"
    assert cache.get(CACHE_KEY_BY_HEX) == {}


def test_score_flags_only_nonzero(monkeypatch):
    cache.set(
        "current_aircraft",
        [
            {"hex": "abc123", "lat": 40.0, "lon": -100.0, "alt_baro": 35000},
            {"hex": "def456", "lat": 41.0, "lon": -101.0, "alt_baro": 10000},
            {"hex": "", "lat": 42.0, "lon": -102.0},  # no hex -> skipped
            {"hex": "no0pos", "alt_baro": 5000},  # no position -> skipped
        ],
    )

    def fake_assess(lat, lon, alt):
        if round(lat) == 40:
            return {"score": 72, "level": "severe", "sources": {}}
        return {"score": 5, "level": "none", "sources": {}}

    monkeypatch.setattr("skyspy.services.turbulence.assess_turbulence", fake_assess)

    result = score_aircraft_turbulence()
    assert result["status"] == "ok"
    assert result["scored"] == 2  # two with position
    by_hex = cache.get(CACHE_KEY_BY_HEX)
    # Only the severe aircraft is cached (none-level dropped to keep the map compact).
    assert by_hex == {"ABC123": {"score": 72, "level": "severe"}}


def test_score_disabled(monkeypatch):
    monkeypatch.setattr(turb_task.settings, "TURB_ENABLED", False)
    assert score_aircraft_turbulence()["status"] == "disabled"
