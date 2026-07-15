"""
Regression tests for auth and notification security fixes.

Covers:
- Apprise URL masking in notification serializers (credential disclosure)
- AuthModeMiddleware private mode allowing JWT / API key clients
- Watch list write endpoints requiring auth outside public mode
- Alert acknowledge mutations scoped to the requesting user's own rows
- Bounded limit param on notification history
"""

import pytest
from django.contrib.auth.models import AnonymousUser, User
from django.test import RequestFactory, override_settings
from rest_framework import status

from skyspy.models import AlertHistory, AlertRule, NotificationChannel, NotificationConfig, NotificationLog
from skyspy.serializers.notifications import mask_apprise_url

# =============================================================================
# Apprise URL masking
# =============================================================================


class TestMaskAppriseUrl:
    """Unit tests for the mask_apprise_url helper."""

    def test_masks_path_tokens(self):
        assert mask_apprise_url("gotify://gotify.example.com/secrettoken") == "gotify://gotify.example.com/****"

    def test_masks_userinfo(self):
        masked = mask_apprise_url("mailto://user:hunter2@smtp.example.com?to=a@b.c")
        assert "hunter2" not in masked
        assert "user" not in masked
        assert masked == "mailto://smtp.example.com/****"

    def test_masks_tokens_in_host_position(self):
        # For several apprise schemes the netloc itself is a secret
        assert mask_apprise_url("ntfy://mysecrettopic") == "ntfy://****"
        assert mask_apprise_url("discord://12345/secrettoken") == "discord://****"
        assert mask_apprise_url("pover://userkey/apitoken") == "pover://****"

    def test_empty_values_pass_through(self):
        assert mask_apprise_url("") == ""
        assert mask_apprise_url(None) is None

    def test_unparseable_is_fully_masked(self):
        assert mask_apprise_url("not a url") == "****"


@pytest.mark.django_db
class TestNotificationCredentialMasking:
    """API responses must never echo raw Apprise URLs."""

    SECRET = "supersecrettoken"

    def test_channel_list_masks_apprise_url(self, api_client):
        NotificationChannel.objects.create(
            name="Global Discord",
            channel_type="discord",
            apprise_url=f"discord://12345/{self.SECRET}",
            is_global=True,
        )
        response = api_client.get("/api/v1/notifications/channels/")
        assert response.status_code == status.HTTP_200_OK
        assert self.SECRET not in response.content.decode()

    def test_config_masks_apprise_urls(self, api_client):
        config = NotificationConfig.get_config()
        config.apprise_urls = f"discord://1/{self.SECRET};json://hooks.example.com/{self.SECRET}"
        config.enabled = True
        config.save()

        response = api_client.get("/api/v1/notifications/config/")
        assert response.status_code == status.HTTP_200_OK
        assert self.SECRET not in response.content.decode()
        # server_count still computed from the raw value
        assert response.json()["server_count"] == 2

    def test_history_masks_channel_url(self, api_client):
        NotificationLog.objects.create(
            notification_type="test",
            message="test",
            channel_url=f"discord://12345/{self.SECRET}",
            status="sent",
        )
        response = api_client.get("/api/v1/notifications/history/")
        assert response.status_code == status.HTTP_200_OK
        assert self.SECRET not in response.content.decode()

    def test_history_limit_is_bounded(self, api_client):
        response = api_client.get("/api/v1/notifications/history/?limit=notanint")
        assert response.status_code == status.HTTP_200_OK
        response = api_client.get("/api/v1/notifications/history/?limit=-5")
        assert response.status_code == status.HTTP_200_OK
        response = api_client.get("/api/v1/notifications/history/?limit=999999999999999999")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# AuthModeMiddleware private mode
# =============================================================================


