"""
Assistant chat session models — persist conversations with the LangChain agent.

Sessions are owned either by an authenticated user (``owner``) or, in public
``AUTH_MODE`` where requests are anonymous, by a client-generated ``client_id``
(a UUID the browser stores in localStorage and sends via ``X-Client-Id``). The
viewset scopes every query by whichever applies, so a caller only ever sees and
deletes their own sessions.
"""

from django.conf import settings
from django.db import models


class ChatSession(models.Model):
    """A saved assistant conversation (a thread of ChatMessages)."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="chat_sessions",
    )
    # Anonymous owner (public mode): a UUID from the browser's localStorage.
    client_id = models.CharField(max_length=64, blank=True, db_index=True)
    title = models.CharField(max_length=200, blank=True)
    # Which UI created it: "screen" (full assistant) or "dock" (copilot).
    surface = models.CharField(max_length=16, default="screen")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "chat_sessions"
        indexes = [
            models.Index(fields=["owner", "-updated_at"], name="idx_chat_owner_updated"),
            models.Index(fields=["client_id", "-updated_at"], name="idx_chat_client_updated"),
        ]
        ordering = ["-updated_at"]

    def __str__(self):
        return f"ChatSession {self.pk}: {self.title or '(untitled)'}"


class ChatMessage(models.Model):
    """A single turn in a ChatSession.

    ``role``/``text`` are columns; the richer render data the frontend attaches
    to assistant turns (``steps``, ``sources``, ``photos``, ``maps``, ``error``)
    rides in ``payload`` so the message object round-trips unchanged. The
    transient ``pending`` flag is never persisted.
    """

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=16)  # "user" | "assistant"
    text = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    seq = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "chat_messages"
        indexes = [
            models.Index(fields=["session", "seq"], name="idx_chat_msg_session_seq"),
        ]
        ordering = ["seq"]

    def __str__(self):
        return f"ChatMessage {self.pk} ({self.role}) in session {self.session_id}"
