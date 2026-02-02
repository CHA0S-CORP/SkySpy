"""
Tests for aircraft streaming task.

Tests cover:
- normalize_aircraft_fast: Fast aircraft normalization
- update_state_and_broadcast: Hot path state update and broadcast
- flush_stream_to_database: Cold path database writes
- process_new_aircraft_lookups: Cold path aircraft info lookups
- stream_aircraft: Main streaming task (connection handling, batching)
- start_aircraft_stream: Starter task that launches streaming
- poll_aircraft: Skipping when streaming is active
"""
import json
import socket
import time
from collections import deque
from datetime import datetime
from unittest.mock import MagicMock, patch, Mock, call

import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.tasks.aircraft_stream import (
    normalize_aircraft,
    normalize_aircraft_fast,
    update_state_and_broadcast,
    update_cache_and_broadcast,
    sync_cache_state,
    flush_stream_to_database,
    process_new_aircraft_lookups,
    stream_aircraft,
    start_aircraft_stream,
    _aircraft_state,
    _aircraft_state_lock,
    _db_write_buffer,
    _db_buffer_lock,
    _seen_aircraft,
    _seen_aircraft_lock,
    _new_aircraft_queue,
    CACHE_KEY_AIRCRAFT,
    CACHE_KEY_STREAM_ACTIVE,
)
from skyspy.tasks.aircraft import poll_aircraft


# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': True,
}


def reset_stream_state():
    """Reset all module-level state for clean tests."""
    import skyspy.tasks.aircraft_stream as stream_module
    with stream_module._aircraft_state_lock:
        stream_module._aircraft_state.clear()
    with stream_module._db_buffer_lock:
        stream_module._db_write_buffer.clear()
    with stream_module._seen_aircraft_lock:
        stream_module._seen_aircraft.clear()
    stream_module._new_aircraft_queue.clear()
    stream_module._previous_icaos.clear()


