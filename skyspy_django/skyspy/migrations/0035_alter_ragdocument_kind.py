from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0034_rag_document"),
    ]

    operations = [
        migrations.AlterField(
            model_name="ragdocument",
            name="kind",
            field=models.CharField(
                choices=[
                    ("acars", "ACARS message"),
                    ("notam", "NOTAM"),
                    ("pirep", "PIREP"),
                    ("safety", "Safety event"),
                    ("incident", "NTSB incident"),
                ],
                db_index=True,
                max_length=20,
            ),
        ),
    ]
