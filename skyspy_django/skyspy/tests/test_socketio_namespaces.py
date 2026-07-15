"""
Tests for Socket.IO namespace implementations.

Tests cover:
- Namespace class initialization
- Authentication middleware
- Permission checking
- Rate limiter and batcher utilities
- Broadcast utilities
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from django.contrib.auth.models import AnonymousUser


class TestRateLimiter:
    """Tests for the RateLimiter utility."""

    def test_rate_limiter_initialization(self):
        """Test that RateLimiter initializes with default rates."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()
        assert limiter is not None
        # Default rate for aircraft:update is 10 Hz
        assert limiter.can_send("aircraft:update") is True

    def test_rate_limiter_respects_limits(self):
        """Test that rate limiter blocks rapid sends."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # First send should always succeed
        assert limiter.can_send("stats:update") is True

        # Second immediate send should be blocked (stats is 0.5 Hz = 2s interval)
        assert limiter.can_send("stats:update") is False

    def test_rate_limiter_custom_rates(self):
        """Test rate limiter with custom rates."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        custom_rates = {"test:topic": 1.0}  # 1 Hz sustained, burst of rate*BURST_SECONDS
        limiter = RateLimiter(rate_limits=custom_rates)

        from skyspy.socketio.utils.rate_limiter import BURST_SECONDS

        burst = max(1, int(1.0 * BURST_SECONDS))
        for _ in range(burst):
            assert limiter.can_send("test:topic") is True
        assert limiter.can_send("test:topic") is False

    def test_rate_limiter_get_wait_time(self):
        """Test get_wait_time returns correct delay."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()
        limiter.can_send("stats:update")  # Mark as sent

        wait_time = limiter.get_wait_time("stats:update")
        # stats:update is 0.5 Hz, so wait should be close to 2 seconds
        assert wait_time > 0
        assert wait_time <= 2.0


class TestMessageBatcher:
    """Tests for the MessageBatcher utility."""

    @pytest.mark.asyncio
    async def test_batcher_initialization(self):
        """Test that MessageBatcher initializes correctly."""
        from skyspy.socketio.utils.batcher import MessageBatcher

        callback = AsyncMock()
        batcher = MessageBatcher(callback)
        assert batcher is not None
        assert batcher.pending_count == 0

    @pytest.mark.asyncio
    async def test_batcher_adds_messages(self):
        """Test that batcher accumulates messages."""
        from skyspy.socketio.utils.batcher import MessageBatcher

        callback = AsyncMock()
        # Use config dict with long window to prevent auto-flush
        batcher = MessageBatcher(
            callback,
            config={
                "window_ms": 10000,
                "max_size": 50,
                "max_bytes": 1024 * 1024,
                "immediate_types": ["alert", "safety", "emergency"],
            },
        )

        await batcher.add({"type": "test", "data": "value1"})
        assert batcher.pending_count == 1

        await batcher.add({"type": "test", "data": "value2"})
        assert batcher.pending_count == 2

    @pytest.mark.asyncio
    async def test_batcher_immediate_types(self):
        """Test that immediate types bypass batching."""
        from skyspy.socketio.utils.batcher import MessageBatcher

        callback = AsyncMock()
        batcher = MessageBatcher(callback)

        # Alert messages should be sent immediately
        await batcher.add({"type": "alert", "data": "urgent"})

        # Callback should have been called immediately
        callback.assert_called()

    @pytest.mark.asyncio
    async def test_batcher_flush_now(self):
        """Test that flush_now sends all pending messages."""
        from skyspy.socketio.utils.batcher import MessageBatcher

        callback = AsyncMock()
        # Use config dict with long window to prevent auto-flush
        batcher = MessageBatcher(
            callback,
            config={
                "window_ms": 10000,
                "max_size": 50,
                "max_bytes": 1024 * 1024,
                "immediate_types": ["alert", "safety", "emergency"],
            },
        )

        await batcher.add({"type": "test", "data": "value1"})
        await batcher.add({"type": "test", "data": "value2"})

        assert batcher.pending_count == 2

        await batcher.flush_now()

        assert batcher.pending_count == 0
        callback.assert_called()


class TestAuthMiddleware:
    """Tests for authentication middleware."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_authenticate_no_token_public_mode(self):
        """Test authentication in public mode without token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "public"

            user, error = await authenticate_socket({})

            assert error is None
            assert isinstance(user, AnonymousUser)

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_authenticate_no_token_private_mode(self):
        """Test authentication in private mode without token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "private"

            user, error = await authenticate_socket({})

            assert error is not None
            assert "required" in error.lower()

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_authenticate_invalid_jwt(self):
        """Test authentication with invalid JWT token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "private"

            user, error = await authenticate_socket({"token": "invalid_jwt_token"})

            assert error is not None


class TestPermissionsMiddleware:
    """Tests for permissions middleware."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_check_topic_permission_public_mode(self):
        """Test topic permission in public mode."""
        from skyspy.socketio.middleware.permissions import check_topic_permission

        with patch("skyspy.socketio.middleware.permissions.settings") as mock_settings:
            mock_settings.AUTH_MODE = "public"

            # In public mode, basic topics should be accessible
            user = AnonymousUser()
            allowed = await check_topic_permission(user, "aircraft")

            assert allowed is True

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_get_allowed_topics(self):
        """Test getting list of allowed topics for user."""
        from skyspy.socketio.middleware.permissions import get_allowed_topics

        with patch("skyspy.socketio.middleware.permissions.settings") as mock_settings:
            mock_settings.AUTH_MODE = "public"

            user = AnonymousUser()
            topics = await get_allowed_topics(user)

            assert isinstance(topics, list)
            assert "aircraft" in topics


