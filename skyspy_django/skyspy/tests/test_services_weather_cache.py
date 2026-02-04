"""
Tests for the weather_cache service.

Tests METAR/PIREP caching, database storage, AWC API integration,
and cache expiration functionality.
"""

import hashlib
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache
from django.test import TestCase

from skyspy.models import CachedPirep
from skyspy.services import weather_cache


class HaversineNmTests(TestCase):
    """Unit tests for the haversine_nm distance calculation."""

    def test_same_point_returns_zero(self):
        """Test that distance between same point is zero."""
        result = weather_cache.haversine_nm(47.0, -122.0, 47.0, -122.0)
        self.assertAlmostEqual(result, 0.0, places=5)

    def test_known_distance(self):
        """Test a known distance (Seattle to Portland approx 145nm)."""
        # Seattle (KSEA) to Portland (KPDX)
        result = weather_cache.haversine_nm(47.4502, -122.3088, 45.5898, -122.5951)
        # Actual is about 145nm, allow some tolerance
        self.assertGreater(result, 100)
        self.assertLess(result, 200)

    def test_east_west_distance(self):
        """Test east-west distance calculation."""
        # Approximate 60nm at equator = 1 degree
        result = weather_cache.haversine_nm(0.0, 0.0, 0.0, 1.0)
        self.assertGreater(result, 50)
        self.assertLess(result, 70)


class MetarCacheKeyTests(TestCase):
    """Tests for METAR cache key generation."""

    def test_make_metar_key_basic(self):
        """Test basic METAR key generation."""
        key = weather_cache._make_metar_key("KSEA", 2)
        self.assertEqual(key, "metar:KSEA:2")

    def test_make_metar_key_lowercase_uppercased(self):
        """Test that lowercase station is uppercased."""
        key = weather_cache._make_metar_key("ksea", 2)
        self.assertEqual(key, "metar:KSEA:2")

    def test_make_metar_key_different_hours(self):
        """Test key varies with hours parameter."""
        key1 = weather_cache._make_metar_key("KSEA", 2)
        key2 = weather_cache._make_metar_key("KSEA", 6)
        self.assertNotEqual(key1, key2)

    def test_make_metar_bbox_key_contains_hash(self):
        """Test bbox key contains hash of coordinates."""
        key = weather_cache._make_metar_bbox_key("24,-130,50,-60", 2)
        self.assertTrue(key.startswith("metar:bbox:"))
        self.assertIn(":2", key)

    def test_make_metar_bbox_key_consistent(self):
        """Test bbox key is consistent for same bbox."""
        key1 = weather_cache._make_metar_bbox_key("24,-130,50,-60", 2)
        key2 = weather_cache._make_metar_bbox_key("24,-130,50,-60", 2)
        self.assertEqual(key1, key2)


class GetCachedMetarTests(TestCase):
    """Tests for METAR cache retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        # Reset stats
        weather_cache._metar_stats["cache_hits"] = 0
        weather_cache._metar_stats["cache_misses"] = 0

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_get_cached_metar_miss(self):
        """Test cache miss returns None."""
        result = weather_cache.get_cached_metar("KSEA")
        self.assertIsNone(result)

    def test_get_cached_metar_hit(self):
        """Test cache hit returns data."""
        test_data = [{"icao": "KSEA", "raw_text": "METAR KSEA..."}]
        cache.set("metar:KSEA:2", test_data)

        result = weather_cache.get_cached_metar("KSEA")
        self.assertEqual(result, test_data)

    def test_get_cached_metar_increments_hit_stats(self):
        """Test that cache hit increments stats."""
        test_data = [{"icao": "KSEA"}]
        cache.set("metar:KSEA:2", test_data)
        initial_hits = weather_cache._metar_stats["cache_hits"]

        weather_cache.get_cached_metar("KSEA")

        self.assertEqual(weather_cache._metar_stats["cache_hits"], initial_hits + 1)

    def test_get_cached_metar_increments_miss_stats(self):
        """Test that cache miss increments stats."""
        initial_misses = weather_cache._metar_stats["cache_misses"]

        weather_cache.get_cached_metar("KJFK")

        self.assertEqual(weather_cache._metar_stats["cache_misses"], initial_misses + 1)


class CacheMetarTests(TestCase):
    """Tests for METAR caching."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_cache_metar_stores_data(self):
        """Test that cache_metar stores data."""
        test_data = [{"icao": "KORD", "raw_text": "METAR KORD..."}]

        result = weather_cache.cache_metar("KORD", test_data)

        self.assertTrue(result)
        cached = cache.get("metar:KORD:2")
        self.assertEqual(cached, test_data)

    def test_cache_metar_custom_ttl(self):
        """Test that custom TTL is respected."""
        test_data = [{"icao": "KORD"}]

        weather_cache.cache_metar("KORD", test_data, ttl=1)

        # Should be cached
        self.assertIsNotNone(cache.get("metar:KORD:2"))


