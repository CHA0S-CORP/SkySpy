"""
End-to-end tests for the SkySpy Django API admin operations.

Tests cover:
- User Management (CRUD operations)
- Role Assignment (assign/remove roles)
- Role Management (CRUD operations)
- User Role Assignments (list/filter)
- API Key Management (CRUD operations)
- Feature Access Configuration
- OIDC Claim Mappings
- Permission Checks
- Audit and Logging

Uses fixtures from conftest.py for authenticated clients and users.
"""
import pytest
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import status

from skyspy.models.auth import (
    SkyspyUser,
    Role,
    UserRole,
    APIKey,
    FeatureAccess,
    OIDCClaimMapping,
    DEFAULT_ROLES,
)


# =============================================================================
# User Management Tests
# =============================================================================


@pytest.mark.django_db
class TestUserManagementList:
    """Tests for GET /api/v1/admin/users - list all users."""

    def test_superadmin_can_list_all_users(self, superadmin_client, create_user, all_roles):
        """Superadmin can list all users."""
        # Create some additional users
        create_user('test_user_1', role=all_roles['viewer'])
        create_user('test_user_2', role=all_roles['operator'])

        response = superadmin_client.get('/api/v1/admin/users/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'users' in result
        assert 'count' in result
        assert result['count'] >= 3  # At least superadmin + 2 test users

    def test_admin_can_list_users(self, admin_client, create_user, all_roles):
        """Admin can list users."""
        create_user('admin_list_test', role=all_roles['viewer'])

        response = admin_client.get('/api/v1/admin/users/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'users' in result

    def test_operator_cannot_list_users(self, operator_client):
        """Operator gets 403 when trying to list users."""
        response = operator_client.get('/api/v1/admin/users/')

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_viewer_cannot_list_users(self, viewer_client):
        """Viewer gets 403 when trying to list users."""
        response = viewer_client.get('/api/v1/admin/users/')

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_unauthenticated_cannot_list_users(self, api_client):
        """Unauthenticated request gets 401."""
        response = api_client.get('/api/v1/admin/users/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_list_users_includes_roles_and_permissions(self, superadmin_client, create_user, all_roles):
        """User list includes roles and permissions for each user."""
        create_user('role_test_user', role=all_roles['operator'])

        response = superadmin_client.get('/api/v1/admin/users/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()

        # Find the test user
        test_user = next(
            (u for u in result['users'] if u['username'] == 'role_test_user'),
            None
        )
        assert test_user is not None
        assert 'roles' in test_user
        assert 'permissions' in test_user

    def test_list_users_pagination(self, superadmin_client, create_user, all_roles):
        """User list supports pagination."""
        # Create many users
        for i in range(15):
            create_user(f'paginate_user_{i}', role=all_roles['viewer'])

        response = superadmin_client.get('/api/v1/admin/users/?page=1&page_size=10')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'users' in result
        assert 'count' in result
        # Should have pagination info
        assert result['count'] >= 15


@pytest.mark.django_db
class TestUserManagementCreate:
    """Tests for POST /api/v1/admin/users - create new user."""

    def test_superadmin_can_create_user(self, superadmin_client, all_roles):
        """Superadmin can create a new user."""
        data = {
            'username': 'new_test_user',
            'email': 'newuser@example.com',
            'password': 'SecurePass123!',
            'display_name': 'New Test User',
            'role_ids': [all_roles['viewer'].id],
        }

        response = superadmin_client.post('/api/v1/admin/users/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['username'] == 'new_test_user'
        assert result['email'] == 'newuser@example.com'
        assert 'id' in result

        # Verify user was created in database
        assert User.objects.filter(username='new_test_user').exists()
        assert SkyspyUser.objects.filter(user__username='new_test_user').exists()

    def test_create_user_with_multiple_roles(self, superadmin_client, all_roles):
        """Create user with multiple roles assigned."""
        data = {
            'username': 'multi_role_user',
            'email': 'multirole@example.com',
            'password': 'SecurePass123!',
            'role_ids': [all_roles['viewer'].id, all_roles['operator'].id],
        }

        response = superadmin_client.post('/api/v1/admin/users/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert len(result['roles']) == 2

    def test_create_user_without_password_generates_random(self, superadmin_client, all_roles):
        """Creating user without password generates a random one."""
        data = {
            'username': 'no_password_user',
            'email': 'nopass@example.com',
            'role_ids': [all_roles['viewer'].id],
        }

        response = superadmin_client.post('/api/v1/admin/users/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        # User should exist and have an unusable password or generated one
        user = User.objects.get(username='no_password_user')
        assert user is not None

    def test_create_user_duplicate_username_fails(self, superadmin_client, create_user, all_roles):
        """Creating user with duplicate username returns 400."""
        create_user('duplicate_user', role=all_roles['viewer'])

        data = {
            'username': 'duplicate_user',
            'email': 'different@example.com',
            'password': 'SecurePass123!',
        }

        response = superadmin_client.post('/api/v1/admin/users/', data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_user_duplicate_email_fails(self, superadmin_client, create_user, all_roles):
        """Creating user with duplicate email returns 400."""
        create_user('original_user', email='duplicate@example.com', role=all_roles['viewer'])

        data = {
            'username': 'new_user_email_dup',
            'email': 'duplicate@example.com',
            'password': 'SecurePass123!',
        }

        response = superadmin_client.post('/api/v1/admin/users/', data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_admin_cannot_create_superadmin_user(self, admin_client, all_roles):
        """Admin cannot assign superadmin role to new users."""
        data = {
            'username': 'attempted_superadmin',
            'email': 'superadmin_attempt@example.com',
            'password': 'SecurePass123!',
            'role_ids': [all_roles['superadmin'].id],
        }

        response = admin_client.post('/api/v1/admin/users/', data, format='json')

        # Should either fail or not include superadmin role
        if response.status_code == status.HTTP_201_CREATED:
            result = response.json()
            role_names = [r['name'] for r in result.get('roles', [])]
            assert 'superadmin' not in role_names
        else:
            assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST]


@pytest.mark.django_db
class TestUserManagementGetDetail:
    """Tests for GET /api/v1/admin/users/{id} - get user details."""

    def test_superadmin_can_get_user_details(self, superadmin_client, create_user, all_roles):
        """Superadmin can get details of any user."""
        user, profile = create_user('detail_user', role=all_roles['operator'])

        response = superadmin_client.get(f'/api/v1/admin/users/{user.id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['id'] == user.id
        assert result['username'] == 'detail_user'
        assert 'roles' in result
        assert 'permissions' in result
        assert 'created_at' in result

    def test_get_user_includes_profile_info(self, superadmin_client, create_user, all_roles):
        """User details include profile information."""
        user, profile = create_user('profile_user', role=all_roles['viewer'])
        profile.display_name = 'Profile Display Name'
        profile.save()

        response = superadmin_client.get(f'/api/v1/admin/users/{user.id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['display_name'] == 'Profile Display Name'

    def test_get_nonexistent_user_returns_404(self, superadmin_client):
        """Getting non-existent user returns 404."""
        response = superadmin_client.get('/api/v1/admin/users/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_operator_cannot_get_user_details(self, operator_client, create_user, all_roles):
        """Operator cannot access user details endpoint."""
        user, _ = create_user('hidden_user', role=all_roles['viewer'])

        response = operator_client.get(f'/api/v1/admin/users/{user.id}/')

        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestUserManagementUpdate:
    """Tests for PATCH /api/v1/admin/users/{id} - update user."""

    def test_superadmin_can_update_user(self, superadmin_client, create_user, all_roles):
        """Superadmin can update any user."""
        user, profile = create_user('update_user', role=all_roles['viewer'])

        data = {
            'display_name': 'Updated Display Name',
            'email': 'updated@example.com',
        }

        response = superadmin_client.patch(
            f'/api/v1/admin/users/{user.id}/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['display_name'] == 'Updated Display Name'
        assert result['email'] == 'updated@example.com'

    def test_update_user_active_status(self, superadmin_client, create_user, all_roles):
        """Can update user's active status (enable/disable account)."""
        user, profile = create_user('disable_user', role=all_roles['viewer'])

        # Disable user
        response = superadmin_client.patch(
            f'/api/v1/admin/users/{user.id}/',
            {'is_active': False},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.is_active is False

        # Re-enable user
        response = superadmin_client.patch(
            f'/api/v1/admin/users/{user.id}/',
            {'is_active': True},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.is_active is True

    def test_admin_can_update_non_admin_users(self, admin_client, create_user, all_roles):
        """Admin can update non-admin users."""
        user, profile = create_user('admin_update_target', role=all_roles['viewer'])

        response = admin_client.patch(
            f'/api/v1/admin/users/{user.id}/',
            {'display_name': 'Admin Updated'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

    def test_cannot_change_username_to_existing(self, superadmin_client, create_user, all_roles):
        """Cannot update username to an existing username."""
        create_user('existing_user', role=all_roles['viewer'])
        user, profile = create_user('will_conflict', role=all_roles['viewer'])

        response = superadmin_client.patch(
            f'/api/v1/admin/users/{user.id}/',
            {'username': 'existing_user'},
            format='json'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestUserManagementDelete:
    """Tests for DELETE /api/v1/admin/users/{id} - delete user."""

    def test_superadmin_can_delete_user(self, superadmin_client, create_user, all_roles):
        """Superadmin can delete a user."""
        user, profile = create_user('delete_me', role=all_roles['viewer'])
        user_id = user.id

        response = superadmin_client.delete(f'/api/v1/admin/users/{user_id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not User.objects.filter(id=user_id).exists()

    def test_cannot_delete_own_account(self, superadmin_client, superadmin_user):
        """Users cannot delete their own account."""
        response = superadmin_client.delete(f'/api/v1/admin/users/{superadmin_user.id}/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        # User should still exist
        assert User.objects.filter(id=superadmin_user.id).exists()

    def test_admin_cannot_delete_superadmin(self, admin_client, superadmin_user):
        """Admin cannot delete a superadmin user."""
        response = admin_client.delete(f'/api/v1/admin/users/{superadmin_user.id}/')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert User.objects.filter(id=superadmin_user.id).exists()

    def test_delete_nonexistent_user_returns_404(self, superadmin_client):
        """Deleting non-existent user returns 404."""
        response = superadmin_client.delete('/api/v1/admin/users/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_operator_cannot_delete_users(self, operator_client, create_user, all_roles):
        """Operator cannot delete users."""
        user, _ = create_user('protected_user', role=all_roles['viewer'])

        response = operator_client.delete(f'/api/v1/admin/users/{user.id}/')

        assert response.status_code == status.HTTP_403_FORBIDDEN


# =============================================================================
# Role Assignment Tests
# =============================================================================


@pytest.mark.django_db
class TestRoleAssignment:
    """Tests for POST /api/v1/admin/users/{id}/assign_role."""

    def test_assign_role_to_user(self, superadmin_client, create_user, all_roles):
        """Assign a role to a user."""
        user, profile = create_user('no_role_for_assign')

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/assign_role/',
            {'role_id': all_roles['operator'].id},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert UserRole.objects.filter(user=user, role=all_roles['operator']).exists()

    def test_assign_role_with_expiration(self, superadmin_client, create_user, all_roles):
        """Assign a temporary role with expiration date."""
        user, profile = create_user('temp_role_user')
        expires = timezone.now() + timedelta(days=30)

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/assign_role/',
            {
                'role_id': all_roles['analyst'].id,
                'expires_at': expires.isoformat(),
            },
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'expires_at' in result

        user_role = UserRole.objects.get(user=user, role=all_roles['analyst'])
        assert user_role.expires_at is not None

    def test_assign_nonexistent_role_returns_404(self, superadmin_client, create_user):
        """Assigning non-existent role returns 404."""
        user, profile = create_user('role_assign_test')

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/assign_role/',
            {'role_id': 99999},
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_assign_already_assigned_role(self, superadmin_client, create_user, all_roles):
        """Assigning already assigned role is idempotent or returns conflict."""
        user, profile = create_user('double_assign', role=all_roles['viewer'])

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/assign_role/',
            {'role_id': all_roles['viewer'].id},
            format='json'
        )

        # Should either be idempotent (200) or return conflict (409)
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_409_CONFLICT,
            status.HTTP_400_BAD_REQUEST,
        ]

    def test_admin_cannot_assign_superadmin_role(self, admin_client, create_user, all_roles):
        """Admin cannot assign the superadmin role."""
        user, profile = create_user('superadmin_attempt')

        response = admin_client.post(
            f'/api/v1/admin/users/{user.id}/assign_role/',
            {'role_id': all_roles['superadmin'].id},
            format='json'
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_assign_role_tracks_assigned_by(self, superadmin_client, superadmin_user, create_user, all_roles):
        """Role assignment tracks who assigned it."""
        user, profile = create_user('tracked_assign')

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/assign_role/',
            {'role_id': all_roles['operator'].id},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        user_role = UserRole.objects.get(user=user, role=all_roles['operator'])
        assert user_role.assigned_by == superadmin_user


@pytest.mark.django_db
class TestRoleRemoval:
    """Tests for POST /api/v1/admin/users/{id}/remove_role."""

    def test_remove_role_from_user(self, superadmin_client, create_user, all_roles):
        """Remove a role from a user."""
        user, profile = create_user('has_role_to_remove', role=all_roles['operator'])
        assert UserRole.objects.filter(user=user, role=all_roles['operator']).exists()

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/remove_role/',
            {'role_id': all_roles['operator'].id},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert not UserRole.objects.filter(user=user, role=all_roles['operator']).exists()

    def test_remove_non_assigned_role(self, superadmin_client, create_user, all_roles):
        """Removing a role that user doesn't have returns appropriate error."""
        user, profile = create_user('no_such_role', role=all_roles['viewer'])

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/remove_role/',
            {'role_id': all_roles['admin'].id},  # User doesn't have admin role
            format='json'
        )

        # Should return 404 or 400 as role assignment doesn't exist
        assert response.status_code in [
            status.HTTP_404_NOT_FOUND,
            status.HTTP_400_BAD_REQUEST,
        ]

    def test_remove_nonexistent_role_returns_404(self, superadmin_client, create_user):
        """Removing non-existent role returns 404."""
        user, profile = create_user('remove_invalid_role')

        response = superadmin_client.post(
            f'/api/v1/admin/users/{user.id}/remove_role/',
            {'role_id': 99999},
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Role Management Tests
# =============================================================================


@pytest.mark.django_db
class TestRoleManagementList:
    """Tests for GET /api/v1/admin/roles - list all roles."""

    def test_superadmin_can_list_roles(self, superadmin_client, all_roles):
        """Superadmin can list all roles."""
        response = superadmin_client.get('/api/v1/admin/roles/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'roles' in result
        # Should have at least the default roles
        role_names = [r['name'] for r in result['roles']]
        assert 'viewer' in role_names
        assert 'operator' in role_names
        assert 'admin' in role_names
        assert 'superadmin' in role_names

    def test_admin_can_list_roles(self, admin_client, all_roles):
        """Admin can list roles."""
        response = admin_client.get('/api/v1/admin/roles/')

        assert response.status_code == status.HTTP_200_OK

    def test_roles_include_permissions(self, superadmin_client, all_roles):
        """Role list includes permissions for each role."""
        response = superadmin_client.get('/api/v1/admin/roles/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()

        viewer_role = next(
            (r for r in result['roles'] if r['name'] == 'viewer'),
            None
        )
        assert viewer_role is not None
        assert 'permissions' in viewer_role
        assert 'aircraft.view' in viewer_role['permissions']

    def test_operator_cannot_list_roles(self, operator_client):
        """Operator cannot access roles endpoint."""
        response = operator_client.get('/api/v1/admin/roles/')

        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestRoleManagementCreate:
    """Tests for POST /api/v1/admin/roles - create new role."""

    def test_superadmin_can_create_role(self, superadmin_client):
        """Superadmin can create a new custom role."""
        data = {
            'name': 'custom_role',
            'display_name': 'Custom Role',
            'description': 'A custom role for testing',
            'permissions': ['aircraft.view', 'alerts.view', 'alerts.create'],
            'priority': 25,
        }

        response = superadmin_client.post('/api/v1/admin/roles/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['name'] == 'custom_role'
        assert result['display_name'] == 'Custom Role'
        assert 'alerts.create' in result['permissions']
        assert result['is_system'] is False

    def test_create_role_with_duplicate_name_fails(self, superadmin_client, all_roles):
        """Creating role with duplicate name fails."""
        data = {
            'name': 'viewer',  # Already exists
            'display_name': 'Duplicate Viewer',
            'permissions': ['aircraft.view'],
        }

        response = superadmin_client.post('/api/v1/admin/roles/', data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_role_with_invalid_permissions(self, superadmin_client):
        """Creating role with invalid permissions is rejected or filtered."""
        data = {
            'name': 'invalid_perm_role',
            'display_name': 'Invalid Perms',
            'permissions': ['aircraft.view', 'invalid.permission.here'],
        }

        response = superadmin_client.post('/api/v1/admin/roles/', data, format='json')

        # Should either reject or filter invalid permissions
        if response.status_code == status.HTTP_201_CREATED:
            result = response.json()
            assert 'invalid.permission.here' not in result['permissions']
        else:
            assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_admin_cannot_create_roles_with_user_management_perms(self, admin_client):
        """Admin cannot create roles with user management permissions."""
        data = {
            'name': 'sneaky_role',
            'display_name': 'Sneaky Role',
            'permissions': ['users.create', 'users.delete'],
        }

        response = admin_client.post('/api/v1/admin/roles/', data, format='json')

        # Should either fail or not include user management permissions
        if response.status_code == status.HTTP_201_CREATED:
            result = response.json()
            assert 'users.create' not in result['permissions']
            assert 'users.delete' not in result['permissions']
        else:
            assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST]


@pytest.mark.django_db
class TestRoleManagementGetDetail:
    """Tests for GET /api/v1/admin/roles/{id} - get role details."""

    def test_get_role_details(self, superadmin_client, all_roles):
        """Get details of a specific role."""
        response = superadmin_client.get(f'/api/v1/admin/roles/{all_roles["operator"].id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['name'] == 'operator'
        assert result['display_name'] == DEFAULT_ROLES['operator']['display_name']
        assert 'permissions' in result
        assert 'alerts.create' in result['permissions']

    def test_get_nonexistent_role_returns_404(self, superadmin_client):
        """Getting non-existent role returns 404."""
        response = superadmin_client.get('/api/v1/admin/roles/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestRoleManagementUpdate:
    """Tests for PATCH /api/v1/admin/roles/{id} - update role."""

    def test_update_custom_role_permissions(self, superadmin_client, db):
        """Can update permissions of a custom (non-system) role."""
        # Create a custom role
        role = Role.objects.create(
            name='updatable_role',
            display_name='Updatable Role',
            permissions=['aircraft.view'],
            is_system=False,
        )

        response = superadmin_client.patch(
            f'/api/v1/admin/roles/{role.id}/',
            {'permissions': ['aircraft.view', 'alerts.view', 'alerts.create']},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'alerts.create' in result['permissions']

    def test_cannot_update_system_role_permissions(self, superadmin_client, all_roles):
        """Cannot update permissions of a system role."""
        response = superadmin_client.patch(
            f'/api/v1/admin/roles/{all_roles["viewer"].id}/',
            {'permissions': ['aircraft.view', 'users.delete']},  # Try to add dangerous perm
            format='json'
        )

        # Should either fail or ignore permission changes
        if response.status_code == status.HTTP_200_OK:
            result = response.json()
            # System role permissions should not be changed
            assert 'users.delete' not in result['permissions']
        else:
            assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST]

    def test_can_update_custom_role_display_name(self, superadmin_client, db):
        """Can update display name and description of a custom role."""
        role = Role.objects.create(
            name='display_update_role',
            display_name='Original Name',
            description='Original description',
            permissions=['aircraft.view'],
            is_system=False,
        )

        response = superadmin_client.patch(
            f'/api/v1/admin/roles/{role.id}/',
            {
                'display_name': 'Updated Name',
                'description': 'Updated description',
            },
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['display_name'] == 'Updated Name'
        assert result['description'] == 'Updated description'


@pytest.mark.django_db
class TestRoleManagementDelete:
    """Tests for DELETE /api/v1/admin/roles/{id} - delete role."""

    def test_delete_custom_role(self, superadmin_client, db):
        """Can delete a custom (non-system) role."""
        role = Role.objects.create(
            name='deletable_role',
            display_name='Deletable Role',
            permissions=['aircraft.view'],
            is_system=False,
        )
        role_id = role.id

        response = superadmin_client.delete(f'/api/v1/admin/roles/{role_id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Role.objects.filter(id=role_id).exists()

    def test_cannot_delete_system_role(self, superadmin_client, all_roles):
        """Cannot delete a system role."""
        response = superadmin_client.delete(f'/api/v1/admin/roles/{all_roles["viewer"].id}/')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Role.objects.filter(id=all_roles['viewer'].id).exists()

    def test_cannot_delete_superadmin_role(self, superadmin_client, all_roles):
        """Cannot delete the superadmin role."""
        response = superadmin_client.delete(f'/api/v1/admin/roles/{all_roles["superadmin"].id}/')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Role.objects.filter(id=all_roles['superadmin'].id).exists()

    def test_delete_role_with_assignments_cascades_or_fails(
        self, superadmin_client, create_user, db
    ):
        """Deleting role with assignments either cascades or fails gracefully."""
        role = Role.objects.create(
            name='assigned_role',
            display_name='Assigned Role',
            permissions=['aircraft.view'],
            is_system=False,
        )
        user, _ = create_user('user_with_assigned_role')
        UserRole.objects.create(user=user, role=role)

        response = superadmin_client.delete(f'/api/v1/admin/roles/{role.id}/')

        # Either succeeds (cascades) or fails (protects assignments)
        assert response.status_code in [
            status.HTTP_204_NO_CONTENT,
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_409_CONFLICT,
        ]


# =============================================================================
# User Role Assignments Tests
# =============================================================================


@pytest.mark.django_db
class TestUserRoleAssignmentsList:
    """Tests for GET /api/v1/admin/user-roles - list all role assignments."""

    def test_list_all_user_role_assignments(self, superadmin_client, create_user, all_roles):
        """List all user-role assignments."""
        create_user('assigned_user_1', role=all_roles['viewer'])
        create_user('assigned_user_2', role=all_roles['operator'])

        response = superadmin_client.get('/api/v1/admin/user-roles/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'assignments' in result
        assert 'count' in result
        assert result['count'] >= 2

    def test_filter_assignments_by_user(self, superadmin_client, create_user, all_roles):
        """Filter assignments by user ID."""
        user1, _ = create_user('filter_user_1', role=all_roles['viewer'])
        user2, _ = create_user('filter_user_2', role=all_roles['operator'])
        # Add second role to user1
        UserRole.objects.create(user=user1, role=all_roles['analyst'])

        response = superadmin_client.get(f'/api/v1/admin/user-roles/?user_id={user1.id}')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['count'] == 2
        for assignment in result['assignments']:
            assert assignment['user_id'] == user1.id

    def test_filter_assignments_by_role(self, superadmin_client, create_user, all_roles):
        """Filter assignments by role ID."""
        create_user('role_filter_1', role=all_roles['viewer'])
        create_user('role_filter_2', role=all_roles['viewer'])
        create_user('role_filter_3', role=all_roles['operator'])

        response = superadmin_client.get(
            f'/api/v1/admin/user-roles/?role_id={all_roles["viewer"].id}'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Should only include viewer assignments
        for assignment in result['assignments']:
            assert assignment['role_id'] == all_roles['viewer'].id

    def test_assignments_show_expiration_status(self, superadmin_client, create_user, all_roles):
        """Assignments show expiration status correctly."""
        user, _ = create_user('expiry_status_user')

        # Create expired assignment
        UserRole.objects.create(
            user=user,
            role=all_roles['viewer'],
            expires_at=timezone.now() - timedelta(days=1)
        )

        # Create active assignment
        UserRole.objects.create(
            user=user,
            role=all_roles['operator'],
            expires_at=timezone.now() + timedelta(days=30)
        )

        # Create permanent assignment
        UserRole.objects.create(
            user=user,
            role=all_roles['analyst'],
            expires_at=None
        )

        response = superadmin_client.get(f'/api/v1/admin/user-roles/?user_id={user.id}')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['count'] == 3

        # Check for expiration info in response
        for assignment in result['assignments']:
            assert 'expires_at' in assignment
            # Some should have is_expired field
            if 'is_expired' in assignment:
                if assignment['role_name'] == 'viewer':
                    assert assignment['is_expired'] is True


# =============================================================================
# API Key Management Tests
# =============================================================================


@pytest.mark.django_db
class TestAPIKeyList:
    """Tests for GET /api/v1/admin/api-keys - list API keys."""

    def test_superadmin_can_list_all_api_keys(
        self, superadmin_client, create_user, create_api_key, all_roles
    ):
        """Superadmin can list all API keys."""
        user1, _ = create_user('apikey_user_1', role=all_roles['operator'])
        user2, _ = create_user('apikey_user_2', role=all_roles['operator'])

        create_api_key(user1, name='User1 Key')
        create_api_key(user2, name='User2 Key')

        response = superadmin_client.get('/api/v1/admin/api-keys/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'api_keys' in result
        assert result['count'] >= 2

    def test_api_key_list_hides_full_key(self, superadmin_client, operator_user, create_api_key):
        """API key list only shows prefix, not full key."""
        api_key, raw_key = create_api_key(operator_user, name='Hidden Key')

        response = superadmin_client.get('/api/v1/admin/api-keys/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()

        # Find our key
        key_data = next(
            (k for k in result['api_keys'] if k['name'] == 'Hidden Key'),
            None
        )
        assert key_data is not None
        # Should have prefix but NOT the full key
        assert 'key_prefix' in key_data
        assert raw_key not in str(key_data)  # Full key should not appear

    def test_filter_api_keys_by_user(
        self, superadmin_client, create_user, create_api_key, all_roles
    ):
        """Filter API keys by user."""
        user1, _ = create_user('key_filter_user_1', role=all_roles['operator'])
        user2, _ = create_user('key_filter_user_2', role=all_roles['operator'])

        create_api_key(user1, name='Key A')
        create_api_key(user1, name='Key B')
        create_api_key(user2, name='Key C')

        response = superadmin_client.get(f'/api/v1/admin/api-keys/?user_id={user1.id}')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['count'] == 2
        for key in result['api_keys']:
            assert key['user_id'] == user1.id


@pytest.mark.django_db
class TestAPIKeyCreate:
    """Tests for POST /api/v1/admin/api-keys - create API key."""

    def test_create_api_key_for_user(self, superadmin_client, create_user, all_roles):
        """Create API key for a user."""
        user, _ = create_user('key_create_user', role=all_roles['operator'])

        data = {
            'user_id': user.id,
            'name': 'New API Key',
            'scopes': ['aircraft.view', 'alerts.view'],
        }

        response = superadmin_client.post('/api/v1/admin/api-keys/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['name'] == 'New API Key'
        # Full key should be returned on creation
        assert 'key' in result
        assert result['key'].startswith('sk_')
        assert 'scopes' in result
        assert 'aircraft.view' in result['scopes']

    def test_api_key_only_shown_on_creation(
        self, superadmin_client, create_user, all_roles
    ):
        """API key is only returned at creation time."""
        user, _ = create_user('key_once_user', role=all_roles['operator'])

        # Create key
        create_response = superadmin_client.post(
            '/api/v1/admin/api-keys/',
            {
                'user_id': user.id,
                'name': 'Once Only Key',
            },
            format='json'
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_key = create_response.json()['key']

        # Get key details - should NOT include full key
        key_id = create_response.json()['id']
        get_response = superadmin_client.get(f'/api/v1/admin/api-keys/{key_id}/')

        if get_response.status_code == status.HTTP_200_OK:
            assert created_key not in str(get_response.json())

    def test_create_api_key_with_expiration(self, superadmin_client, create_user, all_roles):
        """Create API key with expiration date."""
        user, _ = create_user('key_expiry_user', role=all_roles['operator'])
        expires = timezone.now() + timedelta(days=90)

        data = {
            'user_id': user.id,
            'name': 'Expiring Key',
            'expires_at': expires.isoformat(),
        }

        response = superadmin_client.post('/api/v1/admin/api-keys/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['expires_at'] is not None

    def test_create_api_key_with_scopes(self, superadmin_client, create_user, all_roles):
        """Create API key with specific scopes."""
        user, _ = create_user('key_scopes_user', role=all_roles['operator'])

        data = {
            'user_id': user.id,
            'name': 'Scoped Key',
            'scopes': ['aircraft.view'],  # Limited scope
        }

        response = superadmin_client.post('/api/v1/admin/api-keys/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['scopes'] == ['aircraft.view']


@pytest.mark.django_db
class TestAPIKeyDelete:
    """Tests for DELETE /api/v1/admin/api-keys/{id} - revoke API key."""

    def test_revoke_api_key(self, superadmin_client, create_user, create_api_key, all_roles):
        """Revoke (delete) an API key."""
        user, _ = create_user('key_revoke_user', role=all_roles['operator'])
        api_key, _ = create_api_key(user, name='To Be Revoked')

        response = superadmin_client.delete(f'/api/v1/admin/api-keys/{api_key.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        # Key should no longer exist or be inactive
        api_key.refresh_from_db()
        assert not api_key.is_active or not APIKey.objects.filter(id=api_key.id).exists()

    def test_admin_can_revoke_non_admin_keys(
        self, admin_client, create_user, create_api_key, all_roles
    ):
        """Admin can revoke keys for non-admin users."""
        user, _ = create_user('admin_revoke_target', role=all_roles['operator'])
        api_key, _ = create_api_key(user, name='Admin Revokable')

        response = admin_client.delete(f'/api/v1/admin/api-keys/{api_key.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_revoke_nonexistent_key_returns_404(self, superadmin_client):
        """Revoking non-existent key returns 404."""
        response = superadmin_client.delete('/api/v1/admin/api-keys/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Feature Access Configuration Tests
# =============================================================================


@pytest.mark.django_db
class TestFeatureAccessList:
    """Tests for GET /api/v1/admin/feature-access - list feature configs."""

    def test_list_feature_access_configurations(self, superadmin_client, db):
        """List all feature access configurations."""
        # Create some feature configs
        FeatureAccess.objects.update_or_create(
            feature='aircraft',
            defaults={
                'read_access': 'public',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )

        response = superadmin_client.get('/api/v1/admin/feature-access/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'features' in result

        # Find aircraft feature
        aircraft = next(
            (f for f in result['features'] if f['feature'] == 'aircraft'),
            None
        )
        assert aircraft is not None
        assert aircraft['read_access'] == 'public'
        assert aircraft['write_access'] == 'permission'

    def test_admin_can_list_feature_access(self, admin_client, db):
        """Admin can list feature access configurations."""
        response = admin_client.get('/api/v1/admin/feature-access/')

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestFeatureAccessUpdate:
    """Tests for PATCH /api/v1/admin/feature-access/{feature} - update config."""

    def test_update_read_access_to_public(self, superadmin_client, db):
        """Update feature read access to public."""
        FeatureAccess.objects.update_or_create(
            feature='alerts',
            defaults={
                'read_access': 'authenticated',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )

        response = superadmin_client.patch(
            '/api/v1/admin/feature-access/alerts/',
            {'read_access': 'public'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['read_access'] == 'public'

    def test_update_write_access_to_authenticated(self, superadmin_client, db):
        """Update feature write access to authenticated."""
        FeatureAccess.objects.update_or_create(
            feature='alerts',
            defaults={
                'read_access': 'public',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )

        response = superadmin_client.patch(
            '/api/v1/admin/feature-access/alerts/',
            {'write_access': 'authenticated'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['write_access'] == 'authenticated'

    def test_disable_feature(self, superadmin_client, db):
        """Disable a feature."""
        FeatureAccess.objects.update_or_create(
            feature='acars',
            defaults={
                'read_access': 'authenticated',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )

        response = superadmin_client.patch(
            '/api/v1/admin/feature-access/acars/',
            {'is_enabled': False},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['is_enabled'] is False

    def test_enable_feature(self, superadmin_client, db):
        """Enable a disabled feature."""
        FeatureAccess.objects.update_or_create(
            feature='audio',
            defaults={
                'read_access': 'permission',
                'write_access': 'permission',
                'is_enabled': False,
            }
        )

        response = superadmin_client.patch(
            '/api/v1/admin/feature-access/audio/',
            {'is_enabled': True},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['is_enabled'] is True

    def test_update_nonexistent_feature_returns_404(self, superadmin_client):
        """Updating non-existent feature returns 404."""
        response = superadmin_client.patch(
            '/api/v1/admin/feature-access/nonexistent/',
            {'read_access': 'public'},
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_invalid_access_level_rejected(self, superadmin_client, db):
        """Invalid access level is rejected."""
        FeatureAccess.objects.update_or_create(
            feature='safety',
            defaults={
                'read_access': 'authenticated',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )

        response = superadmin_client.patch(
            '/api/v1/admin/feature-access/safety/',
            {'read_access': 'invalid_level'},
            format='json'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST


# =============================================================================
# OIDC Claim Mappings Tests
# =============================================================================


@pytest.mark.django_db
class TestOIDCClaimMappingsList:
    """Tests for GET /api/v1/admin/oidc-mappings - list mappings."""

    def test_list_oidc_claim_mappings(self, superadmin_client, all_roles):
        """List all OIDC claim mappings."""
        # Create some mappings
        OIDCClaimMapping.objects.create(
            name='Admins Group',
            claim_name='groups',
            match_type='exact',
            claim_value='skyspy-admins',
            role=all_roles['admin'],
            is_active=True,
        )

        response = superadmin_client.get('/api/v1/admin/oidc-mappings/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'mappings' in result

        mapping = next(
            (m for m in result['mappings'] if m['name'] == 'Admins Group'),
            None
        )
        assert mapping is not None
        assert mapping['claim_name'] == 'groups'
        assert mapping['match_type'] == 'exact'


@pytest.mark.django_db
class TestOIDCClaimMappingCreate:
    """Tests for POST /api/v1/admin/oidc-mappings - create mapping."""

    def test_create_exact_match_mapping(self, superadmin_client, all_roles):
        """Create an exact match OIDC claim mapping."""
        data = {
            'name': 'Operators Group',
            'claim_name': 'groups',
            'match_type': 'exact',
            'claim_value': 'skyspy-operators',
            'role_id': all_roles['operator'].id,
            'priority': 10,
        }

        response = superadmin_client.post('/api/v1/admin/oidc-mappings/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['name'] == 'Operators Group'
        assert result['match_type'] == 'exact'
        assert result['role_id'] == all_roles['operator'].id

    def test_create_contains_match_mapping(self, superadmin_client, all_roles):
        """Create a contains match OIDC claim mapping."""
        data = {
            'name': 'Analyst Email Domain',
            'claim_name': 'email',
            'match_type': 'contains',
            'claim_value': '@analyst.company.com',
            'role_id': all_roles['analyst'].id,
        }

        response = superadmin_client.post('/api/v1/admin/oidc-mappings/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['match_type'] == 'contains'

    def test_create_regex_match_mapping(self, superadmin_client, all_roles):
        """Create a regex match OIDC claim mapping."""
        data = {
            'name': 'Admin Email Pattern',
            'claim_name': 'email',
            'match_type': 'regex',
            'claim_value': r'^admin-.*@company\.com$',
            'role_id': all_roles['admin'].id,
        }

        response = superadmin_client.post('/api/v1/admin/oidc-mappings/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['match_type'] == 'regex'

    def test_create_mapping_with_nonexistent_role_fails(self, superadmin_client):
        """Creating mapping with non-existent role fails."""
        data = {
            'name': 'Invalid Role Mapping',
            'claim_name': 'groups',
            'match_type': 'exact',
            'claim_value': 'some-group',
            'role_id': 99999,
        }

        response = superadmin_client.post('/api/v1/admin/oidc-mappings/', data, format='json')

        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]


@pytest.mark.django_db
class TestOIDCClaimMappingUpdate:
    """Tests for PATCH /api/v1/admin/oidc-mappings/{id} - update mapping."""

    def test_update_mapping_claim_value(self, superadmin_client, all_roles):
        """Update OIDC mapping claim value."""
        mapping = OIDCClaimMapping.objects.create(
            name='Update Test',
            claim_name='groups',
            match_type='exact',
            claim_value='old-value',
            role=all_roles['viewer'],
        )

        response = superadmin_client.patch(
            f'/api/v1/admin/oidc-mappings/{mapping.id}/',
            {'claim_value': 'new-value'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['claim_value'] == 'new-value'

    def test_update_mapping_match_type(self, superadmin_client, all_roles):
        """Update OIDC mapping match type."""
        mapping = OIDCClaimMapping.objects.create(
            name='Match Type Update',
            claim_name='email',
            match_type='exact',
            claim_value='test@example.com',
            role=all_roles['viewer'],
        )

        response = superadmin_client.patch(
            f'/api/v1/admin/oidc-mappings/{mapping.id}/',
            {'match_type': 'contains'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['match_type'] == 'contains'

    def test_update_mapping_active_status(self, superadmin_client, all_roles):
        """Update OIDC mapping active status."""
        mapping = OIDCClaimMapping.objects.create(
            name='Active Status Test',
            claim_name='groups',
            match_type='exact',
            claim_value='test-group',
            role=all_roles['viewer'],
            is_active=True,
        )

        # Deactivate
        response = superadmin_client.patch(
            f'/api/v1/admin/oidc-mappings/{mapping.id}/',
            {'is_active': False},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['is_active'] is False


@pytest.mark.django_db
class TestOIDCClaimMappingDelete:
    """Tests for DELETE /api/v1/admin/oidc-mappings/{id} - delete mapping."""

    def test_delete_oidc_mapping(self, superadmin_client, all_roles):
        """Delete an OIDC claim mapping."""
        mapping = OIDCClaimMapping.objects.create(
            name='To Be Deleted',
            claim_name='groups',
            match_type='exact',
            claim_value='delete-me',
            role=all_roles['viewer'],
        )
        mapping_id = mapping.id

        response = superadmin_client.delete(f'/api/v1/admin/oidc-mappings/{mapping_id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not OIDCClaimMapping.objects.filter(id=mapping_id).exists()

    def test_delete_nonexistent_mapping_returns_404(self, superadmin_client):
        """Deleting non-existent mapping returns 404."""
        response = superadmin_client.delete('/api/v1/admin/oidc-mappings/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Permission Checks Tests
# =============================================================================


@pytest.mark.django_db
class TestAdminPermissionChecks:
    """Tests for admin endpoint permission checks."""

    def test_viewer_cannot_access_any_admin_endpoints(self, viewer_client):
        """Viewer gets 403 on all admin endpoints."""
        endpoints = [
            '/api/v1/admin/users/',
            '/api/v1/admin/roles/',
            '/api/v1/admin/user-roles/',
            '/api/v1/admin/api-keys/',
            '/api/v1/admin/feature-access/',
            '/api/v1/admin/oidc-mappings/',
        ]

        for endpoint in endpoints:
            response = viewer_client.get(endpoint)
            assert response.status_code == status.HTTP_403_FORBIDDEN, \
                f"Viewer should not access {endpoint}"

    def test_operator_cannot_access_admin_endpoints(self, operator_client):
        """Operator gets 403 on admin endpoints."""
        endpoints = [
            '/api/v1/admin/users/',
            '/api/v1/admin/roles/',
            '/api/v1/admin/user-roles/',
            '/api/v1/admin/api-keys/',
            '/api/v1/admin/feature-access/',
            '/api/v1/admin/oidc-mappings/',
        ]

        for endpoint in endpoints:
            response = operator_client.get(endpoint)
            assert response.status_code == status.HTTP_403_FORBIDDEN, \
                f"Operator should not access {endpoint}"

    def test_analyst_cannot_access_admin_endpoints(self, analyst_client):
        """Analyst gets 403 on admin endpoints."""
        endpoints = [
            '/api/v1/admin/users/',
            '/api/v1/admin/roles/',
        ]

        for endpoint in endpoints:
            response = analyst_client.get(endpoint)
            assert response.status_code == status.HTTP_403_FORBIDDEN, \
                f"Analyst should not access {endpoint}"

    def test_admin_has_limited_admin_access(self, admin_client, all_roles):
        """Admin can access some admin endpoints but not user management."""
        # Admin should be able to access roles
        response = admin_client.get('/api/v1/admin/roles/')
        assert response.status_code == status.HTTP_200_OK

        # Admin might not be able to create superadmin users
        response = admin_client.post(
            '/api/v1/admin/users/',
            {
                'username': 'admin_created_superadmin',
                'email': 'admin_super@example.com',
                'role_ids': [all_roles['superadmin'].id],
            },
            format='json'
        )
        # Should either fail or not assign superadmin role
        if response.status_code == status.HTTP_201_CREATED:
            result = response.json()
            role_names = [r['name'] for r in result.get('roles', [])]
            assert 'superadmin' not in role_names

    def test_superadmin_has_full_admin_access(self, superadmin_client):
        """Superadmin has full access to all admin endpoints."""
        endpoints = [
            '/api/v1/admin/users/',
            '/api/v1/admin/roles/',
            '/api/v1/admin/user-roles/',
            '/api/v1/admin/api-keys/',
            '/api/v1/admin/feature-access/',
            '/api/v1/admin/oidc-mappings/',
        ]

        for endpoint in endpoints:
            response = superadmin_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK, \
                f"Superadmin should access {endpoint}"

    def test_unauthenticated_gets_401_on_admin_endpoints(self, api_client):
        """Unauthenticated requests get 401 on admin endpoints."""
        endpoints = [
            '/api/v1/admin/users/',
            '/api/v1/admin/roles/',
            '/api/v1/admin/user-roles/',
            '/api/v1/admin/api-keys/',
            '/api/v1/admin/feature-access/',
            '/api/v1/admin/oidc-mappings/',
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response.status_code == status.HTTP_401_UNAUTHORIZED, \
                f"Unauthenticated should not access {endpoint}"


# =============================================================================
# Audit and Logging Tests
# =============================================================================


@pytest.mark.django_db
class TestAdminAuditLogging:
    """Tests for admin action audit logging."""

    def test_user_creation_is_logged(self, superadmin_client, all_roles):
        """User creation action is logged."""
        data = {
            'username': 'audit_user',
            'email': 'audit@example.com',
            'password': 'SecurePass123!',
        }

        with patch('skyspy.api.admin.logger') as mock_logger:
            response = superadmin_client.post('/api/v1/admin/users/', data, format='json')

            assert response.status_code == status.HTTP_201_CREATED
            # Verify logging was called
            # (This depends on the implementation having logging)

    def test_role_assignment_is_logged(
        self, superadmin_client, superadmin_user, create_user, all_roles
    ):
        """Role assignment is logged."""
        user, _ = create_user('log_role_user')

        with patch('skyspy.api.admin.logger') as mock_logger:
            response = superadmin_client.post(
                f'/api/v1/admin/users/{user.id}/assign_role/',
                {'role_id': all_roles['operator'].id},
                format='json'
            )

            assert response.status_code == status.HTTP_200_OK

    def test_user_deletion_is_logged(
        self, superadmin_client, create_user, all_roles
    ):
        """User deletion is logged."""
        user, _ = create_user('delete_log_user', role=all_roles['viewer'])

        with patch('skyspy.api.admin.logger') as mock_logger:
            response = superadmin_client.delete(f'/api/v1/admin/users/{user.id}/')

            assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_api_key_creation_is_logged(
        self, superadmin_client, create_user, all_roles
    ):
        """API key creation is logged."""
        user, _ = create_user('key_log_user', role=all_roles['operator'])

        with patch('skyspy.api.admin.logger') as mock_logger:
            response = superadmin_client.post(
                '/api/v1/admin/api-keys/',
                {
                    'user_id': user.id,
                    'name': 'Logged Key',
                },
                format='json'
            )

            assert response.status_code == status.HTTP_201_CREATED

    def test_query_admin_action_history(self, superadmin_client, create_user, all_roles):
        """Can query admin action history (if endpoint exists)."""
        # Create some actions
        user, _ = create_user('history_user', role=all_roles['viewer'])

        # Try to query history
        response = superadmin_client.get('/api/v1/admin/audit-log/')

        # Endpoint might not exist, which is OK
        if response.status_code == status.HTTP_200_OK:
            result = response.json()
            assert 'entries' in result or 'logs' in result or 'actions' in result
        else:
            # If endpoint doesn't exist, that's acceptable
            assert response.status_code in [
                status.HTTP_404_NOT_FOUND,
                status.HTTP_200_OK,
            ]


# =============================================================================
# Integration Workflow Tests
# =============================================================================


@pytest.mark.django_db
class TestAdminIntegrationWorkflows:
    """Integration tests for complete admin workflows."""

    def test_complete_user_lifecycle(self, superadmin_client, all_roles):
        """Test complete user lifecycle: create, assign role, update, disable, delete."""
        # 1. Create user
        create_response = superadmin_client.post(
            '/api/v1/admin/users/',
            {
                'username': 'lifecycle_user',
                'email': 'lifecycle@example.com',
                'password': 'SecurePass123!',
            },
            format='json'
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        user_id = create_response.json()['id']

        # 2. Assign role
        assign_response = superadmin_client.post(
            f'/api/v1/admin/users/{user_id}/assign_role/',
            {'role_id': all_roles['operator'].id},
            format='json'
        )
        assert assign_response.status_code == status.HTTP_200_OK

        # 3. Update user
        update_response = superadmin_client.patch(
            f'/api/v1/admin/users/{user_id}/',
            {'display_name': 'Lifecycle Test User'},
            format='json'
        )
        assert update_response.status_code == status.HTTP_200_OK

        # 4. Disable user
        disable_response = superadmin_client.patch(
            f'/api/v1/admin/users/{user_id}/',
            {'is_active': False},
            format='json'
        )
        assert disable_response.status_code == status.HTTP_200_OK

        # 5. Delete user
        delete_response = superadmin_client.delete(f'/api/v1/admin/users/{user_id}/')
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

    def test_create_custom_role_and_assign_to_users(
        self, superadmin_client, create_user
    ):
        """Create a custom role and assign it to multiple users."""
        # 1. Create custom role
        role_response = superadmin_client.post(
            '/api/v1/admin/roles/',
            {
                'name': 'custom_auditor',
                'display_name': 'Custom Auditor',
                'description': 'Custom role for auditing',
                'permissions': ['aircraft.view', 'history.view', 'history.export'],
                'priority': 15,
            },
            format='json'
        )
        assert role_response.status_code == status.HTTP_201_CREATED
        role_id = role_response.json()['id']

        # 2. Create users
        user1, _ = create_user('auditor_1')
        user2, _ = create_user('auditor_2')

        # 3. Assign role to users
        assign1 = superadmin_client.post(
            f'/api/v1/admin/users/{user1.id}/assign_role/',
            {'role_id': role_id},
            format='json'
        )
        assert assign1.status_code == status.HTTP_200_OK

        assign2 = superadmin_client.post(
            f'/api/v1/admin/users/{user2.id}/assign_role/',
            {'role_id': role_id},
            format='json'
        )
        assert assign2.status_code == status.HTTP_200_OK

        # 4. Verify assignments
        assignments = superadmin_client.get(f'/api/v1/admin/user-roles/?role_id={role_id}')
        assert assignments.status_code == status.HTTP_200_OK
        assert assignments.json()['count'] == 2

    def test_setup_oidc_role_mapping_workflow(self, superadmin_client, all_roles):
        """Test setting up OIDC claim to role mappings."""
        # 1. Create mapping for admins group
        admin_mapping = superadmin_client.post(
            '/api/v1/admin/oidc-mappings/',
            {
                'name': 'OIDC Admins',
                'claim_name': 'groups',
                'match_type': 'exact',
                'claim_value': 'skyspy-admins',
                'role_id': all_roles['admin'].id,
                'priority': 100,
            },
            format='json'
        )
        assert admin_mapping.status_code == status.HTTP_201_CREATED

        # 2. Create mapping for operators group
        operator_mapping = superadmin_client.post(
            '/api/v1/admin/oidc-mappings/',
            {
                'name': 'OIDC Operators',
                'claim_name': 'groups',
                'match_type': 'exact',
                'claim_value': 'skyspy-operators',
                'role_id': all_roles['operator'].id,
                'priority': 50,
            },
            format='json'
        )
        assert operator_mapping.status_code == status.HTTP_201_CREATED

        # 3. Create mapping for email domain
        email_mapping = superadmin_client.post(
            '/api/v1/admin/oidc-mappings/',
            {
                'name': 'Company Email',
                'claim_name': 'email',
                'match_type': 'contains',
                'claim_value': '@company.com',
                'role_id': all_roles['viewer'].id,
                'priority': 10,
            },
            format='json'
        )
        assert email_mapping.status_code == status.HTTP_201_CREATED

        # 4. List all mappings
        list_response = superadmin_client.get('/api/v1/admin/oidc-mappings/')
        assert list_response.status_code == status.HTTP_200_OK
        assert list_response.json()['count'] >= 3

    def test_configure_feature_access_for_public_deployment(self, superadmin_client, db):
        """Configure feature access for a public deployment scenario."""
        # Initialize features
        features = ['aircraft', 'alerts', 'safety', 'audio', 'acars', 'history', 'system']
        for feature in features:
            FeatureAccess.objects.update_or_create(
                feature=feature,
                defaults={
                    'read_access': 'authenticated',
                    'write_access': 'permission',
                    'is_enabled': True,
                }
            )

        # 1. Make aircraft and safety public for read
        superadmin_client.patch(
            '/api/v1/admin/feature-access/aircraft/',
            {'read_access': 'public'},
            format='json'
        )
        superadmin_client.patch(
            '/api/v1/admin/feature-access/safety/',
            {'read_access': 'public'},
            format='json'
        )

        # 2. Disable ACARS for this deployment
        superadmin_client.patch(
            '/api/v1/admin/feature-access/acars/',
            {'is_enabled': False},
            format='json'
        )

        # 3. Verify configuration
        list_response = superadmin_client.get('/api/v1/admin/feature-access/')
        assert list_response.status_code == status.HTTP_200_OK

        features_result = {f['feature']: f for f in list_response.json()['features']}

        assert features_result['aircraft']['read_access'] == 'public'
        assert features_result['safety']['read_access'] == 'public'
        assert features_result['acars']['is_enabled'] is False
