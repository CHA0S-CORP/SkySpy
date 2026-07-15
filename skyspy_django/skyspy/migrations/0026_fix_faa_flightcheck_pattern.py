"""
Repair notable-pattern seed data from 0017 on existing databases.

- "FAA Flight Check" was seeded as prefix "N", which matches every
  US-registered aircraft. Replaced with a tight two-digit N-number regex
  (the FAA flight inspection fleet: N58, N71, N85, ...).
- Coast Guard / Life Flight / Medevac callsign categories aligned with the
  service defaults in services/gamification.py (law_enforcement /
  air_ambulance), and Coast Guard now also matches the COAST callsign.
- Adds registration patterns and the A380 family-code alias that the service
  defaults define but 0017 never seeded.

0017 has been updated in place for fresh installs; this migration repairs
databases that already ran the original seed.
"""

from django.db import migrations

NEW_REGISTRATIONS = [
    {
        "name": "US Government (N1xx)",
        "pattern_type": "regex",
        "pattern": "^N1[0-9]{2}$",
        "category": "government",
        "description": "US government executive fleet registration block",
        "rarity_score": 9,
    },
    {
        "name": "Boeing Test (N7xx)",
        "pattern_type": "regex",
        "pattern": "^N7[0-9]{2}",
        "category": "test_flight",
        "description": "Boeing test/delivery registration block",
        "rarity_score": 7,
    },
]

A380_ALIAS = {
    "type_code": "A380",
    "type_name": "Airbus A380",
    "manufacturer": "Airbus",
    "category": "rare_commercial",
    "description": "Double-deck widebody (production ended)",
    "rarity_score": 5,
}


def repair_seed_data(apps, schema_editor):
    NotableRegistration = apps.get_model("skyspy", "NotableRegistration")
    NotableCallsign = apps.get_model("skyspy", "NotableCallsign")
    RareAircraftType = apps.get_model("skyspy", "RareAircraftType")

    NotableRegistration.objects.filter(
        name="FAA Flight Check", pattern_type="prefix", pattern="N"
    ).update(pattern_type="regex", pattern="^N[0-9]{2}$")

    for reg in NEW_REGISTRATIONS:
        NotableRegistration.objects.get_or_create(
            pattern=reg["pattern"], pattern_type=reg["pattern_type"], defaults=reg
        )

    NotableCallsign.objects.filter(name="Coast Guard", pattern="USCG").update(
        pattern_type="regex", pattern="^USCG|^COAST", category="law_enforcement", rarity_score=6
    )
    NotableCallsign.objects.filter(name="Life Flight", category="emergency").update(category="air_ambulance")
    NotableCallsign.objects.filter(name="Medevac", category="emergency").update(category="air_ambulance")

    RareAircraftType.objects.get_or_create(type_code=A380_ALIAS["type_code"], defaults=A380_ALIAS)


def revert_seed_data(apps, schema_editor):
    NotableRegistration = apps.get_model("skyspy", "NotableRegistration")
    NotableCallsign = apps.get_model("skyspy", "NotableCallsign")
    RareAircraftType = apps.get_model("skyspy", "RareAircraftType")

    NotableRegistration.objects.filter(
        name="FAA Flight Check", pattern_type="regex", pattern="^N[0-9]{2}$"
    ).update(pattern_type="prefix", pattern="N")
    NotableRegistration.objects.filter(pattern__in=[r["pattern"] for r in NEW_REGISTRATIONS]).delete()

    NotableCallsign.objects.filter(name="Coast Guard", pattern="^USCG|^COAST").update(
        pattern_type="prefix", pattern="USCG", category="government", rarity_score=5
    )
    NotableCallsign.objects.filter(name="Life Flight", category="air_ambulance").update(category="emergency")
    NotableCallsign.objects.filter(name="Medevac", category="air_ambulance").update(category="emergency")

    RareAircraftType.objects.filter(type_code="A380").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0025_acarsmessage_noise_level"),
    ]

    operations = [
        migrations.RunPython(repair_seed_data, revert_seed_data),
    ]
