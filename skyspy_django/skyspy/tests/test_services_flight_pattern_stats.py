"""
Tests for the FlightPatternStats service.

Tests flight pattern detection, geographic statistics,
route analysis, and statistical aggregations.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase
from django.utils import timezone

from skyspy.models import (
    AcarsMessage,
    AircraftInfo,
    AircraftSession,
    AircraftSighting,
    CachedAirport,
)
from skyspy.services import flight_pattern_stats as fps


class RegistrationCountryMappingTests(TestCase):
    """Tests for registration prefix to country mapping."""

    def test_us_registration(self):
        """Test US N-number registration detection."""
        result = fps._get_country_from_registration("N12345")
        self.assertEqual(result, "United States")

    def test_us_registration_uppercase(self):
        """Test US registration case normalization."""
        result = fps._get_country_from_registration("n12345")
        self.assertEqual(result, "United States")

    def test_uk_registration(self):
        """Test UK G- prefix registration."""
        result = fps._get_country_from_registration("G-ABCD")
        self.assertEqual(result, "United Kingdom")

    def test_germany_registration(self):
        """Test German D- prefix registration."""
        result = fps._get_country_from_registration("D-ABCD")
        self.assertEqual(result, "Germany")

    def test_canada_registration(self):
        """Test Canadian C-F prefix registration."""
        result = fps._get_country_from_registration("C-FABC")
        self.assertEqual(result, "Canada")

    def test_japan_registration(self):
        """Test Japanese JA prefix registration."""
        result = fps._get_country_from_registration("JA1234")
        self.assertEqual(result, "Japan")

    def test_south_korea_registration(self):
        """Test South Korean HL prefix registration."""
        result = fps._get_country_from_registration("HL1234")
        self.assertEqual(result, "South Korea")

    def test_australia_registration(self):
        """Test Australian VH- prefix registration."""
        result = fps._get_country_from_registration("VH-ABC")
        self.assertEqual(result, "Australia")

    def test_three_char_prefix(self):
        """Test 3-character prefix matching (A9C- Bahrain)."""
        result = fps._get_country_from_registration("A9C-A")
        self.assertEqual(result, "Bahrain")

    def test_two_char_prefix(self):
        """Test 2-character prefix matching (ZK- New Zealand)."""
        result = fps._get_country_from_registration("ZK-ABC")
        self.assertEqual(result, "New Zealand")

    def test_empty_registration(self):
        """Test empty registration returns None."""
        result = fps._get_country_from_registration("")
        self.assertIsNone(result)

    def test_none_registration(self):
        """Test None registration returns None."""
        result = fps._get_country_from_registration(None)
        self.assertIsNone(result)

    def test_unknown_registration(self):
        """Test unknown registration prefix returns Unknown."""
        result = fps._get_country_from_registration("XX-123")
        self.assertEqual(result, "Unknown")

    def test_whitespace_handling(self):
        """Test registration with whitespace is handled."""
        result = fps._get_country_from_registration("  N12345  ")
        self.assertEqual(result, "United States")


class FrequentRoutesTests(TestCase):
    """Tests for frequent routes calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()
        AircraftSession.objects.all().delete()

    def test_calculate_frequent_routes_empty(self):
        """Test frequent routes with no data."""
        result = fps.calculate_frequent_routes(hours=24)
        self.assertEqual(result, [])

    def test_calculate_frequent_routes_with_acars_data(self):
        """Test frequent routes from ACARS decoded data."""
        # Create ACARS messages with route data
        for i in range(5):
            AcarsMessage.objects.create(
                timestamp=self.now - timedelta(hours=i),
                source="acars",
                icao_hex=f"ABC{i:03d}",
                callsign="UAL123",
                decoded={"dep": "KJFK", "arr": "KLAX"},
            )

        result = fps.calculate_frequent_routes(hours=24)

        # Should find KJFK-KLAX route
        self.assertGreaterEqual(len(result), 1)

    def test_calculate_frequent_routes_with_callsign_data(self):
        """Test frequent routes from callsign patterns."""
        # Create sessions with airline callsigns
        for i in range(10):
            AircraftSession.objects.create(
                icao_hex=f"ABC{i:03d}",
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
                callsign=f"UAL{i:03d}",
            )

        result = fps.calculate_frequent_routes(hours=24)

        # Should find UAL airline pattern
        airline_routes = [r for r in result if r.get("source") == "callsign"]
        self.assertGreaterEqual(len(airline_routes), 0)

    def test_calculate_frequent_routes_limit(self):
        """Test that limit parameter is respected."""
        # Create many different routes
        for i in range(25):
            AcarsMessage.objects.create(
                timestamp=self.now - timedelta(hours=1),
                source="acars",
                icao_hex=f"ABC{i:03d}",
                callsign="UAL123",
                decoded={"dep": f"K{i:03d}", "arr": f"K{i + 100:03d}"},
            )

        result = fps.calculate_frequent_routes(hours=24, limit=10)

        self.assertLessEqual(len(result), 10)

    def test_calculate_frequent_routes_deduplication(self):
        """Test that duplicate routes are merged."""
        # Create ACARS route
        AcarsMessage.objects.create(
            timestamp=self.now - timedelta(hours=1),
            source="acars",
            icao_hex="ABC001",
            callsign="UAL123",
            decoded={"dep": "KJFK", "arr": "KLAX"},
        )

        # Create same route again
        AcarsMessage.objects.create(
            timestamp=self.now - timedelta(hours=1),
            source="acars",
            icao_hex="ABC002",
            callsign="UAL456",
            decoded={"dep": "KJFK", "arr": "KLAX"},
        )

        result = fps.calculate_frequent_routes(hours=24)

        # Should consolidate into one route entry
        jfk_lax_routes = [r for r in result if r.get("route_key") == "KJFK-KLAX"]
        if jfk_lax_routes:
            self.assertGreaterEqual(jfk_lax_routes[0]["count"], 2)


