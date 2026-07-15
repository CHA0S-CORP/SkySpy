"""
Tests for the avwx service (AVWX weather API integration).

Tests METAR/TAF retrieval, data normalization, station lookup,
flight category calculation, caching, and error handling.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.services import avwx


class GetApiKeyTests(TestCase):
    """Tests for API key retrieval."""

    @override_settings(AVWX_API_KEY="test-api-key")
    def test_get_api_key_returns_key(self):
        """Test that API key is returned from settings."""
        result = avwx._get_api_key()
        self.assertEqual(result, "test-api-key")

    @override_settings()
    def test_get_api_key_returns_none_when_not_set(self):
        """Test that None is returned when key not configured."""
        from django.conf import settings

        if hasattr(settings, "AVWX_API_KEY"):
            delattr(settings, "AVWX_API_KEY")

        result = avwx._get_api_key()
        self.assertIsNone(result)


class IsEnabledTests(TestCase):
    """Tests for enabled check."""

    @override_settings(AVWX_ENABLED=True)
    def test_is_enabled_returns_true(self):
        """Test enabled when setting is True."""
        result = avwx._is_enabled()
        self.assertTrue(result)

    @override_settings(AVWX_ENABLED=False)
    def test_is_enabled_returns_false(self):
        """Test disabled when setting is False."""
        result = avwx._is_enabled()
        self.assertFalse(result)

    def test_is_enabled_default_true(self):
        """Test that AVWX is enabled by default."""
        from django.conf import settings

        if hasattr(settings, "AVWX_ENABLED"):
            delattr(settings, "AVWX_ENABLED")

        # AVWX defaults to enabled
        result = avwx._is_enabled()
        self.assertTrue(result)


class MakeRequestTests(TestCase):
    """Tests for HTTP request handling."""

    @patch("skyspy.services.avwx._is_enabled")
    def test_make_request_returns_none_when_disabled(self, mock_enabled):
        """Test that disabled service returns None."""
        mock_enabled.return_value = False

        result = avwx._make_request("metar/KSEA")

        self.assertIsNone(result)

    @patch("httpx.Client")
    @patch("skyspy.services.avwx._is_enabled")
    def test_make_request_success_without_key(self, mock_enabled, mock_client_class):
        """Test successful request without API key."""
        mock_enabled.return_value = True
        mock_response = MagicMock()
        mock_response.json.return_value = {"station": "KSEA"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = avwx._make_request("metar/KSEA")

        self.assertEqual(result, {"station": "KSEA"})

    @patch("httpx.Client")
    @patch("skyspy.services.avwx._get_api_key")
    @patch("skyspy.services.avwx._is_enabled")
    def test_make_request_with_api_key(self, mock_enabled, mock_get_key, mock_client_class):
        """Test request includes Authorization header when API key is set."""
        mock_enabled.return_value = True
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.json.return_value = {"station": "KSEA"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        avwx._make_request("metar/KSEA")

        # Verify headers include Authorization
        call_args = mock_client.get.call_args
        self.assertIn("headers", call_args.kwargs)
        self.assertEqual(call_args.kwargs["headers"]["Authorization"], "Bearer test-key")

    @patch("httpx.Client")
    @patch("skyspy.services.avwx._is_enabled")
    def test_make_request_rate_limit(self, mock_enabled, mock_client_class):
        """Test rate limit error handling."""
        mock_enabled.return_value = True
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError("Rate limited", request=MagicMock(), response=mock_response)
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = avwx._make_request("metar/KSEA")

        self.assertIsNone(result)

    @patch("httpx.Client")
    @patch("skyspy.services.avwx._is_enabled")
    def test_make_request_auth_error(self, mock_enabled, mock_client_class):
        """Test authentication error handling."""
        mock_enabled.return_value = True
        mock_response = MagicMock()
        mock_response.status_code = 401

        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError("Unauthorized", request=MagicMock(), response=mock_response)
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = avwx._make_request("metar/KSEA")

        self.assertIsNone(result)


class CalculateFlightCategoryTests(TestCase):
    """Tests for flight category calculation."""

    def test_vfr_conditions(self):
        """Test VFR category calculation."""
        result = avwx._calculate_flight_category(5000, 10)
        self.assertEqual(result, "VFR")

    def test_mvfr_low_ceiling(self):
        """Test MVFR with low ceiling."""
        result = avwx._calculate_flight_category(2500, 10)
        self.assertEqual(result, "MVFR")

    def test_mvfr_low_visibility(self):
        """Test MVFR with low visibility."""
        result = avwx._calculate_flight_category(5000, 4)
        self.assertEqual(result, "MVFR")

    def test_ifr_low_ceiling(self):
        """Test IFR with low ceiling."""
        result = avwx._calculate_flight_category(800, 10)
        self.assertEqual(result, "IFR")

    def test_ifr_low_visibility(self):
        """Test IFR with low visibility."""
        result = avwx._calculate_flight_category(5000, 2)
        self.assertEqual(result, "IFR")

    def test_lifr_very_low_ceiling(self):
        """Test LIFR with very low ceiling."""
        result = avwx._calculate_flight_category(400, 10)
        self.assertEqual(result, "LIFR")

    def test_lifr_very_low_visibility(self):
        """Test LIFR with very low visibility."""
        result = avwx._calculate_flight_category(5000, 0.5)
        self.assertEqual(result, "LIFR")

    def test_none_values_default_vfr(self):
        """Test that None values default to VFR."""
        result = avwx._calculate_flight_category(None, None)
        self.assertEqual(result, "VFR")


class NormalizeMetarTests(TestCase):
    """Tests for METAR data normalization."""

    def test_normalize_metar_full(self):
        """Test normalizing full METAR response."""
        metar = {
            "station": "KSEA",
            "raw": "METAR KSEA 011756Z 18006KT 10SM FEW050 SCT100 22/11 A3012",
            "time": {"dt": "2024-01-01T17:56:00Z"},
            "temperature": {"value": 22},
            "dewpoint": {"value": 11},
            "wind_direction": {"value": 180},
            "wind_speed": {"value": 6},
            "wind_gust": {"value": None},
            "visibility": {"value": 9999},
            "clouds": [
                {"type": "FEW", "altitude": 50},
                {"type": "SCT", "altitude": 100},
            ],
            "flight_rules": "VFR",
            "altimeter": {"value": 30.12},
            "wx_codes": [{"repr": "+RA", "value": "Heavy Rain"}],
            "fetched_at": "2024-01-01T18:00:00Z",
        }

        result = avwx._normalize_metar(metar)

        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["temperature_c"], 22)
        self.assertEqual(result["dewpoint_c"], 11)
        self.assertEqual(result["wind_direction"], 180)
        self.assertEqual(result["wind_speed_kt"], 6)
        self.assertEqual(result["visibility_sm"], 10)  # 9999m = 10SM
        self.assertEqual(result["flight_category"], "VFR")
        self.assertEqual(result["altimeter_hg"], 30.12)
        self.assertEqual(result["source"], "avwx")

    def test_normalize_metar_ceiling_calculation(self):
        """Test ceiling calculation from cloud layers."""
        metar = {
            "station": "KSEA",
            "clouds": [
                {"type": "FEW", "altitude": 20},  # 2000 ft
                {"type": "BKN", "altitude": 35},  # 3500 ft
                {"type": "OVC", "altitude": 50},  # 5000 ft
            ],
        }

        result = avwx._normalize_metar(metar)

        # Ceiling should be lowest BKN/OVC layer (3500 ft)
        self.assertEqual(result["ceiling_ft"], 3500)

    def test_normalize_metar_no_ceiling(self):
        """Test when no ceiling exists."""
        metar = {
            "station": "KSEA",
            "clouds": [
                {"type": "FEW", "altitude": 50},
                {"type": "SCT", "altitude": 100},
            ],
        }

        result = avwx._normalize_metar(metar)

        self.assertIsNone(result["ceiling_ft"])

    def test_normalize_metar_visibility_conversion(self):
        """Test visibility conversion from meters to statute miles."""
        metar = {
            "station": "KSEA",
            "visibility": {"value": 8000},  # meters
        }

        result = avwx._normalize_metar(metar)

        # 8000m ~= 5 SM
        self.assertAlmostEqual(result["visibility_sm"], 5.0, delta=0.5)

    def test_normalize_metar_visibility_unlimited(self):
        """Test unlimited visibility handling."""
        metar = {
            "station": "KSEA",
            "visibility": {"value": 9999},
        }

        result = avwx._normalize_metar(metar)

        self.assertEqual(result["visibility_sm"], 10)

    def test_normalize_metar_flight_category_calculated(self):
        """Test flight category calculation when not provided."""
        metar = {
            "station": "KSEA",
            "clouds": [{"type": "OVC", "altitude": 8}],  # 800 ft ceiling
            "visibility": {"value": 3000},  # ~2 SM
        }

        result = avwx._normalize_metar(metar)

        self.assertEqual(result["flight_category"], "IFR")

    def test_normalize_metar_humidity_calculation(self):
        """Test humidity calculation from temp and dewpoint."""
        metar = {
            "station": "KSEA",
            "temperature": {"value": 20},
            "dewpoint": {"value": 15},
        }

        result = avwx._normalize_metar(metar)

        # Humidity should be calculated (~72%)
        self.assertIsNotNone(result.get("humidity_percent"))
        self.assertGreater(result["humidity_percent"], 50)
        self.assertLess(result["humidity_percent"], 100)

    def test_normalize_metar_weather_conditions(self):
        """Test weather condition parsing."""
        metar = {
            "station": "KSEA",
            "wx_codes": [
                {"repr": "+RA", "value": "Heavy Rain"},
                {"repr": "BR", "value": "Mist"},
            ],
        }

        result = avwx._normalize_metar(metar)

        self.assertIn("conditions", result)
        self.assertEqual(len(result["conditions"]), 2)
        self.assertIn("Heavy Rain", result["weather"])

    def test_normalize_metar_minimal(self):
        """Test normalizing minimal METAR data."""
        metar = {"station": "KSEA"}

        result = avwx._normalize_metar(metar)

        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["source"], "avwx")


class GetMetarTests(TestCase):
    """Tests for METAR retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_get_metar_cached(self):
        """Test returns cached data."""
        cached_data = {"icao": "KSEA", "raw_text": "METAR KSEA..."}
        cache.set("avwx_metar_KSEA", cached_data)

        result = avwx.get_metar("ksea")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.avwx._make_request")
    def test_get_metar_api_call(self, mock_request):
        """Test API call when not cached."""
        mock_request.return_value = {
            "station": "KSEA",
            "raw": "METAR KSEA 011756Z...",
        }

        result = avwx.get_metar("KSEA")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao"], "KSEA")
        mock_request.assert_called_with("metar/KSEA")

    @patch("skyspy.services.avwx._make_request")
    def test_get_metar_not_found(self, mock_request):
        """Test returns None when not found."""
        mock_request.return_value = None

        result = avwx.get_metar("XXXX")

        self.assertIsNone(result)

    @patch("skyspy.services.avwx._make_request")
    def test_get_metar_caches_result(self, mock_request):
        """Test that result is cached."""
        mock_request.return_value = {"station": "KJFK"}

        avwx.get_metar("KJFK")

        # Second call should use cache
        avwx.get_metar("KJFK")

        # Should only call API once
        self.assertEqual(mock_request.call_count, 1)


