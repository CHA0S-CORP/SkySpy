"""
Admin API module.

This module provides a logger for admin operations that can be patched in tests.
The actual ViewSets are defined in skyspy/api/auth.py and registered in urls.py.
"""
import logging

# Logger for admin operations - can be patched in tests
logger = logging.getLogger(__name__)

# Re-export from auth module for convenience
from skyspy.api.auth import (
    UserViewSet,
    RoleViewSet,
    UserRoleViewSet,
    APIKeyViewSet,
    FeatureAccessViewSet,
    OIDCClaimMappingViewSet,
)

__all__ = [
    'logger',
    'UserViewSet',
    'RoleViewSet',
    'UserRoleViewSet',
    'APIKeyViewSet',
    'FeatureAccessViewSet',
    'OIDCClaimMappingViewSet',
]
