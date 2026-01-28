"""
Migration to add notification channels relationship to AlertRule.

Adds:
- AlertRule.notification_channels: ManyToMany to NotificationChannel
- AlertRule.use_global_notifications: Boolean to also use env-based APPRISE_URLS
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0004_alert_notification_improvements'),
    ]

    operations = [
        # Add ManyToMany relationship between AlertRule and NotificationChannel
        migrations.AddField(
            model_name='alertrule',
            name='notification_channels',
            field=models.ManyToManyField(
                blank=True,
                help_text='Notification channels to send alerts to when this rule triggers',
                related_name='alert_rules',
                to='skyspy.notificationchannel',
            ),
        ),

        # Add option to also use global notifications from environment
        migrations.AddField(
            model_name='alertrule',
            name='use_global_notifications',
            field=models.BooleanField(
                default=True,
                help_text='Also send to global notification URLs from environment',
            ),
        ),
    ]
