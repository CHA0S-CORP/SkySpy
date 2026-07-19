from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0041_cannonball_services_features"),
    ]

    operations = [
        migrations.CreateModel(
            name="CachedWildfire",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("fetched_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("event_id", models.IntegerField(db_index=True, unique=True)),
                ("name", models.CharField(blank=True, max_length=200, null=True)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("latitude", models.FloatField(db_index=True)),
                ("longitude", models.FloatField(db_index=True)),
                ("address", models.CharField(blank=True, max_length=300, null=True)),
                ("acreage", models.FloatField(blank=True, null=True)),
                ("containment", models.FloatField(blank=True, null=True)),
                ("is_prescribed", models.BooleanField(default=False)),
                ("evacuation_orders", models.TextField(blank=True, null=True)),
                ("evacuation_warnings", models.TextField(blank=True, null=True)),
                ("evacuation_advisories", models.TextField(blank=True, null=True)),
                ("threat_score", models.FloatField(blank=True, db_index=True, null=True)),
                ("date_modified", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("source_data", models.JSONField(blank=True, null=True)),
            ],
            options={
                "db_table": "cached_wildfires",
                "ordering": ["-threat_score"],
            },
        ),
        migrations.AddIndex(
            model_name="cachedwildfire",
            index=models.Index(fields=["latitude", "longitude"], name="idx_cached_wildfire_location"),
        ),
    ]