class TestBroadcastUtility:
    """Tests for broadcast utility."""

    def test_sync_emit_formats_message_correctly(self):
        """Test that sync_emit formats messages for Socket.IO."""
        from skyspy.socketio.utils.broadcast import sync_emit

        with patch("skyspy.socketio.utils.broadcast._get_redis_client") as mock_redis:
            mock_client = MagicMock()
            mock_redis.return_value = mock_client

            result = sync_emit("test:event", {"data": "value"}, room="test_room")

            # Should have called publish on Redis
            mock_client.publish.assert_called_once()
            assert result is True

    def test_broadcast_to_room(self):
        """Test broadcast_to_room helper."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        with patch("skyspy.socketio.utils.broadcast.sync_emit") as mock_emit:
            mock_emit.return_value = True

            result = broadcast_to_room("test_room", "test:event", {"data": "value"})

            # broadcast_to_room calls sync_emit with keyword arguments
            mock_emit.assert_called_once_with(
                event="test:event", data={"data": "value"}, room="test_room", namespace="/", skip_sid=None
            )
            assert result is True


class TestMainNamespace:
    """Tests for MainNamespace class."""

    def test_main_namespace_exists(self):
        """Test that MainNamespace can be imported."""
        from skyspy.socketio.namespaces.main import MainNamespace

        assert MainNamespace is not None

    def test_main_namespace_initialization(self):
        """Test MainNamespace initialization."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")
        assert namespace.namespace == "/"


class TestAudioNamespace:
    """Tests for AudioNamespace class."""

    def test_audio_namespace_exists(self):
        """Test that AudioNamespace can be imported."""
        from skyspy.socketio.namespaces.audio import AudioNamespace

        assert AudioNamespace is not None

    def test_audio_namespace_initialization(self):
        """Test AudioNamespace initialization."""
        from skyspy.socketio.namespaces.audio import AudioNamespace

        namespace = AudioNamespace()
        assert namespace.namespace == "/audio"


