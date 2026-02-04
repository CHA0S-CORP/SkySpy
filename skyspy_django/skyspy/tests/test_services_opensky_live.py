"""
Tests for the opensky_live service (OpenSky Network API integration).

Tests API requests, state vector parsing, caching, rate limiting,
and error handling.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.services import opensky_live


class GetCredentialsTests(TestCase):
    """Tests for credential retrieval."""

    @override_settings(OPENSKY_USERNAME="testuser", OPENSKY_PASSWORD="testpass")
    def test_get_credentials_returns_tuple(self):
        """Test that credentials are returned from settings."""
        username, password = opensky_live._get_credentials()
        self.assertEqual(username, "testuser")
        self.assertEqual(password, "testpass")

    @override_settings()
    def test_get_credentials_returns_none_when_not_set(self):
        """Test that None is returned when credentials not configured."""
        from django.conf import settings

        if hasattr(settings, "OPENSKY_USERNAME"):
            delattr(settings, "OPENSKY_USERNAME")
        if hasattr(settings, "OPENSKY_PASSWORD"):
            delattr(settings, "OPENSKY_PASSWORD")

        username, password = opensky_live._get_credentials()
        self.assertIsNone(username)
        self.assertIsNone(password)


class IsEnabledTests(TestCase):
    """Tests for enabled check."""

    @override_settings(OPENSKY_LIVE_ENABLED=True)
    def test_is_enabled_returns_true(self):
        """Test enabled when setting is True."""
        result = opensky_live._is_enabled()
        self.assertTrue(result)

    @override_settings(OPENSKY_LIVE_ENABLED=False)
    def test_is_enabled_returns_false(self):
        """Test disabled when setting is False."""
        result = opensky_live._is_enabled()
        self.assertFalse(result)


class MakeRequestTests(TestCase):
    """Tests for HTTP request handling."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @override_settings(OPENSKY_LIVE_ENABLED=False)
    def test_make_request_returns_none_when_disabled(self):
        """Test that disabled service returns None."""
        result = opensky_live._make_request("states/all")
        self.assertIsNone(result)

    @override_settings(OPENSKY_LIVE_ENABLED=True)
    def test_make_request_rate_limited(self):
        """Test rate limit handling."""
        # Set rate limit counter to max
        cache.set("opensky_rate_limit", opensky_live.MAX_REQUESTS_PER_MINUTE)

        result = opensky_live._make_request("states/all")

        self.assertIsNone(result)

    @patch("httpx.Client")
    @override_settings(OPENSKY_LIVE_ENABLED=True)
    def test_make_request_success(self, mock_client_class):
        """Test successful API request."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"states": []}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = opensky_live._make_request("states/all")

        self.assertEqual(result, {"states": []})

    @patch("httpx.Client")
    @override_settings(OPENSKY_LIVE_ENABLED=True)
    def test_make_request_rate_limit_error(self, mock_client_class):
        """Test HTTP 429 rate limit error handling."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError(
            "Rate limited", request=MagicMock(), response=mock_response
        )
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = opensky_live._make_request("states/all")

        self.assertIsNone(result)


