"""
Tests for the OpenAIP service.

Tests OpenAIP data integration including:
- API configuration and authentication
- Airspace data fetching and parsing
- Airport data fetching and parsing
- Navaid data fetching and parsing
- Reporting points fetching
- Caching behavior
- Error handling
"""

from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.services import openaip


class OpenAIPConfigurationTests(TestCase):
    """Tests for OpenAIP configuration."""

    def test_is_enabled_returns_false_without_key(self):
        """Test that service is disabled without API key."""
        with patch.object(openaip, "_get_api_key", return_value=None):
            result = openaip._is_enabled()
            self.assertFalse(result)

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    def test_is_enabled_returns_true_with_config(self):
        """Test that service is enabled with proper config."""
        result = openaip._is_enabled()
        self.assertTrue(result)

    @override_settings(OPENAIP_ENABLED=False, OPENAIP_API_KEY="test_key")
    def test_is_enabled_returns_false_when_disabled(self):
        """Test that service is disabled when OPENAIP_ENABLED is False."""
        result = openaip._is_enabled()
        self.assertFalse(result)

    @override_settings(OPENAIP_API_KEY="test_api_key")
    def test_get_api_key_from_settings(self):
        """Test getting API key from settings."""
        result = openaip._get_api_key()
        self.assertEqual(result, "test_api_key")


class GetApiStatusTests(TestCase):
    """Tests for API status reporting."""

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    def test_get_api_status(self):
        """Test API status includes all expected fields."""
        status = openaip.get_api_status()

        self.assertIn("enabled", status)
        self.assertIn("api_key_configured", status)
        self.assertIn("cache_ttl_airspace", status)
        self.assertIn("cache_ttl_airports", status)
        self.assertTrue(status["enabled"])
        self.assertTrue(status["api_key_configured"])

    @override_settings(OPENAIP_ENABLED=False)
    def test_get_api_status_disabled(self):
        """Test API status when disabled."""
        status = openaip.get_api_status()

        self.assertFalse(status["enabled"])


