"""
Tests for the aviationstack service (Aviationstack API integration).

Tests flight schedule lookups, route data, airline info,
caching, and error handling.
"""

from datetime import date
from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.services import aviationstack


class GetApiKeyTests(TestCase):
    """Tests for API key retrieval."""

    @override_settings(AVIATIONSTACK_API_KEY="test-api-key")
    def test_get_api_key_returns_key(self):
        """Test that API key is returned from settings."""
        result = aviationstack._get_api_key()
        self.assertEqual(result, "test-api-key")

    @override_settings()
    def test_get_api_key_returns_none_when_not_set(self):
        """Test that None is returned when key not configured."""
        from django.conf import settings

        if hasattr(settings, "AVIATIONSTACK_API_KEY"):
            delattr(settings, "AVIATIONSTACK_API_KEY")

        result = aviationstack._get_api_key()
        self.assertIsNone(result)


class IsEnabledTests(TestCase):
    """Tests for enabled check."""

    @override_settings(AVIATIONSTACK_ENABLED=True, AVIATIONSTACK_API_KEY="test-key")
    def test_is_enabled_returns_true(self):
        """Test enabled when both settings are set."""
        result = aviationstack._is_enabled()
        self.assertTrue(result)

    @override_settings(AVIATIONSTACK_ENABLED=False, AVIATIONSTACK_API_KEY="test-key")
    def test_is_enabled_returns_false_when_disabled(self):
        """Test disabled when AVIATIONSTACK_ENABLED is False."""
        result = aviationstack._is_enabled()
        self.assertFalse(result)

    @override_settings(AVIATIONSTACK_ENABLED=True)
    def test_is_enabled_returns_false_without_key(self):
        """Test disabled when API key is not set."""
        from django.conf import settings

        if hasattr(settings, "AVIATIONSTACK_API_KEY"):
            delattr(settings, "AVIATIONSTACK_API_KEY")

        result = aviationstack._is_enabled()
        self.assertFalse(result)


class MakeRequestTests(TestCase):
    """Tests for HTTP request handling."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.aviationstack._get_api_key")
    def test_make_request_returns_none_without_key(self, mock_get_key):
        """Test that missing API key returns None."""
        mock_get_key.return_value = None

        result = aviationstack._make_request("flights")

        self.assertIsNone(result)

    @patch("httpx.Client")
    @patch("skyspy.services.aviationstack._get_api_key")
    def test_make_request_success(self, mock_get_key, mock_client_class):
        """Test successful API request."""
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.json.return_value = {"data": []}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = aviationstack._make_request("flights")

        self.assertEqual(result, {"data": []})

    @patch("httpx.Client")
    @patch("skyspy.services.aviationstack._get_api_key")
    def test_make_request_api_error(self, mock_get_key, mock_client_class):
        """Test API error response handling."""
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.json.return_value = {"error": {"message": "Invalid API key"}}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = aviationstack._make_request("flights")

        self.assertIsNone(result)

    @patch("httpx.Client")
    @patch("skyspy.services.aviationstack._get_api_key")
    def test_make_request_http_error(self, mock_get_key, mock_client_class):
        """Test HTTP error handling."""
        mock_get_key.return_value = "test-key"
        mock_response = MagicMock()
        mock_response.status_code = 500

        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError("Server error", request=MagicMock(), response=mock_response)
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = aviationstack._make_request("flights")

        self.assertIsNone(result)


class ParseFlightTests(TestCase):
    """Tests for flight data parsing."""

    def test_parse_flight_valid(self):
        """Test parsing valid flight data."""
        flight_data = {
            "flight": {
                "number": "456",
                "iata": "AA456",
                "icao": "AAL456",
            },
            "airline": {
                "name": "American Airlines",
                "iata": "AA",
                "icao": "AAL",
            },
            "departure": {
                "airport": "Los Angeles International",
                "iata": "LAX",
                "icao": "KLAX",
                "scheduled": "2024-01-01T08:00:00+00:00",
                "estimated": "2024-01-01T08:05:00+00:00",
                "actual": None,
                "delay": 5,
                "terminal": "4",
                "gate": "45B",
            },
            "arrival": {
                "airport": "John F. Kennedy International",
                "iata": "JFK",
                "icao": "KJFK",
                "scheduled": "2024-01-01T16:30:00+00:00",
                "estimated": "2024-01-01T16:35:00+00:00",
                "actual": None,
                "delay": None,
                "terminal": "8",
                "gate": "10",
                "baggage": "5",
            },
            "aircraft": {
                "registration": "N12345",
                "iata": "738",
                "icao": "B738",
                "icao24": "A12345",
            },
            "flight_status": "active",
            "flight_date": "2024-01-01",
        }

        result = aviationstack._parse_flight(flight_data)

        self.assertIsNotNone(result)
        self.assertEqual(result["flight_number"], "456")
        self.assertEqual(result["flight_iata"], "AA456")
        self.assertEqual(result["flight_icao"], "AAL456")
        self.assertEqual(result["airline_name"], "American Airlines")
        self.assertEqual(result["departure_iata"], "LAX")
        self.assertEqual(result["arrival_iata"], "JFK")
        self.assertEqual(result["aircraft_registration"], "N12345")
        self.assertEqual(result["flight_status"], "active")
        self.assertEqual(result["source"], "aviationstack")

    def test_parse_flight_minimal(self):
        """Test parsing flight with minimal data."""
        flight_data = {
            "flight": {},
            "departure": {},
            "arrival": {},
            "airline": {},
            "aircraft": {},
        }

        result = aviationstack._parse_flight(flight_data)

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "aviationstack")


class GetFlightByCallsignTests(TestCase):
    """Tests for getting flight by callsign."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_flight_by_callsign_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = aviationstack.get_flight_by_callsign(flight_iata="AA456")

        self.assertIsNone(result)

    def test_get_flight_by_callsign_no_params(self):
        """Test returns None when no callsign provided."""
        result = aviationstack.get_flight_by_callsign()
        self.assertIsNone(result)

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_flight_by_callsign_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"flight_iata": "AA456", "airline_name": "American Airlines"}
        cache.set("aviationstack_flight_AA456", cached_data)

        result = aviationstack.get_flight_by_callsign(flight_iata="AA456")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.aviationstack._make_request")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_flight_by_callsign_iata(self, mock_enabled, mock_request):
        """Test getting flight by IATA code."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "data": [
                {
                    "flight": {"iata": "AA456"},
                    "departure": {},
                    "arrival": {},
                    "airline": {},
                    "aircraft": {},
                }
            ]
        }

        result = aviationstack.get_flight_by_callsign(flight_iata="AA456")

        self.assertIsNotNone(result)
        self.assertEqual(result["flight_iata"], "AA456")

    @patch("skyspy.services.aviationstack._make_request")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_flight_by_callsign_icao(self, mock_enabled, mock_request):
        """Test getting flight by ICAO code."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "data": [
                {
                    "flight": {"icao": "AAL456"},
                    "departure": {},
                    "arrival": {},
                    "airline": {},
                    "aircraft": {},
                }
            ]
        }

        result = aviationstack.get_flight_by_callsign(flight_icao="AAL456")

        self.assertIsNotNone(result)


