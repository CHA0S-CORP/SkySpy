"""Tests for utility functions"""
import pytest
from app.core.utils import calculate_distance_nm, is_valid_position, safe_int_altitude


class TestCalculateDistance:
    """Tests for distance calculation"""

    def test_calculate_distance_same_point(self):
        """Distance between same point should be 0"""
        dist = calculate_distance_nm(47.9377, -121.9687, 47.9377, -121.9687)
        assert dist == pytest.approx(0, abs=0.001)

    def test_calculate_distance_known_distance(self):
        """Test known distance calculation"""
        # Seattle to Portland is approximately 129 nm
        dist = calculate_distance_nm(47.6062, -122.3321, 45.5152, -122.6784)
        assert dist == pytest.approx(129, abs=5)

    def test_calculate_distance_equator(self):
        """Test distance at equator (simplest case)"""
        # 1 degree longitude at equator ≈ 60 nm
        dist = calculate_distance_nm(0, 0, 0, 1)
        assert dist == pytest.approx(60, abs=1)


class TestPositionValidation:
    """Tests for position validation"""

    def test_valid_position(self):
        """Test valid position"""
        assert is_valid_position(47.9377, -121.9687) is True

    def test_invalid_latitude_high(self):
        """Test latitude > 90"""
        assert is_valid_position(91, -121.9687) is False

    def test_invalid_latitude_low(self):
        """Test latitude < -90"""
        assert is_valid_position(-91, -121.9687) is False

    def test_invalid_longitude_high(self):
        """Test longitude > 180"""
        assert is_valid_position(47.9377, 181) is False

    def test_invalid_longitude_low(self):
        """Test longitude < -180"""
        assert is_valid_position(47.9377, -181) is False

    def test_edge_case_north_pole(self):
        """Test valid North Pole position"""
        assert is_valid_position(90, 0) is True

    def test_edge_case_south_pole(self):
        """Test valid South Pole position"""
        assert is_valid_position(-90, 0) is True


class TestSafeAltitude:
    """Tests for safe altitude parsing"""

    def test_valid_altitude(self):
        """Test valid altitude string"""
        assert safe_int_altitude("35000") == 35000

    def test_invalid_altitude_non_numeric(self):
        """Test 'ground' altitude returns 0"""
        assert safe_int_altitude("ground") == 0

    def test_invalid_altitude_none(self):
        """Test None altitude"""
        assert safe_int_altitude(None) is None

    def test_negative_altitude(self):
        """Test negative altitude (below sea level)"""
        assert safe_int_altitude("-100") == -100
