"""
Tests for the External Database Service.

Tests external database integrations, data fetching, lookups,
and error handling for ADSBX, tar1090, FAA, and OpenSky databases.
"""

import gzip
import json
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from unittest.mock import MagicMock, Mock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.models import AircraftInfo, AirframeSourceData
from skyspy.services import external_db
from skyspy.services.external_db import (
    REGISTRATION_PREFIXES,
    _extract_country_from_registration,
    _safe_int,
    _trunc,
    download_adsbx_database,
    download_faa_database,
    download_opensky_database,
    download_tar1090_database,
    fetch_aircraft_from_adsb_lol,
    fetch_route,
    fetch_with_retry,
    get_database_stats,
    init_databases,
    is_any_loaded,
    load_adsbx_database,
    load_faa_database,
    load_opensky_database,
    load_tar1090_database,
    lookup_adsbx,
    lookup_all,
    lookup_all_by_source,
    lookup_faa,
    lookup_opensky,
    lookup_tar1090,
    stream_with_retry,
    sync_databases_to_postgres,
    update_databases_if_stale,
)


class HelperFunctionTests(TestCase):
    """Tests for helper functions."""

    def test_trunc_none(self):
        """Test _trunc with None value."""
        self.assertIsNone(_trunc(None, 10))

    def test_trunc_short_string(self):
        """Test _trunc with short string."""
        self.assertEqual(_trunc("hello", 10), "hello")

    def test_trunc_long_string(self):
        """Test _trunc with long string."""
        self.assertEqual(_trunc("hello world", 5), "hello")

    def test_trunc_strips_whitespace(self):
        """Test _trunc strips whitespace."""
        self.assertEqual(_trunc("  hello  ", 10), "hello")

    def test_safe_int_none(self):
        """Test _safe_int with None."""
        self.assertIsNone(_safe_int(None))

    def test_safe_int_int(self):
        """Test _safe_int with int."""
        self.assertEqual(_safe_int(42), 42)

    def test_safe_int_float(self):
        """Test _safe_int with float."""
        self.assertEqual(_safe_int(42.7), 42)

    def test_safe_int_string(self):
        """Test _safe_int with numeric string."""
        self.assertEqual(_safe_int("42"), 42)

    def test_safe_int_invalid_string(self):
        """Test _safe_int with invalid string."""
        self.assertIsNone(_safe_int("not a number"))


class ExtractCountryTests(TestCase):
    """Tests for country extraction from registration."""

    def test_us_registration(self):
        """Test US registration extraction."""
        self.assertEqual(_extract_country_from_registration("N12345"), "United States")
        self.assertEqual(_extract_country_from_registration("N1AB"), "United States")

    def test_uk_registration(self):
        """Test UK registration extraction."""
        self.assertEqual(_extract_country_from_registration("G-ABCD"), "United Kingdom")

    def test_canada_registration(self):
        """Test Canadian registration extraction."""
        self.assertEqual(_extract_country_from_registration("C-FABC"), "Canada")

    def test_germany_registration(self):
        """Test German registration extraction."""
        self.assertEqual(_extract_country_from_registration("D-ABCD"), "Germany")

    def test_japan_registration(self):
        """Test Japanese registration extraction."""
        self.assertEqual(_extract_country_from_registration("JA1234"), "Japan")

    def test_australia_registration(self):
        """Test Australian registration extraction."""
        self.assertEqual(_extract_country_from_registration("VH-ABC"), "Australia")

    def test_case_insensitive(self):
        """Test case insensitivity."""
        self.assertEqual(_extract_country_from_registration("g-abcd"), "United Kingdom")

    def test_empty_registration(self):
        """Test empty registration."""
        self.assertIsNone(_extract_country_from_registration(""))
        self.assertIsNone(_extract_country_from_registration(None))

    def test_unknown_prefix(self):
        """Test unknown prefix returns None."""
        self.assertIsNone(_extract_country_from_registration("ZZ-1234"))


class RegistrationPrefixesTests(TestCase):
    """Tests for REGISTRATION_PREFIXES constant."""

    def test_major_countries_present(self):
        """Test that major countries are in prefix map."""
        self.assertIn("N", REGISTRATION_PREFIXES)  # US
        self.assertIn("G-", REGISTRATION_PREFIXES)  # UK
        self.assertIn("D-", REGISTRATION_PREFIXES)  # Germany
        self.assertIn("F-", REGISTRATION_PREFIXES)  # France
        self.assertIn("C-", REGISTRATION_PREFIXES)  # Canada

    def test_prefix_values_are_countries(self):
        """Test that prefix values are country names."""
        for _prefix, country in REGISTRATION_PREFIXES.items():
            self.assertIsInstance(country, str)
            self.assertGreater(len(country), 0)


