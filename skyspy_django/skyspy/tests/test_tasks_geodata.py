"""
End-to-end tests for geographic data refresh Celery tasks.

Tests cover:
- refresh_all_geodata: Refresh all geographic data
- refresh_airports: Refresh airport data
- refresh_navaids: Refresh navaid data
- refresh_geojson: Refresh GeoJSON boundaries
- check_and_refresh_geodata: Check freshness and trigger refresh
- cleanup_old_pireps: PIREP retention cleanup
- refresh_pireps: Fetch PIREPs from Aviation Weather Center
- refresh_metars: Fetch METARs from Aviation Weather Center
- refresh_tafs: Fetch TAFs from Aviation Weather Center
- get_geodata_stats: Get cache statistics
- refresh_openflights_data: Refresh airline/aircraft type data
- check_and_refresh_openflights: Check and refresh OpenFlights data
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.tasks.geodata import (
    check_and_refresh_geodata,
    check_and_refresh_openflights,
    cleanup_old_pireps,
    get_geodata_stats,
    refresh_airports,
    refresh_all_geodata,
    refresh_geojson,
    refresh_metars,
    refresh_navaids,
    refresh_openflights_data,
    refresh_pireps,
    refresh_tafs,
)

# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
}


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshAllGeodataTaskTest(TestCase):
    """Tests for the refresh_all_geodata task."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openflights.should_refresh")
    @patch("skyspy.services.geodata.refresh_all_geodata")
    def test_refresh_all_geodata_success(self, mock_refresh, mock_should_refresh, mock_sync_emit):
        """Test successful geographic data refresh."""
        mock_refresh.return_value = {
            "airports": 1000,
            "navaids": 500,
            "geojson": 50,
        }
        mock_should_refresh.return_value = False
        mock_sync_emit.return_value = True

        result = refresh_all_geodata()

        mock_refresh.assert_called_once()
        self.assertEqual(result["airports"], 1000)
        self.assertEqual(result["navaids"], 500)
        self.assertEqual(result["geojson"], 50)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openflights.refresh_all_openflights_data")
    @patch("skyspy.services.openflights.should_refresh")
    @patch("skyspy.services.geodata.refresh_all_geodata")
    def test_refresh_all_geodata_with_openflights(
        self, mock_geodata, mock_should_refresh, mock_openflights, mock_sync_emit
    ):
        """Test that OpenFlights data is refreshed when stale."""
        mock_geodata.return_value = {"airports": 100, "navaids": 50, "geojson": 10}
        mock_should_refresh.return_value = True
        mock_openflights.return_value = {"airlines": 500, "aircraft_types": 300}
        mock_sync_emit.return_value = True

        result = refresh_all_geodata()

        mock_openflights.assert_called_once()
        self.assertEqual(result["airlines"], 500)
        self.assertEqual(result["aircraft_types"], 300)

    @patch("skyspy.services.geodata.refresh_all_geodata")
    def test_refresh_all_geodata_broadcasts_update(self, mock_refresh):
        """Test that WebSocket update is broadcast."""
        mock_refresh.return_value = {"airports": 100, "navaids": 50, "geojson": 10}

        with patch("skyspy.socketio.utils.sync_emit") as mock_emit:
            with patch("skyspy.services.openflights.should_refresh", return_value=False):
                refresh_all_geodata()

            mock_emit.assert_called()
            call_args = mock_emit.call_args
            self.assertEqual(call_args[0][0], "geodata:refresh")

    @patch("skyspy.services.geodata.refresh_all_geodata")
    def test_refresh_all_geodata_retries_on_error(self, mock_refresh):
        """Test that task retries on failure."""
        mock_refresh.side_effect = Exception("Network error")

        with pytest.raises(Exception):
            refresh_all_geodata()


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshAirportsTaskTest(TestCase):
    """Tests for the refresh_airports task."""

    @patch("skyspy.services.geodata.refresh_airports")
    def test_refresh_airports_success(self, mock_refresh):
        """Test successful airport refresh."""
        mock_refresh.return_value = 5000

        result = refresh_airports()

        mock_refresh.assert_called_once()
        self.assertEqual(result, 5000)

    @patch("skyspy.services.geodata.refresh_airports")
    def test_refresh_airports_retries_on_error(self, mock_refresh):
        """Test that task retries on failure."""
        mock_refresh.side_effect = Exception("API error")

        with pytest.raises(Exception):
            refresh_airports()


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshNavaidsTaskTest(TestCase):
    """Tests for the refresh_navaids task."""

    @patch("skyspy.services.geodata.refresh_navaids")
    def test_refresh_navaids_success(self, mock_refresh):
        """Test successful navaid refresh."""
        mock_refresh.return_value = 2000

        result = refresh_navaids()

        mock_refresh.assert_called_once()
        self.assertEqual(result, 2000)

    @patch("skyspy.services.geodata.refresh_navaids")
    def test_refresh_navaids_retries_on_error(self, mock_refresh):
        """Test that task retries on failure."""
        mock_refresh.side_effect = Exception("API error")

        with pytest.raises(Exception):
            refresh_navaids()


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshGeojsonTaskTest(TestCase):
    """Tests for the refresh_geojson task."""

    @patch("skyspy.services.geodata.refresh_geojson")
    def test_refresh_geojson_success(self, mock_refresh):
        """Test successful GeoJSON refresh."""
        mock_refresh.return_value = 150

        result = refresh_geojson()

        mock_refresh.assert_called_once()
        self.assertEqual(result, 150)

    @patch("skyspy.services.geodata.refresh_geojson")
    def test_refresh_geojson_retries_on_error(self, mock_refresh):
        """Test that task retries on failure."""
        mock_refresh.side_effect = Exception("File error")

        with pytest.raises(Exception):
            refresh_geojson()


