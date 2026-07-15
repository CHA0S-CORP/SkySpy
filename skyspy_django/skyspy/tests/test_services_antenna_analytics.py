"""
Tests for the AntennaAnalytics service.

Tests antenna performance metrics, coverage analysis,
RSSI correlation, and signal strength statistics.
"""

import math
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from skyspy.models import AircraftSighting
from skyspy.services import antenna_analytics


def _position_at_bearing(bearing_deg: float, distance_deg: float = 1.0) -> tuple[float, float]:
    """
    Get a lat/lon approximately `distance_deg` degrees away from the feeder
    at the given bearing. Polar coverage buckets by the bearing from the
    receiver to the aircraft position (not by aircraft track/heading).
    """
    rad = math.radians(bearing_deg)
    lat = settings.FEEDER_LAT + distance_deg * math.cos(rad)
    lon = settings.FEEDER_LON + distance_deg * math.sin(rad) / math.cos(math.radians(settings.FEEDER_LAT))
    return lat, lon


class PolarDataTests(TestCase):
    """Tests for polar coverage data calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_calculate_polar_data_empty(self):
        """Test polar data with no sightings."""
        result = antenna_analytics.calculate_polar_data(hours=24)

        self.assertIn("bearing_data", result)
        self.assertEqual(len(result["bearing_data"]), 36)  # 36 sectors of 10 degrees
        self.assertIn("summary", result)
        self.assertEqual(result["summary"]["total_sightings"], 0)
        self.assertEqual(result["summary"]["sectors_with_data"], 0)
        self.assertEqual(result["summary"]["coverage_pct"], 0)

    def test_calculate_polar_data_with_sightings(self):
        """Test polar data with sighting data."""
        # Create sightings northeast of the receiver
        lat, lon = _position_at_bearing(45.0)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=lat,
                longitude=lon,
                distance_nm=50.0,
                rssi=-5.0,
            )

        result = antenna_analytics.calculate_polar_data(hours=24)

        self.assertGreater(result["summary"]["total_sightings"], 0)
        self.assertGreater(result["summary"]["sectors_with_data"], 0)

    def test_calculate_polar_data_sector_coverage(self):
        """Test that sectors are correctly populated."""
        # Create sightings at different bearings from the receiver
        bearings = [0, 45, 90, 135, 180, 225, 270, 315]
        for bearing in bearings:
            lat, lon = _position_at_bearing(float(bearing))
            AircraftSighting.objects.create(
                icao_hex=f"B{bearing:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=lat,
                longitude=lon,
                distance_nm=50.0,
            )

        result = antenna_analytics.calculate_polar_data(hours=24)

        # Should have 8 sectors with data
        self.assertEqual(result["summary"]["sectors_with_data"], 8)

    def test_calculate_polar_data_rssi_stats(self):
        """Test RSSI statistics in polar data."""
        # Create sightings with varying RSSI at bearing 45 from the receiver
        lat, lon = _position_at_bearing(45.0)
        for i in range(5):
            AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=lat,
                longitude=lon,
                distance_nm=50.0,
                rssi=-5.0 - i,  # -5, -6, -7, -8, -9
            )

        result = antenna_analytics.calculate_polar_data(hours=24)

        # Find sector 4 (40-50 degrees)
        sector_4 = next((s for s in result["bearing_data"] if s["bearing_start"] == 40), None)
        self.assertIsNotNone(sector_4)
        if sector_4:
            self.assertIsNotNone(sector_4["avg_rssi"])
            self.assertIsNotNone(sector_4["min_rssi"])
            self.assertIsNotNone(sector_4["max_rssi"])

    def test_calculate_polar_data_unique_aircraft(self):
        """Test unique aircraft counting in polar data."""
        # Create multiple sightings for same aircraft at bearing 45 from the receiver
        lat, lon = _position_at_bearing(45.0)
        for i in range(5):
            AircraftSighting.objects.create(
                icao_hex="ABC001",  # Same ICAO
                timestamp=self.now - timedelta(minutes=i),
                latitude=lat,
                longitude=lon,
                distance_nm=50.0,
            )

        result = antenna_analytics.calculate_polar_data(hours=24)

        sector_4 = next((s for s in result["bearing_data"] if s["bearing_start"] == 40), None)
        self.assertIsNotNone(sector_4)
        if sector_4:
            self.assertEqual(sector_4["unique_aircraft"], 1)

    def test_calculate_polar_data_coverage_percentage(self):
        """Test coverage percentage calculation."""
        # Create sightings in 18 sectors (half coverage)
        for sector in range(0, 180, 10):  # 18 sectors
            lat, lon = _position_at_bearing(float(sector + 5))  # Middle of sector
            AircraftSighting.objects.create(
                icao_hex=f"S{sector:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=lat,
                longitude=lon,
                distance_nm=50.0,
            )

        result = antenna_analytics.calculate_polar_data(hours=24)

        # Coverage should be 50%
        self.assertEqual(result["summary"]["coverage_pct"], 50.0)


class RssiDataTests(TestCase):
    """Tests for RSSI vs distance correlation data."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_calculate_rssi_data_empty(self):
        """Test RSSI data with no sightings."""
        result = antenna_analytics.calculate_rssi_data(hours=24)

        self.assertIn("scatter_data", result)
        self.assertEqual(len(result["scatter_data"]), 0)
        self.assertIn("band_statistics", result)
        self.assertEqual(result["sample_size"], 0)

    def test_calculate_rssi_data_with_sightings(self):
        """Test RSSI data with sighting data."""
        # Create sightings with RSSI and distance
        for i in range(20):
            AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                rssi=-5.0 - (i * 0.5),
                distance_nm=10.0 + (i * 5),
            )

        result = antenna_analytics.calculate_rssi_data(hours=24)

        self.assertGreater(len(result["scatter_data"]), 0)
        self.assertGreater(result["sample_size"], 0)

    def test_calculate_rssi_data_band_statistics(self):
        """Test RSSI band statistics."""
        # Create sightings in different distance bands
        # 0-25nm band
        for i in range(5):
            AircraftSighting.objects.create(
                icao_hex=f"BN1{i:02d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                rssi=-5.0,
                distance_nm=10.0,
            )

        # 25-50nm band
        for i in range(5):
            AircraftSighting.objects.create(
                icao_hex=f"BN2{i:02d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                rssi=-10.0,
                distance_nm=35.0,
            )

        result = antenna_analytics.calculate_rssi_data(hours=24)

        # Should have band statistics
        self.assertGreater(len(result["band_statistics"]), 0)
        band_0_25 = next((b for b in result["band_statistics"] if b["band"] == "0-25nm"), None)
        self.assertIsNotNone(band_0_25)

    def test_calculate_rssi_data_trend_line(self):
        """Test trend line calculation."""
        # Create sightings with clear distance-RSSI correlation
        for i in range(20):
            AircraftSighting.objects.create(
                icao_hex=f"TRD{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                rssi=-5.0 - (i * 0.5),  # Decreasing RSSI
                distance_nm=10.0 + (i * 5),  # Increasing distance
            )

        result = antenna_analytics.calculate_rssi_data(hours=24)

        # Should have trend line with negative slope
        self.assertIsNotNone(result["trend_line"])
        if result["trend_line"]:
            self.assertIn("slope", result["trend_line"])
            self.assertIn("intercept", result["trend_line"])
            self.assertIn("interpretation", result["trend_line"])

    def test_calculate_rssi_data_sample_size(self):
        """Test sample size parameter."""
        # Create more sightings than sample size
        for i in range(100):
            AircraftSighting.objects.create(
                icao_hex=f"SAM{i:03d}",
                timestamp=self.now - timedelta(minutes=i),
                latitude=40.0,
                longitude=-74.0,
                rssi=-5.0,
                distance_nm=50.0,
            )

        result = antenna_analytics.calculate_rssi_data(hours=24, sample_size=50)

        # Sample size should be limited
        self.assertLessEqual(result["sample_size"], 50)

    def test_calculate_rssi_data_filters_zero_distance(self):
        """Test that zero distance sightings are filtered."""
        AircraftSighting.objects.create(
            icao_hex="ZERO01",
            timestamp=self.now - timedelta(hours=1),
            latitude=40.0,
            longitude=-74.0,
            rssi=-5.0,
            distance_nm=0.0,  # Zero distance
        )

        result = antenna_analytics.calculate_rssi_data(hours=24)

        self.assertEqual(result["sample_size"], 0)


