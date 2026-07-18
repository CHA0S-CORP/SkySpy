"""
Tests for the generic RAG index (services/rag.py) and its assistant tools.

Covers the per-source document builders, the embed/upsert status flow (with
embeddings mocked, since the test settings disable the LLM), pgvector search,
and the semantic_* tool wiring.
"""

import json
from datetime import timedelta

import pytest
from django.conf import settings
from django.utils import timezone

from skyspy.models import AcarsMessage, CachedNotam, CachedPirep, RagDocument
from skyspy.services import rag
from skyspy.services.assistant import tools


def _vec(seed: float = 0.1):
    """A deterministic embedding vector of the configured dimension."""
    return [seed] * settings.EMBEDDING_DIM


def _make_acars(**kw):
    defaults = {
        "source": "acars",
        "icao_hex": "A1B2C3",
        "registration": "N123AB",
        "callsign": "UAL123",
        "label": "5Z",
        "text": "ENGINE FUEL FLOW ANOMALY, REQUEST DIVERSION",
    }
    defaults.update(kw)
    return AcarsMessage.objects.create(**defaults)


def _make_notam(**kw):
    defaults = {
        "notam_id": "KLAX-A0123/24",
        "notam_type": "D",
        "location": "KLAX",
        "reason": "RWY CLSD",
        "effective_start": timezone.now(),
        "effective_end": timezone.now() + timedelta(days=2),
        "text": "RWY 07L/25R CLSD DUE TO CONSTRUCTION",
    }
    defaults.update(kw)
    return CachedNotam.objects.create(**defaults)


def _make_pirep(**kw):
    defaults = {
        "pirep_id": "PIREP-1",
        "report_type": "UUA",
        "location": "KSEA",
        "latitude": 47.5,
        "longitude": -122.3,
        "observation_time": timezone.now(),
        "flight_level": 350,
        "turbulence_type": "SEV",
    }
    defaults.update(kw)
    return CachedPirep.objects.create(**defaults)


# =============================================================================
# Document builders
# =============================================================================


@pytest.mark.django_db
def test_acars_text_and_metadata():
    msg = _make_acars()
    text, title, meta = rag._acars_text(msg)
    assert "ACARS message" in title
    assert "DIVERSION" in text
    assert meta["icao_hex"] == "A1B2C3"
    assert meta["callsign"] == "UAL123"
    assert meta["label"] == "5Z"


@pytest.mark.django_db
def test_notam_text_and_metadata():
    notam = _make_notam()
    text, title, meta = rag._notam_text(notam)
    assert "KLAX" in title
    assert "CLSD" in text
    assert meta["notam_id"] == "KLAX-A0123/24"
    assert meta["location"] == "KLAX"


@pytest.mark.django_db
def test_pirep_text_and_metadata():
    pirep = _make_pirep()
    text, title, meta = rag._pirep_text(pirep)
    assert "PIREP" in title
    assert meta["pirep_id"] == "PIREP-1"
    assert "turbulence" in (meta["hazards"] or [])


# =============================================================================
# Upsert / embedding status flow
# =============================================================================


@pytest.mark.django_db
def test_index_stores_without_embedding_when_llm_disabled():
    # Test settings disable the LLM, so embed() returns None.
    msg = _make_acars()
    status = rag.index_acars_message(msg)
    assert status == "stored_no_embedding"
    doc = RagDocument.objects.get(kind="acars", ref_id=str(msg.pk))
    assert doc.embedding is None
    assert doc.metadata["callsign"] == "UAL123"


@pytest.mark.django_db
def test_index_embeds_and_skips_unchanged(monkeypatch):
    monkeypatch.setattr(rag.llm_client, "embed", lambda texts: [_vec()])
    msg = _make_acars()

    assert rag.index_acars_message(msg) == "indexed"
    doc = RagDocument.objects.get(kind="acars", ref_id=str(msg.pk))
    assert doc.embedding is not None

    # Re-index unchanged text: no re-embed.
    assert rag.index_acars_message(msg) == "unchanged"
    assert RagDocument.objects.filter(kind="acars").count() == 1


@pytest.mark.django_db
def test_empty_text_returns_empty():
    # An ACARS message always carries a header, so the empty guard is exercised
    # directly: blank text stores nothing.
    assert rag._upsert("acars", "999", "   ") == "empty"
    assert not RagDocument.objects.filter(kind="acars", ref_id="999").exists()


@pytest.mark.django_db
def test_notam_and_pirep_index(monkeypatch):
    monkeypatch.setattr(rag.llm_client, "embed", lambda texts: [_vec()])
    assert rag.index_notam(_make_notam()) == "indexed"
    assert rag.index_pirep(_make_pirep()) == "indexed"
    assert RagDocument.objects.filter(kind="notam").count() == 1
    assert RagDocument.objects.filter(kind="pirep").count() == 1


