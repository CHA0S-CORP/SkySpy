import pgvector.django
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0033_aircraftinfo_route_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="RagDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "kind",
                    models.CharField(
                        choices=[("acars", "ACARS message"), ("notam", "NOTAM"), ("pirep", "PIREP")],
                        db_index=True,
                        max_length=20,
                    ),
                ),
                ("ref_id", models.CharField(db_index=True, max_length=100)),
                ("title", models.CharField(blank=True, max_length=200, null=True)),
                ("content", models.TextField()),
                ("content_hash", models.CharField(db_index=True, max_length=64)),
                ("metadata", models.JSONField(blank=True, null=True)),
                ("embedding", pgvector.django.VectorField(blank=True, dimensions=settings.EMBEDDING_DIM, null=True)),
                ("embedding_model", models.CharField(blank=True, max_length=100, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "rag_document",
            },
        ),
        migrations.AddConstraint(
            model_name="ragdocument",
            constraint=models.UniqueConstraint(fields=["kind", "ref_id"], name="uniq_rag_kind_ref"),
        ),
        migrations.AddIndex(
            model_name="ragdocument",
            index=models.Index(fields=["kind", "-created_at"], name="idx_rag_kind_created"),
        ),
    ]
