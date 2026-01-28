"""
End-to-end tests for analytics-related Celery tasks.

Tests cover:
- update_antenna_analytics: Calculating antenna performance metrics
- calculate_daily_stats: Generating daily statistics reports
"""
import math
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import AircraftSighting, AircraftSession
from skyspy.tasks.analytics import (
    update_antenna_analytics,
    calculate_daily_stats,
)


# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': True,
}


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateAntennaAnalyticsTaskTest(TestCase):
    """Tests for the update_antenna_analytics task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        AircraftSighting.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_analytics_no_sightings(self):
        """Test analytics calculation with no sightings."""
        update_antenna_analytics()

        # Analytics should not be cached when no data
        analytics = cache.get('antenna_analytics')
        self.assertIsNone(analytics)

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_with_sightings(self):
        """Test analytics calculation with sighting data."""
        now = timezone.now()

        # Create sightings in different directions
        # North (0 degrees)
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=48.0,  # North of feeder
            longitude=-122.0,
            distance_nm=30.0,
            rssi=-25.0,
        )
        # East (90 degrees)
        AircraftSighting.objects.create(
            icao_hex='A22222',
            latitude=47.5,
            longitude=-121.0,  # East of feeder
            distance_nm=45.0,
            rssi=-28.0,
        )
        # South (180 degrees)
        AircraftSighting.objects.create(
            icao_hex='A33333',
            latitude=47.0,  # South of feeder
            longitude=-122.0,
            distance_nm=30.0,
            rssi=-22.0,
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)
        self.assertIn('max_range_by_direction', analytics)
        self.assertIn('overall_max_range', analytics)
        self.assertEqual(analytics['overall_max_range'], 45.0)
        self.assertEqual(analytics['unique_aircraft'], 3)

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_direction_calculation(self):
        """Test that direction-based range calculation is correct."""
        # Create sighting exactly north (0 degrees, sector 0)
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=48.5,  # 1 degree north
            longitude=-122.0,  # Same longitude
            distance_nm=60.0,
            rssi=-30.0,
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)

        # Check that sector 0 (north) has the range
        direction_ranges = analytics['max_range_by_direction']
        self.assertIn(0, direction_ranges)
        self.assertEqual(direction_ranges[0], 60.0)

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_rssi_statistics(self):
        """Test RSSI statistics calculation."""
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.6,
            longitude=-122.1,
            distance_nm=10.0,
            rssi=-20.0,  # Best signal
        )
        AircraftSighting.objects.create(
            icao_hex='A22222',
            latitude=47.7,
            longitude=-122.2,
            distance_nm=20.0,
            rssi=-35.0,  # Weakest signal
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)
        self.assertEqual(analytics['best_rssi'], -20.0)
        self.assertAlmostEqual(analytics['avg_rssi'], -27.5, places=1)

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_only_uses_recent_sightings(self):
        """Test that only sightings from last hour are included."""
        now = timezone.now()

        # Recent sighting (within 1 hour)
        recent = AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.6,
            longitude=-122.1,
            distance_nm=30.0,
            rssi=-25.0,
        )

        # Old sighting (more than 1 hour ago)
        old = AircraftSighting.objects.create(
            icao_hex='A22222',
            latitude=47.7,
            longitude=-122.2,
            distance_nm=100.0,  # Would be max if included
            rssi=-40.0,
        )
        # Force old timestamp
        AircraftSighting.objects.filter(pk=old.pk).update(
            timestamp=now - timedelta(hours=2)
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)
        self.assertEqual(analytics['overall_max_range'], 30.0)  # Not 100
        self.assertEqual(analytics['unique_aircraft'], 1)

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_skips_null_distance(self):
        """Test that sightings without distance are handled."""
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.6,
            longitude=-122.1,
            distance_nm=None,  # No distance calculated
            rssi=-25.0,
        )
        AircraftSighting.objects.create(
            icao_hex='A22222',
            latitude=47.7,
            longitude=-122.2,
            distance_nm=50.0,
            rssi=-30.0,
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)
        # Only the sighting with distance should contribute to direction ranges

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_positions_per_hour(self):
        """Test positions per hour calculation."""
        # Create multiple sightings
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f'A{i:05d}',
                latitude=47.5 + (i * 0.01),
                longitude=-122.0 + (i * 0.01),
                distance_nm=10.0 + i,
                rssi=-25.0,
            )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertEqual(analytics['total_positions'], 10)
        self.assertEqual(analytics['positions_per_hour'], 10)

    def test_analytics_cache_timeout(self):
        """Test that analytics are cached with correct timeout."""
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.6,
            longitude=-122.1,
            distance_nm=30.0,
        )

        with patch.object(cache, 'set') as mock_cache_set:
            update_antenna_analytics()

            # Verify cache.set was called with 600 second timeout
            mock_cache_set.assert_called()
            call_args = mock_cache_set.call_args
            self.assertEqual(call_args[0][0], 'antenna_analytics')
            self.assertEqual(call_args[1]['timeout'], 600)


@override_settings(**CELERY_TEST_SETTINGS)
class CalculateDailyStatsTaskTest(TestCase):
    """Tests for the calculate_daily_stats task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        AircraftSighting.objects.all().delete()
        AircraftSession.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_daily_stats_no_data(self):
        """Test daily stats with no data."""
        stats = calculate_daily_stats()

        self.assertIsNotNone(stats)
        self.assertEqual(stats['total_sightings'], 0)
        self.assertEqual(stats['unique_aircraft'], 0)
        self.assertEqual(stats['total_sessions'], 0)

    def test_daily_stats_calculates_yesterday(self):
        """Test that stats are calculated for yesterday."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        # Create sighting from yesterday
        sighting = AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.5,
            longitude=-122.0,
            distance_nm=30.0,
        )
        # Force timestamp to yesterday
        AircraftSighting.objects.filter(pk=sighting.pk).update(
            timestamp=yesterday.replace(hour=12, minute=0)
        )

        # Create session from yesterday
        session = AircraftSession.objects.create(
            icao_hex='A11111',
            callsign='UAL123',
            total_positions=50,
        )
        AircraftSession.objects.filter(pk=session.pk).update(
            first_seen=yesterday.replace(hour=10),
            last_seen=yesterday.replace(hour=14),
        )

        stats = calculate_daily_stats()

        self.assertEqual(stats['date'], yesterday.date().isoformat())
        self.assertEqual(stats['total_sightings'], 1)
        self.assertEqual(stats['unique_aircraft'], 1)
        self.assertEqual(stats['total_sessions'], 1)

    def test_daily_stats_excludes_today(self):
        """Test that today's data is excluded."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        # Create sighting from today (should be excluded)
        today_sighting = AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.5,
            longitude=-122.0,
            distance_nm=30.0,
        )

        # Create sighting from yesterday (should be included)
        yesterday_sighting = AircraftSighting.objects.create(
            icao_hex='A22222',
            latitude=47.6,
            longitude=-122.1,
            distance_nm=40.0,
        )
        AircraftSighting.objects.filter(pk=yesterday_sighting.pk).update(
            timestamp=yesterday.replace(hour=12)
        )

        stats = calculate_daily_stats()

        self.assertEqual(stats['total_sightings'], 1)  # Only yesterday's
        self.assertEqual(stats['unique_aircraft'], 1)

    def test_daily_stats_military_count(self):
        """Test military session counting."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        # Create civilian session
        civilian = AircraftSession.objects.create(
            icao_hex='A11111',
            callsign='UAL123',
            is_military=False,
        )
        AircraftSession.objects.filter(pk=civilian.pk).update(
            last_seen=yesterday.replace(hour=12)
        )

        # Create military sessions
        for i in range(3):
            military = AircraftSession.objects.create(
                icao_hex=f'AE{i:04d}',
                callsign=f'ARMY{i}',
                is_military=True,
            )
            AircraftSession.objects.filter(pk=military.pk).update(
                last_seen=yesterday.replace(hour=12)
            )

        stats = calculate_daily_stats()

        self.assertEqual(stats['total_sessions'], 4)
        self.assertEqual(stats['military_sessions'], 3)

    def test_daily_stats_distance_calculations(self):
        """Test average and max distance calculations."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        # Create sightings with different distances
        distances = [10.0, 20.0, 30.0, 40.0, 50.0]
        for i, distance in enumerate(distances):
            sighting = AircraftSighting.objects.create(
                icao_hex=f'A{i:05d}',
                latitude=47.5 + (i * 0.1),
                longitude=-122.0,
                distance_nm=distance,
            )
            AircraftSighting.objects.filter(pk=sighting.pk).update(
                timestamp=yesterday.replace(hour=12)
            )

        stats = calculate_daily_stats()

        self.assertEqual(stats['max_distance'], 50.0)
        self.assertAlmostEqual(stats['avg_distance'], 30.0, places=1)

    def test_daily_stats_cached(self):
        """Test that daily stats are cached."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        stats = calculate_daily_stats()

        cache_key = f'daily_stats_{yesterday.date().isoformat()}'
        cached_stats = cache.get(cache_key)
        self.assertIsNotNone(cached_stats)
        self.assertEqual(cached_stats['date'], yesterday.date().isoformat())

    def test_daily_stats_cache_timeout(self):
        """Test that daily stats are cached for 7 days."""
        with patch.object(cache, 'set') as mock_cache_set:
            calculate_daily_stats()

            mock_cache_set.assert_called()
            call_args = mock_cache_set.call_args
            # 7 days in seconds = 86400 * 7
            self.assertEqual(call_args[1]['timeout'], 86400 * 7)

    def test_daily_stats_unique_aircraft_count(self):
        """Test unique aircraft counting (same ICAO multiple sightings)."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        # Create multiple sightings for same aircraft
        for i in range(5):
            sighting = AircraftSighting.objects.create(
                icao_hex='A11111',  # Same aircraft
                latitude=47.5 + (i * 0.01),
                longitude=-122.0,
                distance_nm=30.0,
            )
            AircraftSighting.objects.filter(pk=sighting.pk).update(
                timestamp=yesterday.replace(hour=12, minute=i)
            )

        # Create sighting for different aircraft
        other = AircraftSighting.objects.create(
            icao_hex='A22222',
            latitude=47.6,
            longitude=-122.1,
            distance_nm=40.0,
        )
        AircraftSighting.objects.filter(pk=other.pk).update(
            timestamp=yesterday.replace(hour=14)
        )

        stats = calculate_daily_stats()

        self.assertEqual(stats['total_sightings'], 6)
        self.assertEqual(stats['unique_aircraft'], 2)


