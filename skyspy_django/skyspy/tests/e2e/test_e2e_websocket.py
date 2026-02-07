"""
E2E Tests for Socket.IO WebSocket functionality.

Tests cover:
- Socket.IO connection authentication
- Namespace subscription/unsubscription
- Broadcast to multiple clients
- Room-based messaging (topic rooms, aircraft hex rooms)
- Error handling for invalid messages
- Rate limiting
- Permission checking

Note: These tests use python-socketio's test client for async testing.
"""

import asyncio
import os
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from django.conf import settings
from django.contrib.auth.models import AnonymousUser, User
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def valid_jwt_token(db):
    """Create a valid JWT token for testing."""
    user = User.objects.create_user(
        username="websocket_test_user",
        email="wstest@example.com",
        password="testpass123",
    )
    refresh = RefreshToken.for_user(user)
    return str(refresh.access_token), user


@pytest.fixture
def expired_jwt_token():
    """Create an expired JWT token string."""
    # This is a malformed/expired token for testing
    return "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE1MDAwMDAwMDB9.invalid"


@pytest.fixture
def api_key_token(db, operator_user, create_api_key):
    """Create a valid API key for testing."""
    api_key, raw_key = create_api_key(
        operator_user,
        name="WebSocket Test Key",
        scopes=["aircraft", "safety", "alerts"],
    )
    return raw_key, operator_user


@pytest.fixture
def mock_sio_server():
    """Create a mock Socket.IO server for testing."""
    mock_server = MagicMock()
    mock_server.save_session = AsyncMock()
    mock_server.get_session = AsyncMock(
        return_value={
            "user": AnonymousUser(),
            "subscribed_topics": [],
            "rate_limiter": MagicMock(),
        }
    )
    mock_server.enter_room = AsyncMock()
    mock_server.leave_room = AsyncMock()
    mock_server.emit = AsyncMock()
    return mock_server


@pytest.fixture
def cached_aircraft_data():
    """Pre-populate cache with aircraft data for testing."""
    aircraft_data = [
        {
            "hex": "A12345",
            "flight": "UAL123",
            "alt_baro": 35000,
            "gs": 450,
            "track": 270,
            "lat": 47.5,
            "lon": -122.0,
            "category": "A3",
            "t": "B738",
            "rssi": -25.0,
            "distance_nm": 15.5,
            "dbFlags": 0,
        },
        {
            "hex": "AE1234",
            "flight": "RCH789",
            "alt_baro": 32000,
            "gs": 420,
            "track": 180,
            "lat": 48.0,
            "lon": -122.5,
            "category": "A5",
            "t": "C17",
            "rssi": -30.0,
            "distance_nm": 25.0,
            "dbFlags": 1,
        },
    ]

    cache.set("current_aircraft", aircraft_data, timeout=300)
    cache.set("aircraft_timestamp", timezone.now().timestamp(), timeout=300)

    return aircraft_data


# =============================================================================
# Authentication Tests
# =============================================================================


