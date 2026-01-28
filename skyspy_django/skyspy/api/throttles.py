"""
Custom throttle classes for rate limiting.

Provides stricter rate limits for sensitive endpoints.
"""
from rest_framework.throttling import UserRateThrottle


class AuthRateThrottle(UserRateThrottle):
    """
    Stricter rate limit for authentication endpoints.

    Limits login attempts to prevent brute-force attacks.
    """
    scope = 'auth'
    rate = '5/minute'


class UploadRateThrottle(UserRateThrottle):
    """
    Rate limit for file upload endpoints.

    Prevents abuse of upload functionality.
    """
    scope = 'upload'
    rate = '10/minute'