class NormalizeAircraftFastTest(TestCase):
    """Tests for the normalize_aircraft_fast function."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    def test_normalize_aircraft_fast_basic_fields(self):
        """Test that basic fields are normalized correctly."""
        ac = {
            'hex': 'a12345',
            'flight': 'UAL123  ',
            'lat': 47.6,
            'lon': -122.3,
            'alt_baro': 35000,
            'alt_geom': 35500,
            'gs': 450,
            'baro_rate': -500,
            'squawk': '1234',
            'dbFlags': 0,
        }

        result = normalize_aircraft_fast(ac, feeder_lat=47.5, feeder_lon=-122.0)

        # Hex should be uppercase
        self.assertEqual(result['hex'], 'A12345')
        # Flight should be stripped
        self.assertEqual(result['flight'], 'UAL123')
        # Alt should be alt_baro
        self.assertEqual(result['alt'], 35000)
        # Distance should be calculated
        self.assertIn('distance_nm', result)
        self.assertIsInstance(result['distance_nm'], float)
        # VR should be baro_rate
        self.assertEqual(result['vr'], -500)
        # Military flag
        self.assertFalse(result['military'])
        # Emergency flag
        self.assertFalse(result['emergency'])

    def test_normalize_aircraft_fast_military_flag(self):
        """Test that military flag is detected from dbFlags."""
        ac = {
            'hex': 'ae1234',
            'lat': 47.6,
            'lon': -122.3,
            'dbFlags': 1,  # Military flag
        }

        result = normalize_aircraft_fast(ac, 47.5, -122.0)
        self.assertTrue(result['military'])

    def test_normalize_aircraft_fast_emergency_squawks(self):
        """Test that emergency squawks are detected."""
        for squawk in ['7500', '7600', '7700']:
            ac = {
                'hex': 'a12345',
                'lat': 47.6,
                'lon': -122.3,
                'squawk': squawk,
            }

            result = normalize_aircraft_fast(ac, 47.5, -122.0)
            self.assertTrue(result['emergency'], f"Squawk {squawk} should be emergency")

    def test_normalize_aircraft_fast_no_position(self):
        """Test that aircraft without position are handled."""
        ac = {
            'hex': 'a12345',
            'flight': 'UAL123',
            'alt_baro': 35000,
        }

        result = normalize_aircraft_fast(ac, 47.5, -122.0)

        self.assertEqual(result['hex'], 'A12345')
        # Distance should not be calculated without position
        self.assertNotIn('distance_nm', result)

    def test_normalize_aircraft_legacy_wrapper(self):
        """Test that legacy normalize_aircraft wrapper works."""
        ac = {'hex': 'a12345', 'lat': 47.6, 'lon': -122.3}
        result = normalize_aircraft(ac)
        self.assertEqual(result['hex'], 'A12345')


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateStateAndBroadcastTest(TestCase):
    """Tests for the update_state_and_broadcast hot path function."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    @patch('skyspy.tasks.aircraft_stream.broadcast_positions_fast')
    @patch('skyspy.tasks.aircraft_stream.broadcast_aircraft_update')
    def test_update_state_empty_batch(self, mock_broadcast_update, mock_broadcast_pos):
        """Test that empty batch is handled gracefully."""
        update_state_and_broadcast([])

        mock_broadcast_pos.assert_not_called()
        mock_broadcast_update.assert_not_called()

    @patch('skyspy.tasks.aircraft_stream.broadcast_positions_fast')
    @patch('skyspy.tasks.aircraft_stream.broadcast_aircraft_update')
    @patch('skyspy.tasks.aircraft_stream.broadcast_new_aircraft')
    def test_update_state_updates_memory(self, mock_new, mock_update, mock_pos):
        """Test that in-memory state is updated."""
        batch = [
            {'hex': 'A12345', 'lat': 47.6, 'lon': -122.3, 'alt': 35000, 'seen': 0.5},
        ]

        update_state_and_broadcast(batch)

        # Check in-memory state was updated
        with _aircraft_state_lock:
            self.assertIn('A12345', _aircraft_state)

    @patch('skyspy.tasks.aircraft_stream.broadcast_positions_fast')
    @patch('skyspy.tasks.aircraft_stream.broadcast_aircraft_update')
    @patch('skyspy.tasks.aircraft_stream.broadcast_new_aircraft')
    def test_update_state_buffers_for_database(self, mock_new, mock_update, mock_pos):
        """Test that aircraft with position are buffered for database write."""
        batch = [
            {'hex': 'A12345', 'lat': 47.6, 'lon': -122.3, 'alt': 35000, 'seen': 0.5},
            {'hex': 'A67890', 'alt': 28000},  # No position - should not be buffered
        ]

        update_state_and_broadcast(batch)

        # Check database buffer
        with _db_buffer_lock:
            self.assertEqual(len(_db_write_buffer), 1)
            self.assertEqual(_db_write_buffer[0]['hex'], 'A12345')

    @patch('skyspy.tasks.aircraft_stream.broadcast_positions_fast')
    @patch('skyspy.tasks.aircraft_stream.broadcast_aircraft_update')
    @patch('skyspy.tasks.aircraft_stream.broadcast_new_aircraft')
    def test_update_state_broadcasts_positions(self, mock_new, mock_update, mock_pos):
        """Test that positions:update is broadcast."""
        batch = [{'hex': 'A12345', 'lat': 47.6, 'lon': -122.3, 'seen': 0.5}]

        update_state_and_broadcast(batch)

        mock_pos.assert_called_once()

    @patch('skyspy.tasks.aircraft_stream.broadcast_positions_fast')
    @patch('skyspy.tasks.aircraft_stream.broadcast_aircraft_update')
    @patch('skyspy.tasks.aircraft_stream.broadcast_new_aircraft')
    def test_update_state_detects_new_aircraft(self, mock_new, mock_update, mock_pos):
        """Test that new aircraft are detected and broadcast."""
        batch = [{'hex': 'A12345', 'lat': 47.6, 'lon': -122.3, 'seen': 0.5}]

        update_state_and_broadcast(batch)

        # First call should have new aircraft
        mock_new.assert_called_once()
        args = mock_new.call_args[0]
        self.assertEqual(len(args[0]), 1)  # 1 new aircraft
        self.assertEqual(args[0][0]['hex'], 'A12345')