@override_settings(**CELERY_TEST_SETTINGS)
class CheckAndRefreshGeodataTaskTest(TestCase):
    """Tests for the check_and_refresh_geodata task."""

    @patch("skyspy.tasks.geodata.refresh_openflights_data")
    @patch("skyspy.tasks.geodata.refresh_all_geodata")
    @patch("skyspy.services.openflights.should_refresh")
    @patch("skyspy.services.geodata.should_refresh")
    def test_triggers_refresh_when_stale(self, mock_geo_should, mock_of_should, mock_refresh_geo, mock_refresh_of):
        """Test that refresh is triggered when data is stale."""
        mock_geo_should.return_value = True
        mock_of_should.return_value = False

        result = check_and_refresh_geodata()

        mock_refresh_geo.delay.assert_called_once()
        self.assertTrue(result)

    @patch("skyspy.services.openflights.should_refresh")
    @patch("skyspy.services.geodata.should_refresh")
    def test_no_refresh_when_fresh(self, mock_geo_should, mock_of_should):
        """Test that no refresh is triggered when data is fresh."""
        mock_geo_should.return_value = False
        mock_of_should.return_value = False

        result = check_and_refresh_geodata()

        self.assertFalse(result)

    @patch("skyspy.tasks.geodata.refresh_openflights_data")
    @patch("skyspy.services.openflights.should_refresh")
    @patch("skyspy.services.geodata.should_refresh")
    def test_triggers_openflights_refresh_when_stale(self, mock_geo_should, mock_of_should, mock_refresh_of):
        """Test that OpenFlights refresh is triggered when stale."""
        mock_geo_should.return_value = False
        mock_of_should.return_value = True

        result = check_and_refresh_geodata()

        mock_refresh_of.delay.assert_called_once()
        self.assertTrue(result)

    @patch("skyspy.services.geodata.should_refresh")
    def test_handles_errors(self, mock_should_refresh):
        """Test that errors are handled gracefully."""
        mock_should_refresh.side_effect = Exception("Service error")

        result = check_and_refresh_geodata()

        self.assertFalse(result)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldPirepsTaskTest(TestCase):
    """Tests for the cleanup_old_pireps task."""

    @patch("skyspy.services.weather_cache.cleanup_old_pireps")
    def test_cleanup_pireps_success(self, mock_cleanup):
        """Test successful PIREP cleanup."""
        mock_cleanup.return_value = 50

        result = cleanup_old_pireps(retention_hours=24)

        mock_cleanup.assert_called_once_with(24)
        self.assertEqual(result, 50)

    @patch("skyspy.services.weather_cache.cleanup_old_pireps")
    def test_cleanup_pireps_default_retention(self, mock_cleanup):
        """Test PIREP cleanup with default retention."""
        mock_cleanup.return_value = 0

        cleanup_old_pireps()

        mock_cleanup.assert_called_once_with(24)

    @patch("skyspy.services.weather_cache.cleanup_old_pireps")
    def test_cleanup_pireps_handles_error(self, mock_cleanup):
        """Test that errors are handled gracefully."""
        mock_cleanup.side_effect = Exception("Database error")

        result = cleanup_old_pireps()

        self.assertEqual(result, 0)


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshPirepsTaskTest(TestCase):
    """Tests for the refresh_pireps task."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.weather_cache.fetch_and_store_pireps")
    def test_refresh_pireps_success(self, mock_fetch, mock_sync_emit):
        """Test successful PIREP fetch."""
        mock_fetch.return_value = 100
        mock_sync_emit.return_value = True

        result = refresh_pireps()

        mock_fetch.assert_called_once()
        self.assertEqual(result, 100)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.weather_cache.fetch_and_store_pireps")
    def test_refresh_pireps_broadcasts_update(self, mock_fetch, mock_sync_emit):
        """Test that WebSocket update is broadcast."""
        mock_fetch.return_value = 50

        refresh_pireps()

        mock_sync_emit.assert_called()
        call_args = mock_sync_emit.call_args
        self.assertEqual(call_args[0][0], "pirep:update")
        self.assertEqual(call_args[0][1]["new_count"], 50)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.weather_cache.fetch_and_store_pireps")
    def test_refresh_pireps_no_broadcast_when_zero(self, mock_fetch, mock_sync_emit):
        """Test that no broadcast when zero PIREPs stored."""
        mock_fetch.return_value = 0

        refresh_pireps()

        mock_sync_emit.assert_not_called()

    @patch("skyspy.services.weather_cache.fetch_and_store_pireps")
    def test_refresh_pireps_custom_bbox(self, mock_fetch):
        """Test PIREP fetch with custom bounding box."""
        mock_fetch.return_value = 25

        refresh_pireps(bbox="40,-125,50,-115", hours=3)

        mock_fetch.assert_called_once_with(bbox="40,-125,50,-115", hours=3)

    @patch("skyspy.services.weather_cache.fetch_and_store_pireps")
    def test_refresh_pireps_retries_on_error(self, mock_fetch):
        """Test that task retries on failure."""
        mock_fetch.side_effect = Exception("API error")

        with pytest.raises(Exception):
            refresh_pireps()


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshMetarsTaskTest(TestCase):
    """Tests for the refresh_metars task."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.weather_cache.fetch_and_cache_metars")
    def test_refresh_metars_success(self, mock_fetch, mock_sync_emit):
        """Test successful METAR fetch."""
        mock_fetch.return_value = [{"station_id": "KSEA"}, {"station_id": "KPDX"}]
        mock_sync_emit.return_value = True

        result = refresh_metars()

        mock_fetch.assert_called_once()
        self.assertEqual(result, 2)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.weather_cache.fetch_and_cache_metars")
    def test_refresh_metars_broadcasts_update(self, mock_fetch, mock_sync_emit):
        """Test that WebSocket update is broadcast."""
        mock_fetch.return_value = [{"station_id": "KSEA"}]

        refresh_metars()

        mock_sync_emit.assert_called()
        call_args = mock_sync_emit.call_args
        self.assertEqual(call_args[0][0], "metar:update")

    @patch("skyspy.services.weather_cache.fetch_and_cache_metars")
    def test_refresh_metars_retries_on_error(self, mock_fetch):
        """Test that task retries on failure."""
        mock_fetch.side_effect = Exception("API error")

        with pytest.raises(Exception):
            refresh_metars()


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshTafsTaskTest(TestCase):
    """Tests for the refresh_tafs task."""

    @patch("skyspy.services.weather_cache.fetch_and_cache_tafs")
    def test_refresh_tafs_success(self, mock_fetch):
        """Test successful TAF fetch."""
        mock_fetch.return_value = [{"station_id": "KSEA"}]

        result = refresh_tafs()

        mock_fetch.assert_called_once()
        self.assertEqual(result, 1)

    @patch("skyspy.services.weather_cache.fetch_and_cache_tafs")
    def test_refresh_tafs_custom_bbox(self, mock_fetch):
        """Test TAF fetch with custom bounding box."""
        mock_fetch.return_value = []

        refresh_tafs(bbox="40,-125,50,-115")

        mock_fetch.assert_called_once_with(bbox="40,-125,50,-115")

    @patch("skyspy.services.weather_cache.fetch_and_cache_tafs")
    def test_refresh_tafs_retries_on_error(self, mock_fetch):
        """Test that task retries on failure."""
        mock_fetch.side_effect = Exception("API error")

        with pytest.raises(Exception):
            refresh_tafs()


