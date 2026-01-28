"""
Migration for alert and notification system improvements.

Covers:
- AlertRule: visibility, is_system, suppression_windows
- AlertHistory: user tracking, acknowledgment fields
- AlertSubscription: new model
- AlertAggregate: new model
- NotificationChannel: new model
- NotificationTemplate: new model
- NotificationLog: retry tracking fields
- UserNotificationPreference: new model
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def mark_existing_rules_as_system(apps, schema_editor):
    """Mark existing alert rules as system/public for backwards compatibility."""
    AlertRule = apps.get_model('skyspy', 'AlertRule')
    AlertRule.objects.all().update(
        is_system=True,
        visibility='public'
    )


def reverse_mark_rules(apps, schema_editor):
    """Reverse the system/public marking."""
    AlertRule = apps.get_model('skyspy', 'AlertRule')
    AlertRule.objects.all().update(
        is_system=False,
        visibility='private'
    )


def create_default_templates(apps, schema_editor):
    """Create default notification templates."""
    NotificationTemplate = apps.get_model('skyspy', 'NotificationTemplate')

    templates = [
        {
            'name': 'default_alert',
            'description': 'Default template for alert notifications',
            'title_template': 'Alert: {rule_name}',
            'body_template': '{callsign} ({icao}) at {altitude}ft triggered rule: {rule_name}',
            'is_default': True,
        },
        {
            'name': 'critical_alert',
            'description': 'Template for critical priority alerts',
            'title_template': '🚨 CRITICAL: {rule_name}',
            'body_template': 'CRITICAL ALERT: {callsign} ({icao}) at {altitude}ft, {distance}nm away. Rule: {rule_name}',
            'priority': 'critical',
        },
        {
            'name': 'safety_event',
            'description': 'Template for safety events',
            'title_template': '⚠️ Safety: {event_type}',
            'body_template': '{severity} safety event: {event_message}\nAircraft: {callsign} ({icao})',
            'event_type': 'safety',
        },
        {
            'name': 'military_alert',
            'description': 'Template for military aircraft detections',
            'title_template': '🎖️ Military: {callsign}',
            'body_template': 'Military aircraft detected: {callsign} ({icao})\nType: {aircraft_type}\nAltitude: {altitude}ft, Distance: {distance}nm',
            'event_type': 'military',
        },
        {
            'name': 'emergency_alert',
            'description': 'Template for emergency squawk codes',
            'title_template': '🆘 EMERGENCY: {callsign}',
            'body_template': 'EMERGENCY SQUAWK {squawk}\nAircraft: {callsign} ({icao})\nAltitude: {altitude}ft, Position: {lat}, {lon}',
            'event_type': 'emergency',
            'priority': 'critical',
        },
    ]

    for template_data in templates:
        NotificationTemplate.objects.get_or_create(
            name=template_data['name'],
            defaults=template_data
        )


def reverse_templates(apps, schema_editor):
    """Remove default templates."""
    NotificationTemplate = apps.get_model('skyspy', 'NotificationTemplate')
    NotificationTemplate.objects.filter(
        name__in=['default_alert', 'critical_alert', 'safety_event', 'military_alert', 'emergency_alert']
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0003_default_roles'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # =====================================================
        # AlertRule: Add new fields
        # =====================================================
        migrations.AddField(
            model_name='alertrule',
            name='visibility',
            field=models.CharField(
                choices=[('private', 'Private'), ('shared', 'Shared'), ('public', 'Public')],
                default='private',
                help_text='Who can see this rule: private (owner only), shared (subscribers), public (everyone)',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='alertrule',
            name='is_system',
            field=models.BooleanField(
                default=False,
                help_text='System rules cannot be deleted by users',
            ),
        ),
        migrations.AddField(
            model_name='alertrule',
            name='suppression_windows',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Time windows when this rule should not trigger. Format: [{"day": "saturday", "start": "22:00", "end": "08:00"}]',
            ),
        ),
        migrations.AddIndex(
            model_name='alertrule',
            index=models.Index(fields=['visibility', 'enabled'], name='idx_alert_rules_vis'),
        ),
        migrations.AddIndex(
            model_name='alertrule',
            index=models.Index(fields=['owner', 'enabled'], name='idx_alert_rules_owner'),
        ),

        # =====================================================
        # AlertHistory: Add user tracking and acknowledgment
        # =====================================================
        migrations.AddField(
            model_name='alerthistory',
            name='user',
            field=models.ForeignKey(
                blank=True,
                help_text='Owner of the rule that triggered this alert',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='alert_history',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='alerthistory',
            name='session_key',
            field=models.CharField(
                blank=True,
                help_text='Session key for anonymous users',
                max_length=40,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='alerthistory',
            name='acknowledged',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='alerthistory',
            name='acknowledged_by',
            field=models.ForeignKey(
                blank=True,
                help_text='User who acknowledged this alert',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='acknowledged_alerts',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='alerthistory',
            name='acknowledged_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='alerthistory',
            index=models.Index(fields=['user', 'triggered_at'], name='idx_alert_hist_user'),
        ),
        migrations.AddIndex(
            model_name='alerthistory',
            index=models.Index(fields=['acknowledged', 'triggered_at'], name='idx_alert_hist_ack'),
        ),

        # =====================================================
        # AlertSubscription: New model
        # =====================================================
        migrations.CreateModel(
            name='AlertSubscription',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('session_key', models.CharField(blank=True, help_text='Session key for anonymous subscriptions', max_length=40, null=True)),
                ('notify_on_trigger', models.BooleanField(default=True, help_text='Whether to send notifications when rule triggers')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('rule', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='subscriptions', to='skyspy.alertrule')),
                ('user', models.ForeignKey(blank=True, help_text='Subscribed user (null for anonymous)', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='alert_subscriptions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'alert_subscriptions',
            },
        ),
        migrations.AddIndex(
            model_name='alertsubscription',
            index=models.Index(fields=['rule', 'notify_on_trigger'], name='idx_alert_sub_rule'),
        ),
        migrations.AlterUniqueTogether(
            name='alertsubscription',
            unique_together={('session_key', 'rule'), ('user', 'rule')},
        ),

        # =====================================================
        # AlertAggregate: New model
        # =====================================================
        migrations.CreateModel(
            name='AlertAggregate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('window_start', models.DateTimeField(db_index=True)),
                ('window_end', models.DateTimeField()),
                ('trigger_count', models.IntegerField(default=0)),
                ('unique_aircraft', models.IntegerField(default=0)),
                ('sample_aircraft', models.JSONField(default=list, help_text='Sample of aircraft that triggered (first few)')),
                ('rule', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='aggregates', to='skyspy.alertrule')),
            ],
            options={
                'db_table': 'alert_aggregates',
                'ordering': ['-window_start'],
            },
        ),
        migrations.AddIndex(
            model_name='alertaggregate',
            index=models.Index(fields=['rule', 'window_start'], name='idx_alert_agg_rule'),
        ),

        # =====================================================
        # NotificationChannel: New model
        # =====================================================
        migrations.CreateModel(
            name='NotificationChannel',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Friendly name for this channel', max_length=100)),
                ('channel_type', models.CharField(
                    choices=[
                        ('discord', 'Discord'), ('slack', 'Slack'), ('pushover', 'Pushover'),
                        ('telegram', 'Telegram'), ('email', 'Email'), ('webhook', 'Generic Webhook'),
                        ('ntfy', 'ntfy'), ('gotify', 'Gotify'), ('home_assistant', 'Home Assistant'),
                        ('twilio', 'Twilio SMS'), ('custom', 'Custom Apprise URL'),
                    ],
                    help_text='Type of notification service',
                    max_length=30,
                )),
                ('apprise_url', models.TextField(help_text='Apprise-compatible URL for this channel')),
                ('description', models.CharField(blank=True, max_length=200, null=True)),
                ('supports_rich', models.BooleanField(default=False, help_text='Whether this channel supports rich formatting (embeds, blocks)')),
                ('is_global', models.BooleanField(default=True, help_text='If true, this channel is available to all users')),
                ('enabled', models.BooleanField(default=True)),
                ('verified', models.BooleanField(default=False, help_text='Whether a test notification has succeeded')),
                ('last_success', models.DateTimeField(blank=True, null=True)),
                ('last_failure', models.DateTimeField(blank=True, null=True)),
                ('last_error', models.TextField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(
                    blank=True,
                    help_text='Owner of this channel (for non-global channels)',
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='notification_channels',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': 'notification_channels',
                'ordering': ['name'],
            },
        ),
        migrations.AddIndex(
            model_name='notificationchannel',
            index=models.Index(fields=['channel_type', 'enabled'], name='idx_notif_chan_type'),
        ),
        migrations.AddIndex(
            model_name='notificationchannel',
            index=models.Index(fields=['is_global', 'enabled'], name='idx_notif_chan_global'),
        ),

        # =====================================================
        # NotificationTemplate: New model
        # =====================================================
        migrations.CreateModel(
            name='NotificationTemplate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Unique identifier for this template', max_length=100, unique=True)),
                ('description', models.CharField(blank=True, max_length=200, null=True)),
                ('title_template', models.CharField(
                    default='Alert: {rule_name}',
                    help_text='Template for notification title. Use {variable} syntax.',
                    max_length=200,
                )),
                ('body_template', models.TextField(
                    default='{callsign} at {altitude}ft triggered {rule_name}',
                    help_text='Template for notification body. Use {variable} syntax.',
                )),
                ('discord_embed', models.JSONField(blank=True, help_text='Discord embed JSON template', null=True)),
                ('slack_blocks', models.JSONField(blank=True, help_text='Slack Block Kit JSON template', null=True)),
                ('event_type', models.CharField(
                    blank=True,
                    choices=[
                        ('alert', 'Alert'), ('safety', 'Safety Event'), ('military', 'Military Aircraft'),
                        ('emergency', 'Emergency'), ('proximity', 'Proximity Alert'), ('tcas', 'TCAS Event'),
                    ],
                    help_text='If set, only use this template for specific event types',
                    max_length=30,
                    null=True,
                )),
                ('priority', models.CharField(
                    blank=True,
                    choices=[('info', 'Info'), ('warning', 'Warning'), ('critical', 'Critical')],
                    help_text='If set, only use this template for specific priorities',
                    max_length=20,
                    null=True,
                )),
                ('is_default', models.BooleanField(default=False, help_text='Use this template when no other template matches')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'notification_templates',
                'ordering': ['name'],
            },
        ),

        # =====================================================
        # NotificationLog: Add retry tracking fields
        # =====================================================
        migrations.AddField(
            model_name='notificationlog',
            name='channel',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='logs',
                to='skyspy.notificationchannel',
            ),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='channel_url',
            field=models.TextField(blank=True, help_text='The actual URL used (may differ from channel if overridden)', null=True),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='status',
            field=models.CharField(
                choices=[('pending', 'Pending'), ('sent', 'Sent'), ('failed', 'Failed'), ('retrying', 'Retrying')],
                default='pending',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='retry_count',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='max_retries',
            field=models.IntegerField(default=3),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='next_retry_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='last_error',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='notificationlog',
            name='duration_ms',
            field=models.IntegerField(blank=True, help_text='Time taken to send notification', null=True),
        ),
        migrations.AddIndex(
            model_name='notificationlog',
            index=models.Index(fields=['status', 'next_retry_at'], name='idx_notif_log_retry'),
        ),

        # =====================================================
        # UserNotificationPreference: New model
        # =====================================================
        migrations.CreateModel(
            name='UserNotificationPreference',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('min_priority', models.CharField(
                    choices=[('info', 'Info'), ('warning', 'Warning'), ('critical', 'Critical')],
                    default='info',
                    help_text='Minimum priority level to receive notifications',
                    max_length=20,
                )),
                ('event_types', models.JSONField(blank=True, default=list, help_text='List of event types to receive. Empty = all types.')),
                ('quiet_hours_start', models.TimeField(blank=True, help_text='Start of quiet hours (notifications muted)', null=True)),
                ('quiet_hours_end', models.TimeField(blank=True, help_text='End of quiet hours', null=True)),
                ('critical_overrides_quiet', models.BooleanField(default=True, help_text='If true, critical notifications ignore quiet hours')),
                ('timezone', models.CharField(default='UTC', help_text='Timezone for quiet hours calculation', max_length=50)),
                ('enabled', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('channel', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='user_preferences',
                    to='skyspy.notificationchannel',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='notification_preferences',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': 'user_notification_preferences',
            },
        ),
        migrations.AlterUniqueTogether(
            name='usernotificationpreference',
            unique_together={('user', 'channel')},
        ),

        # =====================================================
        # Data migrations
        # =====================================================
        migrations.RunPython(mark_existing_rules_as_system, reverse_mark_rules),
        migrations.RunPython(create_default_templates, reverse_templates),
    ]
