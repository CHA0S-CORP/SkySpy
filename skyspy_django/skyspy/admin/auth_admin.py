"""
Django admin classes for SkySpy authentication and RBAC models.
"""
from django.contrib import admin
from django.contrib.auth.models import User
from django.utils.html import format_html

from skyspy.models import (
    SkyspyUser, Role, UserRole, APIKey, FeatureAccess, OIDCClaimMapping,
)
from skyspy.admin.filters import DateRangeFilter, ActiveFilter
from skyspy.admin.actions import (
    revoke_api_keys, extend_expiration_30_days, activate_selected, deactivate_selected,
)


class LastActiveDateRangeFilter(DateRangeFilter):
    """Date range filter for last_active field."""
    title = 'last active'
    parameter_name = 'last_active_range'
    date_field = 'last_active'


class ExpiresAtDateRangeFilter(DateRangeFilter):
    """Date range filter for expires_at field."""
    title = 'expires at'
    parameter_name = 'expires_at_range'
    date_field = 'expires_at'


class CreatedAtDateRangeFilter(DateRangeFilter):
    """Date range filter for created_at field."""
    title = 'created at'
    parameter_name = 'created_at_range'
    date_field = 'created_at'


class UserRoleInline(admin.TabularInline):
    """Inline admin for UserRole within SkyspyUser."""
    model = UserRole
    fk_name = 'user'
    extra = 0
    fields = ('role', 'expires_at', 'assigned_by', 'created_at')
    readonly_fields = ('created_at',)
    raw_id_fields = ('assigned_by',)

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('role', 'assigned_by')


class APIKeyInline(admin.TabularInline):
    """Inline admin for APIKey within SkyspyUser."""
    model = APIKey
    extra = 0
    fields = ('name', 'key_prefix', 'is_active', 'expires_at')
    readonly_fields = ('key_prefix',)

    def get_queryset(self, request):
        return super().get_queryset(request)


class SkyspyUserInline(admin.StackedInline):
    """Inline for SkyspyUser on User admin - for use if needed."""
    model = SkyspyUser
    can_delete = False
    verbose_name_plural = 'SkySpy Profile'


@admin.register(SkyspyUser)
class SkyspyUserAdmin(admin.ModelAdmin):
    """Admin for SkyspyUser model."""
    list_display = ('user', 'display_name', 'auth_provider', 'last_active', 'roles_display')
    list_filter = ('auth_provider', LastActiveDateRangeFilter)
    search_fields = ('user__username', 'user__email', 'display_name', 'oidc_subject')
    fieldsets = (
        (None, {
            'fields': ('user', 'display_name', 'avatar_url')
        }),
        ('OIDC', {
            'fields': ('auth_provider', 'oidc_subject', 'oidc_issuer', 'oidc_claims'),
            'classes': ('collapse',),
        }),
        ('Activity', {
            'fields': ('last_active', 'last_login_ip'),
        }),
        ('Preferences', {
            'fields': ('preferences',),
            'classes': ('collapse',),
        }),
    )
    raw_id_fields = ('user',)

    def get_inlines(self, request, obj):
        """Add inlines only when editing existing object."""
        if obj:
            return [UserRoleInlineForSkyspyUser, APIKeyInlineForSkyspyUser]
        return []

    @admin.display(description='Roles')
    def roles_display(self, obj):
        """Display comma-separated list of role names."""
        roles = UserRole.objects.filter(user=obj.user).select_related('role')
        role_names = [ur.role.display_name for ur in roles]
        return ', '.join(role_names) if role_names else '-'


class UserRoleInlineForSkyspyUser(admin.TabularInline):
    """UserRole inline that works via the User foreign key."""
    model = UserRole
    fk_name = 'user'
    extra = 0
    fields = ('role', 'expires_at', 'assigned_by', 'created_at')
    readonly_fields = ('created_at',)
    raw_id_fields = ('assigned_by',)

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('role', 'assigned_by')

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        """Override to get the user from the parent SkyspyUser object."""
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


