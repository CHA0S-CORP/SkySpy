"""
Tests for the geodata service.

Tests geographic data caching and retrieval:
- Airport data fetching and caching
- Navaid data fetching and caching
- GeoJSON boundary data caching
- Location-based queries with distance filtering
- Cache statistics and refresh logic
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase

from skyspy.models import CachedAirport, CachedGeoJSON, CachedNavaid
from skyspy.services import geodata


class HaversineDistanceTests(TestCase):
    """Unit tests for haversine distance calculation."""

    def test_same_point_returns_zero(self):
        """Test that distance between same point is zero."""
        result = geodata.haversine_nm(47.0, -122.0, 47.0, -122.0)
        self.assertAlmostEqual(result, 0.0, places=3)

    def test_known_distance_seattle_portland(self):
        """Test known distance between Seattle and Portland (~126nm)."""
        # Seattle: 47.6062, -122.3321
        # Portland: 45.5152, -122.6784
        result = geodata.haversine_nm(47.6062, -122.3321, 45.5152, -122.6784)
        # Approximately 126 nm (about 145 statute miles)
        self.assertGreater(result, 120)
        self.assertLess(result, 132)

    def test_distance_is_symmetric(self):
        """Test that distance A to B equals distance B to A."""
        dist_ab = geodata.haversine_nm(47.0, -122.0, 48.0, -121.0)
        dist_ba = geodata.haversine_nm(48.0, -121.0, 47.0, -122.0)
        self.assertAlmostEqual(dist_ab, dist_ba, places=5)

    def test_equator_one_degree_longitude(self):
        """Test that 1 degree longitude at equator is approximately 60nm."""
        result = geodata.haversine_nm(0.0, 0.0, 0.0, 1.0)
        # 1 degree at equator is approximately 60 nm
        self.assertGreater(result, 59)
        self.assertLess(result, 61)


class CalculateBboxTests(TestCase):
    """Unit tests for bounding box calculation."""

    def test_point_geometry(self):
        """Test bbox for Point geometry."""
        geometry = {"type": "Point", "coordinates": [-122.0, 47.0]}
        result = geodata.calculate_bbox(geometry)
        # (min_lat, max_lat, min_lon, max_lon)
        self.assertEqual(result, (47.0, 47.0, -122.0, -122.0))

    def test_linestring_geometry(self):
        """Test bbox for LineString geometry."""
        geometry = {
            "type": "LineString",
            "coordinates": [[-122.0, 47.0], [-121.0, 48.0], [-123.0, 46.0]],
        }
        result = geodata.calculate_bbox(geometry)
        self.assertEqual(result, (46.0, 48.0, -123.0, -121.0))

    def test_polygon_geometry(self):
        """Test bbox for Polygon geometry."""
        geometry = {
            "type": "Polygon",
            "coordinates": [[[-122.0, 47.0], [-121.0, 47.0], [-121.0, 48.0], [-122.0, 48.0], [-122.0, 47.0]]],
        }
        result = geodata.calculate_bbox(geometry)
        self.assertEqual(result, (47.0, 48.0, -122.0, -121.0))

    def test_multipolygon_geometry(self):
        """Test bbox for MultiPolygon geometry."""
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[-122.0, 47.0], [-121.0, 47.0], [-121.0, 48.0], [-122.0, 48.0], [-122.0, 47.0]]],
                [[[-125.0, 45.0], [-124.0, 45.0], [-124.0, 46.0], [-125.0, 46.0], [-125.0, 45.0]]],
            ],
        }
        result = geodata.calculate_bbox(geometry)
        self.assertEqual(result, (45.0, 48.0, -125.0, -121.0))

    def test_empty_geometry_returns_zeros(self):
        """Test that empty geometry returns zeros."""
        geometry = {"type": "Point", "coordinates": []}
        result = geodata.calculate_bbox(geometry)
        self.assertEqual(result, (0, 0, 0, 0))

    def test_geometry_collection(self):
        """Test bbox for GeometryCollection."""
        geometry = {
            "type": "GeometryCollection",
            "geometries": [
                {"type": "Point", "coordinates": [-122.0, 47.0]},
                {"type": "Point", "coordinates": [-121.0, 48.0]},
            ],
        }
        result = geodata.calculate_bbox(geometry)
        self.assertEqual(result, (47.0, 48.0, -122.0, -121.0))


class FetchAwcDataTests(TestCase):
    """Tests for AWC API data fetching."""

    @patch("skyspy.services.geodata._http_get_awc")
    def test_fetch_awc_data_success(self, mock_http_get):
        """Test successful AWC data fetch."""
        mock_response = MagicMock()
        mock_response.json.return_value = [{"icaoId": "KSEA", "name": "Seattle-Tacoma"}]
        mock_response.text = '["test"]'
        mock_http_get.return_value = mock_response

        result = geodata.fetch_awc_data("airport", {"bbox": "24,-130,50,-60"})

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        mock_http_get.assert_called_once()

    @patch("skyspy.services.geodata._http_get_awc")
    def test_fetch_awc_data_empty_response(self, mock_http_get):
        """Test AWC data fetch with empty response."""
        mock_response = MagicMock()
        mock_response.text = ""
        mock_http_get.return_value = mock_response

        result = geodata.fetch_awc_data("airport", {})

        self.assertEqual(result, [])

    @patch("skyspy.services.geodata._http_get_awc")
    def test_fetch_awc_data_http_error(self, mock_http_get):
        """Test AWC data fetch with HTTP error."""
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 500
        error = httpx.HTTPStatusError("Server error", request=MagicMock(), response=mock_response)
        mock_http_get.side_effect = error

        result = geodata.fetch_awc_data("airport", {})

        self.assertIsInstance(result, dict)
        self.assertIn("error", result)

    @patch("skyspy.services.geodata._http_get_awc")
    def test_fetch_awc_data_general_exception(self, mock_http_get):
        """Test AWC data fetch with general exception."""
        mock_http_get.side_effect = Exception("Connection failed")

        result = geodata.fetch_awc_data("airport", {})

        self.assertIsInstance(result, dict)
        self.assertIn("error", result)


class FetchGeojsonTests(TestCase):
    """Tests for GeoJSON data fetching."""

    @patch("skyspy.services.geodata._http_get_geojson")
    def test_fetch_geojson_success(self, mock_http_get):
        """Test successful GeoJSON fetch."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {"type": "Point"}}],
        }
        mock_http_get.return_value = mock_response

        result = geodata.fetch_geojson("https://example.com/data.geojson")

        self.assertIsInstance(result, dict)
        self.assertEqual(result["type"], "FeatureCollection")

    @patch("skyspy.services.geodata._http_get_geojson")
    def test_fetch_geojson_failure_returns_none(self, mock_http_get):
        """Test GeoJSON fetch failure returns None."""
        mock_http_get.side_effect = Exception("Network error")

        result = geodata.fetch_geojson("https://example.com/data.geojson")

        self.assertIsNone(result)


