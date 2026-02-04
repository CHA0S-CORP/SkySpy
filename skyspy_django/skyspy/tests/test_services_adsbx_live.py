"""
Tests for the adsbx_live service (ADS-B Exchange API integration).

Tests API requests, data parsing, caching, and error handling.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.services import adsbx_live


class GetApiKeyTests(TestCase):
    """Tests for API key retrieval."""

    @override_settings(ADSBX_RAPIDAPI_KEY="test-api-key")
    def test_get_api_key_returns_key(self):
        """Test that API key is returned from settings."""
        result = adsbx_live._get_api_key()
        self.assertEqual(result, "test-api-key")

    @override_settings()
    def test_get_api_key_returns_none_when_not_set(self):
        """Test that None is returned when key not configured."""
        # Remove the setting if it exists
        from django.conf import settings

        if hasattr(settings, "ADSBX_RAPIDAPI_KEY"):
            delattr(settings, "ADSBX_RAPIDAPI_KEY")

        result = adsbx_live._get_api_key()
        self.assertIsNone(result)


class IsEnabledTests(TestCase):
    """Tests for enabled check."""

    @override_settings(ADSBX_LIVE_ENABLED=True, ADSBX_RAPIDAPI_KEY="test-key")
    def test_is_enabled_returns_true(self):
        """Test enabled when both settings are set."""
        result = adsbx_live._is_enabled()
        self.assertTrue(result)

    @override_settings(ADSBX_LIVE_ENABLED=False, ADSBX_RAPIDAPI_KEY="test-key")
    def test_is_enabled_returns_false_when_disabled(self):
        """Test disabled when ADSBX_LIVE_ENABLED is False."""
        result = adsbx_live._is_enabled()
        self.assertFalse(result)

    @override_settings(ADSBX_LIVE_ENABLED=True)
    def test_is_enabled_returns_false_without_key(self):
        """Test disabled when API key is not set."""
        from django.conf import settings

        if hasattr(settings, "ADSBX_RAPIDAPI_KEY"):
            delattr(settings, "ADSBX_RAPIDAPI_KEY")

        result = adsbx_live._is_enabled()
        self.assertFalse(result)


class MakeRequestTests(TestCase):
    """Tests for HTTP request handling."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @override_settings(ADSBX_LIVE_ENABLED=False)
    def test_make_request_returns_none_when_disabled(self):
        """Test that disabled service returns None."""
        result = adsbx_live._make_request("v2/icao/ABC123/")
        self.assertIsNone(result)

    @patch("skyspy.services.adsbx_live._get_api_key")
    def test_make_request_returns_none_without_key(self, mock_get_key):
        """Test that missing API key returns None."""
        mock_get_key.return_value = None

        result = adsbx_live._make_request("v2/icao/ABC123/")

        self.assertIsNone(result)

    @patch("skyspy.services.adsbx_live._http_get_adsbx")
    @patch("skyspy.services.adsbx_live._get_api_key")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_make_request_success(self, mock_enabled, mock_get_key, mock_http_get):
        """Test successful API request."""
        mock_enabled.return_value = True
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.json.return_value = {"ac": [{"hex": "ABC123"}]}
        mock_http_get.return_value = mock_response

        result = adsbx_live._make_request("v2/icao/ABC123/")

        self.assertEqual(result, {"ac": [{"hex": "ABC123"}]})

    @patch("skyspy.services.adsbx_live._http_get_adsbx")
    @patch("skyspy.services.adsbx_live._get_api_key")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_make_request_rate_limit_error(self, mock_enabled, mock_get_key, mock_http_get):
        """Test rate limit error handling."""
        mock_enabled.return_value = True
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_http_get.side_effect = httpx.HTTPStatusError(
            "Rate limited", request=MagicMock(), response=mock_response
        )

        result = adsbx_live._make_request("v2/icao/ABC123/")

        self.assertIsNone(result)

    @patch("skyspy.services.adsbx_live._http_get_adsbx")
    @patch("skyspy.services.adsbx_live._get_api_key")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_make_request_auth_error(self, mock_enabled, mock_get_key, mock_http_get):
        """Test authentication error handling."""
        mock_enabled.return_value = True
        mock_get_key.return_value = "invalid-key"
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_http_get.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_response
        )

        result = adsbx_live._make_request("v2/icao/ABC123/")

        self.assertIsNone(result)


