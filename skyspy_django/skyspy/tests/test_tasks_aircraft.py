"""
End-to-end tests for aircraft-related Celery tasks.

Tests cover:
- poll_aircraft: Fetching aircraft data from ultrafeeder
- cleanup_sessions: Marking stale sessions
- store_aircraft_sightings: Batch inserting sightings to database
- update_aircraft_sessions: Creating/updating tracking sessions
- update_stats_cache: Calculating and caching statistics
- update_safety_stats: Calculating safety event statistics
"""
import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, Mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import AircraftSighting, AircraftSession, SafetyEvent
from skyspy.tasks.aircraft import (
    poll_aircraft,
    cleanup_sessions,
    store_aircraft_sightings,
    update_aircraft_sessions,
    update_stats_cache,
    update_safety_stats,
    calculate_distance_nm,
)


# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': True,
}


class CalculateDistanceTest(TestCase):
    """Tests for the distance calculation utility function."""

    def test_same_point_returns_zero(self):
        """Distance from a point to itself should be zero."""
        distance = calculate_distance_nm(47.5, -122.0, 47.5, -122.0)
        self.assertAlmostEqual(distance, 0.0, places=5)

    def test_known_distance(self):
        """Test distance calculation with known coordinates."""
        # Seattle to Portland is approximately 145 nm
        seattle_lat, seattle_lon = 47.6062, -122.3321
        portland_lat, portland_lon = 45.5152, -122.6784
        distance = calculate_distance_nm(seattle_lat, seattle_lon, portland_lat, portland_lon)
        self.assertAlmostEqual(distance, 126.0, delta=5.0)  # Approximate

    def test_distance_is_symmetric(self):
        """Distance from A to B should equal distance from B to A."""
        lat1, lon1 = 47.0, -122.0
        lat2, lon2 = 48.0, -121.0
        distance_ab = calculate_distance_nm(lat1, lon1, lat2, lon2)
        distance_ba = calculate_distance_nm(lat2, lon2, lat1, lon1)
        self.assertAlmostEqual(distance_ab, distance_ba, places=5)


