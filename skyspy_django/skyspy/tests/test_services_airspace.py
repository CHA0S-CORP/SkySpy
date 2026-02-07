"""
Tests for the airspace service.

Tests airspace data operations including:
- Active advisories retrieval and filtering
- Airspace boundaries retrieval and filtering
- Location-based filtering
- Advisory history
- Cache management
- Broadcasting functionality
- Statistics
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from skyspy.models import AirspaceAdvisory, AirspaceBoundary
from skyspy.services import airspace


class GetAdvisoriesTests(TestCase):
    """Tests for advisory retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceAdvisory.objects.all().delete()
        cache.clear()

        now = timezone.now()

        # Create active advisory
        AirspaceAdvisory.objects.create(
            advisory_id="GAIRMET_001",
            advisory_type="GAIRMET",
            hazard="TURB",
            severity="moderate",
            valid_from=now - timedelta(hours=1),
            valid_to=now + timedelta(hours=2),
            lower_alt_ft=10000,
            upper_alt_ft=30000,
            region="SFO",
        )

        # Create expired advisory
        AirspaceAdvisory.objects.create(
            advisory_id="GAIRMET_002",
            advisory_type="GAIRMET",
            hazard="IFR",
            valid_from=now - timedelta(hours=5),
            valid_to=now - timedelta(hours=1),  # Expired
            region="SEA",
        )

        # Create future advisory
        AirspaceAdvisory.objects.create(
            advisory_id="SIGMET_001",
            advisory_type="SIGMET",
            hazard="TS",
            valid_from=now + timedelta(hours=1),  # Not yet active
            valid_to=now + timedelta(hours=5),
            region="DEN",
        )

    def tearDown(self):
        """Clean up after tests."""
        AirspaceAdvisory.objects.all().delete()
        cache.clear()

    def test_returns_active_advisories(self):
        """Test that only active advisories are returned."""
        result = airspace.get_advisories()

        # Should only return the active advisory
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["advisory_id"], "GAIRMET_001")

    def test_filters_by_hazard(self):
        """Test filtering by hazard type."""
        result = airspace.get_advisories(hazard="TURB")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["hazard"], "TURB")

    def test_filters_by_advisory_type(self):
        """Test filtering by advisory type."""
        result = airspace.get_advisories(advisory_type="GAIRMET")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["advisory_type"], "GAIRMET")

    def test_returns_empty_for_no_matches(self):
        """Test that empty list is returned for no matches."""
        result = airspace.get_advisories(hazard="VOLCANIC_ASH")

        self.assertEqual(len(result), 0)

    def test_uses_cache_when_no_db_results(self):
        """Test that cache is used when database returns no results."""
        # Clear database
        AirspaceAdvisory.objects.all().delete()

        # Set up cache
        cached_advisories = [{"advisory_id": "CACHED_001", "hazard": "ICE"}]
        cache.set(airspace.ADVISORY_CACHE_KEY, cached_advisories, timeout=600)

        result = airspace.get_advisories()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["advisory_id"], "CACHED_001")

    def test_cache_filtering_by_hazard(self):
        """Test that cached results are filtered by hazard."""
        AirspaceAdvisory.objects.all().delete()

        cached_advisories = [
            {"advisory_id": "CACHED_001", "hazard": "ICE"},
            {"advisory_id": "CACHED_002", "hazard": "TURB"},
        ]
        cache.set(airspace.ADVISORY_CACHE_KEY, cached_advisories, timeout=600)

        result = airspace.get_advisories(hazard="ICE")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["hazard"], "ICE")


