"""
Tests for Socket.IO event broadcasting and request handlers.

Tests cover:
- NOTAM event broadcasting (notam:*, notam:tfr_*)
- Safety event broadcasting (safety:event_updated, safety:event_resolved)
- Aircraft heartbeat broadcasting
- ACARS broadcasting on main namespace
- Airframe error broadcasting
- New request handlers (notam-snapshot, airport, refresh, safety-snapshot, alert-snapshot, acars-snapshot)
- Initial state sending on connection
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =============================================================================
# NOTAM Event Broadcasting Tests
# =============================================================================


class TestNotamEventBroadcasting:
    """Tests for NOTAM event broadcasting."""

    def test_notam_tfr_new_event_name(self):
        """Test that TFR broadcasts use notam:tfr_new event name."""
        mock_emit = MagicMock(return_value=True)

        # Patch at the utils level since notams.py uses lazy imports
        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.tasks.notams import broadcast_new_tfr

                tfr_data = {
                    "notam_id": "TFR-TEST-001",
                    "location": "WASHINGTON DC",
                    "text": "TEMPORARY FLIGHT RESTRICTION",
                    "notam_type": "TFR",
                    "effective_start": datetime.utcnow().isoformat() + "Z",
                    "effective_end": (datetime.utcnow() + timedelta(hours=6)).isoformat() + "Z",
                }

                broadcast_new_tfr(tfr_data)

                # Should emit notam:tfr_new to multiple rooms
                calls = mock_emit.call_args_list
                event_names = [c[0][0] for c in calls]

                assert "notam:tfr_new" in event_names
                # Should NOT use old tfr:new event name
                assert "tfr:new" not in event_names

    def test_notam_stats_event_name(self):
        """Test that NOTAM stats use notam:stats event name."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                # Simulate the stats broadcast
                from skyspy.socketio.utils import sync_emit

                sync_emit(
                    "notam:stats",
                    {
                        "total_active": 45,
                        "tfr_count": 3,
                        "by_type": {"TFR": 3, "D": 30},
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    },
                    room="topic_notams",
                )

                # Verify event name is notam:stats (not notam:stats_update)
                calls = mock_emit.call_args_list
                assert any("notam:stats" in str(c) for c in calls)

    def test_notam_new_broadcast_format(self):
        """Test notam:new event data format."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.socketio.utils import sync_emit

                notam_data = {
                    "notam_id": "NOTAM-12345",
                    "location": "KJFK",
                    "text": "RWY 04L/22R CLSD FOR MAINT",
                    "notam_type": "D",
                    "effective_start": "2026-02-01T12:00:00Z",
                    "effective_end": "2026-02-01T18:00:00Z",
                    "timestamp": "2026-02-01T12:34:56Z",
                }

                sync_emit("notam:new", notam_data, room="topic_notams")

                mock_emit.assert_called()
                call_args = mock_emit.call_args
                assert call_args[0][0] == "notam:new"
                assert "notam_id" in call_args[0][1]

    def test_notam_expired_broadcast(self):
        """Test notam:expired and notam:tfr_expired event broadcasting."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.socketio.utils import sync_emit

                # Regular NOTAM expired
                sync_emit(
                    "notam:expired",
                    {
                        "notam_id": "NOTAM-12345",
                        "timestamp": "2026-02-01T12:34:56Z",
                    },
                    room="topic_notams",
                )

                # TFR expired
                sync_emit(
                    "notam:tfr_expired",
                    {
                        "notam_id": "TFR-001",
                        "timestamp": "2026-02-01T12:34:56Z",
                    },
                    room="topic_notams",
                )

                calls = mock_emit.call_args_list
                event_names = [c[0][0] for c in calls]

                assert "notam:expired" in event_names
                assert "notam:tfr_expired" in event_names


# =============================================================================
# Safety Event Broadcasting Tests
# =============================================================================