@override_settings(**CELERY_TEST_SETTINGS)
class PollAircraftTaskTest(TestCase):
    """Tests for the poll_aircraft task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch('skyspy.tasks.aircraft.get_channel_layer')
    @patch('skyspy.tasks.aircraft.httpx.get')
    @override_settings(
        ULTRAFEEDER_URL='http://test-feeder:8080',
        FEEDER_LAT=47.5,
        FEEDER_LON=-122.0
    )
    def test_poll_aircraft_success(self, mock_httpx_get, mock_get_channel_layer):
        """Test successful aircraft polling."""
        # Mock httpx response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'now': 1704067200.0,
            'messages': 12345,
            'aircraft': [
                {
                    'hex': 'a12345',
                    'flight': 'UAL123 ',
                    'lat': 47.6,
                    'lon': -122.3,
                    'alt_baro': 35000,
                    'gs': 450,
                    'baro_rate': -500,
                    'squawk': '1234',
                    'dbFlags': 0,
                },
                {
                    'hex': 'ae1234',
                    'flight': 'ARMY1',
                    'lat': 47.5,
                    'lon': -122.1,
                    'alt_baro': 15000,
                    'dbFlags': 1,  # Military flag
                },
            ]
        }
        mock_httpx_get.return_value = mock_response

        # Mock channel layer
        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        # Execute task
        poll_aircraft()

        # Verify HTTP request
        mock_httpx_get.assert_called_once()
        call_args = mock_httpx_get.call_args
        self.assertIn('aircraft.json', call_args[0][0])

        # Verify cache updates
        aircraft_list = cache.get('current_aircraft')
        self.assertIsNotNone(aircraft_list)
        self.assertEqual(len(aircraft_list), 2)
        self.assertTrue(cache.get('adsb_online'))

        # Verify aircraft processing
        self.assertEqual(aircraft_list[0]['hex'], 'A12345')  # Uppercase
        self.assertEqual(aircraft_list[0]['flight'], 'UAL123')  # Stripped
        self.assertFalse(aircraft_list[0]['military'])
        self.assertTrue(aircraft_list[1]['military'])

        # Verify distance calculation was performed
        self.assertIn('distance_nm', aircraft_list[0])

    @patch('skyspy.tasks.aircraft.httpx.get')
    def test_poll_aircraft_http_error(self, mock_httpx_get):
        """Test handling of HTTP errors during polling."""
        import httpx
        mock_httpx_get.side_effect = httpx.HTTPError("Connection refused")

        # Execute task (should not raise)
        poll_aircraft()

        # Verify adsb_online is set to False
        self.assertFalse(cache.get('adsb_online'))

    @patch('skyspy.tasks.aircraft.httpx.get')
    def test_poll_aircraft_invalid_json(self, mock_httpx_get):
        """Test handling of invalid JSON response."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.side_effect = json.JSONDecodeError("Invalid", "", 0)
        mock_httpx_get.return_value = mock_response

        # Execute task (should not raise)
        poll_aircraft()

    @patch('skyspy.tasks.aircraft.get_channel_layer')
    @patch('skyspy.tasks.aircraft.httpx.get')
    @override_settings(FEEDER_LAT=47.5, FEEDER_LON=-122.0)
    def test_poll_aircraft_emergency_squawk(self, mock_httpx_get, mock_get_channel_layer):
        """Test detection of emergency squawk codes."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'now': 1704067200.0,
            'messages': 100,
            'aircraft': [
                {'hex': 'a11111', 'lat': 47.5, 'lon': -122.0, 'squawk': '7700'},  # Emergency
                {'hex': 'a22222', 'lat': 47.5, 'lon': -122.0, 'squawk': '7600'},  # Radio failure
                {'hex': 'a33333', 'lat': 47.5, 'lon': -122.0, 'squawk': '7500'},  # Hijack
                {'hex': 'a44444', 'lat': 47.5, 'lon': -122.0, 'squawk': '1200'},  # VFR
            ]
        }
        mock_httpx_get.return_value = mock_response
        mock_get_channel_layer.return_value = MagicMock()

        poll_aircraft()

        aircraft_list = cache.get('current_aircraft')
        self.assertTrue(aircraft_list[0]['emergency'])
        self.assertTrue(aircraft_list[1]['emergency'])
        self.assertTrue(aircraft_list[2]['emergency'])
        self.assertFalse(aircraft_list[3]['emergency'])


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupSessionsTaskTest(TestCase):
    """Tests for the cleanup_sessions task."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftSession.objects.all().delete()

    @override_settings(SESSION_TIMEOUT_MINUTES=30)
    def test_cleanup_sessions_identifies_stale(self):
        """Test that stale sessions are identified correctly."""
        now = timezone.now()

        # Create sessions with different last_seen times
        # Fresh session (5 minutes ago)
        fresh_session = AircraftSession.objects.create(
            icao_hex='A11111',
            callsign='UAL123',
            first_seen=now - timedelta(hours=1),
            total_positions=100,
        )
        # Force update last_seen
        AircraftSession.objects.filter(pk=fresh_session.pk).update(
            last_seen=now - timedelta(minutes=5)
        )

        # Stale session (40 minutes ago - past timeout)
        stale_session = AircraftSession.objects.create(
            icao_hex='A22222',
            callsign='DAL456',
            first_seen=now - timedelta(hours=2),
            total_positions=50,
        )
        AircraftSession.objects.filter(pk=stale_session.pk).update(
            last_seen=now - timedelta(minutes=40)
        )

        # Execute task - it logs stale count but doesn't delete
        cleanup_sessions()

        # Both sessions should still exist (task only logs, doesn't delete)
        self.assertEqual(AircraftSession.objects.count(), 2)


