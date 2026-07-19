"""RBAC gating for the weather + wildfires aviation endpoints.

Weather (METAR/TAF/PIREP/SIGMET/NEXRAD/winds-aloft/turbulence) and wildfires are
first-class RBAC features (migration 0043): the AviationViewSet gates those
actions on the `weather` / `wildfires` FeatureAccess feature via
FeatureBasedPermission. In AUTH_MODE=public everything stays open; in
hybrid/private a `read_access="permission"` row means only users holding
`weather.view` / `wildfires.view` may read.

Note: the session-scoped `django_db_setup` fixture deletes FeatureAccess rows
after migration, so each test seeds the rows + roles it needs.
"""

import pytest
from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework import status

from skyspy.models.auth import FeatureAccess, Role, SkyspyUser, UserRole


def _make_feature(feature, read_access="permission"):
    return FeatureAccess.objects.create(
        feature=feature,
        read_access=read_access,
        write_access="permission",
        is_enabled=True,
    )


def _make_user(username, permissions):
    """Create a user whose single role carries exactly `permissions`."""
    user = User.objects.create_user(username=username, password="testpass")
    SkyspyUser.objects.get_or_create(user=user, defaults={"display_name": username})
    role = Role.objects.create(name=f"role_{username}", display_name=username, permissions=list(permissions))
    UserRole.objects.create(user=user, role=role)
    return user


@pytest.mark.django_db
class TestWeatherRbac:
    @override_settings(AUTH_MODE="hybrid")
    def test_anonymous_denied_when_permission_gated(self, api_client):
        _make_feature("weather")
        resp = api_client.get("/api/v1/aviation/metars/")
        assert resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    @override_settings(AUTH_MODE="hybrid")
    def test_user_without_permission_denied(self, api_client):
        _make_feature("weather")
        user = _make_user("no_weather", ["aircraft.view"])
        api_client.force_authenticate(user=user)
        resp = api_client.get("/api/v1/aviation/metars/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    @override_settings(AUTH_MODE="hybrid")
    def test_user_with_permission_allowed(self, api_client):
        _make_feature("weather")
        user = _make_user("has_weather", ["weather.view"])
        api_client.force_authenticate(user=user)
        # turbulence/aircraft is a pure cache read (no external fan-out).
        resp = api_client.get("/api/v1/aviation/turbulence/aircraft/")
        assert resp.status_code == status.HTTP_200_OK

    @override_settings(AUTH_MODE="hybrid")
    def test_disabled_feature_denies_everyone(self, api_client):
        FeatureAccess.objects.create(
            feature="weather", read_access="public", write_access="permission", is_enabled=False
        )
        user = _make_user("weather_disabled", ["weather.view"])
        api_client.force_authenticate(user=user)
        resp = api_client.get("/api/v1/aviation/metars/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_public_mode_allows_anonymous(self, api_client):
        # Test settings default to AUTH_MODE=public — public bypass unchanged.
        resp = api_client.get("/api/v1/aviation/turbulence/aircraft/")
        assert resp.status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestWildfiresRbac:
    @override_settings(AUTH_MODE="hybrid")
    def test_anonymous_denied_when_permission_gated(self, api_client):
        _make_feature("wildfires")
        resp = api_client.get("/api/v1/aviation/wildfires/")
        assert resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    @override_settings(AUTH_MODE="hybrid")
    def test_user_without_permission_denied(self, api_client):
        _make_feature("wildfires")
        user = _make_user("no_fire", ["aircraft.view"])
        api_client.force_authenticate(user=user)
        resp = api_client.get("/api/v1/aviation/wildfires/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    @override_settings(AUTH_MODE="hybrid")
    def test_user_with_permission_allowed(self, api_client):
        _make_feature("wildfires")
        user = _make_user("has_fire", ["wildfires.view"])
        api_client.force_authenticate(user=user)
        resp = api_client.get("/api/v1/aviation/wildfires/")
        assert resp.status_code == status.HTTP_200_OK

    def test_public_mode_allows_anonymous(self, api_client):
        resp = api_client.get("/api/v1/aviation/wildfires/")
        assert resp.status_code == status.HTTP_200_OK