class TestCannonballNamespace:
    """Tests for CannonballNamespace class."""

    def test_cannonball_namespace_exists(self):
        """Test that CannonballNamespace can be imported."""
        from skyspy.socketio.namespaces.cannonball import CannonballNamespace

        assert CannonballNamespace is not None

    def test_cannonball_namespace_initialization(self):
        """Test CannonballNamespace initialization."""
        from skyspy.socketio.namespaces.cannonball import CannonballNamespace

        namespace = CannonballNamespace()
        assert namespace.namespace == "/cannonball"


class TestSocketIOServer:
    """Tests for Socket.IO server configuration."""

    def test_server_can_be_imported(self):
        """Test that the Socket.IO server can be imported."""
        from skyspy.socketio import sio, socket_app

        assert sio is not None
        assert socket_app is not None

    def test_namespace_registration(self):
        """Test that namespaces can be registered."""
        from skyspy.socketio.namespaces import register_all_namespaces

        # Should not raise any exceptions
        register_all_namespaces()


class TestRequestPermissionDefaultDeny:
    """Tests for default-deny request permission checking."""

    @pytest.mark.asyncio
    async def test_unlisted_request_type_denied_in_private_mode(self):
        """Unlisted request types must be denied outside public mode."""
        from django.test import override_settings

        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(return_value={"user": AnonymousUser()})

        with override_settings(AUTH_MODE="private"):
            with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
                allowed = await namespace._check_request_permission("test-sid", "generic_request")
                assert allowed is False

    @pytest.mark.asyncio
    async def test_unlisted_request_type_allowed_in_public_mode(self):
        """Public mode still allows everything (permission checks bypassed)."""
        from django.test import override_settings

        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        with override_settings(AUTH_MODE="public"):
            allowed = await namespace._check_request_permission("test-sid", "anything-at-all")
            assert allowed is True

    def test_request_permissions_cover_known_read_types(self):
        """Legitimate read/refresh request types must be listed (not default-denied)."""
        from skyspy.socketio.namespaces.main import MainNamespace

        for request_type in (
            "aircraft-snapshot",
            "aircraft-list",
            "acars-snapshot",
            "safety-snapshot",
            "alert-snapshot",
            "notam-snapshot",
            "history-stats",
            "refresh",
            "metars",
            "status",
            "ws-status",
            "stats-flight-patterns",
        ):
            assert request_type in MainNamespace.REQUEST_PERMISSIONS, f"{request_type} missing"

    @pytest.mark.asyncio
    async def test_cannonball_unlisted_request_type_denied(self):
        """Cannonball namespace also default-denies unlisted request types."""
        from django.test import override_settings

        from skyspy.socketio.namespaces.cannonball import CannonballNamespace

        namespace = CannonballNamespace()

        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(return_value={"user": AnonymousUser()})

        with override_settings(AUTH_MODE="private"):
            with patch("skyspy.socketio.namespaces.cannonball.sio", mock_sio):
                allowed = await namespace._check_request_permission("test-sid", "not-a-real-type")
                assert allowed is False


class TestCannonballBroadcastRooms:
    """Tests that cannonball clients join the rooms Celery tasks broadcast to."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_connect_joins_threat_and_alert_rooms(self):
        """on_connect must join cannonball_threats and cannonball_alerts."""
        from skyspy.socketio.namespaces.cannonball import CannonballNamespace

        namespace = CannonballNamespace()

        mock_sio = MagicMock()
        mock_sio.save_session = AsyncMock()

        with patch(
            "skyspy.socketio.namespaces.cannonball.authenticate_socket",
            AsyncMock(return_value=(AnonymousUser(), None)),
        ):
            with patch(
                "skyspy.socketio.namespaces.cannonball.check_topic_permission",
                AsyncMock(return_value=True),
            ):
                with patch("skyspy.socketio.namespaces.cannonball.sio", mock_sio):
                    with patch.object(namespace, "enter_room", AsyncMock()) as mock_enter:
                        with patch.object(namespace, "emit", AsyncMock()):
                            result = await namespace.on_connect("test-sid", {})

                            assert result is True
                            joined_rooms = [c[0][1] for c in mock_enter.call_args_list]
                            assert "cannonball_threats" in joined_rooms
                            assert "cannonball_alerts" in joined_rooms


class TestMilitaryFilter:
    """Tests for the military_only aircraft list filter."""

    @pytest.mark.asyncio
    async def test_military_only_uses_military_key(self):
        """Filter must match the 'military' key set by the cache writers."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        aircraft = [
            {"hex": "AE0000", "military": True, "alt_baro": 10000},
            {"hex": "A00001", "military": False, "alt_baro": 20000},
        ]

        with patch("skyspy.socketio.namespaces.mixins.aircraft.cache") as mock_cache:
            mock_cache.get.return_value = aircraft
            result = await namespace._get_aircraft_list({"military_only": True})

        assert len(result) == 1
        assert result[0]["hex"] == "AE0000"