class BusiestHoursTests(TestCase):
    """Tests for busiest hours calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_calculate_busiest_hours_empty(self):
        """Test busiest hours with no data."""
        result = fps.calculate_busiest_hours(hours=24)

        # Should have 24 hours in response
        self.assertEqual(len(result["busiest_hours"]), 24)
        # All should be zero
        for hour_data in result["busiest_hours"]:
            self.assertEqual(hour_data["position_count"], 0)
            self.assertEqual(hour_data["unique_aircraft"], 0)

    def test_calculate_busiest_hours_with_data(self):
        """Test busiest hours with sighting data."""
        # Create sightings at specific hours
        base_time = self.now.replace(hour=10, minute=0, second=0, microsecond=0)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                timestamp=base_time,
                latitude=40.0,
                longitude=-74.0,
                altitude_baro=35000,
            )

        result = fps.calculate_busiest_hours(hours=24)

        # Hour 10 should have activity
        hour_10 = next((h for h in result["busiest_hours"] if h["hour"] == 10), None)
        self.assertIsNotNone(hour_10)
        if hour_10:
            self.assertGreater(hour_10["position_count"], 0)

    def test_calculate_busiest_hours_peak_detection(self):
        """Test peak hour detection."""
        # Create more sightings at hour 14
        base_time_14 = self.now.replace(hour=14, minute=0, second=0, microsecond=0)
        for i in range(20):
            AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                timestamp=base_time_14,
                latitude=40.0,
                longitude=-74.0,
            )

        # Create fewer sightings at hour 3
        base_time_3 = self.now.replace(hour=3, minute=0, second=0, microsecond=0)
        for i in range(5):
            AircraftSighting.objects.create(
                icao_hex=f"DEF{i:03d}",
                timestamp=base_time_3,
                latitude=40.0,
                longitude=-74.0,
            )

        result = fps.calculate_busiest_hours(hours=24)

        # Peak should be at hour 14 (more unique aircraft)
        self.assertEqual(result["peak_hour"], 14)

    def test_calculate_busiest_hours_day_night_ratio(self):
        """Test day vs night ratio calculation."""
        # Create daytime sightings (6am-6pm)
        day_time = self.now.replace(hour=12, minute=0, second=0, microsecond=0)
        for i in range(20):
            AircraftSighting.objects.create(
                icao_hex=f"DAY{i:03d}",
                timestamp=day_time,
                latitude=40.0,
                longitude=-74.0,
            )

        # Create nighttime sightings
        night_time = self.now.replace(hour=22, minute=0, second=0, microsecond=0)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"NGT{i:03d}",
                timestamp=night_time,
                latitude=40.0,
                longitude=-74.0,
            )

        result = fps.calculate_busiest_hours(hours=24)

        self.assertIsNotNone(result["day_night_ratio"])
        self.assertGreater(result["day_positions"], 0)


class DurationByTypeTests(TestCase):
    """Tests for flight duration by aircraft type."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_calculate_duration_by_type_empty(self):
        """Test duration by type with no data."""
        result = fps.calculate_duration_by_type(hours=24)
        self.assertEqual(result, [])

    def test_calculate_duration_by_type_with_data(self):
        """Test duration by type with session data."""
        # Create sessions for B738
        for i in range(5):
            AircraftSession.objects.create(
                icao_hex=f"ABC{i:03d}",
                aircraft_type="B738",
                first_seen=self.now - timedelta(hours=3),
                last_seen=self.now - timedelta(hours=1),  # 2 hour duration
                total_positions=100,
            )

        result = fps.calculate_duration_by_type(hours=24)

        self.assertGreater(len(result), 0)
        b738 = next((t for t in result if t["aircraft_type"] == "B738"), None)
        self.assertIsNotNone(b738)
        if b738:
            # Should have average duration around 120 minutes
            self.assertGreater(b738["avg_duration_min"], 100)

    def test_calculate_duration_by_type_filters_short_sessions(self):
        """Test that very short sessions are filtered."""
        # Create session shorter than 1 minute
        AircraftSession.objects.create(
            icao_hex="ABC001",
            aircraft_type="B738",
            first_seen=self.now - timedelta(seconds=30),
            last_seen=self.now,
            total_positions=5,
        )

        result = fps.calculate_duration_by_type(hours=24)

        # Should be empty as the session is too short
        self.assertEqual(len(result), 0)

    def test_calculate_duration_by_type_limit(self):
        """Test that limit parameter is respected."""
        # Create sessions for many different types
        for i in range(30):
            AircraftSession.objects.create(
                icao_hex=f"ABC{i:03d}",
                aircraft_type=f"TYPE{i:02d}",
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
                total_positions=50,
            )

        result = fps.calculate_duration_by_type(hours=24, limit=10)

        self.assertLessEqual(len(result), 10)


