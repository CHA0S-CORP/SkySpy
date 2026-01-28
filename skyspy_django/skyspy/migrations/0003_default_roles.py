# Data migration to create default roles

from django.db import migrations


def create_default_roles(apps, schema_editor):
    """Create default roles for RBAC."""
    Role = apps.get_model('skyspy', 'Role')

    # All available permissions
    ALL_PERMISSIONS = [
        'aircraft.view', 'aircraft.view_military', 'aircraft.view_details',
        'alerts.view', 'alerts.create', 'alerts.edit', 'alerts.delete', 'alerts.manage_all',
        'safety.view', 'safety.acknowledge', 'safety.manage',
        'audio.view', 'audio.upload', 'audio.transcribe', 'audio.delete',
        'acars.view', 'acars.view_full',
        'history.view', 'history.export',
        'system.view_status', 'system.view_metrics', 'system.manage',
        'users.view', 'users.create', 'users.edit', 'users.delete',
        'roles.view', 'roles.create', 'roles.edit', 'roles.delete',
    ]

    default_roles = [
        {
            'name': 'viewer',
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
            'is_system': True,
        },
        {
            'name': 'operator',
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
            'is_system': True,
        },
        {
            'name': 'analyst',
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
            'is_system': True,
        },
        {
            'name': 'admin',
            'display_name': 'Admin',
            'description': 'Full feature access except user management',
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
            ],
            'priority': 40,
            'is_system': True,
        },
        {
            'name': 'superadmin',
            'display_name': 'Super Admin',
            'description': 'Full access including user and role management',
            'permissions': ALL_PERMISSIONS,
            'priority': 100,
            'is_system': True,
        },
    ]

    for role_data in default_roles:
        Role.objects.get_or_create(
            name=role_data['name'],
            defaults=role_data
        )


def create_default_feature_access(apps, schema_editor):
    """Create default feature access configuration."""
    FeatureAccess = apps.get_model('skyspy', 'FeatureAccess')

    features = [
        'aircraft', 'alerts', 'safety', 'audio', 'acars',
        'history', 'system', 'users', 'roles'
    ]

    for feature in features:
        FeatureAccess.objects.get_or_create(
            feature=feature,
            defaults={
                'read_access': 'authenticated',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )


def reverse_roles(apps, schema_editor):
    """Remove default roles."""
    Role = apps.get_model('skyspy', 'Role')
    Role.objects.filter(is_system=True).delete()


def reverse_feature_access(apps, schema_editor):
    """Remove default feature access."""
    FeatureAccess = apps.get_model('skyspy', 'FeatureAccess')
    FeatureAccess.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0002_auth_models'),
    ]

    operations = [
        migrations.RunPython(create_default_roles, reverse_roles),
        migrations.RunPython(create_default_feature_access, reverse_feature_access),
    ]