class RefreshAirportsTests(TestCase):
    """Tests for airport data refresh."""

    def setUp(self):
        """Clean up airports before each test."""
        CachedAirport.objects.all().delete()

    def tearDown(self):
        """Clean up airports after each test."""
        CachedAirport.objects.all().delete()

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_airports_success(self, mock_fetch):
        """Test successful airport refresh."""
        mock_fetch.return_value = [
            {"icaoId": "KSEA", "name": "Seattle-Tacoma", "lat": 47.4, "lon": -122.3, "type": "large_airport"},
            {"icaoId": "KPDX", "name": "Portland", "lat": 45.5, "lon": -122.5, "type": "large_airport"},
        ]

        count = geodata.refresh_airports()

        self.assertEqual(count, 2)
        self.assertEqual(CachedAirport.objects.count(), 2)
        ksea = CachedAirport.objects.get(icao_id="KSEA")
        self.assertEqual(ksea.name, "Seattle-Tacoma")

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_airports_skips_invalid_icao(self, mock_fetch):
        """Test that invalid ICAO codes are skipped."""
        mock_fetch.return_value = [
            {"icaoId": "KSEA", "name": "Seattle-Tacoma", "lat": 47.4, "lon": -122.3},
            {"icaoId": "XX", "name": "Too Short", "lat": 47.0, "lon": -122.0},  # Invalid
            {"icaoId": "", "name": "Empty", "lat": 47.0, "lon": -122.0},  # Invalid
        ]

        count = geodata.refresh_airports()

        self.assertEqual(count, 1)
        self.assertEqual(CachedAirport.objects.count(), 1)

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_airports_skips_missing_coordinates(self, mock_fetch):
        """Test that airports without coordinates are skipped."""
        mock_fetch.return_value = [
            {"icaoId": "KSEA", "name": "Seattle", "lat": 47.4, "lon": -122.3},
            {"icaoId": "KPDX", "name": "Portland", "lat": None, "lon": -122.5},
            {"icaoId": "KLAX", "name": "Los Angeles", "lat": 33.9, "lon": None},
        ]

        count = geodata.refresh_airports()

        self.assertEqual(count, 1)

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_airports_deduplicates(self, mock_fetch):
        """Test that duplicate ICAOs are deduplicated."""
        mock_fetch.return_value = [
            {"icaoId": "KSEA", "name": "Seattle v1", "lat": 47.4, "lon": -122.3},
            {"icaoId": "KSEA", "name": "Seattle v2", "lat": 47.4, "lon": -122.3},
        ]

        count = geodata.refresh_airports()

        self.assertEqual(count, 1)
        self.assertEqual(CachedAirport.objects.count(), 1)

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_airports_error_returns_zero(self, mock_fetch):
        """Test that API errors return zero."""
        mock_fetch.return_value = {"error": "API unavailable"}

        count = geodata.refresh_airports()

        self.assertEqual(count, 0)