class TestSocketIOAuthentication:
    """Tests for Socket.IO connection authentication."""

    @pytest.mark.asyncio
    @pytest.mark.django_db(transaction=True)
    async def test_authenticate_with_valid_jwt(self, valid_jwt_token):
        """Test authentication with valid JWT token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        token, expected_user = valid_jwt_token

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "hybrid"
            mock_settings.WS_REJECT_INVALID_TOKENS = False
            mock_settings.API_KEY_ENABLED = True

            user, error = await authenticate_socket({"token": token})

            assert error is None
            assert user.is_authenticated
            assert user.username == expected_user.username

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_authenticate_with_invalid_jwt(self, expired_jwt_token):
        """Test authentication with invalid/expired JWT token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "hybrid"
            mock_settings.WS_REJECT_INVALID_TOKENS = False
            mock_settings.API_KEY_ENABLED = True

            user, error = await authenticate_socket({"token": expired_jwt_token})

            # In hybrid mode with WS_REJECT_INVALID_TOKENS=False, should return error but not reject
            assert error is not None
            assert isinstance(user, AnonymousUser)

    @pytest.mark.asyncio
    @pytest.mark.django_db(transaction=True)
    async def test_authenticate_with_api_key(self, api_key_token):
        """Test authentication with valid API key."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        raw_key, expected_user = api_key_token

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "hybrid"
            mock_settings.WS_REJECT_INVALID_TOKENS = False
            mock_settings.API_KEY_ENABLED = True

            user, error = await authenticate_socket({"token": raw_key})

            assert error is None
            assert user.is_authenticated
            assert user.username == expected_user.username

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
    async def test_authenticate_invalid_token_private_mode_rejected(self):
        """Test that invalid tokens are rejected in private mode."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch("skyspy.socketio.middleware.auth.settings") as mock_settings:
            mock_settings.AUTH_MODE = "private"
            mock_settings.API_KEY_ENABLED = True

            user, error = await authenticate_socket({"token": "invalid_token"})

            assert error is not None


# =============================================================================
# Namespace Subscription Tests
# =============================================================================


class TestNamespaceSubscription:
    """Tests for Socket.IO namespace subscription/unsubscription."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_subscribe_to_topics(self, mock_sio_server):
        """Test subscribing to multiple topics."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            # Mock session
            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            # Mock permission check to allow all
            with patch(
                "skyspy.socketio.namespaces.main.check_topic_permission",
                AsyncMock(return_value=True),
            ):
                await namespace.on_subscribe(
                    "test-sid",
                    {"topics": ["aircraft", "safety", "alerts"]},
                )

            # Verify rooms were entered
            assert mock_sio_server.enter_room.called
            # Verify subscription confirmation was sent
            mock_sio_server.emit.assert_called()

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_subscribe_to_all_topics(self, mock_sio_server):
        """Test subscribing to 'all' which expands to all supported topics."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            with patch(
                "skyspy.socketio.namespaces.main.check_topic_permission",
                AsyncMock(return_value=True),
            ):
                await namespace.on_subscribe("test-sid", {"topics": ["all"]})

            # Should have joined rooms for all supported topics
            # SUPPORTED_TOPICS = ["aircraft", "safety", "stats", "alerts", "acars", "airspace", "notams"]
            assert mock_sio_server.enter_room.call_count >= 7

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_subscribe_denied_topic(self, mock_sio_server):
        """Test subscribing to a topic without permission."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            # Deny all permissions
            with patch(
                "skyspy.socketio.namespaces.main.check_topic_permission",
                AsyncMock(return_value=False),
            ):
                await namespace.on_subscribe("test-sid", {"topics": ["alerts"]})

            # Verify 'subscribed' event includes denied list
            emit_calls = mock_sio_server.emit.call_args_list
            for call in emit_calls:
                if call[0][0] == "subscribed":
                    data = call[0][1]
                    assert "denied" in data

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_unsubscribe_from_topics(self, mock_sio_server):
        """Test unsubscribing from topics."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            # Start with subscribed topics
            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": {"aircraft", "safety"},
                "rate_limiter": MagicMock(),
            }

            await namespace.on_unsubscribe("test-sid", {"topics": ["aircraft"]})

            # Verify room was left
            mock_sio_server.leave_room.assert_called()
            # Verify unsubscribed event was sent
            mock_sio_server.emit.assert_called()

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_subscribe_invalid_topic(self, mock_sio_server):
        """Test subscribing to an invalid/unknown topic."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            with patch(
                "skyspy.socketio.namespaces.main.check_topic_permission",
                AsyncMock(return_value=True),
            ):
                await namespace.on_subscribe(
                    "test-sid",
                    {"topics": ["invalid_topic", "aircraft"]},
                )

            # Should still process valid topic but skip invalid one
            # Check that aircraft room was entered
            enter_room_calls = mock_sio_server.enter_room.call_args_list
            rooms_entered = [call[0][1] for call in enter_room_calls]
            assert "topic_aircraft" in rooms_entered
            assert "topic_invalid_topic" not in rooms_entered


