"""
Tests for Socket.IO namespace implementations.

Tests cover:
- Namespace class initialization
- Authentication middleware
- Permission checking
- Rate limiter and batcher utilities
- Broadcast utilities
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from django.contrib.auth.models import AnonymousUser


class TestRateLimiter:
    """Tests for the RateLimiter utility."""

    def test_rate_limiter_initialization(self):
        """Test that RateLimiter initializes with default rates."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()
        assert limiter is not None
        # Default rate for aircraft:update is 10 Hz
        assert limiter.can_send('aircraft:update') is True

    def test_rate_limiter_respects_limits(self):
        """Test that rate limiter blocks rapid sends."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()

        # First send should always succeed
        assert limiter.can_send('stats:update') is True

        # Second immediate send should be blocked (stats is 0.5 Hz = 2s interval)
        assert limiter.can_send('stats:update') is False

    def test_rate_limiter_custom_rates(self):
        """Test rate limiter with custom rates."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        custom_rates = {'test:topic': 1.0}  # 1 Hz
        limiter = RateLimiter(rate_limits=custom_rates)

        assert limiter.can_send('test:topic') is True
        assert limiter.can_send('test:topic') is False

    def test_rate_limiter_get_wait_time(self):
        """Test get_wait_time returns correct delay."""
        from skyspy.socketio.utils.rate_limiter import RateLimiter

        limiter = RateLimiter()
        limiter.can_send('stats:update')  # Mark as sent

        wait_time = limiter.get_wait_time('stats:update')
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
        batcher = MessageBatcher(callback, config={'window_ms': 10000, 'max_size': 50, 'max_bytes': 1024 * 1024, 'immediate_types': ['alert', 'safety', 'emergency']})

        await batcher.add({'type': 'test', 'data': 'value1'})
        assert batcher.pending_count == 1

        await batcher.add({'type': 'test', 'data': 'value2'})
        assert batcher.pending_count == 2

    @pytest.mark.asyncio
    async def test_batcher_immediate_types(self):
        """Test that immediate types bypass batching."""
        from skyspy.socketio.utils.batcher import MessageBatcher

        callback = AsyncMock()
        batcher = MessageBatcher(callback)

        # Alert messages should be sent immediately
        await batcher.add({'type': 'alert', 'data': 'urgent'})

        # Callback should have been called immediately
        callback.assert_called()

    @pytest.mark.asyncio
    async def test_batcher_flush_now(self):
        """Test that flush_now sends all pending messages."""
        from skyspy.socketio.utils.batcher import MessageBatcher

        callback = AsyncMock()
        # Use config dict with long window to prevent auto-flush
        batcher = MessageBatcher(callback, config={'window_ms': 10000, 'max_size': 50, 'max_bytes': 1024 * 1024, 'immediate_types': ['alert', 'safety', 'emergency']})

        await batcher.add({'type': 'test', 'data': 'value1'})
        await batcher.add({'type': 'test', 'data': 'value2'})

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

        with patch('skyspy.socketio.middleware.auth.settings') as mock_settings:
            mock_settings.AUTH_MODE = 'public'

            user, error = await authenticate_socket({})

            assert error is None
            assert isinstance(user, AnonymousUser)

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_authenticate_no_token_private_mode(self):
        """Test authentication in private mode without token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch('skyspy.socketio.middleware.auth.settings') as mock_settings:
            mock_settings.AUTH_MODE = 'private'

            user, error = await authenticate_socket({})

            assert error is not None
            assert 'required' in error.lower()

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_authenticate_invalid_jwt(self):
        """Test authentication with invalid JWT token."""
        from skyspy.socketio.middleware.auth import authenticate_socket

        with patch('skyspy.socketio.middleware.auth.settings') as mock_settings:
            mock_settings.AUTH_MODE = 'private'

            user, error = await authenticate_socket({'token': 'invalid_jwt_token'})

            assert error is not None


class TestPermissionsMiddleware:
    """Tests for permissions middleware."""

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_check_topic_permission_public_mode(self):
        """Test topic permission in public mode."""
        from skyspy.socketio.middleware.permissions import check_topic_permission

        with patch('skyspy.socketio.middleware.permissions.settings') as mock_settings:
            mock_settings.AUTH_MODE = 'public'

            # In public mode, basic topics should be accessible
            user = AnonymousUser()
            allowed = await check_topic_permission(user, 'aircraft')

            assert allowed is True

    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_get_allowed_topics(self):
        """Test getting list of allowed topics for user."""
        from skyspy.socketio.middleware.permissions import get_allowed_topics

        with patch('skyspy.socketio.middleware.permissions.settings') as mock_settings:
            mock_settings.AUTH_MODE = 'public'

            user = AnonymousUser()
            topics = await get_allowed_topics(user)

            assert isinstance(topics, list)
            assert 'aircraft' in topics


class TestBroadcastUtility:
    """Tests for broadcast utility."""

    def test_sync_emit_formats_message_correctly(self):
        """Test that sync_emit formats messages for Socket.IO."""
        from skyspy.socketio.utils.broadcast import sync_emit

        with patch('skyspy.socketio.utils.broadcast._get_redis_client') as mock_redis:
            mock_client = MagicMock()
            mock_redis.return_value = mock_client

            result = sync_emit('test:event', {'data': 'value'}, room='test_room')

            # Should have called publish on Redis
            mock_client.publish.assert_called_once()
            assert result is True

    def test_broadcast_to_room(self):
        """Test broadcast_to_room helper."""
        from skyspy.socketio.utils.broadcast import broadcast_to_room

        with patch('skyspy.socketio.utils.broadcast.sync_emit') as mock_emit:
            mock_emit.return_value = True

            result = broadcast_to_room('test_room', 'test:event', {'data': 'value'})

            # broadcast_to_room calls sync_emit with keyword arguments
            mock_emit.assert_called_once_with(
                event='test:event', data={'data': 'value'}, room='test_room', namespace='/', skip_sid=None
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

        namespace = MainNamespace('/')
        assert namespace.namespace == '/'


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
        assert namespace.namespace == '/audio'


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
        assert namespace.namespace == '/cannonball'


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