class GetCachedMetarsBboxTests(TestCase):
    """Tests for bbox METAR cache retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        weather_cache._metar_stats["cache_hits"] = 0
        weather_cache._metar_stats["cache_misses"] = 0

    def test_get_cached_metars_bbox_miss(self):
        """Test bbox cache miss."""
        result = weather_cache.get_cached_metars_bbox("24,-130,50,-60")
        self.assertIsNone(result)

    def test_get_cached_metars_bbox_hit(self):
        """Test bbox cache hit."""
        test_data = [{"icao": "KSEA"}, {"icao": "KPDX"}]
        bbox = "24,-130,50,-60"
        key = weather_cache._make_metar_bbox_key(bbox, 2)
        cache.set(key, test_data)

        result = weather_cache.get_cached_metars_bbox(bbox)
        self.assertEqual(result, test_data)


class PirepIdGenerationTests(TestCase):
    """Tests for PIREP ID generation."""

    def test_generate_pirep_id_consistent(self):
        """Test that same PIREP generates same ID."""
        pirep = {
            "rawOb": "UA /OV SEA/TM 1500/FL350/TP B738/TB MOD",
            "lat": 47.5,
            "lon": -122.0,
            "obsTime": 1704067200,
        }

        id1 = weather_cache._generate_pirep_id(pirep)
        id2 = weather_cache._generate_pirep_id(pirep)

        self.assertEqual(id1, id2)

    def test_generate_pirep_id_different_for_different_pireps(self):
        """Test that different PIREPs generate different IDs."""
        pirep1 = {"rawOb": "UA /OV SEA", "lat": 47.5, "lon": -122.0, "obsTime": 1704067200}
        pirep2 = {"rawOb": "UA /OV PDX", "lat": 45.5, "lon": -122.5, "obsTime": 1704067200}

        id1 = weather_cache._generate_pirep_id(pirep1)
        id2 = weather_cache._generate_pirep_id(pirep2)

        self.assertNotEqual(id1, id2)


class ParsePirepTimeTests(TestCase):
    """Tests for PIREP time parsing."""

    def test_parse_pirep_time_unix_timestamp(self):
        """Test parsing Unix timestamp."""
        pirep = {"obsTime": 1704067200}
        result = weather_cache._parse_pirep_time(pirep)

        self.assertIsNotNone(result)
        self.assertIsInstance(result, datetime)

    def test_parse_pirep_time_float_timestamp(self):
        """Test parsing float Unix timestamp."""
        pirep = {"obsTime": 1704067200.5}
        result = weather_cache._parse_pirep_time(pirep)

        self.assertIsNotNone(result)

    def test_parse_pirep_time_iso_string(self):
        """Test parsing ISO format string."""
        pirep = {"obsTime": "2024-01-01T00:00:00Z"}
        result = weather_cache._parse_pirep_time(pirep)

        self.assertIsNotNone(result)

    def test_parse_pirep_time_missing(self):
        """Test handling missing obsTime."""
        pirep = {}
        result = weather_cache._parse_pirep_time(pirep)

        self.assertIsNone(result)

    def test_parse_pirep_time_invalid(self):
        """Test handling invalid obsTime."""
        pirep = {"obsTime": "invalid"}
        result = weather_cache._parse_pirep_time(pirep)

        self.assertIsNone(result)


@pytest.mark.django_db
class StorePirepTests(TestCase):
    """Tests for PIREP database storage."""

    def setUp(self):
        """Set up test fixtures."""
        CachedPirep.objects.all().delete()
        weather_cache._pirep_stats["stored"] = 0
        weather_cache._pirep_stats["duplicates"] = 0

    def tearDown(self):
        """Clean up after tests."""
        CachedPirep.objects.all().delete()

    def test_store_pirep_creates_record(self):
        """Test that store_pirep creates database record."""
        pirep = {
            "rawOb": "UA /OV SEA/TM 1500/FL350/TP B738/TB MOD",
            "reportType": "UA",
            "lat": 47.5,
            "lon": -122.0,
            "obsTime": 1704067200,
            "fltlvl": "350",
            "acType": "B738",
            "turbType": "MOD",
        }

        result = weather_cache.store_pirep(pirep)

        self.assertIsNotNone(result)
        self.assertEqual(CachedPirep.objects.count(), 1)

    def test_store_pirep_duplicate_returns_none(self):
        """Test that storing duplicate PIREP returns None."""
        pirep = {
            "rawOb": "UA /OV SEA/TM 1500/FL350/TP B738/TB MOD",
            "lat": 47.5,
            "lon": -122.0,
            "obsTime": 1704067200,
        }

        weather_cache.store_pirep(pirep)
        result = weather_cache.store_pirep(pirep)

        self.assertIsNone(result)
        self.assertEqual(CachedPirep.objects.count(), 1)

    def test_store_pirep_increments_duplicate_stat(self):
        """Test that duplicate increments stats."""
        pirep = {"rawOb": "UA /OV SEA", "lat": 47.5, "lon": -122.0, "obsTime": 1704067200}
        initial_dupes = weather_cache._pirep_stats["duplicates"]

        weather_cache.store_pirep(pirep)
        weather_cache.store_pirep(pirep)

        self.assertEqual(weather_cache._pirep_stats["duplicates"], initial_dupes + 1)


@pytest.mark.django_db
class StorePirepsTests(TestCase):
    """Tests for bulk PIREP storage."""

    def setUp(self):
        """Set up test fixtures."""
        CachedPirep.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        CachedPirep.objects.all().delete()

    def test_store_pireps_empty_list(self):
        """Test storing empty list returns 0."""
        result = weather_cache.store_pireps([])
        self.assertEqual(result, 0)

    def test_store_pireps_multiple(self):
        """Test storing multiple PIREPs."""
        pireps = [
            {"rawOb": "UA /OV SEA", "lat": 47.5, "lon": -122.0, "obsTime": 1704067200},
            {"rawOb": "UA /OV PDX", "lat": 45.5, "lon": -122.5, "obsTime": 1704067201},
        ]

        result = weather_cache.store_pireps(pireps)

        self.assertEqual(result, 2)
        self.assertEqual(CachedPirep.objects.count(), 2)


@pytest.mark.django_db
class GetCachedPirepsTests(TestCase):
    """Tests for PIREP retrieval from cache."""

    def setUp(self):
        """Set up test fixtures."""
        CachedPirep.objects.all().delete()
        # Create test PIREPs
        now = datetime.utcnow()
        CachedPirep.objects.create(
            pirep_id="test1",
            latitude=47.5,
            longitude=-122.0,
            observation_time=now - timedelta(hours=1),
            raw_text="UA /OV SEA",
        )
        CachedPirep.objects.create(
            pirep_id="test2",
            latitude=45.5,
            longitude=-122.5,
            observation_time=now - timedelta(hours=2),
            raw_text="UA /OV PDX",
        )

    def tearDown(self):
        """Clean up after tests."""
        CachedPirep.objects.all().delete()

    def test_get_cached_pireps_no_location(self):
        """Test getting all PIREPs without location filter."""
        result = weather_cache.get_cached_pireps()

        self.assertEqual(len(result), 2)

    def test_get_cached_pireps_with_location(self):
        """Test getting PIREPs near a location."""
        result = weather_cache.get_cached_pireps(lat=47.5, lon=-122.0, radius_nm=50)

        # Should include at least the SEA PIREP
        self.assertGreater(len(result), 0)

    def test_get_cached_pireps_respects_limit(self):
        """Test that limit parameter is respected."""
        result = weather_cache.get_cached_pireps(limit=1)

        self.assertEqual(len(result), 1)


@pytest.mark.django_db
class CleanupOldPirepsTests(TestCase):
    """Tests for PIREP cleanup."""

    def setUp(self):
        """Set up test fixtures."""
        CachedPirep.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        CachedPirep.objects.all().delete()

    def test_cleanup_old_pireps_removes_old(self):
        """Test that old PIREPs are removed."""
        now = datetime.utcnow()
        # Create old PIREP
        CachedPirep.objects.create(
            pirep_id="old",
            observation_time=now - timedelta(hours=48),
            raw_text="old pirep",
        )
        # Create recent PIREP
        CachedPirep.objects.create(
            pirep_id="recent",
            observation_time=now - timedelta(hours=1),
            raw_text="recent pirep",
        )

        deleted = weather_cache.cleanup_old_pireps(retention_hours=24)

        self.assertEqual(deleted, 1)
        self.assertEqual(CachedPirep.objects.count(), 1)
        self.assertTrue(CachedPirep.objects.filter(pirep_id="recent").exists())


class AwcApiTests(TestCase):
    """Tests for AWC API integration."""

    @patch("skyspy.services.weather_cache._http_get_awc")
    def test_fetch_awc_data_success(self, mock_http_get):
        """Test successful AWC API fetch."""
        mock_response = MagicMock()
        mock_response.text = '[{"icao": "KSEA"}]'
        mock_response.json.return_value = [{"icao": "KSEA"}]
        mock_http_get.return_value = mock_response

        result = weather_cache._fetch_awc_data("metar", {"ids": "KSEA"})

        self.assertEqual(result, [{"icao": "KSEA"}])

    @patch("skyspy.services.weather_cache._http_get_awc")
    def test_fetch_awc_data_error(self, mock_http_get):
        """Test AWC API fetch error handling."""
        mock_http_get.side_effect = httpx.HTTPError("Connection failed")

        result = weather_cache._fetch_awc_data("metar", {"ids": "KSEA"})

        self.assertIn("error", result)


class FetchAndStorePirepsTests(TestCase):
    """Tests for PIREP fetching and storing."""

    def setUp(self):
        """Set up test fixtures."""
        CachedPirep.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        CachedPirep.objects.all().delete()

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_store_pireps_success(self, mock_fetch):
        """Test successful PIREP fetch and store."""
        mock_fetch.return_value = [{"rawOb": "UA /OV SEA", "lat": 47.5, "lon": -122.0, "obsTime": 1704067200}]

        result = weather_cache.fetch_and_store_pireps()

        self.assertEqual(result, 1)

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_store_pireps_api_error(self, mock_fetch):
        """Test PIREP fetch with API error."""
        mock_fetch.return_value = {"error": "API error"}

        result = weather_cache.fetch_and_store_pireps()

        self.assertEqual(result, 0)

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_store_pireps_invalid_format(self, mock_fetch):
        """Test PIREP fetch with invalid data format."""
        mock_fetch.return_value = {"not": "a list"}

        result = weather_cache.fetch_and_store_pireps()

        self.assertEqual(result, 0)


class FetchAndCacheMetarsTests(TestCase):
    """Tests for METAR fetching and caching."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_cache_metars_uses_cache(self, mock_fetch):
        """Test that cached METARs are returned without API call."""
        bbox = "24,-130,50,-60"
        key = weather_cache._make_metar_bbox_key(bbox, 2)
        cached_data = [{"icao": "KSEA"}]
        cache.set(key, cached_data)

        result = weather_cache.fetch_and_cache_metars(bbox)

        mock_fetch.assert_not_called()
        self.assertEqual(result, cached_data)

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_cache_metars_fetches_on_miss(self, mock_fetch):
        """Test that API is called on cache miss."""
        mock_fetch.return_value = [{"icao": "KSEA"}, {"icao": "KPDX"}]

        result = weather_cache.fetch_and_cache_metars("24,-130,50,-60")

        mock_fetch.assert_called_once()
        self.assertEqual(len(result), 2)