class SummaryTests(TestCase):
    """Tests for antenna performance summary."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_calculate_summary_empty(self):
        """Test summary with no sightings."""
        result = antenna_analytics.calculate_summary(hours=24)

        self.assertIn("range", result)
        self.assertEqual(result["range"]["total_sightings"], 0)
        self.assertEqual(result["range"]["unique_aircraft"], 0)
        self.assertIn("signal", result)
        self.assertIn("coverage", result)
        self.assertEqual(result["coverage"]["sectors_active"], 0)

    def test_calculate_summary_with_sightings(self):
        """Test summary with sighting data."""
        for i in range(20):
            AircraftSighting.objects.create(
                icao_hex=f"SUM{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                distance_nm=50.0 + i,
                rssi=-5.0 - (i * 0.2),
            )

        result = antenna_analytics.calculate_summary(hours=24)

        self.assertEqual(result["range"]["total_sightings"], 20)
        self.assertEqual(result["range"]["unique_aircraft"], 20)
        self.assertIsNotNone(result["range"]["avg_nm"])
        self.assertIsNotNone(result["range"]["max_nm"])

    def test_calculate_summary_range_stats(self):
        """Test range statistics in summary."""
        # Create sightings at different distances
        distances = [10.0, 30.0, 50.0, 70.0, 100.0]
        for i, dist in enumerate(distances):
            AircraftSighting.objects.create(
                icao_hex=f"RNG{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                distance_nm=dist,
            )

        result = antenna_analytics.calculate_summary(hours=24)

        self.assertIsNotNone(result["range"]["min_nm"])
        self.assertIsNotNone(result["range"]["max_nm"])
        # Min should be around 10, max around 100
        self.assertAlmostEqual(result["range"]["min_nm"], 10.0, places=1)
        self.assertAlmostEqual(result["range"]["max_nm"], 100.0, places=1)

    def test_calculate_summary_signal_stats(self):
        """Test signal statistics in summary."""
        # Create sightings with varying RSSI
        rssi_values = [-3.0, -5.0, -7.0, -9.0, -11.0]
        for i, rssi in enumerate(rssi_values):
            AircraftSighting.objects.create(
                icao_hex=f"SIG{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                distance_nm=50.0,
                rssi=rssi,
            )

        result = antenna_analytics.calculate_summary(hours=24)

        self.assertIsNotNone(result["signal"]["avg_rssi"])
        self.assertIsNotNone(result["signal"]["best_rssi"])
        self.assertIsNotNone(result["signal"]["worst_rssi"])
        # Best should be -3, worst should be -11
        self.assertAlmostEqual(result["signal"]["best_rssi"], -3.0, places=1)
        self.assertAlmostEqual(result["signal"]["worst_rssi"], -11.0, places=1)

    def test_calculate_summary_coverage_stats(self):
        """Test coverage statistics in summary."""
        # Create sightings in 10 different sectors (by bearing from the receiver)
        for sector in range(0, 100, 10):
            lat, lon = _position_at_bearing(float(sector + 5))
            AircraftSighting.objects.create(
                icao_hex=f"COV{sector:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=lat,
                longitude=lon,
                distance_nm=50.0,
            )

        result = antenna_analytics.calculate_summary(hours=24)

        self.assertEqual(result["coverage"]["sectors_active"], 10)
        self.assertEqual(result["coverage"]["total_sectors"], 36)

    def test_calculate_summary_percentiles(self):
        """Test percentile calculations in summary."""
        # Create sightings at known distances
        for i in range(100):
            AircraftSighting.objects.create(
                icao_hex=f"PCT{i:03d}",
                timestamp=self.now - timedelta(minutes=i),
                latitude=40.0,
                longitude=-74.0,
                distance_nm=float(i + 1),  # 1 to 100 nm
            )

        result = antenna_analytics.calculate_summary(hours=24)

        # Should have percentile stats
        self.assertIn("p50", result["range"])
        self.assertIn("p75", result["range"])
        self.assertIn("p90", result["range"])
        self.assertIn("p95", result["range"])


class CacheManagementTests(TestCase):
    """Tests for cache management functions."""

    @patch("skyspy.services.antenna_analytics.cache")
    def test_refresh_cache(self, mock_cache):
        """Test refreshing antenna analytics cache."""
        result = antenna_analytics.refresh_cache(hours=24)

        mock_cache.set.assert_called()
        self.assertIn("polar", result)
        self.assertIn("rssi", result)
        self.assertIn("summary", result)
        self.assertIn("last_updated", result)

    @patch("skyspy.services.antenna_analytics.cache")
    def test_refresh_cache_handles_exception(self, mock_cache):
        """Test that refresh_cache handles exceptions."""
        mock_cache.set.side_effect = Exception("Cache error")

        result = antenna_analytics.refresh_cache(hours=24)

        # Should return empty dict on error
        self.assertEqual(result, {})

    @patch("skyspy.services.antenna_analytics.cache")
    def test_get_cached_data(self, mock_cache):
        """Test getting all cached antenna data."""
        mock_cache.get.side_effect = [
            {"polar": "data"},
            {"rssi": "data"},
            {"summary": "data"},
            "2024-01-01T00:00:00Z",
        ]

        result = antenna_analytics.get_cached_data()

        self.assertIn("polar", result)
        self.assertIn("rssi", result)
        self.assertIn("summary", result)
        self.assertIn("last_updated", result)

    @patch("skyspy.services.antenna_analytics.cache")
    def test_get_cached_polar(self, mock_cache):
        """Test getting cached polar data."""
        mock_cache.get.return_value = {"bearing_data": []}

        result = antenna_analytics.get_cached_polar()

        self.assertEqual(result, {"bearing_data": []})

    @patch("skyspy.services.antenna_analytics.cache")
    def test_get_cached_rssi(self, mock_cache):
        """Test getting cached RSSI data."""
        mock_cache.get.return_value = {"scatter_data": []}

        result = antenna_analytics.get_cached_rssi()

        self.assertEqual(result, {"scatter_data": []})

    @patch("skyspy.services.antenna_analytics.cache")
    def test_get_cached_summary(self, mock_cache):
        """Test getting cached summary data."""
        mock_cache.get.return_value = {"range": {}}

        result = antenna_analytics.get_cached_summary()

        self.assertEqual(result, {"range": {}})


class GetOrCalculateTests(TestCase):
    """Tests for get_or_calculate functions."""

    @patch("skyspy.services.antenna_analytics.get_cached_polar")
    def test_get_or_calculate_polar_from_cache(self, mock_get_cached):
        """Test getting polar data from cache when available."""
        mock_get_cached.return_value = {"time_range_hours": 24, "bearing_data": []}

        result = antenna_analytics.get_or_calculate_polar(hours=24)

        self.assertEqual(result, {"time_range_hours": 24, "bearing_data": []})

    @patch("skyspy.services.antenna_analytics.get_cached_polar")
    def test_get_or_calculate_polar_calculates_on_cache_miss(self, mock_get_cached):
        """Test calculating polar data when cache is empty."""
        mock_get_cached.return_value = None

        result = antenna_analytics.get_or_calculate_polar(hours=24)

        # Should calculate fresh data
        self.assertIn("bearing_data", result)
        self.assertEqual(len(result["bearing_data"]), 36)

    @patch("skyspy.services.antenna_analytics.get_cached_polar")
    def test_get_or_calculate_polar_recalculates_on_different_hours(self, mock_get_cached):
        """Test recalculating when hours differ from cached."""
        mock_get_cached.return_value = {"time_range_hours": 24, "bearing_data": []}

        result = antenna_analytics.get_or_calculate_polar(hours=12)  # Different hours

        # Should calculate fresh data for 12 hours
        self.assertEqual(result["time_range_hours"], 12)

    @patch("skyspy.services.antenna_analytics.get_cached_rssi")
    def test_get_or_calculate_rssi_from_cache(self, mock_get_cached):
        """Test getting RSSI data from cache when available."""
        mock_get_cached.return_value = {"time_range_hours": 24, "scatter_data": []}

        result = antenna_analytics.get_or_calculate_rssi(hours=24)

        self.assertEqual(result, {"time_range_hours": 24, "scatter_data": []})

    @patch("skyspy.services.antenna_analytics.get_cached_summary")
    def test_get_or_calculate_summary_from_cache(self, mock_get_cached):
        """Test getting summary from cache when available."""
        mock_get_cached.return_value = {"time_range_hours": 24, "range": {}}

        result = antenna_analytics.get_or_calculate_summary(hours=24)

        self.assertEqual(result, {"time_range_hours": 24, "range": {}})


class BroadcastTests(TestCase):
    """Tests for broadcasting functionality."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.antenna_analytics.get_cached_data")
    def test_broadcast_antenna_update(self, mock_get_cached, mock_sync_emit):
        """Test broadcasting antenna analytics update."""
        mock_get_cached.return_value = {"test": True}
        mock_sync_emit.return_value = True

        antenna_analytics.broadcast_antenna_update()

        mock_sync_emit.assert_called_once()

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_antenna_update_with_data(self, mock_sync_emit):
        """Test broadcasting with provided data."""
        mock_sync_emit.return_value = True
        data = {"polar": {}, "rssi": {}, "summary": {}}

        antenna_analytics.broadcast_antenna_update(data)

        mock_sync_emit.assert_called_once()

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_handles_exception(self, mock_sync_emit):
        """Test broadcast handles exceptions gracefully."""
        mock_sync_emit.side_effect = Exception("Socket error")

        # Should not raise
        antenna_analytics.broadcast_antenna_update({"test": True})


