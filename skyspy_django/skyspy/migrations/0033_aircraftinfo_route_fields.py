from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0032_remove_airframedocument_idx_airframe_doc_embedding"),
    ]

    operations = [
        migrations.AddField(
            model_name="aircraftinfo",
            name="route_data",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aircraftinfo",
            name="route_callsign",
            field=models.CharField(blank=True, max_length=16, null=True),
        ),
        migrations.AddField(
            model_name="aircraftinfo",
            name="route_fetched_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
