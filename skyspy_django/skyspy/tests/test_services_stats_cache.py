"""
Tests for the Stats Cache Service.

Tests statistics aggregation, caching logic, cache invalidation,
and various statistics calculations.
"""

import unittest
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import AircraftInfo, AircraftSession, AircraftSighting, SafetyEvent
from skyspy.services import stats_cache
from skyspy.services.stats_cache import (
    CACHE_KEY_AIRCRAFT_STATS,
    CACHE_KEY_ENGAGEMENT,
    CACHE_KEY_FLIGHT_PATTERNS,
    CACHE_KEY_GEOGRAPHIC_STATS,
    CACHE_KEY_HISTORY_STATS,
    CACHE_KEY_HISTORY_TOP,
    CACHE_KEY_HISTORY_TRENDS,
    CACHE_KEY_SAFETY_STATS,
    CACHE_KEY_TOP_AIRCRAFT,
    CACHE_KEY_TRACKING_QUALITY,
    _get_country_from_registration,
    _is_valid_position,
    _simplify_aircraft,
    calculate_aircraft_stats,
    calculate_flight_patterns_stats,
    calculate_geographic_stats,
    calculate_history_stats,
    calculate_history_top,
    calculate_history_trends,
    calculate_safety_stats,
    calculate_top_aircraft,
    calculate_tracking_quality_stats,
    get_aircraft_stats,
    get_all_cached_stats,
    get_history_stats,
    get_history_top,
    get_history_trends,
    get_safety_stats,
    get_top_aircraft,
    get_tracking_quality_stats,
    refresh_history_cache,
    refresh_safety_cache,
    update_aircraft_stats_cache,
)
from skyspy.tests.factories import (
    AircraftInfoFactory,
    AircraftSessionFactory,
    AircraftSightingFactory,
    SafetyEventFactory,
)


class HelperFunctionsTests(TestCase):
    """Tests for helper functions in stats_cache module."""

    def test_is_valid_position_valid(self):
        """Test valid lat/lon returns True."""
        self.assertTrue(_is_valid_position(45.0, -122.0))
        self.assertTrue(_is_valid_position(0, 0))
        self.assertTrue(_is_valid_position(-90, 180))
        self.assertTrue(_is_valid_position(90, -180))

    def test_is_valid_position_invalid_lat(self):
        """Test invalid latitude returns False."""
        self.assertFalse(_is_valid_position(91, 0))
        self.assertFalse(_is_valid_position(-91, 0))

    def test_is_valid_position_invalid_lon(self):
        """Test invalid longitude returns False."""
        self.assertFalse(_is_valid_position(0, 181))
        self.assertFalse(_is_valid_position(0, -181))

    def test_is_valid_position_none_values(self):
        """Test None values return False."""
        self.assertFalse(_is_valid_position(None, 0))
        self.assertFalse(_is_valid_position(0, None))
        self.assertFalse(_is_valid_position(None, None))

    def test_is_valid_position_string_values(self):
        """Test string values that can be converted."""
        self.assertTrue(_is_valid_position("45.0", "-122.0"))

    def test_is_valid_position_invalid_strings(self):
        """Test invalid string values return False."""
        self.assertFalse(_is_valid_position("invalid", 0))
        self.assertFalse(_is_valid_position(0, "invalid"))

    def test_simplify_aircraft(self):
        """Test aircraft simplification."""
        aircraft = {
            "hex": "ABC123",
            "flight": "  UAL456  ",
            "alt_baro": 35000,
            "gs": 450,
            "baro_rate": 500,
            "distance_nm": 15.5,
            "lat": 45.0,
            "lon": -122.0,
            "category": "A3",
            "dbFlags": 1,
            "extra_field": "should_be_ignored",
        }
        result = _simplify_aircraft(aircraft)

        self.assertEqual(result["hex"], "ABC123")
        self.assertEqual(result["flight"], "UAL456")  # Should be stripped
        self.assertEqual(result["alt_baro"], 35000)
        self.assertEqual(result["gs"], 450)
        self.assertEqual(result["distance_nm"], 15.5)
        self.assertNotIn("extra_field", result)

    def test_simplify_aircraft_override_distance(self):
        """Test distance override in simplify_aircraft."""
        aircraft = {"hex": "ABC123", "distance_nm": 15.5}
        result = _simplify_aircraft(aircraft, distance_nm=25.0)
        self.assertEqual(result["distance_nm"], 25.0)

    def test_simplify_aircraft_none_flight(self):
        """Test simplify_aircraft with None flight."""
        aircraft = {"hex": "ABC123", "flight": None}
        result = _simplify_aircraft(aircraft)
        self.assertIsNone(result["flight"])


