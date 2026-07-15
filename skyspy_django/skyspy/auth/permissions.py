"""
Permission classes for SkySpy.

Provides feature-based and granular permission checking for REST API views.
"""

import logging

from django.conf import settings
from django.db import DatabaseError
from rest_framework import permissions

logger = logging.getLogger(__name__)


def _scope_covers_permission(scopes, permission):
    """Check whether an API key scope list covers a permission string.

    Scopes store full permission strings (e.g. 'alerts.view'), validated
    against ALL_PERMISSIONS at key creation. A feature's manage_all scope
    implies every action on that feature.
    """
    if permission in scopes:
        return True
    feature = permission.partition(".")[0]
    return f"{feature}.manage_all" in scopes


class IsAuthenticatedOrPublic(permissions.BasePermission):
    """
    Allow access if user is authenticated OR system is in public mode.

    Used for endpoints that should be accessible based on auth mode.
    """

    def has_permission(self, request, view):
        # Check auth mode
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")

        if auth_mode == "public":
            return True

        return request.user and request.user.is_authenticated


class FeatureBasedPermission(permissions.BasePermission):
    """
    Permission class that checks feature-level access configuration.

    Maps view classes to features and checks the FeatureAccess model
    to determine if access is allowed.
    """

    # Map view class names to feature names
    FEATURE_MAP = {
        # Aircraft
        "AircraftViewSet": "aircraft",
        "AircraftSightingViewSet": "aircraft",
        "AircraftSessionViewSet": "aircraft",
        "AircraftInfoViewSet": "aircraft",
        "AirframeViewSet": "aircraft",
        "AviationViewSet": "aircraft",
        # Alerts
        "AlertRuleViewSet": "alerts",
        "AlertHistoryViewSet": "alerts",
        "AlertSubscriptionViewSet": "alerts",
        # Notifications (related to alerts)
        "NotificationChannelViewSet": "alerts",
        "NotificationViewSet": "alerts",
        # Safety
        "SafetyEventViewSet": "safety",
        # Audio
        "AudioViewSet": "audio",
        "AudioTransmissionViewSet": "audio",
        # ACARS
        "AcarsViewSet": "acars",
        "AcarsMessageViewSet": "acars",
        # History
        "HistoryViewSet": "history",
        "SightingViewSet": "history",
        "SessionViewSet": "history",
        "ArchiveViewSet": "history",
        # System and Stats
        "SystemViewSet": "system",
        "HealthViewSet": "system",
        "MetricsViewSet": "system",
        "TrackingQualityViewSet": "system",
        "EngagementViewSet": "system",
        "FavoritesViewSet": "system",
        "FlightPatternsViewSet": "system",
        "FlightPatternStatsViewSet": "system",
        "GeographicStatsViewSet": "system",
        "CombinedStatsViewSet": "system",
        "AntennaAnalyticsViewSet": "system",
        "RouteLookupView": "system",
        "GeodataStatsView": "system",
        "WeatherCacheStatsView": "system",
        # Map and navigation
        "MapViewSet": "aircraft",
        "NotamViewSet": "aircraft",
        "MobileViewSet": "aircraft",
        "WatchListViewSet": "aircraft",
        # User management
        "UserViewSet": "users",
        "SkyspyUserViewSet": "users",
        "UserRoleViewSet": "users",
        "APIKeyViewSet": "users",
        "FeatureAccessViewSet": "users",
        "OIDCClaimMappingViewSet": "users",
        # Role management
        "RoleViewSet": "roles",
    }

    # Permission required for each action type
    ACTION_PERMISSIONS = {
        "list": "view",
        "retrieve": "view",
        "create": "create",
        "update": "edit",
        "partial_update": "edit",
        "destroy": "delete",
    }

    def has_permission(self, request, view):
        """Check if user has access to this feature."""
        from skyspy.models.auth import FeatureAccess

        # Validate API key scopes if present (empty scopes = all user permissions)
        api_key_scopes = getattr(request, "api_key_scopes", None)
        if api_key_scopes and not self._scope_allows(request, view, api_key_scopes):
            return False

        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")

        # Public mode bypasses all permission checks - allows anonymous access
        if auth_mode == "public":
            return True

        # Get feature name for this view
        feature = self._get_feature(view)

        # Check if there's explicit FeatureAccess configuration
        # This allows feature-based config to override AUTH_MODE in hybrid/private modes
        config = None
        if feature:
            try:
                config = FeatureAccess.objects.get(feature=feature)
            except FeatureAccess.DoesNotExist:
                config = None

        # If explicit FeatureAccess config exists, use it
        if config is not None:
            # Check if feature is disabled
            if not config.is_enabled:
                return False

            # Determine if this is a read or write operation
            is_write = request.method not in permissions.SAFE_METHODS
            access_level = config.write_access if is_write else config.read_access

            return self._check_access_level(request, access_level, feature, is_write)

        # No explicit config - fall back to AUTH_MODE
        if auth_mode == "private":
            # Private mode requires auth for all access
            return request.user and request.user.is_authenticated

        # Hybrid mode with no config - allow public read access, require auth for writes
        if not feature:
            # Unknown view, default to authenticated access
            return request.user and request.user.is_authenticated

        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        """Check object-level permissions (e.g., ownership)."""
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")

        # Public mode bypasses all permission checks
        if auth_mode == "public":
            return True

        # For write operations, check ownership
        if request.method not in permissions.SAFE_METHODS:
            return self._check_ownership(request, view, obj)

        return True

    def _get_feature(self, view):
        """Get feature name from view."""
        view_name = view.__class__.__name__
        return self.FEATURE_MAP.get(view_name)

    def _scope_allows(self, request, view, scopes):
        """Check whether an API key's scopes permit this request.

        Scopes store full permission strings (e.g. 'alerts.view'), not bare
        feature names. Views not present in FEATURE_MAP are denied for scoped
        keys (default-deny) rather than skipping the check.
        """
        feature = self._get_feature(view)
        if not feature:
            logger.warning(
                f"API key scope check: view {view.__class__.__name__} not in FEATURE_MAP - denying scoped key"
            )
            return False

        feature_scopes = {s for s in scopes if s.partition(".")[0] == feature}
        if not feature_scopes:
            return False

        # Any scope on the feature implies read access
        if request.method in permissions.SAFE_METHODS:
            return True

        # Writes require a scope covering the specific action
        required = {
            self._get_required_permission(request, feature, is_write=True),
            f"{feature}.manage",
            f"{feature}.manage_all",
        }
        action = getattr(view, "action", None)
        if action:
            required.add(f"{feature}.{action}")
        return bool(required & feature_scopes)

    def _check_access_level(self, request, access_level, feature, is_write):
        """Check if request meets the access level requirement."""
        if access_level == "public":
            return True

        if access_level == "authenticated":
            return request.user and request.user.is_authenticated

        if access_level == "permission":
            # Check specific permission
            permission = self._get_required_permission(request, feature, is_write)
            return self._has_permission(request.user, permission)

        return False

    def _get_required_permission(self, request, feature, is_write):
        """Get the required permission string for this request."""
        if is_write:
            # Map HTTP method to permission
            method_map = {
                "POST": "create",
                "PUT": "edit",
                "PATCH": "edit",
                "DELETE": "delete",
            }
            action = method_map.get(request.method, "edit")
        else:
            action = "view"

        return f"{feature}.{action}"

    def _has_permission(self, user, permission):
        """Check if user has a specific permission."""
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        try:
            profile = user.skyspy_profile
            return profile.has_permission(permission)
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking permission '{permission}': {e}")
            return False

    def _check_ownership(self, request, view, obj):
        """Check if user owns the object or has manage_all permission."""
        user = request.user

        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        # Check for manage_all permission
        feature = self._get_feature(view)
        if feature and self._has_permission(user, f"{feature}.manage_all"):
            return True

        # For unknown viewsets (not in FEATURE_MAP), check alerts.manage_all as fallback
        # This covers notification channels and other related viewsets
        if not feature and self._has_permission(user, "alerts.manage_all"):
            return True

        # Check ownership (if object has owner field)
        if hasattr(obj, "owner") and obj.owner:
            return obj.owner == user

        # Check shared status (if object has is_shared field)
        # Can view shared objects but not edit
        if hasattr(obj, "is_shared") and request.method in permissions.SAFE_METHODS:
            return True

        # No owner = system object, check for action-specific permission
        # For unknown features, deny access (require ownership or admin)
        if not feature:
            return False

        # Get the view action and check for corresponding permission
        action = getattr(view, "action", None)
        if action:
            # Map related actions to base permissions
            action_mapping = {
                "unacknowledge": "acknowledge",  # unacknowledge requires acknowledge permission
            }
            permission_action = action_mapping.get(action, action)

            # Check for action-specific permission (e.g., safety.acknowledge)
            if self._has_permission(user, f"{feature}.{permission_action}"):
                return True

        # Fallback to manage permission
        return self._has_permission(user, f"{feature}.manage")