class TestNonDictPayloads:
    """Tests that handlers reject non-dict payloads with an error response."""

    @pytest.mark.asyncio
    async def test_main_on_request_rejects_string_payload(self):
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            await namespace.on_request("test-sid", "not-a-dict")

        mock_sio.emit.assert_called_once()
        assert mock_sio.emit.call_args[0][0] == "error"

    @pytest.mark.asyncio
    async def test_main_on_unsubscribe_rejects_none_payload(self):
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            await namespace.on_unsubscribe("test-sid", None)

        mock_sio.emit.assert_called_once()
        assert mock_sio.emit.call_args[0][0] == "error"

    @pytest.mark.asyncio
    async def test_audio_on_request_rejects_list_payload(self):
        from skyspy.socketio.namespaces.audio import AudioNamespace

        namespace = AudioNamespace()

        with patch.object(namespace, "emit", AsyncMock()) as mock_emit:
            await namespace.on_request("test-sid", ["not", "a", "dict"])

        mock_emit.assert_called_once()
        assert mock_emit.call_args[0][0] == "error"

    @pytest.mark.asyncio
    async def test_cannonball_on_position_update_rejects_string_payload(self):
        from skyspy.socketio.namespaces.cannonball import CannonballNamespace

        namespace = CannonballNamespace()

        with patch.object(namespace, "emit", AsyncMock()) as mock_emit:
            await namespace.on_position_update("test-sid", "34.05,-118.25")

        mock_emit.assert_called_once()
        assert mock_emit.call_args[0][0] == "error"


class TestRequestRateLimiting:
    """Tests that on_request enforces the per-session rate limiter."""

    @pytest.mark.asyncio
    async def test_main_on_request_rejects_when_rate_limited(self):
        from skyspy.socketio.namespaces.main import MainNamespace
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        namespace = MainNamespace("/")

        limiter = RateLimiter({"request": 10})
        while limiter.can_send("request"):  # drain the burst allowance
            pass

        mock_sio = MagicMock()
        mock_sio.emit = AsyncMock()
        mock_sio.get_session = AsyncMock(return_value={"user": AnonymousUser(), "rate_limiter": limiter})

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            await namespace.on_request("test-sid", {"type": "status", "request_id": "r1"})

        mock_sio.emit.assert_called_once()
        event, payload = mock_sio.emit.call_args[0][0], mock_sio.emit.call_args[0][1]
        assert event == "error"
        assert "Rate limit" in payload["message"]


