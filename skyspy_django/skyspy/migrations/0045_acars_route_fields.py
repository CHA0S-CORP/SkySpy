from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0044_acars_ts_notiflog_title_priority"),
    ]

    operations = [
        # Persist route metadata parsed from the source message (notably the
        # airframes.io firehose) instead of discarding it at store time.
        migrations.AddField(
            model_name="acarsmessage",
            name="depa",
            field=models.CharField(blank=True, max_length=10, null=True),
        ),
        migrations.AddField(
            model_name="acarsmessage",
            name="dsta",
            field=models.CharField(blank=True, max_length=10, null=True),
        ),
        migrations.AddField(
            model_name="acarsmessage",
            name="eta",
            field=models.CharField(blank=True, max_length=32, null=True),
        ),
    ]
