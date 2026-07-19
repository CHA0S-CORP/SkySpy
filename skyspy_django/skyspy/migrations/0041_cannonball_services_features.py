"""Make Cannonball Mode and External Services first-class RBAC features.

Adds the `cannonball` + `services` choices to FeatureAccess.feature, seeds a
FeatureAccess row for each, and grants the new permissions to the existing
default roles on installs that predate this migration (DEFAULT_ROLES only seeds
fresh databases). Mirrors 0039/0040 for the assistant feature.

- cannonball.view / .manage → analyst (view), admin + superadmin (view + manage)
- services.view → every role (external tool links; harmless, now controllable)
"""

from django.db import migrations, models

# role name -> permissions to add (idempotent).
ROLE_GRANTS = {
    "viewer": ["services.view"],
    "operator": ["services.view"],
    "analyst": ["cannonball.view", "services.view"],
    "admin": ["cannonball.view", "cannonball.manage", "services.view"],
    "superadmin": ["cannonball.view", "cannonball.manage", "services.view"],
}

NEW_PERMS = {"cannonball.view", "cannonball.manage", "services.view"}


def grant(apps, schema_editor):
    Role = apps.get_model("skyspy", "Role")
    FeatureAccess = apps.get_model("skyspy", "FeatureAccess")

    for role_name, perms in ROLE_GRANTS.items():
        try:
            role = Role.objects.get(name=role_name)
        except Role.DoesNotExist:
            continue
        current = list(role.permissions or [])
        added = [p for p in perms if p not in current]
        if added:
            role.permissions = current + added
            role.save(update_fields=["permissions"])

    for feature in ("cannonball", "services"):
        FeatureAccess.objects.get_or_create(
            feature=feature,
            defaults={"read_access": "permission", "write_access": "permission", "is_enabled": True},
        )


def revoke(apps, schema_editor):
    Role = apps.get_model("skyspy", "Role")
    FeatureAccess = apps.get_model("skyspy", "FeatureAccess")

    for role in Role.objects.all():
        perms = [p for p in (role.permissions or []) if p not in NEW_PERMS]
        if perms != list(role.permissions or []):
            role.permissions = perms
            role.save(update_fields=["permissions"])

    FeatureAccess.objects.filter(feature__in=["cannonball", "services"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0040_alter_featureaccess_feature"),
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
                    ("cannonball", "Cannonball Mode"),
                    ("services", "External Services"),
                    ("users", "User Management"),
                    ("roles", "Role Management"),
                ],
                max_length=30,
                primary_key=True,
                serialize=False,
                unique=True,
            ),
        ),
        migrations.RunPython(grant, revoke),
    ]
