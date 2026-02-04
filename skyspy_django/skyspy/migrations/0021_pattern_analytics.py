# Generated migration for Pattern Analytics and updated pattern types

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("skyspy", "0020_community_submissions"),
    ]

    operations = [
        # Update CannonballPattern pattern_type choices to include new patterns
        migrations.AlterField(
            model_name="cannonballpattern",
            name="pattern_type",
            field=models.CharField(
                choices=[
                    ("circling", "Circling"),
                    ("loitering", "Loitering"),
                    ("grid_search", "Grid Search"),
                    ("speed_trap", "Speed Trap"),
                    ("parallel_highway", "Parallel to Highway"),
                    ("surveillance", "General Surveillance"),
                    ("pursuit", "Pursuit Pattern"),
                    ("stakeout", "Stakeout Loitering"),
                    ("racetrack", "Racetrack Orbit"),
                    ("highway_tracking", "Highway Tracking"),
                    ("area_search", "Expanding Area Search"),
                ],
                max_length=30,
            ),
        ),
        # Create PatternAnalytics model
        migrations.CreateModel(
            name="PatternAnalytics",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("icao_hex", models.CharField(db_index=True, max_length=10)),
                ("pattern_type", models.CharField(max_length=30)),
                ("confidence_score", models.FloatField()),
                (
                    "was_confirmed_le",
                    models.BooleanField(
                        blank=True,
                        help_text="User confirmation if this was actually LE (null=unknown)",
                        null=True,
                    ),
                ),
                (
                    "false_positive_reported",
                    models.BooleanField(
                        default=False,
                        help_text="User reported this as a false positive",
                    ),
                ),
                ("duration_seconds", models.IntegerField()),
                (
                    "area_nm_sq",
                    models.FloatField(
                        blank=True,
                        help_text="Area covered in nm²",
                        null=True,
                    ),
                ),
                ("orbit_count", models.IntegerField(blank=True, null=True)),
                (
                    "altitude_consistency",
                    models.FloatField(
                        blank=True,
                        help_text="Standard deviation of altitude during pattern",
                        null=True,
                    ),
                ),
                ("center_lat", models.FloatField()),
                ("center_lon", models.FloatField()),
                (
                    "pattern_metadata",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="Additional pattern-specific metrics for analysis",
                    ),
                ),
                ("detected_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("feedback_at", models.DateTimeField(blank=True, null=True)),
                (
                    "feedback_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pattern_feedback",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "cannonball_pattern_analytics",
                "ordering": ["-detected_at"],
            },
        ),
        # Add indexes for PatternAnalytics
        migrations.AddIndex(
            model_name="patternanalytics",
            index=models.Index(
                fields=["pattern_type", "was_confirmed_le"],
                name="idx_cb_pa_type_confirm",
            ),
        ),
        migrations.AddIndex(
            model_name="patternanalytics",
            index=models.Index(
                fields=["false_positive_reported", "detected_at"],
                name="idx_cb_pa_fp",
            ),
        ),
    ]
