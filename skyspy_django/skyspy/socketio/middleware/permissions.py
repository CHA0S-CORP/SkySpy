"""
Socket.IO permission middleware for SkySpy.

Provides permission checking for Socket.IO topic subscriptions
and request types.
"""
import logging
from typing import Union

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth.models import AnonymousUser, User

logger = logging.getLogger(__name__)


# Map WebSocket/Socket.IO topics to feature permissions
TOPIC_PERMISSIONS = {
    'aircraft': 'aircraft.view',
    'military': 'aircraft.view_military',
    'alerts': 'alerts.view',
    'safety': 'safety.view',
    'acars': 'acars.view',
    'audio': 'audio.view',
    'system': 'system.view_status',
    'stats': 'stats.view',
    'airspace': 'airspace.view',
    'notams': 'notams.view',
}

# Map request types to permissions
REQUEST_PERMISSIONS = {
    # Aircraft requests
    'get_aircraft': 'aircraft.view',
    'get_aircraft_details': 'aircraft.view_details',
    'get_military': 'aircraft.view_military',

    # Alert requests
    'get_alerts': 'alerts.view',
    'create_alert': 'alerts.create',
    'update_alert': 'alerts.edit',
    'delete_alert': 'alerts.delete',

    # Safety requests
    'get_safety_events': 'safety.view',
    'acknowledge_safety': 'safety.acknowledge',

    # ACARS requests
    'get_acars': 'acars.view',
    'get_acars_details': 'acars.view_full',

    # Audio requests
    'get_audio': 'audio.view',
    'upload_audio': 'audio.upload',

    # History requests
    'get_history': 'history.view',
    'export_history': 'history.export',

    # System requests
    'get_system_status': 'system.view_status',
    'get_metrics': 'system.view_metrics',
}


async def check_topic_permission(user: Union[User, AnonymousUser], topic: str) -> bool:
    """
    Check if user has permission to subscribe to a topic.

    Args:
        user: User or AnonymousUser instance
        topic: Topic name (e.g., 'aircraft', 'alerts', 'safety')

    Returns:
        True if user has permission, False otherwise
    """
    auth_mode = getattr(settings, 'AUTH_MODE', 'hybrid')

    # Public mode - all permissions granted
    if auth_mode == 'public':
        return True

    # Get the permission required for this topic
    permission = TOPIC_PERMISSIONS.get(topic)

    if not permission:
        # Unknown topic - deny by default
        logger.warning(f"Unknown topic requested: {topic}")
        return False

    return await _check_permission(user, permission)


async def check_request_permission(user: Union[User, AnonymousUser], request_type: str) -> bool:
    """
    Check if user has permission to make a specific request.

    Args:
        user: User or AnonymousUser instance
        request_type: Request type (e.g., 'get_aircraft', 'create_alert')

    Returns:
        True if user has permission, False otherwise
    """
    auth_mode = getattr(settings, 'AUTH_MODE', 'hybrid')

    # Public mode - all permissions granted
    if auth_mode == 'public':
        return True

    # Get the permission required for this request
    permission = REQUEST_PERMISSIONS.get(request_type)

    if not permission:
        # Unknown request type - deny by default
        logger.warning(f"Unknown request type: {request_type}")
        return False

    return await _check_permission(user, permission)


async def _check_permission(user: Union[User, AnonymousUser], permission: str) -> bool:
    """
    Check if user has a specific permission.

    Respects AUTH_MODE and public feature access.

    Args:
        user: User or AnonymousUser instance
        permission: Permission string (e.g., 'aircraft.view')

    Returns:
        True if user has permission, False otherwise
    """
    # Unauthenticated users - check if feature is public
    if not user or not user.is_authenticated:
        return await _is_feature_public(permission)

    # Superusers have all permissions
    if user.is_superuser:
        return True

    # Check user's permissions via their profile
    return await _check_user_permission(user, permission)


@sync_to_async
def _is_feature_public(permission: str) -> bool:
    """
    Check if the feature for this permission is publicly accessible.

    Args:
        permission: Permission string (e.g., 'aircraft.view')

    Returns:
        True if feature is public, False otherwise
    """
    from skyspy.models.auth import FeatureAccess

    # Extract feature from permission (e.g., 'aircraft.view' -> 'aircraft')
    feature = permission.split('.')[0]

    try:
        config = FeatureAccess.objects.get(feature=feature)
        return config.read_access == 'public'
    except FeatureAccess.DoesNotExist:
        # Default to not public if no config exists
        return False


@sync_to_async
def _check_user_permission(user: User, permission: str) -> bool:
    """
    Check if an authenticated user has a specific permission.

    Args:
        user: Authenticated User instance
        permission: Permission string (e.g., 'aircraft.view')

    Returns:
        True if user has permission, False otherwise
    """
    try:
        profile = user.skyspy_profile
        return profile.has_permission(permission)
    except Exception as e:
        logger.debug(f"Error checking user permission: {e}")
        return False


async def get_allowed_topics(user: Union[User, AnonymousUser]) -> list:
    """
    Get list of topics the user is allowed to subscribe to.

    Args:
        user: User or AnonymousUser instance

    Returns:
        List of allowed topic names
    """
    allowed = []

    for topic in TOPIC_PERMISSIONS.keys():
        if await check_topic_permission(user, topic):
            allowed.append(topic)

    return allowed