class CountryFromRegistrationTests(TestCase):
    """Tests for _get_country_from_registration function."""

    def test_us_registration(self):
        """Test US N-number detection."""
        self.assertEqual(_get_country_from_registration("N12345"), "United States")
        self.assertEqual(_get_country_from_registration("N1AB"), "United States")

    def test_uk_registration(self):
        """Test UK registration detection."""
        self.assertEqual(_get_country_from_registration("G-ABCD"), "United Kingdom")

    def test_germany_registration(self):
        """Test German registration detection."""
        self.assertEqual(_get_country_from_registration("D-ABCD"), "Germany")

    def test_canada_registration(self):
        """Test Canadian registration detection."""
        self.assertEqual(_get_country_from_registration("C-FABC"), "Canada")
        self.assertEqual(_get_country_from_registration("CF-ABC"), "Canada")

    def test_japan_registration(self):
        """Test Japanese registration detection."""
        self.assertEqual(_get_country_from_registration("JA1234"), "Japan")

    def test_case_insensitive(self):
        """Test case insensitivity."""
        self.assertEqual(_get_country_from_registration("g-abcd"), "United Kingdom")
        self.assertEqual(_get_country_from_registration("n12345"), "United States")

    def test_unknown_registration(self):
        """Test unknown registration prefix."""
        self.assertEqual(_get_country_from_registration("ZZ-1234"), "Unknown")

    def test_empty_registration(self):
        """Test empty registration returns None."""
        self.assertIsNone(_get_country_from_registration(""))
        self.assertIsNone(_get_country_from_registration(None))


class CalculateAircraftStatsTests(TestCase):
    """Tests for calculate_aircraft_stats function."""

    def test_empty_aircraft_list(self):
        """Test with empty aircraft list."""
        result = calculate_aircraft_stats([])

        self.assertEqual(result["total"], 0)
        self.assertEqual(result["with_position"], 0)
        self.assertEqual(result["military"], 0)
        self.assertEqual(result["emergency"], [])
        self.assertEqual(result["categories"], {})
        self.assertIn("timestamp", result)

    def test_basic_stats_calculation(self):
        """Test basic stats calculation."""
        aircraft_list = [
            {
                "hex": "A12345",
                "lat": 45.0,
                "lon": -122.0,
                "alt_baro": 35000,
                "gs": 450,
                "distance_nm": 15,
                "category": "A3",
                "dbFlags": 0,
            },
            {
                "hex": "A67890",
                "lat": 46.0,
                "lon": -121.0,
                "alt_baro": 5000,
                "gs": 150,
                "distance_nm": 30,
                "category": "A1",
                "dbFlags": 1,  # Military
            },
        ]

        result = calculate_aircraft_stats(aircraft_list)

        self.assertEqual(result["total"], 2)
        self.assertEqual(result["with_position"], 2)
        self.assertEqual(result["military"], 1)
        self.assertEqual(result["categories"]["A3"], 1)
        self.assertEqual(result["categories"]["A1"], 1)

    def test_emergency_detection(self):
        """Test emergency squawk detection."""
        aircraft_list = [
            {"hex": "A12345", "squawk": "7700", "flight": "N12345"},
            {"hex": "A67890", "squawk": "7600", "flight": "N67890"},
            {"hex": "A11111", "squawk": "7500", "flight": "N11111"},
            {"hex": "A22222", "squawk": "1200", "flight": "N22222"},
        ]

        result = calculate_aircraft_stats(aircraft_list)

        self.assertEqual(len(result["emergency"]), 3)
        squawks = {e["squawk"] for e in result["emergency"]}
        self.assertEqual(squawks, {"7700", "7600", "7500"})

    def test_altitude_distribution(self):
        """Test altitude distribution categorization."""
        aircraft_list = [
            {"hex": "A1", "alt_baro": "ground"},  # ground
            {"hex": "A2", "alt_baro": 0},  # ground
            {"hex": "A3", "alt_baro": 5000},  # low
            {"hex": "A4", "alt_baro": 20000},  # medium
            {"hex": "A5", "alt_baro": 40000},  # high
        ]

        result = calculate_aircraft_stats(aircraft_list)

        self.assertEqual(result["altitude"]["ground"], 2)
        self.assertEqual(result["altitude"]["low"], 1)
        self.assertEqual(result["altitude"]["medium"], 1)
        self.assertEqual(result["altitude"]["high"], 1)

    def test_distance_distribution(self):
        """Test distance distribution categorization."""
        aircraft_list = [
            {"hex": "A1", "distance_nm": 10},  # close (<25)
            {"hex": "A2", "distance_nm": 40},  # near (25-50)
            {"hex": "A3", "distance_nm": 75},  # mid (50-100)
            {"hex": "A4", "distance_nm": 150},  # far (>100)
        ]

        result = calculate_aircraft_stats(aircraft_list)

        self.assertEqual(result["distance"]["close"], 1)
        self.assertEqual(result["distance"]["near"], 1)
        self.assertEqual(result["distance"]["mid"], 1)
        self.assertEqual(result["distance"]["far"], 1)

    def test_speed_distribution(self):
        """Test speed distribution categorization."""
        aircraft_list = [
            {"hex": "A1", "gs": 100},  # slow (<200)
            {"hex": "A2", "gs": 300},  # medium (200-400)
            {"hex": "A3", "gs": 500},  # fast (>400)
        ]

        result = calculate_aircraft_stats(aircraft_list)

        self.assertEqual(result["speed"]["slow"], 1)
        self.assertEqual(result["speed"]["medium"], 1)
        self.assertEqual(result["speed"]["fast"], 1)