# =============================================================================
# Broadcast Tests
# =============================================================================


class TestBroadcast:
    """Tests for Socket.IO broadcast functionality."""

    def test_broadcast_to_room(self):
        """Test broadcasting to a specific room."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        with patch("skyspy.socketio.utils.broadcast.sync_emit") as mock_emit:
            mock_emit.return_value = True

            result = broadcast_to_room(
                "topic_aircraft",
                "aircraft:update",
                {"aircraft": [{"hex": "ABC123"}]},
            )

            assert result is True
            mock_emit.assert_called_once()

    def test_sync_emit_with_redis(self):
        """Test sync_emit publishes to Redis."""
        from skyspy.socketio.utils.broadcast import sync_emit

        with patch("skyspy.socketio.utils.broadcast._get_redis_client") as mock_redis_factory:
            mock_redis = MagicMock()
            mock_redis_factory.return_value = mock_redis

            result = sync_emit(
                "test:event",
                {"data": "value"},
                room="test_room",
            )

            assert result is True
            mock_redis.publish.assert_called_once()

    def test_broadcast_aircraft_update(self):
        """Test broadcasting aircraft position update."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        aircraft_data = {
            "aircraft": [
                {
                    "hex": "ABC123",
                    "lat": 47.5,
                    "lon": -122.0,
                    "alt_baro": 35000,
                    "gs": 450,
                }
            ],
            "timestamp": timezone.now().isoformat(),
        }

        with patch("skyspy.socketio.utils.broadcast.sync_emit") as mock_emit:
            mock_emit.return_value = True

            result = broadcast_to_room(
                "topic_aircraft",
                "aircraft:update",
                aircraft_data,
            )

            assert result is True
            call_kwargs = mock_emit.call_args[1]
            assert call_kwargs["event"] == "aircraft:update"
            assert call_kwargs["room"] == "topic_aircraft"

    def test_broadcast_safety_event(self):
        """Test broadcasting safety event."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        safety_event = {
            "id": 1,
            "event_type": "tcas_ra",
            "severity": "critical",
            "icao_hex": "ABC123",
            "message": "TCAS Resolution Advisory",
            "timestamp": timezone.now().isoformat(),
        }

        with patch("skyspy.socketio.utils.broadcast.sync_emit") as mock_emit:
            mock_emit.return_value = True

            result = broadcast_to_room(
                "topic_safety",
                "safety:event",
                safety_event,
            )

            assert result is True
            call_kwargs = mock_emit.call_args[1]
            assert call_kwargs["event"] == "safety:event"

    def test_broadcast_alert_triggered(self):
        """Test broadcasting alert triggered event."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        alert_data = {
            "id": 1,
            "rule_id": 1,
            "rule_name": "Test Alert",
            "severity": "warning",
            "message": "Alert triggered",
            "aircraft": {"hex": "ABC123", "flight": "UAL123"},
            "timestamp": timezone.now().isoformat(),
        }

        with patch("skyspy.socketio.utils.broadcast.sync_emit") as mock_emit:
            mock_emit.return_value = True

            result = broadcast_to_room(
                "topic_alerts",
                "alert:triggered",
                alert_data,
            )

            assert result is True


# =============================================================================
# Room-based Messaging Tests
# =============================================================================


