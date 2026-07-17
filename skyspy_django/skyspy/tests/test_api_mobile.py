"""
Unit tests for the mobile threat detection helper (MobileViewSet._get_nearby_threats).

Focus: trend and closing-speed must be derived from each aircraft's OWN previous
distance to the user, so a stationary observer still sees a closing aircraft as
"approaching" (regression — it previously used the user's previous position and so a
stationary user always saw "holding").
"""

import pytest
from django.core.cache import cache

from skyspy.api.mobile import MobileViewSet

# A law-enforcement helicopter that identify_law_enforcement() flags as a threat.
LE_HELICOPTER = {
    "hex": "A11111",
    "flight": "N911PD",
    "lat": 47.60,
    "lon": -122.00,
    "alt_baro": 1500,
    "gs": 120,
    "category": "A7",
    "t": "EC35",
    "ownOp": "Police Department",
}

USER_LAT = 47.50
USER_LON = -122.00


def _threats(previous_distances=None, time_delta_seconds=None, aircraft=None):
    cache.set("current_aircraft", aircraft if aircraft is not None else [dict(LE_HELICOPTER)])
    view = MobileViewSet()
    return view._get_nearby_threats(
        USER_LAT,
        USER_LON,
        radius_nm=25,
        previous_distances=previous_distances,
        time_delta_seconds=time_delta_seconds,
    )


def test_threat_detected_and_distance_positive():
    threats = _threats()
    assert len(threats) == 1
    assert threats[0]["hex"] == "A11111"
    assert threats[0]["distance_nm"] > 0
    # No history yet → trend unknown, no closing speed
    assert threats[0]["trend"] == "unknown"
    assert threats[0]["closing_speed"] is None


def test_stationary_user_sees_approaching_when_aircraft_closes():
    """Regression: user does not move, aircraft's own previous distance was larger."""
    current = _threats()[0]["distance_nm"]
    threats = _threats(previous_distances={"A11111": current + 1.0})
    assert threats[0]["trend"] == "approaching"


def test_stationary_user_sees_departing_when_aircraft_recedes():
    current = _threats()[0]["distance_nm"]
    threats = _threats(previous_distances={"A11111": current - 1.0})
    assert threats[0]["trend"] == "departing"


def test_holding_within_hysteresis():
    current = _threats()[0]["distance_nm"]
    # Change under the 0.05nm hysteresis band
    threats = _threats(previous_distances={"A11111": current + 0.01})
    assert threats[0]["trend"] == "holding"


def test_closing_speed_and_eta_computed():
    current = _threats()[0]["distance_nm"]
    # Closed ~0.5nm over 10s → ~180 kt closing (current is rounded to 2dp, so approx)
    threats = _threats(previous_distances={"A11111": current + 0.5}, time_delta_seconds=10)
    assert threats[0]["closing_speed"] == pytest.approx(180.0, abs=5)
    assert threats[0]["eta_seconds"] is not None
    assert threats[0]["eta_seconds"] > 0


def test_no_closing_speed_when_receding():
    current = _threats()[0]["distance_nm"]
    threats = _threats(previous_distances={"A11111": current - 0.5}, time_delta_seconds=10)
    assert threats[0]["closing_speed"] == pytest.approx(-180.0, abs=5)
    # Receding → no ETA
    assert threats[0]["eta_seconds"] is None
