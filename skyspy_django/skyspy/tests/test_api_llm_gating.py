"""
API tests for LLM-backed endpoint gating (CanUseLLM).

Ancillary AI features — aviation explainers, ACARS AI summary/analysis, airframe
flight-history / type-card generation — cost LLM tokens, so they must not be
reachable by anonymous visitors on a public deploy (AUTH_MODE=public), even though
the surrounding viewsets are otherwise public/feature-gated. In local DEV_MODE the
gate is relaxed. Enforced by CanUseLLM (auth + assistant.view).
"""

import pytest
from django.contrib.auth import get_user_model

from skyspy.models import AcarsMessage, Role, UserRole
from skyspy.models.auth import SkyspyUser
from skyspy.tests.factories import SafetyEventFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _prod_mode(settings):
    """Default to production enforcement (dev bypass off) for these tests."""
    settings.DEV_MODE = False


def _make_ai_user(username="ai-user"):
    User = get_user_model()
    user = User.objects.create_user(username=username, password="pw")
    SkyspyUser.objects.get_or_create(user=user)
    role, _ = Role.objects.get_or_create(
        name="ai-user", defaults={"display_name": "AI User", "permissions": ["assistant.view"]}
    )
    UserRole.objects.get_or_create(user=user, role=role)
    return user


def _acars_msg():
    return AcarsMessage.objects.create(source="vdlm2", icao_hex="A12345", callsign="TEST123", label="H1", text="TEST")


# (path, method) for each anonymous-forbidden LLM endpoint.
def _endpoints():
    mid = _acars_msg().id
    eid = SafetyEventFactory().id
    return [
        ("post", "/api/v1/aviation/explain/", {"text": "KSAN 010000Z"}),
        ("get", f"/api/v1/acars/{mid}/ai-summary/", None),
        ("get", f"/api/v1/acars/{mid}/ai-analysis/", None),
        ("get", "/api/v1/airframes/A12345/flight-history/", None),
        ("get", f"/api/v1/safety/events/{eid}/ai-summary/", None),
    ]


class TestLLMEndpointsBlockAnon:
    def test_anonymous_forbidden_in_prod(self, api_client):
        for method, path, body in _endpoints():
            resp = getattr(api_client, method)(path, body or {}, format="json")
            assert resp.status_code in (401, 403), f"{method} {path} -> {resp.status_code} (expected 401/403)"

    def test_authenticated_without_permission_forbidden(self, api_client):
        User = get_user_model()
        user = User.objects.create_user(username="noperm", password="pw")
        SkyspyUser.objects.get_or_create(user=user)
        api_client.force_authenticate(user=user)
        for method, path, body in _endpoints():
            resp = getattr(api_client, method)(path, body or {}, format="json")
            assert resp.status_code == 403, f"{method} {path} -> {resp.status_code} (expected 403)"

    def test_ai_user_passes_the_gate(self, api_client):
        """A user with assistant.view is not blocked by the permission (200/503/404
        depending on LLM availability — just not 401/403)."""
        api_client.force_authenticate(user=_make_ai_user())
        for method, path, body in _endpoints():
            resp = getattr(api_client, method)(path, body or {}, format="json")
            assert resp.status_code not in (401, 403), f"{method} {path} -> {resp.status_code} (should pass gate)"


class TestDevModeRelaxesLLMGate:
    def test_anonymous_allowed_in_dev(self, api_client, settings):
        settings.DEV_MODE = True
        for method, path, body in _endpoints():
            resp = getattr(api_client, method)(path, body or {}, format="json")
            assert resp.status_code not in (401, 403), f"{method} {path} -> {resp.status_code} (dev should allow)"