@override_settings(**CELERY_TEST_SETTINGS)
class GetGeodataStatsTaskTest(TestCase):
    """Tests for the get_geodata_stats task."""

    @patch("skyspy.services.geodata.get_cache_stats")
    def test_get_stats_success(self, mock_get_stats):
        """Test successful stats retrieval."""
        mock_get_stats.return_value = {
            "airports": {"count": 5000, "last_refresh": "2024-01-01T00:00:00Z"},
            "navaids": {"count": 2000, "last_refresh": "2024-01-01T00:00:00Z"},
        }

        result = get_geodata_stats()

        mock_get_stats.assert_called_once()
        self.assertIn("airports", result)
        self.assertIn("navaids", result)

    @patch("skyspy.services.geodata.get_cache_stats")
    def test_get_stats_handles_error(self, mock_get_stats):
        """Test that errors are handled gracefully."""
        mock_get_stats.side_effect = Exception("Service error")

        result = get_geodata_stats()

        self.assertEqual(result, {})


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshOpenflightsDataTaskTest(TestCase):
    """Tests for the refresh_openflights_data task."""

    @patch("skyspy.services.openflights.refresh_all_openflights_data")
    @patch("skyspy.services.openflights.should_refresh")
    def test_refresh_when_stale(self, mock_should_refresh, mock_refresh):
        """Test that data is refreshed when stale."""
        mock_should_refresh.return_value = True
        mock_refresh.return_value = {"airlines": 500, "aircraft_types": 300}

        result = refresh_openflights_data()

        mock_refresh.assert_called_once()
        self.assertEqual(result["airlines"], 500)

    @patch("skyspy.services.openflights.should_refresh")
    def test_skip_when_fresh(self, mock_should_refresh):
        """Test that refresh is skipped when data is fresh."""
        mock_should_refresh.return_value = False

        result = refresh_openflights_data()

        self.assertEqual(result["status"], "skipped")
        self.assertIn("reason", result)

    @patch("skyspy.services.openflights.should_refresh")
    def test_retries_on_error(self, mock_should_refresh):
        """Test that task retries on failure."""
        mock_should_refresh.side_effect = Exception("Service error")

        with pytest.raises(Exception):
            refresh_openflights_data()


