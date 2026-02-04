"""
End-to-end tests for OpenAIP data refresh Celery tasks.

Tests cover:
- refresh_openaip_data: Refresh global airspace data from OpenAIP
- prefetch_openaip_airspaces: Prefetch airspaces for specific region
- get_openaip_stats: Get API status and statistics
"""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.tasks.openaip import (
    get_openaip_stats,
    prefetch_openaip_airspaces,
    refresh_openaip_data,
)

# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
}


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshOpenaipDataTaskTest(TestCase):
    """Tests for the refresh_openaip_data task."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_success(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test successful OpenAIP data refresh."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True, "api_key_set": True}
        mock_airspaces.return_value = [{"id": 1}, {"id": 2}]
        mock_airports.return_value = [{"id": 1}]
        mock_navaids.return_value = [{"id": 1}, {"id": 2}, {"id": 3}]
        mock_emit.return_value = True

        result = refresh_openaip_data()

        self.assertEqual(result["status"], "complete")
        self.assertGreater(result["airspaces"], 0)
        self.assertGreater(result["airports"], 0)
        self.assertGreater(result["navaids"], 0)

    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_disabled(self, mock_enabled):
        """Test that task skips when OpenAIP is disabled."""
        mock_enabled.return_value = False

        result = refresh_openaip_data()

        self.assertEqual(result["status"], "disabled")

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_prefetches_multiple_regions(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that multiple regions are prefetched."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = [{"id": 1}]
        mock_airports.return_value = [{"id": 1}]
        mock_navaids.return_value = [{"id": 1}]
        mock_emit.return_value = True

        refresh_openaip_data()

        # Should be called for each region (9 regions defined in task)
        self.assertEqual(mock_airspaces.call_count, 9)
        self.assertEqual(mock_airports.call_count, 9)
        self.assertEqual(mock_navaids.call_count, 9)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_continues_on_region_error(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that errors in one region don't stop processing."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        # First call fails, rest succeed
        mock_airspaces.side_effect = [
            Exception("Region 1 error"),
            [{"id": 1}],
            [{"id": 2}],
            [{"id": 3}],
            [{"id": 4}],
            [{"id": 5}],
            [{"id": 6}],
            [{"id": 7}],
            [{"id": 8}],
        ]
        mock_airports.return_value = [{"id": 1}]
        mock_navaids.return_value = [{"id": 1}]
        mock_emit.return_value = True

        result = refresh_openaip_data()

        # Should still complete with partial results
        self.assertEqual(result["status"], "complete")
        # 8 successful regions * 1 airspace each
        self.assertEqual(result["airspaces"], 8)

    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_retries_on_error(self, mock_enabled, mock_status):
        """Test that task retries on failure."""
        mock_enabled.return_value = True
        mock_status.side_effect = Exception("API error")

        with pytest.raises(Exception):
            refresh_openaip_data()

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_broadcasts_update(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that WebSocket update is broadcast."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        refresh_openaip_data()

        mock_emit.assert_called()
        call_args = mock_emit.call_args
        self.assertEqual(call_args[0][0], "openaip:refresh")
        self.assertEqual(call_args[0][1]["status"], "complete")

    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_refresh_openaip_handles_broadcast_failure(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids
    ):
        """Test that broadcast failure doesn't break the task."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        with patch("skyspy.socketio.utils.sync_emit") as mock_emit:
            mock_emit.side_effect = Exception("Redis unavailable")
            result = refresh_openaip_data()

        # Task should still return results
        self.assertEqual(result["status"], "complete")


@override_settings(**CELERY_TEST_SETTINGS)
class PrefetchOpenaipAirspacesTaskTest(TestCase):
    """Tests for the prefetch_openaip_airspaces task."""

    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip._is_enabled")
    def test_prefetch_airspaces_success(self, mock_enabled, mock_get):
        """Test successful airspace prefetch."""
        mock_enabled.return_value = True
        mock_get.return_value = [
            {"id": 1, "name": "Airspace 1"},
            {"id": 2, "name": "Airspace 2"},
        ]

        result = prefetch_openaip_airspaces(47.5, -122.0, 100)

        mock_get.assert_called_once_with(47.5, -122.0, 100)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["count"], 2)

    @patch("skyspy.services.openaip._is_enabled")
    def test_prefetch_airspaces_disabled(self, mock_enabled):
        """Test that task returns disabled status when not enabled."""
        mock_enabled.return_value = False

        result = prefetch_openaip_airspaces(47.5, -122.0)

        self.assertEqual(result["status"], "disabled")

    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip._is_enabled")
    def test_prefetch_airspaces_default_radius(self, mock_enabled, mock_get):
        """Test that default radius of 200nm is used."""
        mock_enabled.return_value = True
        mock_get.return_value = []

        prefetch_openaip_airspaces(47.5, -122.0)

        mock_get.assert_called_once_with(47.5, -122.0, 200)

    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip._is_enabled")
    def test_prefetch_airspaces_error_handling(self, mock_enabled, mock_get):
        """Test error handling in prefetch."""
        mock_enabled.return_value = True
        mock_get.side_effect = Exception("API error")

        result = prefetch_openaip_airspaces(47.5, -122.0)

        self.assertEqual(result["status"], "error")
        self.assertIn("API error", result["error"])


