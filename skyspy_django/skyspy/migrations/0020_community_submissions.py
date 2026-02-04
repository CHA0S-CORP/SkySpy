# Generated migration for Community Submissions models

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("skyspy", "0019_registration_analysis"),
    ]

    operations = [
        # Create SubmitterReputation model first (referenced by CommunitySubmission)
        migrations.CreateModel(
            name="SubmitterReputation",
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
                ("total_submissions", models.IntegerField(default=0)),
                ("approved_submissions", models.IntegerField(default=0)),
                ("rejected_submissions", models.IntegerField(default=0)),
                ("pending_submissions", models.IntegerField(default=0)),
                (
                    "reputation_score",
                    models.FloatField(
                        default=0.5,
                        help_text="Reputation score 0.0-1.0 based on approval rate and history",
                    ),
                ),
                (
                    "is_trusted",
                    models.BooleanField(
                        default=False,
                        help_text="Trusted submitters have higher confidence on their submissions",
                    ),
                ),
                (
                    "is_banned",
                    models.BooleanField(
                        default=False,
                        help_text="Banned users cannot submit new aircraft",
                    ),
                ),
                ("ban_reason", models.TextField(blank=True)),
                ("ban_expires_at", models.DateTimeField(blank=True, null=True)),
                ("first_submission_at", models.DateTimeField(blank=True, null=True)),
                ("last_submission_at", models.DateTimeField(blank=True, null=True)),
                ("last_approved_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cannonball_reputation",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "cannonball_submitter_reputation",
            },
        ),
        # Create CommunitySubmission model
        migrations.CreateModel(
            name="CommunitySubmission",
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
                ("registration", models.CharField(blank=True, max_length=20, null=True)),
                ("callsign_observed", models.CharField(blank=True, max_length=20, null=True)),
                ("agency_name", models.CharField(max_length=200)),
                (
                    "agency_type",
                    models.CharField(
                        choices=[
                            ("federal", "Federal"),
                            ("state", "State"),
                            ("local", "Local"),
                            ("military", "Military"),
                            ("unknown", "Unknown"),
                        ],
                        default="unknown",
                        max_length=20,
                    ),
                ),
                ("agency_state", models.CharField(blank=True, max_length=2, null=True)),
                ("agency_city", models.CharField(blank=True, max_length=100, null=True)),
                (
                    "evidence_type",
                    models.CharField(
                        choices=[
                            ("flight_pattern", "Observed Flight Pattern"),
                            ("callsign", "LE Callsign Observed"),
                            ("news", "News Report"),
                            ("foia", "FOIA Document"),
                            ("registry", "Registry Research"),
                            ("livery", "Aircraft Livery/Markings"),
                            ("public_records", "Public Records"),
                            ("other", "Other"),
                        ],
                        max_length=30,
                    ),
                ),
                (
                    "evidence_description",
                    models.TextField(
                        help_text="Detailed description of the evidence supporting this submission"
                    ),
                ),
                (
                    "evidence_url",
                    models.URLField(
                        blank=True,
                        help_text="URL to supporting evidence (news article, document, etc.)",
                        null=True,
                    ),
                ),
                (
                    "additional_evidence",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text="Additional evidence URLs and descriptions",
                    ),
                ),
                ("submitted_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "ip_hash",
                    models.CharField(
                        blank=True,
                        help_text="Hashed IP for abuse prevention (no PII stored)",
                        max_length=64,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending Review"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("duplicate", "Duplicate"),
                            ("needs_info", "Needs More Information"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "review_notes",
                    models.TextField(
                        blank=True,
                        help_text="Internal notes about the review decision",
                    ),
                ),
                (
                    "confidence_score",
                    models.FloatField(
                        default=0.5,
                        help_text="Auto-calculated confidence based on submitter reputation and evidence",
                    ),
                ),
                (
                    "created_aircraft",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="community_submissions",
                        to="skyspy.cannonballknownaircraft",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cannonball_reviews",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cannonball_submissions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "cannonball_community_submissions",
                "ordering": ["-submitted_at"],
            },
        ),
        # Add indexes for CommunitySubmission
        migrations.AddIndex(
            model_name="communitysubmission",
            index=models.Index(fields=["status", "submitted_at"], name="idx_cb_sub_status"),
        ),
        migrations.AddIndex(
            model_name="communitysubmission",
            index=models.Index(fields=["icao_hex", "status"], name="idx_cb_sub_icao"),
        ),
        migrations.AddIndex(
            model_name="communitysubmission",
            index=models.Index(
                fields=["submitted_by", "submitted_at"],
                name="idx_cb_sub_user",
            ),
        ),
    ]