@override_settings(**CELERY_TEST_SETTINGS)
class CheckAndRefreshOpenflightsTaskTest(TestCase):
    """Tests for the check_and_refresh_openflights task."""

    @patch("skyspy.tasks.geodata.refresh_openflights_data")
    @patch("skyspy.services.openflights.should_refresh")
    def test_triggers_refresh_when_stale(self, mock_should_refresh, mock_refresh):
        """Test that refresh is triggered when stale."""
        mock_should_refresh.return_value = True

        result = check_and_refresh_openflights()

        mock_refresh.delay.assert_called_once()
        self.assertTrue(result)

    @patch("skyspy.services.openflights.should_refresh")
    def test_no_refresh_when_fresh(self, mock_should_refresh):
        """Test that no refresh is triggered when fresh."""
        mock_should_refresh.return_value = False

        result = check_and_refresh_openflights()

        self.assertFalse(result)

    @patch("skyspy.services.openflights.should_refresh")
    def test_handles_errors(self, mock_should_refresh):
        """Test that errors are handled gracefully."""
        mock_should_refresh.side_effect = Exception("Service error")

        result = check_and_refresh_openflights()

        self.assertFalse(result)


@override_settings(**CELERY_TEST_SETTINGS)
class GeodataTaskSchedulingTest(TestCase):
    """Tests for geodata task scheduling configuration."""

    def test_refresh_all_geodata_is_shared_task(self):
        """Verify refresh_all_geodata is a shared task."""
        self.assertTrue(hasattr(refresh_all_geodata, "delay"))
        self.assertTrue(hasattr(refresh_all_geodata, "apply_async"))

    def test_refresh_airports_is_shared_task(self):
        """Verify refresh_airports is a shared task."""
        self.assertTrue(hasattr(refresh_airports, "delay"))

    def test_refresh_navaids_is_shared_task(self):
        """Verify refresh_navaids is a shared task."""
        self.assertTrue(hasattr(refresh_navaids, "delay"))

    def test_refresh_geojson_is_shared_task(self):
        """Verify refresh_geojson is a shared task."""
        self.assertTrue(hasattr(refresh_geojson, "delay"))

    def test_refresh_pireps_is_shared_task(self):
        """Verify refresh_pireps is a shared task."""
        self.assertTrue(hasattr(refresh_pireps, "delay"))

    def test_refresh_metars_is_shared_task(self):
        """Verify refresh_metars is a shared task."""
        self.assertTrue(hasattr(refresh_metars, "delay"))

    def test_refresh_tafs_is_shared_task(self):
        """Verify refresh_tafs is a shared task."""
        self.assertTrue(hasattr(refresh_tafs, "delay"))


