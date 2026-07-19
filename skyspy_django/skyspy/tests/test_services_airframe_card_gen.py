"""
Tests for auto-generated airframe type cards:
- archetype/shape coercion (the premade diagram sketch guard)
- LLM card generation validation
- new-type discovery gating
- the /airframes/type-cards/ endpoint payload
"""

import json
from unittest.mock import patch

import pytest

from skyspy.models import AircraftInfo, AircraftSession, AirframeTypeCard
from skyspy.services import airframe_archetypes as arch
from skyspy.services import airframe_card_gen as gen
from skyspy.services import web_search


# --------------------------------------------------------------------------- #
# Archetype / shape coercion — never emit an unrenderable descriptor
# --------------------------------------------------------------------------- #
def test_named_archetype_expands_to_full_shape():
    shape = arch.coerce_shape(None, archetype="narrowbody_twin_jet")
    assert shape["kind"] == "jet"
    assert shape["engines"] == 2
    assert shape["mount"] == "wing"


def test_unknown_kind_falls_back_to_category_default():
    shape = arch.coerce_shape({"kind": "spaceship"}, category="rotor")
    assert shape["kind"] == "heli"  # rotor default archetype


def test_no_hint_at_all_still_renderable():
    shape = arch.coerce_shape(None)
    assert shape["kind"] in arch.KINDS


def test_loose_shape_is_snapped_and_clamped():
    shape = arch.coerce_shape(
        {"kind": "jet", "engines": 99, "mount": "bogus", "tail": "bogus", "sweep": 999, "wing": "low"}
    )
    assert shape["kind"] == "jet"
    assert 0 <= shape["engines"] <= 4
    assert shape["mount"] in arch.MOUNTS
    assert shape["tail"] in arch.TAILS
    assert shape["sweep"] <= 55
    assert shape["wing"] == "low"


def test_heli_shape_only_keeps_blades():
    shape = arch.coerce_shape({"kind": "heli", "blades": 4})
    assert shape == {"kind": "heli", "blades": 4}


def test_archetype_menu_lists_ids():
    menu = arch.archetype_menu()
    assert "narrowbody_twin_jet" in menu
    assert "heli_medium_4blade" in menu


# --------------------------------------------------------------------------- #
# JSON parsing robustness
# --------------------------------------------------------------------------- #
def test_parse_json_handles_fences_and_junk():
    raw = 'Here you go:\n```json\n{"name": "X", "length_m": 30}\n```\nthanks'
    assert gen._parse_json(raw) == {"name": "X", "length_m": 30}


def test_parse_json_returns_none_on_garbage():
    assert gen._parse_json("not json at all") is None


# --------------------------------------------------------------------------- #
# Card generation (LLM mocked)
# --------------------------------------------------------------------------- #
def _fake_llm(payload: dict):
    return {"content": json.dumps(payload)}


@pytest.mark.django_db
def test_generate_card_validates_and_snaps():
    payload = {
        "known": True,
        "name": "SuperJet 100",
        "manufacturer": "Sukhoi",
        "category": "regional",
        "role": "98 pax",
        "length_m": 29.9,
        "span_m": 27.8,
        "height_m": 10.3,
        "mtow_kg": 45880,
        "cruise_kt": 470,
        "range_nm": 1645,
        "ceiling_ft": 40000,
        "first_flight": 2008,
        "archetype": "regional_jet_aft",
        "blurb": "Russian regional jet.",
        "powerplant": "2 × PowerJet SaM146",
        "wtc": "M — Medium",
        "confidence": 0.8,
    }
    with (
        patch.object(gen.llm_client, "is_available", return_value=True),
        patch.object(gen.llm_client, "complete", return_value=_fake_llm(payload)),
    ):
        card = gen.generate_card("SU95")

    assert card["type_code"] == "SU95"
    assert card["category"] == "regional"
    assert card["status"] == "generated"
    assert card["shape"]["mount"] == "aft"  # from the regional_jet_aft archetype
    assert card["mtow_kg"] == 45880


