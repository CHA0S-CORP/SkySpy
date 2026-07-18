"""
Generic RAG index over non-airframe sources (ACARS, NOTAMs, PIREPs, ...).

Companion to ``airframe_rag`` (which owns the per-airframe dossier index). This
module embeds one ``RagDocument`` per source row and exposes a single vector
``search`` path, optionally scoped to a ``kind``.

Flow per source:
- ``index_acars_message`` / ``index_notam`` / ``index_pirep`` build the compact
  document text + metadata and hand it to ``_upsert`` (skips re-embedding when
  the text is unchanged).
- ``search(query, kind=None, k=5)`` embeds the query and returns the nearest
  documents by cosine distance (pgvector).

Everything degrades gracefully when embeddings are not configured: ``_upsert``
still stores the text (embedding stays null) and ``search`` returns [].
"""

import hashlib
import logging
import re

from django.conf import settings

from skyspy.services.acars_decoder import get_label_name
from skyspy.services.llm import llm_client

logger = logging.getLogger(__name__)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _norm_kinds(kind) -> list[str]:
    """Normalize a kind filter into a clean list. Accepts None (all), a single
    kind, a comma-separated string ('safety,incident'), or a list."""
    if not kind:
        return []
    if isinstance(kind, str):
        return [k.strip() for k in kind.split(",") if k.strip()]
    return [str(k).strip() for k in kind if str(k).strip()]


def _upsert(kind: str, ref_id: str, text: str, *, title: str = "", metadata: dict | None = None, force: bool = False):
    """Embed + upsert one document. Returns a status string."""
    from skyspy.models import RagDocument

    text = (text or "").strip()
    if not text:
        return "empty"

    content_hash = _hash(text)
    existing = RagDocument.objects.filter(kind=kind, ref_id=str(ref_id)).first()
    if existing and existing.content_hash == content_hash and existing.embedding is not None and not force:
        return "unchanged"

    embedding = None
    model = None
    vectors = llm_client.embed([text])
    if vectors:
        embedding = vectors[0]
        model = getattr(settings, "EMBEDDING_MODEL", None)

    RagDocument.objects.update_or_create(
        kind=kind,
        ref_id=str(ref_id),
        defaults={
            "title": (title or "")[:200] or None,
            "content": text,
            "content_hash": content_hash,
            "metadata": metadata or {},
            "embedding": embedding,
            "embedding_model": model,
        },
    )
    return "indexed" if embedding is not None else "stored_no_embedding"


# =============================================================================
# Per-source document builders
# =============================================================================


def _acars_text(msg) -> tuple[str, str, dict]:
    """(text, title, metadata) for one AcarsMessage."""
    label = msg.label or ""
    label_name = get_label_name(label) if label else ""
    ident = " ".join(dict.fromkeys(x for x in (msg.callsign, msg.registration, msg.icao_hex) if x))
    header = f"{msg.source.upper()} ACARS message"
    if label:
        header += f" label {label}" + (f" ({label_name})" if label_name and label_name != label else "")
    if ident:
        header += f" from {ident}"

    parts = [header]
    if msg.text:
        parts.append(msg.text.strip())
    # Fold any human-readable decoded fields in so semantics beat the raw body.
    if isinstance(msg.decoded, dict):
        summary = msg.decoded.get("human_readable") or msg.decoded.get("summary") or msg.decoded.get("description")
        if summary:
            parts.append(str(summary))
    text = "\n".join(parts)
    metadata = {
        "icao_hex": msg.icao_hex,
        "registration": msg.registration,
        "callsign": msg.callsign,
        "label": label or None,
        "source": msg.source,
        "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
    }
    return text, header, metadata


def _notam_text(notam) -> tuple[str, str, dict]:
    """(text, title, metadata) for one CachedNotam."""
    title = f"{notam.get_notam_type_display()} at {notam.location}"
    if notam.reason:
        title += f" — {notam.reason}"
    parts = [title, notam.text or notam.raw_text or ""]
    text = "\n".join(p for p in parts if p)
    metadata = {
        "notam_id": notam.notam_id,
        "notam_type": notam.notam_type,
        "location": notam.location,
        "reason": notam.reason,
        "effective_start": notam.effective_start.isoformat() if notam.effective_start else None,
        "effective_end": notam.effective_end.isoformat() if notam.effective_end else None,
    }
    return text, title, metadata