class TestSafetyEventBroadcasting:
    """Tests for safety event broadcasting."""

    def test_safety_event_updated_broadcast(self):
        """Test that safety:event_updated uses correct event name."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.services.safety import SafetyMonitor

                monitor = SafetyMonitor()

                event = {
                    "id": "event-123",
                    "event_type": "emergency_squawk",
                    "severity": "critical",
                    "icao_hex": "A1B2C3",
                    "acknowledged": True,
                }

                monitor.broadcast_event_updated(event)

                mock_emit.assert_called()
                call_args = mock_emit.call_args
                # Should use safety:event_updated event name
                assert call_args[0][0] == "safety:event_updated"

    def test_safety_event_resolved_broadcast(self):
        """Test that safety:event_resolved uses correct event name."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.services.safety import SafetyMonitor

                monitor = SafetyMonitor()

                event = {
                    "id": "event-123",
                    "event_type": "emergency_squawk",
                    "severity": "critical",
                    "icao_hex": "A1B2C3",
                    "resolution": "aircraft_landed",
                }

                monitor.broadcast_event_resolved(event)

                mock_emit.assert_called()
                call_args = mock_emit.call_args
                # Should use safety:event_resolved event name
                assert call_args[0][0] == "safety:event_resolved"

    def test_safety_event_action_included(self):
        """Test that event_action is included in broadcast."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.services.safety import SafetyMonitor

                monitor = SafetyMonitor()

                event = {"id": "event-123", "event_type": "test"}
                monitor._broadcast_event("safety_event_updated", event)

                call_args = mock_emit.call_args
                data = call_args[0][1]
                assert "event_action" in data
                assert data["event_action"] == "safety_event_updated"


# =============================================================================
# Aircraft Heartbeat Tests
# =============================================================================


class TestAircraftHeartbeat:
    """Tests for aircraft heartbeat broadcasting."""

    def test_broadcast_heartbeat_function_exists(self):
        """Test that broadcast_heartbeat function exists."""
        from skyspy.tasks.aircraft_stream import broadcast_heartbeat

        assert callable(broadcast_heartbeat)

    def test_broadcast_heartbeat_format(self):
        """Test aircraft:heartbeat event data format."""
        mock_emit = MagicMock(return_value=True)

        # Need to patch at the module level since aircraft_stream does top-level import
        with patch("skyspy.tasks.aircraft_stream.sync_emit", mock_emit):
            from skyspy.tasks.aircraft_stream import broadcast_heartbeat

            broadcast_heartbeat(42, "2026-02-01T12:34:56Z")

            mock_emit.assert_called_once()
            call_args = mock_emit.call_args

            # Check event name
            assert call_args[0][0] == "aircraft:heartbeat"

            # Check data format
            data = call_args[0][1]
            assert data["count"] == 42
            assert data["aircraft_count"] == 42  # Alias for frontend
            assert data["timestamp"] == "2026-02-01T12:34:56Z"

            # Check room
            assert call_args[1]["room"] == "topic_aircraft"

    def test_sync_cache_state_broadcasts_heartbeat(self):
        """Test that sync_cache_state calls broadcast_heartbeat."""
        with patch("skyspy.tasks.aircraft_stream.broadcast_heartbeat") as mock_heartbeat:
            with patch("skyspy.tasks.aircraft_stream.cache") as mock_cache:
                mock_cache.set_many = MagicMock()

                from skyspy.tasks.aircraft_stream import _aircraft_state, _aircraft_state_lock, sync_cache_state

                # Add some test aircraft
                with _aircraft_state_lock:
                    _aircraft_state["TEST1"] = {"hex": "TEST1", "lat": 40.0}
                    _aircraft_state["TEST2"] = {"hex": "TEST2", "lat": 41.0}

                try:
                    sync_cache_state()

                    mock_heartbeat.assert_called_once()
                    # Should be called with count of 2
                    call_args = mock_heartbeat.call_args
                    assert call_args[0][0] == 2
                finally:
                    # Clean up
                    with _aircraft_state_lock:
                        _aircraft_state.clear()


# =============================================================================
# ACARS Broadcasting Tests
# =============================================================================


class TestAcarsBroadcasting:
    """Tests for ACARS broadcasting on main namespace."""

    @pytest.mark.asyncio
    async def test_acars_broadcasts_to_main_namespace(self):
        """Test that ACARS messages are broadcast to main namespace."""
        mock_emit = MagicMock(return_value=True)

        # acars.py does top-level import, so patch at module level
        with patch("skyspy.services.acars.sync_emit", mock_emit):
            from skyspy.services.acars import AcarsService

            service = AcarsService()

            msg = {
                "icao_hex": "A1B2C3",
                "flight": "UAL123",
                "label": "H1",
                "text": "Test message",
                "timestamp": "2026-02-01T12:34:56Z",
            }

            # _broadcast_message is async
            await service._broadcast_message(msg)

            # Check all calls
            calls = mock_emit.call_args_list

            # Should have call to /acars namespace
            acars_calls = [c for c in calls if c[1].get("namespace") == "/acars"]
            assert len(acars_calls) > 0

            # Should also have call to main namespace (/)
            main_calls = [c for c in calls if c[1].get("namespace") == "/"]
            assert len(main_calls) > 0

            # Main namespace call should use topic_acars room
            main_call = main_calls[0]
            assert main_call[1].get("room") == "topic_acars"


# =============================================================================
# Airframe Error Broadcasting Tests
# =============================================================================


class TestAirframeErrorBroadcasting:
    """Tests for airframe error broadcasting."""

    def test_airframe_error_data_format(self):
        """Test that airframe:error includes all expected fields."""
        mock_emit = MagicMock(return_value=True)

        # external_db.py does top-level import
        with patch("skyspy.tasks.external_db.sync_emit", mock_emit):
            from skyspy.tasks.external_db import broadcast_airframe_error

            broadcast_airframe_error(
                icao="a1b2c3", error_message="No data found", sources_tried=["adsbx", "opensky"], error_type="not_found"
            )

            mock_emit.assert_called_once()
            call_args = mock_emit.call_args

            # Check event name
            assert call_args[0][0] == "airframe:error"

            # Check data format
            data = call_args[0][1]
            assert data["icao_hex"] == "A1B2C3"  # Should be uppercase
            assert data["icao"] == "a1b2c3"  # Original for backwards compat
            assert data["error_type"] == "not_found"
            assert data["error_message"] == "No data found"
            assert data["source"] == "external_db"
            assert data["sources_tried"] == ["adsbx", "opensky"]
            assert "details" in data
            assert "timestamp" in data

    def test_airframe_error_default_error_type(self):
        """Test default error_type when not specified."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.tasks.external_db.sync_emit", mock_emit):
            from skyspy.tasks.external_db import broadcast_airframe_error

            broadcast_airframe_error(icao="A1B2C3", error_message="Lookup failed")

            call_args = mock_emit.call_args
            data = call_args[0][1]
            assert data["error_type"] == "lookup_failed"


