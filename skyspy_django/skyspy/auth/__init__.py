"""
SkySpy Authentication Module.

Provides authentication backends, middleware, and permission classes
for JWT, OIDC, and API key authentication.
"""

from skyspy.auth.backends import OIDCAuthenticationBackend, LocalAuthenticationBackend
from skyspy.auth.middleware import AuthModeMiddleware, LastActiveMiddleware
from skyspy.auth.permissions import (
    FeatureBasedPermission,
    HasPermission,
    HasAnyPermission,
    IsAuthenticatedOrPublic,
    IsAdminUser,
    IsSuperAdmin,
    IsOwnerOrAdmin,
    CanAccessAlert,
)
from skyspy.auth.authentication import (
    APIKeyAuthentication,
    JWTCookieAuthentication,
    OptionalJWTAuthentication,
)
from skyspy.auth.websocket import (
    TokenAuthMiddleware,
    WebSocketPermissionMiddleware,
    TokenAuthMiddlewareStack,
)

__all__ = [
    # Backends
    'OIDCAuthenticationBackend',
    'LocalAuthenticationBackend',
    # HTTP Middleware
    'AuthModeMiddleware',
    'LastActiveMiddleware',
    # Permissions
    'FeatureBasedPermission',
    'HasPermission',
    'HasAnyPermission',
    'IsAuthenticatedOrPublic',
    'IsAdminUser',
    'IsSuperAdmin',
    'IsOwnerOrAdmin',
    'CanAccessAlert',
    # Authentication Classes
    'APIKeyAuthentication',
    'JWTCookieAuthentication',
    'OptionalJWTAuthentication',
    # WebSocket
    'TokenAuthMiddleware',
    'WebSocketPermissionMiddleware',
    'TokenAuthMiddlewareStack',
]
