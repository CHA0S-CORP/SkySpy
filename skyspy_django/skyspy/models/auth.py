"""
Authentication and RBAC models for SkySpy.

Provides:
- SkyspyUser: Extended user profile with OIDC fields
- Role: Custom roles with permission arrays
- UserRole: User-to-role assignment with optional expiration
- APIKey: Programmatic access keys
- FeatureAccess: Per-feature public/private configuration
- OIDCClaimMapping: Map OIDC claims to roles
"""
import secrets
import hashlib
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class SkyspyUser(models.Model):
    """Extended user profile with OIDC integration and preferences."""

    AUTH_PROVIDER_CHOICES = [
        ('local', 'Local'),
        ('oidc', 'OIDC'),
    ]

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='skyspy_profile'
    )

    # OIDC fields
    auth_provider = models.CharField(
        max_length=20,
        choices=AUTH_PROVIDER_CHOICES,
        default='local'
    )
    oidc_subject = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
        db_index=True,
        help_text='OIDC subject identifier (sub claim)'
    )
    oidc_issuer = models.CharField(
        max_length=500,
        blank=True,
        null=True,
        help_text='OIDC issuer URL'
    )
    oidc_claims = models.JSONField(
        blank=True,
        null=True,
        help_text='Cached OIDC claims from last login'
    )

    # Profile fields
    display_name = models.CharField(max_length=100, blank=True, null=True)
    avatar_url = models.URLField(blank=True, null=True)

    # Activity tracking
    last_active = models.DateTimeField(blank=True, null=True)
    last_login_ip = models.GenericIPAddressField(blank=True, null=True)

    # Preferences (JSON for flexibility)
    preferences = models.JSONField(
        default=dict,
        blank=True,
        help_text='User preferences (map settings, notifications, etc.)'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'skyspy_users'
        verbose_name = 'SkySpy User'
        verbose_name_plural = 'SkySpy Users'

    def __str__(self):
        return self.display_name or self.user.username

    @property
    def is_oidc_user(self):
        return self.auth_provider == 'oidc'

    def get_all_permissions(self):
        """Get all permissions from all assigned roles."""
        permissions = set()
        for user_role in self.user.user_roles.select_related('role').filter(
            models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now())
        ):
            permissions.update(user_role.role.permissions)
        return list(permissions)

    def has_permission(self, permission):
        """Check if user has a specific permission."""
        if self.user.is_superuser:
            return True
        return permission in self.get_all_permissions()

    def has_any_permission(self, permissions):
        """Check if user has any of the specified permissions."""
        if self.user.is_superuser:
            return True
        user_perms = set(self.get_all_permissions())
        return bool(user_perms.intersection(permissions))

    def has_all_permissions(self, permissions):
        """Check if user has all specified permissions."""
        if self.user.is_superuser:
            return True
        user_perms = set(self.get_all_permissions())
        return all(p in user_perms for p in permissions)


class Role(models.Model):
    """Custom role with a set of permissions."""

    name = models.CharField(max_length=50, unique=True)
    display_name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    # Array of permission strings like ['aircraft.view', 'alerts.create']
    permissions = models.JSONField(
        default=list,
        help_text='List of permission strings'
    )

    # System roles cannot be deleted or have permissions modified
    is_system = models.BooleanField(
        default=False,
        help_text='System roles cannot be deleted'
    )

    # Role priority for display ordering
    priority = models.IntegerField(
        default=0,
        help_text='Higher priority roles appear first'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'roles'
        ordering = ['-priority', 'name']

    def __str__(self):
        return self.display_name


class UserRole(models.Model):
    """Assignment of a role to a user with optional expiration."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='user_roles'
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='user_assignments'
    )

    # Optional expiration for temporary role assignments
    expires_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text='Role assignment expires at this time'
    )

    # Who assigned this role
    assigned_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='role_assignments_made'
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_roles'
        unique_together = ['user', 'role']
        indexes = [
            models.Index(fields=['user', 'expires_at'], name='idx_user_role_expiry'),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.role.name}"

    @property
    def is_expired(self):
        if self.expires_at is None:
            return False
        return timezone.now() > self.expires_at


class APIKey(models.Model):
    """API key for programmatic access."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='api_keys'
    )

    name = models.CharField(
        max_length=100,
        help_text='Descriptive name for this API key'
    )

    # Store hashed key for security
    key_hash = models.CharField(
        max_length=64,
        unique=True,
        db_index=True
    )

    # Key prefix for identification (first 8 chars)
    key_prefix = models.CharField(max_length=16)

    # Scopes/permissions for this key (subset of user's permissions)
    scopes = models.JSONField(
        default=list,
        blank=True,
        help_text='Permission scopes for this key (empty = all user permissions)'
    )

    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    last_used_at = models.DateTimeField(blank=True, null=True)
    last_used_ip = models.GenericIPAddressField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'api_keys'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.key_prefix}...)"

    @classmethod
    def generate_key(cls):
        """Generate a new API key and return (key, hash, prefix)."""
        key = f"sk_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        key_prefix = key[:10]
        return key, key_hash, key_prefix

    @classmethod
    def hash_key(cls, key):
        """Hash a key for lookup."""
        return hashlib.sha256(key.encode()).hexdigest()

    @property
    def is_expired(self):
        if self.expires_at is None:
            return False
        return timezone.now() > self.expires_at

    def is_valid(self):
        """Check if key is valid (active and not expired)."""
        return self.is_active and not self.is_expired