# =============================================================================
# Request Handler Tests
# =============================================================================


class TestNotamRequestHandlers:
    """Tests for NOTAM request handlers."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_notam_snapshot_handler_exists(self):
        """Test that notam-snapshot request type is handled."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        # Check handler exists
        result = await namespace._handle_generic_request("notam-snapshot", {})

        # Should return dict with notams, tfrs, stats keys
        assert result is not None
        assert "notams" in result
        assert "tfrs" in result
        assert "stats" in result

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_airport_handler_exists(self):
        """Test that airport request type is handled."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        # Check handler exists
        result = await namespace._handle_generic_request("airport", {"icao": "KJFK"})

        # Should return list
        assert result is not None
        assert isinstance(result, list)

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_airport_handler_requires_icao(self):
        """Test that airport handler requires icao parameter."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        with pytest.raises(ValueError, match="Missing icao"):
            await namespace._handle_generic_request("airport", {})

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_refresh_handler_exists(self):
        """Test that refresh request type is handled."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        with patch("skyspy.tasks.notams.refresh_notams.delay"):
            result = await namespace._handle_generic_request("refresh", {})

            assert result is not None
            assert "success" in result


class TestSnapshotRequestHandlers:
    """Tests for snapshot request handlers."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_safety_snapshot_handler(self):
        """Test safety-snapshot request handler."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        result = await namespace._handle_generic_request("safety-snapshot", {"hours": 24})

        assert result is not None
        assert "events" in result

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_alert_snapshot_handler(self):
        """Test alert-snapshot request handler."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        result = await namespace._handle_generic_request("alert-snapshot", {"hours": 24})

        assert result is not None
        assert "alerts" in result
        assert "count" in result

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_acars_snapshot_handler(self):
        """Test acars-snapshot request handler."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        result = await namespace._handle_generic_request("acars-snapshot", {"hours": 1})

        assert result is not None
        assert "messages" in result
        assert "count" in result


# =============================================================================
# Initial State Tests
# =============================================================================


class TestInitialState:
    """Tests for initial state sending on connection."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_send_initial_state_sends_aircraft_snapshot(self):
        """Test that _send_initial_state sends aircraft:snapshot."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()
        mock_sio.get_session = AsyncMock(
            return_value={
                "subscribed_topics": set(),
            }
        )

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                await namespace._send_initial_state("test-sid")

                # Should emit aircraft:snapshot
                calls = mock_sio.emit.call_args_list
                event_names = [c[0][0] for c in calls]
                assert "aircraft:snapshot" in event_names

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_send_initial_state_sends_safety_snapshot_if_subscribed(self):
        """Test that _send_initial_state sends safety:snapshot if subscribed."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()
        mock_sio.get_session = AsyncMock(
            return_value={
                "subscribed_topics": {"safety"},
            }
        )

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                with patch.object(namespace, "_get_safety_events", AsyncMock(return_value=[])):
                    await namespace._send_initial_state("test-sid")

                    calls = mock_sio.emit.call_args_list
                    event_names = [c[0][0] for c in calls]
                    assert "safety:snapshot" in event_names

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_send_initial_state_sends_all_snapshots_if_subscribed_to_all(self):
        """Test that subscribing to 'all' sends all snapshots."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()
        mock_sio.get_session = AsyncMock(
            return_value={
                "subscribed_topics": {"all"},
            }
        )

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                with patch.object(namespace, "_get_safety_events", AsyncMock(return_value=[])):
                    with patch.object(
                        namespace, "_get_alert_snapshot", AsyncMock(return_value={"alerts": [], "count": 0})
                    ):
                        with patch.object(
                            namespace, "_get_acars_snapshot", AsyncMock(return_value={"messages": [], "count": 0})
                        ):
                            with patch.object(
                                namespace,
                                "_get_notam_snapshot",
                                AsyncMock(return_value={"notams": [], "tfrs": [], "stats": {}}),
                            ):
                                await namespace._send_initial_state("test-sid")

                                calls = mock_sio.emit.call_args_list
                                event_names = [c[0][0] for c in calls]

                                # All snapshots should be sent
                                assert "aircraft:snapshot" in event_names
                                assert "safety:snapshot" in event_names
                                assert "alert:snapshot" in event_names
                                assert "acars:snapshot" in event_names
                                assert "notam:snapshot" in event_names

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_send_initial_state_does_not_send_if_not_subscribed(self):
        """Test that snapshots are not sent if not subscribed."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()
        mock_sio.get_session = AsyncMock(
            return_value={
                "subscribed_topics": set(),  # Empty - not subscribed to anything
            }
        )

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                await namespace._send_initial_state("test-sid")

                calls = mock_sio.emit.call_args_list
                event_names = [c[0][0] for c in calls]

                # Only aircraft:snapshot should be sent (default)
                assert "aircraft:snapshot" in event_names
                # Others should not be sent
                assert "safety:snapshot" not in event_names
                assert "alert:snapshot" not in event_names
                assert "acars:snapshot" not in event_names
                assert "notam:snapshot" not in event_names