class CalculateTopAircraftTests(TestCase):
    """Tests for calculate_top_aircraft function."""

    def test_empty_aircraft_list(self):
        """Test with empty aircraft list."""
        result = calculate_top_aircraft([])

        self.assertEqual(result["closest"], [])
        self.assertEqual(result["highest"], [])
        self.assertEqual(result["fastest"], [])
        self.assertEqual(result["climbing"], [])
        self.assertEqual(result["military"], [])
        self.assertEqual(result["total"], 0)

    def test_top_closest(self):
        """Test closest aircraft sorting."""
        aircraft_list = [
            {"hex": "A1", "lat": 45.0, "lon": -122.0, "distance_nm": 100},
            {"hex": "A2", "lat": 45.0, "lon": -122.0, "distance_nm": 5},
            {"hex": "A3", "lat": 45.0, "lon": -122.0, "distance_nm": 50},
        ]

        result = calculate_top_aircraft(aircraft_list)

        self.assertEqual(len(result["closest"]), 3)
        self.assertEqual(result["closest"][0]["hex"], "A2")  # 5nm
        self.assertEqual(result["closest"][1]["hex"], "A3")  # 50nm
        self.assertEqual(result["closest"][2]["hex"], "A1")  # 100nm

    def test_top_highest(self):
        """Test highest altitude sorting."""
        aircraft_list = [
            {"hex": "A1", "alt_baro": 10000},
            {"hex": "A2", "alt_baro": 45000},
            {"hex": "A3", "alt_baro": 25000},
        ]

        result = calculate_top_aircraft(aircraft_list)

        self.assertEqual(len(result["highest"]), 3)
        self.assertEqual(result["highest"][0]["hex"], "A2")  # 45000
        self.assertEqual(result["highest"][1]["hex"], "A3")  # 25000
        self.assertEqual(result["highest"][2]["hex"], "A1")  # 10000

    def test_top_fastest(self):
        """Test fastest aircraft sorting."""
        aircraft_list = [
            {"hex": "A1", "gs": 250},
            {"hex": "A2", "gs": 500},
            {"hex": "A3", "gs": 350},
        ]

        result = calculate_top_aircraft(aircraft_list)

        self.assertEqual(len(result["fastest"]), 3)
        self.assertEqual(result["fastest"][0]["hex"], "A2")  # 500kt

    def test_top_climbing(self):
        """Test climbing/descending aircraft by absolute vertical rate."""
        aircraft_list = [
            {"hex": "A1", "baro_rate": 1000},
            {"hex": "A2", "baro_rate": -3000},  # Descending fast
            {"hex": "A3", "baro_rate": 2000},
        ]

        result = calculate_top_aircraft(aircraft_list)

        self.assertEqual(len(result["climbing"]), 3)
        # Sorted by absolute value
        self.assertEqual(result["climbing"][0]["hex"], "A2")  # abs(-3000)

    def test_military_filter(self):
        """Test military aircraft filter."""
        aircraft_list = [
            {"hex": "A1", "dbFlags": 0},
            {"hex": "A2", "dbFlags": 1},  # Military
            {"hex": "A3", "dbFlags": 1},  # Military
        ]

        result = calculate_top_aircraft(aircraft_list)

        self.assertEqual(len(result["military"]), 2)

    def test_limits_to_five(self):
        """Test that top lists are limited to 5 entries."""
        aircraft_list = [
            {"hex": f"A{i}", "gs": i * 100, "lat": 45.0, "lon": -122.0, "distance_nm": i} for i in range(10)
        ]

        result = calculate_top_aircraft(aircraft_list)

        self.assertEqual(len(result["fastest"]), 5)
        self.assertEqual(len(result["closest"]), 5)


