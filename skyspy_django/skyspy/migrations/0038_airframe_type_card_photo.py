from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0037_airframe_type_card"),
    ]

    operations = [
        migrations.AddField(
            model_name="airframetypecard",
            name="photo_url",
            field=models.CharField(blank=True, max_length=1000, null=True),
        ),
        migrations.AddField(
            model_name="airframetypecard",
            name="photo_full_url",
            field=models.CharField(blank=True, max_length=1000, null=True),
        ),
        migrations.AddField(
            model_name="airframetypecard",
            name="photo_page",
            field=models.CharField(blank=True, max_length=1000, null=True),
        ),
        migrations.AddField(
            model_name="airframetypecard",
            name="photo_credit",
            field=models.CharField(blank=True, max_length=200, null=True),
        ),
        migrations.AddField(
            model_name="airframetypecard",
            name="photo_cached",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="airframetypecard",
            name="sources",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