class GetTafTests(TestCase):
    """Tests for TAF retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_get_taf_cached(self):
        """Test returns cached data."""
        cached_data = {"station": "KSEA", "raw": "TAF KSEA..."}
        cache.set("avwx_taf_KSEA", cached_data)

        result = avwx.get_taf("ksea")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.avwx._make_request")
    def test_get_taf_api_call(self, mock_request):
        """Test API call when not cached."""
        mock_request.return_value = {
            "station": "KSEA",
            "raw": "TAF KSEA 011730Z...",
        }

        result = avwx.get_taf("KSEA")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "avwx")
        mock_request.assert_called_with("taf/KSEA")

    @patch("skyspy.services.avwx._make_request")
    def test_get_taf_not_found(self, mock_request):
        """Test returns None when not found."""
        mock_request.return_value = None

        result = avwx.get_taf("XXXX")

        self.assertIsNone(result)


class GetStationTests(TestCase):
    """Tests for station info retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_get_station_cached(self):
        """Test returns cached data."""
        cached_data = {"icao": "KSEA", "name": "Seattle-Tacoma Intl"}
        cache.set("avwx_station_KSEA", cached_data)

        result = avwx.get_station("ksea")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.avwx._make_request")
    def test_get_station_api_call(self, mock_request):
        """Test API call when not cached."""
        mock_request.return_value = {
            "icao": "KSEA",
            "name": "Seattle-Tacoma Intl",
            "latitude": 47.449,
            "longitude": -122.309,
        }

        result = avwx.get_station("KSEA")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "avwx")
        mock_request.assert_called_with("station/KSEA")

    @patch("skyspy.services.avwx._make_request")
    def test_get_station_not_found(self, mock_request):
        """Test returns None when not found."""
        mock_request.return_value = None

        result = avwx.get_station("XXXX")

        self.assertIsNone(result)

    @patch("skyspy.services.avwx._make_request")
    def test_get_station_long_cache(self, mock_request):
        """Test that station data uses longer cache TTL."""
        mock_request.return_value = {"icao": "KORD"}

        avwx.get_station("KORD")

        # Station should be cached with 24 hour TTL
        cached = cache.get("avwx_station_KORD")
        self.assertIsNotNone(cached)