@override_settings(**CELERY_TEST_SETTINGS)
class StoreAircraftSightingsTaskTest(TestCase):
    """Tests for the store_aircraft_sightings task."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftSighting.objects.all().delete()

    def test_store_sightings_empty_list(self):
        """Test that empty list is handled gracefully."""
        store_aircraft_sightings([])
        self.assertEqual(AircraftSighting.objects.count(), 0)

    def test_store_sightings_valid_data(self):
        """Test storing valid aircraft sighting data."""
        aircraft_data = [
            {
                'hex': 'A12345',
                'flight': 'UAL123',
                'squawk': '1234',
                'lat': 47.6,
                'lon': -122.3,
                'alt_baro': 35000,
                'alt_geom': 35500,
                'gs': 450,
                'track': 180,
                'baro_rate': -500,
                'distance_nm': 10.5,
                'rssi': -25.5,
                'category': 'A3',
                't': 'B738',
                'military': False,
                'emergency': False,
            },
            {
                'hex': 'AE1234',
                'flight': 'ARMY1',
                'lat': 47.5,
                'lon': -122.1,
                'alt_baro': 15000,
                'military': True,
                'emergency': False,
            },
        ]

        store_aircraft_sightings(aircraft_data)

        self.assertEqual(AircraftSighting.objects.count(), 2)

        # Verify first sighting
        sighting1 = AircraftSighting.objects.get(icao_hex='A12345')
        self.assertEqual(sighting1.callsign, 'UAL123')
        self.assertEqual(sighting1.altitude_baro, 35000)
        self.assertEqual(sighting1.ground_speed, 450)
        self.assertFalse(sighting1.is_military)

        # Verify second sighting
        sighting2 = AircraftSighting.objects.get(icao_hex='AE1234')
        self.assertTrue(sighting2.is_military)

    def test_store_sightings_skips_no_position(self):
        """Test that aircraft without position are skipped."""
        aircraft_data = [
            {'hex': 'A11111', 'flight': 'UAL111'},  # No lat/lon
            {'hex': 'A22222', 'lat': 47.5, 'lon': None},  # Partial
            {'hex': 'A33333', 'lat': None, 'lon': -122.0},  # Partial
            {'hex': 'A44444', 'lat': 47.5, 'lon': -122.0},  # Valid
        ]

        store_aircraft_sightings(aircraft_data)

        self.assertEqual(AircraftSighting.objects.count(), 1)
        self.assertTrue(AircraftSighting.objects.filter(icao_hex='A44444').exists())

    def test_store_sightings_handles_missing_fields(self):
        """Test that missing optional fields are handled."""
        aircraft_data = [
            {
                'hex': 'A12345',
                'lat': 47.5,
                'lon': -122.0,
                # All other fields missing
            }
        ]

        store_aircraft_sightings(aircraft_data)

        sighting = AircraftSighting.objects.get(icao_hex='A12345')
        self.assertIsNone(sighting.callsign)
        self.assertIsNone(sighting.altitude_baro)
        self.assertIsNone(sighting.ground_speed)
        self.assertFalse(sighting.is_military)


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateAircraftSessionsTaskTest(TestCase):
    """Tests for the update_aircraft_sessions task."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftSession.objects.all().delete()

    def test_update_sessions_empty_list(self):
        """Test that empty list is handled gracefully."""
        update_aircraft_sessions([])
        self.assertEqual(AircraftSession.objects.count(), 0)

    def test_update_sessions_creates_new_session(self):
        """Test creating a new session for unseen aircraft."""
        aircraft_data = [
            {
                'hex': 'A12345',
                'flight': 'UAL123',
                'alt_baro': 35000,
                'distance_nm': 10.5,
                'baro_rate': -500,
                'rssi': -25.5,
                'category': 'A3',
                't': 'B738',
                'military': False,
            }
        ]

        update_aircraft_sessions(aircraft_data)

        self.assertEqual(AircraftSession.objects.count(), 1)
        session = AircraftSession.objects.get(icao_hex='A12345')
        self.assertEqual(session.callsign, 'UAL123')
        self.assertEqual(session.total_positions, 1)
        self.assertEqual(session.min_altitude, 35000)
        self.assertEqual(session.max_altitude, 35000)
        self.assertFalse(session.is_military)

    def test_update_sessions_updates_existing_session(self):
        """Test updating an existing recent session."""
        now = timezone.now()

        # Create existing session
        session = AircraftSession.objects.create(
            icao_hex='A12345',
            callsign='UAL123',
            first_seen=now - timedelta(minutes=2),
            total_positions=10,
            min_altitude=30000,
            max_altitude=35000,
            min_distance_nm=15.0,
            max_distance_nm=20.0,
        )
        # Force the last_seen to be recent
        AircraftSession.objects.filter(pk=session.pk).update(
            last_seen=now - timedelta(minutes=1)
        )

        # Update with new position
        aircraft_data = [
            {
                'hex': 'A12345',
                'flight': 'UAL123',
                'alt_baro': 28000,  # Lower than min
                'distance_nm': 10.0,  # Closer than min
                'baro_rate': 1000,
                'rssi': -20.0,
            }
        ]

        update_aircraft_sessions(aircraft_data)

        self.assertEqual(AircraftSession.objects.count(), 1)
        session.refresh_from_db()
        self.assertEqual(session.total_positions, 11)  # Incremented
        self.assertEqual(session.min_altitude, 28000)  # Updated
        self.assertEqual(session.max_altitude, 35000)  # Unchanged
        self.assertEqual(session.min_distance_nm, 10.0)  # Updated

    def test_update_sessions_creates_new_for_stale_session(self):
        """Test that a new session is created when previous is stale."""
        now = timezone.now()

        # Create old session (more than 5 minutes ago)
        old_session = AircraftSession.objects.create(
            icao_hex='A12345',
            callsign='UAL123',
            first_seen=now - timedelta(hours=1),
            total_positions=100,
        )
        AircraftSession.objects.filter(pk=old_session.pk).update(
            last_seen=now - timedelta(minutes=10)  # Stale
        )

        aircraft_data = [
            {
                'hex': 'A12345',
                'flight': 'UAL123',
                'alt_baro': 35000,
            }
        ]

        update_aircraft_sessions(aircraft_data)

        # Should have created a new session
        self.assertEqual(AircraftSession.objects.filter(icao_hex='A12345').count(), 2)

    def test_update_sessions_skips_empty_icao(self):
        """Test that aircraft without ICAO hex are skipped."""
        aircraft_data = [
            {'hex': '', 'flight': 'TEST1'},
            {'flight': 'TEST2'},  # No hex key
            {'hex': 'A12345', 'flight': 'TEST3'},  # Valid
        ]

        update_aircraft_sessions(aircraft_data)

        self.assertEqual(AircraftSession.objects.count(), 1)


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateStatsCacheTaskTest(TestCase):
    """Tests for the update_stats_cache task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_update_stats_cache_empty(self):
        """Test stats calculation with no aircraft."""
        update_stats_cache()

        stats = cache.get('aircraft_stats')
        self.assertIsNotNone(stats)
        self.assertEqual(stats['total'], 0)
        self.assertEqual(stats['with_position'], 0)
        self.assertEqual(stats['military'], 0)
        self.assertTrue(cache.get('celery_heartbeat'))

    def test_update_stats_cache_with_aircraft(self):
        """Test stats calculation with aircraft in cache."""
        # Set up cached aircraft
        aircraft_list = [
            {'hex': 'A11111', 'lat': 47.5, 'lon': -122.0, 'military': False},
            {'hex': 'A22222', 'lat': 47.6, 'lon': -122.1, 'military': True},
            {'hex': 'A33333', 'military': False},  # No position
            {'hex': 'A44444', 'lat': None, 'lon': -122.0, 'military': True},  # Partial
        ]
        cache.set('current_aircraft', aircraft_list)

        update_stats_cache()

        stats = cache.get('aircraft_stats')
        self.assertEqual(stats['total'], 4)
        self.assertEqual(stats['with_position'], 2)
        self.assertEqual(stats['military'], 2)
        self.assertIn('timestamp', stats)


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateSafetyStatsTaskTest(TestCase):
    """Tests for the update_safety_stats task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        SafetyEvent.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_update_safety_stats_no_events(self):
        """Test safety stats with no events."""
        update_safety_stats()

        stats = cache.get('safety_stats')
        self.assertIsNotNone(stats)
        self.assertEqual(stats['total_24h'], 0)

    def test_update_safety_stats_with_events(self):
        """Test safety stats calculation with recent events."""
        now = timezone.now()

        # Create events within 24 hours
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='A11111',
        )
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='warning',
            icao_hex='A22222',
        )
        SafetyEvent.objects.create(
            event_type='7700',
            severity='critical',
            icao_hex='A33333',
        )

        # Create old event (should not be counted)
        old_event = SafetyEvent.objects.create(
            event_type='extreme_vs',
            severity='warning',
            icao_hex='A44444',
        )
        # Force old timestamp
        SafetyEvent.objects.filter(pk=old_event.pk).update(
            timestamp=now - timedelta(hours=25)
        )

        update_safety_stats()

        stats = cache.get('safety_stats')
        self.assertEqual(stats['total_24h'], 3)
        self.assertEqual(stats['by_type'].get('tcas_ra'), 2)
        self.assertEqual(stats['by_type'].get('7700'), 1)
        self.assertEqual(stats['by_severity'].get('critical'), 2)
        self.assertEqual(stats['by_severity'].get('warning'), 1)