class EdgeCaseTests(TestCase):
    """Edge case tests for antenna analytics."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_polar_data_handles_null_position(self):
        """Test polar data skips sightings without a position."""
        AircraftSighting.objects.create(
            icao_hex="NULL01",
            timestamp=self.now - timedelta(hours=1),
            latitude=None,  # No position
            longitude=None,
            distance_nm=50.0,
        )

        result = antenna_analytics.calculate_polar_data(hours=24)

        # Should complete without error and not count the position-less sighting
        self.assertIn("bearing_data", result)
        self.assertEqual(result["summary"]["total_sightings"], 0)

    def test_rssi_data_handles_null_rssi(self):
        """Test RSSI data handles sightings without RSSI."""
        AircraftSighting.objects.create(
            icao_hex="NULL01",
            timestamp=self.now - timedelta(hours=1),
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
            rssi=None,  # No RSSI
        )

        result = antenna_analytics.calculate_rssi_data(hours=24)

        # Should complete without error, but no data
        self.assertEqual(result["sample_size"], 0)

    def test_summary_handles_null_distance(self):
        """Test summary handles sightings without distance."""
        AircraftSighting.objects.create(
            icao_hex="NULL01",
            timestamp=self.now - timedelta(hours=1),
            latitude=40.0,
            longitude=-74.0,
            distance_nm=None,  # No distance
        )

        result = antenna_analytics.calculate_summary(hours=24)

        # Should return empty summary
        self.assertEqual(result["range"]["total_sightings"], 0)

    def test_rssi_trend_line_insufficient_data(self):
        """Test trend line with insufficient data points."""
        # Create only 5 sightings (need more than 10)
        for i in range(5):
            AircraftSighting.objects.create(
                icao_hex=f"FEW{i:03d}",
                timestamp=self.now - timedelta(hours=1),
                latitude=40.0,
                longitude=-74.0,
                distance_nm=50.0,
                rssi=-5.0,
            )

        result = antenna_analytics.calculate_rssi_data(hours=24)

        # Trend line should be None with insufficient data
        self.assertIsNone(result["trend_line"])

    def test_polar_sector_boundary_360_to_0(self):
        """Test polar data handles 360/0 degree boundary."""
        # Create sighting at bearing 355 from the receiver (should be in 350-360 sector)
        lat, lon = _position_at_bearing(355.0)
        AircraftSighting.objects.create(
            icao_hex="BND001",
            timestamp=self.now - timedelta(hours=1),
            latitude=lat,
            longitude=lon,
            distance_nm=50.0,
        )

        result = antenna_analytics.calculate_polar_data(hours=24)

        # Sector 35 (350-360) should have data
        sector_35 = next((s for s in result["bearing_data"] if s["bearing_start"] == 350), None)
        self.assertIsNotNone(sector_35)
        if sector_35:
            self.assertEqual(sector_35["count"], 1)


class TimeRangeTests(TestCase):
    """Tests for time range handling."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_polar_data_time_range(self):
        """Test that polar data respects time range."""
        # Create sighting within time range
        AircraftSighting.objects.create(
            icao_hex="IN0001",
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
            track=45.0,
        )

        # Create sighting outside time range
        # (timestamp is auto_now_add, so it must be moved via update())
        AircraftSighting.objects.create(
            icao_hex="OUT001",
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
            track=90.0,
        )
        AircraftSighting.objects.filter(icao_hex="OUT001").update(timestamp=self.now - timedelta(hours=48))

        result = antenna_analytics.calculate_polar_data(hours=24)

        # Should only count the recent sighting
        self.assertEqual(result["summary"]["total_sightings"], 1)

    def test_rssi_data_time_range(self):
        """Test that RSSI data respects time range."""
        # Create sighting within time range
        AircraftSighting.objects.create(
            icao_hex="IN0001",
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
            rssi=-5.0,
        )

        # Create sighting outside time range
        # (timestamp is auto_now_add, so it must be moved via update())
        AircraftSighting.objects.create(
            icao_hex="OUT001",
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
            rssi=-5.0,
        )
        AircraftSighting.objects.filter(icao_hex="OUT001").update(timestamp=self.now - timedelta(hours=48))

        result = antenna_analytics.calculate_rssi_data(hours=24)

        # Should only count the recent sighting
        self.assertEqual(result["sample_size"], 1)

    def test_summary_time_range(self):
        """Test that summary respects time range."""
        # Create sighting within time range
        AircraftSighting.objects.create(
            icao_hex="IN0001",
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
        )

        # Create sighting outside time range
        # (timestamp is auto_now_add, so it must be moved via update())
        AircraftSighting.objects.create(
            icao_hex="OUT001",
            latitude=40.0,
            longitude=-74.0,
            distance_nm=50.0,
        )
        AircraftSighting.objects.filter(icao_hex="OUT001").update(timestamp=self.now - timedelta(hours=48))

        result = antenna_analytics.calculate_summary(hours=24)

        # Should only count the recent sighting
        self.assertEqual(result["range"]["total_sightings"], 1)
