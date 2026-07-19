"""
API tests for assistant chat sessions (/api/v1/assistant/sessions/).

pytest-style with the `api_client` fixture (never APITestCase — PgBouncer).

Chat is an AI/LLM feature: it requires an authenticated user holding the
``assistant.view`` permission, enforced by ``CanUseAssistant`` even in
``AUTH_MODE=public``. The suite pins two contracts:
- anonymous callers are rejected (no anonymous AI), and
- sessions are scoped to their owner, so one user can neither see nor delete
  another's rows.
"""

import pytest
from django.contrib.auth import get_user_model

from skyspy.models import Role, UserRole
from skyspy.models.auth import SkyspyUser

BASE = "/api/v1/assistant/sessions/"

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _enable_assistant(settings):
    """Assistant is disabled in test settings; enable it for these tests."""
    settings.ASSISTANT_ENABLED = True
    settings.DEV_MODE = False  # exercise production enforcement, not the dev bypass


def _make_user(username, *, with_permission=True):
    """Create a user, profile, and (optionally) a role granting assistant.view."""
    User = get_user_model()
    user = User.objects.create_user(username=username, password="pw")
    SkyspyUser.objects.get_or_create(user=user)
    if with_permission:
        role, _ = Role.objects.get_or_create(
            name="ai-user",
            defaults={"display_name": "AI User", "permissions": ["assistant.view"]},
        )
        UserRole.objects.get_or_create(user=user, role=role)
    return user


def _ids(resp):
    """Session ids from a list response (paginated or bare array)."""
    data = resp.data
    rows = data["results"] if isinstance(data, dict) else data
    return [s["id"] for s in rows]


class TestChatRequiresAuth:
    def test_anonymous_is_forbidden(self, api_client):
        # No AI for anonymous visitors, even though sessions used to be client-scoped.
        assert api_client.get(BASE).status_code in (401, 403)
        assert api_client.post(BASE, {"title": "x"}, format="json").status_code in (401, 403)

    def test_authenticated_without_permission_is_forbidden(self, api_client):
        user = _make_user("noperm", with_permission=False)
        api_client.force_authenticate(user=user)
        assert api_client.get(BASE).status_code == 403

    def test_forbidden_when_feature_disabled(self, api_client, settings):
        settings.ASSISTANT_ENABLED = False
        user = _make_user("pilot")
        api_client.force_authenticate(user=user)
        assert api_client.get(BASE).status_code == 403


class TestChatSessionScoping:
    def test_sessions_scoped_to_owner(self, api_client):
        alice = _make_user("alice")
        bob = _make_user("bob")

        api_client.force_authenticate(user=alice)
        r = api_client.post(BASE, {"title": "mine", "surface": "screen"}, format="json")
        assert r.status_code == 201, r.content
        sid = r.data["id"]

        r = api_client.get(BASE)
        assert sid in _ids(r)

        # Bob sees nothing of Alice's.
        api_client.force_authenticate(user=bob)
        assert _ids(api_client.get(BASE)) == []

    def test_retrieve_foreign_session_is_404(self, api_client):
        alice = _make_user("alice")
        bob = _make_user("bob")
        api_client.force_authenticate(user=alice)
        sid = api_client.post(BASE, {"title": "a"}, format="json").data["id"]

        api_client.force_authenticate(user=bob)
        assert api_client.get(f"{BASE}{sid}/").status_code == 404

    def test_delete_own_session(self, api_client):
        alice = _make_user("alice")
        api_client.force_authenticate(user=alice)
        sid = api_client.post(BASE, {"title": "a"}, format="json").data["id"]
        assert api_client.delete(f"{BASE}{sid}/").status_code == 204
        assert _ids(api_client.get(BASE)) == []

    def test_delete_foreign_session_is_404(self, api_client):
        alice = _make_user("alice")
        bob = _make_user("bob")
        api_client.force_authenticate(user=alice)
        sid = api_client.post(BASE, {"title": "a"}, format="json").data["id"]

        api_client.force_authenticate(user=bob)
        assert api_client.delete(f"{BASE}{sid}/").status_code == 404
        # Still there for the owner.
        api_client.force_authenticate(user=alice)
        assert api_client.get(f"{BASE}{sid}/").status_code == 200


class TestChatMessages:
    def test_append_round_trips_payload(self, api_client):
        user = _make_user("pilot")
        api_client.force_authenticate(user=user)
        sid = api_client.post(BASE, {}, format="json").data["id"]
        messages = [
            {"role": "user", "text": "who is N628TS?"},
            {
                "role": "assistant",
                "text": "A Gulfstream.",
                "steps": [{"tool": "lookup_airframe", "args": {"icao_hex": "A835AF"}}],
                "sources": [{"icao_hex": "A835AF", "registration": "N628TS"}],
                "photos": [{"src": "/api/v1/photos/A835AF", "alt": "N628TS"}],
                "maps": [],
            },
        ]
        r = api_client.post(f"{BASE}{sid}/messages/", {"messages": messages}, format="json")
        assert r.status_code == 201, r.content

        r = api_client.get(f"{BASE}{sid}/")
        got = r.data["messages"]
        assert [m["role"] for m in got] == ["user", "assistant"]
        assert [m["seq"] for m in got] == [0, 1]
        asst = got[1]
        assert asst["text"] == "A Gulfstream."
        assert asst["steps"][0]["tool"] == "lookup_airframe"
        assert asst["sources"][0]["registration"] == "N628TS"
        assert asst["photos"][0]["src"] == "/api/v1/photos/A835AF"

    def test_title_derived_from_first_user_message(self, api_client):
        user = _make_user("pilot")
        api_client.force_authenticate(user=user)
        sid = api_client.post(BASE, {}, format="json").data["id"]
        api_client.post(
            f"{BASE}{sid}/messages/",
            {"messages": [{"role": "user", "text": "first question here"}]},
            format="json",
        )
        r = api_client.get(f"{BASE}{sid}/")
        assert r.data["title"] == "first question here"

    def test_append_continues_seq_across_calls(self, api_client):
        user = _make_user("pilot")
        api_client.force_authenticate(user=user)
        sid = api_client.post(BASE, {}, format="json").data["id"]
        for turn in ("one", "two"):
            api_client.post(
                f"{BASE}{sid}/messages/",
                {"messages": [{"role": "user", "text": turn}]},
                format="json",
            )
        r = api_client.get(f"{BASE}{sid}/")
        assert [m["seq"] for m in r.data["messages"]] == [0, 1]

    def test_append_to_foreign_session_is_404(self, api_client):
        alice = _make_user("alice")
        bob = _make_user("bob")
        api_client.force_authenticate(user=alice)
        sid = api_client.post(BASE, {}, format="json").data["id"]

        api_client.force_authenticate(user=bob)
        r = api_client.post(
            f"{BASE}{sid}/messages/",
            {"messages": [{"role": "user", "text": "x"}]},
            format="json",
        )
        assert r.status_code == 404
