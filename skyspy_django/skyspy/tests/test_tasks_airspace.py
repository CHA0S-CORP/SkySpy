"""
End-to-end tests for airspace-related Celery tasks.

Tests cover:
- refresh_airspace_advisories: Fetching G-AIRMETs, SIGMETs from Aviation Weather Center
- refresh_airspace_boundaries: Refreshing static Class B/C/D airspace boundaries
"""
import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, Mock

from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import AirspaceAdvisory, AirspaceBoundary
from skyspy.tasks.airspace import (
    refresh_airspace_advisories,
    refresh_airspace_boundaries,
)


# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': True,
}


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshAirspaceAdvisoriesTaskTest(TestCase):
    """Tests for the refresh_airspace_advisories task."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceAdvisory.objects.all().delete()

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_success(self, mock_httpx_get, mock_get_channel_layer):
        """Test successful advisory refresh."""
        # Mock httpx response with G-AIRMET data
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                'gairmetId': 'GAIRMET-IFR-001',
                'hazard': 'IFR',
                'severity': 'moderate',
                'validTimeFrom': '2024-01-01T12:00:00Z',
                'validTimeTo': '2024-01-01T18:00:00Z',
                'altitudeLow1': 0,
                'altitudeHi1': 10000,
                'region': 'SFO',
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': [[[-122.0, 37.0], [-122.0, 38.0], [-121.0, 38.0], [-121.0, 37.0], [-122.0, 37.0]]]
                },
                'rawAirSigmet': 'IFR CONDS EXPCD...',
            },
            {
                'airSigmetId': 'SIGMET-TURB-001',
                'hazard': 'TURB',
                'severity': 'severe',
                'validTimeFrom': '2024-01-01T14:00:00Z',
                'validTimeTo': '2024-01-01T20:00:00Z',
                'altitudeLow1': 20000,
                'altitudeHi1': 40000,
                'region': 'ZOA',
            },
        ]
        mock_httpx_get.return_value = mock_response

        # Mock channel layer
        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        # Execute task
        refresh_airspace_advisories()

        # Verify advisories were created
        self.assertEqual(AirspaceAdvisory.objects.count(), 2)

        # Verify G-AIRMET details
        gairmet = AirspaceAdvisory.objects.get(advisory_id='GAIRMET-IFR-001')
        self.assertEqual(gairmet.hazard, 'IFR')
        self.assertEqual(gairmet.severity, 'moderate')
        self.assertEqual(gairmet.lower_alt_ft, 0)
        self.assertEqual(gairmet.upper_alt_ft, 10000)
        self.assertEqual(gairmet.region, 'SFO')
        self.assertIsNotNone(gairmet.polygon)
        self.assertEqual(gairmet.polygon['type'], 'Polygon')

        # Verify SIGMET details
        sigmet = AirspaceAdvisory.objects.get(advisory_id='SIGMET-TURB-001')
        self.assertEqual(sigmet.hazard, 'TURB')
        self.assertEqual(sigmet.severity, 'severe')

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_updates_existing(self, mock_httpx_get, mock_get_channel_layer):
        """Test that existing advisories are updated, not duplicated."""
        # Create existing advisory
        AirspaceAdvisory.objects.create(
            advisory_id='GAIRMET-IFR-001',
            advisory_type='GAIRMET',
            hazard='IFR',
            severity='light',  # Will be updated
            region='SFO',
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                'gairmetId': 'GAIRMET-IFR-001',
                'hazard': 'IFR',
                'severity': 'moderate',  # Updated severity
                'region': 'SFO',
            },
        ]
        mock_httpx_get.return_value = mock_response
        mock_get_channel_layer.return_value = MagicMock()

        refresh_airspace_advisories()

        # Should still be 1 advisory, not 2
        self.assertEqual(AirspaceAdvisory.objects.count(), 1)

        # Verify severity was updated
        advisory = AirspaceAdvisory.objects.get(advisory_id='GAIRMET-IFR-001')
        self.assertEqual(advisory.severity, 'moderate')

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_deletes_expired(self, mock_httpx_get, mock_get_channel_layer):
        """Test that expired advisories are deleted."""
        now = timezone.now()

        # Create expired advisory (valid_to in the past)
        expired = AirspaceAdvisory.objects.create(
            advisory_id='GAIRMET-OLD-001',
            advisory_type='GAIRMET',
            hazard='IFR',
            valid_to=now - timedelta(hours=2),  # Expired
        )

        # Create current advisory
        current = AirspaceAdvisory.objects.create(
            advisory_id='GAIRMET-CURRENT-001',
            advisory_type='GAIRMET',
            hazard='TURB',
            valid_to=now + timedelta(hours=2),  # Still valid
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []  # Empty response
        mock_httpx_get.return_value = mock_response
        mock_get_channel_layer.return_value = MagicMock()

        refresh_airspace_advisories()

        # Expired advisory should be deleted
        self.assertFalse(AirspaceAdvisory.objects.filter(advisory_id='GAIRMET-OLD-001').exists())
        # Current advisory should remain
        self.assertTrue(AirspaceAdvisory.objects.filter(advisory_id='GAIRMET-CURRENT-001').exists())

    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_http_error(self, mock_httpx_get):
        """Test handling of HTTP errors."""
        import httpx
        mock_httpx_get.side_effect = httpx.HTTPError("Connection refused")

        # Task should complete without raising
        refresh_airspace_advisories()

    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_non_200_response(self, mock_httpx_get):
        """Test handling of non-200 HTTP response."""
        mock_response = MagicMock()
        mock_response.status_code = 503
        mock_httpx_get.return_value = mock_response

        # Task should complete without raising
        refresh_airspace_advisories()

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_skips_invalid_advisory(self, mock_httpx_get, mock_get_channel_layer):
        """Test that advisories without ID are skipped."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                # No gairmetId or airSigmetId
                'hazard': 'IFR',
                'severity': 'light',
            },
            {
                'gairmetId': 'GAIRMET-VALID-001',
                'hazard': 'TURB',
            },
        ]
        mock_httpx_get.return_value = mock_response
        mock_get_channel_layer.return_value = MagicMock()

        refresh_airspace_advisories()

        # Only the valid advisory should be created
        self.assertEqual(AirspaceAdvisory.objects.count(), 1)
        self.assertTrue(AirspaceAdvisory.objects.filter(advisory_id='GAIRMET-VALID-001').exists())

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_handles_invalid_dates(self, mock_httpx_get, mock_get_channel_layer):
        """Test handling of invalid date formats in advisory data."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                'gairmetId': 'GAIRMET-BADDATE-001',
                'hazard': 'IFR',
                'validTimeFrom': 'invalid-date',
                'validTimeTo': 'also-invalid',
            },
        ]
        mock_httpx_get.return_value = mock_response
        mock_get_channel_layer.return_value = MagicMock()

        # Should not raise
        refresh_airspace_advisories()

        # Advisory should be created with null dates
        advisory = AirspaceAdvisory.objects.get(advisory_id='GAIRMET-BADDATE-001')
        self.assertIsNone(advisory.valid_from)
        self.assertIsNone(advisory.valid_to)

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_broadcasts_update(self, mock_httpx_get, mock_get_channel_layer):
        """Test that WebSocket update is broadcast on success."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {'gairmetId': 'GAIRMET-001', 'hazard': 'IFR'},
        ]
        mock_httpx_get.return_value = mock_response

        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        refresh_airspace_advisories()

        # Verify broadcast was called
        mock_channel_layer.group_send.assert_called()
        call_args = mock_channel_layer.group_send.call_args
        self.assertEqual(call_args[0][0], 'airspace_advisories')

    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.tasks.airspace.httpx.get')
    def test_refresh_advisories_handles_broadcast_failure(self, mock_httpx_get, mock_get_channel_layer):
        """Test that broadcast failure doesn't break the task."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {'gairmetId': 'GAIRMET-001', 'hazard': 'IFR'},
        ]
        mock_httpx_get.return_value = mock_response

        # Make broadcast fail
        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send.side_effect = Exception("Redis unavailable")
        mock_get_channel_layer.return_value = mock_channel_layer

        # Task should complete without raising
        refresh_airspace_advisories()

        # Advisory should still be created
        self.assertEqual(AirspaceAdvisory.objects.count(), 1)


@override_settings(**CELERY_TEST_SETTINGS)
class RefreshAirspaceBoundariesTaskTest(TestCase):
    """Tests for the refresh_airspace_boundaries task."""

    def setUp(self):
        """Set up test fixtures."""
        AirspaceBoundary.objects.all().delete()

    @patch('skyspy.tasks.airspace.get_channel_layer')
    def test_refresh_boundaries_success(self, mock_get_channel_layer):
        """Test successful boundary refresh."""
        # Create some boundaries
        AirspaceBoundary.objects.create(
            name='Seattle Class B',
            icao='KSEA',
            airspace_class='B',
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=47.4502,
            center_lon=-122.3088,
            radius_nm=30.0,
            source='faa',
        )
        AirspaceBoundary.objects.create(
            name='Boeing Field Class D',
            icao='KBFI',
            airspace_class='D',
            floor_ft=0,
            ceiling_ft=2500,
            center_lat=47.5299,
            center_lon=-122.3020,
            radius_nm=4.3,
            source='faa',
        )

        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        # Execute task
        refresh_airspace_boundaries()

        # Verify boundaries still exist (task just logs count)
        self.assertEqual(AirspaceBoundary.objects.count(), 2)

    @patch('skyspy.tasks.airspace.get_channel_layer')
    def test_refresh_boundaries_empty_database(self, mock_get_channel_layer):
        """Test boundary refresh with empty database."""
        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        # Task should complete without error
        refresh_airspace_boundaries()

    @patch('skyspy.tasks.airspace.sync_group_send')
    @patch('skyspy.tasks.airspace.get_channel_layer')
    @patch('skyspy.services.openaip._is_enabled')
    @patch('skyspy.services.openaip.get_airspaces')
    def test_refresh_boundaries_broadcasts_update(
        self, mock_get_airspaces, mock_is_enabled, mock_get_channel_layer, mock_sync_group_send
    ):
        """Test that WebSocket update is broadcast."""
        mock_is_enabled.return_value = True
        mock_get_airspaces.return_value = []  # Empty list is OK for this test
        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        refresh_airspace_boundaries()

        # Verify broadcast was called
        mock_sync_group_send.assert_called()
        call_args = mock_sync_group_send.call_args
        self.assertEqual(call_args[0][1], 'airspace_boundaries')

    @patch('skyspy.tasks.airspace.get_channel_layer')
    def test_refresh_boundaries_handles_broadcast_failure(self, mock_get_channel_layer):
        """Test that broadcast failure doesn't break the task."""
        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send.side_effect = Exception("Redis unavailable")
        mock_get_channel_layer.return_value = mock_channel_layer

        # Task should complete without raising
        refresh_airspace_boundaries()