class GetApiStatusTests(TestCase):
    """Tests for API status retrieval."""

    @override_settings(AVWX_ENABLED=True, AVWX_API_KEY="test-key")
    def test_get_api_status_with_key(self):
        """Test API status when key is configured."""
        status = avwx.get_api_status()

        self.assertTrue(status["enabled"])
        self.assertTrue(status["api_key_configured"])
        self.assertEqual(status["cache_ttl_metar"], avwx.METAR_CACHE_TTL)
        self.assertEqual(status["cache_ttl_taf"], avwx.TAF_CACHE_TTL)

    @override_settings(AVWX_ENABLED=True)
    def test_get_api_status_without_key(self):
        """Test API status when key is not configured."""
        from django.conf import settings

        if hasattr(settings, "AVWX_API_KEY"):
            delattr(settings, "AVWX_API_KEY")

        status = avwx.get_api_status()

        self.assertTrue(status["enabled"])
        self.assertFalse(status["api_key_configured"])

    @override_settings(AVWX_ENABLED=False)
    def test_get_api_status_disabled(self):
        """Test API status when disabled."""
        status = avwx.get_api_status()

        self.assertFalse(status["enabled"])


class CacheTtlConstantsTests(TestCase):
    """Tests for cache TTL constants."""

    def test_metar_cache_ttl(self):
        """Test METAR cache TTL is 5 minutes."""
        self.assertEqual(avwx.METAR_CACHE_TTL, 300)

    def test_taf_cache_ttl(self):
        """Test TAF cache TTL is 30 minutes."""
        self.assertEqual(avwx.TAF_CACHE_TTL, 1800)


