"""
Authentication classes for SkySpy REST API.

Provides API key authentication and JWT token authentication.
"""
import logging
from django.conf import settings
from django.utils import timezone
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

logger = logging.getLogger(__name__)


class APIKeyAuthentication(authentication.BaseAuthentication):
    """
    Authentication using API keys.

    API keys can be passed via:
    - Authorization header: `Authorization: ApiKey sk_xxxx`
    - X-API-Key header: `X-API-Key: sk_xxxx`

    Note: Query parameter support has been removed for security reasons.
    API keys in URLs can be leaked via referrer headers, browser history, and server logs.

    API keys are user-scoped and can have limited permissions.
    """

    keyword = 'ApiKey'
    header_name = 'X-API-Key'

    def authenticate(self, request):
        """Authenticate the request using API key."""
        # Check if API key auth is enabled
        if not getattr(settings, 'API_KEY_ENABLED', True):
            return None

        # Try to get API key from various sources
        api_key = self._get_api_key(request)
        if not api_key:
            return None

        # Validate and get user
        user = self._validate_key(api_key, request)
        if user is None:
            return None

        return (user, api_key)

    def authenticate_header(self, request):
        """Return authentication header for 401 responses."""
        return self.keyword

    def _get_api_key(self, request):
        """Extract API key from request headers only.

        Security note: Query parameter support has been removed to prevent
        API key leakage via referrer headers, browser history, and server logs.
        """
        # Check Authorization header
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith(f'{self.keyword} '):
            return auth_header[len(self.keyword) + 1:]

        # Check X-API-Key header
        api_key_header = request.META.get(f'HTTP_{self.header_name.upper().replace("-", "_")}')
        if api_key_header:
            return api_key_header

        return None

    def _validate_key(self, api_key, request):
        """Validate API key and return associated user."""
        from skyspy.models.auth import APIKey

        # Hash the key for lookup
        key_hash = APIKey.hash_key(api_key)

        try:
            api_key_obj = APIKey.objects.select_related('user').get(key_hash=key_hash)
        except APIKey.DoesNotExist:
            logger.warning(f"Invalid API key attempted: {api_key[:10]}...")
            raise AuthenticationFailed('Invalid API key')

        # Check if key is valid
        if not api_key_obj.is_valid():
            if not api_key_obj.is_active:
                raise AuthenticationFailed('API key is disabled')
            if api_key_obj.is_expired:
                raise AuthenticationFailed('API key has expired')
            raise AuthenticationFailed('Invalid API key')

        # Update last used
        client_ip = self._get_client_ip(request)
        api_key_obj.last_used_at = timezone.now()
        api_key_obj.last_used_ip = client_ip
        api_key_obj.save(update_fields=['last_used_at', 'last_used_ip'])

        # Attach API key scopes to request for permission checking
        request.api_key_scopes = api_key_obj.scopes

        return api_key_obj.user

    def _get_client_ip(self, request):
        """Get client IP address from request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')


class JWTCookieAuthentication(authentication.BaseAuthentication):
    """
    JWT authentication from cookies.

    Looks for JWT in:
    - Authorization header: `Authorization: Bearer eyJ...`
    - Cookie: `access_token`

    This provides CSRF-protected cookie-based auth for web clients.
    """

    keyword = 'Bearer'
    cookie_name = 'access_token'

    def authenticate(self, request):
        """Authenticate using JWT token."""
        from rest_framework_simplejwt.authentication import JWTAuthentication
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

        # Try Authorization header first
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith(f'{self.keyword} '):
            token = auth_header[len(self.keyword) + 1:]
        else:
            # Fall back to cookie
            token = request.COOKIES.get(self.cookie_name)

        if not token:
            return None

        # Validate JWT
        jwt_auth = JWTAuthentication()
        try:
            validated_token = jwt_auth.get_validated_token(token)
            user = jwt_auth.get_user(validated_token)
            return (user, validated_token)
        except (InvalidToken, TokenError) as e:
            logger.debug(f"JWT validation failed: {e}")
            raise AuthenticationFailed('Invalid or expired token')

    def authenticate_header(self, request):
        """Return authentication header for 401 responses."""
        return self.keyword


class OptionalJWTAuthentication(authentication.BaseAuthentication):
    """
    Optional JWT authentication.

    Does not raise AuthenticationFailed if no token is provided.
    Used for endpoints that work with or without authentication.
    """

    keyword = 'Bearer'
    cookie_name = 'access_token'

    def authenticate(self, request):
        """Authenticate using JWT token, but don't fail if missing."""
        from rest_framework_simplejwt.authentication import JWTAuthentication
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

        # Get token from header or cookie
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith(f'{self.keyword} '):
            token = auth_header[len(self.keyword) + 1:]
        else:
            token = request.COOKIES.get(self.cookie_name)

        if not token:
            # No token - return None to allow anonymous access
            return None

        # Validate JWT
        jwt_auth = JWTAuthentication()
        try:
            validated_token = jwt_auth.get_validated_token(token)
            user = jwt_auth.get_user(validated_token)
            return (user, validated_token)
        except (InvalidToken, TokenError):
            # Invalid token - also allow anonymous access
            # This prevents errors when tokens expire
            return None

    def authenticate_header(self, request):
        return self.keyword