class RefreshNavaidsTests(TestCase):
    """Tests for navaid data refresh."""

    def setUp(self):
        """Clean up navaids before each test."""
        CachedNavaid.objects.all().delete()

    def tearDown(self):
        """Clean up navaids after each test."""
        CachedNavaid.objects.all().delete()

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_navaids_success(self, mock_fetch):
        """Test successful navaid refresh."""
        mock_fetch.return_value = [
            {"id": "SEA", "name": "Seattle VOR", "type": "VOR", "lat": 47.4, "lon": -122.3, "freq": 116.8},
            {"id": "PDX", "name": "Portland VOR", "type": "VORTAC", "lat": 45.5, "lon": -122.5, "freq": 117.2},
        ]

        count = geodata.refresh_navaids()

        self.assertEqual(count, 2)
        self.assertEqual(CachedNavaid.objects.count(), 2)

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_navaids_skips_no_ident(self, mock_fetch):
        """Test that navaids without ident are skipped."""
        mock_fetch.return_value = [
            {"id": "SEA", "name": "Seattle", "lat": 47.4, "lon": -122.3},
            {"id": "", "name": "No ID", "lat": 47.0, "lon": -122.0},
        ]

        count = geodata.refresh_navaids()

        self.assertEqual(count, 1)

    @patch("skyspy.services.geodata.fetch_awc_data")
    def test_refresh_navaids_uses_ident_field(self, mock_fetch):
        """Test that 'ident' field is also accepted."""
        mock_fetch.return_value = [
            {"ident": "SEA", "name": "Seattle", "lat": 47.4, "lon": -122.3},
        ]

        count = geodata.refresh_navaids()

        self.assertEqual(count, 1)


class RefreshGeojsonTests(TestCase):
    """Tests for GeoJSON data refresh."""

    def setUp(self):
        """Clean up GeoJSON before each test."""
        CachedGeoJSON.objects.all().delete()

    def tearDown(self):
        """Clean up GeoJSON after each test."""
        CachedGeoJSON.objects.all().delete()

    @patch("skyspy.services.geodata.fetch_geojson")
    def test_refresh_geojson_feature_collection(self, mock_fetch):
        """Test refresh with FeatureCollection format."""
        mock_fetch.return_value = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"NAME": "Washington", "ISO_A2": "US-WA"},
                    "geometry": {"type": "Polygon", "coordinates": [[[-122, 47], [-121, 47], [-121, 48], [-122, 47]]]},
                }
            ],
        }

        count = geodata.refresh_geojson()

        self.assertGreater(count, 0)

    @patch("skyspy.services.geodata.fetch_geojson")
    def test_refresh_geojson_skips_no_geometry(self, mock_fetch):
        """Test that features without geometry are skipped."""
        mock_fetch.return_value = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"NAME": "No Geometry"}, "geometry": None},
            ],
        }

        count = geodata.refresh_geojson()

        self.assertEqual(count, 0)


