"""
Data migration to seed default notable callsigns, registrations, rare aircraft types,
and example notification channels.
"""

from django.db import migrations


def seed_notable_callsigns(apps, schema_editor):
    """Seed notable callsign patterns for detection."""
    NotableCallsign = apps.get_model("skyspy", "NotableCallsign")

    callsigns = [
        # Military callsigns
        {
            "name": "Air Force One",
            "pattern_type": "exact",
            "pattern": "AF1",
            "category": "government",
            "description": "US Presidential aircraft",
            "rarity_score": 10,
        },
        {
            "name": "Air Force Two",
            "pattern_type": "exact",
            "pattern": "AF2",
            "category": "government",
            "description": "US Vice Presidential aircraft",
            "rarity_score": 10,
        },
        {
            "name": "Air Force Executive",
            "pattern_type": "prefix",
            "pattern": "EXEC",
            "category": "government",
            "description": "US Air Force executive transport",
            "rarity_score": 8,
        },
        {
            "name": "USAF Tanker",
            "pattern_type": "prefix",
            "pattern": "PACK",
            "category": "military",
            "description": "US Air Force aerial refueling",
            "rarity_score": 5,
        },
        {
            "name": "USAF Heavy",
            "pattern_type": "prefix",
            "pattern": "RCH",
            "category": "military",
            "description": "US Air Force cargo/transport (Reach)",
            "rarity_score": 4,
        },
        {
            "name": "US Navy",
            "pattern_type": "prefix",
            "pattern": "NAVY",
            "category": "military",
            "description": "US Navy aircraft",
            "rarity_score": 5,
        },
        {
            "name": "US Marines",
            "pattern_type": "prefix",
            "pattern": "VMFA",
            "category": "military",
            "description": "US Marine Corps fighter attack squadron",
            "rarity_score": 6,
        },
        {
            "name": "USAF Special Ops",
            "pattern_type": "prefix",
            "pattern": "EVAC",
            "category": "military",
            "description": "US Air Force medical evacuation",
            "rarity_score": 7,
        },
        {
            "name": "RAF Transport",
            "pattern_type": "prefix",
            "pattern": "RRR",
            "category": "military",
            "description": "Royal Air Force",
            "rarity_score": 6,
        },
        {
            "name": "Canadian Forces",
            "pattern_type": "prefix",
            "pattern": "CFC",
            "category": "military",
            "description": "Canadian Armed Forces",
            "rarity_score": 5,
        },
        # Law enforcement / government
        {
            "name": "Customs & Border Protection",
            "pattern_type": "prefix",
            "pattern": "OMAHA",
            "category": "law_enforcement",
            "description": "US Customs and Border Protection",
            "rarity_score": 6,
        },
        {
            "name": "FBI",
            "pattern_type": "regex",
            "pattern": "^N[0-9]+FB$",
            "category": "law_enforcement",
            "description": "FBI surveillance aircraft",
            "rarity_score": 8,
        },
        {
            "name": "Coast Guard",
            "pattern_type": "prefix",
            "pattern": "USCG",
            "category": "government",
            "description": "US Coast Guard",
            "rarity_score": 5,
        },
        {
            "name": "Life Flight",
            "pattern_type": "prefix",
            "pattern": "LIFE",
            "category": "emergency",
            "description": "Air ambulance / HEMS",
            "rarity_score": 4,
        },
        {
            "name": "Medevac",
            "pattern_type": "prefix",
            "pattern": "MEDEVAC",
            "category": "emergency",
            "description": "Medical evacuation flight",
            "rarity_score": 5,
        },
        # Test flights
        {
            "name": "Boeing Test",
            "pattern_type": "prefix",
            "pattern": "BOE",
            "category": "test_flight",
            "description": "Boeing test/delivery flight",
            "rarity_score": 6,
        },
        {
            "name": "Airbus Test",
            "pattern_type": "prefix",
            "pattern": "AIB",
            "category": "test_flight",
            "description": "Airbus test/delivery flight",
            "rarity_score": 6,
        },
        # Firefighting
        {
            "name": "Tanker Aircraft",
            "pattern_type": "prefix",
            "pattern": "TANK",
            "category": "firefighting",
            "description": "Aerial firefighting tanker",
            "rarity_score": 6,
        },
        {
            "name": "Cal Fire",
            "pattern_type": "prefix",
            "pattern": "CALFIRE",
            "category": "firefighting",
            "description": "California firefighting aircraft",
            "rarity_score": 5,
        },
        # Special operations
        {
            "name": "NATO AWACS",
            "pattern_type": "prefix",
            "pattern": "NATO",
            "category": "military",
            "description": "NATO airborne early warning",
            "rarity_score": 8,
        },
        {
            "name": "Blocked/Anonymous",
            "pattern_type": "exact",
            "pattern": "BLOCKED",
            "category": "special",
            "description": "LADD/PIA blocked aircraft",
            "rarity_score": 7,
        },
    ]

    for cs in callsigns:
        NotableCallsign.objects.get_or_create(
            pattern=cs["pattern"],
            pattern_type=cs["pattern_type"],
            defaults=cs,
        )