class FeatureAccess(models.Model):
    """Per-feature access configuration for public/private modes."""

    ACCESS_LEVEL_CHOICES = [
        ('public', 'Public'),           # No authentication required
        ('authenticated', 'Authenticated'),  # Any logged-in user
        ('permission', 'Permission'),    # Specific permission required
    ]

    FEATURE_CHOICES = [
        ('aircraft', 'Aircraft Tracking'),
        ('alerts', 'Alert Rules'),
        ('safety', 'Safety Events'),
        ('audio', 'Audio Transmissions'),
        ('acars', 'ACARS Messages'),
        ('history', 'Flight History'),
        ('system', 'System Status'),
        ('users', 'User Management'),
        ('roles', 'Role Management'),
    ]

    feature = models.CharField(
        max_length=30,
        choices=FEATURE_CHOICES,
        unique=True,
        primary_key=True
    )

    # Read access level
    read_access = models.CharField(
        max_length=20,
        choices=ACCESS_LEVEL_CHOICES,
        default='authenticated',
        help_text='Access level required to view this feature'
    )

    # Write access level (create/update/delete)
    write_access = models.CharField(
        max_length=20,
        choices=ACCESS_LEVEL_CHOICES,
        default='permission',
        help_text='Access level required to modify this feature'
    )

    # Additional restrictions
    is_enabled = models.BooleanField(
        default=True,
        help_text='Whether this feature is enabled at all'
    )

    # Feature-specific settings
    settings = models.JSONField(
        default=dict,
        blank=True,
        help_text='Feature-specific access settings'
    )

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )

    class Meta:
        db_table = 'feature_access'
        verbose_name = 'Feature Access'
        verbose_name_plural = 'Feature Access'

    def __str__(self):
        return f"{self.get_feature_display()} - Read: {self.read_access}, Write: {self.write_access}"


class OIDCClaimMapping(models.Model):
    """Map OIDC claims to roles for automatic role assignment."""

    MATCH_TYPE_CHOICES = [
        ('exact', 'Exact Match'),
        ('contains', 'Contains'),
        ('regex', 'Regex Match'),
    ]

    name = models.CharField(
        max_length=100,
        help_text='Descriptive name for this mapping'
    )

    # The OIDC claim to match (e.g., 'groups', 'roles', 'email')
    claim_name = models.CharField(
        max_length=100,
        help_text='OIDC claim name to match (e.g., groups, roles)'
    )

    # How to match the claim value
    match_type = models.CharField(
        max_length=20,
        choices=MATCH_TYPE_CHOICES,
        default='exact'
    )

    # The value to match
    claim_value = models.CharField(
        max_length=255,
        help_text='Value to match in the claim'
    )

    # Role to assign when matched
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='claim_mappings'
    )

    # Priority for ordering (higher = processed first)
    priority = models.IntegerField(
        default=0,
        help_text='Higher priority mappings are processed first'
    )

    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'oidc_claim_mappings'
        ordering = ['-priority', 'name']

    def __str__(self):
        return f"{self.name}: {self.claim_name}={self.claim_value} -> {self.role.name}"

    def matches(self, claims):
        """Check if this mapping matches the given OIDC claims."""
        import re

        if self.claim_name not in claims:
            return False

        claim_values = claims[self.claim_name]

        # Handle both single values and lists
        if not isinstance(claim_values, list):
            claim_values = [claim_values]

        for value in claim_values:
            if self.match_type == 'exact':
                if str(value) == self.claim_value:
                    return True
            elif self.match_type == 'contains':
                if self.claim_value in str(value):
                    return True
            elif self.match_type == 'regex':
                if re.match(self.claim_value, str(value)):
                    return True

        return False