class FetchMetarByStationTests(TestCase):
    """Tests for station-specific METAR fetching."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_metar_by_station_uses_cache(self, mock_fetch):
        """Test station METAR returns from cache."""
        cache.set("metar:KSEA:2", [{"icao": "KSEA"}])

        result = weather_cache.fetch_metar_by_station("KSEA")

        mock_fetch.assert_not_called()
        self.assertEqual(result, [{"icao": "KSEA"}])

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_metar_by_station_fetches_on_miss(self, mock_fetch):
        """Test station METAR fetches from API on miss."""
        mock_fetch.return_value = [{"icao": "KJFK", "raw_text": "METAR KJFK..."}]

        result = weather_cache.fetch_metar_by_station("KJFK")

        mock_fetch.assert_called_once()
        self.assertEqual(result, [{"icao": "KJFK", "raw_text": "METAR KJFK..."}])


class FetchAndCacheTafsTests(TestCase):
    """Tests for TAF fetching and caching."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_cache_tafs_success(self, mock_fetch):
        """Test successful TAF fetch."""
        mock_fetch.return_value = [{"icao": "KSEA", "rawTaf": "TAF KSEA..."}]

        result = weather_cache.fetch_and_cache_tafs("24,-130,50,-60")

        self.assertEqual(len(result), 1)

    @patch("skyspy.services.weather_cache._fetch_awc_data")
    def test_fetch_and_cache_tafs_error(self, mock_fetch):
        """Test TAF fetch with API error."""
        mock_fetch.return_value = {"error": "API error"}

        result = weather_cache.fetch_and_cache_tafs("24,-130,50,-60")

        self.assertEqual(result, [])


