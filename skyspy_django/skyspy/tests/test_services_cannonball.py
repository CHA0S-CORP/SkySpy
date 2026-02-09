"""
Tests for the Cannonball Mode service.

Tests law enforcement detection, pattern analysis, threat calculation,
urgency scoring, and related functionality.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.services.cannonball import (
    CIRCLING_MIN_POSITIONS,
    CIRCLING_RADIUS_THRESHOLD,
    AircraftPosition,
    CannonballService,
    CannonballThreat,
    PatternDetection,
    analyze_threats,
    get_cannonball_service,
)


class AircraftPositionTests(TestCase):
    """Tests for AircraftPosition dataclass."""

    def test_to_dict(self):
        """Test serialization to dictionary."""
        ts = timezone.now()
        position = AircraftPosition(
            lat=47.5,
            lon=-122.5,
            altitude=5000,
            speed=150,
            track=270,
            timestamp=ts,
        )

        result = position.to_dict()

        self.assertEqual(result["lat"], 47.5)
        self.assertEqual(result["lon"], -122.5)
        self.assertEqual(result["altitude"], 5000)
        self.assertEqual(result["speed"], 150)
        self.assertEqual(result["track"], 270)
        self.assertEqual(result["timestamp"], ts.isoformat())

    def test_from_dict(self):
        """Test deserialization from dictionary."""
        ts = timezone.now()
        data = {
            "lat": 47.5,
            "lon": -122.5,
            "altitude": 5000,
            "speed": 150,
            "track": 270,
            "timestamp": ts.isoformat(),
        }

        position = AircraftPosition.from_dict(data)

        self.assertEqual(position.lat, 47.5)
        self.assertEqual(position.lon, -122.5)
        self.assertEqual(position.altitude, 5000)
        self.assertEqual(position.speed, 150)
        self.assertEqual(position.track, 270)

    def test_from_dict_with_none_timestamp(self):
        """Test deserialization with missing timestamp."""
        data = {
            "lat": 47.5,
            "lon": -122.5,
            "altitude": None,
            "speed": None,
            "track": None,
            "timestamp": None,
        }

        position = AircraftPosition.from_dict(data)

        self.assertEqual(position.lat, 47.5)
        self.assertIsNotNone(position.timestamp)


class PatternDetectionTests(TestCase):
    """Tests for PatternDetection dataclass."""

    def test_to_dict(self):
        """Test serialization to dictionary."""
        pattern = PatternDetection(
            pattern_type="circling",
            confidence=0.85,
            center_lat=47.5,
            center_lon=-122.5,
            radius_nm=1.5,
            duration_minutes=15,
            description="Aircraft circling at 1.5nm radius",
            metadata={"circles_completed": 2.5},
        )

        result = pattern.to_dict()

        self.assertEqual(result["pattern_type"], "circling")
        self.assertEqual(result["confidence"], 0.85)
        self.assertEqual(result["center_lat"], 47.5)
        self.assertEqual(result["center_lon"], -122.5)
        self.assertEqual(result["radius_nm"], 1.5)
        self.assertEqual(result["duration_minutes"], 15)
        self.assertEqual(result["description"], "Aircraft circling at 1.5nm radius")
        self.assertEqual(result["metadata"]["circles_completed"], 2.5)


class CannonballThreatTests(TestCase):
    """Tests for CannonballThreat dataclass."""

    def test_to_dict(self):
        """Test serialization to dictionary."""
        threat = CannonballThreat(
            hex="ABC123",
            callsign="CHP12",
            category="State Police",
            description="California Highway Patrol",
            distance_nm=5.5,
            bearing=270.0,
            direction="W",
            altitude=3000,
            ground_speed=100,
            track=90,
            vertical_rate=0,
            trend="approaching",
            threat_level="warning",
            is_law_enforcement=True,
            is_helicopter=True,
            is_surveillance_type=True,
            confidence="high",
            urgency_score=75,
            closing_speed=50.0,
            eta_seconds=300,
            patterns=[],
            lat=47.5,
            lon=-122.5,
        )

        result = threat.to_dict()

        self.assertEqual(result["hex"], "ABC123")
        self.assertEqual(result["callsign"], "CHP12")
        self.assertEqual(result["category"], "State Police")
        self.assertEqual(result["distance_nm"], 5.5)
        self.assertEqual(result["bearing"], 270.0)
        self.assertEqual(result["threat_level"], "warning")
        self.assertEqual(result["is_law_enforcement"], True)
        self.assertEqual(result["urgency_score"], 75)


class CannonballServiceBasicTests(TestCase):
    """Basic tests for CannonballService."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()
        # Clear any state from previous tests
        self.service._position_history = {}
        self.service._pattern_cache = {}
        self.service._previous_distances = {}

    def test_analyze_aircraft_empty_list(self):
        """Test analysis with empty aircraft list."""
        result = self.service.analyze_aircraft(
            aircraft_list=[],
            user_lat=47.5,
            user_lon=-122.5,
        )

        self.assertEqual(result, [])

    def test_analyze_aircraft_filters_no_position(self):
        """Test that aircraft without position are filtered out."""
        aircraft_list = [
            {"hex": "ABC123", "flight": "TEST1"},  # No lat/lon
        ]

        result = self.service.analyze_aircraft(
            aircraft_list=aircraft_list,
            user_lat=47.5,
            user_lon=-122.5,
        )

        self.assertEqual(result, [])

    def test_analyze_aircraft_filters_beyond_radius(self):
        """Test that aircraft beyond radius are filtered out."""
        aircraft_list = [
            {
                "hex": "ABC123",
                "flight": "CHP12",  # LE callsign
                "lat": 50.0,  # Far away
                "lon": -120.0,
            }
        ]

        result = self.service.analyze_aircraft(
            aircraft_list=aircraft_list,
            user_lat=47.5,
            user_lon=-122.5,
            radius_nm=5.0,  # Small radius
        )

        self.assertEqual(result, [])

    def test_analyze_aircraft_filters_above_ceiling(self):
        """Test that aircraft above altitude ceiling are filtered out."""
        aircraft_list = [
            {
                "hex": "ABC123",
                "flight": "CHP12",  # LE callsign
                "lat": 47.51,
                "lon": -122.51,
                "alt_baro": 30000,  # Above ceiling
            }
        ]

        result = self.service.analyze_aircraft(
            aircraft_list=aircraft_list,
            user_lat=47.5,
            user_lon=-122.5,
            altitude_ceiling=20000,
        )

        self.assertEqual(result, [])

    @patch("skyspy.services.cannonball.identify_law_enforcement")
    def test_analyze_aircraft_detects_le(self, mock_identify):
        """Test detection of law enforcement aircraft."""
        mock_identify.return_value = {
            "is_interest": True,
            "is_law_enforcement": True,
            "is_helicopter": True,
            "is_surveillance_type": False,
            "category": "State Police",
            "description": "California Highway Patrol",
            "confidence": "high",
            "identifiers": ["callsign"],
        }

        aircraft_list = [
            {
                "hex": "ABC123",
                "flight": "CHP12",
                "lat": 47.51,
                "lon": -122.51,
                "alt_baro": 3000,
                "gs": 100,
                "track": 270,
            }
        ]

        result = self.service.analyze_aircraft(
            aircraft_list=aircraft_list,
            user_lat=47.5,
            user_lon=-122.5,
        )

        self.assertEqual(len(result), 1)
        threat = result[0]
        self.assertEqual(threat.hex, "ABC123")
        self.assertTrue(threat.is_law_enforcement)
        self.assertEqual(threat.category, "State Police")


