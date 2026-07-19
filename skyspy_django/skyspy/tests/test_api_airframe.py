"""
API tests for AirframeViewSet "seen" endpoints.

Covers:
- GET /api/v1/airframes/seen-types/  (per-type distinct-tail counts, seen-gated)
- GET /api/v1/airframes/seen/?type=  (paginated tails of a type, newest first)
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from skyspy.models import AircraftInfo, AircraftSession


def _mk(icao, *, type_code=None, registration=None, operator=None, seen=True, last_seen=None):
    """Create an AircraftInfo (+ optional session so it counts as 'seen')."""
    info = AircraftInfo.objects.create(
        icao_hex=icao,
        type_code=type_code or "",
        registration=registration or "",
        operator=operator or "",
    )
    if seen:
        session = AircraftSession.objects.create(icao_hex=icao)
        # last_seen is auto_now=True, so it can't be set on create — force it via
        # a bare UPDATE (which does not trigger auto_now) to simulate recency.
        if last_seen is not None:
            AircraftSession.objects.filter(pk=session.pk).update(last_seen=last_seen)
    return info


@pytest.mark.django_db
class TestSeenTypes:
    def test_empty(self, api_client):
        resp = api_client.get("/api/v1/airframes/seen-types/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.json() == {"types": {}}

    def test_counts_distinct_seen_tails(self, api_client):
        _mk("A00001", type_code="B738", registration="N1AA")
        _mk("A00002", type_code="B738", registration="N2AA")
        _mk("A00003", type_code="A320", registration="N3AA")
        resp = api_client.get("/api/v1/airframes/seen-types/")
        types = resp.json()["types"]
        assert types == {"B738": 2, "A320": 1}

    def test_unseen_type_excluded(self, api_client):
        # Cached info but never tracked (no session) -> must not appear.
        _mk("A00009", type_code="B744", registration="N9ZZ", seen=False)
        resp = api_client.get("/api/v1/airframes/seen-types/")
        assert "B744" not in resp.json()["types"]

    def test_hours_window_filters_by_recency(self, api_client):
        now = timezone.now()
        _mk("A00007", type_code="B738", registration="NRECENT", last_seen=now)
        _mk("A00008", type_code="A320", registration="NOLD", last_seen=now - timedelta(hours=48))
        # 24h window: only the recent B738 tail counts; the 48h-old A320 drops out.
        resp = api_client.get("/api/v1/airframes/seen-types/?hours=24")
        types = resp.json()["types"]
        assert types == {"B738": 1}
        # all-time keeps both.
        resp_all = api_client.get("/api/v1/airframes/seen-types/?hours=all")
        assert resp_all.json()["types"] == {"B738": 1, "A320": 1}

    def test_blank_type_excluded(self, api_client):
        _mk("A0000A", type_code="", registration="N0AA")
        assert resp_types(api_client) == {}


def resp_types(api_client):
    return api_client.get("/api/v1/airframes/seen-types/").json()["types"]


@pytest.mark.django_db
class TestSeenTails:
    def test_requires_type(self, api_client):
        resp = api_client.get("/api/v1/airframes/seen/")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_seen_tail(self, api_client):
        _mk("A00010", type_code="B738", registration="N10AA", operator="United")
        resp = api_client.get("/api/v1/airframes/seen/?type=B738")
        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()
        assert data["count"] == 1
        assert data["next_offset"] is None
        row = data["results"][0]
        assert row["icao_hex"] == "A00010"
        assert row["registration"] == "N10AA"
        assert row["operator"] == "United"
        assert row["times_seen"] == 1

    def test_type_is_case_insensitive(self, api_client):
        _mk("A00011", type_code="B738", registration="N11AA")
        resp = api_client.get("/api/v1/airframes/seen/?type=b738")
        assert resp.json()["count"] == 1

    def test_unseen_tail_excluded(self, api_client):
        _mk("A00012", type_code="B738", registration="N12AA", seen=False)
        resp = api_client.get("/api/v1/airframes/seen/?type=B738")
        assert resp.json()["count"] == 0

    def test_newest_first_ordering(self, api_client):
        now = timezone.now()
        _mk("A00013", type_code="B738", registration="OLD", last_seen=now - timedelta(days=3))
        _mk("A00014", type_code="B738", registration="NEW", last_seen=now)
        resp = api_client.get("/api/v1/airframes/seen/?type=B738")
        regs = [r["registration"] for r in resp.json()["results"]]
        assert regs == ["NEW", "OLD"]

    def test_pagination(self, api_client):
        now = timezone.now()
        for i in range(3):
            _mk(f"A001{i:02d}", type_code="A320", registration=f"N{i}", last_seen=now - timedelta(minutes=i))
        resp = api_client.get("/api/v1/airframes/seen/?type=A320&limit=2&offset=0")
        data = resp.json()
        assert data["count"] == 3
        assert len(data["results"]) == 2
        assert data["next_offset"] == 2

        resp2 = api_client.get("/api/v1/airframes/seen/?type=A320&limit=2&offset=2")
        data2 = resp2.json()
        assert len(data2["results"]) == 1
        assert data2["next_offset"] is None

    def test_hours_window_filters_tails(self, api_client):
        now = timezone.now()
        _mk("A00030", type_code="B738", registration="NNEW", last_seen=now)
        _mk("A00031", type_code="B738", registration="NOLD", last_seen=now - timedelta(hours=48))
        resp = api_client.get("/api/v1/airframes/seen/?type=B738&hours=24")
        data = resp.json()
        assert data["count"] == 1
        assert data["results"][0]["registration"] == "NNEW"

    def test_times_seen_counts_sessions(self, api_client):
        _mk("A00020", type_code="B738", registration="N20AA")
        AircraftSession.objects.create(icao_hex="A00020", last_seen=timezone.now())
        resp = api_client.get("/api/v1/airframes/seen/?type=B738")
        assert resp.json()["results"][0]["times_seen"] == 2


@pytest.mark.django_db
class TestByRegistration:
    """GET /api/v1/airframes/registration/<reg>/ — resolve a tail to airframe info."""

    def test_single_match(self, api_client):
        _mk("FADE01", type_code="B748", registration="N111ZY", seen=False)
        resp = api_client.get("/api/v1/airframes/registration/N111ZY/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.json()["icao_hex"] == "FADE01"

    def test_duplicate_rows_do_not_500_and_prefer_real_hex(self, api_client):
        # Two rows share the tail: one real Mode-S hex, one placeholder row whose
        # icao_hex is the registration itself. get() would raise
        # MultipleObjectsReturned (500) — the endpoint must pick the real hex.
        _mk("FADE02", type_code="B748", registration="N111ZX", seen=False)
        _mk("N111ZX", type_code="B748", registration="N111ZX", seen=False)
        resp = api_client.get("/api/v1/airframes/registration/N111ZX/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.json()["icao_hex"] == "FADE02"

    def test_unseen_us_nnumber_falls_back_to_derived_hex(self, api_client):
        # Never-seen valid US N-number: no DB row, derive the hex so the airframe
        # page can still open.
        resp = api_client.get("/api/v1/airframes/registration/N998ZY/")
        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()
        assert data["source"] == "n-number"
        assert data["icao_hex"]

    def test_unknown_non_us_registration_404s(self, api_client):
        resp = api_client.get("/api/v1/airframes/registration/ZZZZZZ/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