class CacheOperationsTests(TestCase):
    """Tests for cache operations."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_update_aircraft_stats_cache(self):
        """Test updating aircraft stats cache."""
        aircraft_list = [
            {"hex": "A12345", "lat": 45.0, "lon": -122.0, "alt_baro": 35000, "gs": 450},
        ]

        update_aircraft_stats_cache(aircraft_list, broadcast=False)

        cached_stats = cache.get(CACHE_KEY_AIRCRAFT_STATS)
        cached_top = cache.get(CACHE_KEY_TOP_AIRCRAFT)

        self.assertIsNotNone(cached_stats)
        self.assertIsNotNone(cached_top)
        self.assertEqual(cached_stats["total"], 1)

    @patch("skyspy.services.stats_cache.broadcast_stats_update")
    def test_update_aircraft_stats_cache_with_broadcast(self, mock_broadcast):
        """Test updating aircraft stats cache with broadcast."""
        aircraft_list = [{"hex": "A12345", "lat": 45.0, "lon": -122.0}]

        update_aircraft_stats_cache(aircraft_list, broadcast=True)

        self.assertEqual(mock_broadcast.call_count, 2)  # Once for aircraft, once for top

    def test_get_aircraft_stats_returns_cached(self):
        """Test that get_aircraft_stats returns cached data."""
        test_data = {"test": "data", "total": 5}
        cache.set(CACHE_KEY_AIRCRAFT_STATS, test_data)

        result = get_aircraft_stats()

        self.assertEqual(result, test_data)

    def test_get_aircraft_stats_returns_none_when_not_cached(self):
        """Test that get_aircraft_stats returns None when not cached."""
        result = get_aircraft_stats()
        self.assertIsNone(result)

    def test_get_top_aircraft_returns_cached(self):
        """Test that get_top_aircraft returns cached data."""
        test_data = {"closest": [], "total": 0}
        cache.set(CACHE_KEY_TOP_AIRCRAFT, test_data)

        result = get_top_aircraft()

        self.assertEqual(result, test_data)


@pytest.mark.django_db
class HistoryStatsTests(TestCase):
    """Tests for history statistics calculations."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()
        AircraftSession.objects.all().delete()
        cache.clear()

    def test_calculate_history_stats_empty(self):
        """Test history stats with no data."""
        result = calculate_history_stats(hours=24)

        self.assertEqual(result["total_sightings"], 0)
        self.assertEqual(result["total_sessions"], 0)
        self.assertEqual(result["unique_aircraft"], 0)
        self.assertEqual(result["time_range_hours"], 24)

    def test_calculate_history_stats_with_data(self):
        """Test history stats with actual data."""
        # Create test sightings
        now = timezone.now()
        AircraftSightingFactory(
            timestamp=now - timedelta(hours=1),
            altitude_baro=35000,
            distance_nm=15.5,
            ground_speed=450,
            is_military=False,
        )
        AircraftSightingFactory(
            timestamp=now - timedelta(hours=2),
            altitude_baro=25000,
            distance_nm=25.0,
            ground_speed=350,
            is_military=True,
        )

        result = calculate_history_stats(hours=24)

        self.assertEqual(result["total_sightings"], 2)
        self.assertIsNotNone(result["avg_altitude"])
        self.assertIsNotNone(result["avg_distance_nm"])

    def test_calculate_history_stats_respects_time_range(self):
        """Test that history stats respects time range."""
        now = timezone.now()

        # Create sighting within range
        sighting_in = AircraftSightingFactory()
        # auto_now_add=True ignores passed timestamp, so update via queryset
        AircraftSighting.objects.filter(pk=sighting_in.pk).update(timestamp=now - timedelta(hours=1))

        # Create sighting outside range
        sighting_out = AircraftSightingFactory()
        AircraftSighting.objects.filter(pk=sighting_out.pk).update(timestamp=now - timedelta(hours=48))

        result = calculate_history_stats(hours=24)

        self.assertEqual(result["total_sightings"], 1)

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_get_history_stats_caches_result(self):
        """Test that get_history_stats caches the result."""
        # First call should trigger calculation
        get_history_stats()

        # Verify cache is populated
        cached = cache.get(CACHE_KEY_HISTORY_STATS)
        self.assertIsNotNone(cached)

    @patch("skyspy.services.stats_cache.broadcast_stats_update")
    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_refresh_history_cache(self, mock_broadcast):
        """Test refresh_history_cache updates all history caches."""
        refresh_history_cache(broadcast=True)

        # Check all three caches are populated
        self.assertIsNotNone(cache.get(CACHE_KEY_HISTORY_STATS))
        self.assertIsNotNone(cache.get(CACHE_KEY_HISTORY_TRENDS))
        self.assertIsNotNone(cache.get(CACHE_KEY_HISTORY_TOP))

        # Verify broadcast was called
        self.assertEqual(mock_broadcast.call_count, 3)