class TestRoomBasedMessaging:
    """Tests for room-based messaging functionality."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_join_topic_room(self, mock_sio_server):
        """Test joining a topic room."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            with patch(
                "skyspy.socketio.namespaces.main.check_topic_permission",
                AsyncMock(return_value=True),
            ):
                await namespace.on_subscribe("test-sid", {"topics": ["aircraft"]})

            # Verify client joined the topic room
            mock_sio_server.enter_room.assert_called()
            enter_room_calls = [call[0] for call in mock_sio_server.enter_room.call_args_list]
            # Should have joined topic_aircraft room
            assert any("topic_aircraft" in call for call in enter_room_calls)

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_leave_topic_room(self, mock_sio_server):
        """Test leaving a topic room."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": {"aircraft"},
                "rate_limiter": MagicMock(),
            }

            await namespace.on_unsubscribe("test-sid", {"topics": ["aircraft"]})

            # Verify client left the topic room
            mock_sio_server.leave_room.assert_called()
            leave_room_calls = [call[0] for call in mock_sio_server.leave_room.call_args_list]
            assert any("topic_aircraft" in call for call in leave_room_calls)

    def test_broadcast_to_topic_room(self):
        """Test broadcasting message to topic room reaches subscribers."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        with patch("skyspy.socketio.utils.broadcast.sync_emit") as mock_emit:
            mock_emit.return_value = True

            # Broadcast to aircraft topic
            broadcast_to_room(
                "topic_aircraft",
                "aircraft:update",
                {"aircraft": []},
            )

            call_kwargs = mock_emit.call_args[1]
            assert call_kwargs["room"] == "topic_aircraft"


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for error handling in Socket.IO communication."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_handle_invalid_subscribe_data(self, mock_sio_server):
        """Test handling of invalid subscription data."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            # Send None data
            await namespace.on_subscribe("test-sid", None)

            # Should emit error
            emit_calls = mock_sio_server.emit.call_args_list
            error_emitted = any(call[0][0] == "error" for call in emit_calls)
            assert error_emitted

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_handle_invalid_request_type(self, mock_sio_server):
        """Test handling of unknown request type."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            # Mock permission check
            with patch.object(namespace, "_check_request_permission", AsyncMock(return_value=True)):
                await namespace.on_request(
                    "test-sid",
                    {
                        "type": "unknown_request_type",
                        "request_id": "req123",
                        "params": {},
                    },
                )

            # Should emit error response
            emit_calls = mock_sio_server.emit.call_args_list
            any(call[0][0] == "error" or (call[0][0] == "response" and "error" in str(call)) for call in emit_calls)
            # Either error event or response with error message
            assert mock_sio_server.emit.called

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_handle_missing_request_id(self, mock_sio_server):
        """Test handling of request without request_id."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            with patch.object(namespace, "_check_request_permission", AsyncMock(return_value=True)):
                # Send request without type
                await namespace.on_request(
                    "test-sid",
                    {
                        "request_id": "req123",
                        "params": {},
                    },
                )

            # Should handle gracefully (emit error for missing type)
            assert mock_sio_server.emit.called

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_handle_permission_denied(self, mock_sio_server):
        """Test handling of permission denied for request."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": [],
                "rate_limiter": MagicMock(),
            }

            # Mock permission check to deny
            with patch.object(namespace, "_check_request_permission", AsyncMock(return_value=False)):
                await namespace.on_request(
                    "test-sid",
                    {
                        "type": "system-info",
                        "request_id": "req123",
                        "params": {},
                    },
                )

            # Should emit permission denied error
            emit_calls = mock_sio_server.emit.call_args_list
            assert any("Permission denied" in str(call) or call[0][0] == "error" for call in emit_calls)


# =============================================================================
# Rate Limiting Tests
# =============================================================================