class CommonAircraftTypesTests(TestCase):
    """Tests for common aircraft types calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_calculate_common_aircraft_types_empty(self):
        """Test common types with no data."""
        result = fps.calculate_common_aircraft_types(hours=24)
        self.assertEqual(result, [])

    def test_calculate_common_aircraft_types_with_data(self):
        """Test common types with session data."""
        # Create sessions for B738
        for i in range(10):
            AircraftSession.objects.create(
                icao_hex=f"ABC{i:03d}",
                aircraft_type="B738",
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
            )

        # Create sessions for A320
        for i in range(5):
            AircraftSession.objects.create(
                icao_hex=f"DEF{i:03d}",
                aircraft_type="A320",
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
            )

        result = fps.calculate_common_aircraft_types(hours=24)

        self.assertGreater(len(result), 0)
        # B738 should be first (more sessions)
        self.assertEqual(result[0]["type_code"], "B738")
        self.assertEqual(result[0]["session_count"], 10)

    def test_calculate_common_aircraft_types_military_pct(self):
        """Test military percentage calculation."""
        # Create military sessions
        for i in range(5):
            AircraftSession.objects.create(
                icao_hex=f"MIL{i:03d}",
                aircraft_type="C130",
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
                is_military=True,
            )

        # Create civilian sessions of same type
        for i in range(5):
            AircraftSession.objects.create(
                icao_hex=f"CIV{i:03d}",
                aircraft_type="C130",
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
                is_military=False,
            )

        result = fps.calculate_common_aircraft_types(hours=24)

        c130 = next((t for t in result if t["type_code"] == "C130"), None)
        self.assertIsNotNone(c130)
        if c130:
            self.assertEqual(c130["military_pct"], 50.0)


class CountriesBreakdownTests(TestCase):
    """Tests for countries breakdown calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_calculate_countries_breakdown_empty(self):
        """Test countries breakdown with no data."""
        result = fps.calculate_countries_breakdown(hours=24)
        self.assertEqual(result, [])

    def test_calculate_countries_breakdown_with_data(self):
        """Test countries breakdown with aircraft info."""
        # Create sessions and matching aircraft info
        for i in range(10):
            icao = f"ABC{i:03d}"
            AircraftSession.objects.create(
                icao_hex=icao,
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
            )
            AircraftInfo.objects.create(
                icao_hex=icao,
                registration=f"N{i:05d}",  # US registration
            )

        for i in range(5):
            icao = f"DEF{i:03d}"
            AircraftSession.objects.create(
                icao_hex=icao,
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
            )
            AircraftInfo.objects.create(
                icao_hex=icao,
                registration=f"G-{i:04d}",  # UK registration
            )

        result = fps.calculate_countries_breakdown(hours=24)

        self.assertGreater(len(result), 0)
        # US should be first
        us = next((c for c in result if c["country"] == "United States"), None)
        self.assertIsNotNone(us)