class MakeRequestTests(TestCase):
    """Tests for API request handling."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    def test_returns_none_without_api_key(self):
        """Test that request returns None without API key."""
        with patch.object(openaip, "_get_api_key", return_value=None):
            result = openaip._make_request("airspaces", {})
            self.assertIsNone(result)

    @patch("skyspy.services.openaip._get_api_key")
    @patch("skyspy.services.openaip._http_get_openaip")
    def test_successful_request(self, mock_http_get, mock_get_key):
        """Test successful API request."""
        mock_get_key.return_value = "test_key"
        mock_response = MagicMock()
        mock_response.json.return_value = {"items": []}
        mock_http_get.return_value = mock_response

        result = openaip._make_request("airspaces", {})

        self.assertIsNotNone(result)
        mock_http_get.assert_called_once()

    @patch("skyspy.services.openaip._get_api_key")
    @patch("skyspy.services.openaip._http_get_openaip")
    def test_handles_rate_limit(self, mock_http_get, mock_get_key):
        """Test handling of rate limit errors."""
        import httpx

        mock_get_key.return_value = "test_key"
        mock_response = MagicMock()
        mock_response.status_code = 429
        error = httpx.HTTPStatusError("Rate limit", request=MagicMock(), response=mock_response)
        mock_http_get.side_effect = error

        result = openaip._make_request("airspaces", {})

        self.assertIsNone(result)

    @patch("skyspy.services.openaip._get_api_key")
    @patch("skyspy.services.openaip._http_get_openaip")
    def test_handles_auth_error(self, mock_http_get, mock_get_key):
        """Test handling of authentication errors."""
        import httpx

        mock_get_key.return_value = "test_key"
        mock_response = MagicMock()
        mock_response.status_code = 401
        error = httpx.HTTPStatusError("Unauthorized", request=MagicMock(), response=mock_response)
        mock_http_get.side_effect = error

        result = openaip._make_request("airspaces", {})

        self.assertIsNone(result)


class GetAirspacesTests(TestCase):
    """Tests for airspace data retrieval."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    def test_returns_empty_when_disabled(self):
        """Test that empty list is returned when service is disabled."""
        with patch.object(openaip, "_is_enabled", return_value=False):
            result = openaip.get_airspaces(lat=47.0, lon=-122.0)
            self.assertEqual(result, [])

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_returns_cached_airspaces(self, mock_request):
        """Test that cached data is returned."""
        # Cache key uses the EFFECTIVE (clamped) radius: 100nm clamps to
        # OPENAIP_MAX_DIST_M (~27nm), so the key ends in _27, not _100.
        cache_key = "openaip_airspace_47.00_-122.00_27"
        cached_data = [{"id": "cached", "name": "Test Airspace"}]
        cache.set(cache_key, cached_data, timeout=3600)

        result = openaip.get_airspaces(lat=47.0, lon=-122.0)

        self.assertEqual(result, cached_data)
        mock_request.assert_not_called()

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_fetches_and_caches_airspaces(self, mock_request):
        """Test that airspaces are fetched and cached."""
        mock_request.return_value = {
            "items": [
                {
                    "_id": "123",
                    "name": "Test Airspace",
                    "type": 4,  # CTR
                    "country": "US",
                    "lowerLimit": {"value": 0, "unit": "ft", "referenceDatum": "MSL"},
                    "upperLimit": {"value": 3000, "unit": "ft", "referenceDatum": "MSL"},
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ]
        }

        result = openaip.get_airspaces(lat=47.0, lon=-122.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Test Airspace")
        self.assertEqual(result[0]["type"], "CTR")
        mock_request.assert_called_once()

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_applies_airspace_type_filter(self, mock_request):
        """Test that airspace type filter is applied."""
        mock_request.return_value = {"items": []}

        openaip.get_airspaces(lat=47.0, lon=-122.0, airspace_types=[4, 5])

        call_args = mock_request.call_args
        # _make_request is called with positional args: ("airspaces", params)
        params = call_args[0][1]
        self.assertIn("type", params)


class ParseAirspaceTests(TestCase):
    """Tests for airspace parsing."""

    def test_parses_complete_airspace(self):
        """Test parsing of complete airspace data."""
        item = {
            "_id": "123",
            "name": "Test CTR",
            "type": 4,
            "country": "US",
            "lowerLimit": {"value": 0, "unit": "ft", "referenceDatum": "MSL"},
            "upperLimit": {"value": 3000, "unit": "ft", "referenceDatum": "MSL"},
            "geometry": {"type": "Polygon", "coordinates": []},
        }

        result = openaip._parse_airspace(item)

        self.assertIsNotNone(result)
        self.assertEqual(result["id"], "123")
        self.assertEqual(result["name"], "Test CTR")
        self.assertEqual(result["type"], "CTR")
        self.assertEqual(result["floor_ft"], 0)
        self.assertEqual(result["ceiling_ft"], 3000)
        self.assertEqual(result["source"], "openaip")

    def test_converts_meters_to_feet(self):
        """Test that meters are converted to feet."""
        item = {
            "_id": "123",
            "name": "Test",
            "type": 1,
            "lowerLimit": {"value": 100, "unit": "m", "referenceDatum": "MSL"},
            "upperLimit": {"value": 1000, "unit": "m", "referenceDatum": "MSL"},
            "geometry": {"type": "Polygon", "coordinates": []},
        }

        result = openaip._parse_airspace(item)

        self.assertIsNotNone(result)
        self.assertEqual(result["floor_ft"], 328)  # 100m * 3.281
        self.assertEqual(result["ceiling_ft"], 3281)  # 1000m * 3.281

    def test_returns_none_without_geometry(self):
        """Test that None is returned without geometry."""
        item = {
            "_id": "123",
            "name": "Test",
            "type": 1,
            "geometry": None,
        }

        result = openaip._parse_airspace(item)

        self.assertIsNone(result)

    def test_handles_unknown_type(self):
        """Test handling of unknown airspace types."""
        item = {
            "_id": "123",
            "name": "Test",
            "type": 999,  # Unknown
            "geometry": {"type": "Polygon", "coordinates": []},
        }

        result = openaip._parse_airspace(item)

        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "OTHER")

    def test_handles_missing_limits(self):
        """Test handling of missing altitude limits."""
        item = {
            "_id": "123",
            "name": "Test",
            "type": 1,
            "geometry": {"type": "Polygon", "coordinates": []},
        }

        result = openaip._parse_airspace(item)

        self.assertIsNotNone(result)
        # When lowerLimit/upperLimit are missing, item.get returns {},
        # which is a dict, so the parsing branch executes with default value 0
        self.assertEqual(result["floor_ft"], 0)
        self.assertEqual(result["ceiling_ft"], 0)


class GetAirportsTests(TestCase):
    """Tests for airport data retrieval."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    def test_returns_empty_when_disabled(self):
        """Test that empty list is returned when service is disabled."""
        with patch.object(openaip, "_is_enabled", return_value=False):
            result = openaip.get_airports(lat=47.0, lon=-122.0)
            self.assertEqual(result, [])

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_fetches_airports(self, mock_request):
        """Test successful airport fetching."""
        mock_request.return_value = {
            "items": [
                {
                    "_id": "apt123",
                    "name": "Seattle-Tacoma International",
                    "icaoCode": "KSEA",
                    "iataCode": "SEA",
                    "country": "US",
                    "type": 3,
                    "elevation": {"value": 432},
                    "geometry": {"type": "Point", "coordinates": [-122.3, 47.4]},
                    "runways": [],
                    "frequencies": [],
                }
            ]
        }

        result = openaip.get_airports(lat=47.0, lon=-122.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Seattle-Tacoma International")
        self.assertEqual(result[0]["icao"], "KSEA")
        self.assertEqual(result[0]["latitude"], 47.4)
        self.assertEqual(result[0]["longitude"], -122.3)


class ParseAirportTests(TestCase):
    """Tests for airport parsing."""

    def test_parses_complete_airport(self):
        """Test parsing of complete airport data."""
        item = {
            "_id": "apt123",
            "name": "Seattle-Tacoma International",
            "icaoCode": "KSEA",
            "iataCode": "SEA",
            "country": "US",
            "type": 3,
            "elevation": {"value": 432},
            "geometry": {"type": "Point", "coordinates": [-122.3, 47.4]},
            "runways": [{"name": "16L/34R"}],
            "frequencies": [{"name": "ATIS", "value": 118.0}],
        }

        result = openaip._parse_airport(item)

        self.assertIsNotNone(result)
        self.assertEqual(result["id"], "apt123")
        self.assertEqual(result["name"], "Seattle-Tacoma International")
        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["iata"], "SEA")
        self.assertEqual(result["latitude"], 47.4)
        self.assertEqual(result["longitude"], -122.3)
        self.assertEqual(result["elevation_ft"], 432)
        self.assertEqual(result["source"], "openaip")

    def test_returns_none_with_insufficient_coordinates(self):
        """Test that None is returned with insufficient coordinates."""
        item = {
            "_id": "apt123",
            "name": "Test Airport",
            "geometry": {"type": "Point", "coordinates": [-122.3]},  # Only one coordinate
        }

        result = openaip._parse_airport(item)

        self.assertIsNone(result)


class GetNavaidsTests(TestCase):
    """Tests for navaid data retrieval."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    def test_returns_empty_when_disabled(self):
        """Test that empty list is returned when service is disabled."""
        with patch.object(openaip, "_is_enabled", return_value=False):
            result = openaip.get_navaids(lat=47.0, lon=-122.0)
            self.assertEqual(result, [])

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_fetches_navaids(self, mock_request):
        """Test successful navaid fetching."""
        mock_request.return_value = {
            "items": [
                {
                    "_id": "nav123",
                    "identifier": "SEA",
                    "name": "Seattle VOR",
                    "type": 2,  # VOR
                    "country": "US",
                    "frequency": {"value": 116.8},
                    "geometry": {"type": "Point", "coordinates": [-122.3, 47.4]},
                }
            ]
        }

        result = openaip.get_navaids(lat=47.0, lon=-122.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Seattle VOR")
        self.assertEqual(result[0]["ident"], "SEA")
        self.assertEqual(result[0]["type"], "VOR")


class ParseNavaidTests(TestCase):
    """Tests for navaid parsing."""

    def test_parses_complete_navaid(self):
        """Test parsing of complete navaid data."""
        item = {
            "_id": "nav123",
            "identifier": "SEA",
            "name": "Seattle VOR",
            "type": 2,  # VOR
            "country": "US",
            "frequency": {"value": 116.8},
            "geometry": {"type": "Point", "coordinates": [-122.3, 47.4]},
        }

        result = openaip._parse_navaid(item)

        self.assertIsNotNone(result)
        self.assertEqual(result["id"], "nav123")
        self.assertEqual(result["ident"], "SEA")
        self.assertEqual(result["name"], "Seattle VOR")
        self.assertEqual(result["type"], "VOR")
        self.assertEqual(result["frequency"], 116.8)
        self.assertEqual(result["source"], "openaip")

    def test_maps_navaid_types(self):
        """Test that navaid types are correctly mapped."""
        test_cases = [
            (0, "OTHER"),
            (1, "NDB"),
            (2, "VOR"),
            (3, "VOR-DME"),
            (4, "VORTAC"),
            (5, "TACAN"),
            (6, "DME"),
            (7, "NDB-DME"),
        ]

        for type_id, expected_type in test_cases:
            item = {
                "_id": "nav123",
                "identifier": "TST",
                "name": "Test",
                "type": type_id,
                "geometry": {"type": "Point", "coordinates": [-122.3, 47.4]},
            }

            result = openaip._parse_navaid(item)

            self.assertEqual(result["type"], expected_type, f"Failed for type_id {type_id}")


class GetReportingPointsTests(TestCase):
    """Tests for reporting points retrieval."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    def test_returns_empty_when_disabled(self):
        """Test that empty list is returned when service is disabled."""
        with patch.object(openaip, "_is_enabled", return_value=False):
            result = openaip.get_reporting_points(lat=47.0, lon=-122.0)
            self.assertEqual(result, [])

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_fetches_reporting_points(self, mock_request):
        """Test successful reporting points fetching."""
        mock_request.return_value = {
            "items": [
                {
                    "_id": "rp123",
                    "identifier": "LAKER",
                    "name": "LAKER",
                    "country": "US",
                    "geometry": {"type": "Point", "coordinates": [-122.3, 47.4]},
                }
            ]
        }

        result = openaip.get_reporting_points(lat=47.0, lon=-122.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["ident"], "LAKER")
        self.assertEqual(result[0]["latitude"], 47.4)
        self.assertEqual(result[0]["longitude"], -122.3)

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_skips_invalid_coordinates(self, mock_request):
        """Test that reporting points with invalid coordinates are skipped."""
        mock_request.return_value = {
            "items": [
                {
                    "_id": "rp123",
                    "identifier": "LAKER",
                    "name": "LAKER",
                    "geometry": {"type": "Point", "coordinates": [-122.3]},  # Only one coord
                }
            ]
        }

        result = openaip.get_reporting_points(lat=47.0, lon=-122.0)

        self.assertEqual(len(result), 0)


class AirspaceTypesTests(TestCase):
    """Tests for airspace type mappings."""

    def test_airspace_types_mapping(self):
        """Test that all expected airspace types are mapped."""
        expected_types = [
            (0, "OTHER"),
            (1, "RESTRICTED"),
            (2, "DANGER"),
            (3, "PROHIBITED"),
            (4, "CTR"),
            (5, "TMZ"),
            (10, "FIR"),
            (14, "MATZ"),
        ]

        for type_id, expected_name in expected_types:
            self.assertEqual(openaip.AIRSPACE_TYPES.get(type_id), expected_name)

    def test_all_airspace_types_are_strings(self):
        """Test that all airspace type values are strings."""
        for type_id, type_name in openaip.AIRSPACE_TYPES.items():
            self.assertIsInstance(type_id, int)
            self.assertIsInstance(type_name, str)


class CachingTests(TestCase):
    """Tests for caching behavior."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_caches_airspace_results(self, mock_request):
        """Test that airspace results are cached."""
        mock_request.return_value = {
            "items": [
                {
                    "_id": "123",
                    "name": "Test",
                    "type": 1,
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
            ]
        }

        # First call - should hit API
        result1 = openaip.get_airspaces(lat=47.0, lon=-122.0)
        self.assertEqual(len(result1), 1)
        self.assertEqual(mock_request.call_count, 1)

        # Second call - should use cache
        result2 = openaip.get_airspaces(lat=47.0, lon=-122.0)
        self.assertEqual(len(result2), 1)
        self.assertEqual(mock_request.call_count, 1)  # Still 1 - cached

    @override_settings(OPENAIP_ENABLED=True, OPENAIP_API_KEY="test_key")
    @patch("skyspy.services.openaip._make_request")
    def test_different_locations_different_cache_keys(self, mock_request):
        """Test that different locations use different cache keys."""
        mock_request.return_value = {"items": []}

        # Call for first location
        openaip.get_airspaces(lat=47.0, lon=-122.0)
        self.assertEqual(mock_request.call_count, 1)

        # Call for second location - should hit API again
        openaip.get_airspaces(lat=45.0, lon=-120.0)
        self.assertEqual(mock_request.call_count, 2)