class GetBoundariesTests(TestCase):
    """Tests for boundary retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceBoundary.objects.all().delete()
        cache.clear()

        # Create boundaries at different locations
        AirspaceBoundary.objects.create(
            name="Seattle Class B",
            icao="KSEA",
            airspace_class="B",
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=47.4502,
            center_lon=-122.3088,
            radius_nm=30,
        )

        AirspaceBoundary.objects.create(
            name="Portland Class C",
            icao="KPDX",
            airspace_class="C",
            floor_ft=0,
            ceiling_ft=4500,
            center_lat=45.5887,
            center_lon=-122.5975,
            radius_nm=10,
        )

        AirspaceBoundary.objects.create(
            name="Los Angeles Class B",
            icao="KLAX",
            airspace_class="B",
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=33.9425,
            center_lon=-118.4081,
            radius_nm=40,
        )

    def tearDown(self):
        """Clean up after tests."""
        AirspaceBoundary.objects.all().delete()
        cache.clear()

    def test_returns_all_boundaries(self):
        """Test that all boundaries are returned without filter."""
        result = airspace.get_boundaries()

        self.assertEqual(len(result), 3)

    def test_filters_by_class(self):
        """Test filtering by airspace class."""
        result = airspace.get_boundaries(airspace_class="B")

        self.assertEqual(len(result), 2)
        for boundary in result:
            self.assertEqual(boundary["airspace_class"], "B")

    def test_filters_by_location(self):
        """Test filtering by location."""
        # Near Seattle
        result = airspace.get_boundaries(lat=47.0, lon=-122.0, radius_nm=100)

        # Should include Seattle and Portland but not LAX
        names = [b["name"] for b in result]
        self.assertIn("Seattle Class B", names)
        self.assertIn("Portland Class C", names)
        self.assertNotIn("Los Angeles Class B", names)

    def test_uses_cache_when_no_db_results(self):
        """Test that cache is used when database returns no results."""
        AirspaceBoundary.objects.all().delete()

        cached_boundaries = [
            {"name": "Cached Boundary", "airspace_class": "B", "center_lat": 47.0, "center_lon": -122.0}
        ]
        cache.set(airspace.BOUNDARY_CACHE_KEY, cached_boundaries, timeout=600)

        result = airspace.get_boundaries()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Cached Boundary")


class GetAdvisoryHistoryTests(TestCase):
    """Tests for advisory history retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceAdvisory.objects.all().delete()

        now = timezone.now()

        for i in range(5):
            AirspaceAdvisory.objects.create(
                advisory_id=f"HISTORY_{i:03d}",
                advisory_type="GAIRMET",
                hazard="TURB" if i % 2 == 0 else "IFR",
                valid_from=now - timedelta(hours=i * 2),
                valid_to=now - timedelta(hours=i * 2) + timedelta(hours=3),
            )

    def tearDown(self):
        """Clean up after tests."""
        AirspaceAdvisory.objects.all().delete()

    def test_returns_history_in_time_range(self):
        """Test that history within time range is returned."""
        now = timezone.now()
        result = airspace.get_advisory_history(
            start_time=now - timedelta(hours=10),
            end_time=now,
        )

        self.assertGreater(len(result), 0)
        self.assertLessEqual(len(result), 5)

    def test_filters_by_hazard(self):
        """Test filtering history by hazard type."""
        now = timezone.now()
        result = airspace.get_advisory_history(
            start_time=now - timedelta(hours=10),
            hazard="TURB",
        )

        for advisory in result:
            self.assertEqual(advisory["hazard"], "TURB")

    def test_respects_limit(self):
        """Test that limit is respected."""
        now = timezone.now()
        result = airspace.get_advisory_history(
            start_time=now - timedelta(hours=10),
            limit=2,
        )

        self.assertLessEqual(len(result), 2)

    def test_defaults_end_time_to_now(self):
        """Test that end_time defaults to now."""
        now = timezone.now()
        result = airspace.get_advisory_history(
            start_time=now - timedelta(hours=10),
        )

        self.assertIsInstance(result, list)