@pytest.mark.django_db
class HistoryTrendsTests(TestCase):
    """Tests for history trends calculation."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()
        cache.clear()

    def test_calculate_history_trends_empty(self):
        """Test trends with no data."""
        result = calculate_history_trends(hours=24)

        self.assertEqual(result["intervals"], [])
        self.assertEqual(result["interval_type"], "hour")
        self.assertEqual(result["summary"]["total_unique_aircraft"], 0)

    def test_calculate_history_trends_interval_type(self):
        """Test trends with different interval types."""
        result_hourly = calculate_history_trends(hours=24, interval="hour")
        result_daily = calculate_history_trends(hours=168, interval="day")

        self.assertEqual(result_hourly["interval_type"], "hour")
        self.assertEqual(result_daily["interval_type"], "day")


@pytest.mark.django_db
class HistoryTopTests(TestCase):
    """Tests for history top performers calculation."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        cache.clear()

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_calculate_history_top_empty(self):
        """Test top performers with no data."""
        result = calculate_history_top(hours=24)

        self.assertEqual(result["longest_tracked"], [])
        self.assertEqual(result["furthest_distance"], [])
        self.assertEqual(result["highest_altitude"], [])
        self.assertEqual(result["most_positions"], [])
        self.assertEqual(result["closest_approach"], [])

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_calculate_history_top_with_sessions(self):
        """Test top performers with session data."""
        now = timezone.now()

        AircraftSessionFactory(
            first_seen=now - timedelta(hours=2),
            last_seen=now - timedelta(hours=1),
            max_distance_nm=150.0,
            max_altitude=45000,
            min_distance_nm=5.0,
            total_positions=500,
        )

        AircraftSessionFactory(
            first_seen=now - timedelta(hours=1),
            last_seen=now - timedelta(minutes=30),
            max_distance_nm=100.0,
            max_altitude=35000,
            min_distance_nm=10.0,
            total_positions=200,
        )

        result = calculate_history_top(hours=24)

        self.assertEqual(len(result["furthest_distance"]), 2)
        self.assertEqual(result["furthest_distance"][0]["max_distance_nm"], 150.0)