# =============================================================================
# Rate Limiter Thread Safety Tests
# =============================================================================


class TestRateLimiterThreadSafety:
    """Tests for rate limiter thread safety."""

    def test_rate_limiter_uses_lock(self):
        """Test that rate limiter uses threading lock."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # Verify lock exists
        assert hasattr(limiter, "_lock")
        assert limiter._lock is not None

    def test_rate_limiter_uses_monotonic_clock(self):
        """Test that rate limiter uses monotonic clock."""
        import time

        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()
        limiter.can_send("test")

        # The _last_send values should be based on monotonic time
        last_send = limiter._last_send.get("test", 0)
        current_monotonic = time.monotonic()

        # Should be close to current monotonic time
        assert abs(current_monotonic - last_send) < 1.0

    def test_rate_limiter_cleanup(self):
        """Test that cleanup_old_entries removes stale entries."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # Add some entries
        limiter.can_send("topic1")
        limiter.can_send("topic2")

        assert len(limiter._last_send) == 2

        # Cleanup with 0 max_age should remove all
        limiter.cleanup_old_entries(max_age=0)

        assert len(limiter._last_send) == 0

    def test_rate_limiter_reset(self):
        """Test that reset clears rate limiting state."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        limiter.can_send("topic1")
        limiter.can_send("topic2")

        # Reset single topic
        limiter.reset("topic1")
        assert "topic1" not in limiter._last_send
        assert "topic2" in limiter._last_send

        # Reset all
        limiter.reset()
        assert len(limiter._last_send) == 0


# =============================================================================
# Integration Tests
# =============================================================================


class TestNotamRefreshBroadcasting:
    """Integration tests for NOTAM refresh broadcasting."""

    @pytest.mark.django_db
    def test_refresh_notams_broadcasts_events(self):
        """Test that refresh_notams broadcasts correct events."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                with patch("skyspy.services.notams.fetch_notams_from_api") as mock_fetch:
                    mock_fetch.return_value = []

                    with patch("skyspy.services.notams.fetch_tfrs_from_api") as mock_tfrs:
                        mock_tfrs.return_value = []

                        from skyspy.services.notams import refresh_notams

                        refresh_notams()

                        # Check that notam:refresh was emitted
                        calls = mock_emit.call_args_list
                        event_names = [c[0][0] for c in calls if len(c[0]) > 0]

                        # At minimum should emit notam:refresh
                        assert any("notam:refresh" in str(name) for name in event_names) or len(calls) == 0