@override_settings(**CELERY_TEST_SETTINGS)
class AnalyticsTaskSchedulingTest(TestCase):
    """Tests for analytics task scheduling configuration."""

    def test_update_antenna_analytics_is_shared_task(self):
        """Verify update_antenna_analytics is a shared task."""
        self.assertTrue(hasattr(update_antenna_analytics, 'delay'))
        self.assertTrue(hasattr(update_antenna_analytics, 'apply_async'))

    def test_calculate_daily_stats_is_shared_task(self):
        """Verify calculate_daily_stats is a shared task."""
        self.assertTrue(hasattr(calculate_daily_stats, 'delay'))
        self.assertTrue(hasattr(calculate_daily_stats, 'apply_async'))


@override_settings(**CELERY_TEST_SETTINGS)
class AnalyticsPerformanceTest(TestCase):
    """Performance-related tests for analytics tasks."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        AircraftSighting.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_antenna_analytics_handles_large_dataset(self):
        """Test that antenna analytics handles many sightings."""
        # Create 100 sightings
        sightings = []
        for i in range(100):
            lat_offset = (i % 10) * 0.1
            lon_offset = (i // 10) * 0.1
            sightings.append(AircraftSighting(
                icao_hex=f'A{i:05d}',
                latitude=47.5 + lat_offset,
                longitude=-122.0 + lon_offset,
                distance_nm=10.0 + i,
                rssi=-25.0 - (i * 0.1),
            ))
        AircraftSighting.objects.bulk_create(sightings)

        # Task should complete without error
        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)
        self.assertEqual(analytics['total_positions'], 100)
        self.assertEqual(analytics['unique_aircraft'], 100)


@override_settings(**CELERY_TEST_SETTINGS)
class AnalyticsEdgeCasesTest(TestCase):
    """Edge case tests for analytics tasks."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        AircraftSighting.objects.all().delete()
        AircraftSession.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_handles_zero_distance(self):
        """Test handling of zero distance sightings."""
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.5,
            longitude=-122.0,
            distance_nm=0.0,
            rssi=-10.0,
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)

    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_analytics_handles_extreme_coordinates(self):
        """Test handling of extreme lat/lon values."""
        # Aircraft at maximum range
        AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=50.0,  # Far north
            longitude=-115.0,  # Far east
            distance_nm=250.0,
            rssi=-45.0,
        )

        update_antenna_analytics()

        analytics = cache.get('antenna_analytics')
        self.assertIsNotNone(analytics)
        self.assertEqual(analytics['overall_max_range'], 250.0)

    def test_daily_stats_handles_null_distances(self):
        """Test handling of null distance values in daily stats."""
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        # Create sighting with null distance
        sighting = AircraftSighting.objects.create(
            icao_hex='A11111',
            latitude=47.5,
            longitude=-122.0,
            distance_nm=None,
        )
        AircraftSighting.objects.filter(pk=sighting.pk).update(
            timestamp=yesterday.replace(hour=12)
        )

        # Should not raise
        stats = calculate_daily_stats()

        self.assertEqual(stats['total_sightings'], 1)
        # avg_distance should handle null gracefully
        self.assertEqual(stats['avg_distance'], 0)

    def test_daily_stats_returns_dict(self):
        """Test that calculate_daily_stats returns a dictionary."""
        stats = calculate_daily_stats()

        self.assertIsInstance(stats, dict)
        self.assertIn('date', stats)
        self.assertIn('total_sightings', stats)
        self.assertIn('unique_aircraft', stats)
        self.assertIn('total_sessions', stats)
        self.assertIn('military_sessions', stats)
        self.assertIn('avg_distance', stats)
        self.assertIn('max_distance', stats)
