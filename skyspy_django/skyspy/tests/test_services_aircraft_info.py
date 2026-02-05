"""
Tests for the aircraft_info service.

Tests aircraft lookup operations including:
- In-memory caching with TTL
- Rate limiting per aircraft
- Database lookups
- External API fetching
- Photo URL management
- Bulk lookups
- Cache management
"""

import time
from unittest.mock import MagicMock, patch

from django.test import TestCase

from skyspy.models import AircraftInfo
from skyspy.services import aircraft_info


class AircraftInfoCacheTests(TestCase):
    """Tests for in-memory caching functionality."""

    def setUp(self):
        """Set up test fixtures and clear caches."""
        AircraftInfo.objects.all().delete()
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()
        aircraft_info._last_lookup.clear()
        aircraft_info._pending_lookups.clear()
        aircraft_info._seen_aircraft.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftInfo.objects.all().delete()
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()
        aircraft_info._last_lookup.clear()
        aircraft_info._pending_lookups.clear()
        aircraft_info._seen_aircraft.clear()

    def test_update_cache_stores_info(self):
        """Test that _update_cache stores aircraft info."""
        info = {"icao_hex": "ABC123", "registration": "N12345"}

        aircraft_info._update_cache("ABC123", info)

        self.assertIn("ABC123", aircraft_info._info_cache)
        self.assertEqual(aircraft_info._info_cache["ABC123"]["registration"], "N12345")

    def test_update_cache_sets_ttl(self):
        """Test that _update_cache sets TTL."""
        info = {"icao_hex": "ABC123"}

        aircraft_info._update_cache("ABC123", info)

        self.assertIn("ABC123", aircraft_info._cache_ttl)
        self.assertGreater(aircraft_info._cache_ttl["ABC123"], time.time())

    def test_invalidate_cache_removes_entry(self):
        """Test that invalidate_cache removes cached entry."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600

        aircraft_info.invalidate_cache("ABC123")

        self.assertNotIn("ABC123", aircraft_info._info_cache)
        self.assertNotIn("ABC123", aircraft_info._cache_ttl)

    def test_invalidate_cache_handles_nonexistent(self):
        """Test that invalidate_cache handles non-existent keys."""
        # Should not raise
        aircraft_info.invalidate_cache("NONEXISTENT")

    def test_evict_old_cache_entries_removes_expired(self):
        """Test that expired entries are evicted."""
        aircraft_info._info_cache["OLD001"] = {"icao_hex": "OLD001"}
        aircraft_info._cache_ttl["OLD001"] = time.time() - 100  # Expired

        aircraft_info._info_cache["NEW001"] = {"icao_hex": "NEW001"}
        aircraft_info._cache_ttl["NEW001"] = time.time() + 3600  # Valid

        aircraft_info._evict_old_cache_entries()

        self.assertNotIn("OLD001", aircraft_info._info_cache)
        self.assertIn("NEW001", aircraft_info._info_cache)


class AircraftInfoRateLimitTests(TestCase):
    """Tests for rate limiting functionality."""

    def setUp(self):
        """Clear rate limit state."""
        aircraft_info._last_lookup.clear()

    def tearDown(self):
        """Clean up rate limit state."""
        aircraft_info._last_lookup.clear()

    def test_can_fetch_initially(self):
        """Test that initial fetch is allowed."""
        result = aircraft_info._can_fetch_from_api("ABC123")

        self.assertTrue(result)

    def test_cannot_fetch_within_rate_limit(self):
        """Test that fetch is blocked within rate limit window."""
        # First fetch
        aircraft_info._can_fetch_from_api("ABC123")

        # Immediate second fetch should be blocked
        result = aircraft_info._can_fetch_from_api("ABC123")

        self.assertFalse(result)

    def test_different_aircraft_independent_rate_limits(self):
        """Test that different aircraft have independent rate limits."""
        aircraft_info._can_fetch_from_api("ABC123")

        # Different aircraft should be allowed
        result = aircraft_info._can_fetch_from_api("DEF456")

        self.assertTrue(result)

    def test_cleanup_rate_limit_entries(self):
        """Test that old rate limit entries are cleaned up."""
        now = time.time()
        aircraft_info._last_lookup["OLD001"] = now - 300  # 5 minutes old
        aircraft_info._last_lookup["NEW001"] = now  # Current

        aircraft_info._cleanup_rate_limit_entries(now)

        self.assertNotIn("OLD001", aircraft_info._last_lookup)
        self.assertIn("NEW001", aircraft_info._last_lookup)


class GetAircraftInfoTests(TestCase):
    """Tests for the main get_aircraft_info function."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftInfo.objects.all().delete()
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()
        aircraft_info._last_lookup.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftInfo.objects.all().delete()
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()
        aircraft_info._last_lookup.clear()

    def test_returns_none_for_invalid_icao(self):
        """Test that invalid ICAO returns None."""
        result = aircraft_info.get_aircraft_info("")
        self.assertIsNone(result)

        result = aircraft_info.get_aircraft_info("AB")  # Too short
        self.assertIsNone(result)

        result = aircraft_info.get_aircraft_info("ABC12345")  # Too long
        self.assertIsNone(result)

    def test_normalizes_icao_to_uppercase(self):
        """Test that ICAO is normalized to uppercase."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123", "registration": "N12345"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600

        result = aircraft_info.get_aircraft_info("abc123")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "ABC123")

    def test_strips_tilde_prefix(self):
        """Test that tilde prefix is stripped from ICAO."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123", "registration": "N12345"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600

        result = aircraft_info.get_aircraft_info("~ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "ABC123")

    def test_returns_cached_info(self):
        """Test that cached info is returned."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123", "registration": "N12345"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600

        result = aircraft_info.get_aircraft_info("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")

    def test_returns_database_info(self):
        """Test that database info is returned."""
        AircraftInfo.objects.create(
            icao_hex="ABC123",
            registration="N12345",
            type_code="B738",
            manufacturer="Boeing",
            fetch_failed=False,
        )

        result = aircraft_info.get_aircraft_info("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["type_code"], "B738")

    def test_skips_failed_database_lookups(self):
        """Test that failed lookups in database are skipped."""
        AircraftInfo.objects.create(
            icao_hex="ABC123",
            registration="N12345",
            fetch_failed=True,  # Marked as failed
        )

        with patch("skyspy.services.aircraft_info.external_db") as mock_external:
            mock_external.lookup_all.return_value = None
            with patch("skyspy.services.aircraft_info._fetch_from_external_apis") as mock_fetch:
                mock_fetch.return_value = None

                result = aircraft_info.get_aircraft_info("ABC123")

        # Should not return the failed record
        self.assertIsNone(result)

    @patch("skyspy.services.aircraft_info.external_db")
    def test_uses_external_db_lookup(self, mock_external):
        """Test that external database is used when available."""
        mock_external.lookup_all.return_value = {
            "registration": "N12345",
            "type_code": "B738",
            "manufacturer": "Boeing",
        }

        result = aircraft_info.get_aircraft_info("ABC123")

        self.assertIsNotNone(result)
        mock_external.lookup_all.assert_called_once_with("ABC123")


class GetBulkAircraftInfoTests(TestCase):
    """Tests for bulk aircraft info retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftInfo.objects.all().delete()
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()

    def tearDown(self):
        """Clean up after tests."""
        AircraftInfo.objects.all().delete()
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()

    def test_returns_empty_for_empty_list(self):
        """Test that empty list returns empty dict."""
        result = aircraft_info.get_bulk_aircraft_info([])

        self.assertEqual(result, {})

    def test_returns_cached_entries(self):
        """Test that cached entries are returned."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123", "registration": "N12345"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600
        aircraft_info._info_cache["DEF456"] = {"icao_hex": "DEF456", "registration": "N67890"}
        aircraft_info._cache_ttl["DEF456"] = time.time() + 3600

        result = aircraft_info.get_bulk_aircraft_info(["ABC123", "DEF456"])

        self.assertEqual(len(result), 2)
        self.assertEqual(result["ABC123"]["registration"], "N12345")
        self.assertEqual(result["DEF456"]["registration"], "N67890")

    def test_normalizes_icaos(self):
        """Test that ICAOs are normalized in bulk lookup."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600

        result = aircraft_info.get_bulk_aircraft_info(["abc123", " ABC123 "])

        # Should find the entry
        self.assertIn("ABC123", result)

    def test_skips_invalid_icaos(self):
        """Test that invalid ICAOs are skipped."""
        result = aircraft_info.get_bulk_aircraft_info(["", "AB", "ABC12345"])

        self.assertEqual(result, {})

    def test_fetches_from_database_for_missing(self):
        """Test that missing entries are fetched from database."""
        AircraftInfo.objects.create(
            icao_hex="ABC123",
            registration="N12345",
            fetch_failed=False,
        )

        result = aircraft_info.get_bulk_aircraft_info(["ABC123"])

        self.assertIn("ABC123", result)
        self.assertEqual(result["ABC123"]["registration"], "N12345")


class QueueAircraftLookupTests(TestCase):
    """Tests for background lookup queue."""

    def setUp(self):
        """Clear pending lookups."""
        aircraft_info._pending_lookups.clear()

    def tearDown(self):
        """Clean up pending lookups."""
        aircraft_info._pending_lookups.clear()

    def test_returns_false_for_invalid_icao(self):
        """Test that invalid ICAO returns False."""
        result = aircraft_info.queue_aircraft_lookup("")
        self.assertFalse(result)

        result = aircraft_info.queue_aircraft_lookup("AB")
        self.assertFalse(result)

    def test_returns_false_if_already_pending(self):
        """Test that already pending ICAO returns False."""
        aircraft_info._pending_lookups.add("ABC123")

        result = aircraft_info.queue_aircraft_lookup("ABC123")

        self.assertFalse(result)

    @patch("skyspy.tasks.external_db.fetch_aircraft_info")
    def test_queues_valid_lookup(self, mock_fetch):
        """Test that valid ICAO is queued."""
        mock_fetch.delay = MagicMock()

        result = aircraft_info.queue_aircraft_lookup("ABC123")

        self.assertTrue(result)
        self.assertIn("ABC123", aircraft_info._pending_lookups)
        mock_fetch.delay.assert_called_once_with("ABC123")

    def test_returns_false_at_max_pending(self):
        """Test that queue rejects at max capacity."""
        # Fill up pending queue
        for i in range(aircraft_info.MAX_PENDING):
            aircraft_info._pending_lookups.add(f"AC{i:04d}")

        result = aircraft_info.queue_aircraft_lookup("NEW001")

        self.assertFalse(result)

    def test_clear_pending_removes_entry(self):
        """Test that clear_pending removes entry."""
        aircraft_info._pending_lookups.add("ABC123")

        aircraft_info.clear_pending("ABC123")

        self.assertNotIn("ABC123", aircraft_info._pending_lookups)


class CheckAndQueueNewAircraftTests(TestCase):
    """Tests for checking and queuing new aircraft."""

    def setUp(self):
        """Clear seen aircraft."""
        aircraft_info._seen_aircraft.clear()
        aircraft_info._pending_lookups.clear()

    def tearDown(self):
        """Clean up."""
        aircraft_info._seen_aircraft.clear()
        aircraft_info._pending_lookups.clear()

    def test_returns_zero_for_empty_list(self):
        """Test that empty list returns zero queued."""
        result = aircraft_info.check_and_queue_new_aircraft([])

        self.assertEqual(result, 0)

    @patch("skyspy.services.aircraft_info.queue_aircraft_lookup")
    def test_queues_new_aircraft(self, mock_queue):
        """Test that new aircraft are queued."""
        mock_queue.return_value = True
        aircraft_list = [{"hex": "ABC123"}, {"hex": "DEF456"}]

        result = aircraft_info.check_and_queue_new_aircraft(aircraft_list)

        self.assertEqual(result, 2)
        self.assertIn("ABC123", aircraft_info._seen_aircraft)
        self.assertIn("DEF456", aircraft_info._seen_aircraft)

    @patch("skyspy.services.aircraft_info.queue_aircraft_lookup")
    def test_skips_already_seen_aircraft(self, mock_queue):
        """Test that already seen aircraft are not queued."""
        mock_queue.return_value = True
        aircraft_info._seen_aircraft.add("ABC123")

        aircraft_list = [{"hex": "ABC123"}, {"hex": "DEF456"}]

        result = aircraft_info.check_and_queue_new_aircraft(aircraft_list)

        self.assertEqual(result, 1)
        self.assertEqual(mock_queue.call_count, 1)

    @patch("skyspy.services.aircraft_info.queue_aircraft_lookup")
    def test_skips_tilde_prefixed_icao(self, mock_queue):
        """Test that tilde-prefixed ICAOs are skipped."""
        mock_queue.return_value = True
        aircraft_list = [{"hex": "~ABC123"}]

        result = aircraft_info.check_and_queue_new_aircraft(aircraft_list)

        self.assertEqual(result, 0)

    def test_clears_seen_at_max_size(self):
        """Test that seen aircraft set is cleared at max size."""
        # Fill up to max
        for i in range(aircraft_info.MAX_SEEN + 1):
            aircraft_info._seen_aircraft.add(f"AC{i:05d}")

        with patch("skyspy.services.aircraft_info.queue_aircraft_lookup") as mock_queue:
            mock_queue.return_value = True
            aircraft_info.check_and_queue_new_aircraft([{"hex": "NEW001"}])

        # Set should have been cleared and only NEW001 added
        self.assertLessEqual(len(aircraft_info._seen_aircraft), 1)


class GetAircraftPhotoTests(TestCase):
    """Tests for photo URL retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftInfo.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AircraftInfo.objects.all().delete()

    def test_returns_none_for_no_record(self):
        """Test that None is returned when no record exists."""
        result = aircraft_info.get_aircraft_photo("ABC123")

        self.assertIsNone(result)

    def test_returns_photo_url(self):
        """Test that photo URL is returned when available."""
        AircraftInfo.objects.create(
            icao_hex="ABC123",
            photo_url="https://example.com/photo.jpg",
            fetch_failed=False,
        )

        result = aircraft_info.get_aircraft_photo("ABC123")

        self.assertEqual(result, "https://example.com/photo.jpg")

    def test_returns_thumbnail_when_preferred(self):
        """Test that thumbnail URL is returned when preferred."""
        AircraftInfo.objects.create(
            icao_hex="ABC123",
            photo_url="https://example.com/photo.jpg",
            photo_thumbnail_url="https://example.com/thumb.jpg",
            fetch_failed=False,
        )

        result = aircraft_info.get_aircraft_photo("ABC123", prefer_thumbnail=True)

        self.assertEqual(result, "https://example.com/thumb.jpg")

    def test_falls_back_to_full_url_when_no_thumbnail(self):
        """Test that full URL is returned when no thumbnail."""
        AircraftInfo.objects.create(
            icao_hex="ABC123",
            photo_url="https://example.com/photo.jpg",
            photo_thumbnail_url=None,
            fetch_failed=False,
        )

        result = aircraft_info.get_aircraft_photo("ABC123", prefer_thumbnail=True)

        self.assertEqual(result, "https://example.com/photo.jpg")


class GetCacheStatsTests(TestCase):
    """Tests for cache statistics."""

    def setUp(self):
        """Clear all caches."""
        aircraft_info._info_cache.clear()
        aircraft_info._pending_lookups.clear()
        aircraft_info._seen_aircraft.clear()

    def tearDown(self):
        """Clean up caches."""
        aircraft_info._info_cache.clear()
        aircraft_info._pending_lookups.clear()
        aircraft_info._seen_aircraft.clear()

    @patch("skyspy.services.aircraft_info.external_db")
    def test_returns_stats(self, mock_external):
        """Test that cache stats are returned."""
        mock_external.is_any_loaded.return_value = True
        mock_external.get_database_stats.return_value = {"test": "stats"}

        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123"}
        aircraft_info._pending_lookups.add("DEF456")
        aircraft_info._seen_aircraft.add("GHI789")

        stats = aircraft_info.get_cache_stats()

        self.assertEqual(stats["cache_count"], 1)
        self.assertEqual(stats["pending_lookups"], 1)
        self.assertEqual(stats["seen_aircraft"], 1)
        self.assertTrue(stats["databases_loaded"])


class RefreshAircraftInfoTests(TestCase):
    """Tests for refresh functionality."""

    def setUp(self):
        """Clear caches."""
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()
        aircraft_info._last_lookup.clear()

    def tearDown(self):
        """Clean up."""
        aircraft_info._info_cache.clear()
        aircraft_info._cache_ttl.clear()
        aircraft_info._last_lookup.clear()

    @patch("skyspy.services.aircraft_info.get_aircraft_info")
    def test_clears_cache_before_refresh(self, mock_get):
        """Test that cache is cleared before refresh."""
        aircraft_info._info_cache["ABC123"] = {"icao_hex": "ABC123"}
        aircraft_info._cache_ttl["ABC123"] = time.time() + 3600
        aircraft_info._last_lookup["ABC123"] = time.time()
        mock_get.return_value = {"icao_hex": "ABC123", "registration": "N12345"}

        aircraft_info.refresh_aircraft_info("ABC123")

        # Cache should have been cleared before re-fetch
        mock_get.assert_called_once()
        self.assertNotIn("ABC123", aircraft_info._last_lookup)


class NormalizeExternalDataTests(TestCase):
    """Tests for external data normalization."""

    def test_normalizes_complete_data(self):
        """Test normalization of complete external data."""
        data = {
            "registration": "N12345",
            "type_code": "B738",
            "type_name": "Boeing 737-800",
            "manufacturer": "Boeing",
            "model": "737-800",
            "operator": "United Airlines",
            "operator_icao": "UAL",
            "owner": "United Airlines Inc",
            "year_built": 2015,
            "serial_number": "12345",
            "country": "United States",
            "category": "A3",
            "is_military": False,
            "is_interesting": False,
            "is_pia": False,
            "is_ladd": False,
            "sources": ["hexdb", "adsb.lol"],
        }

        result = aircraft_info._normalize_external_data("ABC123", data)

        self.assertEqual(result["icao_hex"], "ABC123")
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["type_code"], "B738")
        self.assertEqual(result["manufacturer"], "Boeing")

    def test_normalizes_partial_data(self):
        """Test normalization of partial external data."""
        data = {
            "registration": "N12345",
        }

        result = aircraft_info._normalize_external_data("ABC123", data)

        self.assertEqual(result["icao_hex"], "ABC123")
        self.assertEqual(result["registration"], "N12345")
        self.assertIsNone(result["type_code"])

    def test_uses_owner_as_operator_fallback(self):
        """Test that owner is used as operator fallback."""
        data = {
            "owner": "Private Owner",
        }

        result = aircraft_info._normalize_external_data("ABC123", data)

        self.assertEqual(result["operator"], "Private Owner")


class SerializeDbInfoTests(TestCase):
    """Tests for database info serialization."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftInfo.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AircraftInfo.objects.all().delete()

    def test_serializes_all_fields(self):
        """Test that all fields are serialized."""
        info = AircraftInfo.objects.create(
            icao_hex="ABC123",
            registration="N12345",
            type_code="B738",
            type_name="Boeing 737-800",
            manufacturer="Boeing",
            model="737-800",
            operator="United Airlines",
            operator_icao="UAL",
            owner="United Airlines Inc",
            year_built=2015,
            serial_number="12345",
            country="United States",
            category="A3",
            is_military=False,
            is_interesting=True,
            is_pia=False,
            is_ladd=False,
            photo_url="https://example.com/photo.jpg",
            photo_thumbnail_url="https://example.com/thumb.jpg",
            photo_page_link="https://planespotters.net/photo/123",
            photo_photographer="John Doe",
            photo_source="planespotters.net",
            source="hexdb",
        )

        result = aircraft_info._serialize_db_info(info)

        self.assertEqual(result["icao_hex"], "ABC123")
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["type_code"], "B738")
        self.assertEqual(result["manufacturer"], "Boeing")
        self.assertEqual(result["photo_url"], "https://example.com/photo.jpg")
        self.assertTrue(result["is_interesting"])