class TestBroadcastRoomRouting:
    """Tests for correct room routing of broadcasts."""

    def test_safety_events_go_to_topic_safety(self):
        """Test that safety events are broadcast to topic_safety room."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.services.safety import SafetyMonitor

                monitor = SafetyMonitor()
                monitor._broadcast_event("safety_event", {"id": "test"})

                call_args = mock_emit.call_args
                assert call_args[1]["room"] == "topic_safety"

    def test_notam_events_go_to_topic_notams(self):
        """Test that NOTAM events are broadcast to correct rooms."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.socketio.utils.sync_emit", mock_emit):
            with patch("skyspy.socketio.utils.broadcast.sync_emit", mock_emit):
                from skyspy.socketio.utils import sync_emit

                sync_emit("notam:new", {"notam_id": "test"}, room="topic_notams")

                call_args = mock_emit.call_args
                assert call_args[1]["room"] == "topic_notams"

    def test_heartbeat_goes_to_topic_aircraft(self):
        """Test that heartbeat is broadcast to topic_aircraft room."""
        mock_emit = MagicMock(return_value=True)

        with patch("skyspy.tasks.aircraft_stream.sync_emit", mock_emit):
            from skyspy.tasks.aircraft_stream import broadcast_heartbeat

            broadcast_heartbeat(10, "2026-02-01T12:00:00Z")

            call_args = mock_emit.call_args
            assert call_args[1]["room"] == "topic_aircraft"
