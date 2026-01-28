# Data migration to update admin role permissions

from django.db import migrations


def update_admin_permissions(apps, schema_editor):
    """Update admin role to include limited user/role viewing permissions."""
    Role = apps.get_model('skyspy', 'Role')

    try:
        admin_role = Role.objects.get(name='admin')
        admin_permissions = [
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
        ]
        admin_role.permissions = admin_permissions
        admin_role.description = 'Full feature access with limited user management'
        admin_role.save()
    except Role.DoesNotExist:
        pass  # Role doesn't exist yet, will be created by earlier migration


def reverse_admin_permissions(apps, schema_editor):
    """Revert admin role permissions."""
    Role = apps.get_model('skyspy', 'Role')

    try:
        admin_role = Role.objects.get(name='admin')
        admin_permissions = [
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
        ]
        admin_role.permissions = admin_permissions
        admin_role.description = 'Full feature access except user management'
        admin_role.save()
    except Role.DoesNotExist:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0008_extend_api_key_prefix'),
    ]

    operations = [
        migrations.RunPython(update_admin_permissions, reverse_admin_permissions),
    ]