class SyncCacheStateTest(TestCase):
    """Tests for the sync_cache_state function."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    def test_sync_cache_state_updates_cache(self):
        """Test that sync_cache_state updates Django cache."""
        # Set up in-memory state
        with _aircraft_state_lock:
            _aircraft_state['A12345'] = {'hex': 'A12345', 'lat': 47.6}
            _aircraft_state['A67890'] = {'hex': 'A67890', 'lat': 47.7}

        sync_cache_state()

        # Check cache was updated
        cached = cache.get(CACHE_KEY_AIRCRAFT)
        self.assertIsNotNone(cached)
        self.assertEqual(len(cached), 2)


@override_settings(**CELERY_TEST_SETTINGS)
class FlushStreamToDatabaseTest(TestCase):
    """Tests for the flush_stream_to_database cold path task."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    def test_flush_empty_buffer(self):
        """Test that empty buffer is handled gracefully."""
        # Should not raise
        flush_stream_to_database()

    @patch('skyspy.tasks.aircraft_stream.AircraftSighting')
    def test_flush_creates_sightings(self, MockSighting):
        """Test that buffered aircraft are flushed to database."""
        # Add some aircraft to buffer
        with _db_buffer_lock:
            _db_write_buffer.append({
                'hex': 'A12345',
                'lat': 47.6,
                'lon': -122.3,
                'alt_baro': 35000,
                'gs': 450,
            })
            _db_write_buffer.append({
                'hex': 'A67890',
                'lat': 47.7,
                'lon': -122.4,
                'alt_baro': 28000,
            })

        # Mock bulk_create
        with patch('skyspy.models.AircraftSighting.objects.bulk_create') as mock_bulk:
            flush_stream_to_database()
            mock_bulk.assert_called_once()
            # Check 2 sightings were created
            self.assertEqual(len(mock_bulk.call_args[0][0]), 2)

        # Buffer should be cleared
        with _db_buffer_lock:
            self.assertEqual(len(_db_write_buffer), 0)


@override_settings(**CELERY_TEST_SETTINGS)
class ProcessNewAircraftLookupsTest(TestCase):
    """Tests for the process_new_aircraft_lookups cold path task."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    def test_process_empty_queue(self):
        """Test that empty queue is handled gracefully."""
        # Should not raise
        process_new_aircraft_lookups()

    @patch('skyspy.tasks.aircraft_stream.fetch_aircraft_info')
    def test_process_queues_lookups(self, mock_fetch):
        """Test that queued aircraft are sent for lookup."""
        # Add some aircraft to queue
        _new_aircraft_queue.append('A12345')
        _new_aircraft_queue.append('A67890')

        process_new_aircraft_lookups()

        # Check lookups were queued
        self.assertEqual(mock_fetch.delay.call_count, 2)


@override_settings(**CELERY_TEST_SETTINGS)
class PollAircraftStreamingBypassTest(TestCase):
    """Tests for poll_aircraft behavior when streaming is active."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    @patch('skyspy.tasks.aircraft.httpx.get')
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_poll_aircraft_skips_when_stream_active(self, mock_get):
        """Test that poll_aircraft skips when streaming is active."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        poll_aircraft()

        mock_get.assert_not_called()

    @patch('skyspy.tasks.aircraft.sync_emit')
    @patch('skyspy.tasks.aircraft.httpx.get')
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=True,
        ULTRAFEEDER_URL='http://test-feeder:8080',
        FEEDER_LAT=47.5,
        FEEDER_LON=-122.0
    )
    def test_poll_aircraft_runs_when_stream_inactive(self, mock_get, mock_emit):
        """Test that poll_aircraft runs when streaming is not active."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=30)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            'now': 1704067200.0,
            'messages': 100,
            'aircraft': []
        }
        mock_get.return_value = mock_response

        poll_aircraft()

        mock_get.assert_called_once()

    @patch('skyspy.tasks.aircraft.sync_emit')
    @patch('skyspy.tasks.aircraft.httpx.get')
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=False,
        ULTRAFEEDER_URL='http://test-feeder:8080',
        FEEDER_LAT=47.5,
        FEEDER_LON=-122.0
    )
    def test_poll_aircraft_runs_when_streaming_disabled(self, mock_get, mock_emit):
        """Test that poll_aircraft runs when streaming is disabled in settings."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        mock_response = MagicMock()
        mock_response.json.return_value = {
            'now': 1704067200.0,
            'messages': 100,
            'aircraft': []
        }
        mock_get.return_value = mock_response

        poll_aircraft()

        mock_get.assert_called_once()


@override_settings(**CELERY_TEST_SETTINGS)
class StartAircraftStreamTest(TestCase):
    """Tests for the start_aircraft_stream starter task."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    @patch('skyspy.tasks.aircraft_stream.stream_aircraft')
    @override_settings(AIRCRAFT_STREAM_ENABLED=False)
    def test_start_stream_disabled(self, mock_stream):
        """Test that starter exits when streaming is disabled."""
        start_aircraft_stream()

        mock_stream.delay.assert_not_called()

    @patch('skyspy.tasks.aircraft_stream.stream_aircraft')
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_start_stream_already_active(self, mock_stream):
        """Test that starter doesn't launch duplicate stream."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        start_aircraft_stream()

        mock_stream.delay.assert_not_called()

    @patch('skyspy.tasks.aircraft_stream.stream_aircraft')
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_start_stream_launches_task(self, mock_stream):
        """Test that starter launches stream task when needed."""
        cache.delete(CACHE_KEY_STREAM_ACTIVE)

        start_aircraft_stream()

        mock_stream.delay.assert_called_once()


@override_settings(**CELERY_TEST_SETTINGS)
class StreamAircraftTaskTest(TestCase):
    """Tests for the stream_aircraft main task."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    @override_settings(AIRCRAFT_STREAM_ENABLED=False)
    def test_stream_aircraft_exits_when_disabled(self):
        """Test that stream_aircraft exits immediately when disabled."""
        stream_aircraft()

        self.assertFalse(cache.get(CACHE_KEY_STREAM_ACTIVE))

    @patch('skyspy.tasks.aircraft_stream.socket.socket')
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=True,
        AIRCRAFT_STREAM_HOST='test-host',
        AIRCRAFT_STREAM_PORT=30047,
        AIRCRAFT_STREAM_RECONNECT_DELAY=1,
        AIRCRAFT_STREAM_BATCH_MS=100,
        FEEDER_LAT=47.5,
        FEEDER_LON=-122.0,
    )
    def test_stream_aircraft_connection_refused(self, mock_socket_class):
        """Test handling of connection refused error."""
        mock_socket = MagicMock()
        mock_socket.connect.side_effect = ConnectionRefusedError("Connection refused")
        mock_socket_class.return_value = mock_socket

        call_count = [0]

        def connect_side_effect(*args):
            call_count[0] += 1
            if call_count[0] >= 2:
                raise KeyboardInterrupt("Test exit")
            raise ConnectionRefusedError("Connection refused")

        mock_socket.connect.side_effect = connect_side_effect

        with self.assertRaises(KeyboardInterrupt):
            stream_aircraft()

        self.assertFalse(cache.get(CACHE_KEY_STREAM_ACTIVE))


