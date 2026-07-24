"""Regression tests for RBAC privilege-escalation fixes.

An `admin`-role user (holds users.view/users.edit/roles.view but is NOT a Django
superuser and lacks superadmin/users.delete/roles.create) must not be able to
climb to superadmin. Covers the four escalation paths closed:

- UserRoleViewSet granting the superadmin role directly (no guard before).
- APIKeyViewSet minting a key bound to another/superuser account or with scopes
  exceeding the owner's perms.
- assign_role gated on the read permission (users.view) instead of users.edit.
- RoleViewSet authoring/editing a role with permissions the caller doesn't hold.
"""

import pytest
from django.contrib.auth.models import User

from skyspy.models.auth import ALL_PERMISSIONS, DEFAULT_ROLES, Role, SkyspyUser, UserRole


@pytest.fixture
def superadmin_role(db):
    return Role.objects.create(
        name="superadmin",
        display_name="Super Admin",
        permissions=list(ALL_PERMISSIONS),
        is_system=True,
        priority=100,
    )


@pytest.fixture
def admin_role(db):
    return Role.objects.create(
        name="admin",
        display_name="Admin",
        permissions=list(DEFAULT_ROLES["admin"]["permissions"]),
        is_system=True,
        priority=40,
    )


@pytest.fixture
def admin_user(db, admin_role):
    """Non-superuser with the admin role (users.edit but not superadmin)."""
    user = User.objects.create_user(username="privesc_admin", password="x")
    SkyspyUser.objects.get_or_create(user=user, defaults={"display_name": "Admin"})
    UserRole.objects.create(user=user, role=admin_role)
    assert "users.delete" not in DEFAULT_ROLES["admin"]["permissions"]
    return user


@pytest.fixture
def victim(db):
    user = User.objects.create_user(username="victim", password="x")
    SkyspyUser.objects.get_or_create(user=user, defaults={"display_name": "Victim"})
    return user


@pytest.mark.django_db
class TestUserRolePrivEsc:
    def test_admin_cannot_grant_superadmin_via_userrole(self, api_client, admin_user, victim, superadmin_role):
        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(
            "/api/v1/admin/user-roles/",
            {"user": victim.id, "role": superadmin_role.id},
            format="json",
        )
        assert resp.status_code == 403, resp.data
        assert not UserRole.objects.filter(user=victim, role=superadmin_role).exists()

    def test_admin_cannot_selfgrant_superadmin(self, api_client, admin_user, superadmin_role):
        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(
            "/api/v1/admin/user-roles/",
            {"user": admin_user.id, "role": superadmin_role.id},
            format="json",
        )
        assert resp.status_code == 403
        assert not UserRole.objects.filter(user=admin_user, role=superadmin_role).exists()

    def test_superuser_can_grant_superadmin(self, api_client, db, victim, superadmin_role):
        su = User.objects.create_user(username="root", password="x", is_superuser=True, is_staff=True)
        SkyspyUser.objects.get_or_create(user=su, defaults={"display_name": "root"})
        api_client.force_authenticate(user=su)
        resp = api_client.post(
            "/api/v1/admin/user-roles/",
            {"user": victim.id, "role": superadmin_role.id},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert UserRole.objects.filter(user=victim, role=superadmin_role).exists()


@pytest.mark.django_db
class TestAPIKeyPrivEsc:
    def test_admin_cannot_mint_key_for_superuser(self, api_client, admin_user, db):
        su = User.objects.create_user(username="root2", password="x", is_superuser=True)
        SkyspyUser.objects.get_or_create(user=su, defaults={"display_name": "root2"})
        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(
            "/api/v1/admin/api-keys/",
            {"name": "pwn", "user_id": su.id, "scopes": []},
            format="json",
        )
        assert resp.status_code == 403, resp.data

    def test_admin_cannot_mint_key_with_excess_scopes(self, api_client, admin_user):
        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(
            "/api/v1/admin/api-keys/",
            {"name": "pwn", "scopes": ["users.delete", "roles.create"]},
            format="json",
        )
        assert resp.status_code == 403, resp.data

    def test_admin_can_mint_own_key_within_scopes(self, api_client, admin_user):
        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(
            "/api/v1/admin/api-keys/",
            {"name": "ok", "scopes": ["aircraft.view", "alerts.view"]},
            format="json",
        )
        assert resp.status_code == 201, resp.data


@pytest.mark.django_db
class TestRolePrivEsc:
    def test_admin_cannot_author_role_exceeding_own_perms(self, api_client, admin_user):
        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(
            "/api/v1/admin/roles/",
            {"name": "backdoor", "display_name": "Backdoor", "permissions": ["users.delete", "roles.create"]},
            format="json",
        )
        assert resp.status_code == 403, resp.data
        assert not Role.objects.filter(name="backdoor").exists()

    def test_admin_cannot_edit_role_to_exceed_own_perms(self, api_client, admin_user):
        role = Role.objects.create(name="dispatch", display_name="Dispatch", permissions=["aircraft.view"])
        api_client.force_authenticate(user=admin_user)
        resp = api_client.patch(
            f"/api/v1/admin/roles/{role.id}/",
            {"permissions": ["users.delete"]},
            format="json",
        )
        assert resp.status_code == 403, resp.data
        role.refresh_from_db()
        assert role.permissions == ["aircraft.view"]