class EdgeCaseTests(TestCase):
    """Edge case tests for AVWX service."""

    def test_normalize_metar_empty_clouds(self):
        """Test normalizing METAR with empty clouds list."""
        metar = {
            "station": "KSEA",
            "clouds": [],
        }

        result = avwx._normalize_metar(metar)

        self.assertEqual(result["clouds"], [])
        self.assertIsNone(result["ceiling_ft"])

    def test_normalize_metar_null_cloud_altitude(self):
        """Test normalizing METAR with null cloud altitude."""
        metar = {
            "station": "KSEA",
            "clouds": [
                {"type": "BKN", "altitude": None},
            ],
        }

        result = avwx._normalize_metar(metar)

        # Should handle gracefully
        self.assertIsNotNone(result)

    def test_normalize_metar_missing_time(self):
        """Test normalizing METAR without time field."""
        metar = {
            "station": "KSEA",
            "raw": "METAR KSEA...",
        }

        result = avwx._normalize_metar(metar)

        self.assertIsNone(result.get("observed"))

    def test_normalize_metar_null_wind_values(self):
        """Test normalizing METAR with null wind values."""
        metar = {
            "station": "KSEA",
            "wind_direction": {"value": None},
            "wind_speed": {"value": None},
        }

        result = avwx._normalize_metar(metar)

        self.assertIsNone(result.get("wind_direction"))
        self.assertIsNone(result.get("wind_speed_kt"))

    def test_calculate_flight_category_edge_values(self):
        """Test flight category at boundary values."""
        # Exactly 3000 ft / 5 SM is MVFR (FAA: MVFR is inclusive of both boundaries)
        result = avwx._calculate_flight_category(3000, 5)
        self.assertEqual(result, "MVFR")

        # Just above the MVFR boundary
        result = avwx._calculate_flight_category(3001, 6)
        self.assertEqual(result, "VFR")

        # Just below VFR threshold
        result = avwx._calculate_flight_category(2999, 5)
        self.assertEqual(result, "MVFR")