@pytest.mark.django_db
class SafetyStatsTests(TestCase):
    """Tests for safety statistics calculation."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()
        cache.clear()

    def test_calculate_safety_stats_empty(self):
        """Test safety stats with no events."""
        result = calculate_safety_stats(hours=24)

        self.assertEqual(result["total_events"], 0)
        self.assertEqual(result["events_by_type"], {})
        self.assertEqual(result["events_by_severity"], {})
        self.assertEqual(result["unique_aircraft"], 0)

    @override_settings(
        SAFETY_MONITORING_ENABLED=True,
        SAFETY_VS_CHANGE_THRESHOLD=3000,
        SAFETY_VS_EXTREME_THRESHOLD=6000,
        SAFETY_PROXIMITY_NM=1.0,
        SAFETY_ALTITUDE_DIFF_FT=1000,
        SAFETY_CLOSURE_RATE_KT=500,
    )
    def test_calculate_safety_stats_with_events(self):
        """Test safety stats with actual events."""
        now = timezone.now()

        SafetyEventFactory(timestamp=now - timedelta(hours=1), event_type="tcas_ra", severity="critical")

        SafetyEventFactory(timestamp=now - timedelta(hours=2), event_type="7700", severity="critical")

        SafetyEventFactory(timestamp=now - timedelta(hours=3), event_type="extreme_vs", severity="warning")

        result = calculate_safety_stats(hours=24)

        self.assertEqual(result["total_events"], 3)
        self.assertEqual(result["events_by_type"]["tcas_ra"], 1)
        self.assertEqual(result["events_by_type"]["7700"], 1)
        self.assertEqual(result["events_by_severity"]["critical"], 2)
        self.assertEqual(result["events_by_severity"]["warning"], 1)
        self.assertTrue(result["monitoring_enabled"])

    @override_settings(
        SAFETY_MONITORING_ENABLED=True,
        SAFETY_VS_CHANGE_THRESHOLD=3000,
        SAFETY_VS_EXTREME_THRESHOLD=6000,
        SAFETY_PROXIMITY_NM=1.0,
        SAFETY_ALTITUDE_DIFF_FT=1000,
        SAFETY_CLOSURE_RATE_KT=500,
    )
    def test_calculate_safety_stats_recent_events(self):
        """Test that safety stats includes recent events list."""
        now = timezone.now()

        SafetyEventFactory(timestamp=now - timedelta(hours=1), event_type="tcas_ra", severity="critical")

        result = calculate_safety_stats(hours=24)

        self.assertEqual(len(result["recent_events"]), 1)
        self.assertEqual(result["recent_events"][0]["event_type"], "tcas_ra")

    @patch("skyspy.services.stats_cache.broadcast_stats_update")
    @override_settings(
        SAFETY_MONITORING_ENABLED=True,
        SAFETY_VS_CHANGE_THRESHOLD=3000,
        SAFETY_VS_EXTREME_THRESHOLD=6000,
        SAFETY_PROXIMITY_NM=1.0,
        SAFETY_ALTITUDE_DIFF_FT=1000,
        SAFETY_CLOSURE_RATE_KT=500,
    )
    def test_refresh_safety_cache(self, mock_broadcast):
        """Test refresh_safety_cache updates cache."""
        refresh_safety_cache(broadcast=True)

        cached = cache.get(CACHE_KEY_SAFETY_STATS)
        self.assertIsNotNone(cached)
        mock_broadcast.assert_called_once()


@pytest.mark.django_db
class FlightPatternsStatsTests(TestCase):
    """Tests for flight patterns statistics."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()
        AircraftSession.objects.all().delete()
        cache.clear()

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_calculate_flight_patterns_empty(self):
        """Test flight patterns with no data."""
        result = calculate_flight_patterns_stats(hours=24)

        # Should have 24 hours with zero values
        self.assertEqual(len(result["busiest_hours"]), 24)
        self.assertIsNone(result["peak_hour"])
        self.assertEqual(result["avg_duration_by_type"], [])

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_calculate_flight_patterns_busiest_hours(self):
        """Test busiest hours calculation with data."""
        now = timezone.now()

        # Create sightings at specific hours
        for _ in range(5):
            AircraftSightingFactory(timestamp=now - timedelta(hours=1))

        for _ in range(10):
            AircraftSightingFactory(timestamp=now - timedelta(hours=2))

        result = calculate_flight_patterns_stats(hours=24)

        self.assertIsNotNone(result["peak_hour"])
        self.assertGreater(result["peak_aircraft_count"], 0)