class TestBatcherFlushRaces:
    """Tests for MessageBatcher flush race fixes."""

    @pytest.mark.asyncio
    async def test_message_added_during_flush_is_not_stuck(self):
        """A message added while a flush is mid-send must still be flushed."""
        import asyncio

        from skyspy.socketio.utils.batcher import MessageBatcher

        sent = []
        first_send_started = asyncio.Event()
        release_first_send = asyncio.Event()

        async def callback(message):
            sent.append(message)
            if len(sent) == 1:
                first_send_started.set()
                await release_first_send.wait()

        batcher = MessageBatcher(
            callback,
            config={"window_ms": 10, "max_size": 50, "max_bytes": 1024 * 1024, "immediate_types": []},
        )

        await batcher.add({"type": "test", "n": 1})
        await asyncio.wait_for(first_send_started.wait(), timeout=2)

        # Timer task is now mid-send; batch is drained but task not done,
        # so this message gets no new timer under the old implementation
        await batcher.add({"type": "test", "n": 2})
        release_first_send.set()

        for _ in range(100):
            if len(sent) >= 2:
                break
            await asyncio.sleep(0.02)

        assert len(sent) >= 2
        assert batcher.pending_count == 0

    @pytest.mark.asyncio
    async def test_flush_now_does_not_drop_messages_cancelled_mid_send(self):
        """Messages popped by a flush that gets cancelled mid-send are re-sent."""
        import asyncio

        from skyspy.socketio.utils.batcher import MessageBatcher

        calls = []
        first_send_started = asyncio.Event()
        block_forever = asyncio.Event()

        async def callback(message):
            calls.append(message)
            if len(calls) == 1:
                first_send_started.set()
                await block_forever.wait()  # cancelled by flush_now

        batcher = MessageBatcher(
            callback,
            config={"window_ms": 10, "max_size": 50, "max_bytes": 1024 * 1024, "immediate_types": []},
        )

        await batcher.add({"type": "test", "n": 1})
        await asyncio.wait_for(first_send_started.wait(), timeout=2)

        # Cancels the mid-send timer flush; the popped message must be
        # re-queued and delivered by flush_now itself
        await asyncio.wait_for(batcher.flush_now(), timeout=2)

        assert len(calls) == 2
        assert calls[1] == {"type": "test", "n": 1}
        assert batcher.pending_count == 0


class TestConcurrentSubscriptionState:
    """Concurrent subscribe events must not lose topics (session read-modify-write race)."""

    @pytest.mark.asyncio
    async def test_concurrent_subscribes_keep_both_topics(self):
        """Two overlapping subscribes for different topics must both be tracked.

        Handlers run as concurrent tasks (async_handlers=True); without per-sid
        locking, both read the same base subscribed_topics list and the later
        save_session drops the other's topic.
        """
        import asyncio

        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        sessions = {"sid1": {"user": AnonymousUser(), "subscribed_topics": []}}

        async def fake_get_session(sid):
            return dict(sessions[sid])

        async def fake_save_session(sid, session):
            await asyncio.sleep(0)  # yield, like the real session store
            sessions[sid] = session

        async def fake_permission(user, topic):
            await asyncio.sleep(0)  # yield, like the sync_to_async DB permission check
            return True

        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(side_effect=fake_get_session)
        mock_sio.save_session = AsyncMock(side_effect=fake_save_session)
        mock_sio.enter_room = AsyncMock()
        mock_sio.emit = AsyncMock()

        with (
            patch("skyspy.socketio.namespaces.main.sio", mock_sio),
            patch("skyspy.socketio.namespaces.main.check_topic_permission", fake_permission),
            patch.object(namespace, "_send_topic_snapshots", AsyncMock()),
        ):
            await asyncio.gather(
                namespace.on_subscribe("sid1", {"topics": ["safety"]}),
                namespace.on_subscribe("sid1", {"topics": ["alerts"]}),
            )

        assert set(sessions["sid1"]["subscribed_topics"]) == {"safety", "alerts"}

    @pytest.mark.asyncio
    async def test_concurrent_subscribe_and_unsubscribe_serialized(self):
        """A subscribe overlapping an unsubscribe must not resurrect or drop topics."""
        import asyncio

        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")

        sessions = {"sid1": {"user": AnonymousUser(), "subscribed_topics": ["safety"]}}

        async def fake_get_session(sid):
            return dict(sessions[sid])

        async def fake_save_session(sid, session):
            await asyncio.sleep(0)
            sessions[sid] = session

        async def fake_permission(user, topic):
            await asyncio.sleep(0)
            return True

        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(side_effect=fake_get_session)
        mock_sio.save_session = AsyncMock(side_effect=fake_save_session)
        mock_sio.enter_room = AsyncMock()
        mock_sio.leave_room = AsyncMock()
        mock_sio.emit = AsyncMock()

        with (
            patch("skyspy.socketio.namespaces.main.sio", mock_sio),
            patch("skyspy.socketio.namespaces.main.check_topic_permission", fake_permission),
            patch.object(namespace, "_send_topic_snapshots", AsyncMock()),
        ):
            await asyncio.gather(
                namespace.on_subscribe("sid1", {"topics": ["alerts"]}),
                namespace.on_unsubscribe("sid1", {"topics": ["safety"]}),
            )

        assert set(sessions["sid1"]["subscribed_topics"]) == {"alerts"}

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up_session_lock(self):
        """on_disconnect must drop the per-sid lock to avoid unbounded growth."""
        from skyspy.socketio.namespaces.main import MainNamespace

        namespace = MainNamespace("/")
        namespace._session_lock("sid1")
        assert "sid1" in namespace._session_locks

        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(return_value={"subscribed_topics": []})
        mock_sio.leave_room = AsyncMock()
        mock_sio.save_session = AsyncMock()

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            await namespace.on_disconnect("sid1")

        assert "sid1" not in namespace._session_locks