@override_settings(**CELERY_TEST_SETTINGS)
class AirspaceTaskSchedulingTest(TestCase):
    """Tests for airspace task scheduling configuration."""

    def test_refresh_advisories_is_shared_task(self):
        """Verify refresh_airspace_advisories is a shared task."""
        self.assertTrue(hasattr(refresh_airspace_advisories, 'delay'))
        self.assertTrue(hasattr(refresh_airspace_advisories, 'apply_async'))

    def test_refresh_boundaries_is_shared_task(self):
        """Verify refresh_airspace_boundaries is a shared task."""
        self.assertTrue(hasattr(refresh_airspace_boundaries, 'delay'))
        self.assertTrue(hasattr(refresh_airspace_boundaries, 'apply_async'))


class AirspaceTaskAtomicityTest(TestCase):
    """Tests for database transaction atomicity in airspace tasks."""

    def test_refresh_advisories_uses_atomic(self):
        """Verify refresh_airspace_advisories uses atomic transactions."""
        import inspect
        source = inspect.getsource(refresh_airspace_advisories)
        self.assertIn('transaction.atomic', source)


@override_settings(**CELERY_TEST_SETTINGS)
class AirspaceAdvisoryModelTest(TestCase):
    """Tests for AirspaceAdvisory model used in tasks."""

    def test_advisory_types_supported(self):
        """Test that all advisory types can be stored."""
        advisory_types = ['GAIRMET', 'SIGMET', 'CONVECTIVE_SIGMET', 'CWA', 'AIRMET']

        for adv_type in advisory_types:
            AirspaceAdvisory.objects.create(
                advisory_id=f'TEST-{adv_type}',
                advisory_type=adv_type,
                hazard='IFR',
            )

        self.assertEqual(AirspaceAdvisory.objects.count(), 5)

    def test_hazard_types_supported(self):
        """Test that all hazard types can be stored."""
        hazard_types = ['IFR', 'TURB', 'TURB-LO', 'TURB-HI', 'ICE', 'MT_OBSC', 'SFC_WND', 'LLWS', 'TS']

        for i, hazard in enumerate(hazard_types):
            AirspaceAdvisory.objects.create(
                advisory_id=f'TEST-{i}',
                advisory_type='GAIRMET',
                hazard=hazard,
            )

        self.assertEqual(AirspaceAdvisory.objects.count(), len(hazard_types))