class StreamAircraftIntegrationTest(TestCase):
    """Integration tests for aircraft streaming."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    @patch('skyspy.tasks.aircraft_stream.update_state_and_broadcast')
    @patch('skyspy.tasks.aircraft_stream.normalize_aircraft_fast')
    @patch('skyspy.tasks.aircraft_stream.socket.socket')
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=True,
        AIRCRAFT_STREAM_HOST='localhost',
        AIRCRAFT_STREAM_PORT=30047,
        AIRCRAFT_STREAM_RECONNECT_DELAY=1,
        AIRCRAFT_STREAM_BATCH_MS=100,
        FEEDER_LAT=47.5,
        FEEDER_LON=-122.0,
    )
    def test_stream_processes_json_lines(self, mock_socket_class, mock_normalize, mock_broadcast):
        """Test that stream correctly processes JSON lines."""
        mock_socket = MagicMock()

        json_lines = [
            '{"hex":"a12345","lat":47.6,"lon":-122.3,"alt_baro":35000}\n',
            '{"hex":"a67890","lat":47.7,"lon":-122.4,"alt_baro":28000}\n',
        ]

        mock_file = MagicMock()
        mock_file.__iter__ = MagicMock(return_value=iter(json_lines))
        mock_socket.makefile.return_value = mock_file
        mock_socket_class.return_value = mock_socket

        mock_normalize.side_effect = lambda x, lat, lon: x

        broadcast_calls = []

        def broadcast_side_effect(batch):
            broadcast_calls.append(batch)
            if len(broadcast_calls) >= 1:
                raise KeyboardInterrupt("Test exit")

        mock_broadcast.side_effect = broadcast_side_effect

        try:
            stream_aircraft()
        except KeyboardInterrupt:
            pass

        self.assertEqual(mock_normalize.call_count, 2)


class StreamAircraftCeleryConfigTest(TestCase):
    """Tests for Celery task configuration."""

    def test_stream_aircraft_is_shared_task(self):
        """Verify stream_aircraft is a shared task."""
        self.assertTrue(hasattr(stream_aircraft, 'delay'))
        self.assertTrue(hasattr(stream_aircraft, 'apply_async'))

    def test_start_aircraft_stream_is_shared_task(self):
        """Verify start_aircraft_stream is a shared task."""
        self.assertTrue(hasattr(start_aircraft_stream, 'delay'))
        self.assertTrue(hasattr(start_aircraft_stream, 'apply_async'))

    def test_flush_stream_to_database_is_shared_task(self):
        """Verify flush_stream_to_database is a shared task."""
        self.assertTrue(hasattr(flush_stream_to_database, 'delay'))
        self.assertTrue(hasattr(flush_stream_to_database, 'apply_async'))

    def test_process_new_aircraft_lookups_is_shared_task(self):
        """Verify process_new_aircraft_lookups is a shared task."""
        self.assertTrue(hasattr(process_new_aircraft_lookups, 'delay'))
        self.assertTrue(hasattr(process_new_aircraft_lookups, 'apply_async'))

    def test_stream_aircraft_has_no_retries(self):
        """Verify stream_aircraft has max_retries=0."""
        self.assertEqual(stream_aircraft.max_retries, 0)

    def test_stream_aircraft_ignores_result(self):
        """Verify stream_aircraft ignores result."""
        self.assertTrue(stream_aircraft.ignore_result)


class StreamSettingsTest(TestCase):
    """Tests for streaming settings configuration."""

    def test_settings_have_defaults(self):
        """Test that streaming settings have sensible defaults."""
        from django.conf import settings

        self.assertTrue(hasattr(settings, 'AIRCRAFT_STREAM_ENABLED'))
        self.assertTrue(hasattr(settings, 'AIRCRAFT_STREAM_HOST'))
        self.assertTrue(hasattr(settings, 'AIRCRAFT_STREAM_PORT'))
        self.assertTrue(hasattr(settings, 'AIRCRAFT_STREAM_RECONNECT_DELAY'))
        self.assertTrue(hasattr(settings, 'AIRCRAFT_STREAM_BATCH_MS'))

    def test_default_stream_port(self):
        """Test default streaming port is 30047."""
        from django.conf import settings
        self.assertEqual(settings.AIRCRAFT_STREAM_PORT, 30047)

    def test_default_batch_ms(self):
        """Test default batch interval is 100ms."""
        from django.conf import settings
        self.assertEqual(settings.AIRCRAFT_STREAM_BATCH_MS, 100)


class LowLatencyArchitectureTest(TestCase):
    """Tests to verify the low-latency architecture."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    @patch('skyspy.tasks.aircraft_stream.sync_emit')
    def test_hot_path_does_not_touch_database(self, mock_emit):
        """Verify that update_state_and_broadcast doesn't do database operations."""
        import skyspy.tasks.aircraft_stream as stream_module

        batch = [
            {'hex': 'A12345', 'lat': 47.6, 'lon': -122.3, 'alt': 35000, 'seen': 0.5},
        ]

        # This should not import or use any database models
        with patch.object(stream_module, 'AircraftSighting', None):
            # This should complete without error (no DB access)
            update_state_and_broadcast(batch)

        # Broadcasts should have been made
        self.assertTrue(mock_emit.called)

    def test_database_writes_are_buffered(self):
        """Verify that database writes go to buffer, not direct to DB."""
        with patch('skyspy.tasks.aircraft_stream.sync_emit'):
            batch = [
                {'hex': 'A12345', 'lat': 47.6, 'lon': -122.3, 'seen': 0.5},
                {'hex': 'A67890', 'lat': 47.7, 'lon': -122.4, 'seen': 0.3},
            ]

            update_state_and_broadcast(batch)

        # Check buffer has data
        with _db_buffer_lock:
            self.assertEqual(len(_db_write_buffer), 2)

    def test_cache_sync_is_separate_from_broadcast(self):
        """Verify that cache sync is a separate operation from broadcast."""
        # Set up in-memory state
        with _aircraft_state_lock:
            _aircraft_state['A12345'] = {'hex': 'A12345', 'lat': 47.6}

        # Cache should be empty before sync
        self.assertIsNone(cache.get(CACHE_KEY_AIRCRAFT))

        # Sync cache
        sync_cache_state()

        # Now cache should have data
        self.assertIsNotNone(cache.get(CACHE_KEY_AIRCRAFT))
