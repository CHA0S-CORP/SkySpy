"""
API ViewSets for authentication and user management.

Provides CRUD endpoints for:
- Users
- Roles
- User-Role assignments
- API Keys
- Feature Access configuration
- OIDC Claim Mappings
"""
import logging
from django.contrib.auth.models import User
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from skyspy.auth.permissions import HasPermission, IsSuperAdmin, IsAdminUser
from skyspy.auth.serializers import (
    SkyspyUserSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    RoleSerializer,
    UserRoleSerializer,
    APIKeySerializer,
    APIKeyCreateSerializer,
    FeatureAccessSerializer,
    OIDCClaimMappingSerializer,
)
from skyspy.models.auth import (
    SkyspyUser, Role, UserRole, APIKey, FeatureAccess, OIDCClaimMapping,
    DEFAULT_ROLES, FEATURE_PERMISSIONS,
)

logger = logging.getLogger(__name__)


class UserViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing users.

    Requires `users.*` permissions.
    Uses Django User ID for lookups but returns SkyspyUser profile data.
    """
    queryset = SkyspyUser.objects.select_related('user').prefetch_related(
        'user__user_roles__role'
    ).all()
    serializer_class = SkyspyUserSerializer
    permission_classes = [IsAuthenticated, HasPermission.with_perms('users.view')]

    def get_permissions(self):
        if self.action in ['create']:
            return [IsAuthenticated(), HasPermission.with_perms('users.create')()]
        elif self.action in ['update', 'partial_update']:
            return [IsAuthenticated(), HasPermission.with_perms('users.edit')()]
        elif self.action in ['destroy']:
            return [IsAuthenticated(), HasPermission.with_perms('users.delete')()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return SkyspyUserSerializer

    def get_object(self):
        """
        Override to look up by Django User ID instead of SkyspyUser ID.
        This aligns with how tests expect to use user.id.
        """
        pk = self.kwargs.get('pk')
        try:
            # Look up by Django User ID
            user = User.objects.get(id=pk)
            return user.skyspy_profile
        except (User.DoesNotExist, SkyspyUser.DoesNotExist):
            from django.http import Http404
            raise Http404("User not found")

    def list(self, request, *args, **kwargs):
        """List all users with count."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'users': serializer.data,
            'count': len(serializer.data)
        })

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Return the created user's profile
        profile = user.skyspy_profile
        output_serializer = SkyspyUserSerializer(profile)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        """Handle PUT/PATCH updates to user."""
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        # Return full user data using SkyspyUserSerializer
        output_serializer = SkyspyUserSerializer(instance)
        return Response(output_serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        # Prevent deleting yourself
        if instance.user == request.user:
            return Response(
                {'error': 'Cannot delete your own account'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Prevent deleting superusers unless you're also a superuser
        if instance.user.is_superuser and not request.user.is_superuser:
            return Response(
                {'error': 'Cannot delete superuser accounts'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Delete the Django user (cascades to profile)
        instance.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def assign_role(self, request, pk=None):
        """Assign a role to a user."""
        profile = self.get_object()
        role_id = request.data.get('role_id')
        role_name = request.data.get('role')
        expires_at = request.data.get('expires_at')

        if not role_id and not role_name:
            return Response(
                {'error': 'Role ID or role name is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            if role_id:
                role = Role.objects.get(id=role_id)
            else:
                role = Role.objects.get(name=role_name)
        except Role.DoesNotExist:
            return Response(
                {'error': 'Role not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if admin user is trying to assign superadmin role
        if role.name == 'superadmin' and not request.user.is_superuser:
            try:
                if not request.user.skyspy_profile.has_permission('users.create'):
                    return Response(
                        {'error': 'Cannot assign superadmin role'},
                        status=status.HTTP_403_FORBIDDEN
                    )
                # Even with users.create, non-superusers can't assign superadmin
                superadmin_role = Role.objects.filter(name='superadmin').first()
                if superadmin_role and role.id == superadmin_role.id:
                    return Response(
                        {'error': 'Cannot assign superadmin role'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            except SkyspyUser.DoesNotExist:
                return Response(
                    {'error': 'Cannot assign superadmin role'},
                    status=status.HTTP_403_FORBIDDEN
                )

        user_role, created = UserRole.objects.get_or_create(
            user=profile.user,
            role=role,
            defaults={
                'assigned_by': request.user,
                'expires_at': expires_at
            }
        )

        if not created:
            user_role.expires_at = expires_at
            user_role.assigned_by = request.user
            user_role.save()

        # Return assignment data including expires_at
        return Response({
            'message': f'Role "{role.name}" assigned successfully',
            'expires_at': expires_at,
            'assigned_by': request.user.username,
        })

    @action(detail=True, methods=['post'])
    def remove_role(self, request, pk=None):
        """Remove a role from a user."""
        profile = self.get_object()
        role_id = request.data.get('role_id')
        role_name = request.data.get('role')

        if not role_id and not role_name:
            return Response(
                {'error': 'Role ID or role name is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if the role exists first
        try:
            if role_id:
                role = Role.objects.get(id=role_id)
            else:
                role = Role.objects.get(name=role_name)
        except Role.DoesNotExist:
            return Response(
                {'error': 'Role not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        filter_kwargs = {'user': profile.user, 'role': role}
        deleted, _ = UserRole.objects.filter(**filter_kwargs).delete()

        if deleted:
            return Response({'message': 'Role removed successfully'})
        else:
            return Response(
                {'error': 'User does not have this role'},
                status=status.HTTP_404_NOT_FOUND
            )


class RoleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing roles.

    Requires `roles.*` permissions.
    """
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated, HasPermission.with_perms('roles.view')]

    def get_permissions(self):
        if self.action in ['create']:
            return [IsAuthenticated(), HasPermission.with_perms('roles.create')()]
        elif self.action in ['update', 'partial_update']:
            return [IsAuthenticated(), HasPermission.with_perms('roles.edit')()]
        elif self.action in ['destroy']:
            return [IsAuthenticated(), HasPermission.with_perms('roles.delete')()]
        return super().get_permissions()

    def list(self, request, *args, **kwargs):
        """List all roles with count."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'roles': serializer.data,
            'count': len(serializer.data)
        })

    def update(self, request, *args, **kwargs):
        """Update a role, protecting system role permissions."""
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # For system roles, strip out any permission changes
        if instance.is_system and 'permissions' in request.data:
            data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
            # Remove permissions from update data for system roles
            data.pop('permissions', None)
            # Allow display_name and description changes
            serializer = self.get_serializer(instance, data=data, partial=partial)
        else:
            serializer = self.get_serializer(instance, data=request.data, partial=partial)

        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        # Prevent deleting system roles
        if instance.is_system:
            return Response(
                {'error': 'Cannot delete system roles'},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'])
    def initialize_defaults(self, request):
        """
        Initialize default roles.

        Creates the default viewer, operator, analyst, admin, and superadmin roles
        if they don't exist.
        """
        if not request.user.is_superuser:
            return Response(
                {'error': 'Only superusers can initialize default roles'},
                status=status.HTTP_403_FORBIDDEN
            )

        created_roles = []
        for role_name, role_data in DEFAULT_ROLES.items():
            role, created = Role.objects.get_or_create(
                name=role_name,
                defaults={
                    'display_name': role_data['display_name'],
                    'description': role_data['description'],
                    'permissions': role_data['permissions'],
                    'priority': role_data['priority'],
                    'is_system': True,
                }
            )
            if created:
                created_roles.append(role_name)

        if created_roles:
            return Response({
                'message': f'Created {len(created_roles)} default roles',
                'roles': created_roles
            })
        else:
            return Response({'message': 'All default roles already exist'})


class UserRoleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing user-role assignments.
    """
    queryset = UserRole.objects.select_related('user', 'role', 'assigned_by').all()
    serializer_class = UserRoleSerializer
    permission_classes = [IsAuthenticated, HasPermission.with_perms('users.edit')]

    def get_queryset(self):
        """Filter queryset based on query parameters."""
        queryset = super().get_queryset()

        # Filter by user_id
        user_id = self.request.query_params.get('user_id')
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        # Filter by role_id
        role_id = self.request.query_params.get('role_id')
        if role_id:
            queryset = queryset.filter(role_id=role_id)

        return queryset

    def list(self, request, *args, **kwargs):
        """List all user role assignments."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'assignments': serializer.data,
            'count': len(serializer.data)
        })

    def perform_create(self, serializer):
        serializer.save(assigned_by=self.request.user)


class APIKeyViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing API keys.

    In admin context (/api/v1/admin/api-keys/), requires users.view permission.
    """
    serializer_class = APIKeySerializer
    permission_classes = [IsAuthenticated, HasPermission.with_perms('users.view')]

    def get_queryset(self):
        """Get queryset with optional filtering."""
        queryset = APIKey.objects.select_related('user').all()

        # Filter by user_id
        user_id = self.request.query_params.get('user_id')
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        return queryset

    def get_serializer_class(self):
        if self.action == 'create':
            return APIKeyCreateSerializer
        return APIKeySerializer

    def list(self, request, *args, **kwargs):
        """List all API keys."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'api_keys': serializer.data,
            'count': len(serializer.data)
        })

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        api_key = serializer.save()

        # Return key with the raw key (only shown once)
        output_serializer = APIKeySerializer(api_key)
        data = output_serializer.data
        data['key'] = api_key.key  # Include raw key

        return Response(data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        """Delete/revoke an API key - marks as inactive instead of deleting."""
        instance = self.get_object()
        instance.is_active = False
        instance.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def regenerate(self, request, pk=None):
        """Regenerate an API key."""
        api_key = self.get_object()

        # Check ownership
        if api_key.user != request.user and not request.user.is_superuser:
            if not self._has_admin_permission(request.user):
                return Response(
                    {'error': 'Cannot regenerate another user\'s API key'},
                    status=status.HTTP_403_FORBIDDEN
                )

        # Generate new key
        key, key_hash, key_prefix = APIKey.generate_key()
        api_key.key_hash = key_hash
        api_key.key_prefix = key_prefix
        api_key.save()

        return Response({
            'message': 'API key regenerated',
            'key': key,
            'key_prefix': key_prefix,
        })

    def _has_admin_permission(self, user):
        try:
            return user.skyspy_profile.has_permission('users.view')
        except Exception:
            return False


class FeatureAccessViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing feature access configuration.

    Requires admin permissions.
    """
    queryset = FeatureAccess.objects.all()
    serializer_class = FeatureAccessSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    lookup_field = 'feature'

    def list(self, request, *args, **kwargs):
        """List all feature access configurations."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'features': serializer.data,
            'count': len(serializer.data)
        })

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def initialize_defaults(self, request):
        """
        Initialize default feature access configuration.

        Creates FeatureAccess entries for all features with default settings.
        """
        created_features = []
        for feature in FEATURE_PERMISSIONS.keys():
            _, created = FeatureAccess.objects.get_or_create(
                feature=feature,
                defaults={
                    'read_access': 'authenticated',
                    'write_access': 'permission',
                    'is_enabled': True,
                }
            )
            if created:
                created_features.append(feature)

        if created_features:
            return Response({
                'message': f'Created {len(created_features)} feature access entries',
                'features': created_features
            })
        else:
            return Response({'message': 'All feature access entries already exist'})


class OIDCClaimMappingViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing OIDC claim mappings.

    Maps OIDC claims to roles for automatic role assignment.
    """
    queryset = OIDCClaimMapping.objects.select_related('role').all()
    serializer_class = OIDCClaimMappingSerializer
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def list(self, request, *args, **kwargs):
        """List all OIDC claim mappings."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'mappings': serializer.data,
            'count': len(serializer.data)
        })