class ParseAircraftTests(TestCase):
    """Tests for aircraft data parsing."""

    def test_parse_aircraft_valid(self):
        """Test parsing valid aircraft data."""
        ac_data = {
            "hex": "abc123",
            "flight": "UAL456  ",
            "r": "N12345",
            "t": "B738",
            "lat": 47.5,
            "lon": -122.0,
            "alt_baro": 35000,
            "alt_geom": 35200,
            "gs": 450,
            "track": 270,
            "baro_rate": -500,
            "squawk": "4521",
            "emergency": None,
            "category": "A3",
            "seen": 1,
            "seen_pos": 2,
            "rssi": -25.0,
            "mil": False,
            "ladd": False,
            "pia": False,
        }

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "ABC123")
        self.assertEqual(result["callsign"], "UAL456")
        self.assertEqual(result["registration"], "N12345")
        self.assertEqual(result["aircraft_type"], "B738")
        self.assertEqual(result["latitude"], 47.5)
        self.assertEqual(result["longitude"], -122.0)
        self.assertEqual(result["altitude_baro_ft"], 35000)
        self.assertEqual(result["ground_speed_kt"], 450)
        self.assertEqual(result["source"], "adsbexchange")

    def test_parse_aircraft_missing_hex(self):
        """Test that missing hex returns None."""
        ac_data = {"flight": "UAL456", "lat": 47.5, "lon": -122.0}

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertIsNone(result)

    def test_parse_aircraft_ground(self):
        """Test parsing aircraft on ground."""
        ac_data = {"hex": "ABC123", "alt_baro": "ground"}

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertIsNotNone(result)
        self.assertTrue(result["on_ground"])

    def test_parse_aircraft_with_icao_field(self):
        """Test parsing with 'icao' instead of 'hex' field."""
        ac_data = {"icao": "DEF456", "flight": "DAL789"}

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "DEF456")

    def test_parse_aircraft_military_flag(self):
        """Test parsing military aircraft flag."""
        ac_data = {"hex": "ABC123", "mil": True}

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertTrue(result["is_military"])

    def test_parse_aircraft_ladd_flag(self):
        """Test parsing LADD aircraft flag."""
        ac_data = {"hex": "ABC123", "ladd": True}

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertTrue(result["is_ladd"])

    def test_parse_aircraft_pia_flag(self):
        """Test parsing PIA aircraft flag."""
        ac_data = {"hex": "ABC123", "pia": True}

        result = adsbx_live._parse_aircraft(ac_data)

        self.assertTrue(result["is_pia"])


class GetAircraftByIcaoTests(TestCase):
    """Tests for getting aircraft by ICAO hex."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_icao_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_aircraft_by_icao("ABC123")

        self.assertIsNone(result)

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_icao_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"icao_hex": "ABC123", "callsign": "UAL456"}
        cache.set("adsbx_aircraft_ABC123", cached_data)

        result = adsbx_live.get_aircraft_by_icao("abc123")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_icao_api_call(self, mock_enabled, mock_request):
        """Test API call when not cached."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [{"hex": "ABC123", "flight": "UAL456", "lat": 47.5, "lon": -122.0}]
        }

        result = adsbx_live.get_aircraft_by_icao("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "ABC123")

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_icao_not_found(self, mock_enabled, mock_request):
        """Test returns None when aircraft not found."""
        mock_enabled.return_value = True
        mock_request.return_value = {"ac": []}

        result = adsbx_live.get_aircraft_by_icao("NOTFOUND")

        self.assertIsNone(result)


class GetAircraftByCallsignTests(TestCase):
    """Tests for getting aircraft by callsign."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_callsign_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_aircraft_by_callsign("UAL456")

        self.assertEqual(result, [])

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_callsign_success(self, mock_enabled, mock_request):
        """Test successful callsign lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [
                {"hex": "ABC123", "flight": "UAL456", "lat": 47.5, "lon": -122.0},
                {"hex": "DEF789", "flight": "UAL456", "lat": 48.0, "lon": -121.0},
            ]
        }

        result = adsbx_live.get_aircraft_by_callsign("ual456")

        self.assertEqual(len(result), 2)


class GetAircraftByRegistrationTests(TestCase):
    """Tests for getting aircraft by registration."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_registration_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_aircraft_by_registration("N12345")

        self.assertIsNone(result)

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_registration_success(self, mock_enabled, mock_request):
        """Test successful registration lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [{"hex": "ABC123", "r": "N12345", "lat": 47.5, "lon": -122.0}]
        }

        result = adsbx_live.get_aircraft_by_registration("n12345")

        self.assertIsNotNone(result)
        self.assertEqual(result["registration"], "N12345")