class GetCachedAirportsTests(TestCase):
    """Tests for cached airport retrieval."""

    def setUp(self):
        """Set up test airports."""
        CachedAirport.objects.all().delete()
        CachedAirport.objects.create(
            icao_id="KSEA",
            name="Seattle-Tacoma",
            latitude=47.4502,
            longitude=-122.3088,
            elevation_ft=432,
            airport_type="large_airport",
        )
        CachedAirport.objects.create(
            icao_id="KPDX",
            name="Portland",
            latitude=45.5887,
            longitude=-122.5975,
            elevation_ft=30,
            airport_type="large_airport",
        )
        CachedAirport.objects.create(
            icao_id="KLAX",
            name="Los Angeles",
            latitude=33.9425,
            longitude=-118.4081,
            elevation_ft=128,
            airport_type="large_airport",
        )

    def tearDown(self):
        """Clean up test airports."""
        CachedAirport.objects.all().delete()

    def test_get_all_airports(self):
        """Test getting all airports without location filter."""
        result = geodata.get_cached_airports()

        self.assertEqual(len(result), 3)

    def test_get_airports_with_location_filter(self):
        """Test getting airports filtered by location."""
        # Near Seattle
        result = geodata.get_cached_airports(lat=47.0, lon=-122.0, radius_nm=100)

        # Should include KSEA and KPDX but not KLAX
        icao_ids = [r["icaoId"] for r in result]
        self.assertIn("KSEA", icao_ids)
        # KPDX is about 145nm from Seattle, so at 100nm radius it shouldn't be included
        self.assertNotIn("KLAX", icao_ids)

    def test_get_airports_includes_distance(self):
        """Test that distance is included when location is provided."""
        result = geodata.get_cached_airports(lat=47.0, lon=-122.0, radius_nm=100)

        for airport in result:
            self.assertIn("distance_nm", airport)
            self.assertIsInstance(airport["distance_nm"], float)

    def test_get_airports_sorted_by_distance(self):
        """Test that results are sorted by distance."""
        result = geodata.get_cached_airports(lat=47.0, lon=-122.0, radius_nm=200)

        if len(result) > 1:
            for i in range(len(result) - 1):
                self.assertLessEqual(result[i]["distance_nm"], result[i + 1]["distance_nm"])

    def test_get_airports_respects_limit(self):
        """Test that limit parameter is respected."""
        result = geodata.get_cached_airports(limit=2)

        self.assertLessEqual(len(result), 2)


class GetCachedNavaidsTests(TestCase):
    """Tests for cached navaid retrieval."""

    def setUp(self):
        """Set up test navaids."""
        CachedNavaid.objects.all().delete()
        CachedNavaid.objects.create(
            ident="SEA",
            name="Seattle VOR",
            navaid_type="VOR",
            latitude=47.4,
            longitude=-122.3,
            frequency=116.8,
        )
        CachedNavaid.objects.create(
            ident="BTG",
            name="Battleground NDB",
            navaid_type="NDB",
            latitude=45.8,
            longitude=-122.5,
            frequency=326.0,
        )

    def tearDown(self):
        """Clean up test navaids."""
        CachedNavaid.objects.all().delete()

    def test_get_all_navaids(self):
        """Test getting all navaids without filter."""
        result = geodata.get_cached_navaids()

        self.assertEqual(len(result), 2)

    def test_get_navaids_by_type(self):
        """Test filtering navaids by type."""
        result = geodata.get_cached_navaids(navaid_type="VOR")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "VOR")

    def test_get_navaids_with_location_filter(self):
        """Test filtering navaids by location."""
        result = geodata.get_cached_navaids(lat=47.0, lon=-122.0, radius_nm=50)

        icao_ids = [r["id"] for r in result]
        self.assertIn("SEA", icao_ids)


class GetCachedGeojsonTests(TestCase):
    """Tests for cached GeoJSON retrieval."""

    def setUp(self):
        """Set up test GeoJSON."""
        CachedGeoJSON.objects.all().delete()
        CachedGeoJSON.objects.create(
            data_type="states",
            name="Washington",
            code="WA",
            bbox_min_lat=45.0,
            bbox_max_lat=49.0,
            bbox_min_lon=-125.0,
            bbox_max_lon=-116.0,
            geometry={"type": "Polygon", "coordinates": []},
            properties={"NAME": "Washington"},
        )

    def tearDown(self):
        """Clean up test GeoJSON."""
        CachedGeoJSON.objects.all().delete()

    def test_get_geojson_by_type(self):
        """Test getting GeoJSON by data type."""
        result = geodata.get_cached_geojson("states")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["properties"]["name"], "Washington")

    def test_get_geojson_with_location_filter(self):
        """Test filtering GeoJSON by location."""
        # Point inside Washington
        result = geodata.get_cached_geojson("states", lat=47.0, lon=-122.0, radius_nm=100)

        self.assertEqual(len(result), 1)

    def test_get_geojson_returns_feature_format(self):
        """Test that results are in GeoJSON Feature format."""
        result = geodata.get_cached_geojson("states")

        self.assertEqual(result[0]["type"], "Feature")
        self.assertIn("geometry", result[0])
        self.assertIn("properties", result[0])


