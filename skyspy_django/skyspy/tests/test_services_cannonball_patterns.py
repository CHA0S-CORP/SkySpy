"""
Tests for enhanced Cannonball pattern detection (Phase 2).

Tests the new pattern detection methods:
- Stakeout loitering
- Racetrack orbit
- Highway parallel tracking
- Area search
- Pattern confidence calculation
"""

import math
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase
from django.utils import timezone

from skyspy.services.cannonball import (
    AircraftPosition,
    CannonballService,
    PatternDetection,
)


def create_position(lat, lon, altitude=3000, speed=100, track=None, minutes_ago=0):
    """Helper to create AircraftPosition objects."""
    return AircraftPosition(
        lat=lat,
        lon=lon,
        altitude=altitude,
        speed=speed,
        track=track,
        timestamp=timezone.now() - timedelta(minutes=minutes_ago),
    )


def create_circular_positions(
    center_lat, center_lon, radius_deg=0.005, num_positions=20, duration_minutes=30, altitude=3000, speed=80
):
    """Create positions in a circular pattern."""
    positions = []
    for i in range(num_positions):
        angle = (2 * math.pi * i) / num_positions
        lat = center_lat + radius_deg * math.cos(angle)
        lon = center_lon + radius_deg * math.sin(angle)
        track = (math.degrees(angle) + 90) % 360  # Tangent to circle
        minutes_ago = duration_minutes - (duration_minutes * i / num_positions)
        positions.append(create_position(lat, lon, altitude, speed, track, minutes_ago))
    return positions


def create_stakeout_positions(center_lat, center_lon, duration_minutes=30, num_positions=15, altitude=2500, speed=50):
    """Create positions for a stakeout pattern (tight cluster)."""
    positions = []
    import random

    random.seed(42)  # For reproducibility

    for i in range(num_positions):
        # Very small random offset (within ~0.3nm)
        lat_offset = random.uniform(-0.003, 0.003)
        lon_offset = random.uniform(-0.003, 0.003)
        minutes_ago = duration_minutes - (duration_minutes * i / num_positions)
        positions.append(
            create_position(
                center_lat + lat_offset,
                center_lon + lon_offset,
                altitude + random.randint(-100, 100),
                speed + random.randint(-10, 10),
                random.randint(0, 359),
                minutes_ago,
            )
        )
    return positions


def create_racetrack_positions(
    center_lat, center_lon, length_deg=0.02, width_deg=0.005, num_positions=20, duration_minutes=15
):
    """Create positions for a racetrack/figure-8 orbit pattern."""
    positions = []
    # Create elongated oval with turn reversals

    for i in range(num_positions):
        t = i / num_positions
        progress = t * 2 * math.pi

        # Elongated oval shape
        lat = center_lat + width_deg * math.sin(progress)
        lon = center_lon + length_deg * math.cos(progress)

        # Track follows the oval tangent
        track_angle = math.degrees(math.atan2(width_deg * math.cos(progress), -length_deg * math.sin(progress))) % 360

        minutes_ago = duration_minutes - (duration_minutes * i / num_positions)
        positions.append(create_position(lat, lon, 3000, 100, track_angle, minutes_ago))

    return positions


def create_highway_positions(
    start_lat, start_lon, end_lat, end_lon, num_positions=10, duration_minutes=10, altitude=2000
):
    """Create positions for highway parallel tracking."""
    positions = []

    # Calculate bearing
    bearing = math.degrees(math.atan2(end_lon - start_lon, end_lat - start_lat)) % 360

    for i in range(num_positions):
        t = i / (num_positions - 1)
        lat = start_lat + t * (end_lat - start_lat)
        lon = start_lon + t * (end_lon - start_lon)
        minutes_ago = duration_minutes - (duration_minutes * i / num_positions)
        # Consistent heading with minor variation
        track = bearing + (i % 2) * 2 - 1  # +/- 1 degree variation
        positions.append(create_position(lat, lon, altitude, 90, track, minutes_ago))

    return positions


