"""
WebSocket authentication middleware for Django Channels.

Provides:
- TokenAuthMiddleware: JWT authentication from query string or headers
- WebSocketPermissionMiddleware: Permission checking for WebSocket subscriptions
"""
import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.conf import settings
from django.contrib.auth.models import AnonymousUser

logger = logging.getLogger(__name__)


class TokenAuthMiddleware(BaseMiddleware):
    """
    WebSocket authentication middleware.

    Validates JWT tokens from:
    - Query string: ?token=eyJ...
    - Sec-WebSocket-Protocol header: Bearer, eyJ...

    Sets scope['user'] to the authenticated user or AnonymousUser.
    Sets scope['auth_error'] if authentication fails.
    """

    async def __call__(self, scope, receive, send):
        # Check auth mode
        auth_mode = getattr(settings, 'AUTH_MODE', 'hybrid')

        if auth_mode == 'public':
            # Public mode - allow anonymous access
            scope['user'] = AnonymousUser()
            scope['public_mode'] = True
            return await super().__call__(scope, receive, send)

        # Try to authenticate
        user = await self._authenticate(scope)
        scope['user'] = user

        # For hybrid mode, track authentication state
        scope['is_authenticated'] = user.is_authenticated

        # Reject connection at middleware level if flagged
        if scope.get('reject_connection'):
            # Send WebSocket close frame with 4001 (Unauthorized) code
            await send({
                'type': 'websocket.close',
                'code': 4001,
            })
            return

        return await super().__call__(scope, receive, send)

    async def _authenticate(self, scope):
        """Attempt to authenticate the WebSocket connection."""
        auth_mode = getattr(settings, 'AUTH_MODE', 'hybrid')
        reject_invalid = getattr(settings, 'WS_REJECT_INVALID_TOKENS', False)

        # Extract token from query string
        token = self._get_token_from_query(scope)

        if not token:
            # Try Sec-WebSocket-Protocol header
            token = self._get_token_from_protocol(scope)

        if not token:
            # No token provided
            if auth_mode == 'private':
                scope['auth_error'] = 'Authentication required'
                logger.warning("WebSocket authentication failed: no token provided in private mode")
            return AnonymousUser()

        # Validate JWT token
        user = await self._validate_jwt(token)
        if user:
            logger.debug(f"WebSocket authenticated: {user.username}")
            return user

        # Try API key
        user = await self._validate_api_key(token)
        if user:
            logger.debug(f"WebSocket authenticated via API key: {user.username}")
            return user

        # Invalid token - set auth_error prominently
        error_msg = 'Invalid or expired token'
        scope['auth_error'] = error_msg
        scope['auth_failed'] = True  # Additional flag for explicit failure detection
        logger.warning(f"WebSocket authentication failed: {error_msg}")

        # Reject invalid tokens if configured (instead of falling back to anonymous)
        if reject_invalid or auth_mode == 'private':
            scope['reject_connection'] = True
            logger.info("WebSocket connection will be rejected due to invalid token")

        return AnonymousUser()

    def _get_token_from_query(self, scope):
        """Extract token from query string.

        Security note: Passing tokens via query string is discouraged as it
        may expose tokens in server logs and browser history. Consider using
        the Sec-WebSocket-Protocol header instead.
        """
        query_string = scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        tokens = params.get('token', [])
        if tokens:
            logger.warning(
                "WebSocket token passed via query string - this is discouraged for security reasons. "
                "Consider using the Sec-WebSocket-Protocol header instead."
            )
            return tokens[0]
        return None

    def _get_token_from_protocol(self, scope):
        """Extract token from Sec-WebSocket-Protocol header."""
        # Headers are list of (name, value) tuples
        for name, value in scope.get('headers', []):
            if name == b'sec-websocket-protocol':
                # Format: "Bearer, eyJ..."
                parts = value.decode().split(', ')
                if len(parts) >= 2 and parts[0].lower() == 'bearer':
                    return parts[1]
        return None

    @database_sync_to_async
    def _validate_jwt(self, token):
        """Validate JWT token and return user."""
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication
            from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

            jwt_auth = JWTAuthentication()
            validated_token = jwt_auth.get_validated_token(token)
            user = jwt_auth.get_user(validated_token)
            return user
        except (InvalidToken, TokenError) as e:
            logger.debug(f"JWT validation failed: {e}")
            return None
        except Exception as e:
            logger.exception(f"JWT validation error: {e}")
            return None

    @database_sync_to_async
    def _validate_api_key(self, token):
        """Validate API key and return user."""
        if not getattr(settings, 'API_KEY_ENABLED', True):
            return None

        if not token.startswith('sk_'):
            return None

        try:
            from skyspy.models.auth import APIKey

            key_hash = APIKey.hash_key(token)
            api_key = APIKey.objects.select_related('user').get(key_hash=key_hash)

            if api_key.is_valid():
                return api_key.user
        except Exception as e:
            logger.debug(f"API key validation failed: {e}")

        return None


