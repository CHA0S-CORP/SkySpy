"""
API tests for the AviationViewSet turbulence endpoints.
"""

from django.core.cache import cache

from skyspy.tasks.turbulence import CACHE_KEY_BY_HEX


def test_turbulence_point_requires_coords(api_client):
    resp = api_client.get("/api/v1/aviation/turbulence/")
    assert resp.status_code == 400


def test_turbulence_point(api_client, monkeypatch):
    monkeypatch.setattr(
        "skyspy.services.turbulence.assess_turbulence",
        lambda lat, lon, alt: {
            "score": 55,
            "level": "moderate",
            "sources": {"gairmet": [], "pireps": [], "winds": None},
        },
    )
    resp = api_client.get("/api/v1/aviation/turbulence/", {"lat": 40.0, "lon": -100.0, "alt": 35000})
    assert resp.status_code == 200
    body = resp.json()
    assert body["score"] == 55
    assert body["level"] == "moderate"


def test_turbulence_aircraft_map(api_client):
    cache.set(CACHE_KEY_BY_HEX, {"ABC123": {"score": 80, "level": "severe"}})
    resp = api_client.get("/api/v1/aviation/turbulence/aircraft/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["aircraft"]["ABC123"]["level"] == "severe"


def test_turbulence_advisories(api_client, db):
    from django.utils import timezone

    from skyspy.models import AirspaceAdvisory

    now = timezone.now()
    AirspaceAdvisory.objects.create(
        advisory_id="T1",
        advisory_type="GAIRMET",
        hazard="TURB-LO",
        valid_from=now - timezone.timedelta(hours=1),
        valid_to=now + timezone.timedelta(hours=1),
        polygon={"type": "Polygon", "coordinates": [[[-101, 39], [-99, 39], [-99, 41], [-101, 41], [-101, 39]]]},
    )
    # A non-turbulence advisory that must be excluded.
    AirspaceAdvisory.objects.create(
        advisory_id="I1",
        advisory_type="GAIRMET",
        hazard="ICE",
        valid_from=now - timezone.timedelta(hours=1),
        valid_to=now + timezone.timedelta(hours=1),
    )
    resp = api_client.get("/api/v1/aviation/turbulence/advisories/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["advisories"][0]["hazard"] == "TURB-LO"
