"""
Tests for the checkwx service (CheckWX weather API integration).

Tests METAR/TAF retrieval, station lookup, flight category
calculation, caching, and error handling.
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.services import checkwx


class GetApiKeyTests(TestCase):
    """Tests for API key retrieval."""

    @override_settings(CHECKWX_API_KEY="test-api-key")
    def test_get_api_key_returns_key(self):
        """Test that API key is returned from settings."""
        result = checkwx._get_api_key()
        self.assertEqual(result, "test-api-key")

    @override_settings()
    def test_get_api_key_returns_none_when_not_set(self):
        """Test that None is returned when key not configured."""
        from django.conf import settings

        if hasattr(settings, "CHECKWX_API_KEY"):
            delattr(settings, "CHECKWX_API_KEY")

        result = checkwx._get_api_key()
        self.assertIsNone(result)


class IsEnabledTests(TestCase):
    """Tests for enabled check."""

    @override_settings(CHECKWX_ENABLED=True, CHECKWX_API_KEY="test-key")
    def test_is_enabled_returns_true(self):
        """Test enabled when both settings are set."""
        result = checkwx._is_enabled()
        self.assertTrue(result)

    @override_settings(CHECKWX_ENABLED=False, CHECKWX_API_KEY="test-key")
    def test_is_enabled_returns_false_when_disabled(self):
        """Test disabled when CHECKWX_ENABLED is False."""
        result = checkwx._is_enabled()
        self.assertFalse(result)

    @override_settings(CHECKWX_ENABLED=True)
    def test_is_enabled_returns_false_without_key(self):
        """Test disabled when API key is not set."""
        from django.conf import settings

        if hasattr(settings, "CHECKWX_API_KEY"):
            delattr(settings, "CHECKWX_API_KEY")

        result = checkwx._is_enabled()
        self.assertFalse(result)


class MakeRequestTests(TestCase):
    """Tests for HTTP request handling."""

    @patch("skyspy.services.checkwx._get_api_key")
    def test_make_request_returns_none_without_key(self, mock_get_key):
        """Test that missing API key returns None."""
        mock_get_key.return_value = None

        result = checkwx._make_request("metar/KSEA")

        self.assertIsNone(result)

    @patch("httpx.Client")
    @patch("skyspy.services.checkwx._get_api_key")
    def test_make_request_success(self, mock_get_key, mock_client_class):
        """Test successful API request."""
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.json.return_value = {"results": 1, "data": [{"icao": "KSEA"}]}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = checkwx._make_request("metar/KSEA")

        self.assertEqual(result, {"results": 1, "data": [{"icao": "KSEA"}]})

    @patch("httpx.Client")
    @patch("skyspy.services.checkwx._get_api_key")
    def test_make_request_rate_limit(self, mock_get_key, mock_client_class):
        """Test rate limit error handling."""
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError(
            "Rate limited", request=MagicMock(), response=mock_response
        )
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = checkwx._make_request("metar/KSEA")

        self.assertIsNone(result)


class CalculateFlightCategoryTests(TestCase):
    """Tests for flight category calculation."""

    def test_vfr_conditions(self):
        """Test VFR category calculation."""
        result = checkwx.calculate_flight_category(5000, 10)
        self.assertEqual(result, "VFR")

    def test_mvfr_low_ceiling(self):
        """Test MVFR with low ceiling."""
        result = checkwx.calculate_flight_category(2500, 10)
        self.assertEqual(result, "MVFR")

    def test_mvfr_low_visibility(self):
        """Test MVFR with low visibility."""
        result = checkwx.calculate_flight_category(5000, 4)
        self.assertEqual(result, "MVFR")

    def test_ifr_low_ceiling(self):
        """Test IFR with low ceiling."""
        result = checkwx.calculate_flight_category(800, 10)
        self.assertEqual(result, "IFR")

    def test_ifr_low_visibility(self):
        """Test IFR with low visibility."""
        result = checkwx.calculate_flight_category(5000, 2)
        self.assertEqual(result, "IFR")

    def test_lifr_very_low_ceiling(self):
        """Test LIFR with very low ceiling."""
        result = checkwx.calculate_flight_category(400, 10)
        self.assertEqual(result, "LIFR")

    def test_lifr_very_low_visibility(self):
        """Test LIFR with very low visibility."""
        result = checkwx.calculate_flight_category(5000, 0.5)
        self.assertEqual(result, "LIFR")

    def test_none_values_default_vfr(self):
        """Test that None values default to VFR."""
        result = checkwx.calculate_flight_category(None, None)
        self.assertEqual(result, "VFR")

    def test_ceiling_only(self):
        """Test with only ceiling provided."""
        result = checkwx.calculate_flight_category(800, None)
        self.assertEqual(result, "IFR")

    def test_visibility_only(self):
        """Test with only visibility provided."""
        result = checkwx.calculate_flight_category(None, 2)
        self.assertEqual(result, "IFR")


class GetMetarTests(TestCase):
    """Tests for METAR retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = checkwx.get_metar("KSEA")

        self.assertIsNone(result)

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"icao": "KSEA", "raw_text": "METAR KSEA..."}
        cache.set("checkwx_metar_KSEA", cached_data)

        result = checkwx.get_metar("ksea")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.checkwx._make_request")
    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_decoded(self, mock_enabled, mock_request):
        """Test getting decoded METAR."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "results": 1,
            "data": [
                {
                    "icao": "KSEA",
                    "raw_text": "METAR KSEA 011756Z 18006KT 10SM FEW050 SCT100 22/11 A3012",
                }
            ],
        }

        result = checkwx.get_metar("KSEA", decoded=True)

        self.assertIsNotNone(result)
        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["source"], "checkwx")
        mock_request.assert_called_with("metar/KSEA/decoded")

    @patch("skyspy.services.checkwx._make_request")
    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_raw(self, mock_enabled, mock_request):
        """Test getting raw METAR."""
        mock_enabled.return_value = True
        mock_request.return_value = {"results": 1, "data": [{"icao": "KSEA"}]}

        checkwx.get_metar("KSEA", decoded=False)

        mock_request.assert_called_with("metar/KSEA")


class GetMetarBulkTests(TestCase):
    """Tests for bulk METAR retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_bulk_disabled(self, mock_enabled):
        """Test returns empty dict when disabled."""
        mock_enabled.return_value = False

        result = checkwx.get_metar_bulk(["KSEA", "KPDX"])

        self.assertEqual(result, {})

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_bulk_partial_cache(self, mock_enabled):
        """Test returns cached data for cached stations."""
        mock_enabled.return_value = True
        cache.set("checkwx_metar_KSEA", {"icao": "KSEA"})

        with patch("skyspy.services.checkwx._make_request") as mock_request:
            mock_request.return_value = {"results": 1, "data": [{"icao": "KPDX"}]}

            result = checkwx.get_metar_bulk(["KSEA", "KPDX"])

            self.assertIn("KSEA", result)
            self.assertIn("KPDX", result)

    @patch("skyspy.services.checkwx._make_request")
    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_metar_bulk_batch_request(self, mock_enabled, mock_request):
        """Test bulk request batches stations."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "results": 2,
            "data": [{"icao": "KSEA"}, {"icao": "KPDX"}],
        }

        result = checkwx.get_metar_bulk(["KSEA", "KPDX"])

        self.assertEqual(len(result), 2)


class GetTafTests(TestCase):
    """Tests for TAF retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_taf_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = checkwx.get_taf("KSEA")

        self.assertIsNone(result)

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_taf_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"icao": "KSEA", "raw_text": "TAF KSEA..."}
        cache.set("checkwx_taf_KSEA", cached_data)

        result = checkwx.get_taf("ksea")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.checkwx._make_request")
    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_taf_success(self, mock_enabled, mock_request):
        """Test successful TAF retrieval."""
        mock_enabled.return_value = True
        mock_request.return_value = {"results": 1, "data": [{"icao": "KSEA"}]}

        result = checkwx.get_taf("KSEA")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "checkwx")


