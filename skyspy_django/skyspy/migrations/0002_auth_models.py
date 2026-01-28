# Generated migration for authentication models

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('skyspy', '0001_add_antenna_analytics_snapshot'),
    ]

    operations = [
        # Create Role model
        migrations.CreateModel(
            name='Role',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=50, unique=True)),
                ('display_name', models.CharField(max_length=100)),
                ('description', models.TextField(blank=True, null=True)),
                ('permissions', models.JSONField(default=list, help_text='List of permission strings')),
                ('is_system', models.BooleanField(default=False, help_text='System roles cannot be deleted')),
                ('priority', models.IntegerField(default=0, help_text='Higher priority roles appear first')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'roles',
                'ordering': ['-priority', 'name'],
            },
        ),

        # Create SkyspyUser model
        migrations.CreateModel(
            name='SkyspyUser',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('auth_provider', models.CharField(choices=[('local', 'Local'), ('oidc', 'OIDC')], default='local', max_length=20)),
                ('oidc_subject', models.CharField(blank=True, db_index=True, help_text='OIDC subject identifier (sub claim)', max_length=255, null=True, unique=True)),
                ('oidc_issuer', models.CharField(blank=True, help_text='OIDC issuer URL', max_length=500, null=True)),
                ('oidc_claims', models.JSONField(blank=True, help_text='Cached OIDC claims from last login', null=True)),
                ('display_name', models.CharField(blank=True, max_length=100, null=True)),
                ('avatar_url', models.URLField(blank=True, null=True)),
                ('last_active', models.DateTimeField(blank=True, null=True)),
                ('last_login_ip', models.GenericIPAddressField(blank=True, null=True)),
                ('preferences', models.JSONField(blank=True, default=dict, help_text='User preferences (map settings, notifications, etc.)')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='skyspy_profile', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'SkySpy User',
                'verbose_name_plural': 'SkySpy Users',
                'db_table': 'skyspy_users',
            },
        ),

        # Create UserRole model
        migrations.CreateModel(
            name='UserRole',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('expires_at', models.DateTimeField(blank=True, help_text='Role assignment expires at this time', null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('assigned_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='role_assignments_made', to=settings.AUTH_USER_MODEL)),
                ('role', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='user_assignments', to='skyspy.role')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='user_roles', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'user_roles',
                'unique_together': {('user', 'role')},
            },
        ),
        migrations.AddIndex(
            model_name='userrole',
            index=models.Index(fields=['user', 'expires_at'], name='idx_user_role_expiry'),
        ),

        # Create APIKey model
        migrations.CreateModel(
            name='APIKey',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Descriptive name for this API key', max_length=100)),
                ('key_hash', models.CharField(db_index=True, max_length=64, unique=True)),
                ('key_prefix', models.CharField(max_length=8)),
                ('scopes', models.JSONField(blank=True, default=list, help_text='Permission scopes for this key (empty = all user permissions)')),
                ('is_active', models.BooleanField(default=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('last_used_ip', models.GenericIPAddressField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='api_keys', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'api_keys',
                'ordering': ['-created_at'],
            },
        ),

        # Create FeatureAccess model
        migrations.CreateModel(
            name='FeatureAccess',
            fields=[
                ('feature', models.CharField(choices=[('aircraft', 'Aircraft Tracking'), ('alerts', 'Alert Rules'), ('safety', 'Safety Events'), ('audio', 'Audio Transmissions'), ('acars', 'ACARS Messages'), ('history', 'Flight History'), ('system', 'System Status'), ('users', 'User Management'), ('roles', 'Role Management')], max_length=30, primary_key=True, serialize=False, unique=True)),
                ('read_access', models.CharField(choices=[('public', 'Public'), ('authenticated', 'Authenticated'), ('permission', 'Permission')], default='authenticated', help_text='Access level required to view this feature', max_length=20)),
                ('write_access', models.CharField(choices=[('public', 'Public'), ('authenticated', 'Authenticated'), ('permission', 'Permission')], default='permission', help_text='Access level required to modify this feature', max_length=20)),
                ('is_enabled', models.BooleanField(default=True, help_text='Whether this feature is enabled at all')),
                ('settings', models.JSONField(blank=True, default=dict, help_text='Feature-specific access settings')),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Feature Access',
                'verbose_name_plural': 'Feature Access',
                'db_table': 'feature_access',
            },
        ),

        # Create OIDCClaimMapping model
        migrations.CreateModel(
            name='OIDCClaimMapping',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Descriptive name for this mapping', max_length=100)),
                ('claim_name', models.CharField(help_text='OIDC claim name to match (e.g., groups, roles)', max_length=100)),
                ('match_type', models.CharField(choices=[('exact', 'Exact Match'), ('contains', 'Contains'), ('regex', 'Regex Match')], default='exact', max_length=20)),
                ('claim_value', models.CharField(help_text='Value to match in the claim', max_length=255)),
                ('priority', models.IntegerField(default=0, help_text='Higher priority mappings are processed first')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('role', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='claim_mappings', to='skyspy.role')),
            ],
            options={
                'db_table': 'oidc_claim_mappings',
                'ordering': ['-priority', 'name'],
            },
        ),

        # Add owner and is_shared fields to AlertRule
        migrations.AddField(
            model_name='alertrule',
            name='owner',
            field=models.ForeignKey(blank=True, help_text='Owner of this alert rule', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='alert_rules', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='alertrule',
            name='is_shared',
            field=models.BooleanField(default=False, help_text='If true, all users can see this rule (but only owner/admin can edit)'),
        ),
    ]
