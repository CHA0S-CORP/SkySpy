"""
Generic RAG document store.

One embeddable text document per source record (ACARS message, NOTAM, PIREP,
...), keyed by ``(kind, ref_id)``. Mirrors ``AirframeDocument`` but is
polymorphic so a single vector-search path covers every non-airframe source.

``content`` is the compact text that gets embedded; ``metadata`` carries the
small structured fields a search result echoes back (icao/callsign/location/
timestamp) so the assistant tools don't have to re-query the source row.
``content_hash`` lets the refresh task skip re-embedding unchanged documents.
"""

from django.conf import settings
from django.db import models
from pgvector.django import VectorField


class RagDocument(models.Model):
    """A single embeddable document from any indexable source."""

    KIND_ACARS = "acars"
    KIND_NOTAM = "notam"
    KIND_PIREP = "pirep"
    KIND_SAFETY = "safety"
    KIND_INCIDENT = "incident"
    KIND_CHOICES = [
        (KIND_ACARS, "ACARS message"),
        (KIND_NOTAM, "NOTAM"),
        (KIND_PIREP, "PIREP"),
        (KIND_SAFETY, "Safety event"),
        (KIND_INCIDENT, "NTSB incident"),
    ]

    kind = models.CharField(max_length=20, choices=KIND_CHOICES, db_index=True)
    # Natural key of the source row within its kind (e.g. AcarsMessage.pk,
    # CachedNotam.notam_id). Stored as text so any source's key type fits.
    ref_id = models.CharField(max_length=100, db_index=True)

    title = models.CharField(max_length=200, blank=True, null=True)
    content = models.TextField()
    content_hash = models.CharField(max_length=64, db_index=True)
    metadata = models.JSONField(blank=True, null=True)

    embedding = VectorField(dimensions=settings.EMBEDDING_DIM, null=True, blank=True)
    embedding_model = models.CharField(max_length=100, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "rag_document"
        constraints = [
            models.UniqueConstraint(fields=["kind", "ref_id"], name="uniq_rag_kind_ref"),
        ]
        indexes = [
            models.Index(fields=["kind", "-created_at"], name="idx_rag_kind_created"),
        ]

    def __str__(self):
        return f"RagDocument({self.kind}:{self.ref_id})"