@pytest.mark.django_db
def test_generate_card_grounds_on_web_and_fetches_photo():
    payload = {
        "known": True,
        "name": "Novel 100",
        "manufacturer": "Acme",
        "category": "regional",
        "archetype": "regional_jet_aft",
        "confidence": 0.85,
    }
    ctx = {
        "text": "[Acme Novel 100 — https://en.wikipedia.org/wiki/Acme_Novel_100]\nA regional jet.",
        "sources": [{"title": "Acme Novel 100", "url": "https://en.wikipedia.org/wiki/Acme_Novel_100"}],
        "image": {
            "url": "https://upload.wikimedia.org/x/960px-Novel.jpg",
            "full": "https://upload.wikimedia.org/x/Novel.jpg",
            "page": "https://en.wikipedia.org/wiki/Acme_Novel_100",
            "credit": "Wikipedia / Wikimedia Commons",
        },
    }
    with (
        patch.object(gen.llm_client, "is_available", return_value=True),
        patch.object(gen.llm_client, "complete", return_value=_fake_llm(payload)),
        patch.object(gen.web_search, "is_enabled", return_value=True),
        patch.object(gen.web_search, "gather_airframe_context", return_value=ctx) as mock_ctx,
        patch.object(gen, "_cache_type_photo", return_value=True) as mock_cache,
    ):
        card = gen.generate_card("NOVL")

    mock_ctx.assert_called_once()  # web search actually ran
    mock_cache.assert_called_once()  # photo fetch actually ran
    assert card["photo_cached"] is True
    assert card["photo_url"] == "https://upload.wikimedia.org/x/960px-Novel.jpg"
    assert card["photo_credit"] == "Wikipedia / Wikimedia Commons"
    assert card["sources"] == ctx["sources"]
    # cached type photo means we don't also pin a seen-tail hex
    assert card["photo_icao_hex"] is None


@pytest.mark.django_db
def test_generate_card_falls_back_to_tail_photo_without_image():
    payload = {"known": True, "name": "X", "category": "ga", "archetype": "ga_single_high", "confidence": 0.8}
    AircraftInfo.objects.create(icao_hex="EEE001", type_code="XYZ1", photo_local_path="/data/photos/EEE001.jpg")
    with (
        patch.object(gen.llm_client, "is_available", return_value=True),
        patch.object(gen.llm_client, "complete", return_value=_fake_llm(payload)),
        patch.object(gen.web_search, "is_enabled", return_value=True),
        patch.object(
            gen.web_search, "gather_airframe_context", return_value={"text": "", "sources": [], "image": None}
        ),
    ):
        card = gen.generate_card("XYZ1")
    assert card["photo_cached"] is False
    assert card["photo_icao_hex"] == "EEE001"


@pytest.mark.django_db
def test_generate_card_low_confidence_is_stub():
    payload = {"known": False, "name": "Mystery", "category": "ga", "confidence": 0.1}
    with (
        patch.object(gen.llm_client, "is_available", return_value=True),
        patch.object(gen.llm_client, "complete", return_value=_fake_llm(payload)),
    ):
        card = gen.generate_card("ZZZZ")
    assert card["status"] == "stub"
    assert card["shape"]["kind"] in arch.KINDS


@pytest.mark.django_db
def test_generate_card_none_when_llm_unavailable():
    with patch.object(gen.llm_client, "is_available", return_value=False):
        assert gen.generate_card("B738") is None


@pytest.mark.django_db
def test_generate_card_bad_number_dropped():
    payload = {
        "known": True,
        "name": "X",
        "category": "ga",
        "length_m": "not-a-number",
        "mtow_kg": 999999999,  # over cap → dropped
        "cruise_kt": 120,
        "archetype": "ga_single_high",
        "confidence": 0.9,
    }
    with (
        patch.object(gen.llm_client, "is_available", return_value=True),
        patch.object(gen.llm_client, "complete", return_value=_fake_llm(payload)),
    ):
        card = gen.generate_card("XYZ1")
    assert card["length_m"] is None
    assert card["mtow_kg"] is None
    assert card["cruise_kt"] == 120


# --------------------------------------------------------------------------- #
# Web search
# --------------------------------------------------------------------------- #
def test_scale_commons_thumb_rewrites_width():
    url = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/Jet.jpg/330px-Jet.jpg"
    assert "/960px-" in web_search._scale_commons_thumb(url, 960)


def test_search_disabled_returns_empty(settings):
    settings.WEB_SEARCH_ENABLED = False
    assert web_search.search("anything") == []


def test_gather_airframe_context_from_wikipedia(settings):
    settings.WEB_SEARCH_ENABLED = True
    settings.WEB_SEARCH_PROVIDER = "wikipedia"

    def fake_get_json(url, **kwargs):
        if "list=search" in url or kwargs.get("params", {}).get("list") == "search":
            return {"query": {"search": [{"title": "Sukhoi Superjet 100"}]}}
        # REST summary
        return {
            "title": "Sukhoi Superjet 100",
            "extract": "A regional jet made by Sukhoi.",
            "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Sukhoi_Superjet_100"}},
            "thumbnail": {"source": "https://upload.wikimedia.org/x/330px-SSJ.jpg"},
            "originalimage": {"source": "https://upload.wikimedia.org/x/SSJ.jpg"},
        }

    with patch.object(web_search.http_client, "get_json", side_effect=fake_get_json):
        ctx = web_search.gather_airframe_context("SU95", {"manufacturer": "Sukhoi", "model": "Superjet 100"})

    assert "regional jet" in ctx["text"].lower()
    assert ctx["sources"] and ctx["sources"][0]["url"].endswith("Sukhoi_Superjet_100")
    assert ctx["image"]["url"].startswith("https://upload.wikimedia.org/")
    assert "960px" in ctx["image"]["url"]