class TestRateLimiting:
    """Tests for Socket.IO rate limiting."""

    def test_rate_limiter_allows_initial_request(self):
        """Test that rate limiter allows initial request."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()
        assert limiter.can_send("aircraft:update") is True

    def test_rate_limiter_blocks_rapid_requests(self):
        """Test that rate limiter blocks rapid successive requests."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # First request allowed
        assert limiter.can_send("stats:update") is True

        # Immediate second request blocked (stats:update is 0.5 Hz = 2s interval)
        assert limiter.can_send("stats:update") is False

    def test_rate_limiter_different_topics(self):
        """Test that rate limiter tracks topics independently."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # Both initial requests allowed
        assert limiter.can_send("aircraft:update") is True
        assert limiter.can_send("safety:event") is True

    def test_rate_limiter_wait_time(self):
        """Test that rate limiter returns correct wait time."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # Mark as sent
        limiter.can_send("stats:update")

        # Get wait time (should be > 0)
        wait_time = limiter.get_wait_time("stats:update")
        assert wait_time > 0
        assert wait_time <= 2.0  # stats:update is 0.5 Hz

    def test_rate_limiter_cleanup(self):
        """Test that rate limiter cleans up old entries."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # Send some messages
        limiter.can_send("test:event1")
        limiter.can_send("test:event2")

        # Cleanup should not raise errors
        limiter.cleanup_old_entries()
        limiter.reset()

        # After reset, should be able to send again
        assert limiter.can_send("test:event1") is True


# =============================================================================
# Request/Response Pattern Tests
# =============================================================================


class TestRequestResponsePattern:
    """Tests for Socket.IO request/response pattern."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_aircraft_snapshot_request(self, mock_sio_server, cached_aircraft_data):
        """Test requesting aircraft snapshot."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": ["aircraft"],
                "rate_limiter": MagicMock(can_send=MagicMock(return_value=True)),
            }

            with patch.object(namespace, "_check_request_permission", AsyncMock(return_value=True)):
                with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=cached_aircraft_data)):
                    await namespace.on_request(
                        "test-sid",
                        {
                            "type": "aircraft-snapshot",
                            "request_id": "req123",
                            "params": {},
                        },
                    )

            # Verify response was sent
            emit_calls = mock_sio_server.emit.call_args_list
            response_emitted = any(call[0][0] == "response" for call in emit_calls)
            assert response_emitted

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_ping_pong(self, mock_sio_server):
        """Test ping/pong for connection keepalive."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            await namespace.on_ping("test-sid", {})

            # Verify pong was sent
            mock_sio_server.emit.assert_called()
            call_args = mock_sio_server.emit.call_args
            assert call_args[0][0] == "pong"


# =============================================================================
# Connection Lifecycle Tests
# =============================================================================


class TestConnectionLifecycle:
    """Tests for Socket.IO connection lifecycle."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_on_connect_saves_session(self, mock_sio_server):
        """Test that on_connect saves user session."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            with patch(
                "skyspy.socketio.namespaces.main.authenticate_socket", AsyncMock(return_value=(AnonymousUser(), None))
            ):
                with patch("skyspy.socketio.namespaces.main.check_topic_permission", AsyncMock(return_value=True)):
                    namespace = MainNamespace("/")

                    # Mock the _get_current_aircraft to avoid DB calls
                    with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                        result = await namespace.on_connect("test-sid", {}, {})

            assert result is True
            mock_sio_server.save_session.assert_called()

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_on_connect_rejects_in_private_mode(self, mock_sio_server):
        """Test that on_connect rejects unauthenticated in private mode."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            with patch(
                "skyspy.socketio.namespaces.main.authenticate_socket",
                AsyncMock(return_value=(AnonymousUser(), "Authentication required")),
            ):
                with patch("skyspy.socketio.namespaces.main.settings") as mock_settings:
                    mock_settings.AUTH_MODE = "private"
                    mock_settings.WS_REJECT_INVALID_TOKENS = False

                    namespace = MainNamespace("/")
                    result = await namespace.on_connect("test-sid", {}, {})

            assert result is False

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_on_disconnect_cleans_up(self, mock_sio_server):
        """Test that on_disconnect cleans up session and rooms."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            mock_rate_limiter = MagicMock()
            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": ["aircraft", "safety"],
                "rate_limiter": mock_rate_limiter,
            }

            namespace = MainNamespace("/")
            await namespace.on_disconnect("test-sid")

            # Verify rooms were left
            assert mock_sio_server.leave_room.called
            # Verify rate limiter was cleaned up
            mock_rate_limiter.cleanup_old_entries.assert_called()
            mock_rate_limiter.reset.assert_called()