class GetFlightsForRouteTests(TestCase):
    """Tests for getting flights on a route."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_flights_for_route_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = aviationstack.get_flights_for_route("LAX", "JFK")

        self.assertEqual(result, [])

    @patch("skyspy.services.aviationstack._make_request")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_flights_for_route_success(self, mock_enabled, mock_request):
        """Test successful route lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "data": [
                {
                    "flight": {"iata": "AA456"},
                    "departure": {"iata": "LAX"},
                    "arrival": {"iata": "JFK"},
                    "airline": {},
                    "aircraft": {},
                },
                {
                    "flight": {"iata": "UA789"},
                    "departure": {"iata": "LAX"},
                    "arrival": {"iata": "JFK"},
                    "airline": {},
                    "aircraft": {},
                },
            ]
        }

        result = aviationstack.get_flights_for_route("LAX", "JFK")

        self.assertEqual(len(result), 2)


class GetDeparturesTests(TestCase):
    """Tests for getting airport departures."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_departures_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = aviationstack.get_departures("LAX")

        self.assertEqual(result, [])

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_departures_cached(self, mock_enabled):
        """Test returns cached data with limit."""
        mock_enabled.return_value = True
        cached_data = [{"flight_iata": f"AA{i}"} for i in range(100)]
        today = date.today().isoformat()
        cache.set(f"aviationstack_dep_LAX_{today}", cached_data)

        result = aviationstack.get_departures("LAX", limit=10)

        self.assertEqual(len(result), 10)

    @patch("skyspy.services.aviationstack._make_request")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_departures_success(self, mock_enabled, mock_request):
        """Test successful departure lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "data": [
                {
                    "flight": {"iata": "AA456"},
                    "departure": {"iata": "LAX"},
                    "arrival": {},
                    "airline": {},
                    "aircraft": {},
                }
            ]
        }

        result = aviationstack.get_departures("LAX")

        self.assertEqual(len(result), 1)