def seed_notable_registrations(apps, schema_editor):
    """Seed notable registration patterns for detection."""
    NotableRegistration = apps.get_model("skyspy", "NotableRegistration")

    registrations = [
        # US Government
        {
            "name": "US Government/Military",
            "pattern_type": "regex",
            "pattern": "^(AF|AE|00-|01-|02-|03-|04-|05-|06-|07-|08-|09-|1[0-9]-|2[0-4]-)",
            "category": "government",
            "description": "US Air Force serial number format",
            "rarity_score": 6,
        },
        {
            "name": "FAA Flight Check",
            "pattern_type": "prefix",
            "pattern": "N",
            "category": "government",
            "description": "FAA flight inspection aircraft",
            "rarity_score": 5,
        },
        {
            "name": "NASA",
            "pattern_type": "regex",
            "pattern": "^N9[0-9]{2}NA$",
            "category": "government",
            "description": "NASA research aircraft",
            "rarity_score": 9,
        },
        # Foreign military
        {
            "name": "UK Military",
            "pattern_type": "prefix",
            "pattern": "ZZ",
            "category": "military",
            "description": "Royal Air Force aircraft",
            "rarity_score": 6,
        },
        {
            "name": "German Military",
            "pattern_type": "regex",
            "pattern": "^(GAF|[0-9]{2}\\+[0-9]{2})",
            "category": "military",
            "description": "German Air Force aircraft",
            "rarity_score": 6,
        },
        # Special registrations
        {
            "name": "Experimental",
            "pattern_type": "contains",
            "pattern": "EXP",
            "category": "experimental",
            "description": "Experimental aircraft",
            "rarity_score": 5,
        },
        # Historic/notable N-numbers
        {
            "name": "Very Low N-number",
            "pattern_type": "regex",
            "pattern": "^N[1-9]$",
            "category": "historic",
            "description": "Single digit N-number (very rare)",
            "rarity_score": 10,
        },
        {
            "name": "Two Digit N-number",
            "pattern_type": "regex",
            "pattern": "^N[1-9][0-9]$",
            "category": "historic",
            "description": "Two digit N-number (rare)",
            "rarity_score": 8,
        },
        {
            "name": "Vanity Registration",
            "pattern_type": "regex",
            "pattern": "^N(LOVE|BOSS|COOL|FAST|KING|STAR|RICH)",
            "category": "special",
            "description": "Vanity N-number",
            "rarity_score": 4,
        },
        # Test registrations
        {
            "name": "Boeing Test Registration",
            "pattern_type": "regex",
            "pattern": "^N7(0[0-9]|1[0-7])BX$",
            "category": "test_flight",
            "description": "Boeing test aircraft registration",
            "rarity_score": 7,
        },
        {
            "name": "Airbus Test Registration",
            "pattern_type": "regex",
            "pattern": "^F-WW[A-Z]{2}$",
            "category": "test_flight",
            "description": "Airbus prototype/test registration",
            "rarity_score": 8,
        },
    ]

    for reg in registrations:
        NotableRegistration.objects.get_or_create(
            pattern=reg["pattern"],
            pattern_type=reg["pattern_type"],
            defaults=reg,
        )