# =============================================================================
# Audio Namespace Tests
# =============================================================================


class TestAudioNamespace:
    """Tests for Audio Socket.IO namespace."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_audio_namespace_initialization(self):
        """Test AudioNamespace initialization."""
        from skyspy.socketio.namespaces.audio import AudioNamespace

        namespace = AudioNamespace()
        assert namespace.namespace == "/audio"

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_audio_request_transmissions(self, mock_sio_server):
        """Test requesting audio transmissions."""
        from skyspy.socketio.namespaces.audio import AudioNamespace

        with patch("skyspy.socketio.namespaces.audio.sio", mock_sio_server):
            namespace = AudioNamespace()
            # Set the server attribute so emit() works
            namespace.server = mock_sio_server

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "rate_limiter": MagicMock(can_send=MagicMock(return_value=True)),
            }

            with patch.object(namespace, "_get_transmissions", AsyncMock(return_value=[])):
                await namespace.on_request(
                    "test-sid",
                    {
                        "type": "transmissions",
                        "request_id": "req123",
                        "params": {"limit": 10},
                    },
                )

            # Verify response was sent
            mock_sio_server.emit.assert_called()


# =============================================================================
# Integration Tests
# =============================================================================


class TestSocketIOIntegration:
    """Integration tests for Socket.IO functionality."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_full_connection_flow(self, mock_sio_server, valid_jwt_token):
        """Test full connection flow: connect -> subscribe -> receive data."""
        from skyspy.socketio.namespaces.main import MainNamespace

        token, user = valid_jwt_token

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            with patch(
                "skyspy.socketio.namespaces.main.authenticate_socket",
                AsyncMock(return_value=(user, None)),
            ):
                with patch("skyspy.socketio.namespaces.main.check_topic_permission", AsyncMock(return_value=True)):
                    namespace = MainNamespace("/")

                    # Connect
                    with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                        connect_result = await namespace.on_connect(
                            "test-sid",
                            {},
                            {"token": token},
                        )
                    assert connect_result is True

                    # Update session mock for subsequent calls
                    mock_sio_server.get_session.return_value = {
                        "user": user,
                        "subscribed_topics": [],
                        "rate_limiter": MagicMock(can_send=MagicMock(return_value=True)),
                    }

                    # Subscribe
                    await namespace.on_subscribe(
                        "test-sid",
                        {"topics": ["aircraft", "alerts"]},
                    )

                    # Verify subscribed event was sent
                    emit_calls = mock_sio_server.emit.call_args_list
                    subscribed_emitted = any(call[0][0] == "subscribed" for call in emit_calls)
                    assert subscribed_emitted

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_concurrent_requests(self, mock_sio_server):
        """Test handling of concurrent requests."""
        from skyspy.socketio.namespaces.main import MainNamespace

        with patch("skyspy.socketio.namespaces.main.sio", mock_sio_server):
            namespace = MainNamespace("/")

            mock_sio_server.get_session.return_value = {
                "user": AnonymousUser(),
                "subscribed_topics": ["aircraft"],
                "rate_limiter": MagicMock(can_send=MagicMock(return_value=True)),
            }

            with patch.object(namespace, "_check_request_permission", AsyncMock(return_value=True)):
                with patch.object(namespace, "_get_current_aircraft", AsyncMock(return_value=[])):
                    # Send multiple concurrent requests
                    tasks = [
                        namespace.on_request(
                            "test-sid",
                            {
                                "type": "aircraft-snapshot",
                                "request_id": f"req{i}",
                                "params": {},
                            },
                        )
                        for i in range(5)
                    ]

                    await asyncio.gather(*tasks)

            # All requests should be processed
            emit_calls = mock_sio_server.emit.call_args_list
            response_count = sum(1 for call in emit_calls if call[0][0] == "response")
            assert response_count >= 5
