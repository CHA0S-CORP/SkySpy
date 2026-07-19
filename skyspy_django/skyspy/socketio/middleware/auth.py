"""
Socket.IO authentication middleware for SkySpy.

Provides JWT and API key authentication for Socket.IO connections.
Validates tokens from the auth dict passed during connect.
"""

import logging

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth.models import AnonymousUser, User
from django.db import DatabaseError

logger = logging.getLogger(__name__)


async def authenticate_socket(auth: dict | None) -> tuple[User, str | None, list | None]:
    """
    Authenticate a Socket.IO connection.

    Validates JWT tokens or API keys from the auth dict passed during connect.
    Respects AUTH_MODE setting (public, hybrid, private).

    Args:
        auth: Authentication dict from Socket.IO connect, e.g.:
              {'token': 'eyJ...'} for JWT
              {'token': 'sk_xxx'} for API key

    Returns:
        Tuple of (user, error_message, api_key_scopes):
        - user: Authenticated User or AnonymousUser
        - error_message: None if successful, error string if failed
        - api_key_scopes: the connecting API key's scope list when the auth was a
          SCOPED key, else None (JWT / anonymous / unscoped key = full user perms,
          mirroring the REST `request.api_key_scopes` semantics). A truthy scope
          list must constrain every subsequent topic/request permission check.
    """
    auth_mode = getattr(settings, "AUTH_MODE", "hybrid")

    # Public mode - allow anonymous access
    if auth_mode == "public":
        logger.debug("Socket.IO auth: public mode, allowing anonymous access")
        return AnonymousUser(), None, None

    # Extract token from auth dict
    token = None
    if auth and isinstance(auth, dict):
        token = auth.get("token")

    if not token:
        # No token provided
        if auth_mode == "private":
            error_msg = "Authentication required"
            logger.warning(f"Socket.IO authentication failed: {error_msg}")
            return AnonymousUser(), error_msg, None

        # Hybrid mode - allow anonymous but track it
        logger.debug("Socket.IO auth: no token provided, allowing anonymous in hybrid mode")
        return AnonymousUser(), None, None

    # Try JWT validation first
    user = await _validate_jwt(token)
    if user:
        logger.debug(f"Socket.IO authenticated via JWT: {user.username}")
        return user, None, None

    # Try API key validation
    user, scopes = await _validate_api_key(token)
    if user:
        logger.debug(f"Socket.IO authenticated via API key: {user.username} (scopes={scopes or 'all'})")
        return user, None, scopes

    # Invalid token
    error_msg = "Invalid or expired token"
    logger.warning(f"Socket.IO authentication failed: {error_msg}")

    # In private mode, return error
    if auth_mode == "private":
        return AnonymousUser(), error_msg, None

    # In hybrid mode with WS_REJECT_INVALID_TOKENS, return error
    reject_invalid = getattr(settings, "WS_REJECT_INVALID_TOKENS", False)
    if reject_invalid:
        return AnonymousUser(), error_msg, None

    # Hybrid mode - fall back to anonymous but set error
    return AnonymousUser(), error_msg, None


@sync_to_async
def _validate_jwt(token: str) -> User | None:
    """
    Validate JWT token and return user.

    Args:
        token: JWT token string

    Returns:
        User if valid, None otherwise
    """
    # Skip if token looks like an API key
    if token.startswith("sk_"):
        return None

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
    except Exception as e:  # broad: third-party JWT auth call, unknowable failure modes; must never crash connect
        logger.exception(f"JWT validation error: {e}")
        return None


@sync_to_async
def _validate_api_key(token: str) -> tuple[User | None, list | None]:
    """
    Validate API key and return (user, scopes).

    Args:
        token: API key string (should start with 'sk_')

    Returns:
        (user, scopes) if valid, else (None, None). `scopes` is the key's scope
        list (falsy = unscoped = full user permissions), threaded through the
        connection so the socket permission layer can constrain a scoped key
        exactly like the REST FeatureBasedPermission does.
    """
    # Check if API keys are enabled
    if not getattr(settings, "API_KEY_ENABLED", True):
        return None, None

    # Only process tokens that look like API keys
    if not token.startswith("sk_"):
        return None, None

    try:
        from skyspy.models.auth import APIKey

        key_hash = APIKey.hash_key(token)
        api_key = APIKey.objects.select_related("user").get(key_hash=key_hash)

        if api_key.is_valid():
            # Update last used timestamp
            from django.utils import timezone

            api_key.last_used_at = timezone.now()
            api_key.save(update_fields=["last_used_at"])
            return api_key.user, api_key.scopes

        logger.debug(f"API key is expired or inactive: {api_key.key_prefix}...")
        return None, None
    except APIKey.DoesNotExist:
        logger.debug("API key not found in database")
        return None, None
    except (DatabaseError, ValueError, TypeError) as e:
        logger.debug(f"API key validation failed: {e}")
        return None, None