class CacheStatsTests(TestCase):
    """Tests for cache statistics."""

    def setUp(self):
        """Clean up all cached data."""
        CachedAirport.objects.all().delete()
        CachedNavaid.objects.all().delete()
        CachedGeoJSON.objects.all().delete()

    def tearDown(self):
        """Clean up all cached data."""
        CachedAirport.objects.all().delete()
        CachedNavaid.objects.all().delete()
        CachedGeoJSON.objects.all().delete()

    def test_get_cache_stats_empty(self):
        """Test cache stats with no data."""
        stats = geodata.get_cache_stats()

        self.assertEqual(stats["airports"]["count"], 0)
        self.assertEqual(stats["navaids"]["count"], 0)
        self.assertEqual(stats["geojson"]["count"], 0)
        self.assertIsNone(stats["airports"]["last_refresh"])

    def test_get_cache_stats_with_data(self):
        """Test cache stats with data present."""
        CachedAirport.objects.create(icao_id="KSEA", name="Seattle", latitude=47.4, longitude=-122.3)
        CachedNavaid.objects.create(ident="SEA", name="Seattle VOR", latitude=47.4, longitude=-122.3)

        stats = geodata.get_cache_stats()

        self.assertEqual(stats["airports"]["count"], 1)
        self.assertEqual(stats["navaids"]["count"], 1)
        self.assertIsNotNone(stats["airports"]["last_refresh"])


class ShouldRefreshTests(TestCase):
    """Tests for refresh decision logic."""

    def setUp(self):
        """Clean up all cached data."""
        CachedAirport.objects.all().delete()
        CachedNavaid.objects.all().delete()

    def tearDown(self):
        """Clean up all cached data."""
        CachedAirport.objects.all().delete()
        CachedNavaid.objects.all().delete()

    def test_should_refresh_when_empty(self):
        """Test that refresh is needed when no data exists."""
        result = geodata.should_refresh()

        self.assertTrue(result)

    def test_should_refresh_with_recent_data(self):
        """Test that refresh is not needed with recent data."""
        CachedAirport.objects.create(icao_id="KSEA", name="Seattle", latitude=47.4, longitude=-122.3)
        CachedNavaid.objects.create(ident="SEA", name="Seattle VOR", latitude=47.4, longitude=-122.3)

        result = geodata.should_refresh()

        # Recent data should not need refresh
        self.assertFalse(result)


class RefreshAllGeodataTests(TestCase):
    """Tests for full geodata refresh."""

    def setUp(self):
        """Clean up all cached data."""
        CachedAirport.objects.all().delete()
        CachedNavaid.objects.all().delete()
        CachedGeoJSON.objects.all().delete()

    def tearDown(self):
        """Clean up all cached data."""
        CachedAirport.objects.all().delete()
        CachedNavaid.objects.all().delete()
        CachedGeoJSON.objects.all().delete()

    @patch("skyspy.services.geodata.refresh_geojson")
    @patch("skyspy.services.geodata.refresh_navaids")
    @patch("skyspy.services.geodata.refresh_airports")
    def test_refresh_all_calls_all_refresh_functions(self, mock_airports, mock_navaids, mock_geojson):
        """Test that refresh_all_geodata calls all refresh functions."""
        mock_airports.return_value = 100
        mock_navaids.return_value = 50
        mock_geojson.return_value = 200

        result = geodata.refresh_all_geodata()

        mock_airports.assert_called_once()
        mock_navaids.assert_called_once()
        mock_geojson.assert_called_once()
        self.assertEqual(result["airports"], 100)
        self.assertEqual(result["navaids"], 50)
        self.assertEqual(result["geojson"], 200)