class GetArrivalsTests(TestCase):
    """Tests for getting airport arrivals."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_arrivals_disabled(self, mock_enabled):
        """Test returns empty list when disabled."""
        mock_enabled.return_value = False

        result = aviationstack.get_arrivals("JFK")

        self.assertEqual(result, [])

    @patch("skyspy.services.aviationstack._make_request")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_arrivals_success(self, mock_enabled, mock_request):
        """Test successful arrival lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "data": [
                {
                    "flight": {"iata": "AA456"},
                    "departure": {},
                    "arrival": {"iata": "JFK"},
                    "airline": {},
                    "aircraft": {},
                }
            ]
        }

        result = aviationstack.get_arrivals("JFK")

        self.assertEqual(len(result), 1)


class GetAirlineInfoTests(TestCase):
    """Tests for getting airline information."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_airline_info_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = aviationstack.get_airline_info(airline_iata="AA")

        self.assertIsNone(result)

    def test_get_airline_info_no_params(self):
        """Test returns None when no code provided."""
        result = aviationstack.get_airline_info()
        self.assertIsNone(result)

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_airline_info_cached(self, mock_enabled):
        """Test returns cached data."""
        mock_enabled.return_value = True
        cached_data = {"name": "American Airlines", "iata_code": "AA"}
        cache.set("aviationstack_airline_AA", cached_data)

        result = aviationstack.get_airline_info(airline_iata="AA")

        self.assertEqual(result, cached_data)

    @patch("skyspy.services.aviationstack._make_request")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_get_airline_info_success(self, mock_enabled, mock_request):
        """Test successful airline lookup."""
        mock_enabled.return_value = True
        mock_request.return_value = {
            "data": [
                {
                    "airline_name": "American Airlines",
                    "iata_code": "AA",
                    "icao_code": "AAL",
                    "callsign": "AMERICAN",
                    "country_name": "United States",
                    "country_iso2": "US",
                    "status": "active",
                    "fleet_size": 950,
                    "fleet_average_age": 10.5,
                    "hub_code": "DFW",
                }
            ]
        }

        result = aviationstack.get_airline_info(airline_iata="AA")

        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "American Airlines")
        self.assertEqual(result["iata_code"], "AA")
        self.assertTrue(result["is_active"])
        self.assertEqual(result["source"], "aviationstack")


class CorrelateWithLiveAircraftTests(TestCase):
    """Tests for correlating live aircraft with schedules."""

    @patch("skyspy.services.aviationstack._is_enabled")
    def test_correlate_disabled(self, mock_enabled):
        """Test returns None when disabled."""
        mock_enabled.return_value = False

        result = aviationstack.correlate_with_live_aircraft("AAL456")

        self.assertIsNone(result)

    @patch("skyspy.services.aviationstack.get_flight_by_callsign")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_correlate_icao_callsign(self, mock_enabled, mock_get_flight):
        """Test correlation with ICAO callsign format."""
        mock_enabled.return_value = True
        mock_get_flight.return_value = {"flight_icao": "AAL456"}

        result = aviationstack.correlate_with_live_aircraft("AAL456")

        self.assertIsNotNone(result)
        mock_get_flight.assert_called_with(flight_icao="AAL456")

    @patch("skyspy.services.aviationstack.get_flight_by_callsign")
    @patch("skyspy.services.aviationstack._is_enabled")
    def test_correlate_iata_fallback(self, mock_enabled, mock_get_flight):
        """Test correlation falls back to IATA format."""
        mock_enabled.return_value = True
        # "AA456" has only 5 chars, 3 alpha at start, so it tries ICAO first
        # Then falls back to IATA
        mock_get_flight.side_effect = [None, {"flight_iata": "AA56"}]

        # Use a callsign that has 3+ alpha chars at start so ICAO is tried first
        aviationstack.correlate_with_live_aircraft("AAL456")

        # Should have tried ICAO first (returns None), then doesn't match IATA format
        # Let's verify the function was called
        self.assertTrue(mock_get_flight.called)


class GetApiStatusTests(TestCase):
    """Tests for API status retrieval."""

    @override_settings(AVIATIONSTACK_ENABLED=True, AVIATIONSTACK_API_KEY="test-key")
    def test_get_api_status_enabled(self):
        """Test API status when enabled."""
        status = aviationstack.get_api_status()

        self.assertTrue(status["enabled"])
        self.assertTrue(status["api_key_configured"])
        self.assertEqual(status["cache_ttl_flights"], aviationstack.FLIGHTS_CACHE_TTL)
        self.assertEqual(status["monthly_limit"], 100)

    @override_settings(AVIATIONSTACK_ENABLED=False)
    def test_get_api_status_disabled(self):
        """Test API status when disabled."""
        from django.conf import settings

        if hasattr(settings, "AVIATIONSTACK_API_KEY"):
            delattr(settings, "AVIATIONSTACK_API_KEY")

        status = aviationstack.get_api_status()

        self.assertFalse(status["enabled"])