class APIKeyInlineForSkyspyUser(admin.TabularInline):
    """APIKey inline that works via the User foreign key."""
    model = APIKey
    fk_name = 'user'
    extra = 0
    fields = ('name', 'key_prefix', 'is_active', 'expires_at')
    readonly_fields = ('key_prefix',)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    """Admin for Role model."""
    list_display = ('name', 'display_name', 'permission_count', 'priority', 'is_system')
    list_filter = ('is_system', 'priority')
    search_fields = ('name', 'display_name', 'description')
    fieldsets = (
        (None, {
            'fields': ('name', 'display_name', 'description')
        }),
        ('Configuration', {
            'fields': ('permissions', 'priority', 'is_system'),
        }),
    )

    @admin.display(description='Permissions')
    def permission_count(self, obj):
        """Display count of permissions."""
        return len(obj.permissions) if obj.permissions else 0

    def get_readonly_fields(self, request, obj=None):
        """Make permissions and is_system readonly for system roles."""
        if obj and obj.is_system:
            return ('permissions', 'is_system')
        return ()

    def has_delete_permission(self, request, obj=None):
        """Prevent deletion of system roles."""
        if obj and obj.is_system:
            return False
        return super().has_delete_permission(request, obj)


@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    """Admin for UserRole model."""
    list_display = ('user', 'role', 'expires_at', 'is_expired_display', 'assigned_by', 'created_at')
    list_filter = ('role', ExpiresAtDateRangeFilter)
    search_fields = ('user__username', 'role__name')
    raw_id_fields = ('user', 'assigned_by')

    @admin.display(description='Expired', boolean=True)
    def is_expired_display(self, obj):
        """Display whether the role assignment is expired."""
        return obj.is_expired


@admin.register(APIKey)
class APIKeyAdmin(admin.ModelAdmin):
    """Admin for APIKey model."""
    list_display = (
        'name', 'user', 'key_prefix', 'is_active', 'expires_at',
        'last_used_at', 'is_valid_display'
    )
    list_filter = (ActiveFilter, ExpiresAtDateRangeFilter)
    search_fields = ('name', 'user__username', 'key_prefix')
    readonly_fields = ('key_hash', 'key_prefix', 'last_used_at', 'last_used_ip')
    fieldsets = (
        (None, {
            'fields': ('user', 'name')
        }),
        ('Key Info', {
            'fields': ('key_prefix', 'key_hash'),
        }),
        ('Scopes', {
            'fields': ('scopes',),
        }),
        ('Status', {
            'fields': ('is_active', 'expires_at', 'last_used_at', 'last_used_ip'),
        }),
    )
    raw_id_fields = ('user',)
    actions = [revoke_api_keys, extend_expiration_30_days]

    @admin.display(description='Valid', boolean=True)
    def is_valid_display(self, obj):
        """Display whether the API key is valid."""
        return obj.is_valid()


@admin.register(FeatureAccess)
class FeatureAccessAdmin(admin.ModelAdmin):
    """Admin for FeatureAccess model."""
    list_display = ('feature', 'read_access', 'write_access', 'is_enabled', 'updated_at')
    list_filter = ('is_enabled', 'read_access', 'write_access')
    fieldsets = (
        (None, {
            'fields': ('feature',)
        }),
        ('Access Levels', {
            'fields': ('read_access', 'write_access'),
        }),
        ('Configuration', {
            'fields': ('is_enabled', 'settings'),
        }),
    )

    def get_readonly_fields(self, request, obj=None):
        """Make feature readonly since it's the primary key."""
        if obj:
            return ('feature',)
        return ()


@admin.register(OIDCClaimMapping)
class OIDCClaimMappingAdmin(admin.ModelAdmin):
    """Admin for OIDCClaimMapping model."""
    list_display = (
        'name', 'claim_name', 'match_type', 'claim_value', 'role', 'priority', 'is_active'
    )
    list_filter = (ActiveFilter, 'match_type', 'role')
    search_fields = ('name', 'claim_name', 'claim_value')
    fieldsets = (
        (None, {
            'fields': ('name', 'is_active')
        }),
        ('Matching', {
            'fields': ('claim_name', 'match_type', 'claim_value'),
        }),
        ('Assignment', {
            'fields': ('role', 'priority'),
        }),
    )
    actions = [activate_selected, deactivate_selected]
