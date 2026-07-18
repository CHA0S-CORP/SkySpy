from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0027_safety_event_choices"),
    ]

    operations = [
        migrations.AddField(
            model_name="aircraftinfo",
            name="field_sources",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aircraftinfo",
            name="owner_type",
            field=models.CharField(blank=True, max_length=20, null=True),
        ),
        migrations.AddField(
            model_name="aircraftinfo",
            name="is_shell_suspected",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="aircraftinfo",
            name="shell_score",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aircraftinfo",
            name="ownership_flags",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="airframesourcedata",
            name="source",
            field=models.CharField(
                choices=[
                    ("faa", "FAA Registry"),
                    ("adsbx", "ADS-B Exchange"),
                    ("tar1090", "tar1090-db"),
                    ("opensky", "OpenSky Network"),
                    ("hexdb", "HexDB API"),
                    ("adsblol", "adsb.lol API"),
                    ("adsbdb", "ADSBdb API"),
                    ("planespotters", "Planespotters API"),
                ],
                db_index=True,
                max_length=20,
            ),
        ),
    ]
