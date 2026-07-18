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

import contextlib
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache
from django.test import TestCase, override_settings

from skyspy.tasks.aircraft import poll_aircraft
from skyspy.tasks.aircraft_stream import (
    CACHE_KEY_AIRCRAFT,
    CACHE_KEY_STREAM_ACTIVE,
    TRACKED_FIELDS,
    _aircraft_state,
    _aircraft_state_lock,
    _compute_field_changes,
    _db_buffer_lock,
    _db_write_buffer,
    _new_aircraft_queue,
    _previous_aircraft_state_lock,
    annotate_ghosts,
    broadcast_aircraft_delta,
    clear_delta_state,
    compute_aircraft_delta,
    detect_ghost_aircraft,
    flush_stream_to_database,
    get_stream_task_status,
    normalize_aircraft,
    normalize_aircraft_fast,
    process_new_aircraft_lookups,
    start_aircraft_stream,
    stream_aircraft,
    sync_cache_state,
    update_state_and_broadcast,
)

# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
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
    # Clear differential update state
    clear_delta_state()


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
            "hex": "a12345",
            "flight": "UAL123  ",
            "lat": 47.6,
            "lon": -122.3,
            "alt_baro": 35000,
            "alt_geom": 35500,
            "gs": 450,
            "baro_rate": -500,
            "squawk": "1234",
            "dbFlags": 0,
        }

        result = normalize_aircraft_fast(ac, feeder_lat=47.5, feeder_lon=-122.0)

        # Hex should be uppercase
        self.assertEqual(result["hex"], "A12345")
        # Flight should be stripped
        self.assertEqual(result["flight"], "UAL123")
        # Alt should be alt_baro
        self.assertEqual(result["alt"], 35000)
        # Distance should be calculated
        self.assertIn("distance_nm", result)
        self.assertIsInstance(result["distance_nm"], float)
        # VR should be baro_rate
        self.assertEqual(result["vr"], -500)
        # Military flag
        self.assertFalse(result["military"])
        # Emergency flag
        self.assertFalse(result["emergency"])

    def test_normalize_aircraft_fast_military_flag(self):
        """Test that military flag is detected from dbFlags."""
        ac = {
            "hex": "ae1234",
            "lat": 47.6,
            "lon": -122.3,
            "dbFlags": 1,  # Military flag
        }

        result = normalize_aircraft_fast(ac, 47.5, -122.0)
        self.assertTrue(result["military"])

    def test_normalize_aircraft_fast_emergency_squawks(self):
        """Test that emergency squawks are detected."""
        for squawk in ["7500", "7600", "7700"]:
            ac = {
                "hex": "a12345",
                "lat": 47.6,
                "lon": -122.3,
                "squawk": squawk,
            }

            result = normalize_aircraft_fast(ac, 47.5, -122.0)
            self.assertTrue(result["emergency"], f"Squawk {squawk} should be emergency")

    def test_normalize_aircraft_fast_no_position(self):
        """Test that aircraft without position are handled."""
        ac = {
            "hex": "a12345",
            "flight": "UAL123",
            "alt_baro": 35000,
        }

        result = normalize_aircraft_fast(ac, 47.5, -122.0)

        self.assertEqual(result["hex"], "A12345")
        # Distance should not be calculated without position
        self.assertNotIn("distance_nm", result)

    def test_normalize_aircraft_legacy_wrapper(self):
        """Test that legacy normalize_aircraft wrapper works."""
        ac = {"hex": "a12345", "lat": 47.6, "lon": -122.3}
        result = normalize_aircraft(ac)
        self.assertEqual(result["hex"], "A12345")


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateStateAndBroadcastTest(TestCase):
    """Tests for the update_state_and_broadcast hot path function."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    @patch("skyspy.tasks.aircraft_stream.broadcast_positions_fast")
    @patch("skyspy.tasks.aircraft_stream.broadcast_aircraft_delta")
    def test_update_state_empty_batch(self, mock_broadcast_delta, mock_broadcast_pos):
        """Test that empty batch is handled gracefully."""
        update_state_and_broadcast([])

        mock_broadcast_pos.assert_not_called()
        mock_broadcast_delta.assert_not_called()

    @patch("skyspy.tasks.aircraft_stream.broadcast_positions_fast")
    @patch("skyspy.tasks.aircraft_stream.broadcast_aircraft_delta")
    @patch("skyspy.tasks.aircraft_stream.broadcast_new_aircraft")
    def test_update_state_updates_memory(self, mock_new, mock_delta, mock_pos):
        """Test that in-memory state is updated."""
        batch = [
            {"hex": "A12345", "lat": 47.6, "lon": -122.3, "alt": 35000, "seen": 0.5},
        ]

        update_state_and_broadcast(batch)

        # Check in-memory state was updated
        with _aircraft_state_lock:
            self.assertIn("A12345", _aircraft_state)

    @patch("skyspy.tasks.aircraft_stream.broadcast_positions_fast")
    @patch("skyspy.tasks.aircraft_stream.broadcast_aircraft_delta")
    @patch("skyspy.tasks.aircraft_stream.broadcast_new_aircraft")
    def test_update_state_buffers_for_database(self, mock_new, mock_delta, mock_pos):
        """Test that aircraft with position are buffered for database write."""
        batch = [
            {"hex": "A12345", "lat": 47.6, "lon": -122.3, "alt": 35000, "seen": 0.5},
            {"hex": "A67890", "alt": 28000},  # No position - should not be buffered
        ]

        update_state_and_broadcast(batch)

        # Check database buffer
        with _db_buffer_lock:
            self.assertEqual(len(_db_write_buffer), 1)
            self.assertEqual(_db_write_buffer[0]["hex"], "A12345")

    @patch("skyspy.tasks.aircraft_stream.broadcast_positions_fast")
    @patch("skyspy.tasks.aircraft_stream.broadcast_aircraft_delta")
    @patch("skyspy.tasks.aircraft_stream.broadcast_new_aircraft")
    def test_update_state_broadcasts_positions(self, mock_new, mock_delta, mock_pos):
        """Test that positions:update is broadcast."""
        batch = [{"hex": "A12345", "lat": 47.6, "lon": -122.3, "seen": 0.5}]

        update_state_and_broadcast(batch)

        mock_pos.assert_called_once()

    @patch("skyspy.tasks.aircraft_stream.broadcast_positions_fast")
    @patch("skyspy.tasks.aircraft_stream.broadcast_aircraft_delta")
    @patch("skyspy.tasks.aircraft_stream.broadcast_new_aircraft")
    def test_update_state_detects_new_aircraft(self, mock_new, mock_delta, mock_pos):
        """Test that new aircraft are detected and broadcast."""
        batch = [{"hex": "A12345", "lat": 47.6, "lon": -122.3, "seen": 0.5}]

        update_state_and_broadcast(batch)

        # First call should have new aircraft
        mock_new.assert_called_once()
        args = mock_new.call_args[0]
        self.assertEqual(len(args[0]), 1)  # 1 new aircraft
        self.assertEqual(args[0][0]["hex"], "A12345")


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
            _aircraft_state["A12345"] = {"hex": "A12345", "lat": 47.6}
            _aircraft_state["A67890"] = {"hex": "A67890", "lat": 47.7}

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

    def test_flush_creates_sightings(self):
        """Test that buffered aircraft are flushed to database."""
        # Add some aircraft to buffer
        with _db_buffer_lock:
            _db_write_buffer.append(
                {
                    "hex": "A12345",
                    "lat": 47.6,
                    "lon": -122.3,
                    "alt_baro": 35000,
                    "gs": 450,
                }
            )
            _db_write_buffer.append(
                {
                    "hex": "A67890",
                    "lat": 47.7,
                    "lon": -122.4,
                    "alt_baro": 28000,
                }
            )

        # Mock bulk_create
        with patch("skyspy.models.AircraftSighting.objects.bulk_create") as mock_bulk:
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

    @patch("skyspy.tasks.external_db.fetch_aircraft_info_batch")
    def test_process_queues_lookups(self, mock_fetch_batch):
        """Test that queued aircraft are sent for lookup."""
        # Add some aircraft to queue
        _new_aircraft_queue.append("A12345")
        _new_aircraft_queue.append("A67890")

        process_new_aircraft_lookups()

        # Check batch lookup was queued (single call with list of ICAOs)
        mock_fetch_batch.delay.assert_called_once()
        icao_list = mock_fetch_batch.delay.call_args[0][0]
        self.assertEqual(len(icao_list), 2)
        self.assertIn("A12345", icao_list)
        self.assertIn("A67890", icao_list)


@override_settings(**CELERY_TEST_SETTINGS)
class PollAircraftStreamingBypassTest(TestCase):
    """Tests for poll_aircraft behavior when streaming is active."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    @patch("skyspy.tasks.aircraft.httpx.get")
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_poll_aircraft_skips_when_stream_active(self, mock_get):
        """Test that poll_aircraft skips when streaming is active."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        poll_aircraft()

        mock_get.assert_not_called()

    @patch("skyspy.tasks.aircraft.sync_emit")
    @patch("skyspy.tasks.aircraft.httpx.get")
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=True, ULTRAFEEDER_URL="http://test-feeder:8080", FEEDER_LAT=47.5, FEEDER_LON=-122.0
    )
    def test_poll_aircraft_runs_when_stream_inactive(self, mock_get, mock_emit):
        """Test that poll_aircraft runs when streaming is not active."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=30)

        mock_response = MagicMock()
        mock_response.json.return_value = {"now": 1704067200.0, "messages": 100, "aircraft": []}
        mock_get.return_value = mock_response

        poll_aircraft()

        mock_get.assert_called_once()

    @patch("skyspy.tasks.aircraft.sync_emit")
    @patch("skyspy.tasks.aircraft.httpx.get")
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=False, ULTRAFEEDER_URL="http://test-feeder:8080", FEEDER_LAT=47.5, FEEDER_LON=-122.0
    )
    def test_poll_aircraft_runs_when_streaming_disabled(self, mock_get, mock_emit):
        """Test that poll_aircraft runs when streaming is disabled in settings."""
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        mock_response = MagicMock()
        mock_response.json.return_value = {"now": 1704067200.0, "messages": 100, "aircraft": []}
        mock_get.return_value = mock_response

        poll_aircraft()

        mock_get.assert_called_once()