class FetchWithRetryTests(TestCase):
    """Tests for fetch_with_retry function."""

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_success(self, mock_client_class):
        """Test successful fetch."""
        mock_response = Mock()
        mock_response.raise_for_status = Mock()
        mock_client = Mock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        result = fetch_with_retry("https://example.com/test")

        self.assertEqual(result, mock_response)
        mock_response.raise_for_status.assert_called_once()

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_retries_on_failure(self, mock_client_class):
        """Test that fetch retries on failure."""
        import httpx
        from tenacity import RetryError

        mock_client = Mock()
        mock_client.get.side_effect = httpx.RequestError("Connection failed")
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        with self.assertRaises(RetryError):
            fetch_with_retry("https://example.com/test")

        # Should have retried multiple times (3 attempts)
        self.assertEqual(mock_client.get.call_count, 3)


class StreamWithRetryTests(TestCase):
    """Tests for stream_with_retry function."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up after tests."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @patch("skyspy.services.external_db.httpx.Client")
    def test_stream_success(self, mock_client_class):
        """Test successful stream download."""
        mock_response = Mock()
        mock_response.raise_for_status = Mock()
        mock_response.iter_bytes = Mock(return_value=[b"chunk1", b"chunk2"])

        mock_stream = Mock()
        mock_stream.__enter__ = Mock(return_value=mock_response)
        mock_stream.__exit__ = Mock(return_value=False)

        mock_client = Mock()
        mock_client.stream = Mock(return_value=mock_stream)
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        target = Path(self.temp_dir) / "test_file.dat"
        result = stream_with_retry("https://example.com/file", target)

        self.assertEqual(result, target)
        self.assertTrue(target.exists())


class ADSBXDatabaseTests(TestCase):
    """Tests for ADS-B Exchange database operations."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        external_db.DATA_DIR = Path(self.temp_dir)

        # Reset database state
        external_db._adsbx_db.clear()
        external_db._db_metadata["adsbx"]["loaded"] = False
        external_db._db_metadata["adsbx"]["count"] = 0

    def tearDown(self):
        """Clean up after tests."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)
        external_db._adsbx_db.clear()
        external_db._db_metadata["adsbx"]["loaded"] = False

    def test_lookup_adsbx_not_loaded(self):
        """Test lookup when database not loaded."""
        result = lookup_adsbx("ABC123")
        self.assertIsNone(result)

    def test_lookup_adsbx_loaded(self):
        """Test lookup when database is loaded."""
        # Manually populate the database
        external_db._adsbx_db["ABC123"] = {
            "registration": "N12345",
            "type_code": "B738",
            "is_military": False,
            "source": "adsbx",
        }
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_adsbx("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["type_code"], "B738")

    def test_lookup_adsbx_case_insensitive(self):
        """Test lookup is case insensitive."""
        external_db._adsbx_db["ABC123"] = {"registration": "N12345", "source": "adsbx"}
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_adsbx("abc123")
        self.assertIsNotNone(result)

    def test_lookup_adsbx_strips_tilde(self):
        """Test lookup strips tilde prefix."""
        external_db._adsbx_db["ABC123"] = {"registration": "N12345", "source": "adsbx"}
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_adsbx("~ABC123")
        self.assertIsNotNone(result)

    @patch("skyspy.services.external_db.fetch_with_retry")
    def test_download_adsbx_database_success(self, mock_fetch):
        """Test successful ADSBX download."""
        mock_response = Mock()
        mock_response.content = gzip.compress(b'[{"icao": "ABC123", "r": "N12345"}]')
        mock_fetch.return_value = mock_response

        result = download_adsbx_database()

        self.assertIsNotNone(result)
        self.assertTrue(result.exists())

    @patch("skyspy.services.external_db.fetch_with_retry")
    def test_download_adsbx_database_failure(self, mock_fetch):
        """Test ADSBX download failure."""
        mock_fetch.side_effect = Exception("Network error")

        result = download_adsbx_database()

        self.assertIsNone(result)

    def test_load_adsbx_database_file_not_exists(self):
        """Test load when file doesn't exist and auto_download disabled."""
        result = load_adsbx_database(auto_download=False)
        self.assertFalse(result)

    def test_load_adsbx_database_success(self):
        """Test successful ADSBX load from file."""
        # Create test database file
        test_data = [
            {"icao": "ABC123", "r": "N12345", "t": "B738", "mil": False},
            {"icao": "DEF456", "r": "N67890", "t": "A320", "mil": True},
        ]
        db_path = external_db._get_adsbx_path()
        db_path.parent.mkdir(parents=True, exist_ok=True)

        with gzip.open(db_path, "wt", encoding="utf-8") as f:
            json.dump(test_data, f)

        result = load_adsbx_database(auto_download=False)

        self.assertTrue(result)
        self.assertEqual(external_db._db_metadata["adsbx"]["count"], 2)
        self.assertTrue(external_db._db_metadata["adsbx"]["loaded"])


