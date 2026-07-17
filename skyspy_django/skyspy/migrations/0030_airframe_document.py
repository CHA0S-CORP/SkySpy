import pgvector.django
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0029_aircraftincident"),
    ]

    operations = [
        pgvector.django.VectorExtension(),
        migrations.CreateModel(
            name="AirframeDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("icao_hex", models.CharField(db_index=True, max_length=10, unique=True)),
                ("registration", models.CharField(blank=True, db_index=True, max_length=20, null=True)),
                ("content", models.TextField()),
                ("content_hash", models.CharField(db_index=True, max_length=64)),
                ("embedding", pgvector.django.VectorField(blank=True, dimensions=settings.EMBEDDING_DIM, null=True)),
                ("embedding_model", models.CharField(blank=True, max_length=100, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "airframe_document",
            },
        ),
        migrations.AddIndex(
            model_name="airframedocument",
            index=pgvector.django.HnswIndex(
                name="idx_airframe_doc_embedding",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ),
    ]