class TestRequestPermissionWriteAccess:
    """Anonymous mutating requests must be gated on write_access, not read_access."""

    @pytest.mark.django_db
    def test_anonymous_mutating_request_denied_when_write_requires_auth(self):
        """read_access=public must not grant anonymous clients manage requests."""
        from asgiref.sync import async_to_sync
        from django.test import override_settings

        from skyspy.models.auth import FeatureAccess
        from skyspy.socketio.namespaces.main import MainNamespace

        FeatureAccess.objects.update_or_create(
            feature="alerts", defaults={"read_access": "public", "write_access": "authenticated"}
        )

        namespace = MainNamespace("/")
        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(return_value={"user": AnonymousUser()})

        with override_settings(AUTH_MODE="hybrid"), patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            check = async_to_sync(namespace._check_request_permission)
            # Reads stay public
            assert check("test-sid", "alert-rules") is True
            # Mutations are gated on write_access
            assert check("test-sid", "alert-rule-delete") is False
            assert check("test-sid", "alert-rule-create") is False
            assert check("test-sid", "alert-rule-toggle") is False

    @pytest.mark.django_db
    def test_anonymous_mutating_request_allowed_when_write_public(self):
        """write_access=public still grants anonymous manage requests."""
        from asgiref.sync import async_to_sync
        from django.test import override_settings

        from skyspy.models.auth import FeatureAccess
        from skyspy.socketio.namespaces.main import MainNamespace

        FeatureAccess.objects.update_or_create(
            feature="safety", defaults={"read_access": "public", "write_access": "public"}
        )

        namespace = MainNamespace("/")
        mock_sio = MagicMock()
        mock_sio.get_session = AsyncMock(return_value={"user": AnonymousUser()})

        with override_settings(AUTH_MODE="hybrid"), patch("skyspy.socketio.namespaces.main.sio", mock_sio):
            check = async_to_sync(namespace._check_request_permission)
            assert check("test-sid", "safety-acknowledge") is True

    @pytest.mark.django_db
    def test_middleware_is_feature_public_checks_write_access(self):
        """middleware._is_feature_public must use write_access for mutating actions."""
        from asgiref.sync import async_to_sync

        from skyspy.models.auth import FeatureAccess
        from skyspy.socketio.middleware.permissions import _is_feature_public

        FeatureAccess.objects.update_or_create(
            feature="safety", defaults={"read_access": "public", "write_access": "authenticated"}
        )

        assert async_to_sync(_is_feature_public)("safety.view") is True
        assert async_to_sync(_is_feature_public)("safety.acknowledge") is False
        assert async_to_sync(_is_feature_public)("safety.manage") is False