class GetAirspaceSnapshotTests(TestCase):
    """Tests for airspace snapshot retrieval."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()

        now = timezone.now()

        AirspaceAdvisory.objects.create(
            advisory_id="SNAPSHOT_001",
            advisory_type="GAIRMET",
            hazard="TURB",
            valid_from=now - timedelta(hours=1),
            valid_to=now + timedelta(hours=2),
        )

        AirspaceBoundary.objects.create(
            name="Test Boundary",
            airspace_class="B",
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=47.0,
            center_lon=-122.0,
        )

    def tearDown(self):
        """Clean up after tests."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()

    def test_returns_advisories_and_boundaries(self):
        """Test that snapshot includes both advisories and boundaries."""
        result = airspace.get_airspace_snapshot()

        self.assertIn("advisories", result)
        self.assertIn("boundaries", result)
        self.assertIn("timestamp", result)

    def test_includes_timestamp(self):
        """Test that timestamp is included."""
        result = airspace.get_airspace_snapshot()

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])  # ISO format with Z


class CacheUpdateTests(TestCase):
    """Tests for cache update functions."""

    def setUp(self):
        """Clear cache before tests."""
        cache.clear()

    def tearDown(self):
        """Clear cache after tests."""
        cache.clear()

    def test_update_advisory_cache(self):
        """Test updating advisory cache."""
        advisories = [{"advisory_id": "TEST_001", "hazard": "TURB"}]

        airspace.update_advisory_cache(advisories)

        cached = cache.get(airspace.ADVISORY_CACHE_KEY)
        self.assertEqual(cached, advisories)

    def test_update_boundary_cache(self):
        """Test updating boundary cache."""
        boundaries = [{"name": "Test Boundary", "airspace_class": "B"}]

        airspace.update_boundary_cache(boundaries)

        cached = cache.get(airspace.BOUNDARY_CACHE_KEY)
        self.assertEqual(cached, boundaries)


class BroadcastTests(TestCase):
    """Tests for broadcasting functionality."""

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_advisory_update(self, mock_emit):
        """Test broadcasting advisory update."""
        advisories = [{"advisory_id": "BROADCAST_001"}]

        airspace.broadcast_advisory_update(advisories)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        self.assertEqual(call_args[0][0], "airspace:update")
        self.assertEqual(call_args[0][1]["update_type"], "advisory")
        self.assertEqual(call_args[0][1]["count"], 1)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_boundary_update(self, mock_emit):
        """Test broadcasting boundary update."""
        boundaries = [{"name": "Boundary 1"}, {"name": "Boundary 2"}]

        airspace.broadcast_boundary_update(boundaries)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        self.assertEqual(call_args[0][0], "airspace:update")
        self.assertEqual(call_args[0][1]["update_type"], "boundary")
        self.assertEqual(call_args[0][1]["count"], 2)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_advisory_expired(self, mock_emit):
        """Test broadcasting advisory expiration."""
        advisory_ids = ["EXPIRED_001", "EXPIRED_002"]

        airspace.broadcast_advisory_expired(advisory_ids)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        self.assertEqual(call_args[0][0], "airspace:update")
        self.assertEqual(call_args[0][1]["update_type"], "advisory_expired")
        self.assertEqual(call_args[0][1]["advisory_ids"], advisory_ids)

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_failure_does_not_raise(self, mock_emit):
        """Test that broadcast failures are logged but don't raise."""
        mock_emit.side_effect = Exception("Socket.IO error")

        # Should not raise
        airspace.broadcast_advisory_update([])