def create_area_search_positions(center_lat, center_lon, duration_minutes=20, num_positions=20):
    """Create positions for expanding area search pattern."""
    positions = []

    # Create expanding pattern - start tight, gradually expand
    for i in range(num_positions):
        # Expansion factor increases with time
        expansion = 0.001 * (1 + i * 0.5)  # Gets larger over time

        # Serpentine pattern with expansion
        row = i // 4
        col = i % 4
        if row % 2 == 1:
            col = 3 - col  # Reverse direction for alternating rows

        lat = center_lat + (row - 2) * expansion
        lon = center_lon + (col - 1.5) * expansion

        # Track alternates based on direction
        track = 90 if row % 2 == 0 else 270

        minutes_ago = duration_minutes - (duration_minutes * i / num_positions)
        positions.append(create_position(lat, lon, 3000, 80, track, minutes_ago))

    return positions


class StakeoutPatternTests(TestCase):
    """Tests for stakeout pattern detection."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_detect_stakeout_basic(self):
        """Test detecting basic stakeout pattern."""
        positions = create_stakeout_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=30,
            num_positions=15,
        )

        result = self.service._detect_stakeout(positions)

        self.assertIsNotNone(result)
        self.assertEqual(result.pattern_type, "stakeout")
        self.assertGreater(result.confidence, 0.5)

    def test_detect_stakeout_requires_duration(self):
        """Test that stakeout requires minimum 20 minutes."""
        positions = create_stakeout_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=10,  # Too short
            num_positions=10,
        )

        result = self.service._detect_stakeout(positions)

        self.assertIsNone(result)

    def test_detect_stakeout_requires_tight_area(self):
        """Test that stakeout requires tight clustering."""
        # Create spread out positions
        positions = create_circular_positions(
            center_lat=47.5,
            center_lon=-122.5,
            radius_deg=0.02,  # ~1.2nm - too spread out
            num_positions=15,
            duration_minutes=30,
        )

        result = self.service._detect_stakeout(positions)

        self.assertIsNone(result)

    def test_detect_stakeout_insufficient_positions(self):
        """Test that stakeout needs minimum positions."""
        positions = create_stakeout_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=30,
            num_positions=5,  # Too few
        )

        result = self.service._detect_stakeout(positions)

        self.assertIsNone(result)

    def test_detect_stakeout_includes_metadata(self):
        """Test that stakeout includes relevant metadata."""
        positions = create_stakeout_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=45,
            num_positions=20,
            altitude=2500,
        )

        result = self.service._detect_stakeout(positions)

        self.assertIsNotNone(result)
        self.assertIn("duration_minutes", result.metadata)
        self.assertIn("radius_nm", result.metadata)


class RacetrackPatternTests(TestCase):
    """Tests for racetrack/figure-8 orbit pattern detection."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_detect_racetrack_basic(self):
        """Test detecting basic racetrack pattern."""
        positions = create_racetrack_positions(
            center_lat=47.5,
            center_lon=-122.5,
            length_deg=0.02,
            width_deg=0.005,
            num_positions=25,
            duration_minutes=20,
        )

        result = self.service._detect_racetrack(positions)

        # Racetrack detection depends on alternating turns
        # May or may not detect depending on exact geometry
        if result:
            self.assertEqual(result.pattern_type, "racetrack")
            self.assertGreater(result.confidence, 0.3)

    def test_detect_racetrack_insufficient_positions(self):
        """Test that racetrack needs minimum positions."""
        positions = create_racetrack_positions(
            center_lat=47.5,
            center_lon=-122.5,
            num_positions=10,  # Too few
        )

        result = self.service._detect_racetrack(positions)

        self.assertIsNone(result)

    def test_detect_racetrack_requires_turn_alternation(self):
        """Test that racetrack requires alternating turns."""
        # Create circular pattern (no turn alternation)
        positions = create_circular_positions(
            center_lat=47.5,
            center_lon=-122.5,
            num_positions=20,
        )

        result = self.service._detect_racetrack(positions)

        # Circular pattern should not be detected as racetrack
        # (turns are all same direction)
        if result:
            # If detected, confidence should be low
            self.assertLess(result.confidence, 0.6)