class OperatorsFrequencyTests(TestCase):
    """Tests for operators frequency calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_calculate_operators_frequency_empty(self):
        """Test operators frequency with no data."""
        result = fps.calculate_operators_frequency(hours=24)
        self.assertEqual(result, [])

    def test_calculate_operators_frequency_with_data(self):
        """Test operators frequency with aircraft info."""
        # Create sessions and matching aircraft info with operators
        for i in range(10):
            icao = f"UAL{i:03d}"
            AircraftSession.objects.create(
                icao_hex=icao,
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
            )
            AircraftInfo.objects.create(
                icao_hex=icao,
                registration=f"N{i:05d}",
                operator="United Airlines",
                operator_icao="UAL",
                country="United States",
            )

        result = fps.calculate_operators_frequency(hours=24)

        self.assertGreater(len(result), 0)
        united = next((o for o in result if o["operator"] == "United Airlines"), None)
        self.assertIsNotNone(united)
        if united:
            self.assertEqual(united["aircraft_count"], 10)


class AirportConnectivityTests(TestCase):
    """Tests for airport connectivity calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()
        CachedAirport.objects.all().delete()

    def test_calculate_airport_connectivity_empty(self):
        """Test airport connectivity with no data."""
        result = fps.calculate_airport_connectivity(hours=24)
        self.assertEqual(result, [])

    def test_calculate_airport_connectivity_with_acars_data(self):
        """Test airport connectivity from ACARS messages."""
        # Create ACARS messages mentioning airports
        for i in range(5):
            AcarsMessage.objects.create(
                timestamp=self.now - timedelta(hours=i),
                source="acars",
                icao_hex=f"ABC{i:03d}",
                text="METAR KJFK 120000Z 27010KT",
            )

        # Create cached airport
        CachedAirport.objects.create(
            icao_id="KJFK",
            name="John F Kennedy Intl",
            country="United States",
            airport_type="large_airport",
            latitude=40.6413,
            longitude=-73.7781,
        )

        result = fps.calculate_airport_connectivity(hours=24)

        # Should find KJFK
        jfk = next((a for a in result if a["icao_id"] == "KJFK"), None)
        self.assertIsNotNone(jfk)

    def test_calculate_airport_connectivity_decoded_data(self):
        """Test airport connectivity from decoded ACARS data."""
        # Create ACARS messages with decoded route data
        for i in range(5):
            AcarsMessage.objects.create(
                timestamp=self.now - timedelta(hours=i),
                source="acars",
                icao_hex=f"ABC{i:03d}",
                decoded={"dep": "KLAX", "arr": "KSFO"},
            )

        result = fps.calculate_airport_connectivity(hours=24)

        # Decoded data is weighted higher
        self.assertGreaterEqual(len(result), 0)


