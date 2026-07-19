"""Make Weather and Wildfires first-class RBAC features.

Adds the `weather` + `wildfires` choices to FeatureAccess.feature, seeds a
FeatureAccess row for each (read/write gated on role permission), and grants the
new `.view` permissions to every default role on installs that predate this
migration (DEFAULT_ROLES only seeds fresh databases). Mirrors 0041 for the
cannonball/services features.

Weather (METAR/TAF/PIREP/SIGMET/NEXRAD/winds-aloft/turbulence) and wildfires are
read-only data feeds, so each feature has a single `.view` permission granted to
all roles (superadmin gets it via ALL_PERMISSIONS automatically).
"""

from django.db import migrations, models

# role name -> permissions to add (idempotent). superadmin picks these up via
# ALL_PERMISSIONS in DEFAULT_ROLES, so it is not listed here.
ROLE_GRANTS = {
    "viewer": ["weather.view", "wildfires.view"],
    "operator": ["weather.view", "wildfires.view"],
    "analyst": ["weather.view", "wildfires.view"],
    "admin": ["weather.view", "wildfires.view"],
    "superadmin": ["weather.view", "wildfires.view"],
}

NEW_PERMS = {"weather.view", "wildfires.view"}


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

    for feature in ("weather", "wildfires"):
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

    FeatureAccess.objects.filter(feature__in=["weather", "wildfires"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0042_cached_wildfire"),
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
                    ("weather", "Weather Data"),
                    ("wildfires", "Wildfire Tracking"),
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