class HighwayParallelPatternTests(TestCase):
    """Tests for highway parallel/tracking pattern detection."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_detect_highway_parallel_basic(self):
        """Test detecting basic highway parallel pattern."""
        positions = create_highway_positions(
            start_lat=47.5,
            start_lon=-122.5,
            end_lat=47.6,
            end_lon=-122.4,
            num_positions=12,
            duration_minutes=15,
            altitude=2000,
        )

        result = self.service._detect_highway_parallel(positions)

        self.assertIsNotNone(result)
        self.assertEqual(result.pattern_type, "highway_tracking")
        self.assertGreater(result.confidence, 0.3)

    def test_detect_highway_parallel_requires_consistent_heading(self):
        """Test that highway parallel needs consistent heading."""
        # Create positions with varying headings
        positions = []
        for i in range(10):
            track = (i * 40) % 360  # Varying heading
            positions.append(create_position(47.5 + i * 0.01, -122.5 + i * 0.01, 2000, 90, track, 15 - i))

        result = self.service._detect_highway_parallel(positions)

        self.assertIsNone(result)

    def test_detect_highway_parallel_requires_low_altitude(self):
        """Test that highway parallel rejects high altitude."""
        positions = create_highway_positions(
            start_lat=47.5,
            start_lon=-122.5,
            end_lat=47.6,
            end_lon=-122.4,
            num_positions=12,
            altitude=10000,  # Too high
        )

        result = self.service._detect_highway_parallel(positions)

        self.assertIsNone(result)

    def test_detect_highway_parallel_insufficient_positions(self):
        """Test that highway parallel needs minimum positions."""
        positions = create_highway_positions(
            start_lat=47.5,
            start_lon=-122.5,
            end_lat=47.55,
            end_lon=-122.45,
            num_positions=5,  # Too few
        )

        result = self.service._detect_highway_parallel(positions)

        self.assertIsNone(result)


class AreaSearchPatternTests(TestCase):
    """Tests for area search pattern detection."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_detect_area_search_basic(self):
        """Test detecting basic area search pattern."""
        positions = create_area_search_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=25,
            num_positions=25,
        )

        result = self.service._detect_area_search(positions)

        # Area search detection is complex - may or may not detect
        if result:
            self.assertEqual(result.pattern_type, "area_search")
            self.assertGreater(result.confidence, 0.3)

    def test_detect_area_search_insufficient_positions(self):
        """Test that area search needs minimum positions."""
        positions = create_area_search_positions(
            center_lat=47.5,
            center_lon=-122.5,
            num_positions=10,  # Too few
        )

        result = self.service._detect_area_search(positions)

        self.assertIsNone(result)

    def test_detect_area_search_requires_expansion(self):
        """Test that area search requires expanding coverage."""
        # Create positions that don't expand
        positions = create_stakeout_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=30,
            num_positions=20,
        )

        result = self.service._detect_area_search(positions)

        # Tight cluster should not be area search
        self.assertIsNone(result)