def seed_rare_aircraft_types(apps, schema_editor):
    """Seed rare aircraft types for detection."""
    RareAircraftType = apps.get_model("skyspy", "RareAircraftType")

    aircraft_types = [
        # Military
        {
            "type_code": "F22",
            "type_name": "Lockheed Martin F-22 Raptor",
            "manufacturer": "Lockheed Martin",
            "category": "military",
            "description": "5th generation stealth fighter",
            "rarity_score": 9,
            "total_produced": 195,
        },
        {
            "type_code": "F35",
            "type_name": "Lockheed Martin F-35 Lightning II",
            "manufacturer": "Lockheed Martin",
            "category": "military",
            "description": "5th generation multirole stealth fighter",
            "rarity_score": 7,
        },
        {
            "type_code": "B2",
            "type_name": "Northrop Grumman B-2 Spirit",
            "manufacturer": "Northrop Grumman",
            "category": "military",
            "description": "Stealth strategic bomber",
            "rarity_score": 10,
            "total_produced": 21,
            "currently_active": 20,
        },
        {
            "type_code": "B1",
            "type_name": "Rockwell B-1 Lancer",
            "manufacturer": "Rockwell/Boeing",
            "category": "military",
            "description": "Supersonic strategic bomber",
            "rarity_score": 8,
            "total_produced": 100,
        },
        {
            "type_code": "B52",
            "type_name": "Boeing B-52 Stratofortress",
            "manufacturer": "Boeing",
            "category": "military",
            "description": "Long-range strategic bomber",
            "rarity_score": 7,
        },
        {
            "type_code": "C5",
            "type_name": "Lockheed C-5 Galaxy",
            "manufacturer": "Lockheed",
            "category": "military",
            "description": "Large military transport aircraft",
            "rarity_score": 6,
        },
        {
            "type_code": "C17",
            "type_name": "Boeing C-17 Globemaster III",
            "manufacturer": "Boeing",
            "category": "military",
            "description": "Large military transport aircraft",
            "rarity_score": 5,
        },
        {
            "type_code": "E3CF",
            "type_name": "Boeing E-3 Sentry AWACS",
            "manufacturer": "Boeing",
            "category": "military",
            "description": "Airborne early warning and control",
            "rarity_score": 8,
        },
        {
            "type_code": "E4B",
            "type_name": "Boeing E-4 Nightwatch",
            "manufacturer": "Boeing",
            "category": "military",
            "description": "National Airborne Operations Center",
            "rarity_score": 10,
            "total_produced": 4,
            "currently_active": 4,
        },
        {
            "type_code": "KC10",
            "type_name": "McDonnell Douglas KC-10 Extender",
            "manufacturer": "McDonnell Douglas",
            "category": "military",
            "description": "Aerial refueling tanker",
            "rarity_score": 6,
        },
        {
            "type_code": "KC46",
            "type_name": "Boeing KC-46 Pegasus",
            "manufacturer": "Boeing",
            "category": "military",
            "description": "Next-gen aerial refueling tanker",
            "rarity_score": 6,
        },
        {
            "type_code": "P8",
            "type_name": "Boeing P-8 Poseidon",
            "manufacturer": "Boeing",
            "category": "military",
            "description": "Maritime patrol aircraft",
            "rarity_score": 6,
        },
        {
            "type_code": "U2",
            "type_name": "Lockheed U-2 Dragon Lady",
            "manufacturer": "Lockheed",
            "category": "military",
            "description": "High-altitude reconnaissance aircraft",
            "rarity_score": 10,
        },
        {
            "type_code": "RQ4",
            "type_name": "Northrop Grumman RQ-4 Global Hawk",
            "manufacturer": "Northrop Grumman",
            "category": "military",
            "description": "High-altitude surveillance UAV",
            "rarity_score": 8,
        },
        # Historic/Vintage
        {
            "type_code": "B29",
            "type_name": "Boeing B-29 Superfortress",
            "manufacturer": "Boeing",
            "category": "historic",
            "description": "WWII strategic bomber",
            "rarity_score": 10,
            "currently_active": 2,
        },
        {
            "type_code": "B17",
            "type_name": "Boeing B-17 Flying Fortress",
            "manufacturer": "Boeing",
            "category": "historic",
            "description": "WWII heavy bomber",
            "rarity_score": 9,
        },
        {
            "type_code": "P51",
            "type_name": "North American P-51 Mustang",
            "manufacturer": "North American",
            "category": "historic",
            "description": "WWII fighter aircraft",
            "rarity_score": 8,
        },
        {
            "type_code": "DC3",
            "type_name": "Douglas DC-3",
            "manufacturer": "Douglas",
            "category": "historic",
            "description": "Classic propeller airliner",
            "rarity_score": 7,
        },
        {
            "type_code": "CONC",
            "type_name": "Aérospatiale/BAC Concorde",
            "manufacturer": "Aérospatiale/BAC",
            "category": "historic",
            "description": "Supersonic airliner (retired)",
            "rarity_score": 10,
            "currently_active": 0,
        },
        # Rare commercial
        {
            "type_code": "A388",
            "type_name": "Airbus A380-800",
            "manufacturer": "Airbus",
            "category": "rare_commercial",
            "description": "Double-deck widebody (production ended)",
            "rarity_score": 5,
        },
        {
            "type_code": "B748",
            "type_name": "Boeing 747-8",
            "manufacturer": "Boeing",
            "category": "rare_commercial",
            "description": "Latest 747 variant (production ended)",
            "rarity_score": 6,
        },
        {
            "type_code": "B77W",
            "type_name": "Boeing 777-300ER",
            "manufacturer": "Boeing",
            "category": "widebody",
            "description": "Long-range widebody",
            "rarity_score": 3,
        },
        # Unique/Special
        {
            "type_code": "AN225",
            "type_name": "Antonov An-225 Mriya",
            "manufacturer": "Antonov",
            "category": "unique",
            "description": "World's largest aircraft (destroyed 2022)",
            "rarity_score": 10,
            "total_produced": 1,
            "currently_active": 0,
        },
        {
            "type_code": "A124",
            "type_name": "Antonov An-124 Ruslan",
            "manufacturer": "Antonov",
            "category": "rare",
            "description": "Heavy cargo aircraft",
            "rarity_score": 8,
        },
        {
            "type_code": "BLCF",
            "type_name": "Boeing 747 Dreamlifter",
            "manufacturer": "Boeing",
            "category": "special",
            "description": "Modified 747 for transporting aircraft parts",
            "rarity_score": 9,
            "total_produced": 4,
            "currently_active": 4,
        },
        {
            "type_code": "A3ST",
            "type_name": "Airbus A300-600ST Beluga",
            "manufacturer": "Airbus",
            "category": "special",
            "description": "Outsize cargo transport",
            "rarity_score": 9,
        },
        {
            "type_code": "BLXL",
            "type_name": "Airbus BelugaXL",
            "manufacturer": "Airbus",
            "category": "special",
            "description": "Next-gen outsize cargo transport",
            "rarity_score": 8,
        },
        # NASA/Research
        {
            "type_code": "B747SP",
            "type_name": "Boeing 747SP",
            "manufacturer": "Boeing",
            "category": "rare",
            "description": "Short body 747 variant",
            "rarity_score": 9,
        },
        # Supersonic
        {
            "type_code": "T38",
            "type_name": "Northrop T-38 Talon",
            "manufacturer": "Northrop",
            "category": "military",
            "description": "Supersonic jet trainer",
            "rarity_score": 4,
        },
    ]

    for ac in aircraft_types:
        RareAircraftType.objects.get_or_create(
            type_code=ac["type_code"],
            defaults=ac,
        )