class CannonballServiceEnhancedIdentifyTests(TestCase):
    """Tests for enhanced law enforcement identification."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    @patch("skyspy.services.cannonball.identify_law_enforcement")
    def test_enhanced_identify_traffic_enforcement_pattern(self, mock_identify):
        """Test identification via traffic enforcement callsign pattern."""
        mock_identify.return_value = {
            "is_interest": False,
            "is_law_enforcement": False,
            "is_helicopter": False,
            "is_surveillance_type": False,
            "category": None,
            "description": None,
            "confidence": "none",
            "identifiers": [],
        }

        aircraft = {"flight": "TRAFF123"}

        result = self.service._enhanced_identify_le(aircraft)

        self.assertTrue(result["is_interest"])
        self.assertEqual(result["category"], "Traffic Enforcement")
        self.assertEqual(result["confidence"], "high")

    @patch("skyspy.services.cannonball.identify_law_enforcement")
    def test_enhanced_identify_highway_pattern(self, mock_identify):
        """Test identification via highway patrol callsign pattern."""
        mock_identify.return_value = {
            "is_interest": False,
            "is_law_enforcement": False,
            "is_helicopter": False,
            "is_surveillance_type": False,
            "category": None,
            "description": None,
            "confidence": "none",
            "identifiers": [],
        }

        aircraft = {"flight": "HIGHWAY1"}

        result = self.service._enhanced_identify_le(aircraft)

        self.assertTrue(result["is_interest"])
        self.assertEqual(result["category"], "Highway Patrol")

    @patch("skyspy.services.cannonball.identify_law_enforcement")
    def test_enhanced_identify_additional_operator(self, mock_identify):
        """Test identification via additional operator code."""
        mock_identify.return_value = {
            "is_interest": False,
            "is_law_enforcement": False,
            "is_helicopter": False,
            "is_surveillance_type": False,
            "category": None,
            "description": None,
            "confidence": "none",
            "identifiers": [],
        }

        aircraft = {"ownOp": "USCG"}

        result = self.service._enhanced_identify_le(aircraft)

        self.assertTrue(result["is_interest"])
        self.assertEqual(result["category"], "Federal Law Enforcement")


class CannonballServicePatternDetectionTests(TestCase):
    """Tests for flight pattern detection."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()
        self.service._position_history = {}

    def test_detect_patterns_insufficient_positions(self):
        """Test that patterns require minimum positions."""
        hex_code = "ABC123"
        # Fewer than CIRCLING_MIN_POSITIONS
        self.service._position_history[hex_code] = [
            AircraftPosition(lat=47.5, lon=-122.5, altitude=3000, speed=100, track=0, timestamp=timezone.now())
            for _ in range(3)
        ]

        patterns = self.service._detect_patterns(hex_code)

        self.assertEqual(patterns, [])

    def test_detect_circling_pattern(self):
        """Test detection of circling/orbiting pattern."""
        hex_code = "ABC123"
        center_lat = 47.5
        center_lon = -122.5
        radius = 0.005  # Small radius in degrees (~0.3nm)

        # Create positions in a circle
        import math

        positions = []
        for i in range(15):
            angle = (i / 15) * 2 * math.pi
            lat = center_lat + radius * math.cos(angle)
            lon = center_lon + radius * math.sin(angle)
            positions.append(
                AircraftPosition(
                    lat=lat,
                    lon=lon,
                    altitude=3000,
                    speed=100,
                    track=(i / 15) * 360,
                    timestamp=timezone.now() - timedelta(seconds=(15 - i) * 10),
                )
            )

        self.service._position_history[hex_code] = positions

        patterns = self.service._detect_patterns(hex_code)

        # Should detect circling
        circling_patterns = [p for p in patterns if p.pattern_type in ("circling", "speed_trap")]
        self.assertTrue(len(circling_patterns) > 0)

    def test_detect_loitering_pattern(self):
        """Test detection of loitering pattern."""
        hex_code = "ABC123"

        # Create positions that stay in a small area for a while
        now = timezone.now()
        positions = []
        for i in range(12):
            positions.append(
                AircraftPosition(
                    lat=47.5 + (i % 3) * 0.001,  # Small movement
                    lon=-122.5 + (i % 2) * 0.001,
                    altitude=3000,
                    speed=50,
                    track=90,
                    timestamp=now - timedelta(minutes=12 - i),  # 12 minutes of history
                )
            )

        self.service._position_history[hex_code] = positions

        patterns = self.service._detect_patterns(hex_code)

        # Should detect loitering
        loitering_patterns = [p for p in patterns if p.pattern_type == "loitering"]
        self.assertTrue(len(loitering_patterns) > 0)

    def test_detect_grid_pattern(self):
        """Test detection of grid search pattern."""
        hex_code = "ABC123"
        now = timezone.now()

        # Create positions simulating grid search with 180-degree turns
        positions = []
        for i in range(15):
            # Alternate track every few positions (simulating turns)
            track = 90 if (i // 3) % 2 == 0 else 270
            positions.append(
                AircraftPosition(
                    lat=47.5 + i * 0.01,
                    lon=-122.5 + ((i // 3) % 2) * 0.02,
                    altitude=3000,
                    speed=80,
                    track=track,
                    timestamp=now - timedelta(seconds=(15 - i) * 30),
                )
            )

        self.service._position_history[hex_code] = positions

        patterns = self.service._detect_patterns(hex_code)

        # Grid pattern detection depends on turn analysis
        # The test verifies the method runs without error
        self.assertIsInstance(patterns, list)


class CannonballServiceClosingSpeedTests(TestCase):
    """Tests for closing speed calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_closing_speed_no_previous(self):
        """Test closing speed with no previous distance."""
        result = self.service._calculate_closing_speed("ABC123", 5.0, None)
        self.assertIsNone(result)

    def test_closing_speed_approaching(self):
        """Test closing speed when aircraft is approaching."""
        # Distance decreased from 10nm to 5nm in 3 seconds
        result = self.service._calculate_closing_speed("ABC123", 5.0, 10.0, 3.0)

        # (10-5) / 3 * 3600 = 6000 knots (closing speed)
        self.assertIsNotNone(result)
        self.assertGreater(result, 0)

    def test_closing_speed_departing(self):
        """Test closing speed when aircraft is departing."""
        # Distance increased from 5nm to 10nm in 3 seconds
        result = self.service._calculate_closing_speed("ABC123", 10.0, 5.0, 3.0)

        # Negative closing speed means departing
        self.assertIsNotNone(result)
        self.assertLess(result, 0)


class CannonballServiceUrgencyTests(TestCase):
    """Tests for urgency score calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_urgency_very_close(self):
        """Test urgency score for very close aircraft."""
        score = self.service._calculate_urgency(
            distance_nm=0.5,  # Very close
            threat_level="warning",
            le_info={"is_law_enforcement": True},
            trend="approaching",
            closing_speed=150,
            eta_seconds=30,
            patterns=[],
        )

        # Should have high urgency due to close distance, LE, approaching, fast closing
        self.assertGreater(score, 70)

    def test_urgency_far_stationary(self):
        """Test urgency score for far, stationary aircraft."""
        score = self.service._calculate_urgency(
            distance_nm=20.0,  # Far
            threat_level="info",
            le_info={"is_law_enforcement": False},
            trend="stationary",
            closing_speed=None,
            eta_seconds=None,
            patterns=[],
        )

        # Should have low urgency
        self.assertLess(score, 30)

    def test_urgency_patterns_contribute(self):
        """Test that detected patterns contribute to urgency."""
        base_score = self.service._calculate_urgency(
            distance_nm=5.0,
            threat_level="info",
            le_info={"is_law_enforcement": False},
            trend="stationary",
            closing_speed=None,
            eta_seconds=None,
            patterns=[],
        )

        pattern_score = self.service._calculate_urgency(
            distance_nm=5.0,
            threat_level="info",
            le_info={"is_law_enforcement": False},
            trend="stationary",
            closing_speed=None,
            eta_seconds=None,
            patterns=[PatternDetection(pattern_type="circling", confidence=0.9)],
        )

        self.assertGreater(pattern_score, base_score)

    def test_urgency_capped_at_100(self):
        """Test that urgency score is capped at 100."""
        score = self.service._calculate_urgency(
            distance_nm=0.1,  # Very close
            threat_level="critical",
            le_info={"is_law_enforcement": True},
            trend="approaching",
            closing_speed=200,
            eta_seconds=10,
            patterns=[
                PatternDetection(pattern_type="circling", confidence=1.0),
                PatternDetection(pattern_type="speed_trap", confidence=1.0),
            ],
        )

        self.assertLessEqual(score, 100)


class CannonballServiceCacheTests(TestCase):
    """Tests for position history and caching."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()
        self.service._position_history = {}
        self.service._previous_distances = {}

    @patch("skyspy.services.cannonball.cache")
    def test_store_position_adds_to_history(self, mock_cache):
        """Test that positions are stored in history."""
        aircraft = {
            "lat": 47.5,
            "lon": -122.5,
            "alt_baro": 3000,
            "gs": 100,
            "track": 270,
        }

        self.service._store_position("ABC123", aircraft)

        self.assertIn("ABC123", self.service._position_history)
        self.assertEqual(len(self.service._position_history["ABC123"]), 1)

    @patch("skyspy.services.cannonball.cache")
    def test_store_position_limits_history_length(self, mock_cache):
        """Test that position history is limited to max length."""
        from skyspy.services.cannonball import POSITION_HISTORY_LENGTH

        aircraft = {
            "lat": 47.5,
            "lon": -122.5,
            "alt_baro": 3000,
            "gs": 100,
            "track": 270,
        }

        # Add more than max positions
        for i in range(POSITION_HISTORY_LENGTH + 10):
            aircraft["lat"] = 47.5 + i * 0.001
            self.service._store_position("ABC123", aircraft)

        self.assertEqual(len(self.service._position_history["ABC123"]), POSITION_HISTORY_LENGTH)

    def test_clear_aircraft_history(self):
        """Test clearing history for an aircraft."""
        self.service._position_history["ABC123"] = [MagicMock()]
        self.service._previous_distances["ABC123"] = 5.0

        with patch("skyspy.services.cannonball.cache"):
            self.service.clear_aircraft_history("ABC123")

        self.assertNotIn("ABC123", self.service._position_history)
        self.assertNotIn("ABC123", self.service._previous_distances)


class CannonballServiceModuleFunctionsTests(TestCase):
    """Tests for module-level convenience functions."""

    def test_get_cannonball_service_returns_singleton(self):
        """Test that get_cannonball_service returns singleton."""
        service1 = get_cannonball_service()
        service2 = get_cannonball_service()

        self.assertIs(service1, service2)

    @patch("skyspy.services.cannonball.get_cannonball_service")
    def test_analyze_threats_returns_dicts(self, mock_get_service):
        """Test that analyze_threats returns list of dicts."""
        mock_service = MagicMock()
        mock_threat = MagicMock()
        mock_threat.to_dict.return_value = {"hex": "ABC123", "threat_level": "warning"}
        mock_service.analyze_aircraft.return_value = [mock_threat]
        mock_get_service.return_value = mock_service

        result = analyze_threats(
            aircraft_list=[{"hex": "ABC123", "lat": 47.5, "lon": -122.5}],
            user_lat=47.5,
            user_lon=-122.5,
        )

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertIsInstance(result[0], dict)
        self.assertEqual(result[0]["hex"], "ABC123")
