from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0028_aircraftinfo_provenance_ownership"),
    ]

    operations = [
        migrations.CreateModel(
            name="AircraftIncident",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("icao_hex", models.CharField(blank=True, db_index=True, max_length=10, null=True)),
                ("registration", models.CharField(db_index=True, max_length=20)),
                (
                    "source",
                    models.CharField(
                        choices=[("ntsb", "NTSB (US)"), ("asn", "Aviation Safety Network")],
                        db_index=True,
                        default="ntsb",
                        max_length=20,
                    ),
                ),
                ("external_id", models.CharField(db_index=True, max_length=50)),
                ("event_type", models.CharField(blank=True, max_length=50, null=True)),
                ("event_date", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("severity", models.CharField(blank=True, max_length=50, null=True)),
                ("city", models.CharField(blank=True, max_length=100, null=True)),
                ("state", models.CharField(blank=True, max_length=50, null=True)),
                ("country", models.CharField(blank=True, max_length=50, null=True)),
                ("make", models.CharField(blank=True, max_length=100, null=True)),
                ("model", models.CharField(blank=True, max_length=100, null=True)),
                ("report_number", models.CharField(blank=True, max_length=50, null=True)),
                ("narrative", models.TextField(blank=True, null=True)),
                ("url", models.CharField(blank=True, max_length=500, null=True)),
                ("raw_data", models.JSONField(default=dict)),
                ("fetched_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "aircraft_incident",
                "unique_together": {("source", "external_id")},
            },
        ),
        migrations.AddIndex(
            model_name="aircraftincident",
            index=models.Index(fields=["registration", "event_date"], name="idx_incident_reg_date"),
        ),
    ]
