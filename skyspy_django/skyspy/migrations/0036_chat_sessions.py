import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("skyspy", "0035_alter_ragdocument_kind"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("client_id", models.CharField(blank=True, db_index=True, max_length=64)),
                ("title", models.CharField(blank=True, max_length=200)),
                ("surface", models.CharField(default="screen", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True, db_index=True)),
                (
                    "owner",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_sessions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "chat_sessions",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="ChatMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(max_length=16)),
                ("text", models.TextField(blank=True)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("seq", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="skyspy.chatsession",
                    ),
                ),
            ],
            options={
                "db_table": "chat_messages",
                "ordering": ["seq"],
            },
        ),
        migrations.AddIndex(
            model_name="chatsession",
            index=models.Index(fields=["owner", "-updated_at"], name="idx_chat_owner_updated"),
        ),
        migrations.AddIndex(
            model_name="chatsession",
            index=models.Index(fields=["client_id", "-updated_at"], name="idx_chat_client_updated"),
        ),
        migrations.AddIndex(
            model_name="chatmessage",
            index=models.Index(fields=["session", "seq"], name="idx_chat_msg_session_seq"),
        ),
    ]