class HasPermission(permissions.BasePermission):
    """
    Permission class that checks for specific permission(s).

    Usage:
        permission_classes = [HasPermission]
        required_permissions = ['alerts.create']

    Or:
        @permission_classes([HasPermission.with_perms('alerts.create')])
    """

    required_permissions = []

    # Permissions that should always be enforced regardless of AUTH_MODE
    # (admin/user management permissions)
    ALWAYS_ENFORCE_PERMISSIONS = {
        "users.view",
        "users.create",
        "users.edit",
        "users.delete",
        "roles.view",
        "roles.create",
        "roles.edit",
        "roles.delete",
    }

    def has_permission(self, request, view):
        """Check if user has required permissions."""
        # Get required permissions from view or class
        required = getattr(view, "required_permissions", None) or self.required_permissions

        # Validate API key scopes if present (empty scopes = all user permissions)
        api_key_scopes = getattr(request, "api_key_scopes", None)
        # Scopes store full permission strings (e.g. 'alerts.create')
        if api_key_scopes and required and not all(_scope_covers_permission(api_key_scopes, p) for p in required):
            return False

        # Check if any required permissions are admin-related (always enforce)
        always_enforce = any(perm in self.ALWAYS_ENFORCE_PERMISSIONS for perm in required) if required else False

        # Check auth mode - only bypass for non-admin permissions
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
        if auth_mode == "public" and not always_enforce:
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        if not required:
            return True

        try:
            profile = user.skyspy_profile
            return profile.has_all_permissions(required)
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking permissions: {e}")
            return False

    @classmethod
    def with_perms(cls, *permissions):
        """Create a permission class with specific required permissions."""
        return type("HasPermission", (cls,), {"required_permissions": list(permissions)})


