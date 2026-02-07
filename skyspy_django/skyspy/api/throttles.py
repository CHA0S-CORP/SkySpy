"""
Custom throttle classes for rate limiting.

Provides stricter rate limits for sensitive endpoints.
"""

from django.conf import settings
from rest_framework.throttling import UserRateThrottle


class AuthRateThrottle(UserRateThrottle):
    """
    Stricter rate limit for authentication endpoints.

    Limits login attempts to prevent brute-force attacks.
    """

    scope = "auth"

    def get_rate(self):
        """Return rate limit, disabled in test mode."""
        # Check if throttling is disabled via settings
        throttle_rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        if throttle_rates.get(self.scope) is None:
            return None
        return "5/minute"

    def allow_request(self, request, view):
        """Allow request if throttling is disabled."""
        if self.get_rate() is None:
            return True
        return super().allow_request(request, view)


class UploadRateThrottle(UserRateThrottle):
    """
    Rate limit for file upload endpoints.

    Prevents abuse of upload functionality.
    """

    scope = "upload"

    def get_rate(self):
        """Return rate limit, disabled in test mode."""
        # Check if throttling is disabled via settings
        throttle_rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        if throttle_rates.get(self.scope) is None:
            return None
        return "10/minute"

    def allow_request(self, request, view):
        """Allow request if throttling is disabled."""
        if self.get_rate() is None:
            return True
        return super().allow_request(request, view)