class ParseStateVectorTests(TestCase):
    """Tests for state vector parsing."""

    def test_parse_state_vector_valid(self):
        """Test parsing valid state vector."""
        state = [
            "abc123",  # icao24
            "UAL456  ",  # callsign
            "United States",  # origin_country
            1704067200,  # time_position
            1704067200,  # last_contact
            -122.0,  # longitude
            47.5,  # latitude
            10668.0,  # baro_altitude (meters)
            False,  # on_ground
            231.5,  # velocity (m/s)
            270.0,  # true_track
            -2.5,  # vertical_rate (m/s)
            None,  # sensors
            10700.0,  # geo_altitude
            "4521",  # squawk
            False,  # spi
            0,  # position_source (ADS-B)
        ]

        result = opensky_live._parse_state_vector(state)

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "ABC123")
        self.assertEqual(result["callsign"], "UAL456")
        self.assertEqual(result["origin_country"], "United States")
        self.assertEqual(result["latitude"], 47.5)
        self.assertEqual(result["longitude"], -122.0)
        self.assertAlmostEqual(result["altitude_baro_ft"], 35000, delta=100)
        self.assertAlmostEqual(result["velocity_kt"], 450, delta=10)
        self.assertEqual(result["track"], 270.0)
        self.assertEqual(result["squawk"], "4521")
        self.assertEqual(result["position_source"], "ADS-B")
        self.assertEqual(result["source"], "opensky")

    def test_parse_state_vector_short_array(self):
        """Test that short array returns None."""
        state = ["abc123", "UAL456"]  # Too short

        result = opensky_live._parse_state_vector(state)

        self.assertIsNone(result)

    def test_parse_state_vector_empty(self):
        """Test that empty array returns None."""
        result = opensky_live._parse_state_vector([])
        self.assertIsNone(result)

    def test_parse_state_vector_none(self):
        """Test that None returns None."""
        result = opensky_live._parse_state_vector(None)
        self.assertIsNone(result)

    def test_parse_state_vector_missing_icao(self):
        """Test that missing ICAO returns None."""
        state = [
            None,  # icao24 missing
            "UAL456",
            "USA",
            1704067200,
            1704067200,
            -122.0,
            47.5,
            10668.0,
            False,
            231.5,
            270.0,
            -2.5,
            None,
            10700.0,
            "4521",
            False,
            0,
        ]

        result = opensky_live._parse_state_vector(state)

        self.assertIsNone(result)

    def test_parse_state_vector_missing_position(self):
        """Test that missing lat/lon returns None."""
        state = [
            "abc123",
            "UAL456",
            "USA",
            1704067200,
            1704067200,
            None,  # longitude
            None,  # latitude
            10668.0,
            False,
            231.5,
            270.0,
            -2.5,
            None,
            10700.0,
            "4521",
            False,
            0,
        ]

        result = opensky_live._parse_state_vector(state)

        self.assertIsNone(result)

    def test_parse_state_vector_on_ground(self):
        """Test parsing aircraft on ground."""
        state = [
            "abc123",
            "UAL456",
            "USA",
            1704067200,
            1704067200,
            -122.0,
            47.5,
            0,  # On ground
            True,  # on_ground
            0,
            270.0,
            0,
            None,
            0,
            "1200",
            False,
            0,
        ]

        result = opensky_live._parse_state_vector(state)

        self.assertIsNotNone(result)
        self.assertTrue(result["on_ground"])

    def test_parse_state_vector_null_velocity(self):
        """Test parsing with null velocity."""
        state = [
            "abc123",
            "UAL456",
            "USA",
            1704067200,
            1704067200,
            -122.0,
            47.5,
            10668.0,
            False,
            None,  # velocity
            270.0,
            None,  # vertical_rate
            None,
            10700.0,
            "4521",
            False,
            0,
        ]

        result = opensky_live._parse_state_vector(state)

        self.assertIsNotNone(result)
        self.assertIsNone(result["velocity_kt"])
        self.assertIsNone(result["vertical_rate_fpm"])

    def test_parse_state_vector_position_sources(self):
        """Test parsing different position sources."""
        sources = {0: "ADS-B", 1: "ASTERIX", 2: "MLAT", 3: "FLARM"}

        for source_code, source_name in sources.items():
            state = [
                "abc123",
                "UAL456",
                "USA",
                1704067200,
                1704067200,
                -122.0,
                47.5,
                10668.0,
                False,
                231.5,
                270.0,
                -2.5,
                None,
                10700.0,
                "4521",
                False,
                source_code,
            ]

            result = opensky_live._parse_state_vector(state)
            self.assertEqual(result["position_source"], source_name)


class GetAllStatesTests(TestCase):
    """Tests for getting all aircraft states."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_all_states_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = opensky_live.get_all_states()

        self.assertEqual(result, [])

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_all_states_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = [{"icao_hex": "ABC123"}]
        cache.set("opensky_states_all", cached_data)

        result = opensky_live.get_all_states()

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.opensky_live._make_request")
    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_all_states_api_call(self, mock_enabled, mock_request):
        """Test API call when not cached."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "states": [
                [
                    "abc123",
                    "UAL456",
                    "USA",
                    1704067200,
                    1704067200,
                    -122.0,
                    47.5,
                    10668.0,
                    False,
                    231.5,
                    270.0,
                    -2.5,
                    None,
                    10700.0,
                    "4521",
                    False,
                    0,
                ]
            ]
        }

        result = opensky_live.get_all_states()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["icao_hex"], "ABC123")

    @patch("skyspy.services.opensky_live._make_request")
    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_all_states_with_bbox(self, mock_enabled, mock_request):
        """Test getting states with bounding box."""
        mock_enabled.return_value = True
        mock_request.return_value = {"states": []}

        opensky_live.get_all_states(bbox=(40.0, 50.0, -130.0, -60.0))

        mock_request.assert_called_once()
        call_args = mock_request.call_args
        # Check that params were passed (positional or keyword)
        if call_args.kwargs:
            params = call_args.kwargs.get("params", call_args.args[1] if len(call_args.args) > 1 else {})
        else:
            params = call_args.args[1] if len(call_args.args) > 1 else {}
        self.assertIn("lamin", params)


