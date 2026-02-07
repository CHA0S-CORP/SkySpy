"""
Migration for WatchedAircraft model.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skyspy", "0022_add_timestamp_indexes"),
    ]

    operations = [
        migrations.CreateModel(
            name="WatchedAircraft",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("hex", models.CharField(db_index=True, max_length=6, unique=True)),
                ("callsign", models.CharField(blank=True, default="", max_length=10)),
                ("registration", models.CharField(blank=True, default="", max_length=10)),
                ("type_code", models.CharField(blank=True, default="", max_length=4)),
                ("notes", models.TextField(blank=True, default="")),
                ("added_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "watched_aircraft",
                "ordering": ["-added_at"],
            },
        ),
    ]