def _make_safety(**kw):
    from skyspy.models import SafetyEvent

    defaults = {
        "event_type": "proximity",
        "severity": "warning",
        "icao_hex": "A1B2C3",
        "callsign": "UAL123",
        "message": "Proximity conflict — 0.8nm closest approach",
        "cpa_distance_nm": 0.8,
    }
    defaults.update(kw)
    return SafetyEvent.objects.create(**defaults)


def _make_incident(**kw):
    from skyspy.models import AircraftIncident

    defaults = {
        "registration": "N123AB",
        "icao_hex": "A1B2C3",
        "source": "ntsb",
        "external_id": "WPR24LA100",
        "event_type": "Accident",
        "severity": "Substantial",
        "city": "Van Nuys",
        "state": "CA",
        "narrative": "Gear collapse on landing, no injuries.",
    }
    defaults.update(kw)
    return AircraftIncident.objects.create(**defaults)


@pytest.mark.django_db
def test_safety_and_incident_index(monkeypatch):
    monkeypatch.setattr(rag.llm_client, "embed", lambda texts: [_vec()])
    assert rag.index_safety_event(_make_safety()) == "indexed"
    assert rag.index_incident(_make_incident()) == "indexed"
    assert RagDocument.objects.filter(kind="safety").count() == 1
    assert RagDocument.objects.filter(kind="incident").count() == 1


@pytest.mark.django_db
def test_multi_kind_search_and_norm_kinds(monkeypatch):
    monkeypatch.setattr(rag.llm_client, "embed", lambda texts: [_vec()])
    rag.index_safety_event(_make_safety())
    rag.index_incident(_make_incident())
    rag.index_notam(_make_notam())
    # Comma-separated kind scopes to just safety + incident.
    hits = rag.search("anything", kind="safety,incident", k=10)
    assert {h["kind"] for h in hits} == {"safety", "incident"}
    assert rag._norm_kinds("safety,incident") == ["safety", "incident"]
    assert rag._norm_kinds(None) == []
    assert rag._norm_kinds(["a", "b"]) == ["a", "b"]


# =============================================================================
# Search
# =============================================================================


@pytest.mark.django_db
def test_search_keyword_fallback_without_embeddings():
    msg = _make_acars(text="ENGINE FUEL FLOW ANOMALY, REQUEST DIVERSION")
    # embed() returns None (LLM disabled) -> keyword fallback over source text.
    hits = rag.search("engine diversion", kind="acars", k=5)
    assert len(hits) == 1
    assert hits[0]["match"] == "keyword"
    assert hits[0]["ref_id"] == str(msg.pk)


@pytest.mark.django_db
def test_keyword_fallback_no_matching_terms_returns_empty():
    _make_acars(text="ENGINE FUEL FLOW ANOMALY")
    assert rag.search("zzz nonexistent tokens", kind="acars") == []


@pytest.mark.django_db
def test_search_empty_query_returns_empty():
    _make_acars()
    assert rag.search("   ") == []


@pytest.mark.django_db
def test_search_returns_hit_and_filters_by_kind(monkeypatch):
    monkeypatch.setattr(rag.llm_client, "embed", lambda texts: [_vec()])
    msg = _make_acars()
    rag.index_acars_message(msg)
    rag.index_notam(_make_notam())

    hits = rag.search("engine fault", kind="acars", k=5)
    assert len(hits) == 1
    assert hits[0]["kind"] == "acars"
    assert hits[0]["ref_id"] == str(msg.pk)
    assert "similarity" in hits[0]

    # Unfiltered search sees both kinds.
    assert len(rag.search("anything", k=10)) == 2


# =============================================================================
# Tool wiring
# =============================================================================


def test_semantic_tools_registered():
    names = {fn.__name__ for fn in tools.TOOL_FUNCS}
    assert {
        "semantic_acars_search",
        "semantic_notam_search",
        "semantic_pirep_search",
        "semantic_event_search",
    } <= names


def test_semantic_event_tool_scopes_to_safety_and_incident(monkeypatch):
    captured = {}

    def fake_search(query, kind=None, k=5):
        captured["kind"] = kind
        return []

    monkeypatch.setattr("skyspy.services.rag.search", fake_search)
    tools.semantic_event_search("prior accidents", k=3)
    assert captured["kind"] == "safety,incident"


def test_semantic_acars_tool_calls_rag(monkeypatch):
    captured = {}

    def fake_search(query, kind=None, k=5):
        captured["kind"] = kind
        return [{"kind": kind, "ref_id": "7", "title": "t", "similarity": 0.9}]

    monkeypatch.setattr("skyspy.services.rag.search", fake_search)
    out = json.loads(tools.semantic_notam_search("runway closures", k=3))
    assert captured["kind"] == "notam"
    assert out["count"] == 1
    assert out["results"][0]["ref_id"] == "7"