@override_settings(**CELERY_TEST_SETTINGS)
class AirspaceBoundaryModelTest(TestCase):
    """Tests for AirspaceBoundary model used in tasks."""

    def test_airspace_classes_supported(self):
        """Test that all airspace classes can be stored."""
        airspace_classes = ['B', 'C', 'D', 'E', 'MOA', 'RESTRICTED', 'PROHIBITED', 'WARNING', 'ALERT', 'TFR']

        for airspace_class in airspace_classes:
            AirspaceBoundary.objects.create(
                name=f'Test {airspace_class}',
                airspace_class=airspace_class,
                floor_ft=0,
                ceiling_ft=10000,
                center_lat=47.5,
                center_lon=-122.0,
            )

        self.assertEqual(AirspaceBoundary.objects.count(), len(airspace_classes))

    def test_polygon_geojson_storage(self):
        """Test that GeoJSON polygon can be stored."""
        polygon = {
            'type': 'Polygon',
            'coordinates': [[
                [-122.0, 47.0],
                [-122.0, 48.0],
                [-121.0, 48.0],
                [-121.0, 47.0],
                [-122.0, 47.0],
            ]]
        }

        boundary = AirspaceBoundary.objects.create(
            name='Test Polygon',
            airspace_class='B',
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=47.5,
            center_lon=-121.5,
            polygon=polygon,
        )

        boundary.refresh_from_db()
        self.assertEqual(boundary.polygon['type'], 'Polygon')
        self.assertEqual(len(boundary.polygon['coordinates'][0]), 5)
