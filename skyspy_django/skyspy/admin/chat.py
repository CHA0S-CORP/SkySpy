"""Django admin for assistant chat sessions.

Lets admins browse conversations per user/owner. Chat content is otherwise
scoped to its owner in the API; the admin (superuser) sees every session.
"""

from django.contrib import admin

from skyspy.models import ChatMessage, ChatSession


class ChatMessageInline(admin.TabularInline):
    """Read-only view of the turns within a session."""

    model = ChatMessage
    extra = 0
    fields = ("seq", "role", "text", "created_at")
    readonly_fields = ("seq", "role", "text", "created_at")
    can_delete = False
    ordering = ("seq",)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    """Admin for saved assistant conversations."""

    list_display = ("id", "title", "owner", "client_id", "surface", "message_count", "updated_at")
    list_filter = (
        "surface",
        ("owner", admin.RelatedOnlyFieldListFilter),
        "updated_at",
    )
    search_fields = ("title", "owner__username", "owner__email", "client_id")
    raw_id_fields = ("owner",)
    readonly_fields = ("created_at", "updated_at")
    date_hierarchy = "updated_at"
    inlines = [ChatMessageInline]

    @admin.display(description="Messages")
    def message_count(self, obj):
        return obj.messages.count()


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    """Admin for individual chat turns (read-only log)."""

    list_display = ("id", "session", "role", "seq", "created_at")
    list_filter = ("role", "created_at")
    search_fields = ("text", "session__title", "session__owner__username")
    raw_id_fields = ("session",)
    readonly_fields = ("session", "role", "text", "payload", "seq", "created_at")

    def has_add_permission(self, request):
        return False