class RecordMetarApiRequestTests(TestCase):
    """Tests for METAR API request tracking."""

    def setUp(self):
        """Reset stats."""
        weather_cache._metar_stats["api_requests"] = 0
        weather_cache._metar_stats["api_errors"] = 0

    def test_record_metar_api_request_success(self):
        """Test recording successful API request."""
        initial = weather_cache._metar_stats["api_requests"]

        weather_cache.record_metar_api_request(success=True)

        self.assertEqual(weather_cache._metar_stats["api_requests"], initial + 1)

    def test_record_metar_api_request_error(self):
        """Test recording failed API request."""
        initial_requests = weather_cache._metar_stats["api_requests"]
        initial_errors = weather_cache._metar_stats["api_errors"]

        weather_cache.record_metar_api_request(success=False)

        self.assertEqual(weather_cache._metar_stats["api_requests"], initial_requests + 1)
        self.assertEqual(weather_cache._metar_stats["api_errors"], initial_errors + 1)

    def test_record_metar_api_request_updates_timestamp(self):
        """Test that last API call timestamp is updated."""
        weather_cache.record_metar_api_request(success=True)

        self.assertIsNotNone(weather_cache._metar_stats["last_api_call"])


class GetMetarStatsTests(TestCase):
    """Tests for METAR statistics retrieval."""

    def test_get_metar_stats_returns_dict(self):
        """Test that get_metar_stats returns expected structure."""
        stats = weather_cache.get_metar_stats()

        self.assertIn("cache_hits", stats)
        self.assertIn("cache_misses", stats)
        self.assertIn("api_requests", stats)
        self.assertIn("api_errors", stats)
        self.assertIn("hit_rate", stats)

    def test_get_metar_stats_hit_rate_calculation(self):
        """Test hit rate calculation."""
        weather_cache._metar_stats["cache_hits"] = 80
        weather_cache._metar_stats["cache_misses"] = 20

        stats = weather_cache.get_metar_stats()

        self.assertEqual(stats["hit_rate"], 80.0)