class GetAircraftBySquawkTests(TestCase):
    """Tests for getting aircraft by squawk code."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_squawk_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_aircraft_by_squawk("7700")

        self.assertEqual(result, [])

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_squawk_emergency(self, mock_enabled, mock_request):
        """Test finding aircraft with emergency squawk."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [{"hex": "ABC123", "squawk": "7700", "lat": 47.5, "lon": -122.0}]
        }

        result = adsbx_live.get_aircraft_by_squawk("7700")

        self.assertEqual(len(result), 1)


class GetAircraftByTypeTests(TestCase):
    """Tests for getting aircraft by type code."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_type_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_aircraft_by_type("B738")

        self.assertEqual(result, [])

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_by_type_success(self, mock_enabled, mock_request):
        """Test finding aircraft by type."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [
                {"hex": "ABC123", "t": "B738", "lat": 47.5, "lon": -122.0},
                {"hex": "DEF456", "t": "B738", "lat": 48.0, "lon": -121.0},
            ]
        }

        result = adsbx_live.get_aircraft_by_type("b738")

        self.assertEqual(len(result), 2)


class GetAircraftInAreaTests(TestCase):
    """Tests for getting aircraft in an area."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_in_area_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_aircraft_in_area(47.5, -122.0, radius_nm=50)

        self.assertEqual(result, [])

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_aircraft_in_area_success(self, mock_enabled, mock_request):
        """Test finding aircraft in area."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [
                {"hex": "ABC123", "lat": 47.5, "lon": -122.0},
                {"hex": "DEF456", "lat": 47.6, "lon": -121.9},
            ]
        }

        result = adsbx_live.get_aircraft_in_area(47.5, -122.0, radius_nm=50)

        self.assertEqual(len(result), 2)


class GetMilitaryAircraftTests(TestCase):
    """Tests for getting military aircraft."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_military_aircraft_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = adsbx_live.get_military_aircraft()

        self.assertEqual(result, [])

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_military_aircraft_success(self, mock_enabled, mock_request):
        """Test finding military aircraft."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [{"hex": "AE1234", "flight": "RCH789", "mil": True, "lat": 47.5, "lon": -122.0}]
        }

        result = adsbx_live.get_military_aircraft()

        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["is_military"])


class GetLaddAircraftTests(TestCase):
    """Tests for getting LADD aircraft."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_ladd_aircraft_success(self, mock_enabled, mock_request):
        """Test finding LADD aircraft."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [{"hex": "ABC123", "ladd": True, "lat": 47.5, "lon": -122.0}]
        }

        result = adsbx_live.get_ladd_aircraft()

        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["is_ladd"])


class GetPiaAircraftTests(TestCase):
    """Tests for getting PIA aircraft."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.adsbx_live._make_request")
    @patch("skyspy.services.adsbx_live._is_enabled")
    def test_get_pia_aircraft_success(self, mock_enabled, mock_request):
        """Test finding PIA aircraft."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "ac": [{"hex": "ABC123", "pia": True, "lat": 47.5, "lon": -122.0}]
        }

        result = adsbx_live.get_pia_aircraft()

        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["is_pia"])


class TrackAircraftGloballyTests(TestCase):
    """Tests for global aircraft tracking."""

    @patch("skyspy.services.adsbx_live.get_aircraft_by_icao")
    def test_track_aircraft_globally_calls_get_by_icao(self, mock_get):
        """Test that track_aircraft_globally delegates to get_aircraft_by_icao."""
        mock_get.return_value = {"icao_hex": "ABC123"}

        result = adsbx_live.track_aircraft_globally("ABC123")

        mock_get.assert_called_once_with("ABC123")
        self.assertEqual(result, {"icao_hex": "ABC123"})


class GetApiStatusTests(TestCase):
    """Tests for API status retrieval."""

    @override_settings(ADSBX_LIVE_ENABLED=True, ADSBX_RAPIDAPI_KEY="test-key")
    def test_get_api_status_enabled(self):
        """Test API status when enabled."""
        status = adsbx_live.get_api_status()

        self.assertTrue(status["enabled"])
        self.assertTrue(status["api_key_configured"])
        self.assertEqual(status["cache_ttl"], adsbx_live.AIRCRAFT_CACHE_TTL)
        self.assertIn("unfiltered_data", status["features"])

    @override_settings(ADSBX_LIVE_ENABLED=False)
    def test_get_api_status_disabled(self):
        """Test API status when disabled."""
        from django.conf import settings

        if hasattr(settings, "ADSBX_RAPIDAPI_KEY"):
            delattr(settings, "ADSBX_RAPIDAPI_KEY")

        status = adsbx_live.get_api_status()

        self.assertFalse(status["enabled"])