class Tar1090DatabaseTests(TestCase):
    """Tests for tar1090 database operations."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        external_db.DATA_DIR = Path(self.temp_dir)

        # Reset database state
        external_db._tar1090_db.clear()
        external_db._db_metadata["tar1090"]["loaded"] = False
        external_db._db_metadata["tar1090"]["count"] = 0

    def tearDown(self):
        """Clean up after tests."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)
        external_db._tar1090_db.clear()
        external_db._db_metadata["tar1090"]["loaded"] = False

    def test_lookup_tar1090_not_loaded(self):
        """Test lookup when database not loaded."""
        result = lookup_tar1090("ABC123")
        self.assertIsNone(result)

    def test_lookup_tar1090_loaded(self):
        """Test lookup when database is loaded."""
        external_db._tar1090_db["ABC123"] = {
            "registration": "N12345",
            "type_code": "B738",
            "is_military": True,
            "is_interesting": True,
            "source": "tar1090",
        }
        external_db._db_metadata["tar1090"]["loaded"] = True

        result = lookup_tar1090("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")
        self.assertTrue(result["is_military"])

    def test_load_tar1090_database_success(self):
        """Test successful tar1090 load from CSV file."""
        # Create test CSV file (semicolon delimited)
        csv_content = "ABC123;N12345;B738;1\nDEF456;N67890;A320;0"
        db_path = external_db._get_tar1090_path()
        db_path.parent.mkdir(parents=True, exist_ok=True)

        with gzip.open(db_path, "wt", encoding="utf-8") as f:
            f.write(csv_content)

        result = load_tar1090_database(auto_download=False)

        self.assertTrue(result)
        self.assertEqual(external_db._db_metadata["tar1090"]["count"], 2)
        self.assertTrue(external_db._db_metadata["tar1090"]["loaded"])

        # Check military flag parsing (bit 0)
        self.assertTrue(external_db._tar1090_db["ABC123"]["is_military"])
        self.assertFalse(external_db._tar1090_db["DEF456"]["is_military"])