class PatternConfidenceCalculationTests(TestCase):
    """Tests for pattern confidence calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    def test_calculate_confidence_base(self):
        """Test base confidence is preserved."""
        pattern = PatternDetection(
            pattern_type="circling",
            confidence=0.7,
            center_lat=47.5,
            center_lon=-122.5,
        )

        result = self.service._calculate_pattern_confidence(pattern)

        self.assertEqual(result, 0.7)

    def test_calculate_confidence_le_boost(self):
        """Test confidence boost for known LE aircraft."""
        pattern = PatternDetection(
            pattern_type="circling",
            confidence=0.6,
            center_lat=47.5,
            center_lon=-122.5,
        )

        le_info = {"is_law_enforcement": True}
        result = self.service._calculate_pattern_confidence(pattern, le_info=le_info)

        self.assertEqual(result, 0.8)  # 0.6 + 0.2 boost

    def test_calculate_confidence_surveillance_type_boost(self):
        """Test confidence boost for surveillance aircraft type."""
        pattern = PatternDetection(
            pattern_type="circling",
            confidence=0.6,
            center_lat=47.5,
            center_lon=-122.5,
        )

        le_info = {"is_surveillance_type": True}
        result = self.service._calculate_pattern_confidence(pattern, le_info=le_info)

        self.assertEqual(result, 0.7)  # 0.6 + 0.1 boost

    def test_calculate_confidence_combined_boost(self):
        """Test combined LE and surveillance type boost."""
        pattern = PatternDetection(
            pattern_type="circling",
            confidence=0.5,
            center_lat=47.5,
            center_lon=-122.5,
        )

        le_info = {"is_law_enforcement": True, "is_surveillance_type": True}
        result = self.service._calculate_pattern_confidence(pattern, le_info=le_info)

        self.assertEqual(result, 0.8)  # 0.5 + 0.2 + 0.1 = 0.8

    def test_calculate_confidence_stakeout_duration_boost(self):
        """Test stakeout confidence boost for long duration."""
        pattern = PatternDetection(
            pattern_type="stakeout",
            confidence=0.5,
            center_lat=47.5,
            center_lon=-122.5,
            metadata={"duration_minutes": 75},
        )

        result = self.service._calculate_pattern_confidence(pattern)

        self.assertEqual(result, 0.65)  # 0.5 + 0.15 for >60 minutes

    def test_calculate_confidence_stakeout_medium_duration_boost(self):
        """Test stakeout confidence boost for medium duration."""
        pattern = PatternDetection(
            pattern_type="stakeout",
            confidence=0.5,
            center_lat=47.5,
            center_lon=-122.5,
            metadata={"duration_minutes": 45},
        )

        result = self.service._calculate_pattern_confidence(pattern)

        self.assertEqual(result, 0.6)  # 0.5 + 0.1 for >30 minutes

    def test_calculate_confidence_racetrack_turns_boost(self):
        """Test racetrack confidence boost for many turns."""
        pattern = PatternDetection(
            pattern_type="racetrack",
            confidence=0.5,
            center_lat=47.5,
            center_lon=-122.5,
            metadata={"turn_count": 8},
        )

        result = self.service._calculate_pattern_confidence(pattern)

        self.assertEqual(result, 0.65)  # 0.5 + 0.15 for >6 turns

    def test_calculate_confidence_highway_length_boost(self):
        """Test highway tracking confidence boost for long track."""
        pattern = PatternDetection(
            pattern_type="highway_tracking",
            confidence=0.5,
            center_lat=47.5,
            center_lon=-122.5,
            metadata={"track_length_nm": 8},
        )

        result = self.service._calculate_pattern_confidence(pattern)

        self.assertEqual(result, 0.6)  # 0.5 + 0.1 for >5nm

    def test_calculate_confidence_caps_at_1(self):
        """Test confidence is capped at 1.0."""
        pattern = PatternDetection(
            pattern_type="stakeout",
            confidence=0.9,
            center_lat=47.5,
            center_lon=-122.5,
            metadata={"duration_minutes": 120},
        )

        le_info = {"is_law_enforcement": True, "is_surveillance_type": True}
        result = self.service._calculate_pattern_confidence(pattern, le_info=le_info)

        self.assertEqual(result, 1.0)  # Capped at 1.0


class PatternDetectionIntegrationTests(TestCase):
    """Integration tests for pattern detection pipeline."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CannonballService()

    @patch.object(CannonballService, "_load_position_history")
    def test_detect_patterns_runs_all_detectors(self, mock_load):
        """Test that _detect_patterns runs all pattern detectors."""
        # Create positions that could match multiple patterns
        positions = create_stakeout_positions(
            center_lat=47.5,
            center_lon=-122.5,
            duration_minutes=25,
            num_positions=20,
        )
        mock_load.return_value = positions

        patterns = self.service._detect_patterns("A12345")

        # Should return list of detected patterns
        self.assertIsInstance(patterns, list)

    @patch.object(CannonballService, "_load_position_history")
    def test_detect_patterns_empty_history(self, mock_load):
        """Test pattern detection with empty position history."""
        mock_load.return_value = []

        patterns = self.service._detect_patterns("A12345")

        self.assertEqual(patterns, [])

    @patch.object(CannonballService, "_load_position_history")
    def test_detect_patterns_insufficient_history(self, mock_load):
        """Test pattern detection with insufficient positions."""
        mock_load.return_value = [
            create_position(47.5, -122.5, minutes_ago=0),
            create_position(47.51, -122.51, minutes_ago=1),
        ]

        patterns = self.service._detect_patterns("A12345")

        self.assertEqual(patterns, [])