class GetAircraftByIcaoTests(TestCase):
    """Tests for getting aircraft by ICAO hex."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_aircraft_by_icao_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = opensky_live.get_aircraft_by_icao("ABC123")

        self.assertIsNone(result)

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_aircraft_by_icao_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"icao_hex": "ABC123", "callsign": "UAL456"}
        cache.set("opensky_aircraft_abc123", cached_data)

        result = opensky_live.get_aircraft_by_icao("ABC123")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.opensky_live._make_request")
    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_aircraft_by_icao_api_call(self, mock_enabled, mock_request):
        """Test API call when not cached."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "states": [
                [
                    "abc123",
                    "UAL456",
                    "USA",
                    1704067200,
                    1704067200,
                    -122.0,
                    47.5,
                    10668.0,
                    False,
                    231.5,
                    270.0,
                    -2.5,
                    None,
                    10700.0,
                    "4521",
                    False,
                    0,
                ]
            ]
        }

        result = opensky_live.get_aircraft_by_icao("ABC123")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_hex"], "ABC123")


class GetAircraftTrackTests(TestCase):
    """Tests for getting aircraft track."""

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_aircraft_track_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = opensky_live.get_aircraft_track("ABC123")

        self.assertEqual(result, [])

    @patch("skyspy.services.opensky_live._make_request")
    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_aircraft_track_success(self, mock_enabled, mock_request):
        """Test successful track retrieval."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "path": [
                [1704067200, 47.5, -122.0, 10668.0, 270.0, False],
                [1704067210, 47.51, -122.01, 10700.0, 270.0, False],
            ]
        }

        result = opensky_live.get_aircraft_track("ABC123")

        self.assertEqual(len(result), 2)
        self.assertIn("latitude", result[0])
        self.assertIn("longitude", result[0])


class GetDeparturesTests(TestCase):
    """Tests for getting airport departures."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_departures_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = opensky_live.get_departures("KSEA")

        self.assertEqual(result, [])

    @patch("skyspy.services.opensky_live._make_request")
    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_departures_success(self, mock_enabled, mock_request):
        """Test successful departure retrieval."""
        mock_enabled.return_value = True
        mock_request.return_value = [
            {
                "icao24": "abc123",
                "callsign": "UAL456",
                "estDepartureAirport": "KSEA",
                "estArrivalAirport": "KLAX",
                "firstSeen": 1704067200,
                "lastSeen": 1704080000,
            }
        ]

        result = opensky_live.get_departures("KSEA")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["icao_hex"], "ABC123")
        self.assertEqual(result[0]["departure_airport"], "KSEA")


class GetArrivalsTests(TestCase):
    """Tests for getting airport arrivals."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_arrivals_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = opensky_live.get_arrivals("KLAX")

        self.assertEqual(result, [])

    @patch("skyspy.services.opensky_live._make_request")
    @patch("skyspy.services.opensky_live._is_enabled")
    def test_get_arrivals_success(self, mock_enabled, mock_request):
        """Test successful arrival retrieval."""
        mock_enabled.return_value = True
        mock_request.return_value = [
            {
                "icao24": "abc123",
                "callsign": "UAL456",
                "estDepartureAirport": "KSEA",
                "estArrivalAirport": "KLAX",
                "firstSeen": 1704067200,
                "lastSeen": 1704080000,
            }
        ]

        result = opensky_live.get_arrivals("KLAX")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["arrival_airport"], "KLAX")


class TrackAircraftGloballyTests(TestCase):
    """Tests for global aircraft tracking."""

    @patch("skyspy.services.opensky_live.get_aircraft_by_icao")
    def test_track_aircraft_globally_calls_get_by_icao(self, mock_get):
        """Test that track_aircraft_globally delegates to get_aircraft_by_icao."""
        mock_get.return_value = {"icao_hex": "ABC123"}

        result = opensky_live.track_aircraft_globally("ABC123")

        mock_get.assert_called_once_with("ABC123")
        self.assertEqual(result, {"icao_hex": "ABC123"})


class GetApiStatusTests(TestCase):
    """Tests for API status retrieval."""

    @override_settings(OPENSKY_LIVE_ENABLED=True, OPENSKY_USERNAME="testuser", OPENSKY_PASSWORD="testpass")
    def test_get_api_status_authenticated(self):
        """Test API status when authenticated."""
        status = opensky_live.get_api_status()

        self.assertTrue(status["enabled"])
        self.assertTrue(status["authenticated"])
        self.assertEqual(status["cache_ttl_states"], opensky_live.STATES_CACHE_TTL)
        self.assertEqual(status["max_requests_per_minute"], opensky_live.MAX_REQUESTS_PER_MINUTE)

    @override_settings(OPENSKY_LIVE_ENABLED=True)
    def test_get_api_status_unauthenticated(self):
        """Test API status when not authenticated."""
        from django.conf import settings

        if hasattr(settings, "OPENSKY_USERNAME"):
            delattr(settings, "OPENSKY_USERNAME")
        if hasattr(settings, "OPENSKY_PASSWORD"):
            delattr(settings, "OPENSKY_PASSWORD")

        status = opensky_live.get_api_status()

        self.assertFalse(status["authenticated"])

    @override_settings(OPENSKY_LIVE_ENABLED=False)
    def test_get_api_status_disabled(self):
        """Test API status when disabled."""
        status = opensky_live.get_api_status()

        self.assertFalse(status["enabled"])