class SerializationTests(TestCase):
    """Tests for model serialization."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()

    def test_serialize_advisory(self):
        """Test advisory serialization."""
        now = timezone.now()
        advisory = AirspaceAdvisory.objects.create(
            advisory_id="SERIALIZE_001",
            advisory_type="GAIRMET",
            hazard="TURB",
            severity="moderate",
            valid_from=now,
            valid_to=now + timedelta(hours=3),
            lower_alt_ft=10000,
            upper_alt_ft=30000,
            region="SFO",
            raw_text="Test raw text",
        )

        result = airspace._serialize_advisory(advisory)

        self.assertEqual(result["advisory_id"], "SERIALIZE_001")
        self.assertEqual(result["advisory_type"], "GAIRMET")
        self.assertEqual(result["hazard"], "TURB")
        self.assertEqual(result["severity"], "moderate")
        self.assertEqual(result["lower_alt_ft"], 10000)
        self.assertEqual(result["upper_alt_ft"], 30000)
        self.assertEqual(result["region"], "SFO")
        self.assertEqual(result["raw_text"], "Test raw text")
        self.assertIsNotNone(result["valid_from"])
        self.assertIsNotNone(result["valid_to"])

    def test_serialize_boundary(self):
        """Test boundary serialization."""
        boundary = AirspaceBoundary.objects.create(
            name="Test Boundary",
            icao="KSEA",
            airspace_class="B",
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=47.4502,
            center_lon=-122.3088,
            radius_nm=30,
            controlling_agency="Seattle ARTCC",
            schedule="Continuous",
        )

        result = airspace._serialize_boundary(boundary)

        self.assertEqual(result["name"], "Test Boundary")
        self.assertEqual(result["icao"], "KSEA")
        self.assertEqual(result["airspace_class"], "B")
        self.assertEqual(result["floor_ft"], 0)
        self.assertEqual(result["ceiling_ft"], 10000)
        self.assertEqual(result["center_lat"], 47.4502)
        self.assertEqual(result["center_lon"], -122.3088)
        self.assertEqual(result["radius_nm"], 30)
        self.assertEqual(result["controlling_agency"], "Seattle ARTCC")
        self.assertEqual(result["schedule"], "Continuous")

    def test_serialize_boundary_with_polygon(self):
        """Test boundary serialization with polygon."""
        polygon_data = {
            "type": "Polygon",
            "coordinates": [[[-122, 47], [-121, 47], [-121, 48], [-122, 48], [-122, 47]]],
        }
        boundary = AirspaceBoundary.objects.create(
            name="Polygon Boundary",
            airspace_class="MOA",
            floor_ft=5000,
            ceiling_ft=18000,
            center_lat=47.5,
            center_lon=-121.5,
            polygon=polygon_data,
        )

        result = airspace._serialize_boundary(boundary)

        self.assertIsNotNone(result["polygon"])

    def test_serialize_boundary_with_list_polygon(self):
        """Test boundary serialization with list-format polygon."""
        polygon_list = [[-122, 47], [-121, 47], [-121, 48], [-122, 48], [-122, 47]]
        boundary = AirspaceBoundary.objects.create(
            name="List Polygon Boundary",
            airspace_class="MOA",
            floor_ft=5000,
            ceiling_ft=18000,
            center_lat=47.5,
            center_lon=-121.5,
            polygon=polygon_list,
        )

        result = airspace._serialize_boundary(boundary)

        self.assertEqual(result["polygon"], polygon_list)


class GetAirspaceStatsTests(TestCase):
    """Tests for airspace statistics."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()

        now = timezone.now()

        # Create active advisories
        AirspaceAdvisory.objects.create(
            advisory_id="STATS_001",
            advisory_type="GAIRMET",
            hazard="TURB",
            valid_from=now - timedelta(hours=1),
            valid_to=now + timedelta(hours=2),
        )
        AirspaceAdvisory.objects.create(
            advisory_id="STATS_002",
            advisory_type="GAIRMET",
            hazard="TURB",
            valid_from=now - timedelta(hours=1),
            valid_to=now + timedelta(hours=2),
        )
        AirspaceAdvisory.objects.create(
            advisory_id="STATS_003",
            advisory_type="SIGMET",
            hazard="IFR",
            valid_from=now - timedelta(hours=1),
            valid_to=now + timedelta(hours=2),
        )

        # Create expired advisory (should not count as active)
        AirspaceAdvisory.objects.create(
            advisory_id="STATS_004",
            advisory_type="GAIRMET",
            hazard="ICE",
            valid_from=now - timedelta(hours=5),
            valid_to=now - timedelta(hours=1),
        )

        # Create boundaries
        AirspaceBoundary.objects.create(
            name="Class B 1",
            airspace_class="B",
            center_lat=47.0,
            center_lon=-122.0,
        )
        AirspaceBoundary.objects.create(
            name="Class B 2",
            airspace_class="B",
            center_lat=45.0,
            center_lon=-122.0,
        )
        AirspaceBoundary.objects.create(
            name="Class C 1",
            airspace_class="C",
            center_lat=46.0,
            center_lon=-122.0,
        )

    def tearDown(self):
        """Clean up after tests."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()

    def test_returns_active_advisory_count(self):
        """Test that active advisory count is correct."""
        stats = airspace.get_airspace_stats()

        self.assertEqual(stats["active_advisories"], 3)

    def test_returns_total_counts(self):
        """Test that total counts are returned."""
        stats = airspace.get_airspace_stats()

        self.assertEqual(stats["total_advisories"], 4)
        self.assertEqual(stats["total_boundaries"], 3)

    def test_returns_advisories_by_hazard(self):
        """Test that advisory counts by hazard are returned."""
        stats = airspace.get_airspace_stats()

        self.assertEqual(stats["advisories_by_hazard"]["TURB"], 2)
        self.assertEqual(stats["advisories_by_hazard"]["IFR"], 1)

    def test_returns_boundaries_by_class(self):
        """Test that boundary counts by class are returned."""
        stats = airspace.get_airspace_stats()

        self.assertEqual(stats["boundaries_by_class"]["B"], 2)
        self.assertEqual(stats["boundaries_by_class"]["C"], 1)

    def test_includes_timestamp(self):
        """Test that timestamp is included."""
        stats = airspace.get_airspace_stats()

        self.assertIn("timestamp", stats)
        self.assertIn("Z", stats["timestamp"])


class LocationFilteringTests(TestCase):
    """Tests for location-based filtering calculations."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceBoundary.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AirspaceBoundary.objects.all().delete()

    def test_latitude_longitude_range_calculation(self):
        """Test that lat/lon range is calculated correctly for filtering."""
        # Create boundary at known location
        AirspaceBoundary.objects.create(
            name="Test Boundary",
            airspace_class="B",
            center_lat=47.0,
            center_lon=-122.0,
        )

        # Query with small radius - should find it
        result = airspace.get_boundaries(lat=47.0, lon=-122.0, radius_nm=10)
        self.assertEqual(len(result), 1)

        # Query with larger offset but within radius
        result = airspace.get_boundaries(lat=47.5, lon=-122.0, radius_nm=50)
        self.assertEqual(len(result), 1)

    def test_excludes_distant_boundaries(self):
        """Test that distant boundaries are excluded."""
        AirspaceBoundary.objects.create(
            name="Distant Boundary",
            airspace_class="B",
            center_lat=33.0,  # Far south
            center_lon=-118.0,  # Far west
        )

        result = airspace.get_boundaries(lat=47.0, lon=-122.0, radius_nm=100)
        self.assertEqual(len(result), 0)