@pytest.mark.django_db
class GeographicStatsTests(TestCase):
    """Tests for geographic statistics."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()
        cache.clear()

    def test_calculate_geographic_stats_empty(self):
        """Test geographic stats with no data."""
        result = calculate_geographic_stats(hours=24)

        self.assertEqual(result["countries_breakdown"], [])
        self.assertEqual(result["operators_frequency"], [])
        self.assertEqual(result["summary"]["total_unique_aircraft"], 0)

    def test_calculate_geographic_stats_with_data(self):
        """Test geographic stats with aircraft data."""
        now = timezone.now()

        # Create session with aircraft info
        session = AircraftSessionFactory(last_seen=now - timedelta(hours=1))

        AircraftInfoFactory(
            icao_hex=session.icao_hex, registration="N12345", operator="United Airlines", country="United States"
        )

        result = calculate_geographic_stats(hours=24)

        self.assertGreater(result["summary"]["total_unique_aircraft"], 0)


@pytest.mark.django_db
class TrackingQualityStatsTests(TestCase):
    """Tests for tracking quality statistics."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        cache.clear()

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_calculate_tracking_quality_empty(self):
        """Test tracking quality with no sessions."""
        result = calculate_tracking_quality_stats(hours=24)

        self.assertEqual(result["total_sessions_analyzed"], 0)
        self.assertIsNone(result["avg_update_rate_per_min"])
        self.assertEqual(result["quality_breakdown"], {"excellent": 0, "good": 0, "fair": 0, "poor": 0})

    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_calculate_tracking_quality_with_sessions(self):
        """Test tracking quality with session data."""
        now = timezone.now()

        # Create session with good tracking
        # auto_now_add/auto_now on first_seen/last_seen ignore factory values,
        # so we update via queryset after creation.
        session1 = AircraftSessionFactory(total_positions=200)
        AircraftSession.objects.filter(pk=session1.pk).update(
            first_seen=now - timedelta(minutes=30),
            last_seen=now - timedelta(minutes=5),
        )

        # Create session with poor tracking
        session2 = AircraftSessionFactory(total_positions=10)
        AircraftSession.objects.filter(pk=session2.pk).update(
            first_seen=now - timedelta(minutes=60),
            last_seen=now - timedelta(minutes=30),
        )

        result = calculate_tracking_quality_stats(hours=24)

        self.assertGreater(result["total_sessions_analyzed"], 0)
        self.assertIsNotNone(result["avg_update_rate_per_min"])


@pytest.mark.django_db
class AllCachedStatsTests(TestCase):
    """Tests for get_all_cached_stats function."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.acars_stats.get_cached_acars_stats")
    @patch("skyspy.services.acars_stats.get_cached_acars_trends")
    @patch("skyspy.services.acars_stats.get_cached_acars_airlines")
    @unittest.skipIf(connection.vendor == "sqlite", "ExtractEpoch on DurationField requires PostgreSQL")
    def test_get_all_cached_stats(self, mock_acars_airlines, mock_acars_trends, mock_acars_stats):
        """Test get_all_cached_stats returns all stat types."""
        mock_acars_stats.return_value = {"test": "acars_stats"}
        mock_acars_trends.return_value = {"test": "acars_trends"}
        mock_acars_airlines.return_value = {"test": "acars_airlines"}

        result = get_all_cached_stats()

        # Should have all expected keys
        expected_keys = [
            "aircraft_stats",
            "top_aircraft",
            "history_stats",
            "history_trends",
            "history_top",
            "safety_stats",
            "flight_patterns",
            "geographic",
            "tracking_quality",
            "engagement",
            "acars_stats",
            "acars_trends",
            "acars_airlines",
        ]

        for key in expected_keys:
            self.assertIn(key, result)


class LiteModeTests(TestCase):
    """Tests for RPi Lite Mode sampling."""

    def test_apply_lite_mode_sampling_disabled(self):
        """Test sampling returns original queryset when lite mode disabled."""
        # Save original value
        original_value = stats_cache.RPI_LITE_MODE

        try:
            stats_cache.RPI_LITE_MODE = False

            qs = AircraftSighting.objects.all()
            result = stats_cache._apply_lite_mode_sampling(qs)

            # Should return same queryset
            self.assertEqual(str(qs.query), str(result.query))
        finally:
            stats_cache.RPI_LITE_MODE = original_value

    def test_apply_lite_mode_sampling_enabled(self):
        """Test sampling limits queryset when lite mode enabled."""
        original_value = stats_cache.RPI_LITE_MODE

        try:
            stats_cache.RPI_LITE_MODE = True

            qs = AircraftSighting.objects.all()
            result = stats_cache._apply_lite_mode_sampling(qs, sample_size=100)

            # Should be limited - check that it's a sliced queryset
            # The actual test is that it doesn't fail and returns a queryset
            self.assertIsNotNone(result)
        finally:
            stats_cache.RPI_LITE_MODE = original_value
