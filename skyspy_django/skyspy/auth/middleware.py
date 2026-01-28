"""
Authentication middleware for SkySpy.

Provides:
- AuthModeMiddleware: Handles different auth modes (public/private/hybrid)
- LastActiveMiddleware: Updates user's last active timestamp
"""
import logging
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone

logger = logging.getLogger(__name__)


class AuthModeMiddleware:
    """
    Middleware that handles authentication mode configuration.

    Supports three modes:
    - 'public': No authentication required for any endpoint
    - 'private': Authentication required for all endpoints
    - 'hybrid': Per-feature configuration (default)

    Adds auth_mode and auth_config to the request for views to use.
    """

    # Endpoints that are always public (health checks, auth endpoints)
    PUBLIC_PATHS = [
        '/health',
        '/metrics',
        '/api/v1/auth/config',
        '/api/v1/auth/login',
        '/api/v1/auth/oidc/',
        '/api/schema',
        '/api/docs',
    ]

    def __init__(self, get_response):
        self.get_response = get_response
        self.auth_mode = getattr(settings, 'AUTH_MODE', 'hybrid')

    def __call__(self, request):
        # Add auth mode to request
        request.auth_mode = self.auth_mode
        request.auth_config = self._get_auth_config()

        # Always allow public paths
        if self._is_public_path(request.path):
            return self.get_response(request)

        # Handle based on auth mode
        if self.auth_mode == 'public':
            # Everything is public, proceed
            return self.get_response(request)

        elif self.auth_mode == 'private':
            # Everything requires authentication
            if not request.user.is_authenticated:
                return JsonResponse(
                    {'error': 'Authentication required'},
                    status=401
                )

        # For 'hybrid' mode, let the permission classes handle it
        return self.get_response(request)

    def _is_public_path(self, path):
        """Check if path is in the public paths list."""
        for public_path in self.PUBLIC_PATHS:
            if path.startswith(public_path):
                return True
        return False

    def _get_auth_config(self):
        """Get authentication configuration for frontend."""
        return {
            'auth_mode': self.auth_mode,
            'auth_enabled': self.auth_mode != 'public',
            'oidc_enabled': getattr(settings, 'OIDC_ENABLED', False),
            'local_auth_enabled': getattr(settings, 'LOCAL_AUTH_ENABLED', True),
            'api_key_enabled': getattr(settings, 'API_KEY_ENABLED', True),
        }


class LastActiveMiddleware:
    """
    Middleware that updates the user's last active timestamp.

    Only updates at most once per minute to avoid excessive DB writes.
    """

    UPDATE_INTERVAL_SECONDS = 60

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Update last active for authenticated users
        if hasattr(request, 'user') and request.user.is_authenticated:
            self._update_last_active(request)

        return response

    def _update_last_active(self, request):
        """Update user's last active timestamp."""
        try:
            profile = getattr(request.user, 'skyspy_profile', None)
            if not profile:
                return

            # Only update if enough time has passed
            now = timezone.now()
            if profile.last_active:
                time_since_update = (now - profile.last_active).total_seconds()
                if time_since_update < self.UPDATE_INTERVAL_SECONDS:
                    return

            # Update last active
            profile.last_active = now

            # Update IP address if available
            ip = self._get_client_ip(request)
            if ip:
                profile.last_login_ip = ip

            profile.save(update_fields=['last_active', 'last_login_ip'])

        except Exception as e:
            logger.debug(f"Failed to update last active: {e}")

    def _get_client_ip(self, request):
        """Get client IP address from request headers."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')


class PublicModeMiddleware:
    """
    Middleware for fully public mode.

    Creates an anonymous user context for permission checking.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # In public mode, set a flag for permission classes
        if getattr(settings, 'AUTH_MODE', 'hybrid') == 'public':
            request.public_mode = True

        return self.get_response(request)
