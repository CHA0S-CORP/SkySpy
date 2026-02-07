"""
Add CPA enrichment fields to SafetyEvent model.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skyspy", "0023_watchedaircraft"),
    ]

    operations = [
        migrations.AddField(
            model_name="safetyevent",
            name="cpa_distance_nm",
            field=models.FloatField(blank=True, help_text="Predicted CPA distance in nautical miles", null=True),
        ),
        migrations.AddField(
            model_name="safetyevent",
            name="cpa_time_seconds",
            field=models.FloatField(blank=True, help_text="Time to CPA in seconds", null=True),
        ),
        migrations.AddField(
            model_name="safetyevent",
            name="cpa_lat",
            field=models.FloatField(blank=True, help_text="Predicted CPA latitude", null=True),
        ),
        migrations.AddField(
            model_name="safetyevent",
            name="cpa_lon",
            field=models.FloatField(blank=True, help_text="Predicted CPA longitude", null=True),
        ),
    ]