@override_settings(**CELERY_TEST_SETTINGS)
class GeodataTaskRetryBehaviorTest(TestCase):
    """Tests for geodata task retry behavior."""

    def test_refresh_all_geodata_has_retries(self):
        """Verify refresh_all_geodata has retry configuration."""
        self.assertEqual(refresh_all_geodata.max_retries, 3)

    def test_refresh_airports_has_retries(self):
        """Verify refresh_airports has retry configuration."""
        self.assertEqual(refresh_airports.max_retries, 3)

    def test_refresh_pireps_has_retries(self):
        """Verify refresh_pireps has retry configuration."""
        self.assertEqual(refresh_pireps.max_retries, 3)

    def test_refresh_metars_has_retries(self):
        """Verify refresh_metars has retry configuration."""
        self.assertEqual(refresh_metars.max_retries, 3)


@override_settings(**CELERY_TEST_SETTINGS)
class GeodataBroadcastFailureTest(TestCase):
    """Tests for handling broadcast failures in geodata tasks."""

    @patch("skyspy.services.geodata.refresh_all_geodata")
    def test_refresh_all_geodata_handles_broadcast_failure(self, mock_refresh):
        """Test that broadcast failure doesn't break the task."""
        mock_refresh.return_value = {"airports": 100, "navaids": 50, "geojson": 10}

        with patch("skyspy.socketio.utils.sync_emit") as mock_emit:
            mock_emit.side_effect = Exception("Redis unavailable")
            with patch("skyspy.services.openflights.should_refresh", return_value=False):
                result = refresh_all_geodata()

        # Task should still return results
        self.assertEqual(result["airports"], 100)

    @patch("skyspy.services.weather_cache.fetch_and_store_pireps")
    def test_refresh_pireps_handles_broadcast_failure(self, mock_fetch):
        """Test that PIREP broadcast failure doesn't break the task."""
        mock_fetch.return_value = 50

        with patch("skyspy.socketio.utils.sync_emit") as mock_emit:
            mock_emit.side_effect = Exception("Redis unavailable")
            result = refresh_pireps()

        # Task should still return result
        self.assertEqual(result, 50)