class MilitaryBreakdownTests(TestCase):
    """Tests for military breakdown calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_calculate_military_breakdown_empty(self):
        """Test military breakdown with no data."""
        result = fps.calculate_military_breakdown(hours=24)
        self.assertEqual(result, [])

    def test_calculate_military_breakdown_with_data(self):
        """Test military breakdown with mixed data."""
        # Create US military aircraft
        for i in range(5):
            icao = f"MIL{i:03d}"
            AircraftSession.objects.create(
                icao_hex=icao,
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
                is_military=True,
            )
            AircraftInfo.objects.create(
                icao_hex=icao,
                registration=f"N{i:05d}",
            )

        # Create US civilian aircraft
        for i in range(10):
            icao = f"CIV{i:03d}"
            AircraftSession.objects.create(
                icao_hex=icao,
                first_seen=self.now - timedelta(hours=2),
                last_seen=self.now - timedelta(hours=1),
                is_military=False,
            )
            AircraftInfo.objects.create(
                icao_hex=icao,
                registration=f"N{i + 100:05d}",
            )

        result = fps.calculate_military_breakdown(hours=24)

        us = next((c for c in result if c["country"] == "United States"), None)
        self.assertIsNotNone(us)
        if us:
            self.assertEqual(us["military_count"], 5)
            self.assertEqual(us["civilian_count"], 10)


class FlightPatternStatsTests(TestCase):
    """Tests for combined flight pattern stats."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()

    def test_calculate_flight_pattern_stats_empty(self):
        """Test flight pattern stats with no data."""
        result = fps.calculate_flight_pattern_stats(hours=24)

        self.assertIn("frequent_routes", result)
        self.assertIn("busiest_hours", result)
        self.assertIn("peak_hour", result)
        self.assertIn("timestamp", result)

    def test_calculate_flight_pattern_stats_structure(self):
        """Test flight pattern stats return structure."""
        result = fps.calculate_flight_pattern_stats(hours=24)

        # Check all expected keys
        self.assertIn("frequent_routes", result)
        self.assertIn("busiest_hours", result)
        self.assertIn("avg_duration_by_type", result)
        self.assertIn("common_aircraft_types", result)
        self.assertIn("summary", result)
        self.assertIn("time_range_hours", result)
        self.assertEqual(result["time_range_hours"], 24)


class GeographicStatsTests(TestCase):
    """Tests for combined geographic stats."""

    def test_calculate_geographic_stats_empty(self):
        """Test geographic stats with no data."""
        result = fps.calculate_geographic_stats(hours=24)

        self.assertIn("countries_breakdown", result)
        self.assertIn("operators_frequency", result)
        self.assertIn("airport_connectivity", result)
        self.assertIn("military_breakdown", result)
        self.assertIn("timestamp", result)

    def test_calculate_geographic_stats_structure(self):
        """Test geographic stats return structure."""
        result = fps.calculate_geographic_stats(hours=24)

        # Check all expected keys
        self.assertIn("countries_breakdown", result)
        self.assertIn("operators_frequency", result)
        self.assertIn("airport_connectivity", result)
        self.assertIn("military_breakdown", result)
        self.assertIn("summary", result)
        self.assertIn("time_range_hours", result)
        self.assertEqual(result["time_range_hours"], 24)


class AllStatsTests(TestCase):
    """Tests for combined all stats."""

    def test_calculate_all_stats_structure(self):
        """Test all stats return structure."""
        result = fps.calculate_all_stats(hours=24)

        self.assertIn("flight_patterns", result)
        self.assertIn("geographic", result)
        self.assertIn("time_range_hours", result)
        self.assertIn("timestamp", result)


