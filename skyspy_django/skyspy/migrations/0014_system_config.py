# Generated migration for SystemConfig and ConfigAuditLog models

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('skyspy', '0013_remove_airframesourcedata_unique_aircraft_source_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='SystemConfig',
            fields=[
                ('key', models.CharField(
                    help_text='Unique configuration key (e.g., safety.vs_change_threshold)',
                    max_length=100,
                    primary_key=True,
                    serialize=False
                )),
                ('category', models.CharField(
                    choices=[
                        ('adsb_sources', 'ADS-B Sources'),
                        ('location', 'Location'),
                        ('safety', 'Safety Monitoring'),
                        ('alerts', 'Alerts'),
                        ('acars', 'ACARS'),
                        ('storage', 'Storage'),
                        ('transcription', 'Transcription'),
                        ('external_apis', 'External APIs'),
                        ('monitoring', 'Monitoring'),
                        ('notifications', 'Notifications'),
                        ('aircraft_data', 'Aircraft Data'),
                        ('display', 'Display'),
                        ('advanced', 'Advanced'),
                    ],
                    db_index=True,
                    help_text='Configuration category for grouping in UI',
                    max_length=30
                )),
                ('value', models.TextField(
                    blank=True,
                    help_text='Current configuration value (stored as text)'
                )),
                ('value_type', models.CharField(
                    choices=[
                        ('string', 'String'),
                        ('integer', 'Integer'),
                        ('float', 'Float'),
                        ('boolean', 'Boolean'),
                        ('json', 'JSON'),
                        ('secret', 'Secret'),
                    ],
                    default='string',
                    help_text='Data type for proper serialization',
                    max_length=20
                )),
                ('display_name', models.CharField(
                    help_text='Human-readable name for UI display',
                    max_length=100
                )),
                ('description', models.TextField(
                    blank=True,
                    help_text='Detailed description of what this setting controls'
                )),
                ('validation_rules', models.JSONField(
                    blank=True,
                    default=dict,
                    help_text='Validation rules: {min, max, pattern, choices, required}'
                )),
                ('env_var', models.CharField(
                    blank=True,
                    help_text='Environment variable name that overrides this setting',
                    max_length=100,
                    null=True
                )),
                ('default_value', models.TextField(
                    blank=True,
                    help_text='Default value if not set'
                )),
                ('requires_restart', models.BooleanField(
                    default=False,
                    help_text='Whether changing this setting requires a service restart'
                )),
                ('is_sensitive', models.BooleanField(
                    default=False,
                    help_text='Whether this value should be masked in responses'
                )),
                ('is_readonly', models.BooleanField(
                    default=False,
                    help_text='Whether this setting can be modified (some are env-only)'
                )),
                ('sort_order', models.IntegerField(
                    default=0,
                    help_text='Display order within category'
                )),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(
                    blank=True,
                    help_text='User who last modified this setting',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='config_updates',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'verbose_name': 'System Configuration',
                'verbose_name_plural': 'System Configurations',
                'db_table': 'system_config',
                'ordering': ['category', 'sort_order', 'key'],
            },
        ),
        migrations.CreateModel(
            name='ConfigAuditLog',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID'
                )),
                ('config_key', models.CharField(
                    db_index=True,
                    help_text='Configuration key that was changed',
                    max_length=100
                )),
                ('old_value', models.TextField(
                    blank=True,
                    help_text='Previous value before change',
                    null=True
                )),
                ('new_value', models.TextField(
                    blank=True,
                    help_text='New value after change'
                )),
                ('changed_at', models.DateTimeField(
                    auto_now_add=True,
                    db_index=True,
                    help_text='When the change was made'
                )),
                ('ip_address', models.GenericIPAddressField(
                    blank=True,
                    help_text='IP address of the client making the change',
                    null=True
                )),
                ('changed_by', models.ForeignKey(
                    blank=True,
                    help_text='User who made the change',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='config_audit_logs',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'verbose_name': 'Configuration Audit Log',
                'verbose_name_plural': 'Configuration Audit Logs',
                'db_table': 'config_audit_log',
                'ordering': ['-changed_at'],
            },
        ),
        migrations.AddIndex(
            model_name='configauditlog',
            index=models.Index(
                fields=['config_key', 'changed_at'],
                name='idx_config_audit_key'
            ),
        ),
        migrations.AddIndex(
            model_name='configauditlog',
            index=models.Index(
                fields=['changed_by', 'changed_at'],
                name='idx_config_audit_user'
            ),
        ),
    ]