class WebSocketPermissionMiddleware(BaseMiddleware):
    """
    Permission checking middleware for WebSocket subscriptions.

    Checks feature-based permissions when clients subscribe to topics.
    Attaches permission helpers to scope for use by consumers.
    """

    # Map WebSocket topics to feature permissions
    TOPIC_PERMISSIONS = {
        'aircraft': 'aircraft.view',
        'military': 'aircraft.view_military',
        'alerts': 'alerts.view',
        'safety': 'safety.view',
        'acars': 'acars.view',
        'audio': 'audio.view',
        'system': 'system.view_status',
    }

    async def __call__(self, scope, receive, send):
        # Attach permission helpers to scope
        scope['check_permission'] = self._make_permission_checker(scope)
        scope['get_allowed_topics'] = lambda: self._get_allowed_topics(scope)
        scope['topic_permissions'] = self.TOPIC_PERMISSIONS

        return await super().__call__(scope, receive, send)

    def _make_permission_checker(self, scope):
        """Create a permission checker bound to the current scope."""
        async def check_permission(permission):
            return await self._check_permission(scope, permission)
        return check_permission

    @database_sync_to_async
    def _check_permission(self, scope, permission):
        """Check if the user in scope has the given permission."""
        # Public mode - all permissions granted
        if scope.get('public_mode'):
            return True

        user = scope.get('user')
        if not user or not user.is_authenticated:
            # Check if this permission's feature is public
            return self._is_feature_public(permission)

        if user.is_superuser:
            return True

        try:
            profile = user.skyspy_profile
            return profile.has_permission(permission)
        except Exception:
            return False

    def _is_feature_public(self, permission):
        """Check if the feature for this permission is publicly accessible."""
        from skyspy.models.auth import FeatureAccess

        # Extract feature from permission (e.g., 'aircraft.view' -> 'aircraft')
        feature = permission.split('.')[0]

        try:
            config = FeatureAccess.objects.get(feature=feature)
            return config.read_access == 'public'
        except FeatureAccess.DoesNotExist:
            return False

    @database_sync_to_async
    def _get_allowed_topics(self, scope):
        """Get list of topics the user is allowed to subscribe to."""
        allowed = []

        for topic, permission in self.TOPIC_PERMISSIONS.items():
            if self._check_permission_sync(scope, permission):
                allowed.append(topic)

        return allowed

    def _check_permission_sync(self, scope, permission):
        """Synchronous permission check for use in sync context."""
        if scope.get('public_mode'):
            return True

        user = scope.get('user')
        if not user or not user.is_authenticated:
            return self._is_feature_public(permission)

        if user.is_superuser:
            return True

        try:
            profile = user.skyspy_profile
            return profile.has_permission(permission)
        except Exception:
            return False


def TokenAuthMiddlewareStack(inner):
    """
    Convenience function to create a middleware stack with token auth.

    Usage in asgi.py:
        from skyspy.auth.websocket import TokenAuthMiddlewareStack

        application = ProtocolTypeRouter({
            "websocket": TokenAuthMiddlewareStack(
                URLRouter(websocket_urlpatterns)
            ),
        })
    """
    return TokenAuthMiddleware(WebSocketPermissionMiddleware(inner))