# Default permissions by feature
FEATURE_PERMISSIONS = {
    'aircraft': [
        'aircraft.view',
        'aircraft.view_military',
        'aircraft.view_details',
    ],
    'alerts': [
        'alerts.view',
        'alerts.create',
        'alerts.edit',
        'alerts.delete',
        'alerts.manage_all',
    ],
    'safety': [
        'safety.view',
        'safety.acknowledge',
        'safety.manage',
    ],
    'audio': [
        'audio.view',
        'audio.upload',
        'audio.transcribe',
        'audio.delete',
    ],
    'acars': [
        'acars.view',
        'acars.view_full',
    ],
    'history': [
        'history.view',
        'history.export',
    ],
    'system': [
        'system.view_status',
        'system.view_metrics',
        'system.manage',
    ],
    'users': [
        'users.view',
        'users.create',
        'users.edit',
        'users.delete',
    ],
    'roles': [
        'roles.view',
        'roles.create',
        'roles.edit',
        'roles.delete',
    ],
}

# All available permissions as a flat list
ALL_PERMISSIONS = [
    perm for perms in FEATURE_PERMISSIONS.values() for perm in perms
]

# Default role definitions
DEFAULT_ROLES = {
    'viewer': {
        'display_name': 'Viewer',
        'description': 'Read-only access to allowed features',
        'permissions': [
            'aircraft.view',
            'alerts.view',
            'safety.view',
            'audio.view',
            'acars.view',
            'history.view',
            'system.view_status',
        ],
        'priority': 10,
    },
    'operator': {
        'display_name': 'Operator',
        'description': 'Can create and manage own alerts, acknowledge safety events',
        'permissions': [
            'aircraft.view',
            'aircraft.view_details',
            'alerts.view',
            'alerts.create',
            'alerts.edit',
            'alerts.delete',
            'safety.view',
            'safety.acknowledge',
            'audio.view',
            'acars.view',
            'history.view',
            'system.view_status',
        ],
        'priority': 20,
    },
    'analyst': {
        'display_name': 'Analyst',
        'description': 'Extended access with export and transcription capabilities',
        'permissions': [
            'aircraft.view',
            'aircraft.view_military',
            'aircraft.view_details',
            'alerts.view',
            'alerts.create',
            'alerts.edit',
            'alerts.delete',
            'safety.view',
            'safety.acknowledge',
            'audio.view',
            'audio.transcribe',
            'acars.view',
            'acars.view_full',
            'history.view',
            'history.export',
            'system.view_status',
            'system.view_metrics',
        ],
        'priority': 30,
    },
    'admin': {
        'display_name': 'Admin',
        'description': 'Full feature access with limited user management',
        'permissions': [
            'aircraft.view',
            'aircraft.view_military',
            'aircraft.view_details',
            'alerts.view',
            'alerts.create',
            'alerts.edit',
            'alerts.delete',
            'alerts.manage_all',
            'safety.view',
            'safety.acknowledge',
            'safety.manage',
            'audio.view',
            'audio.upload',
            'audio.transcribe',
            'audio.delete',
            'acars.view',
            'acars.view_full',
            'history.view',
            'history.export',
            'system.view_status',
            'system.view_metrics',
            'system.manage',
            'users.view',
            'users.edit',
            'roles.view',
        ],
        'priority': 40,
    },
    'superadmin': {
        'display_name': 'Super Admin',
        'description': 'Full access including user and role management',
        'permissions': ALL_PERMISSIONS.copy(),
        'priority': 100,
    },
}
