# Data migration: make the AI assistant a first-class, permission-gated feature.
#
# Grants assistant.view to the roles that should have AI access and seeds a
# FeatureAccess row so admins can see/toggle the feature in the portal. The
# actual anonymous block is enforced by CanUseAssistant (auth + assistant.view),
# which ignores AUTH_MODE=public — this migration just wires up the permission
# for existing installs (DEFAULT_ROLES only seeds fresh databases).

from django.conf import settings
from django.db import migrations

# Roles that get AI access on existing installs. Viewer/operator are intentionally
# excluded per the role-gating decision.
ROLES_WITH_ASSISTANT = ["analyst", "admin", "superadmin"]
ASSISTANT_PERM = "assistant.view"


def grant_assistant(apps, schema_editor):
    Role = apps.get_model("skyspy", "Role")
    FeatureAccess = apps.get_model("skyspy", "FeatureAccess")

    for role_name in ROLES_WITH_ASSISTANT:
        try:
            role = Role.objects.get(name=role_name)
        except Role.DoesNotExist:
            continue
        perms = list(role.permissions or [])
        if ASSISTANT_PERM not in perms:
            perms.append(ASSISTANT_PERM)
            role.permissions = perms
            role.save(update_fields=["permissions"])

    # Seed the FeatureAccess row (permission-gated read + write). is_enabled tracks
    # ASSISTANT_ENABLED so a disabled deployment shows the feature as off.
    FeatureAccess.objects.update_or_create(
        feature="assistant",
        defaults={
            "read_access": "permission",
            "write_access": "permission",
            "is_enabled": bool(getattr(settings, "ASSISTANT_ENABLED", False)),
        },
    )


def revoke_assistant(apps, schema_editor):
    Role = apps.get_model("skyspy", "Role")
    FeatureAccess = apps.get_model("skyspy", "FeatureAccess")

    for role_name in ROLES_WITH_ASSISTANT:
        try:
            role = Role.objects.get(name=role_name)
        except Role.DoesNotExist:
            continue
        perms = [p for p in (role.permissions or []) if p != ASSISTANT_PERM]
        role.permissions = perms
        role.save(update_fields=["permissions"])

    FeatureAccess.objects.filter(feature="assistant").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0038_airframe_type_card_photo"),
    ]

    operations = [
        migrations.RunPython(grant_assistant, revoke_assistant),
    ]