class EdgeCaseTests(TestCase):
    """Edge case tests for airspace service."""

    def setUp(self):
        """Clean up before tests."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        AirspaceAdvisory.objects.all().delete()
        AirspaceBoundary.objects.all().delete()
        cache.clear()

    def test_empty_database_returns_empty_lists(self):
        """Test that empty database returns empty lists."""
        advisories = airspace.get_advisories()
        boundaries = airspace.get_boundaries()

        self.assertEqual(advisories, [])
        self.assertEqual(boundaries, [])

    def test_handles_none_polygon(self):
        """Test handling of None polygon in boundary."""
        boundary = AirspaceBoundary.objects.create(
            name="No Polygon",
            airspace_class="B",
            center_lat=47.0,
            center_lon=-122.0,
            polygon=None,
        )

        result = airspace._serialize_boundary(boundary)

        self.assertIsNone(result["polygon"])

    def test_handles_none_valid_times(self):
        """Test handling of None valid times in advisory."""
        advisory = AirspaceAdvisory.objects.create(
            advisory_id="NO_TIMES",
            advisory_type="GAIRMET",
            valid_from=None,
            valid_to=None,
        )

        result = airspace._serialize_advisory(advisory)

        self.assertIsNone(result["valid_from"])
        self.assertIsNone(result["valid_to"])