def _pirep_text(pirep) -> tuple[str, str, dict]:
    """(text, title, metadata) for one CachedPirep."""
    from skyspy.services import pirep_decoder

    decoded = pirep_decoder.decode_pirep(pirep)
    kind = "Urgent PIREP" if pirep.report_type == "UUA" else "PIREP"
    where = pirep.location or (f"{pirep.latitude},{pirep.longitude}" if pirep.latitude is not None else "unknown")
    title = f"{kind} near {where}"
    parts = [title, decoded.get("human_summary") or ""]
    hazards = decoded.get("hazards") or []
    if hazards:
        parts.append("Hazards: " + ", ".join(str(h) for h in hazards))
    text = "\n".join(p for p in parts if p)
    metadata = {
        "pirep_id": pirep.pirep_id,
        "location": pirep.location,
        "lat": pirep.latitude,
        "lon": pirep.longitude,
        "report_type": pirep.report_type,
        "flight_level": pirep.flight_level,
        "severity": decoded.get("severity"),
        "hazards": hazards,
        "observation_time": pirep.observation_time.isoformat() if pirep.observation_time else None,
    }
    return text, title, metadata


def _safety_text(event) -> tuple[str, str, dict]:
    """(text, title, metadata) for one SafetyEvent."""
    ident = " ".join(dict.fromkeys(x for x in (event.callsign, event.icao_hex) if x))
    if event.icao_hex_2:
        ident += f" & {event.callsign_2 or event.icao_hex_2}"
    title = f"{event.get_event_type_display()} ({event.severity})"
    if ident:
        title += f" — {ident}"
    parts = [title, event.message or ""]
    if event.cpa_distance_nm is not None:
        parts.append(f"Closest approach {event.cpa_distance_nm:.2f} nm in {event.cpa_time_seconds or '?'}s")
    text = "\n".join(p for p in parts if p)
    metadata = {
        "event_type": event.event_type,
        "severity": event.severity,
        "icao_hex": event.icao_hex,
        "icao_hex_2": event.icao_hex_2,
        "callsign": event.callsign,
        "cpa_distance_nm": event.cpa_distance_nm,
        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
    }
    return text, title, metadata


def _incident_text(inc) -> tuple[str, str, dict]:
    """(text, title, metadata) for one AircraftIncident (NTSB etc.)."""
    where = ", ".join(x for x in (inc.city, inc.state, inc.country) if x)
    when = inc.event_date.date().isoformat() if inc.event_date else "unknown date"
    craft = " ".join(x for x in (inc.make, inc.model) if x)
    title = f"{inc.source.upper()} {inc.event_type or 'event'} {inc.registration} ({when})"
    parts = [title]
    if craft or where:
        parts.append(" — ".join(x for x in (craft, where) if x))
    if inc.severity:
        parts.append(f"Severity: {inc.severity}")
    if inc.narrative:
        parts.append(inc.narrative.strip())
    text = "\n".join(p for p in parts if p)
    metadata = {
        "source": inc.source,
        "external_id": inc.external_id,
        "registration": inc.registration,
        "icao_hex": inc.icao_hex,
        "event_type": inc.event_type,
        "event_date": inc.event_date.isoformat() if inc.event_date else None,
        "severity": inc.severity,
        "location": where or None,
        "url": inc.url,
    }
    return text, title, metadata


def index_acars_message(msg, *, force: bool = False) -> str:
    text, title, meta = _acars_text(msg)
    from skyspy.models import RagDocument

    return _upsert(RagDocument.KIND_ACARS, msg.pk, text, title=title, metadata=meta, force=force)


def index_notam(notam, *, force: bool = False) -> str:
    text, title, meta = _notam_text(notam)
    from skyspy.models import RagDocument

    return _upsert(RagDocument.KIND_NOTAM, notam.notam_id, text, title=title, metadata=meta, force=force)


def index_pirep(pirep, *, force: bool = False) -> str:
    text, title, meta = _pirep_text(pirep)
    from skyspy.models import RagDocument

    return _upsert(RagDocument.KIND_PIREP, pirep.pirep_id, text, title=title, metadata=meta, force=force)


def index_safety_event(event, *, force: bool = False) -> str:
    text, title, meta = _safety_text(event)
    from skyspy.models import RagDocument

    return _upsert(RagDocument.KIND_SAFETY, event.pk, text, title=title, metadata=meta, force=force)


def index_incident(inc, *, force: bool = False) -> str:
    text, title, meta = _incident_text(inc)
    from skyspy.models import RagDocument

    return _upsert(RagDocument.KIND_INCIDENT, inc.pk, text, title=title, metadata=meta, force=force)