class HasAnyPermission(permissions.BasePermission):
    """
    Permission class that checks if user has ANY of the specified permissions.

    Usage:
        permission_classes = [HasAnyPermission]
        required_permissions = ['alerts.create', 'alerts.edit']
    """

    required_permissions = []

    # Permissions that should always be enforced regardless of AUTH_MODE
    # (admin/user management permissions)
    ALWAYS_ENFORCE_PERMISSIONS = HasPermission.ALWAYS_ENFORCE_PERMISSIONS

    def has_permission(self, request, view):
        """Check if user has any of the required permissions."""
        # Get required permissions from view or class
        required = getattr(view, "required_permissions", None) or self.required_permissions

        # Validate API key scopes if present (empty scopes = all user permissions)
        # For HasAnyPermission, at least one required permission must be covered
        api_key_scopes = getattr(request, "api_key_scopes", None)
        # Scopes store full permission strings (e.g. 'alerts.create')
        if api_key_scopes and required and not any(_scope_covers_permission(api_key_scopes, p) for p in required):
            return False

        # Check if any required permissions are admin-related (always enforce)
        always_enforce = any(perm in self.ALWAYS_ENFORCE_PERMISSIONS for perm in required) if required else False

        # Check auth mode - only bypass for non-admin permissions
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
        if auth_mode == "public" and not always_enforce:
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        if not required:
            return True

        try:
            profile = user.skyspy_profile
            return profile.has_any_permission(required)
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking permissions: {e}")
            return False