class GetStationTests(TestCase):
    """Tests for station info retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_station_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = checkwx.get_station("KSEA")

        self.assertIsNone(result)

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_station_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"icao": "KSEA", "name": "Seattle-Tacoma International"}
        cache.set("checkwx_station_KSEA", cached_data)

        result = checkwx.get_station("ksea")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.checkwx._make_request")
    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_station_success(self, mock_enabled, mock_request):
        """Test successful station lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "results": 1,
            "data": [
                {
                    "icao": "KSEA",
                    "name": "Seattle-Tacoma International",
                    "latitude": {"decimal": 47.449},
                    "longitude": {"decimal": -122.309},
                }
            ],
        }

        result = checkwx.get_station("KSEA")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "checkwx")


class ParseDecodedMetarTests(TestCase):
    """Tests for decoded METAR parsing."""

    def test_parse_decoded_metar_full(self):
        """Test parsing fully decoded METAR."""
        metar = {
            "icao": "KSEA",
            "observed": "2024-01-01T17:56:00Z",
            "raw_text": "METAR KSEA 011756Z 18006KT 10SM FEW050 SCT100 22/11 A3012",
            "temperature": {"celsius": 22, "fahrenheit": 72},
            "dewpoint": {"celsius": 11, "fahrenheit": 52},
            "wind": {"degrees": 180, "speed_kts": 6, "gust_kts": None},
            "visibility": {"miles": 10, "meters": 16093},
            "clouds": [
                {"code": "FEW", "base_feet_agl": 5000},
                {"code": "SCT", "base_feet_agl": 10000},
            ],
            "flight_category": "VFR",
            "barometer": {"hg": 30.12, "mb": 1020},
            "humidity": {"percent": 50},
            "conditions": [{"code": "CLR", "text": "Clear"}],
        }

        result = checkwx.parse_decoded_metar(metar)

        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["temperature_c"], 22)
        self.assertEqual(result["temperature_f"], 72)
        self.assertEqual(result["dewpoint_c"], 11)
        self.assertEqual(result["wind_direction"], 180)
        self.assertEqual(result["wind_speed_kt"], 6)
        self.assertEqual(result["visibility_sm"], 10)
        self.assertEqual(result["flight_category"], "VFR")
        self.assertEqual(result["altimeter_hg"], 30.12)
        self.assertEqual(result["source"], "checkwx")

    def test_parse_decoded_metar_ceiling_calculation(self):
        """Test ceiling calculation from cloud layers."""
        metar = {
            "icao": "KSEA",
            "clouds": [
                {"code": "FEW", "base_feet_agl": 2000},
                {"code": "BKN", "base_feet_agl": 3500},
                {"code": "OVC", "base_feet_agl": 5000},
            ],
        }

        result = checkwx.parse_decoded_metar(metar)

        # Ceiling should be lowest BKN/OVC layer
        self.assertEqual(result["ceiling_ft"], 3500)

    def test_parse_decoded_metar_no_ceiling(self):
        """Test when no ceiling exists."""
        metar = {
            "icao": "KSEA",
            "clouds": [
                {"code": "FEW", "base_feet_agl": 5000},
                {"code": "SCT", "base_feet_agl": 10000},
            ],
        }

        result = checkwx.parse_decoded_metar(metar)

        self.assertIsNone(result["ceiling_ft"])

    def test_parse_decoded_metar_flight_category_calculated(self):
        """Test flight category calculation when not provided."""
        metar = {
            "icao": "KSEA",
            "clouds": [{"code": "OVC", "base_feet_agl": 800}],
            "visibility": {"miles": 2},
        }

        result = checkwx.parse_decoded_metar(metar)

        self.assertEqual(result["flight_category"], "IFR")

    def test_parse_decoded_metar_visibility_as_number(self):
        """Test parsing visibility when given as number."""
        metar = {
            "icao": "KSEA",
            "visibility": 10,
        }

        result = checkwx.parse_decoded_metar(metar)

        self.assertEqual(result["visibility_sm"], 10)

    def test_parse_decoded_metar_minimal(self):
        """Test parsing minimal METAR data."""
        metar = {"icao": "KSEA"}

        result = checkwx.parse_decoded_metar(metar)

        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["source"], "checkwx")