class FAADatabaseTests(TestCase):
    """Tests for FAA Registry database operations."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        external_db.DATA_DIR = Path(self.temp_dir)

        # Reset database state
        external_db._faa_db.clear()
        external_db._db_metadata["faa"]["loaded"] = False
        external_db._db_metadata["faa"]["count"] = 0

    def tearDown(self):
        """Clean up after tests."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)
        external_db._faa_db.clear()
        external_db._db_metadata["faa"]["loaded"] = False

    def test_lookup_faa_not_loaded(self):
        """Test lookup when database not loaded."""
        result = lookup_faa("ABC123")
        self.assertIsNone(result)

    def test_lookup_faa_loaded(self):
        """Test lookup when database is loaded."""
        external_db._faa_db["ABC123"] = {
            "registration": "N12345",
            "serial_number": "12345",
            "year_built": 2015,
            "owner": "Test Owner",
            "city": "Seattle",
            "state": "WA",
            "country": "United States",
            "source": "faa",
        }
        external_db._db_metadata["faa"]["loaded"] = True

        result = lookup_faa("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["city"], "Seattle")
        self.assertEqual(result["country"], "United States")


class OpenSkyDatabaseTests(TestCase):
    """Tests for OpenSky Network database operations."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        external_db.DATA_DIR = Path(self.temp_dir)

        # Reset database state
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False
        external_db._opensky_loading = False
        external_db._db_metadata["opensky"]["loaded"] = False
        external_db._db_metadata["opensky"]["count"] = 0

    def tearDown(self):
        """Clean up after tests."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False
        external_db._db_metadata["opensky"]["loaded"] = False

    def test_lookup_opensky_not_loaded(self):
        """Test lookup when database not loaded."""
        result = lookup_opensky("ABC123")
        self.assertIsNone(result)

    def test_lookup_opensky_loaded(self):
        """Test lookup when database is loaded."""
        external_db._opensky_db["ABC123"] = {
            "registration": "N12345",
            "type_code": "B738",
            "operator": "United Airlines",
            "operator_icao": "UAL",
            "is_military": False,
            "source": "opensky",
        }
        external_db._opensky_loaded = True

        result = lookup_opensky("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["operator"], "United Airlines")

    def test_is_opensky_military_detection(self):
        """Test military detection from OpenSky fields."""
        from skyspy.services.external_db import _is_opensky_military

        # Military operator
        self.assertTrue(_is_opensky_military({"operator": "United States Air Force"}))
        self.assertTrue(_is_opensky_military({"operator": "US Navy"}))
        self.assertTrue(_is_opensky_military({"owner": "USAF"}))
        self.assertTrue(_is_opensky_military({"notes": "military aircraft"}))

        # Civilian
        self.assertFalse(_is_opensky_military({"operator": "United Airlines"}))
        self.assertFalse(_is_opensky_military({"operator": "Delta Air Lines"}))


class RouteCacheTests(TestCase):
    """Tests for route caching functionality."""

    def setUp(self):
        """Set up test fixtures."""
        external_db._route_cache.clear()
        external_db._route_cache_ttl.clear()

    def tearDown(self):
        """Clean up after tests."""
        external_db._route_cache.clear()
        external_db._route_cache_ttl.clear()

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_route_success(self, mock_client_class):
        """Test successful route fetch."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"UAL456": {"origin": "KSFO", "destination": "KJFK", "aircraft_type": "B738"}}
        mock_client = Mock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        result = fetch_route("UAL456")

        self.assertIsNotNone(result)
        self.assertEqual(result["origin"], "KSFO")
        self.assertEqual(result["destination"], "KJFK")

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_route_cached(self, mock_client_class):
        """Test route is returned from cache on second call."""
        import time

        external_db._route_cache["UAL456"] = {"origin": "KSFO", "destination": "KJFK"}
        external_db._route_cache_ttl["UAL456"] = time.time() + 3600  # 1 hour from now

        result = fetch_route("UAL456")

        self.assertIsNotNone(result)
        # Client should not be called because of cache hit
        mock_client_class.assert_not_called()

    def test_fetch_route_empty_callsign(self):
        """Test empty callsign returns None."""
        result = fetch_route("")
        self.assertIsNone(result)

        result = fetch_route("   ")
        self.assertIsNone(result)

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_route_api_error(self, mock_client_class):
        """Test route fetch handles API errors gracefully."""
        mock_client = Mock()
        mock_client.post.side_effect = Exception("API error")
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        result = fetch_route("UAL456")

        self.assertIsNone(result)


class FetchAircraftFromADSBLolTests(TestCase):
    """Tests for adsb.lol API lookup."""

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_aircraft_success(self, mock_client_class):
        """Test successful aircraft fetch from adsb.lol."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ac": [{"hex": "ABC123", "flight": "UAL456", "alt_baro": 35000}]}
        mock_client = Mock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        result = fetch_aircraft_from_adsb_lol("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["hex"], "ABC123")
        self.assertEqual(result["flight"], "UAL456")

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_aircraft_not_found(self, mock_client_class):
        """Test aircraft not found."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ac": []}
        mock_client = Mock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        result = fetch_aircraft_from_adsb_lol("ABC123")

        self.assertIsNone(result)

    @patch("skyspy.services.external_db.httpx.Client")
    def test_fetch_aircraft_api_error(self, mock_client_class):
        """Test API error handling."""
        mock_client = Mock()
        mock_client.get.side_effect = Exception("API error")
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client_class.return_value = mock_client

        result = fetch_aircraft_from_adsb_lol("ABC123")

        self.assertIsNone(result)


class LookupAllTests(TestCase):
    """Tests for aggregated lookup_all function."""

    def setUp(self):
        """Set up test fixtures."""
        # Reset all databases
        external_db._adsbx_db.clear()
        external_db._tar1090_db.clear()
        external_db._faa_db.clear()
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False

        for meta in external_db._db_metadata.values():
            meta["loaded"] = False
            meta["count"] = 0

    def tearDown(self):
        """Clean up after tests."""
        external_db._adsbx_db.clear()
        external_db._tar1090_db.clear()
        external_db._faa_db.clear()
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False

        for meta in external_db._db_metadata.values():
            meta["loaded"] = False
            meta["count"] = 0

    def test_lookup_all_no_databases_loaded(self):
        """Test lookup_all when no databases are loaded."""
        result = lookup_all("ABC123")
        self.assertIsNone(result)

    def test_lookup_all_single_source(self):
        """Test lookup_all with single source."""
        external_db._adsbx_db["ABC123"] = {
            "registration": "N12345",
            "type_code": "B738",
            "source": "adsbx",
        }
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_all("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")
        self.assertIn("adsbx", result["sources"])

    def test_lookup_all_merges_sources(self):
        """Test lookup_all merges data from multiple sources."""
        # FAA has registration and owner
        external_db._faa_db["ABC123"] = {
            "registration": "N12345",
            "owner": "Test Owner",
            "source": "faa",
        }
        external_db._db_metadata["faa"]["loaded"] = True

        # ADSBX has type code
        external_db._adsbx_db["ABC123"] = {
            "type_code": "B738",
            "is_military": False,
            "source": "adsbx",
        }
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_all("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")  # From FAA
        self.assertEqual(result["owner"], "Test Owner")  # From FAA
        self.assertEqual(result["type_code"], "B738")  # From ADSBX
        self.assertIn("faa", result["sources"])
        self.assertIn("adsbx", result["sources"])

    def test_lookup_all_priority_order(self):
        """Test that FAA takes priority over other sources."""
        # FAA has registration
        external_db._faa_db["ABC123"] = {
            "registration": "N12345-FAA",
            "source": "faa",
        }
        external_db._db_metadata["faa"]["loaded"] = True

        # ADSBX also has registration (different)
        external_db._adsbx_db["ABC123"] = {
            "registration": "N12345-ADSBX",
            "source": "adsbx",
        }
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_all("ABC123")

        # FAA should take priority
        self.assertEqual(result["registration"], "N12345-FAA")

    def test_lookup_all_strips_tilde(self):
        """Test lookup_all strips tilde prefix."""
        external_db._adsbx_db["ABC123"] = {"registration": "N12345", "source": "adsbx"}
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_all("~ABC123")

        self.assertIsNotNone(result)


class LookupAllBySourceTests(TestCase):
    """Tests for lookup_all_by_source function."""

    def setUp(self):
        """Set up test fixtures."""
        external_db._adsbx_db.clear()
        external_db._tar1090_db.clear()
        external_db._faa_db.clear()
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False

        for meta in external_db._db_metadata.values():
            meta["loaded"] = False

    def tearDown(self):
        """Clean up after tests."""
        external_db._adsbx_db.clear()
        external_db._tar1090_db.clear()
        external_db._faa_db.clear()
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False

        for meta in external_db._db_metadata.values():
            meta["loaded"] = False

    def test_lookup_all_by_source_returns_separate_records(self):
        """Test that lookup_all_by_source returns separate records per source."""
        external_db._faa_db["ABC123"] = {"registration": "N12345-FAA", "source": "faa"}
        external_db._db_metadata["faa"]["loaded"] = True

        external_db._adsbx_db["ABC123"] = {"registration": "N12345-ADSBX", "source": "adsbx"}
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = lookup_all_by_source("ABC123")

        self.assertIn("faa", result)
        self.assertIn("adsbx", result)
        self.assertEqual(result["faa"]["registration"], "N12345-FAA")
        self.assertEqual(result["adsbx"]["registration"], "N12345-ADSBX")


class DatabaseStatsTests(TestCase):
    """Tests for get_database_stats function."""

    def test_get_database_stats(self):
        """Test get_database_stats returns all database info."""
        result = get_database_stats()

        self.assertIn("adsbx", result)
        self.assertIn("tar1090", result)
        self.assertIn("faa", result)
        self.assertIn("opensky", result)
        self.assertIn("route_cache_size", result)


class IsAnyLoadedTests(TestCase):
    """Tests for is_any_loaded function."""

    def setUp(self):
        """Set up test fixtures."""
        for meta in external_db._db_metadata.values():
            meta["loaded"] = False

    def tearDown(self):
        """Clean up after tests."""
        for meta in external_db._db_metadata.values():
            meta["loaded"] = False

    def test_is_any_loaded_none(self):
        """Test when no database is loaded."""
        result = is_any_loaded()
        self.assertFalse(result)

    def test_is_any_loaded_one(self):
        """Test when one database is loaded."""
        external_db._db_metadata["adsbx"]["loaded"] = True

        result = is_any_loaded()
        self.assertTrue(result)


class InitDatabasesTests(TestCase):
    """Tests for init_databases function."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        external_db.DATA_DIR = Path(self.temp_dir)

    def tearDown(self):
        """Clean up after tests."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @patch("skyspy.services.external_db.load_adsbx_database")
    @patch("skyspy.services.external_db.load_tar1090_database")
    @patch("skyspy.services.external_db.load_faa_database")
    @patch("skyspy.services.external_db.load_opensky_database")
    def test_init_databases_calls_all_loaders(self, mock_opensky, mock_faa, mock_tar1090, mock_adsbx):
        """Test that init_databases calls all database loaders."""
        init_databases(auto_download=False)

        mock_adsbx.assert_called_once_with(auto_download=False)
        mock_tar1090.assert_called_once_with(auto_download=False)
        mock_faa.assert_called_once_with(auto_download=False)
        mock_opensky.assert_called_once_with(auto_download=False)


class UpdateDatabasesIfStaleTests(TestCase):
    """Tests for update_databases_if_stale function."""

    def setUp(self):
        """Set up test fixtures."""
        # Reset metadata
        for meta in external_db._db_metadata.values():
            meta["updated"] = None

    def tearDown(self):
        """Clean up after tests."""
        for meta in external_db._db_metadata.values():
            meta["updated"] = None

    @patch("skyspy.services.external_db.download_adsbx_database")
    @patch("skyspy.services.external_db.load_adsbx_database")
    @patch("skyspy.services.external_db.sync_databases_to_postgres")
    def test_update_stale_database(self, mock_sync, mock_load, mock_download):
        """Test that stale databases are updated."""
        # Set ADSBX as stale (updated 48 hours ago)
        external_db._db_metadata["adsbx"]["updated"] = datetime.utcnow() - timedelta(hours=48)

        update_databases_if_stale()

        mock_download.assert_called_once()
        mock_load.assert_called_once_with(auto_download=False)

    def test_no_update_for_fresh_database(self):
        """Test that fresh databases are not updated."""
        # Set all databases as fresh
        for meta in external_db._db_metadata.values():
            meta["updated"] = datetime.utcnow() - timedelta(hours=1)

        with patch("skyspy.services.external_db.download_adsbx_database") as mock_download:
            update_databases_if_stale()
            mock_download.assert_not_called()


@pytest.mark.django_db
class SyncDatabasesTests(TestCase):
    """Tests for sync_databases_to_postgres function."""

    def setUp(self):
        """Set up test fixtures."""
        external_db._adsbx_db.clear()
        external_db._tar1090_db.clear()
        external_db._faa_db.clear()
        external_db._opensky_db.clear()
        external_db._opensky_loaded = False

        for meta in external_db._db_metadata.values():
            meta["loaded"] = False

    def tearDown(self):
        """Clean up after tests."""
        AircraftInfo.objects.all().delete()
        AirframeSourceData.objects.all().delete()

        external_db._adsbx_db.clear()
        external_db._tar1090_db.clear()
        external_db._faa_db.clear()
        external_db._opensky_db.clear()

        for meta in external_db._db_metadata.values():
            meta["loaded"] = False

    def test_sync_no_databases_loaded(self):
        """Test sync does nothing when no databases loaded."""
        sync_databases_to_postgres()
        # Should not crash and should not create any records
        self.assertEqual(AircraftInfo.objects.count(), 0)

    def test_sync_creates_aircraft_info(self):
        """Test sync creates AircraftInfo records."""
        external_db._adsbx_db["ABC123"] = {
            "registration": "N12345",
            "type_code": "B738",
            "is_military": False,
            "source": "adsbx",
        }
        external_db._db_metadata["adsbx"]["loaded"] = True

        sync_databases_to_postgres()

        self.assertEqual(AircraftInfo.objects.count(), 1)
        info = AircraftInfo.objects.first()
        self.assertEqual(info.icao_hex, "ABC123")
        self.assertEqual(info.registration, "N12345")
        self.assertEqual(info.type_code, "B738")