@override_settings(**CELERY_TEST_SETTINGS)
class GetOpenaipStatsTaskTest(TestCase):
    """Tests for the get_openaip_stats task."""

    @patch("skyspy.services.openaip.get_api_status")
    def test_get_stats_success(self, mock_status):
        """Test successful stats retrieval."""
        mock_status.return_value = {
            "enabled": True,
            "api_key_set": True,
            "requests_today": 100,
            "rate_limit_remaining": 900,
        }

        result = get_openaip_stats()

        mock_status.assert_called_once()
        self.assertTrue(result["enabled"])
        self.assertEqual(result["requests_today"], 100)

    @patch("skyspy.services.openaip.get_api_status")
    def test_get_stats_error_handling(self, mock_status):
        """Test error handling in stats retrieval."""
        mock_status.side_effect = Exception("Service unavailable")

        result = get_openaip_stats()

        self.assertIn("error", result)
        self.assertIn("Service unavailable", result["error"])


@override_settings(**CELERY_TEST_SETTINGS)
class OpenaipTaskSchedulingTest(TestCase):
    """Tests for OpenAIP task scheduling configuration."""

    def test_refresh_openaip_data_is_shared_task(self):
        """Verify refresh_openaip_data is a shared task."""
        self.assertTrue(hasattr(refresh_openaip_data, "delay"))
        self.assertTrue(hasattr(refresh_openaip_data, "apply_async"))

    def test_prefetch_openaip_airspaces_is_shared_task(self):
        """Verify prefetch_openaip_airspaces is a shared task."""
        self.assertTrue(hasattr(prefetch_openaip_airspaces, "delay"))

    def test_get_openaip_stats_is_shared_task(self):
        """Verify get_openaip_stats is a shared task."""
        self.assertTrue(hasattr(get_openaip_stats, "delay"))


@override_settings(**CELERY_TEST_SETTINGS)
class OpenaipTaskRetryBehaviorTest(TestCase):
    """Tests for OpenAIP task retry behavior."""

    def test_refresh_openaip_data_has_retries(self):
        """Verify refresh_openaip_data has retry configuration."""
        self.assertEqual(refresh_openaip_data.max_retries, 3)


@override_settings(**CELERY_TEST_SETTINGS)
class OpenaipRegionCoverageTest(TestCase):
    """Tests for regional coverage in OpenAIP tasks."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_covers_west_coast(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that West Coast regions are covered."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        refresh_openaip_data()

        # Check that California and Pacific Northwest are in the calls
        all_calls = mock_airspaces.call_args_list
        latitudes = [call[0][0] for call in all_calls]

        # Should include California (37.0) and Pacific Northwest (47.0)
        self.assertIn(37.0, latitudes)
        self.assertIn(47.0, latitudes)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_covers_east_coast(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that East Coast regions are covered."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        refresh_openaip_data()

        # Check that Northeast is in the calls
        all_calls = mock_airspaces.call_args_list
        coordinates = [(call[0][0], call[0][1]) for call in all_calls]

        # Should include Northeast (40.0, -75.0)
        self.assertIn((40.0, -75.0), coordinates)

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_covers_florida(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that Florida is covered."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        refresh_openaip_data()

        # Check that Florida is in the calls
        all_calls = mock_airspaces.call_args_list
        coordinates = [(call[0][0], call[0][1]) for call in all_calls]

        # Should include Florida (28.0, -82.0)
        self.assertIn((28.0, -82.0), coordinates)


@override_settings(**CELERY_TEST_SETTINGS)
class OpenaipRadiusConfigTest(TestCase):
    """Tests for radius configuration in OpenAIP tasks."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_uses_200nm_radius(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that 200nm radius is used for prefetch."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        refresh_openaip_data()

        # All calls should use 200nm radius
        for call in mock_airspaces.call_args_list:
            self.assertEqual(call[0][2], 200)


@override_settings(**CELERY_TEST_SETTINGS)
class OpenaipApiStatusTest(TestCase):
    """Tests for API status checking in OpenAIP tasks."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_logs_api_status(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that API status is retrieved and logged."""
        mock_enabled.return_value = True
        mock_status.return_value = {
            "enabled": True,
            "api_key_set": True,
            "rate_limit": 1000,
        }
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        refresh_openaip_data()

        mock_status.assert_called_once()


@override_settings(**CELERY_TEST_SETTINGS)
class OpenaipEmptyResultsTest(TestCase):
    """Tests for handling empty results from OpenAIP."""

    @patch("skyspy.socketio.utils.sync_emit")
    @patch("skyspy.services.openaip.get_navaids")
    @patch("skyspy.services.openaip.get_airports")
    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip.get_api_status")
    @patch("skyspy.services.openaip._is_enabled")
    def test_handles_empty_results(
        self, mock_enabled, mock_status, mock_airspaces, mock_airports, mock_navaids, mock_emit
    ):
        """Test that empty results are handled gracefully."""
        mock_enabled.return_value = True
        mock_status.return_value = {"enabled": True}
        mock_airspaces.return_value = []
        mock_airports.return_value = []
        mock_navaids.return_value = []

        result = refresh_openaip_data()

        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["airspaces"], 0)
        self.assertEqual(result["airports"], 0)
        self.assertEqual(result["navaids"], 0)

    @patch("skyspy.services.openaip.get_airspaces")
    @patch("skyspy.services.openaip._is_enabled")
    def test_prefetch_handles_empty_results(self, mock_enabled, mock_get):
        """Test that prefetch handles empty results."""
        mock_enabled.return_value = True
        mock_get.return_value = []

        result = prefetch_openaip_airspaces(47.5, -122.0)

        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["count"], 0)