class GetWeatherForAircraftTests(TestCase):
    """Tests for aircraft weather lookup."""

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_weather_for_aircraft_disabled(self, mock_enabled):
        """Test returns basic structure when disabled."""
        mock_enabled.return_value = False

        result = checkwx.get_weather_for_aircraft(47.5, -122.0)

        self.assertEqual(result["source"], "checkwx")
        self.assertFalse(result["enabled"])

    @patch("skyspy.services.checkwx._is_enabled")
    def test_get_weather_for_aircraft_enabled(self, mock_enabled):
        """Test returns basic structure when enabled."""
        mock_enabled.return_value = True

        result = checkwx.get_weather_for_aircraft(47.5, -122.0)

        self.assertEqual(result["source"], "checkwx")


class GetApiStatusTests(TestCase):
    """Tests for API status retrieval."""

    @override_settings(CHECKWX_ENABLED=True, CHECKWX_API_KEY="test-key")
    def test_get_api_status_enabled(self):
        """Test API status when enabled."""
        status = checkwx.get_api_status()

        self.assertTrue(status["enabled"])
        self.assertTrue(status["api_key_configured"])
        self.assertEqual(status["cache_ttl_metar"], checkwx.METAR_CACHE_TTL)
        self.assertEqual(status["cache_ttl_taf"], checkwx.TAF_CACHE_TTL)
        self.assertEqual(status["daily_limit"], 3000)

    @override_settings(CHECKWX_ENABLED=False)
    def test_get_api_status_disabled(self):
        """Test API status when disabled."""
        from django.conf import settings

        if hasattr(settings, "CHECKWX_API_KEY"):
            delattr(settings, "CHECKWX_API_KEY")

        status = checkwx.get_api_status()

        self.assertFalse(status["enabled"])


class FlightCategoriesConstantsTests(TestCase):
    """Tests for flight category constants."""

    def test_flight_categories_defined(self):
        """Test that flight categories are properly defined."""
        self.assertIn("VFR", checkwx.FLIGHT_CATEGORIES)
        self.assertIn("MVFR", checkwx.FLIGHT_CATEGORIES)
        self.assertIn("IFR", checkwx.FLIGHT_CATEGORIES)
        self.assertIn("LIFR", checkwx.FLIGHT_CATEGORIES)

    def test_vfr_thresholds(self):
        """Test VFR thresholds."""
        vfr = checkwx.FLIGHT_CATEGORIES["VFR"]
        self.assertEqual(vfr["ceiling"], 3000)
        self.assertEqual(vfr["visibility"], 5)

    def test_mvfr_thresholds(self):
        """Test MVFR thresholds."""
        mvfr = checkwx.FLIGHT_CATEGORIES["MVFR"]
        self.assertEqual(mvfr["ceiling"], 1000)
        self.assertEqual(mvfr["visibility"], 3)