@pytest.mark.django_db
class TestAuthModeMiddlewarePrivate:
    """Private mode must accept JWT / API-key clients, not just session auth."""

    def _middleware(self):
        from skyspy.auth.middleware import AuthModeMiddleware

        return AuthModeMiddleware(lambda request: "passed")

    def _request(self, **headers):
        request = RequestFactory().get("/api/v1/aircraft/", **headers)
        request.user = AnonymousUser()
        return request

    @override_settings(AUTH_MODE="private")
    def test_anonymous_without_credentials_rejected(self):
        response = self._middleware()(self._request())
        assert response.status_code == 401

    @override_settings(AUTH_MODE="private")
    def test_jwt_bearer_token_allowed(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        user = User.objects.create_user(username="jwt_user", password="testpass")
        token = str(RefreshToken.for_user(user).access_token)

        response = self._middleware()(self._request(HTTP_AUTHORIZATION=f"Bearer {token}"))
        assert response == "passed"

    @override_settings(AUTH_MODE="private")
    def test_api_key_allowed(self):
        from skyspy.models.auth import APIKey

        user = User.objects.create_user(username="key_user", password="testpass")
        key, key_hash, key_prefix = APIKey.generate_key()
        APIKey.objects.create(user=user, name="test", key_hash=key_hash, key_prefix=key_prefix)

        response = self._middleware()(self._request(HTTP_X_API_KEY=key))
        assert response == "passed"

    @override_settings(AUTH_MODE="private")
    def test_invalid_token_rejected(self):
        response = self._middleware()(self._request(HTTP_AUTHORIZATION="Bearer notatoken"))
        assert response.status_code == 401

    @override_settings(AUTH_MODE="private")
    def test_public_paths_stay_open(self):
        request = RequestFactory().get("/health")
        request.user = AnonymousUser()
        assert self._middleware()(request) == "passed"


# =============================================================================
# Watch list write protection
# =============================================================================


@pytest.mark.django_db
class TestWatchListPermissions:
    """Watch list writes must require auth outside public mode."""

    def test_public_mode_allows_writes(self, api_client):
        # Test settings default to AUTH_MODE=public - existing behavior kept
        response = api_client.post("/api/v1/watchlist/", {"hex": "ABC123"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    @override_settings(AUTH_MODE="hybrid")
    def test_hybrid_mode_allows_anonymous_reads(self, api_client):
        response = api_client.get("/api/v1/watchlist/")
        assert response.status_code == status.HTTP_200_OK

    @override_settings(AUTH_MODE="hybrid")
    def test_hybrid_mode_blocks_anonymous_writes(self, api_client):
        response = api_client.post("/api/v1/watchlist/", {"hex": "ABC123"}, format="json")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

        response = api_client.delete("/api/v1/watchlist/clear/")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

        response = api_client.post("/api/v1/watchlist/import/", {"watchList": []}, format="json")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    @override_settings(AUTH_MODE="hybrid")
    def test_hybrid_mode_allows_authenticated_writes(self, api_client):
        user = User.objects.create_user(username="watcher", password="testpass")
        api_client.force_authenticate(user=user)
        response = api_client.post("/api/v1/watchlist/", {"hex": "ABC123"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED


# =============================================================================
# Alert acknowledge scoping
# =============================================================================


@pytest.mark.django_db
class TestAlertAcknowledgeScoping:
    """Acknowledge mutations must not touch other users' rows."""

    @pytest.fixture(autouse=True)
    def setup_alerts(self):
        self.owner = User.objects.create_user(username="rule_owner", password="testpass")
        self.other = User.objects.create_user(username="other_user", password="testpass")
        self.public_rule = AlertRule.objects.create(name="Public Rule", visibility="public", owner=self.owner)
        self.owner_alert = AlertHistory.objects.create(
            rule=self.public_rule, rule_name="Public Rule", user=self.owner, acknowledged=False
        )

    def test_acknowledge_all_skips_other_users_rows(self, api_client):
        api_client.force_authenticate(user=self.other)
        response = api_client.post("/api/v1/alerts/history/acknowledge-all/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["acknowledged"] == 0

        self.owner_alert.refresh_from_db()
        assert self.owner_alert.acknowledged is False

    def test_acknowledge_detail_denied_for_other_users_row(self, api_client):
        api_client.force_authenticate(user=self.other)
        response = api_client.post(f"/api/v1/alerts/history/{self.owner_alert.id}/acknowledge/")
        assert response.status_code == status.HTTP_403_FORBIDDEN

        self.owner_alert.refresh_from_db()
        assert self.owner_alert.acknowledged is False

    def test_acknowledge_own_row_allowed(self, api_client):
        api_client.force_authenticate(user=self.owner)
        response = api_client.post(f"/api/v1/alerts/history/{self.owner_alert.id}/acknowledge/")
        assert response.status_code == status.HTTP_200_OK

        self.owner_alert.refresh_from_db()
        assert self.owner_alert.acknowledged is True

    def test_acknowledge_all_covers_own_rows(self, api_client):
        api_client.force_authenticate(user=self.owner)
        response = api_client.post("/api/v1/alerts/history/acknowledge-all/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["acknowledged"] == 1

    def test_public_rows_still_readable_by_others(self, api_client):
        api_client.force_authenticate(user=self.other)
        response = api_client.get("/api/v1/alerts/history/")
        assert response.status_code == status.HTTP_200_OK
