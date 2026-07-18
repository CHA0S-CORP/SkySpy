from django.db import migrations


def bump_extreme_vs_threshold(apps, schema_editor):
    """Raise the extreme-VS default 6000 -> 9000 fpm on existing installs.

    Jets routinely sustain 6000+ fpm on normal descents, so the old floor
    flooded on them. Only update rows still at the old default (6000) so an
    operator's own customization is preserved.
    """
    SystemConfig = apps.get_model("skyspy", "SystemConfig")
    SystemConfig.objects.filter(key="safety.vs_extreme_threshold", value="6000").update(value="9000")
    SystemConfig.objects.filter(key="safety.vs_extreme_threshold", default_value="6000").update(default_value="9000")


def revert_extreme_vs_threshold(apps, schema_editor):
    SystemConfig = apps.get_model("skyspy", "SystemConfig")
    SystemConfig.objects.filter(key="safety.vs_extreme_threshold", value="9000").update(value="6000")
    SystemConfig.objects.filter(key="safety.vs_extreme_threshold", default_value="9000").update(default_value="6000")


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0030_airframe_document"),
    ]

    operations = [
        migrations.RunPython(bump_extreme_vs_threshold, revert_extreme_vs_threshold),
    ]
