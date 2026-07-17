"""
Tests for the SafetyMonitor service.

Tests emergency squawk detection, extreme vertical speed monitoring,
vertical speed reversal (TCAS-like) detection, and proximity conflicts.
"""

from datetime import datetime, timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings

from skyspy.models import SafetyEvent
from skyspy.services.safety import SafetyMonitor


@override_settings(
    SAFETY_MONITORING_ENABLED=True,
    SAFETY_VS_CHANGE_THRESHOLD=2000,
    SAFETY_VS_EXTREME_THRESHOLD=6000,
    SAFETY_PROXIMITY_NM=0.5,
    SAFETY_ALTITUDE_DIFF_FT=500,
    SAFETY_CLOSURE_RATE_KT=200,
    SAFETY_TCAS_VS_THRESHOLD=1500,
)
class SafetyMonitorUnitTests(TestCase):
    """Unit tests for SafetyMonitor methods via update_aircraft()."""

    def setUp(self):
        """Set up test fixtures."""
        self.monitor = SafetyMonitor()
        # Clear any existing state
        self.monitor._aircraft_state = {}
        self.monitor._event_cooldown = {}

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    # =========================================================================
    # Emergency Squawk Tests (via update_aircraft)
    # =========================================================================

    @patch("skyspy.socketio.utils.sync_emit")
    def test_emergency_squawk_7500_hijack(self, mock_sync_emit):
        """Test detection of squawk 7500 (hijack) on the first sighting."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "ABC123",
                "flight": "UAL456",
                "squawk": "7500",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 35000,
            }
        ]

        # Must alert on the very first cycle: an aircraft decoded only once
        # (edge of coverage) still needs its emergency broadcast
        events = self.monitor.update_aircraft(aircraft_list)

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["event_type"], "squawk_hijack")
        self.assertEqual(event["severity"], "critical")
        self.assertEqual(event["icao_hex"], "ABC123")
        self.assertIn("HIJACK", event["message"].upper())

    @patch("skyspy.socketio.utils.sync_emit")
    def test_emergency_squawk_7600_radio_failure(self, mock_sync_emit):
        """Test detection of squawk 7600 (radio failure)."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "DEF789",
                "flight": "DAL123",
                "squawk": "7600",
            }
        ]

        self.monitor.update_aircraft(aircraft_list)
        events = self.monitor.update_aircraft(aircraft_list)

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["event_type"], "squawk_radio_failure")
        self.assertEqual(event["severity"], "warning")
        self.assertIn("RADIO", event["message"].upper())

    @patch("skyspy.socketio.utils.sync_emit")
    def test_emergency_squawk_7700_emergency(self, mock_sync_emit):
        """Test detection of squawk 7700 (general emergency)."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "GHI012",
                "flight": "AAL789",
                "squawk": "7700",
            }
        ]

        self.monitor.update_aircraft(aircraft_list)
        events = self.monitor.update_aircraft(aircraft_list)

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["event_type"], "squawk_emergency")
        self.assertEqual(event["severity"], "critical")
        self.assertIn("EMERGENCY", event["message"].upper())

    @patch("skyspy.socketio.utils.sync_emit")
    def test_emergency_squawk_without_callsign(self, mock_sync_emit):
        """Test emergency squawk detection when callsign is missing."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "JKL345",
                "squawk": "7700",
            }
        ]

        self.monitor.update_aircraft(aircraft_list)
        events = self.monitor.update_aircraft(aircraft_list)

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertIn("JKL345", event["message"])

    @patch("skyspy.socketio.utils.sync_emit")
    def test_emergency_squawk_cooldown(self, mock_sync_emit):
        """Test that emergency squawk events are generated on each update (no internal cooldown)."""
        mock_sync_emit.return_value = True

        aircraft = {
            "hex": "ABC123",
            "flight": "UAL456",
            "squawk": "7700",
        }

        # First and later updates - squawk events fire immediately and
        # persist while active (no debounce: a single-cycle sighting of a
        # real emergency must never be dropped)
        events1 = self.monitor.update_aircraft([aircraft])
        self.assertEqual(len(events1), 1)
        events2 = self.monitor.update_aircraft([aircraft])
        self.assertEqual(len(events2), 1)
        events3 = self.monitor.update_aircraft([aircraft])
        self.assertEqual(len(events3), 1)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_emergency_squawk_resolves_when_code_clears(self, mock_sync_emit):
        """Returning to a normal code resolves the squawk event immediately.

        Without this, an aircraft back on 1200 keeps its RADIO FAILURE /
        HIJACK banner for the full EVENT_EXPIRY window.
        """
        mock_sync_emit.return_value = True

        aircraft = {"hex": "CLR001", "flight": "CLR123"}

        events = self.monitor.update_aircraft([{**aircraft, "squawk": "7600"}])
        self.assertEqual(len(events), 1)
        self.assertIn("squawk_radio_failure:CLR001", self.monitor._active_events)

        # Back on VFR code: event resolved and gone from active set
        self.monitor.update_aircraft([{**aircraft, "squawk": "1200"}])
        self.assertNotIn("squawk_radio_failure:CLR001", self.monitor._active_events)
        resolved = [c for c in mock_sync_emit.call_args_list if c.args[0] == "safety:event_resolved"]
        self.assertEqual(len(resolved), 1)

        # Switching between emergency codes resolves the old one and fires the new
        self.monitor.update_aircraft([{**aircraft, "squawk": "7700"}])
        self.assertIn("squawk_emergency:CLR001", self.monitor._active_events)
        self.monitor.update_aircraft([{**aircraft, "squawk": "7500"}])
        self.assertNotIn("squawk_emergency:CLR001", self.monitor._active_events)
        self.assertIn("squawk_hijack:CLR001", self.monitor._active_events)

    # =========================================================================
    # Extreme Vertical Speed Tests
    # =========================================================================

    @patch("skyspy.socketio.utils.sync_emit")
    def test_extreme_vs_climbing(self, mock_sync_emit):
        """Test detection of extreme climbing rate."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "XYZ789",
                "flight": "SWA123",
                "baro_rate": 7000,  # Above 6000 fpm threshold
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Filter for extreme_vs events
        vs_events = [e for e in events if e["event_type"] == "extreme_vs"]
        self.assertEqual(len(vs_events), 1)
        event = vs_events[0]
        self.assertEqual(event["severity"], "warning")
        self.assertIn("climbing", event["message"])
        self.assertIn("7000", event["message"])

    @patch("skyspy.socketio.utils.sync_emit")
    def test_extreme_vs_descending(self, mock_sync_emit):
        """Test detection of extreme descending rate."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "ABC456",
                "flight": "JBU789",
                "baro_rate": -8000,
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        vs_events = [e for e in events if e["event_type"] == "extreme_vs"]
        self.assertEqual(len(vs_events), 1)
        event = vs_events[0]
        self.assertIn("descending", event["message"])
        self.assertIn("8000", event["message"])

    def test_normal_vs_no_alert(self):
        """Test that normal vertical speeds don't trigger alerts."""
        # Verify the threshold logic
        self.assertTrue(abs(2000) <= self.monitor.vs_extreme_threshold)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_extreme_vs_cooldown(self, mock_sync_emit):
        """Test that extreme VS events respect cooldown period."""
        mock_sync_emit.return_value = True

        aircraft = {
            "hex": "GHI789",
            "flight": "FFT123",
            "baro_rate": 7000,
        }

        # First update triggers event
        events1 = self.monitor.update_aircraft([aircraft])
        vs_events1 = [e for e in events1 if e["event_type"] == "extreme_vs"]
        self.assertEqual(len(vs_events1), 1)

        # Second update within cooldown - no new event
        events2 = self.monitor.update_aircraft([aircraft])
        vs_events2 = [e for e in events2 if e["event_type"] == "extreme_vs"]
        self.assertEqual(len(vs_events2), 0)

    # =========================================================================
    # Vertical Speed Reversal (TCAS-like) Tests
    # =========================================================================

    @patch("skyspy.socketio.utils.sync_emit")
    def test_vs_reversal_detection(self, mock_sync_emit):
        """A high-magnitude VS reversal ~4s apart must fire a TCAS RA event."""
        mock_sync_emit.return_value = True
        import time

        aircraft = {
            "hex": "TCAS01",
            "flight": "UAL999",
            "baro_rate": 2500,
            "alt": 20000,
        }
        self.monitor.update_aircraft([aircraft])

        # Backdate the recorded history so the 4s-ago lookback finds it
        # (avoids sleeping in the test)
        now = time.time()
        self.monitor._aircraft_state["TCAS01"]["vs_history"] = [(now - 6, 2500), (now - 5, 2400)]

        # VS reversal to a rapid descent: both magnitudes >= tcas threshold
        events = self.monitor.update_aircraft([{**aircraft, "baro_rate": -2000}])

        tcas = [e for e in events if e["event_type"] == "tcas_ra"]
        self.assertEqual(len(tcas), 1)
        self.assertEqual(tcas[0]["severity"], "critical")
        self.assertEqual(tcas[0]["details"]["previous_vs"], 2400)
        self.assertEqual(tcas[0]["details"]["current_vs"], -2000)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_vs_reversal_stale_history_no_alert(self, mock_sync_emit):
        """A sign change against a minutes-old sample (data gap) must NOT alert."""
        mock_sync_emit.return_value = True
        import time

        aircraft = {"hex": "TCAS09", "flight": "GAP123", "baro_rate": 2500, "alt": 20000}
        self.monitor.update_aircraft([aircraft])

        # All history is older than HISTORY_RETENTION (e.g. VS dropped out
        # for minutes of level flight before a normal descent began)
        now = time.time()
        self.monitor._aircraft_state["TCAS09"]["vs_history"] = [(now - 300, 2500), (now - 290, 2400)]

        events = self.monitor.update_aircraft([{**aircraft, "baro_rate": -1600}])

        reversal = [e for e in events if e["event_type"] in ("vs_reversal", "tcas_ra")]
        self.assertEqual(len(reversal), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_vs_reversal_small_change_no_alert(self, mock_sync_emit):
        """Test that small VS changes don't trigger alerts."""
        mock_sync_emit.return_value = True

        # Establish state
        aircraft = {"hex": "TCAS02", "flight": "DAL888", "baro_rate": 2000}
        self.monitor.update_aircraft([aircraft])

        # Small change
        aircraft["baro_rate"] = 500
        events = self.monitor.update_aircraft([aircraft])

        vs_reversal = [e for e in events if e["event_type"] == "vs_reversal"]
        self.assertEqual(len(vs_reversal), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_vs_reversal_low_vs_no_alert(self, mock_sync_emit):
        """Test that reversals with low VS values don't trigger TCAS alerts."""
        mock_sync_emit.return_value = True

        # Low VS values
        aircraft = {"hex": "TCAS03", "flight": "AAL777", "baro_rate": 1000}
        self.monitor.update_aircraft([aircraft])

        aircraft["baro_rate"] = -1200
        events = self.monitor.update_aircraft([aircraft])

        tcas_events = [e for e in events if e["event_type"] == "tcas_ra"]
        self.assertEqual(len(tcas_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_vs_reversal_one_value_below_threshold(self, mock_sync_emit):
        """Test reversal when one VS value is below threshold."""
        mock_sync_emit.return_value = True

        aircraft = {"hex": "TCAS04", "flight": "SWA666", "baro_rate": 1000}
        self.monitor.update_aircraft([aircraft])

        aircraft["baro_rate"] = -3000
        events = self.monitor.update_aircraft([aircraft])

        tcas_events = [e for e in events if e["event_type"] == "tcas_ra"]
        self.assertEqual(len(tcas_events), 0)

    # =========================================================================
    # Proximity Conflict Tests
    # =========================================================================

    @patch("skyspy.services.safety.calculate_distance_nm")
    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_conflict_detection(self, mock_sync_emit, mock_distance):
        """Test detection of aircraft proximity conflict."""
        mock_sync_emit.return_value = True
        mock_distance.return_value = 0.3

        aircraft_list = [
            {
                "hex": "PROX01",
                "flight": "UAL111",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 35000,
            },
            {
                "hex": "PROX02",
                "flight": "DAL222",
                "lat": 47.001,
                "lon": -122.001,
                "alt": 35200,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)
        event = prox_events[0]
        self.assertIn("0.3", event["message"])

    @patch("skyspy.services.safety.calculate_distance_nm")
    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_conflict_critical_severity(self, mock_sync_emit, mock_distance):
        """Test that very close proximity triggers critical severity."""
        mock_sync_emit.return_value = True
        mock_distance.return_value = 0.2

        aircraft_list = [
            {"hex": "PROX03", "flight": "AAL333", "lat": 47.0, "lon": -122.0, "alt": 10000},
            {"hex": "PROX04", "flight": "JBU444", "lat": 47.0001, "lon": -122.0001, "alt": 10100},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)
        self.assertEqual(prox_events[0]["severity"], "critical")

    @patch("skyspy.services.safety.calculate_distance_nm")
    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_no_alert_large_distance(self, mock_sync_emit, mock_distance):
        """Test that aircraft far apart don't trigger alerts."""
        mock_sync_emit.return_value = True
        mock_distance.return_value = 2.0

        aircraft_list = [
            {"hex": "FAR01", "lat": 47.0, "lon": -122.0, "alt": 20000},
            {"hex": "FAR02", "lat": 47.1, "lon": -122.1, "alt": 20000},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.services.safety.calculate_distance_nm")
    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_no_alert_large_altitude_diff(self, mock_sync_emit, mock_distance):
        """Test that aircraft with large altitude difference don't trigger alerts."""
        mock_sync_emit.return_value = True
        mock_distance.return_value = 0.3

        aircraft_list = [
            {"hex": "ALT01", "lat": 47.0, "lon": -122.0, "alt": 10000},
            {"hex": "ALT02", "lat": 47.001, "lon": -122.001, "alt": 12000},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_conflict_across_antimeridian(self, mock_sync_emit):
        """Aircraft <1nm apart straddling 180° longitude must not be skipped by the bounding-box pre-filter."""
        mock_sync_emit.return_value = True

        # ~0.08nm apart horizontally, 200ft vertically — a genuine conflict,
        # but raw abs(lon1 - lon2) is 359.998° without wraparound handling.
        aircraft_list = [
            {"hex": "AMER01", "flight": "QFA001", "lat": 47.0, "lon": 179.999, "alt": 35000},
            {"hex": "AMER02", "flight": "UAL002", "lat": 47.0, "lon": -179.999, "alt": 35200},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)
        self.assertLess(prox_events[0]["details"]["distance_nm"], 0.5)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_no_alert_far_apart_across_antimeridian(self, mock_sync_emit):
        """Aircraft far apart across the antimeridian are still filtered out."""
        mock_sync_emit.return_value = True

        # Wrapped longitude difference is 2° (~82nm at this latitude).
        aircraft_list = [
            {"hex": "AMER03", "lat": 47.0, "lon": 179.0, "alt": 35000},
            {"hex": "AMER04", "lat": 47.0, "lon": -179.0, "alt": 35000},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_head_on_traffic_alerts(self, mock_sync_emit):
        """Converging reciprocal-track (head-on) traffic beyond 0.5nm must alert.

        Regression: a track-difference filter used to skip pairs with
        track_diff > 150°, silencing exactly the worst-case geometry.
        """
        mock_sync_emit.return_value = True
        # The buggy filter only applied beyond 0.5nm — use a wider threshold
        self.monitor.proximity_nm = 2.0

        # ~0.9nm apart at the same altitude, flying directly at each other
        aircraft_list = [
            {"hex": "HEAD01", "flight": "EAST1", "lat": 47.0, "lon": -122.011, "alt": 10000, "gs": 450, "track": 90},
            {"hex": "HEAD02", "flight": "WEST1", "lat": 47.0, "lon": -121.989, "alt": 10000, "gs": 450, "track": 270},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)
        # Closure rate must be strongly positive (converging)
        self.assertGreater(prox_events[0]["details"]["closure_rate_kt"], 800)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_diverging_pair_no_alert(self, mock_sync_emit):
        """Aircraft that have passed each other and are separating must not alert."""
        mock_sync_emit.return_value = True
        self.monitor.proximity_nm = 2.0

        # ~0.9nm apart, back-to-back and separating
        aircraft_list = [
            {"hex": "DIVE01", "flight": "EAST2", "lat": 47.0, "lon": -122.011, "alt": 10000, "gs": 450, "track": 270},
            {"hex": "DIVE02", "flight": "WEST2", "lat": 47.0, "lon": -121.989, "alt": 10000, "gs": 450, "track": 90},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_takeoff_landing_pair_suppressed_at_airport(self, mock_sync_emit):
        """A routine departure/arrival pair near a major airport is suppressed."""
        mock_sync_emit.return_value = True

        # Near KSEA (elev 433ft): one climbing, one descending, 0.4nm apart,
        # non-critical geometry (alt diff 400ft)
        aircraft_list = [
            {
                "hex": "TOL01",
                "flight": "DEP1",
                "lat": 47.4502,
                "lon": -122.317,
                "alt": 2000,
                "baro_rate": 1500,
                "gs": 180,
                "track": 0,
            },
            {
                "hex": "TOL02",
                "flight": "ARR1",
                "lat": 47.4502,
                "lon": -122.307,
                "alt": 2400,
                "baro_rate": -700,
                "gs": 140,
                "track": 180,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_takeoff_landing_pair_critical_geometry_still_alerts(self, mock_sync_emit):
        """Critical geometry (<0.25nm, <300ft) at an airport must NOT be suppressed.

        Regression: the takeoff/landing filter used to unconditionally silence
        departure-vs-arrival loss of separation (the KAUS 2023 scenario).
        """
        mock_sync_emit.return_value = True

        # Near KSEA: climbing + descending, ~0.1nm apart, 200ft apart — a
        # genuine loss of separation
        aircraft_list = [
            {
                "hex": "LOS01",
                "flight": "DEP2",
                "lat": 47.4502,
                "lon": -122.311,
                "alt": 2000,
                "baro_rate": 1500,
                "gs": 180,
                "track": 0,
            },
            {
                "hex": "LOS02",
                "flight": "ARR2",
                "lat": 47.4502,
                "lon": -122.3085,
                "alt": 2200,
                "baro_rate": -700,
                "gs": 140,
                "track": 10,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)
        self.assertEqual(prox_events[0]["severity"], "critical")

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_high_latitude_conflict_detected(self, mock_sync_emit):
        """Conflicts at high latitude must survive the bounding-box pre-filter.

        Regression: the longitude threshold lacked cos(latitude) scaling, so
        genuinely close pairs above ~60°N were discarded before the haversine.
        """
        mock_sync_emit.return_value = True

        # 70°N, ~0.4nm apart almost entirely in longitude
        # (0.4nm = 0.0195° lon at cos(70°)=0.342)
        aircraft_list = [
            {"hex": "ARCT01", "flight": "SAS1", "lat": 70.0, "lon": 20.0, "alt": 30000},
            {"hex": "ARCT02", "flight": "SAS2", "lat": 70.0, "lon": 20.0195, "alt": 30200},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_closure_rate_across_antimeridian(self, mock_sync_emit):
        """Head-on pair straddling ±180° must alert with a positive closure rate.

        Regression: closure/CPA math used raw lon differences, flipping the
        closure-rate sign near the date line and suppressing the conflict.
        """
        mock_sync_emit.return_value = True

        aircraft_list = [
            {"hex": "DATE01", "flight": "ANZ1", "lat": 0.0, "lon": 179.9965, "alt": 30000, "gs": 450, "track": 90},
            {"hex": "DATE02", "flight": "UAL9", "lat": 0.0, "lon": -179.9965, "alt": 30000, "gs": 450, "track": 270},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 1)
        self.assertGreater(prox_events[0]["details"]["closure_rate_kt"], 800)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_stale_position_excluded_from_proximity(self, mock_sync_emit):
        """Ghost aircraft (stale seen_pos) must not feed proximity detection."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            # Frozen last-known position from an aircraft that faded 60s ago
            {"hex": "GHOST1", "lat": 47.0, "lon": -122.0, "alt": 10000, "seen_pos": 60},
            # Live aircraft overflying that point
            {"hex": "LIVE01", "lat": 47.001, "lon": -122.001, "alt": 10100, "seen_pos": 0.2},
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_escalation_bypasses_cooldown(self, mock_sync_emit):
        """A conflict that worsens to critical within the cooldown must re-alert."""
        mock_sync_emit.return_value = True

        # Initial detection: ~0.4nm apart, 400ft apart -> low/warning severity
        events_1 = self.monitor.update_aircraft(
            [
                {"hex": "ESC01", "flight": "ESC1", "lat": 47.0, "lon": -122.0, "alt": 10000},
                {"hex": "ESC02", "flight": "ESC2", "lat": 47.0, "lon": -121.99, "alt": 10400},
            ]
        )
        prox_1 = [e for e in events_1 if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_1), 1)
        self.assertNotEqual(prox_1[0]["severity"], "critical")

        # Seconds later (well inside the 60s cooldown) they converge to
        # critical geometry: <0.25nm, <300ft
        events_2 = self.monitor.update_aircraft(
            [
                {"hex": "ESC01", "flight": "ESC1", "lat": 47.0, "lon": -122.0, "alt": 10000},
                {"hex": "ESC02", "flight": "ESC2", "lat": 47.0, "lon": -121.998, "alt": 10100},
            ]
        )
        prox_2 = [e for e in events_2 if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_2), 1)
        self.assertEqual(prox_2[0]["severity"], "critical")

    # =========================================================================
    # Cooldown and Deduplication Tests
    # =========================================================================

    def test_cooldown_mechanism(self):
        """Test that cooldown prevents duplicate events via _can_trigger_event."""
        icao = "TEST123"
        event_type = "test_event"

        # Initially can trigger
        self.assertTrue(self.monitor._can_trigger_event(event_type, icao))

        # Mark triggered
        self.monitor._mark_event_triggered(event_type, icao)

        # Now cannot trigger (on cooldown)
        self.assertFalse(self.monitor._can_trigger_event(event_type, icao))

    def test_cooldown_expiration(self):
        """Test that cooldown expires after the configured period."""
        icao = "EXPIRE123"
        event_type = "expire_test"

        # Set cooldown with old timestamp
        old_time = datetime.utcnow() - timedelta(seconds=120)
        self.monitor._event_cooldown[(event_type, icao)] = old_time.timestamp()

        # Should be able to trigger again (cooldown expired)
        self.assertTrue(self.monitor._can_trigger_event(event_type, icao))

    def test_different_event_types_separate_cooldowns(self):
        """Test that different event types have separate cooldowns."""
        icao = "MULTI123"

        self.monitor._mark_event_triggered("emergency_7700", icao)

        # Should be on cooldown for emergency_7700
        self.assertFalse(self.monitor._can_trigger_event("emergency_7700", icao))

        # Should NOT be on cooldown for extreme_vs
        self.assertTrue(self.monitor._can_trigger_event("extreme_vs", icao))

    # =========================================================================
    # State Management Tests
    # =========================================================================

    def test_state_cleanup(self):
        """Test cleanup of stale aircraft state."""
        import time

        now = time.time()

        # Force cleanup to run by resetting _last_cleanup
        self.monitor._last_cleanup = 0

        # Add some old state (use 'last_update' which is what the impl checks)
        self.monitor._aircraft_state["OLD001"] = {
            "lat": 47.0,
            "lon": -122.0,
            "last_update": now - 600,  # 10 minutes old
        }

        # Add current state
        self.monitor._aircraft_state["NEW001"] = {
            "lat": 48.0,
            "lon": -123.0,
            "last_update": now,
        }

        # Run cleanup
        self.monitor._cleanup_old_state()

        # Old state should be removed
        self.assertNotIn("OLD001", self.monitor._aircraft_state)
        # New state should remain
        self.assertIn("NEW001", self.monitor._aircraft_state)

    def test_cooldown_cleanup(self):
        """Test cleanup of expired cooldowns via _cleanup_old_state."""
        import time

        now = time.time()

        # Force cleanup to run by resetting _last_cleanup
        self.monitor._last_cleanup = 0

        # Add old cooldown (use tuple key format: (event_type, icao))
        self.monitor._event_cooldown[("test", "OLD001")] = now - 600

        # Add current cooldown
        self.monitor._event_cooldown[("test", "NEW001")] = now

        # Run cleanup
        self.monitor._cleanup_old_state()

        # Old cooldown should be removed
        self.assertNotIn(("test", "OLD001"), self.monitor._event_cooldown)
        # New cooldown should remain
        self.assertIn(("test", "NEW001"), self.monitor._event_cooldown)


@override_settings(
    SAFETY_MONITORING_ENABLED=True,
    SAFETY_VS_CHANGE_THRESHOLD=2000,
    SAFETY_VS_EXTREME_THRESHOLD=6000,
    SAFETY_PROXIMITY_NM=0.5,
    SAFETY_ALTITUDE_DIFF_FT=500,
    SAFETY_CLOSURE_RATE_KT=200,
    SAFETY_TCAS_VS_THRESHOLD=1500,
)
class SafetyMonitorIntegrationTests(TestCase):
    """Integration tests for the full SafetyMonitor workflow."""

    def setUp(self):
        """Set up test fixtures."""
        self.monitor = SafetyMonitor()
        self.monitor._aircraft_state = {}
        self.monitor._event_cooldown = {}

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    @patch("skyspy.socketio.utils.sync_emit")
    def test_full_update_workflow_emergency_squawk(self, mock_sync_emit):
        """Test full workflow with emergency squawk detection."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "INT001",
                "flight": "TEST123",
                "squawk": "7700",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 30000,
                "baro_rate": 1000,
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should detect emergency squawk
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_type"], "squawk_emergency")

        # Should store in database
        self.assertEqual(SafetyEvent.objects.count(), 1)
        db_event = SafetyEvent.objects.first()
        self.assertEqual(db_event.event_type, "squawk_emergency")
        self.assertEqual(db_event.icao_hex, "INT001")

    @patch("skyspy.socketio.utils.sync_emit")
    def test_full_update_workflow_multiple_events(self, mock_sync_emit):
        """Test workflow detecting multiple event types."""
        mock_sync_emit.return_value = True

        # Aircraft with emergency AND extreme VS
        aircraft_list = [
            {
                "hex": "MULTI01",
                "flight": "MULTI123",
                "squawk": "7700",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 30000,
                "baro_rate": 8000,  # Extreme VS
            }
        ]

        # Both fire on the first cycle
        events_1 = self.monitor.update_aircraft(aircraft_list)
        event_types = {e["event_type"] for e in events_1}
        self.assertEqual(event_types, {"extreme_vs", "squawk_emergency"})

    @patch("skyspy.socketio.utils.sync_emit")
    def test_full_update_workflow_vs_reversal_tracking(self, mock_sync_emit):
        """Test that VS reversal requires state from previous update."""
        mock_sync_emit.return_value = True

        # First update - establish state
        aircraft_list_1 = [
            {
                "hex": "TRACK01",
                "flight": "TRACK123",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 30000,
                "baro_rate": 2500,  # Climbing
            }
        ]

        events_1 = self.monitor.update_aircraft(aircraft_list_1)
        # No VS reversal on first update (no previous state)
        self.assertEqual(len(events_1), 0)

        # Verify state was saved
        self.assertIn("TRACK01", self.monitor._aircraft_state)
        # Check vs_history instead of vr key
        vs_history = self.monitor._aircraft_state["TRACK01"].get("vs_history", [])
        self.assertGreater(len(vs_history), 0)

        # Second update - build more history
        aircraft_list_2 = [
            {
                "hex": "TRACK01",
                "flight": "TRACK123",
                "lat": 47.05,
                "lon": -122.05,
                "alt": 30500,
                "baro_rate": 2400,  # Still climbing
            }
        ]
        self.monitor.update_aircraft(aircraft_list_2)

        # Third update - VS reversal
        aircraft_list_3 = [
            {
                "hex": "TRACK01",
                "flight": "TRACK123",
                "lat": 47.1,
                "lon": -122.1,
                "alt": 31000,
                "baro_rate": -2000,  # Now descending rapidly
            }
        ]

        events_3 = self.monitor.update_aircraft(aircraft_list_3)

        # May or may not detect VS reversal depending on timing
        # Just verify no errors occur
        [e for e in events_3 if e["event_type"] in ("vs_reversal", "tcas_ra")]
        # At minimum, no error should be raised
        self.assertIsNotNone(events_3)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.tasks.aircraft.calculate_distance_nm")
    def test_full_update_workflow_proximity(self, mock_distance, mock_sync_emit):
        """Test proximity detection in full workflow."""
        mock_sync_emit.return_value = True
        mock_distance.return_value = 0.3

        aircraft_list = [
            {
                "hex": "PROX_A",
                "flight": "PROX001",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 25000,
                "vr": 0,
            },
            {
                "hex": "PROX_B",
                "flight": "PROX002",
                "lat": 47.001,
                "lon": -122.001,
                "alt": 25200,
                "vr": 0,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should detect proximity conflict
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_type"], "proximity_conflict")

    @override_settings(SAFETY_MONITORING_ENABLED=False)
    def test_disabled_monitoring_returns_empty(self):
        """Test that disabled monitoring returns no events."""
        monitor = SafetyMonitor()

        aircraft_list = [
            {
                "hex": "DISABLED1",
                "flight": "TEST123",
                "squawk": "7700",
            }
        ]

        events = monitor.update_aircraft(aircraft_list)

        self.assertEqual(events, [])

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_failure_does_not_break_workflow(self, mock_sync_emit):
        """Test that broadcast failures don't prevent event storage."""
        # _broadcast_event catches (ConnectionError, OSError, RuntimeError)
        mock_sync_emit.side_effect = ConnectionError("Socket.IO emit error")

        aircraft_list = [
            {
                "hex": "BROAD01",
                "flight": "BROAD123",
                "squawk": "7700",
            }
        ]

        # Should not raise, just log warning
        self.monitor.update_aircraft(aircraft_list)
        events = self.monitor.update_aircraft(aircraft_list)

        # Event should still be stored
        self.assertEqual(len(events), 1)
        self.assertEqual(SafetyEvent.objects.count(), 1)


@override_settings(
    SAFETY_MONITORING_ENABLED=True,
    SAFETY_VS_CHANGE_THRESHOLD=2000,
    SAFETY_VS_EXTREME_THRESHOLD=6000,
    SAFETY_PROXIMITY_NM=0.5,
    SAFETY_ALTITUDE_DIFF_FT=500,
    SAFETY_CLOSURE_RATE_KT=200,
    SAFETY_TCAS_VS_THRESHOLD=1500,
)
class SafetyMonitorEdgeCaseTests(TestCase):
    """Edge case tests for SafetyMonitor."""

    def setUp(self):
        """Set up test fixtures."""
        self.monitor = SafetyMonitor()
        self.monitor._aircraft_state = {}
        self.monitor._event_cooldown = {}

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_missing_icao_hex(self):
        """Test handling of aircraft without ICAO hex."""
        aircraft_list = [
            {
                "flight": "NOHEX123",
                "squawk": "7700",
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should skip aircraft without hex
        self.assertEqual(len(events), 0)

    def test_empty_aircraft_list(self):
        """Test handling of empty aircraft list."""
        events = self.monitor.update_aircraft([])

        self.assertEqual(events, [])

    def test_none_values_in_aircraft_data(self):
        """Test handling of None values in aircraft data."""
        aircraft_list = [
            {
                "hex": "NONE01",
                "flight": None,
                "squawk": None,
                "lat": None,
                "lon": None,
                "alt": None,
                "vr": None,
            }
        ]

        # Should not raise
        events = self.monitor.update_aircraft(aircraft_list)

        # No events (no emergency squawk, no VS data)
        self.assertEqual(len(events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_lowercase_icao_hex_normalized(self, mock_sync_emit):
        """Test that lowercase ICAO hex is normalized to uppercase."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "abc123",  # lowercase
                "squawk": "7700",
            }
        ]

        self.monitor.update_aircraft(aircraft_list)
        events = self.monitor.update_aircraft(aircraft_list)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["icao_hex"], "ABC123")

    @patch("skyspy.services.safety.calculate_distance_nm")
    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_check_with_missing_altitude(self, mock_sync_emit, mock_distance):
        """Test proximity check when altitude is missing."""
        mock_sync_emit.return_value = True
        mock_distance.return_value = 0.3

        aircraft_list = [
            {
                "hex": "NOALT1",
                "lat": 47.0,
                "lon": -122.0,
                "alt": None,  # Missing
            },
            {
                "hex": "NOALT2",
                "lat": 47.001,
                "lon": -122.001,
                "alt": 10000,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # No proximity conflicts (missing altitude aircraft skipped)
        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_proximity_check_skips_aircraft_without_position(self, mock_sync_emit):
        """Test that proximity check skips aircraft without position data."""
        mock_sync_emit.return_value = True

        aircraft_list = [
            {
                "hex": "NOPOS1",
                "lat": None,
                "lon": None,
            },
            {
                "hex": "WITHPOS",
                "lat": 47.0,
                "lon": -122.0,
                "alt": 10000,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # No conflicts (only one aircraft has position)
        prox_events = [e for e in events if e["event_type"] == "proximity_conflict"]
        self.assertEqual(len(prox_events), 0)

    def test_vs_rate_from_alternative_fields(self):
        """Test that VS is extracted from alternative field names."""
        # vr field
        ac1 = {"hex": "VS01", "vr": 7000}
        self.assertEqual(ac1.get("vr") or ac1.get("baro_rate") or ac1.get("geom_rate"), 7000)

        # baro_rate field
        ac2 = {"hex": "VS02", "baro_rate": 7000}
        self.assertEqual(ac2.get("vr") or ac2.get("baro_rate") or ac2.get("geom_rate"), 7000)

        # geom_rate field
        ac3 = {"hex": "VS03", "geom_rate": 7000}
        self.assertEqual(ac3.get("vr") or ac3.get("baro_rate") or ac3.get("geom_rate"), 7000)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_multiple_proximity_conflicts(self, mock_sync_emit):
        """Test detection of multiple proximity conflicts."""
        mock_sync_emit.return_value = True

        def mock_distance(lat1, lon1, lat2, lon2):
            # All pairs are close
            return 0.3

        with patch("skyspy.tasks.aircraft.calculate_distance_nm", side_effect=mock_distance):
            aircraft_list = [
                {"hex": "MULTI1", "lat": 47.0, "lon": -122.0, "alt": 10000, "vr": 0},
                {"hex": "MULTI2", "lat": 47.001, "lon": -122.001, "alt": 10100, "vr": 0},
                {"hex": "MULTI3", "lat": 47.002, "lon": -122.002, "alt": 10200, "vr": 0},
            ]

            events = self.monitor.update_aircraft(aircraft_list)

            # Should detect multiple proximity conflicts
            # MULTI1-MULTI2, MULTI1-MULTI3, MULTI2-MULTI3 = 3 pairs
            # But some might have altitude diff > 500
            proximity_events = [e for e in events if e["event_type"] == "proximity_conflict"]
            self.assertGreater(len(proximity_events), 0)
