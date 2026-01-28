"""
Shared admin actions for SkySpy.
"""
from django.contrib import admin, messages
from django.utils import timezone


@admin.action(description="Acknowledge selected items")
def acknowledge_selected(modeladmin, request, queryset):
    """Mark selected items as acknowledged."""
    updated = queryset.filter(acknowledged=False).update(
        acknowledged=True,
        acknowledged_at=timezone.now()
    )
    modeladmin.message_user(
        request,
        f"{updated} item(s) acknowledged.",
        messages.SUCCESS
    )


@admin.action(description="Enable selected items")
def enable_selected(modeladmin, request, queryset):
    """Enable selected items."""
    updated = queryset.update(enabled=True)
    modeladmin.message_user(
        request,
        f"{updated} item(s) enabled.",
        messages.SUCCESS
    )


@admin.action(description="Disable selected items")
def disable_selected(modeladmin, request, queryset):
    """Disable selected items."""
    updated = queryset.update(enabled=False)
    modeladmin.message_user(
        request,
        f"{updated} item(s) disabled.",
        messages.SUCCESS
    )


@admin.action(description="Activate selected items")
def activate_selected(modeladmin, request, queryset):
    """Activate selected items."""
    updated = queryset.update(is_active=True)
    modeladmin.message_user(
        request,
        f"{updated} item(s) activated.",
        messages.SUCCESS
    )


@admin.action(description="Deactivate selected items")
def deactivate_selected(modeladmin, request, queryset):
    """Deactivate selected items."""
    updated = queryset.update(is_active=False)
    modeladmin.message_user(
        request,
        f"{updated} item(s) deactivated.",
        messages.SUCCESS
    )


@admin.action(description="Archive selected items")
def archive_selected(modeladmin, request, queryset):
    """Archive selected items."""
    updated = queryset.update(
        is_archived=True,
        archived_at=timezone.now()
    )
    modeladmin.message_user(
        request,
        f"{updated} item(s) archived.",
        messages.SUCCESS
    )


@admin.action(description="Unarchive selected items")
def unarchive_selected(modeladmin, request, queryset):
    """Unarchive selected items."""
    updated = queryset.update(
        is_archived=False,
        archived_at=None
    )
    modeladmin.message_user(
        request,
        f"{updated} item(s) unarchived.",
        messages.SUCCESS
    )


@admin.action(description="Mark as verified")
def mark_verified(modeladmin, request, queryset):
    """Mark selected channels as verified."""
    updated = queryset.update(verified=True)
    modeladmin.message_user(
        request,
        f"{updated} item(s) marked as verified.",
        messages.SUCCESS
    )


@admin.action(description="Revoke selected API keys")
def revoke_api_keys(modeladmin, request, queryset):
    """Revoke (deactivate) selected API keys."""
    updated = queryset.update(is_active=False)
    modeladmin.message_user(
        request,
        f"{updated} API key(s) revoked.",
        messages.SUCCESS
    )


@admin.action(description="Extend expiration by 30 days")
def extend_expiration_30_days(modeladmin, request, queryset):
    """Extend API key expiration by 30 days."""
    from datetime import timedelta
    count = 0
    for obj in queryset:
        if obj.expires_at:
            obj.expires_at = obj.expires_at + timedelta(days=30)
        else:
            obj.expires_at = timezone.now() + timedelta(days=30)
        obj.save(update_fields=['expires_at'])
        count += 1
    modeladmin.message_user(
        request,
        f"{count} API key(s) expiration extended by 30 days.",
        messages.SUCCESS
    )