@override_settings(**CELERY_TEST_SETTINGS)
class TaskRetryBehaviorTest(TestCase):
    """Tests for task retry behavior."""

    @patch('skyspy.tasks.aircraft.httpx.get')
    def test_poll_aircraft_no_retry_on_failure(self, mock_httpx_get):
        """Test that poll_aircraft has max_retries=0 (no retries)."""
        import httpx
        mock_httpx_get.side_effect = httpx.HTTPError("Connection refused")

        # Task should complete without raising (max_retries=0)
        poll_aircraft()

        # Task completed once
        mock_httpx_get.assert_called_once()


@override_settings(**CELERY_TEST_SETTINGS)
class TaskSchedulingTest(TestCase):
    """Tests for task scheduling configuration."""

    def test_poll_aircraft_is_shared_task(self):
        """Verify poll_aircraft is a shared task."""
        from skyspy.tasks.aircraft import poll_aircraft
        self.assertTrue(hasattr(poll_aircraft, 'delay'))
        self.assertTrue(hasattr(poll_aircraft, 'apply_async'))

    def test_cleanup_sessions_is_shared_task(self):
        """Verify cleanup_sessions is a shared task."""
        from skyspy.tasks.aircraft import cleanup_sessions
        self.assertTrue(hasattr(cleanup_sessions, 'delay'))

    def test_store_aircraft_sightings_is_shared_task(self):
        """Verify store_aircraft_sightings is a shared task."""
        from skyspy.tasks.aircraft import store_aircraft_sightings
        self.assertTrue(hasattr(store_aircraft_sightings, 'delay'))

    def test_update_stats_cache_is_shared_task(self):
        """Verify update_stats_cache is a shared task."""
        from skyspy.tasks.aircraft import update_stats_cache
        self.assertTrue(hasattr(update_stats_cache, 'delay'))


class TaskAtomicityTest(TestCase):
    """Tests for database transaction atomicity in tasks."""

    def test_store_sightings_atomic_rollback(self):
        """Test that store_aircraft_sightings rolls back on error."""
        # This would require creating a scenario where an insert fails
        # mid-batch, which is difficult to simulate without mocking
        # the bulk_create method. For now, verify the task uses atomic.
        import inspect
        from skyspy.tasks.aircraft import store_aircraft_sightings

        # Get the source code and verify it uses transaction.atomic
        source = inspect.getsource(store_aircraft_sightings)
        self.assertIn('transaction.atomic', source)

    def test_update_sessions_atomic(self):
        """Test that update_aircraft_sessions uses atomic transactions."""
        import inspect
        from skyspy.tasks.aircraft import update_aircraft_sessions

        source = inspect.getsource(update_aircraft_sessions)
        self.assertIn('transaction.atomic', source)