class IsAdminUser(permissions.BasePermission):
    """
    Permission class that requires admin or superadmin role.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        try:
            profile = user.skyspy_profile
            # Check for admin-level permissions
            admin_perms = ["system.manage", "users.view", "roles.view"]
            return profile.has_any_permission(admin_perms)
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking admin permissions: {e}")
            return False


class IsSuperAdmin(permissions.BasePermission):
    """
    Permission class that requires superadmin role or Django superuser.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        try:
            profile = user.skyspy_profile
            # Check for full user/role management permissions
            return profile.has_all_permissions(["users.create", "users.delete", "roles.create", "roles.delete"])
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking superadmin permissions: {e}")
            return False


class IsOwnerOrAdmin(permissions.BasePermission):
    """
    Object-level permission that allows owners and admins.

    For objects with an 'owner' field, only the owner or admin can modify.
    """

    def has_object_permission(self, request, view, obj):
        # Check auth mode - public mode allows all access
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
        if auth_mode == "public":
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        # Check ownership
        if hasattr(obj, "owner") and obj.owner == user:
            return True

        # Check for admin permission
        try:
            profile = user.skyspy_profile
            # Get feature from view
            feature = FeatureBasedPermission.FEATURE_MAP.get(view.__class__.__name__)
            if feature:
                return profile.has_permission(f"{feature}.manage_all")
        except AttributeError:
            pass
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking owner/admin permission: {e}")

        return False


class HasSystemManagePermission(permissions.BasePermission):
    """
    Permission class for system configuration management.

    Requires system.manage permission or admin/superadmin role.
    Always enforced regardless of AUTH_MODE.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        try:
            profile = user.skyspy_profile
            return profile.has_permission("system.manage")
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking system.manage permission: {e}")
            return False


class CanAccessAlert(permissions.BasePermission):
    """
    Special permission for alert rules.

    Users can:
    - View their own rules always
    - View shared rules if they have alerts.view
    - Edit their own rules
    - Edit any rule if they have alerts.manage_all
    """

    def has_permission(self, request, view):
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
        if auth_mode == "public":
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        # Read access - need alerts.view
        if request.method in permissions.SAFE_METHODS:
            return self._has_perm(user, "alerts.view")

        # Write access - need create/edit/delete
        method_perm_map = {
            "POST": "alerts.create",
            "PUT": "alerts.edit",
            "PATCH": "alerts.edit",
            "DELETE": "alerts.delete",
        }
        required_perm = method_perm_map.get(request.method)
        return self._has_perm(user, required_perm) if required_perm else False

    def has_object_permission(self, request, view, obj):
        # Check auth mode - public mode allows all access
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
        if auth_mode == "public":
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        # Can always view own rules
        if obj.owner == user:
            return True

        # Can view shared rules
        if request.method in permissions.SAFE_METHODS and obj.is_shared and self._has_perm(user, "alerts.view"):
            return True

        # Can edit any rule with manage_all
        return bool(self._has_perm(user, "alerts.manage_all"))

    def _has_perm(self, user, permission):
        if user.is_superuser:
            return True
        try:
            return user.skyspy_profile.has_permission(permission)
        except AttributeError:
            return False
        except DatabaseError as e:
            logger.warning(f"Unexpected error checking alert permission '{permission}': {e}")
            return False
