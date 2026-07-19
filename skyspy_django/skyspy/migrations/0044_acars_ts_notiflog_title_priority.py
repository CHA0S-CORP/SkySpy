import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0043_weather_wildfires_features"),
    ]

    operations = [
        # AcarsMessage.timestamp: auto_now_add -> default so the real upstream
        # message time (parsed in acars._store_message) is honored instead of
        # being overwritten with the ingest time.
        migrations.AlterField(
            model_name="acarsmessage",
            name="timestamp",
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now),
        ),
        # NotificationLog: persist rendered title + priority so retries keep the
        # original context instead of a generic "SkysPy Notification"/"warning".
        migrations.AddField(
            model_name="notificationlog",
            name="title",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="notificationlog",
            name="priority",
            field=models.CharField(blank=True, max_length=20, null=True),
        ),
    ]
