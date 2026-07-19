"""RBAC console API tests — the behaviors the Access Control UI depends on:

- system roles are now editable (the old ``update`` stripped system-role perms),
- ``reset_defaults`` restores a system role to its shipped DEFAULT_ROLES perms,
- the permission catalog carries display labels for the role matrix,
- the ``assistant`` FeatureAccess row is seeded (migration 0039).
"""

import pytest
from django.contrib.auth.models import User

from skyspy.models.auth import DEFAULT_ROLES, Role, SkyspyUser


@pytest.fixture
def superuser(db):
    user = User.objects.create_user(username="rbac_admin", password="x", is_staff=True, is_superuser=True)
    SkyspyUser.objects.get_or_create(user=user, defaults={"display_name": "RBAC Admin"})
    return user


@pytest.fixture
def viewer_role(db):
    role, _ = Role.objects.get_or_create(
        name="viewer",
        defaults={
            "display_name": "Viewer",
            "permissions": list(DEFAULT_ROLES["viewer"]["permissions"]),
            "priority": DEFAULT_ROLES["viewer"]["priority"],
            "is_system": True,
        },
    )
    return role


@pytest.mark.django_db
class TestSystemRoleEditable:
    def test_system_role_permissions_persist(self, api_client, superuser, viewer_role):
        """Regression: the old update() dropped `permissions` for system roles."""
        api_client.force_authenticate(user=superuser)
        new_perms = ["aircraft.view", "alerts.view", "history.view"]

        resp = api_client.patch(
            f"/api/v1/admin/roles/{viewer_role.id}/",
            {"permissions": new_perms},
            format="json",
        )

        assert resp.status_code == 200, resp.data
        viewer_role.refresh_from_db()
        assert set(viewer_role.permissions) == set(new_perms)

    def test_system_role_name_immutable(self, api_client, superuser, viewer_role):
        api_client.force_authenticate(user=superuser)
        resp = api_client.patch(
            f"/api/v1/admin/roles/{viewer_role.id}/",
            {"name": "hacked", "display_name": "Still Viewer"},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        viewer_role.refresh_from_db()
        assert viewer_role.name == "viewer"
        assert viewer_role.display_name == "Still Viewer"


@pytest.mark.django_db
class TestResetDefaults:
    def test_reset_restores_shipped_permissions(self, api_client, superuser, viewer_role):
        api_client.force_authenticate(user=superuser)
        viewer_role.permissions = ["aircraft.view"]
        viewer_role.save()

        resp = api_client.post(f"/api/v1/admin/roles/{viewer_role.id}/reset_defaults/")

        assert resp.status_code == 200, resp.data
        viewer_role.refresh_from_db()
        assert set(viewer_role.permissions) == set(DEFAULT_ROLES["viewer"]["permissions"])

    def test_reset_rejects_custom_role(self, api_client, superuser):
        api_client.force_authenticate(user=superuser)
        custom = Role.objects.create(name="dispatcher", display_name="Dispatcher", permissions=[], is_system=False)

        resp = api_client.post(f"/api/v1/admin/roles/{custom.id}/reset_defaults/")

        assert resp.status_code == 400


@pytest.mark.django_db
class TestPermissionCatalog:
    def test_catalog_has_display_labels(self, api_client):
        resp = api_client.get("/api/v1/auth/permissions/")
        assert resp.status_code == 200
        by_feature = {row["feature"]: row for row in resp.data}

        assert "alerts" in by_feature
        alerts = by_feature["alerts"]
        assert alerts["display_name"]  # human label present
        assert isinstance(alerts["permissions"], list)  # legacy string list kept
        # Rich per-action entries for the matrix.
        keys = {a["key"] for a in alerts["actions"]}
        assert "alerts.view" in keys
        assert all("label" in a and "action" in a for a in alerts["actions"])

    def test_assistant_feature_present(self, api_client):
        resp = api_client.get("/api/v1/auth/permissions/")
        features = {row["feature"] for row in resp.data}
        assert "assistant" in features
