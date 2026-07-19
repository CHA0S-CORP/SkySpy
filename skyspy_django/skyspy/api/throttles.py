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


class _ConfiguredScopeThrottle(UserRateThrottle):
    """Base for throttles whose rate comes from ``DEFAULT_THROTTLE_RATES``.

    The rate is read from settings by ``scope``; if the scope is absent (as in
    the test settings, which omit these keys) the throttle disables itself so
    tests aren't rate-limited. Keys buckets by user pk when authenticated and by
    client IP otherwise, so anonymous callers can't evade the limit.
    """

    default_rate = None

    def get_rate(self):
        throttle_rates = getattr(settings, "REST_FRAMEWORK", {}).get("DEFAULT_THROTTLE_RATES", {})
        if self.scope not in throttle_rates:
            return None
        return throttle_rates.get(self.scope) or self.default_rate

    def allow_request(self, request, view):
        if self.get_rate() is None:
            return True
        return super().allow_request(request, view)


class ExternalLookupRateThrottle(_ConfiguredScopeThrottle):
    """Strict limit for endpoints that fan out to external aircraft databases
    (OpenSky / ADSBX / tar1090 / FAA). Each call can trigger several outbound
    requests, so an unauthenticated hex-scan is a real cost/ban vector."""

    scope = "external_lookup"
    default_rate = "10/minute"


class WeatherRateThrottle(_ConfiguredScopeThrottle):
    """Limit for weather/PIREP endpoints that hit aviationweather.gov."""

    scope = "weather"
    default_rate = "30/minute"


class GeodataRateThrottle(_ConfiguredScopeThrottle):
    """Limit for geodata/terrain/geojson endpoints (filesystem + compute)."""

    scope = "geodata"
    default_rate = "60/minute"