@override_settings(**CELERY_TEST_SETTINGS)
class GetStreamTaskStatusTest(TestCase):
    """Tests for the get_stream_task_status function (P2: Task Dependencies)."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    @patch("skyspy.celery.app")
    def test_get_status_finds_running_stream(self, mock_app):
        """Test that get_stream_task_status finds a running stream task."""
        mock_inspect = MagicMock()
        mock_inspect.active.return_value = {
            "celery@worker1": [
                {
                    "name": "skyspy.tasks.aircraft_stream.stream_aircraft",
                    "id": "task-abc-123",
                },
                {
                    "name": "skyspy.tasks.aircraft.poll_aircraft",
                    "id": "task-def-456",
                },
            ]
        }
        mock_app.control.inspect.return_value = mock_inspect

        result = get_stream_task_status()

        self.assertTrue(result["running"])
        self.assertEqual(result["worker"], "celery@worker1")
        self.assertEqual(result["task_id"], "task-abc-123")
        self.assertEqual(result["source"], "inspect")

    @patch("skyspy.celery.app")
    def test_get_status_no_stream_running(self, mock_app):
        """Test that get_stream_task_status returns not running when no stream task."""
        mock_inspect = MagicMock()
        mock_inspect.active.return_value = {
            "celery@worker1": [
                {
                    "name": "skyspy.tasks.aircraft.poll_aircraft",
                    "id": "task-def-456",
                },
            ]
        }
        mock_app.control.inspect.return_value = mock_inspect

        result = get_stream_task_status()

        self.assertFalse(result["running"])
        self.assertEqual(result["worker"], "")
        self.assertEqual(result["task_id"], "")
        self.assertEqual(result["source"], "inspect")

    @patch("skyspy.celery.app")
    def test_get_status_no_active_tasks(self, mock_app):
        """Test that get_stream_task_status handles no active tasks."""
        mock_inspect = MagicMock()
        mock_inspect.active.return_value = {}
        mock_app.control.inspect.return_value = mock_inspect

        result = get_stream_task_status()

        self.assertFalse(result["running"])
        self.assertEqual(result["source"], "inspect")

    @patch("skyspy.celery.app")
    def test_get_status_inspect_returns_none(self, mock_app):
        """Test that None from inspect (no worker replies) falls back to cache.

        A None reply means status is unknown (inspect timeout/broker issue),
        not "not running" - assuming not running could spawn a duplicate stream.
        """
        mock_inspect = MagicMock()
        mock_inspect.active.return_value = None
        mock_app.control.inspect.return_value = mock_inspect
        cache.delete(CACHE_KEY_STREAM_ACTIVE)

        result = get_stream_task_status()

        self.assertFalse(result["running"])
        self.assertEqual(result["source"], "cache")

    @patch("skyspy.celery.app")
    def test_get_status_inspect_returns_none_stream_active_in_cache(self, mock_app):
        """Test that None from inspect + active cache flag reports running."""
        mock_inspect = MagicMock()
        mock_inspect.active.return_value = None
        mock_app.control.inspect.return_value = mock_inspect
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        result = get_stream_task_status()

        self.assertTrue(result["running"])
        self.assertEqual(result["source"], "cache")

    @patch("skyspy.celery.app")
    def test_get_status_falls_back_to_cache_on_error(self, mock_app):
        """Test that get_stream_task_status falls back to cache on inspect error."""
        mock_app.control.inspect.side_effect = Exception("Broker unavailable")
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        result = get_stream_task_status()

        self.assertTrue(result["running"])
        self.assertEqual(result["source"], "cache")
        self.assertEqual(result["worker"], "")
        self.assertEqual(result["task_id"], "")

    @patch("skyspy.celery.app")
    def test_get_status_falls_back_to_cache_not_running(self, mock_app):
        """Test that get_stream_task_status falls back to cache showing not running."""
        mock_app.control.inspect.side_effect = Exception("Broker unavailable")
        cache.delete(CACHE_KEY_STREAM_ACTIVE)

        result = get_stream_task_status()

        self.assertFalse(result["running"])
        self.assertEqual(result["source"], "cache")


@override_settings(**CELERY_TEST_SETTINGS)
class StartAircraftStreamTest(TestCase):
    """Tests for the start_aircraft_stream starter task."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()

    @patch("skyspy.tasks.aircraft_stream.stream_aircraft")
    @override_settings(AIRCRAFT_STREAM_ENABLED=False)
    def test_start_stream_disabled(self, mock_stream):
        """Test that starter exits when streaming is disabled."""
        result = start_aircraft_stream()

        mock_stream.delay.assert_not_called()
        self.assertEqual(result["status"], "disabled")

    @patch("skyspy.tasks.aircraft_stream.get_stream_task_status")
    @patch("skyspy.tasks.aircraft_stream.stream_aircraft")
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_start_stream_already_active_via_inspect(self, mock_stream, mock_status):
        """Test that starter doesn't launch duplicate stream (detected via Celery inspect)."""
        mock_status.return_value = {
            "running": True,
            "worker": "celery@worker1",
            "task_id": "abc123",
            "source": "inspect",
        }

        result = start_aircraft_stream()

        mock_stream.delay.assert_not_called()
        self.assertEqual(result["status"], "already_running")
        self.assertEqual(result["worker"], "celery@worker1")
        self.assertEqual(result["task_id"], "abc123")
        self.assertEqual(result["detection_source"], "inspect")

    @patch("skyspy.tasks.aircraft_stream.get_stream_task_status")
    @patch("skyspy.tasks.aircraft_stream.stream_aircraft")
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_start_stream_already_active_via_cache_fallback(self, mock_stream, mock_status):
        """Test that starter doesn't launch duplicate stream (detected via cache fallback)."""
        mock_status.return_value = {
            "running": True,
            "worker": "",
            "task_id": "",
            "source": "cache",
        }

        result = start_aircraft_stream()

        mock_stream.delay.assert_not_called()
        self.assertEqual(result["status"], "already_running")
        self.assertEqual(result["detection_source"], "cache")

    @patch("skyspy.tasks.aircraft_stream.get_stream_task_status")
    @patch("skyspy.tasks.aircraft_stream.stream_aircraft")
    @override_settings(AIRCRAFT_STREAM_ENABLED=True)
    def test_start_stream_launches_task(self, mock_stream, mock_status):
        """Test that starter launches stream task when needed."""
        mock_status.return_value = {
            "running": False,
            "worker": "",
            "task_id": "",
            "source": "inspect",
        }
        mock_stream.delay.return_value = MagicMock(id="new-task-123")

        result = start_aircraft_stream()

        mock_stream.delay.assert_called_once()
        self.assertEqual(result["status"], "started")
        self.assertEqual(result["task_id"], "new-task-123")


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

    @patch("skyspy.tasks.aircraft_stream.socket.socket")
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=True,
        AIRCRAFT_STREAM_MODE="tcp",  # Must use TCP mode for socket patching to work
        AIRCRAFT_STREAM_HOST="test-host",
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

    @patch("skyspy.tasks.aircraft_stream.update_state_and_broadcast")
    @patch("skyspy.tasks.aircraft_stream.normalize_aircraft_fast")
    @patch("skyspy.tasks.aircraft_stream.socket.socket")
    @override_settings(
        AIRCRAFT_STREAM_ENABLED=True,
        AIRCRAFT_STREAM_MODE="tcp",  # Must use TCP mode for socket patching to work
        AIRCRAFT_STREAM_HOST="localhost",
        AIRCRAFT_STREAM_PORT=30047,
        AIRCRAFT_STREAM_RECONNECT_DELAY=1,
        AIRCRAFT_STREAM_BATCH_MS=0,  # Set to 0 so broadcast happens immediately
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

        with contextlib.suppress(KeyboardInterrupt):
            stream_aircraft()

        # At least one line should be processed and normalized before KeyboardInterrupt
        self.assertGreaterEqual(mock_normalize.call_count, 1)


class StreamAircraftCeleryConfigTest(TestCase):
    """Tests for Celery task configuration."""

    def test_stream_aircraft_is_shared_task(self):
        """Verify stream_aircraft is a shared task."""
        self.assertTrue(hasattr(stream_aircraft, "delay"))
        self.assertTrue(hasattr(stream_aircraft, "apply_async"))

    def test_start_aircraft_stream_is_shared_task(self):
        """Verify start_aircraft_stream is a shared task."""
        self.assertTrue(hasattr(start_aircraft_stream, "delay"))
        self.assertTrue(hasattr(start_aircraft_stream, "apply_async"))

    def test_flush_stream_to_database_is_shared_task(self):
        """Verify flush_stream_to_database is a shared task."""
        self.assertTrue(hasattr(flush_stream_to_database, "delay"))
        self.assertTrue(hasattr(flush_stream_to_database, "apply_async"))

    def test_process_new_aircraft_lookups_is_shared_task(self):
        """Verify process_new_aircraft_lookups is a shared task."""
        self.assertTrue(hasattr(process_new_aircraft_lookups, "delay"))
        self.assertTrue(hasattr(process_new_aircraft_lookups, "apply_async"))

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

        self.assertTrue(hasattr(settings, "AIRCRAFT_STREAM_ENABLED"))
        self.assertTrue(hasattr(settings, "AIRCRAFT_STREAM_HOST"))
        self.assertTrue(hasattr(settings, "AIRCRAFT_STREAM_PORT"))
        self.assertTrue(hasattr(settings, "AIRCRAFT_STREAM_RECONNECT_DELAY"))
        self.assertTrue(hasattr(settings, "AIRCRAFT_STREAM_BATCH_MS"))

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

    @patch("skyspy.tasks.aircraft_stream.sync_emit")
    def test_hot_path_does_not_touch_database(self, mock_emit):
        """Verify that update_state_and_broadcast doesn't do database operations."""
        batch = [
            {"hex": "A12345", "lat": 47.6, "lon": -122.3, "alt": 35000, "seen": 0.5},
        ]

        # Hot path should complete without direct database access
        # (it buffers data for later cold path writes)
        update_state_and_broadcast(batch)

        # Broadcasts should have been made
        self.assertTrue(mock_emit.called)

    def test_database_writes_are_buffered(self):
        """Verify that database writes go to buffer, not direct to DB."""
        with patch("skyspy.tasks.aircraft_stream.sync_emit"):
            batch = [
                {"hex": "A12345", "lat": 47.6, "lon": -122.3, "seen": 0.5},
                {"hex": "A67890", "lat": 47.7, "lon": -122.4, "seen": 0.3},
            ]

            update_state_and_broadcast(batch)

        # Check buffer has data
        with _db_buffer_lock:
            self.assertEqual(len(_db_write_buffer), 2)

    def test_cache_sync_is_separate_from_broadcast(self):
        """Verify that cache sync is a separate operation from broadcast."""
        # Set up in-memory state
        with _aircraft_state_lock:
            _aircraft_state["A12345"] = {"hex": "A12345", "lat": 47.6}

        # Cache should be empty before sync
        self.assertIsNone(cache.get(CACHE_KEY_AIRCRAFT))

        # Sync cache
        sync_cache_state()

        # Now cache should have data
        self.assertIsNotNone(cache.get(CACHE_KEY_AIRCRAFT))


# ============================================================================
# P2: Differential WebSocket Update Tests
# ============================================================================


class ComputeFieldChangesTest(TestCase):
    """Tests for the _compute_field_changes function."""

    def test_compute_field_changes_no_changes(self):
        """Test that no changes returns empty dict."""
        prev = {"lat": 40.0, "lon": -74.0, "alt": 30000, "track": 180}
        curr = {"lat": 40.0, "lon": -74.0, "alt": 30000, "track": 180}
        changes = _compute_field_changes(prev, curr)
        self.assertEqual(changes, {})

    def test_compute_field_changes_single_change(self):
        """Test detection of a single field change."""
        prev = {"lat": 40.0, "lon": -74.0, "alt": 30000}
        curr = {"lat": 40.1, "lon": -74.0, "alt": 30000}
        changes = _compute_field_changes(prev, curr)
        self.assertEqual(changes, {"lat": 40.1})

    def test_compute_field_changes_multiple_changes(self):
        """Test detection of multiple field changes."""
        prev = {"lat": 40.0, "lon": -74.0, "alt": 30000, "track": 180}
        curr = {"lat": 40.1, "lon": -74.0, "alt": 31000, "track": 185}
        changes = _compute_field_changes(prev, curr)
        self.assertEqual(changes, {"lat": 40.1, "alt": 31000, "track": 185})

    def test_compute_field_changes_only_tracked_fields(self):
        """Test that only TRACKED_FIELDS are compared."""
        prev = {"lat": 40.0, "lon": -74.0, "some_other_field": "old"}
        curr = {"lat": 40.0, "lon": -74.0, "some_other_field": "new"}
        changes = _compute_field_changes(prev, curr)
        # some_other_field is not in TRACKED_FIELDS, so no changes detected
        self.assertEqual(changes, {})

    def test_compute_field_changes_new_field(self):
        """Test detection when a tracked field is added."""
        prev = {"lat": 40.0}
        curr = {"lat": 40.0, "squawk": "1234"}
        changes = _compute_field_changes(prev, curr)
        self.assertEqual(changes, {"squawk": "1234"})

    def test_compute_field_changes_removed_field(self):
        """Test detection when a tracked field is removed (becomes None)."""
        prev = {"lat": 40.0, "squawk": "1234"}
        curr = {"lat": 40.0}
        changes = _compute_field_changes(prev, curr)
        self.assertEqual(changes, {"squawk": None})

    def test_tracked_fields_completeness(self):
        """Verify TRACKED_FIELDS contains expected fields."""
        expected = {"lat", "lon", "alt", "alt_baro", "gs", "track", "vr", "squawk", "flight", "ghost"}
        self.assertEqual(TRACKED_FIELDS, expected)


class ComputeAircraftDeltaTest(TestCase):
    """Tests for the compute_aircraft_delta function."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    def test_first_call_full_update(self):
        """Test that first call triggers full update (all aircraft are new)."""
        current = [
            {"hex": "AC1", "lat": 40.0, "lon": -74.0},
            {"hex": "AC2", "lat": 41.0, "lon": -73.0},
        ]
        delta = compute_aircraft_delta(current)

        self.assertTrue(delta["full_update"])
        self.assertEqual(len(delta["aircraft"]), 2)

    def test_no_changes_returns_delta(self):
        """Test that no changes returns empty delta."""
        current = [
            {"hex": "AC1", "lat": 40.0, "lon": -74.0},
            {"hex": "AC2", "lat": 41.0, "lon": -73.0},
        ]
        # First call to populate state
        compute_aircraft_delta(current)

        # Second call with same data
        delta = compute_aircraft_delta(current)

        self.assertFalse(delta["full_update"])
        self.assertEqual(len(delta["added"]), 0)
        self.assertEqual(len(delta["updated"]), 0)
        self.assertEqual(len(delta["removed"]), 0)

    def test_minor_updates_returns_delta(self):
        """Test that minor updates (< 50%) returns delta update."""
        # Start with 10 aircraft
        initial = [{"hex": f"AC{i}", "lat": 40 + i * 0.1, "lon": -74.0} for i in range(10)]
        compute_aircraft_delta(initial)

        # Update 2 aircraft (20% change)
        current = [{"hex": f"AC{i}", "lat": 40 + i * 0.1, "lon": -74.0} for i in range(10)]
        current[0]["lat"] = 40.15  # Changed
        current[1]["lat"] = 40.25  # Changed

        delta = compute_aircraft_delta(current)

        self.assertFalse(delta["full_update"])
        self.assertEqual(len(delta["updated"]), 2)
        self.assertTrue(any(u["hex"] == "AC0" for u in delta["updated"]))
        self.assertTrue(any(u["hex"] == "AC1" for u in delta["updated"]))

    def test_removal_returns_delta_with_removed_list(self):
        """Test that aircraft removal is tracked in delta."""
        # Start with 10 aircraft
        initial = [{"hex": f"AC{i}", "lat": 40 + i * 0.1, "lon": -74.0} for i in range(10)]
        compute_aircraft_delta(initial)

        # Remove 1 aircraft (10% change)
        current = [{"hex": f"AC{i}", "lat": 40 + i * 0.1, "lon": -74.0} for i in range(1, 10)]

        delta = compute_aircraft_delta(current)

        self.assertFalse(delta["full_update"])
        self.assertIn("AC0", delta["removed"])

    def test_addition_returns_delta_with_added_list(self):
        """Test that new aircraft are tracked in delta."""
        # Start with 10 aircraft
        initial = [{"hex": f"AC{i}", "lat": 40 + i * 0.1, "lon": -74.0} for i in range(10)]
        compute_aircraft_delta(initial)

        # Add 1 new aircraft
        current = initial + [{"hex": "ACNEW", "lat": 45.0, "lon": -70.0}]

        delta = compute_aircraft_delta(current)

        self.assertFalse(delta["full_update"])
        self.assertEqual(len(delta["added"]), 1)
        self.assertEqual(delta["added"][0]["hex"], "ACNEW")

    def test_large_change_triggers_full_update(self):
        """Test that > 50% changes triggers full update."""
        # Start with 4 aircraft
        initial = [{"hex": f"AC{i}", "lat": 40 + i * 0.1, "lon": -74.0} for i in range(4)]
        compute_aircraft_delta(initial)

        # Remove 3 (75% of current state is change)
        current = [{"hex": "AC0", "lat": 40.0, "lon": -74.0}]

        delta = compute_aircraft_delta(current)

        self.assertTrue(delta["full_update"])

    def test_update_only_changed_fields(self):
        """Test that updates contain only changed fields.

        We include multiple aircraft so that a single field change stays
        under the 50% churn threshold that triggers a full_update.
        """
        initial = [
            {"hex": "AC1", "lat": 40.0, "lon": -74.0, "alt": 30000, "track": 180},
            {"hex": "AC2", "lat": 41.0, "lon": -73.0, "alt": 25000, "track": 90},
            {"hex": "AC3", "lat": 42.0, "lon": -72.0, "alt": 20000, "track": 270},
        ]
        compute_aircraft_delta(initial)

        current = [
            {"hex": "AC1", "lat": 40.1, "lon": -74.0, "alt": 30000, "track": 180},
            {"hex": "AC2", "lat": 41.0, "lon": -73.0, "alt": 25000, "track": 90},
            {"hex": "AC3", "lat": 42.0, "lon": -72.0, "alt": 20000, "track": 270},
        ]
        delta = compute_aircraft_delta(current)

        self.assertFalse(delta["full_update"])
        self.assertEqual(len(delta["updated"]), 1)
        updated = delta["updated"][0]
        self.assertEqual(updated["hex"], "AC1")
        self.assertEqual(updated["lat"], 40.1)
        # Should not include unchanged fields
        self.assertNotIn("lon", updated)
        self.assertNotIn("alt", updated)
        self.assertNotIn("track", updated)

    def test_clear_delta_state(self):
        """Test that clear_delta_state resets state."""
        import skyspy.tasks.aircraft_stream as stream_module

        # Populate state
        initial = [{"hex": "AC1", "lat": 40.0, "lon": -74.0}]
        compute_aircraft_delta(initial)

        # Verify state is populated
        with stream_module._previous_aircraft_state_lock:
            self.assertEqual(len(stream_module._previous_aircraft_state), 1)

        # Clear state
        clear_delta_state()

        # Verify state is empty
        with stream_module._previous_aircraft_state_lock:
            self.assertEqual(len(stream_module._previous_aircraft_state), 0)


@override_settings(**CELERY_TEST_SETTINGS)
class BroadcastAircraftDeltaTest(TestCase):
    """Tests for the broadcast_aircraft_delta function."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    @patch("skyspy.tasks.aircraft_stream.sync_emit")
    def test_broadcast_full_update(self, mock_emit):
        """Test that full update sends correct payload."""
        delta = {
            "full_update": True,
            "aircraft": [{"hex": "AC1", "lat": 40.0}],
            "added": [],
            "updated": [],
            "removed": [],
        }
        timestamp = "2024-01-15T12:00:00Z"

        broadcast_aircraft_delta(delta, timestamp)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        self.assertEqual(call_args[0][0], "aircraft:update")
        payload = call_args[0][1]
        self.assertEqual(payload["type"], "full")
        self.assertEqual(payload["aircraft"], [{"hex": "AC1", "lat": 40.0}])
        self.assertEqual(payload["timestamp"], timestamp)

    @patch("skyspy.tasks.aircraft_stream.sync_emit")
    def test_broadcast_delta_update(self, mock_emit):
        """Test that delta update sends correct payload."""
        delta = {
            "full_update": False,
            "aircraft": [],
            "added": [{"hex": "ACNEW", "lat": 45.0}],
            "updated": [{"hex": "AC1", "lat": 40.1}],
            "removed": ["AC2"],
        }
        timestamp = "2024-01-15T12:00:00Z"

        broadcast_aircraft_delta(delta, timestamp)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        self.assertEqual(call_args[0][0], "aircraft:update")
        payload = call_args[0][1]
        self.assertEqual(payload["type"], "delta")
        self.assertEqual(payload["added"], [{"hex": "ACNEW", "lat": 45.0}])
        self.assertEqual(payload["updated"], [{"hex": "AC1", "lat": 40.1}])
        self.assertEqual(payload["removed"], ["AC2"])
        self.assertEqual(payload["timestamp"], timestamp)


class DifferentialUpdateIntegrationTest(TestCase):
    """Integration tests for differential updates in update_state_and_broadcast."""

    def setUp(self):
        cache.clear()
        reset_stream_state()

    def tearDown(self):
        cache.clear()
        reset_stream_state()

    @patch("skyspy.tasks.aircraft_stream.sync_emit")
    def test_update_state_uses_delta_on_second_call(self, mock_emit):
        """Test that update_state_and_broadcast uses delta after first call."""
        # First call - full update
        batch1 = [
            {"hex": "AC1", "lat": 40.0, "lon": -74.0, "seen": 0.5},
            {"hex": "AC2", "lat": 41.0, "lon": -73.0, "seen": 0.5},
        ]
        update_state_and_broadcast(batch1)

        # Check that aircraft:update was called with full type
        aircraft_update_calls = [call for call in mock_emit.call_args_list if call[0][0] == "aircraft:update"]
        self.assertTrue(len(aircraft_update_calls) >= 1)
        first_update = aircraft_update_calls[0][0][1]
        self.assertEqual(first_update.get("type"), "full")

        mock_emit.reset_mock()

        # Second call with minor changes
        batch2 = [
            {"hex": "AC1", "lat": 40.1, "lon": -74.0, "seen": 0.5},  # lat changed
            {"hex": "AC2", "lat": 41.0, "lon": -73.0, "seen": 0.5},  # unchanged
        ]
        update_state_and_broadcast(batch2)

        # Check that aircraft:update was called with delta type
        aircraft_update_calls = [call for call in mock_emit.call_args_list if call[0][0] == "aircraft:update"]
        self.assertTrue(len(aircraft_update_calls) >= 1)
        second_update = aircraft_update_calls[0][0][1]
        self.assertEqual(second_update.get("type"), "delta")
        self.assertEqual(len(second_update.get("updated", [])), 1)


@pytest.mark.django_db
def test_flush_failure_requeues_entire_batch_in_order():
    """A failed flush must requeue ALL buffered rows, not just the first 1000.

    The whole batch is rolled back by transaction.atomic(), so anything not
    requeued is permanently lost; the deque's maxlen is the sole loss bound.
    """
    import skyspy.tasks.aircraft_stream as stream_module

    reset_stream_state()
    try:
        with stream_module._db_buffer_lock:
            for i in range(1500):
                stream_module._db_write_buffer.append({"hex": f"{i:06X}", "lat": 40.0, "lon": -74.0})

        with patch(
            "skyspy.models.AircraftSighting.objects.bulk_create",
            side_effect=Exception("db down"),
        ):
            flush_stream_to_database()

        with stream_module._db_buffer_lock:
            requeued = list(stream_module._db_write_buffer)

        assert len(requeued) == 1500
        # Chronological order preserved (oldest first)
        assert requeued[0]["hex"] == "000000"
        assert requeued[-1]["hex"] == f"{1499:06X}"
    finally:
        reset_stream_state()


@pytest.mark.django_db
def test_flush_failure_requeues_ahead_of_newer_rows():
    """Requeued rows must sit ahead of rows buffered after the failed flush."""
    import skyspy.tasks.aircraft_stream as stream_module

    reset_stream_state()
    try:
        with stream_module._db_buffer_lock:
            stream_module._db_write_buffer.append({"hex": "AAAAAA", "lat": 40.0, "lon": -74.0})
            stream_module._db_write_buffer.append({"hex": "BBBBBB", "lat": 41.0, "lon": -73.0})

        def fail_and_buffer_new_row(*args, **kwargs):
            raise Exception("db down")

        with patch(
            "skyspy.models.AircraftSighting.objects.bulk_create",
            side_effect=fail_and_buffer_new_row,
        ):
            flush_stream_to_database()

        # A newer row arrives after the failed flush requeued the batch
        with stream_module._db_buffer_lock:
            stream_module._db_write_buffer.append({"hex": "CCCCCC", "lat": 42.0, "lon": -72.0})
            hexes = [ac["hex"] for ac in stream_module._db_write_buffer]

        assert hexes == ["AAAAAA", "BBBBBB", "CCCCCC"]
    finally:
        reset_stream_state()
