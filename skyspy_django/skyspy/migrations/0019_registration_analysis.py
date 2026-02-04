# Generated migration for Registration Analysis models

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("skyspy", "0018_le_data_sources"),
    ]

    operations = [
        # Create RegistrationAnalysis model
        migrations.CreateModel(
            name="RegistrationAnalysis",
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
                ("icao_hex", models.CharField(db_index=True, max_length=10, unique=True)),
                ("registration", models.CharField(db_index=True, max_length=20)),
                ("owner_name", models.CharField(max_length=200)),
                ("owner_address", models.TextField(blank=True)),
                ("owner_city", models.CharField(blank=True, max_length=100)),
                ("owner_state", models.CharField(blank=True, max_length=2)),
                ("owner_zip", models.CharField(blank=True, max_length=20)),
                (
                    "llc_no_web_presence",
                    models.FloatField(
                        default=0.0,
                        help_text="Score for LLC with no web presence (0.0-1.0)",
                    ),
                ),
                (
                    "registered_agent_address",
                    models.FloatField(
                        default=0.0,
                        help_text="Score for using registered agent address (0.0-1.0)",
                    ),
                ),
                (
                    "po_box_address",
                    models.FloatField(
                        default=0.0,
                        help_text="Score for PO Box address (0.0-1.0)",
                    ),
                ),
                (
                    "multiple_transfers",
                    models.FloatField(
                        default=0.0,
                        help_text="Score for multiple recent ownership transfers (0.0-1.0)",
                    ),
                ),
                (
                    "trust_ownership",
                    models.FloatField(
                        default=0.0,
                        help_text="Score for trust-based ownership (0.0-1.0)",
                    ),
                ),
                (
                    "generic_llc_name",
                    models.FloatField(
                        default=0.0,
                        help_text="Score for generic aviation LLC name pattern (0.0-1.0)",
                    ),
                ),
                (
                    "shell_company_score",
                    models.FloatField(
                        default=0.0,
                        help_text="Weighted aggregate shell company likelihood score (0.0-1.0)",
                    ),
                ),
                (
                    "risk_level",
                    models.CharField(
                        choices=[("low", "Low"), ("medium", "Medium"), ("high", "High")],
                        default="low",
                        max_length=10,
                    ),
                ),
                ("manually_reviewed", models.BooleanField(default=False)),
                (
                    "is_confirmed_le",
                    models.BooleanField(
                        blank=True,
                        help_text="Manual confirmation of LE ownership (null=unknown)",
                        null=True,
                    ),
                ),
                ("review_notes", models.TextField(blank=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("faa_last_action_date", models.DateField(blank=True, null=True)),
                ("certificate_issue_date", models.DateField(blank=True, null=True)),
                ("aircraft_type", models.CharField(blank=True, max_length=50)),
                ("aircraft_manufacturer", models.CharField(blank=True, max_length=100)),
                ("aircraft_model", models.CharField(blank=True, max_length=50)),
                ("aircraft_year", models.IntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="registration_reviews",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "cannonball_registration_analysis",
                "ordering": ["-shell_company_score", "-updated_at"],
                "verbose_name_plural": "Registration analyses",
            },
        ),
        # Create RegistrationTransfer model
        migrations.CreateModel(
            name="RegistrationTransfer",
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
                ("registration", models.CharField(db_index=True, max_length=20)),
                ("previous_owner", models.CharField(max_length=200)),
                ("new_owner", models.CharField(max_length=200)),
                ("transfer_date", models.DateField()),
                (
                    "days_since_last_transfer",
                    models.IntegerField(
                        blank=True,
                        help_text="Days between this transfer and the previous one",
                        null=True,
                    ),
                ),
                (
                    "previous_owner_type",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("individual", "Individual"),
                            ("corporation", "Corporation"),
                            ("llc", "LLC"),
                            ("trust", "Trust"),
                            ("government", "Government"),
                            ("unknown", "Unknown"),
                        ],
                        max_length=20,
                    ),
                ),
                (
                    "new_owner_type",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("individual", "Individual"),
                            ("corporation", "Corporation"),
                            ("llc", "LLC"),
                            ("trust", "Trust"),
                            ("government", "Government"),
                            ("unknown", "Unknown"),
                        ],
                        max_length=20,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "cannonball_registration_transfers",
                "ordering": ["-transfer_date"],
            },
        ),
        # Add indexes for RegistrationAnalysis
        migrations.AddIndex(
            model_name="registrationanalysis",
            index=models.Index(
                fields=["shell_company_score", "risk_level"],
                name="idx_cb_reg_score",
            ),
        ),
        migrations.AddIndex(
            model_name="registrationanalysis",
            index=models.Index(fields=["registration"], name="idx_cb_reg_registration"),
        ),
        migrations.AddIndex(
            model_name="registrationanalysis",
            index=models.Index(
                fields=["is_confirmed_le", "manually_reviewed"],
                name="idx_cb_reg_review",
            ),
        ),
        # Add index for RegistrationTransfer
        migrations.AddIndex(
            model_name="registrationtransfer",
            index=models.Index(
                fields=["registration", "transfer_date"],
                name="idx_cb_transfer_reg_date",
            ),
        ),
    ]