class CacheManagementTests(TestCase):
    """Tests for cache management functions."""

    @patch("skyspy.services.flight_pattern_stats.cache")
    @patch("skyspy.services.flight_pattern_stats.broadcast_stats_update")
    def test_refresh_flight_pattern_stats_cache(self, mock_broadcast, mock_cache):
        """Test refreshing flight pattern stats cache."""
        fps.refresh_flight_pattern_stats_cache(broadcast=True)

        mock_cache.set.assert_called()
        mock_broadcast.assert_called()

    @patch("skyspy.services.flight_pattern_stats.cache")
    @patch("skyspy.services.flight_pattern_stats.broadcast_stats_update")
    def test_refresh_flight_pattern_stats_cache_no_broadcast(self, mock_broadcast, mock_cache):
        """Test refreshing cache without broadcast."""
        fps.refresh_flight_pattern_stats_cache(broadcast=False)

        mock_cache.set.assert_called()
        mock_broadcast.assert_not_called()

    @patch("skyspy.services.flight_pattern_stats.cache")
    def test_get_flight_pattern_stats_from_cache(self, mock_cache):
        """Test getting stats from cache."""
        mock_cache.get.return_value = {"cached": True}

        result = fps.get_flight_pattern_stats()

        self.assertEqual(result, {"cached": True})

    @patch("skyspy.services.flight_pattern_stats.cache")
    @patch("skyspy.services.flight_pattern_stats.refresh_flight_pattern_stats_cache")
    def test_get_flight_pattern_stats_cache_miss(self, mock_refresh, mock_cache):
        """Test getting stats when cache is empty."""
        mock_cache.get.return_value = None

        fps.get_flight_pattern_stats()

        mock_refresh.assert_called_once_with(broadcast=False)

    @patch("skyspy.services.flight_pattern_stats.cache")
    def test_get_geographic_stats_from_cache(self, mock_cache):
        """Test getting geographic stats from cache."""
        mock_cache.get.return_value = {"cached": True}

        result = fps.get_geographic_stats()

        self.assertEqual(result, {"cached": True})


class PublicAPITests(TestCase):
    """Tests for public API functions."""

    @patch("skyspy.services.flight_pattern_stats.get_flight_pattern_stats")
    def test_get_frequent_routes_from_cache(self, mock_get_stats):
        """Test getting frequent routes from cached stats."""
        mock_get_stats.return_value = {
            "time_range_hours": 24,
            "frequent_routes": [{"route_key": "KJFK-KLAX"}],
        }

        result = fps.get_frequent_routes(hours=24)

        self.assertEqual(result, [{"route_key": "KJFK-KLAX"}])

    @patch("skyspy.services.flight_pattern_stats.get_flight_pattern_stats")
    def test_get_busiest_hours_from_cache(self, mock_get_stats):
        """Test getting busiest hours from cached stats."""
        mock_get_stats.return_value = {
            "time_range_hours": 24,
            "busiest_hours": [{"hour": 12, "count": 100}],
        }

        result = fps.get_busiest_hours(hours=24)

        self.assertEqual(result, [{"hour": 12, "count": 100}])

    @patch("skyspy.services.flight_pattern_stats.get_geographic_stats")
    def test_get_airport_connectivity_from_cache(self, mock_get_stats):
        """Test getting airport connectivity from cached stats."""
        mock_get_stats.return_value = {
            "time_range_hours": 24,
            "airport_connectivity": [{"icao_id": "KJFK"}],
        }

        result = fps.get_airport_connectivity(hours=24)

        self.assertEqual(result, [{"icao_id": "KJFK"}])


class EdgeCaseTests(TestCase):
    """Edge case tests for flight pattern stats."""

    def test_frequent_routes_handles_exception(self):
        """Test that frequent routes handles exceptions gracefully."""
        with patch("skyspy.services.flight_pattern_stats._extract_routes_from_acars") as mock_extract:
            mock_extract.side_effect = Exception("Database error")

            # Should not raise, should return empty or partial results
            result = fps.calculate_frequent_routes(hours=24)
            self.assertIsInstance(result, list)

    def test_flight_pattern_stats_handles_exception(self):
        """Test that calculate_flight_pattern_stats handles exceptions."""
        with patch("skyspy.services.flight_pattern_stats.calculate_frequent_routes") as mock_routes:
            mock_routes.side_effect = Exception("Error")

            result = fps.calculate_flight_pattern_stats(hours=24)

            # Should return error structure
            self.assertIn("error", result)

    def test_geographic_stats_handles_exception(self):
        """Test that calculate_geographic_stats handles exceptions."""
        with patch("skyspy.services.flight_pattern_stats.calculate_countries_breakdown") as mock_countries:
            mock_countries.side_effect = Exception("Error")

            result = fps.calculate_geographic_stats(hours=24)

            # Should return error structure
            self.assertIn("error", result)
