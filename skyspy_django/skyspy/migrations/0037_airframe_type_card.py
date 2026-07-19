from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0036_chat_sessions"),
    ]

    operations = [
        migrations.CreateModel(
            name="AirframeTypeCard",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("type_code", models.CharField(db_index=True, max_length=10, unique=True)),
                ("name", models.CharField(blank=True, max_length=120, null=True)),
                ("manufacturer", models.CharField(blank=True, max_length=120, null=True)),
                ("category", models.CharField(blank=True, max_length=20, null=True)),
                ("role", models.CharField(blank=True, max_length=120, null=True)),
                ("length_m", models.FloatField(blank=True, null=True)),
                ("span_m", models.FloatField(blank=True, null=True)),
                ("height_m", models.FloatField(blank=True, null=True)),
                ("mtow_kg", models.FloatField(blank=True, null=True)),
                ("cruise_kt", models.FloatField(blank=True, null=True)),
                ("range_nm", models.FloatField(blank=True, null=True)),
                ("ceiling_ft", models.FloatField(blank=True, null=True)),
                ("first_flight", models.IntegerField(blank=True, null=True)),
                ("shape", models.JSONField(default=dict)),
                ("blurb", models.TextField(blank=True, null=True)),
                ("powerplant", models.CharField(blank=True, max_length=200, null=True)),
                ("variants", models.CharField(blank=True, max_length=200, null=True)),
                ("wtc", models.CharField(blank=True, max_length=40, null=True)),
                ("photo_icao_hex", models.CharField(blank=True, max_length=10, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("generated", "Generated"), ("stub", "Stub"), ("failed", "Failed")],
                        db_index=True,
                        default="generated",
                        max_length=12,
                    ),
                ),
                ("confidence", models.FloatField(blank=True, null=True)),
                ("seen_tail_count", models.IntegerField(default=0)),
                ("model_used", models.CharField(blank=True, max_length=100, null=True)),
                ("generated_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "airframe_type_card",
            },
        ),
        migrations.AddIndex(
            model_name="airframetypecard",
            index=models.Index(fields=["status", "-updated_at"], name="idx_aftc_status_updated"),
        ),
    ]