def seed_notification_channels(apps, schema_editor):
    """Seed example notification channel (console/log only for demo)."""
    NotificationChannel = apps.get_model("skyspy", "NotificationChannel")

    # Create a disabled example channel as a template
    channels = [
        {
            "name": "Console Logger (Example)",
            "channel_type": "custom",
            "apprise_url": "json://localhost",
            "description": "Example channel - replace with your actual notification URL",
            "supports_rich": False,
            "is_global": True,
            "enabled": False,  # Disabled by default
            "verified": False,
        },
    ]

    for ch in channels:
        NotificationChannel.objects.get_or_create(
            name=ch["name"],
            defaults=ch,
        )


def reverse_seed(apps, schema_editor):
    """Reverse migration - remove seeded data."""
    NotableCallsign = apps.get_model("skyspy", "NotableCallsign")
    NotableRegistration = apps.get_model("skyspy", "NotableRegistration")
    RareAircraftType = apps.get_model("skyspy", "RareAircraftType")
    NotificationChannel = apps.get_model("skyspy", "NotificationChannel")

    # Only delete the specific seeded data
    NotableCallsign.objects.filter(
        pattern__in=[
            "AF1",
            "AF2",
            "EXEC",
            "PACK",
            "RCH",
            "NAVY",
            "VMFA",
            "EVAC",
            "RRR",
            "CFC",
            "OMAHA",
            "USCG",
            "LIFE",
            "MEDEVAC",
            "BOE",
            "AIB",
            "TANK",
            "CALFIRE",
            "NATO",
            "BLOCKED",
        ]
    ).delete()

    NotableRegistration.objects.filter(
        name__in=[
            "US Government/Military",
            "FAA Flight Check",
            "NASA",
            "UK Military",
            "German Military",
            "Experimental",
            "Very Low N-number",
            "Two Digit N-number",
            "Vanity Registration",
            "Boeing Test Registration",
            "Airbus Test Registration",
        ]
    ).delete()

    RareAircraftType.objects.filter(
        type_code__in=[
            "F22",
            "F35",
            "B2",
            "B1",
            "B52",
            "C5",
            "C17",
            "E3CF",
            "E4B",
            "KC10",
            "KC46",
            "P8",
            "U2",
            "RQ4",
            "B29",
            "B17",
            "P51",
            "DC3",
            "CONC",
            "A388",
            "B748",
            "B77W",
            "AN225",
            "A124",
            "BLCF",
            "A3ST",
            "BLXL",
            "B747SP",
            "T38",
        ]
    ).delete()

    NotificationChannel.objects.filter(name="Console Logger (Example)").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0016_safetyevent_idx_safety_events_sev_time"),
    ]

    operations = [
        migrations.RunPython(seed_notable_callsigns, reverse_seed),
        migrations.RunPython(seed_notable_registrations, reverse_seed),
        migrations.RunPython(seed_rare_aircraft_types, reverse_seed),
        migrations.RunPython(seed_notification_channels, reverse_seed),
    ]
