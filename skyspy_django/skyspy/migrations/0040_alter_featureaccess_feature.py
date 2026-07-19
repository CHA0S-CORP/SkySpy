"""Add the 'assistant' choice to FeatureAccess.feature (AI Assistant feature)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0039_assistant_feature"),
    ]

    operations = [
        migrations.AlterField(
            model_name="featureaccess",
            name="feature",
            field=models.CharField(
                choices=[
                    ("aircraft", "Aircraft Tracking"),
                    ("alerts", "Alert Rules"),
                    ("safety", "Safety Events"),
                    ("audio", "Audio Transmissions"),
                    ("acars", "ACARS Messages"),
                    ("history", "Flight History"),
                    ("system", "System Status"),
                    ("assistant", "AI Assistant"),
                    ("users", "User Management"),
                    ("roles", "Role Management"),
                ],
                max_length=30,
                primary_key=True,
                serialize=False,
                unique=True,
            ),
        ),
    ]
