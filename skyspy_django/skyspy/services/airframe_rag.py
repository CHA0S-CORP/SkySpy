"""
Airframe RAG — index dossiers as embeddings and answer questions over them.

Flow:
- ``index_aircraft(icao)`` builds the dossier text, embeds it, and upserts an
  ``AirframeDocument`` (skips re-embedding when the text is unchanged).
- ``search(query, k)`` embeds the query and returns the k nearest dossiers by
  cosine distance (pgvector).
- ``ask(query, k)`` retrieves context and asks the LLM to answer from it.

Everything degrades gracefully when embeddings/LLM are not configured: indexing
still stores the dossier text (embedding stays null) and ``ask`` reports that
the feature is unavailable rather than raising.
"""

import hashlib
import logging

from django.conf import settings

from skyspy.services import airframe_dossier
from skyspy.services.llm import llm_client

logger = logging.getLogger(__name__)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def index_aircraft(icao_hex: str, *, force: bool = False) -> dict:
    """
    Build + embed + upsert the dossier document for one ICAO hex.

    Returns {"status": "indexed"|"unchanged"|"missing"|"stored_no_embedding"}.
    """
    from skyspy.models import AirframeDocument

    dossier = airframe_dossier.build_dossier(icao_hex)
    if dossier is None:
        return {"status": "missing", "icao_hex": icao_hex}

    icao_hex = dossier["icao_hex"]
    text = dossier["text"]
    content_hash = _hash(text)

    existing = AirframeDocument.objects.filter(icao_hex=icao_hex).first()
    if existing and existing.content_hash == content_hash and existing.embedding is not None and not force:
        return {"status": "unchanged", "icao_hex": icao_hex}

    embedding = None
    model = None
    vectors = llm_client.embed([text])
    if vectors:
        embedding = vectors[0]
        model = getattr(settings, "EMBEDDING_MODEL", None)

    AirframeDocument.objects.update_or_create(
        icao_hex=icao_hex,
        defaults={
            "registration": dossier["identity"].get("registration"),
            "content": text,
            "content_hash": content_hash,
            "embedding": embedding,
            "embedding_model": model,
        },
    )
    return {"status": "indexed" if embedding is not None else "stored_no_embedding", "icao_hex": icao_hex}


def search(query: str, k: int = 5) -> list[dict]:
    """Return the k nearest airframe dossiers to ``query`` by cosine distance."""
    from pgvector.django import CosineDistance

    from skyspy.models import AirframeDocument

    vectors = llm_client.embed([query])
    if not vectors:
        logger.debug("Airframe search unavailable (no embeddings)")
        return []

    qs = (
        AirframeDocument.objects.filter(embedding__isnull=False)
        .annotate(distance=CosineDistance("embedding", vectors[0]))
        .order_by("distance")[:k]
    )
    return [
        {
            "icao_hex": d.icao_hex,
            "registration": d.registration,
            "content": d.content,
            "similarity": round(1.0 - float(d.distance), 4),
        }
        for d in qs
    ]


def ask(query: str, k: int = 5) -> dict:
    """
    Answer a natural-language question over the indexed airframe dossiers.

    Retrieves the top-k dossiers and asks the LLM to answer strictly from them.
    """
    if not getattr(settings, "LLM_ENABLED", False):
        return {"answer": None, "status": "llm_disabled", "sources": []}

    hits = search(query, k=k)
    if not hits:
        return {"answer": None, "status": "no_context", "sources": []}

    context = "\n\n".join(f"[{h['icao_hex']} / {h['registration'] or 'n/a'}]\n{h['content']}" for h in hits)
    messages = [
        {
            "role": "system",
            "content": (
                "You answer questions about tracked aircraft using ONLY the provided dossiers. "
                "Cite the ICAO hex for any claim. If the dossiers do not contain the answer, say so."
            ),
        },
        {"role": "user", "content": f"Dossiers:\n{context}\n\nQuestion: {query}"},
    ]
    result = llm_client.complete(messages)
    if not result:
        return {"answer": None, "status": "llm_error", "sources": [h["icao_hex"] for h in hits]}
    return {
        "answer": result.get("content"),
        "status": "ok",
        "sources": [{"icao_hex": h["icao_hex"], "registration": h["registration"]} for h in hits],
    }