class AviationDataCacheTests(TestCase):
    """Tests for generic aviation data caching."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_make_aviation_cache_key(self):
        """Test aviation cache key generation."""
        key = weather_cache._make_aviation_cache_key("airports", "24,-130,50,-60")

        self.assertTrue(key.startswith("aviation:airports:"))

    def test_get_cached_aviation_data_miss(self):
        """Test cache miss returns None."""
        result = weather_cache.get_cached_aviation_data("airports", "24,-130,50,-60")
        self.assertIsNone(result)

    def test_get_cached_aviation_data_hit(self):
        """Test cache hit returns data."""
        bbox = "24,-130,50,-60"
        key = weather_cache._make_aviation_cache_key("airports", bbox)
        test_data = [{"icao": "KSEA"}, {"icao": "KPDX"}]
        cache.set(key, test_data)

        result = weather_cache.get_cached_aviation_data("airports", bbox)

        self.assertEqual(result, test_data)

    def test_cache_aviation_data_stores_data(self):
        """Test aviation data caching."""
        bbox = "24,-130,50,-60"
        test_data = [{"icao": "KSEA"}]

        result = weather_cache.cache_aviation_data("navaids", bbox, test_data)

        self.assertTrue(result)
        key = weather_cache._make_aviation_cache_key("navaids", bbox)
        self.assertEqual(cache.get(key), test_data)