# =============================================================================
# Search
# =============================================================================


def search(query: str, kind: str | None = None, k: int = 5) -> list[dict]:
    """
    Search indexed documents for ``query``, optionally scoped to one ``kind``.

    Uses vector (cosine) similarity when embeddings are configured; otherwise
    falls back to a keyword search over the source text so content search still
    works without an embedding provider. Each hit carries ``match`` = "vector"
    or "keyword" so callers know which path answered.
    """
    from pgvector.django import CosineDistance

    from skyspy.models import RagDocument

    query = (query or "").strip()
    if not query:
        return []

    k = max(1, min(20, int(k)))
    vectors = llm_client.embed([query])
    if not vectors:
        logger.debug("RAG vector search unavailable (no embeddings) — keyword fallback")
        return _keyword_search(query, kind, k)

    qs = RagDocument.objects.filter(embedding__isnull=False)
    kinds = _norm_kinds(kind)
    if kinds:
        qs = qs.filter(kind__in=kinds)
    qs = qs.annotate(distance=CosineDistance("embedding", vectors[0])).order_by("distance")[:k]
    return [
        {
            "kind": d.kind,
            "ref_id": d.ref_id,
            "title": d.title,
            "content": d.content,
            "metadata": d.metadata or {},
            "similarity": round(1.0 - float(d.distance), 4),
            "match": "vector",
        }
        for d in qs
    ]


# Terms of length >= 3 are meaningful; shorter tokens match too much noise.
_TERM_RE = re.compile(r"[A-Za-z0-9]{3,}")

# Per-kind keyword-search config: (source model, text fields to match/score,
# builder that returns (text, title, metadata), natural-key attribute, ordering).
_KEYWORD_KINDS = {
    "acars": {
        "fields": ["text"],
        "order": "-timestamp",
        "ref": "pk",
    },
    "notam": {
        "fields": ["text", "raw_text"],
        "order": "-effective_start",
        "ref": "notam_id",
    },
    "pirep": {
        "fields": ["raw_text", "location"],
        "order": "-observation_time",
        "ref": "pirep_id",
    },
    "safety": {
        "fields": ["message", "callsign", "icao_hex"],
        "order": "-timestamp",
        "ref": "pk",
    },
    "incident": {
        "fields": ["narrative", "registration", "city"],
        "order": "-event_date",
        "ref": "pk",
    },
}


def _keyword_search(query: str, kind: str | None, k: int) -> list[dict]:
    """Substring keyword search over source rows, ranked by matched-term count.

    Works with no embeddings by scanning the source tables directly (full
    coverage, not limited to what the RAG index has embedded yet).
    """
    from django.db.models import Q

    terms = list(dict.fromkeys(t.lower() for t in _TERM_RE.findall(query)))
    if not terms:
        return []

    kinds = _norm_kinds(kind) or list(_KEYWORD_KINDS)
    hits = []
    for kd in kinds:
        cfg = _KEYWORD_KINDS.get(kd)
        if not cfg:
            continue
        model, builder = _source_for(kd)
        q = Q()
        for field in cfg["fields"]:
            for t in terms:
                q |= Q(**{f"{field}__icontains": t})
        # Cap the scan per kind; newest first so recent traffic wins ties.
        rows = model.objects.filter(q).order_by(cfg["order"])[:200]
        for row in rows:
            text, title, meta = builder(row)
            haystack = " ".join(str(getattr(row, f) or "") for f in cfg["fields"]).lower()
            score = sum(1 for t in terms if t in haystack)
            if not score:
                continue
            hits.append(
                {
                    "kind": kd,
                    "ref_id": str(getattr(row, cfg["ref"])),
                    "title": title,
                    "content": text,
                    "metadata": meta,
                    "similarity": None,
                    "match": "keyword",
                    "_score": score,
                }
            )

    hits.sort(key=lambda h: h["_score"], reverse=True)
    for h in hits:
        h.pop("_score", None)
    return hits[:k]


def _source_for(kind: str):
    """(model, builder) for a keyword-searchable kind."""
    from skyspy.models import AcarsMessage, AircraftIncident, CachedNotam, CachedPirep, SafetyEvent

    return {
        "acars": (AcarsMessage, _acars_text),
        "notam": (CachedNotam, _notam_text),
        "pirep": (CachedPirep, _pirep_text),
        "safety": (SafetyEvent, _safety_text),
        "incident": (AircraftIncident, _incident_text),
    }[kind]
