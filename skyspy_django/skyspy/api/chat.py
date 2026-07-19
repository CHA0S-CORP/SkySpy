"""
Assistant chat session API — persist, list, reopen, and delete conversations.

Sessions are scoped to their owner in ``get_queryset``: authenticated users by
``owner``, anonymous users (public ``AUTH_MODE``) by the ``X-Client-Id`` header.
That scoping is the isolation boundary — ``get_object()`` can only resolve the
caller's own rows, so a foreign retrieve/delete returns 404. ``CanUseAssistant``
gates the whole viewset behind an authenticated user holding ``assistant.view`` —
so chat history is unavailable to anonymous visitors even in public ``AUTH_MODE``.
"""

import logging

from django.db.models import Max
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import CanUseAssistant
from skyspy.models import ChatMessage, ChatSession
from skyspy.serializers.chat import (
    PAYLOAD_KEYS,
    ChatSessionDetailSerializer,
    ChatSessionListSerializer,
)

logger = logging.getLogger(__name__)


def _client_id(request) -> str:
    """The anonymous owner key from the browser (empty when absent)."""
    return (request.headers.get("X-Client-Id") or "").strip()


class ChatSessionViewSet(viewsets.ModelViewSet):
    """CRUD over saved assistant chat sessions (list/create/retrieve/destroy)."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [CanUseAssistant]
    http_method_names = ["get", "post", "delete"]

    def get_serializer_class(self):
        if self.action == "list":
            return ChatSessionListSerializer
        return ChatSessionDetailSerializer

    def get_queryset(self):
        """Scope to the caller — by owner if authed, else by X-Client-Id."""
        user = self.request.user
        if user.is_authenticated:
            return ChatSession.objects.filter(owner=user)
        client_id = _client_id(self.request)
        if not client_id:
            return ChatSession.objects.none()
        return ChatSession.objects.filter(owner__isnull=True, client_id=client_id)

    def perform_create(self, serializer):
        """Stamp ownership from the request (never trust the body for it)."""
        user = self.request.user
        if user.is_authenticated:
            serializer.save(owner=user)
        else:
            serializer.save(client_id=_client_id(self.request))

    @action(detail=True, methods=["post"])
    def messages(self, request, pk=None):
        """Append one or more completed turns to a session.

        Body: a list of ``{role, text, steps?, sources?, photos?, maps?, error?}``
        (or ``{"messages": [...]}``). ``role``/``text`` become columns; the rest
        is folded into ``payload``. Bumps ``updated_at`` and derives a title from
        the first user turn if the session is still untitled.
        """
        session = self.get_object()  # 404 for foreign sessions via get_queryset scoping

        incoming = request.data
        if isinstance(incoming, dict):
            incoming = incoming.get("messages", [])
        if not isinstance(incoming, list) or not incoming:
            return Response({"detail": "Expected a non-empty list of messages."}, status=400)

        # Continue after the highest existing seq (count() mis-numbers if any
        # earlier message was deleted, colliding seq values and reordering).
        # NB: check "is None" — a valid max seq of 0 is falsy, so `or -1` would
        # wrongly restart numbering at 0 and collide on the next append.
        _max_seq = session.messages.aggregate(_m=Max("seq"))["_m"]
        next_seq = (_max_seq if _max_seq is not None else -1) + 1
        created = []
        for item in incoming:
            if not isinstance(item, dict):
                continue
            payload = {k: item[k] for k in PAYLOAD_KEYS if item.get(k) not in (None, [], "")}
            created.append(
                ChatMessage(
                    session=session,
                    role=item.get("role", "user"),
                    text=item.get("text", "") or "",
                    payload=payload,
                    seq=next_seq,
                )
            )
            next_seq += 1
        if created:
            ChatMessage.objects.bulk_create(created)

        # Derive a title from the first user message if still untitled.
        if not session.title:
            first_user = next((m for m in created if m.role == "user" and m.text), None)
            if first_user:
                session.title = first_user.text[:120]

        session.save()  # auto_now bumps updated_at (also persists any new title)

        serializer = ChatSessionDetailSerializer(session)
        return Response(serializer.data, status=201)