# --------------------------------------------------------------------------- #
# Discovery gating
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_discover_excludes_curated_and_existing():
    # A curated type (B738) — must never be a candidate.
    AircraftSession.objects.create(icao_hex="AAA001")
    AircraftInfo.objects.create(icao_hex="AAA001", type_code="B738", manufacturer="Boeing")

    # A novel type with 2 tails — should surface.
    for hx in ("BBB001", "BBB002"):
        AircraftSession.objects.create(icao_hex=hx)
        AircraftInfo.objects.create(icao_hex=hx, type_code="NOVL", manufacturer="Acme")

    # A type that already has a card — excluded.
    AircraftSession.objects.create(icao_hex="CCC001")
    AircraftInfo.objects.create(icao_hex="CCC001", type_code="DONE", manufacturer="Done")
    AirframeTypeCard.objects.create(type_code="DONE")

    found = {c["type_code"]: c for c in gen.discover_new_types(limit=10, min_tails=1)}
    assert "NOVL" in found
    assert found["NOVL"]["tail_count"] == 2
    assert "B738" not in found
    assert "DONE" not in found


@pytest.mark.django_db
def test_discover_respects_min_tails():
    AircraftSession.objects.create(icao_hex="DDD001")
    AircraftInfo.objects.create(icao_hex="DDD001", type_code="RARE", manufacturer="Acme")
    assert gen.discover_new_types(limit=10, min_tails=2) == []


# --------------------------------------------------------------------------- #
# Endpoint
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_generate_endpoint_rejects_bad_type(api_client):
    resp = api_client.post("/api/v1/airframes/type-cards/generate/", {"type": "!!"}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_generate_endpoint_503_when_llm_unavailable(api_client):
    with patch("skyspy.services.llm.llm_client.is_available", return_value=False):
        resp = api_client.post("/api/v1/airframes/type-cards/generate/", {"type": "SU95"}, format="json")
    assert resp.status_code == 503


@pytest.mark.django_db
def test_generate_endpoint_409_when_exists(api_client):
    AirframeTypeCard.objects.create(type_code="SU95")
    with patch("skyspy.services.llm.llm_client.is_available", return_value=True):
        resp = api_client.post("/api/v1/airframes/type-cards/generate/", {"type": "SU95"}, format="json")
    assert resp.status_code == 409


@pytest.mark.django_db
def test_generate_endpoint_queues_202(api_client):
    with (
        patch("skyspy.services.llm.llm_client.is_available", return_value=True),
        patch("skyspy.tasks.airframe_cards.generate_airframe_type_card.delay") as mock_delay,
    ):
        resp = api_client.post("/api/v1/airframes/type-cards/generate/", {"type": "su95"}, format="json")
    assert resp.status_code == 202
    assert resp.json()["type_code"] == "SU95"
    mock_delay.assert_called_once_with("SU95")


@pytest.mark.django_db
def test_generate_endpoint_409_for_curated_type(api_client):
    with patch("skyspy.services.llm.llm_client.is_available", return_value=True):
        resp = api_client.post("/api/v1/airframes/type-cards/generate/", {"type": "B738"}, format="json")
    assert resp.status_code == 409


@pytest.mark.django_db
def test_type_cards_endpoint_shape(api_client):
    AirframeTypeCard.objects.create(
        type_code="NOVL",
        name="Novel 100",
        manufacturer="Acme",
        category="regional",
        role="90 pax",
        length_m=30,
        span_m=28,
        shape={"kind": "jet", "engines": 2, "mount": "aft", "tail": "t", "sweep": 24},
        confidence=0.7,
        status="generated",
    )
    AirframeTypeCard.objects.create(type_code="FAIL", status="failed")

    resp = api_client.get("/api/v1/airframes/type-cards/")
    assert resp.status_code == 200
    cards = resp.json()["cards"]
    ids = {c["id"] for c in cards}
    assert "NOVL" in ids
    assert "FAIL" not in ids  # failed rows are hidden
    novl = next(c for c in cards if c["id"] == "NOVL")
    assert novl["generated"] is True
    assert novl["mfr"] == "Acme"
    assert novl["shape"]["mount"] == "aft"
