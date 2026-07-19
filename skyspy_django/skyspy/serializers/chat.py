"""
Assistant chat session serializers.

The frontend's in-memory message object is ``{role, text, steps, sources,
photos, maps, error}``. On the wire we keep ``role``/``text`` as columns and
stash the rest in ``payload``; ``ChatMessageSerializer`` flattens ``payload``
back to the top level so the browser receives an identical object.
"""

from rest_framework import serializers

from skyspy.models import ChatMessage, ChatSession

# Keys the frontend attaches to a message that live inside ChatMessage.payload.
PAYLOAD_KEYS = ("steps", "sources", "photos", "maps", "error")


class ChatMessageSerializer(serializers.ModelSerializer):
    """A single turn, with payload flattened to the top level."""

    class Meta:
        model = ChatMessage
        fields = ["id", "role", "text", "seq", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        payload = instance.payload or {}
        for key in PAYLOAD_KEYS:
            if key in payload:
                data[key] = payload[key]
        return data


class ChatSessionListSerializer(serializers.ModelSerializer):
    """Lightweight session row for the sidebar list."""

    message_count = serializers.IntegerField(source="messages.count", read_only=True)

    class Meta:
        model = ChatSession
        fields = ["id", "title", "surface", "created_at", "updated_at", "message_count"]


class ChatSessionDetailSerializer(serializers.ModelSerializer):
    """Full session with its ordered messages."""

    messages = ChatMessageSerializer(many=True, read_only=True)

    class Meta:
        model = ChatSession
        fields = ["id", "title", "surface", "created_at", "updated_at", "messages"]
