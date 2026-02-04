# Generated migration for LE Data Sources and CannonballKnownAircraft extensions

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("skyspy", "0017_seed_notable_data"),
    ]

    operations = [
        # Create LEDataSource model
        migrations.CreateModel(
            name="LEDataSource",
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
                ("name", models.CharField(max_length=100, unique=True)),
                (
                    "source_type",
                    models.CharField(
                        choices=[
                            ("buzzfeed", "BuzzFeed Spy Planes"),
                            ("academic", "Academic Research"),
                            ("community_project", "Community Project"),
                            ("foia", "FOIA Request"),
                            ("government", "Government Registry"),
                            ("news_investigation", "News Investigation"),
                        ],
                        max_length=30,
                    ),
                ),
                ("url", models.URLField(blank=True, null=True)),
                ("description", models.TextField(blank=True)),
                ("record_count", models.IntegerField(default=0)),
                (
                    "confidence_weight",
                    models.FloatField(
                        default=1.0,
                        help_text="Weight factor for confidence calculations (0.0-2.0)",
                    ),
                ),
                ("last_fetched", models.DateTimeField(blank=True, null=True)),
                ("last_successful_fetch", models.DateTimeField(blank=True, null=True)),
                ("update_frequency_hours", models.IntegerField(default=168)),
                ("fetch_enabled", models.BooleanField(default=True)),
                (
                    "attribution_text",
                    models.CharField(
                        blank=True,
                        help_text="Required attribution for this data source",
                        max_length=500,
                    ),
                ),
                (
                    "fetch_errors",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text="Recent fetch errors for debugging",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "cannonball_le_data_sources",
                "ordering": ["name"],
            },
        ),
        # Update CannonballKnownAircraft source choices
        migrations.AlterField(
            model_name="cannonballknownaircraft",
            name="source",
            field=models.CharField(
                choices=[
                    ("faa", "FAA Registry"),
                    ("opensky", "OpenSky Database"),
                    ("manual", "Manual Entry"),
                    ("community", "Community Submission"),
                    ("research", "Research/FOIA"),
                    ("buzzfeed", "BuzzFeed Investigation"),
                    ("academic", "Academic Research"),
                    ("external_db", "External Database"),
                ],
                default="manual",
                max_length=20,
            ),
        ),
        # Add new fields to CannonballKnownAircraft
        migrations.AddField(
            model_name="cannonballknownaircraft",
            name="data_source",
            field=models.ForeignKey(
                blank=True,
                help_text="External data source this record came from",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aircraft",
                to="skyspy.ledatasource",
            ),
        ),
        migrations.AddField(
            model_name="cannonballknownaircraft",
            name="confidence_score",
            field=models.FloatField(
                default=0.5,
                help_text="Confidence score 0.0-1.0 based on source reliability and corroboration",
            ),
        ),
        migrations.AddField(
            model_name="cannonballknownaircraft",
            name="evidence_links",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Supporting URLs and evidence links",
            ),
        ),
        migrations.AddField(
            model_name="cannonballknownaircraft",
            name="external_ids",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Source-specific IDs (e.g., {'buzzfeed_id': '123', 'faa_id': 'N12345'})",
            ),
        ),
    ]
