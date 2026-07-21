"""
Factory Boy factories for generating test data.

These factories create realistic test data for all SkysPy models,
making it easy to write integration tests with minimal boilerplate.
"""

import os
import random
from datetime import datetime, timedelta

# Configure Django before importing models
import django
from django.conf import settings

if not settings.configured:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "skyspy.tests.test_settings")
    django.setup()

import factory
from django.utils import timezone
from factory import fuzzy
from factory.django import DjangoModelFactory

from skyspy.models import (
    AcarsMessage,
    AircraftInfo,
    AircraftSession,
    AircraftSighting,
    AlertHistory,
    AlertRule,
    AudioTransmission,
    NotificationConfig,
    NotificationLog,
    SafetyEvent,
)
from skyspy.models.auth import APIKey, FeatureAccess
from skyspy.models.aviation import CachedPirep
from skyspy.models.notams import CachedNotam
from skyspy.models.notifications import NotificationChannel, NotificationTemplate, UserNotificationPreference
from skyspy.models.stats import DailyStats, PersonalRecord, RareSighting, SightingStreak
from skyspy.models.watch_list import WatchedAircraft


def generate_icao_hex():
    """Generate a realistic ICAO hex code."""
    # US aircraft typically start with A
    # Mix of US and international
    prefixes = [
        "A",
        "A0",
        "A1",
        "A2",
        "A3",
        "A4",
        "A5",
        "A6",
        "A7",
        "A8",
        "A9",
        "40",
        "4B",
        "4C",
        "50",
        "78",
        "89",
        "C0",
    ]
    prefix = random.choice(prefixes)
    suffix_length = 6 - len(prefix)
    suffix = "".join(random.choices("0123456789ABCDEF", k=suffix_length))
    return f"{prefix}{suffix}"


def generate_callsign():
    """Generate a realistic airline callsign."""
    airlines = [
        "UAL",
        "DAL",
        "AAL",
        "SWA",
        "JBU",
        "ASA",
        "FFT",
        "NKS",
        "SKW",
        "ENY",
        "BAW",
        "AFR",
        "DLH",
        "KLM",
        "ACA",
        "QFA",
        "SIA",
        "CPA",
        "ANA",
        "JAL",
    ]
    airline = random.choice(airlines)
    flight_num = random.randint(1, 9999)
    return f"{airline}{flight_num}"


def generate_n_number():
    """Generate a realistic N-number registration."""
    # N + 1-5 digits + optional letter suffix
    num = random.randint(1, 99999)
    if random.random() < 0.3:
        suffix = random.choice("ABCDEFGHJKLMNPRSTUVWXYZ")
        return f"N{num}{suffix}"
    return f"N{num}"


def generate_squawk():
    """Generate a realistic squawk code."""
    # Most common transponder codes
    codes = [
        "1200",
        "7000",  # VFR
        "4000",
        "4001",
        "4002",
        "4003",
        "4004",  # IFR common
        "5000",
        "5001",
        "5002",
        "5003",
        "5004",  # IFR common
        "0000",  # Ground
    ]
    if random.random() < 0.01:  # 1% chance of emergency squawk
        return random.choice(["7500", "7600", "7700"])
    return random.choice(codes)


class AircraftSightingFactory(DjangoModelFactory):
    """Factory for AircraftSighting model."""

    class Meta:
        model = AircraftSighting

    timestamp = factory.LazyFunction(timezone.now)
    icao_hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    squawk = factory.LazyFunction(generate_squawk)
    latitude = fuzzy.FuzzyFloat(25.0, 49.0)  # Continental US
    longitude = fuzzy.FuzzyFloat(-125.0, -65.0)
    altitude_baro = fuzzy.FuzzyInteger(1000, 45000)
    altitude_geom = factory.LazyAttribute(
        lambda o: o.altitude_baro + random.randint(-500, 500) if o.altitude_baro else None
    )
    ground_speed = fuzzy.FuzzyFloat(100.0, 550.0)
    track = fuzzy.FuzzyFloat(0.0, 359.9)
    vertical_rate = fuzzy.FuzzyInteger(-3000, 3000)
    distance_nm = fuzzy.FuzzyFloat(0.1, 250.0)
    rssi = fuzzy.FuzzyFloat(-40.0, -10.0)
    category = factory.LazyFunction(lambda: random.choice(["A1", "A2", "A3", "A4", "A5", "B1", "B2", "C1", "C2"]))
    aircraft_type = factory.LazyFunction(
        lambda: random.choice(["B738", "A320", "B77W", "A321", "E75L", "B39M", "C172", "PA28"])
    )
    is_military = factory.LazyFunction(lambda: random.random() < 0.05)
    is_emergency = factory.LazyAttribute(lambda o: o.squawk in ("7500", "7600", "7700"))
    source = factory.LazyFunction(lambda: random.choice(["1090", "UAT"]))

    class Params:
        # Trait for ground-based aircraft
        on_ground = factory.Trait(
            altitude_baro=0,
            altitude_geom=0,
            ground_speed=fuzzy.FuzzyFloat(0.0, 30.0),
            vertical_rate=0,
        )
        # Trait for military aircraft
        military = factory.Trait(
            is_military=True,
            callsign=factory.LazyFunction(lambda: f"RCH{random.randint(100, 999)}"),
        )
        # Trait for emergency
        emergency = factory.Trait(
            squawk=factory.LazyFunction(lambda: random.choice(["7500", "7600", "7700"])),
            is_emergency=True,
        )
        # Trait for proximity test (specific location)
        nearby = factory.Trait(
            latitude=47.9377,
            longitude=-121.9687,
            distance_nm=fuzzy.FuzzyFloat(0.1, 2.0),
        )


class AircraftSessionFactory(DjangoModelFactory):
    """Factory for AircraftSession model."""

    class Meta:
        model = AircraftSession

    icao_hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    first_seen = factory.LazyFunction(lambda: timezone.now() - timedelta(hours=random.randint(1, 24)))
    last_seen = factory.LazyFunction(timezone.now)
    total_positions = fuzzy.FuzzyInteger(10, 1000)
    min_altitude = fuzzy.FuzzyInteger(500, 10000)
    max_altitude = fuzzy.FuzzyInteger(25000, 45000)
    min_distance_nm = fuzzy.FuzzyFloat(0.5, 10.0)
    max_distance_nm = fuzzy.FuzzyFloat(50.0, 250.0)
    max_vertical_rate = fuzzy.FuzzyInteger(1000, 4000)
    min_rssi = fuzzy.FuzzyFloat(-40.0, -30.0)
    max_rssi = fuzzy.FuzzyFloat(-20.0, -10.0)
    is_military = factory.LazyFunction(lambda: random.random() < 0.05)
    category = factory.LazyFunction(lambda: random.choice(["A1", "A2", "A3", "A4", "A5"]))
    aircraft_type = factory.LazyFunction(lambda: random.choice(["B738", "A320", "B77W", "A321", "E75L"]))

    class Params:
        # Short session (recent aircraft)
        recent = factory.Trait(
            first_seen=factory.LazyFunction(lambda: timezone.now() - timedelta(minutes=30)),
            total_positions=fuzzy.FuzzyInteger(5, 50),
        )
        # Long tracking session
        extended = factory.Trait(
            total_positions=fuzzy.FuzzyInteger(500, 2000),
            first_seen=factory.LazyFunction(lambda: timezone.now() - timedelta(hours=3)),
        )


class AircraftInfoFactory(DjangoModelFactory):
    """Factory for AircraftInfo model."""

    class Meta:
        model = AircraftInfo

    icao_hex = factory.LazyFunction(generate_icao_hex)
    registration = factory.LazyFunction(generate_n_number)
    source = factory.LazyFunction(lambda: random.choice(["hexdb", "opensky", "planespotters"]))

    # Airframe info
    type_code = factory.LazyFunction(
        lambda: random.choice(["B738", "A320", "B77W", "A321", "E75L", "B39M", "C172", "PA28"])
    )
    type_name = factory.LazyAttribute(
        lambda o: {
            "B738": "Boeing 737-800",
            "A320": "Airbus A320",
            "B77W": "Boeing 777-300ER",
            "A321": "Airbus A321",
            "E75L": "Embraer E175",
            "B39M": "Boeing 737 MAX 9",
            "C172": "Cessna 172",
            "PA28": "Piper PA-28",
        }.get(o.type_code, "Unknown")
    )
    manufacturer = factory.LazyAttribute(
        lambda o: {
            "B738": "Boeing",
            "B77W": "Boeing",
            "B39M": "Boeing",
            "A320": "Airbus",
            "A321": "Airbus",
            "E75L": "Embraer",
            "C172": "Cessna",
            "PA28": "Piper",
        }.get(o.type_code, "Unknown")
    )
    model = factory.LazyAttribute(lambda o: o.type_name)
    serial_number = factory.LazyFunction(lambda: f"{random.randint(20000, 70000)}")
    year_built = fuzzy.FuzzyInteger(1990, 2024)

    # Operator info
    operator = factory.LazyFunction(
        lambda: random.choice(
            [
                "United Airlines",
                "Delta Air Lines",
                "American Airlines",
                "Southwest Airlines",
                "Alaska Airlines",
                "JetBlue Airways",
                "Spirit Airlines",
                "Frontier Airlines",
                "Private Owner",
            ]
        )
    )
    operator_icao = factory.LazyFunction(lambda: random.choice(["UAL", "DAL", "AAL", "SWA", "ASA", "JBU", None]))
    owner = factory.LazyFunction(
        lambda: random.choice(
            [
                "WELLS FARGO TRUST",
                "WILMINGTON TRUST",
                "PRIVATE OWNER",
                "JPMORGAN CHASE BANK",
                "BANK OF UTAH TRUSTEE",
                None,
            ]
        )
    )
    city = factory.LazyFunction(lambda: random.choice(["Chicago", "Dallas", "Atlanta", "Los Angeles", "Seattle", None]))
    state = factory.LazyFunction(lambda: random.choice(["IL", "TX", "GA", "CA", "WA", None]))

    # Country
    country = "United States"
    country_code = "US"

    is_interesting = fuzzy.FuzzyChoice([True, False])
    is_pia = factory.LazyFunction(lambda: random.random() < 0.05)
    is_ladd = factory.LazyFunction(lambda: random.random() < 0.1)
    is_military = factory.LazyFunction(lambda: random.random() < 0.05)

    class Params:
        # Military aircraft
        military = factory.Trait(
            is_military=True,
            operator="United States Air Force",
            operator_icao="AIO",
            type_code="C17",
            type_name="Boeing C-17 Globemaster III",
            manufacturer="Boeing",
        )
        # Interesting aircraft (tracked by enthusiasts)
        interesting = factory.Trait(
            is_interesting=True,
        )


class AlertRuleFactory(DjangoModelFactory):
    """Factory for AlertRule model."""

    class Meta:
        model = AlertRule

    name = factory.LazyFunction(lambda: f"Alert Rule {random.randint(1, 1000)}")
    rule_type = factory.LazyFunction(
        lambda: random.choice(["icao", "callsign", "squawk", "altitude", "distance", "military", "type"])
    )
    operator = "eq"
    value = factory.LazyAttribute(
        lambda o: {
            "icao": generate_icao_hex(),
            "callsign": generate_callsign(),
            "squawk": "7700",
            "altitude": "10000",
            "distance": "5",
            "military": "true",
            "type": "B738",
        }.get(o.rule_type, "")
    )
    conditions = None
    description = factory.LazyFunction(lambda: f"Test alert rule created at {timezone.now()}")
    enabled = True
    priority = factory.LazyFunction(lambda: random.choice(["info", "warning", "critical"]))
    starts_at = None
    expires_at = None
    api_url = None
    created_at = factory.LazyFunction(timezone.now)
    updated_at = factory.LazyFunction(timezone.now)

    class Params:
        # Disabled rule
        disabled = factory.Trait(
            enabled=False,
        )
        # Complex conditions
        complex = factory.Trait(
            rule_type=None,
            value=None,
            conditions={
                "logic": "AND",
                "groups": [
                    {
                        "logic": "OR",
                        "conditions": [
                            {"type": "military", "operator": "eq", "value": "true"},
                            {"type": "squawk", "operator": "eq", "value": "7700"},
                        ],
                    },
                    {
                        "logic": "AND",
                        "conditions": [
                            {"type": "distance", "operator": "lt", "value": "10"},
                        ],
                    },
                ],
            },
        )
        # Scheduled rule
        scheduled = factory.Trait(
            starts_at=factory.LazyFunction(timezone.now),
            expires_at=factory.LazyFunction(lambda: timezone.now() + timedelta(days=7)),
        )
        # With webhook
        with_webhook = factory.Trait(
            api_url="https://example.com/webhook",
        )


class AlertHistoryFactory(DjangoModelFactory):
    """Factory for AlertHistory model."""

    class Meta:
        model = AlertHistory

    rule = factory.SubFactory(AlertRuleFactory)
    rule_name = factory.LazyAttribute(lambda o: o.rule.name if o.rule else "Deleted Rule")
    icao_hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    message = factory.LazyFunction(lambda: "Alert triggered for test aircraft")
    priority = factory.LazyFunction(lambda: random.choice(["info", "warning", "critical"]))
    aircraft_data = factory.LazyFunction(
        lambda: {
            "hex": generate_icao_hex(),
            "flight": generate_callsign(),
            "alt": random.randint(1000, 45000),
            "gs": random.randint(100, 550),
            "lat": random.uniform(25, 49),
            "lon": random.uniform(-125, -65),
        }
    )
    triggered_at = factory.LazyFunction(timezone.now)


class SafetyEventFactory(DjangoModelFactory):
    """Factory for SafetyEvent model."""

    class Meta:
        model = SafetyEvent

    timestamp = factory.LazyFunction(timezone.now)
    event_type = factory.LazyFunction(
        lambda: random.choice(
            [
                "tcas_ra",
                "tcas_ta",
                "extreme_vs",
                "vs_reversal",
                "proximity_conflict",
                "emergency_squawk",
                "7500",
                "7600",
                "7700",
            ]
        )
    )
    severity = factory.LazyFunction(lambda: random.choice(["info", "warning", "critical"]))
    icao_hex = factory.LazyFunction(generate_icao_hex)
    icao_hex_2 = factory.LazyAttribute(lambda o: generate_icao_hex() if o.event_type == "proximity_conflict" else None)
    callsign = factory.LazyFunction(generate_callsign)
    callsign_2 = factory.LazyAttribute(lambda o: generate_callsign() if o.event_type == "proximity_conflict" else None)
    message = factory.LazyAttribute(lambda o: f"Safety event: {o.event_type} for {o.callsign}")
    details = factory.LazyAttribute(
        lambda o: {
            "event_type": o.event_type,
            "test": True,
        }
    )
    aircraft_snapshot = factory.LazyFunction(
        lambda: {
            "hex": generate_icao_hex(),
            "flight": generate_callsign(),
            "alt": random.randint(1000, 45000),
            "vr": random.randint(-4000, 4000),
            "lat": random.uniform(25, 49),
            "lon": random.uniform(-125, -65),
        }
    )
    aircraft_snapshot_2 = factory.LazyAttribute(
        lambda o: (
            {
                "hex": generate_icao_hex(),
                "flight": generate_callsign(),
                "alt": random.randint(1000, 45000),
                "lat": random.uniform(25, 49),
                "lon": random.uniform(-125, -65),
            }
            if o.event_type == "proximity_conflict"
            else None
        )
    )
    acknowledged = False
    acknowledged_at = None

    class Params:
        # TCAS event
        tcas = factory.Trait(
            event_type="tcas_ra",
            severity="critical",
            message=factory.LazyAttribute(lambda o: f"TCAS RA: {o.callsign} - Climb"),
        )
        # Proximity conflict
        proximity = factory.Trait(
            event_type="proximity_conflict",
            severity="warning",
            icao_hex_2=factory.LazyFunction(generate_icao_hex),
            callsign_2=factory.LazyFunction(generate_callsign),
        )
        # Emergency squawk
        emergency = factory.Trait(
            event_type="7700",
            severity="critical",
            message=factory.LazyAttribute(lambda o: f"Emergency squawk 7700: {o.callsign}"),
        )
        # Acknowledged
        acknowledged_event = factory.Trait(
            acknowledged=True,
            acknowledged_at=factory.LazyFunction(timezone.now),
        )


class AcarsMessageFactory(DjangoModelFactory):
    """Factory for AcarsMessage model."""

    class Meta:
        model = AcarsMessage

    timestamp = factory.LazyFunction(timezone.now)
    source = factory.LazyFunction(lambda: random.choice(["acars", "vdlm2"]))
    channel = factory.LazyFunction(lambda: str(random.randint(1, 10)))
    frequency = factory.LazyFunction(
        lambda: random.choice(
            [129.125, 130.025, 130.425, 130.450, 131.550, 131.725, 131.825, 136.750, 136.900, 136.975]
        )
    )
    icao_hex = factory.LazyFunction(generate_icao_hex)
    registration = factory.LazyFunction(generate_n_number)
    callsign = factory.LazyFunction(generate_callsign)
    label = factory.LazyFunction(
        lambda: random.choice(
            [
                "Q0",
                "QA",
                "QB",
                "QC",
                "QD",
                "QE",
                "QF",
                "QK",
                "QM",
                "QP",
                "QR",
                "QS",
                "QU",
                "QX",
                "H1",
                "H2",
                "5Z",
                "5Y",
                "B6",
                "_d",
                "SQ",
                "80",
                "83",
                "10",
                "11",
                "12",
                "16",
                "17",
            ]
        )
    )
    block_id = factory.LazyFunction(lambda: random.choice(["1", "2", "3", "4", "5"]))
    msg_num = factory.LazyFunction(lambda: f"M{random.randint(0, 999):03d}")
    ack = factory.LazyFunction(lambda: random.choice(["NAK", "!", "2", "3", None]))
    mode = factory.LazyFunction(lambda: random.choice(["2", "X", None]))
    text = factory.LazyFunction(
        lambda: random.choice(
            [
                "POS N4756.3W12158.2,ALT 35000,SPD 450,HDG 270,ETA 1234Z",
                "/BOARDED 145/MAX 152/ACTUAL 147",
                "REQUEST CLEARANCE TO FL380",
                "OCEANIC CLX ACCEPTED",
                "ROGER WEATHER DEVIATION APPROVED",
                "ATIS INFORMATION ALPHA",
                "EXPECT DIRECT AFTER WAYPOINT",
                "",  # Some messages have no text
            ]
        )
    )
    decoded = None
    signal_level = fuzzy.FuzzyFloat(-35.0, -5.0)
    error_count = fuzzy.FuzzyInteger(0, 3)
    station_id = factory.LazyFunction(lambda: f"station-{random.randint(1, 5)}")

    class Params:
        # Position report
        position = factory.Trait(
            label="Q0",
            text=factory.LazyFunction(
                lambda: (
                    f"POS N{random.randint(25, 49):02d}{random.randint(0, 59):02d}.{random.randint(0, 9)}W{random.randint(65, 125):03d}{random.randint(0, 59):02d}.{random.randint(0, 9)},ALT {random.randint(25, 45)}000,SPD {random.randint(350, 520)},HDG {random.randint(0, 359):03d}"
                )
            ),
        )
        # OOOI (Out, Off, On, In)
        oooi = factory.Trait(
            label="_d",
            text=factory.LazyFunction(lambda: random.choice(["OUT 1234Z", "OFF 1245Z", "ON 1530Z", "IN 1545Z"])),
        )
        # Weather request
        weather = factory.Trait(
            label="H1",
            text="REQUEST SIGMET/PIREP KSEA-KLAX",
        )


class AudioTransmissionFactory(DjangoModelFactory):
    """Factory for AudioTransmission model."""

    class Meta:
        model = AudioTransmission

    created_at = factory.LazyFunction(timezone.now)
    filename = factory.LazyFunction(
        lambda: f"transmission_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{random.randint(1000, 9999)}.mp3"
    )
    s3_key = factory.LazyAttribute(lambda o: f"radio-transmissions/{o.filename}" if random.random() < 0.5 else None)
    s3_url = factory.LazyAttribute(lambda o: f"https://s3.example.com/{o.s3_key}" if o.s3_key else None)
    file_size_bytes = fuzzy.FuzzyInteger(10000, 500000)
    duration_seconds = fuzzy.FuzzyFloat(0.5, 30.0)
    format = factory.LazyFunction(lambda: random.choice(["mp3", "wav", "ogg"]))
    frequency_mhz = factory.LazyFunction(
        lambda: random.choice(
            [118.000, 118.300, 119.100, 121.500, 121.900, 124.000, 125.350, 126.700, 127.850, 132.550]
        )
    )
    channel_name = factory.LazyFunction(
        lambda: random.choice(
            [
                "SEA Tower",
                "SEA Ground",
                "SEA Approach",
                "SEA Departure",
                "Portland Approach",
                "Oakland Center",
                "Guard",
                "ATIS",
            ]
        )
    )
    squelch_level = fuzzy.FuzzyFloat(0.0, 1.0)
    transcription_status = "pending"
    transcription_queued_at = None
    transcription_started_at = None
    transcription_completed_at = None
    transcription_error = None
    transcript = None
    transcript_confidence = None
    transcript_language = None
    transcript_segments = None
    identified_airframes = None
    extra_metadata = None

    class Params:
        # Queued for transcription
        queued = factory.Trait(
            transcription_status="queued",
            transcription_queued_at=factory.LazyFunction(timezone.now),
        )
        # Processing
        processing = factory.Trait(
            transcription_status="processing",
            transcription_queued_at=factory.LazyFunction(lambda: timezone.now() - timedelta(minutes=5)),
            transcription_started_at=factory.LazyFunction(timezone.now),
        )
        # Completed transcription
        completed = factory.Trait(
            transcription_status="completed",
            transcription_queued_at=factory.LazyFunction(lambda: timezone.now() - timedelta(minutes=10)),
            transcription_started_at=factory.LazyFunction(lambda: timezone.now() - timedelta(minutes=5)),
            transcription_completed_at=factory.LazyFunction(timezone.now),
            transcript="United four five six, Seattle Tower, runway one six right cleared for takeoff, wind one seven zero at eight.",
            transcript_confidence=0.92,
            transcript_language="en",
            transcript_segments=[
                {"start": 0.0, "end": 2.5, "text": "United four five six,"},
                {"start": 2.5, "end": 4.0, "text": "Seattle Tower,"},
                {"start": 4.0, "end": 7.5, "text": "runway one six right cleared for takeoff,"},
                {"start": 7.5, "end": 10.0, "text": "wind one seven zero at eight."},
            ],
            identified_airframes=[{"type": "airline", "airline": "UNITED", "raw_text": "UNITED 456"}],
        )
        # Failed transcription
        failed = factory.Trait(
            transcription_status="failed",
            transcription_queued_at=factory.LazyFunction(lambda: timezone.now() - timedelta(minutes=10)),
            transcription_started_at=factory.LazyFunction(lambda: timezone.now() - timedelta(minutes=5)),
            transcription_error="Connection timeout to transcription service",
        )


class NotificationConfigFactory(DjangoModelFactory):
    """Factory for NotificationConfig model (singleton)."""

    class Meta:
        model = NotificationConfig
        django_get_or_create = ("pk",)

    pk = 1
    apprise_urls = ""
    cooldown_seconds = 300
    enabled = True


class NotificationLogFactory(DjangoModelFactory):
    """Factory for NotificationLog model."""

    class Meta:
        model = NotificationLog

    timestamp = factory.LazyFunction(timezone.now)
    notification_type = factory.LazyFunction(
        lambda: random.choice(["alert", "safety", "military", "emergency", "proximity", "tcas"])
    )
    icao_hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    message = factory.LazyFunction(lambda: "Test notification message")
    details = factory.LazyFunction(lambda: {"test": True})


class NotificationChannelFactory(DjangoModelFactory):
    """Factory for NotificationChannel model."""

    class Meta:
        model = NotificationChannel

    name = factory.LazyFunction(lambda: f"Channel {random.randint(1, 1000)}")
    channel_type = factory.LazyFunction(
        lambda: random.choice(["discord", "slack", "webhook", "ntfy", "telegram", "email"])
    )
    apprise_url = factory.LazyAttribute(
        lambda o: {
            "discord": "discord://webhook_id/webhook_token",
            "slack": "slack://token_a/token_b/token_c/#channel",
            "webhook": "json://localhost:8080/notify",
            "ntfy": "ntfy://ntfy.sh/test-topic",
            "telegram": "tgram://bot_token/chat_id",
            "email": "mailto://user:pass@gmail.com",
        }.get(o.channel_type, "json://localhost:8080/notify")
    )
    description = factory.LazyAttribute(lambda o: f"Test {o.channel_type} channel")
    supports_rich = factory.LazyAttribute(lambda o: o.channel_type in ("discord", "slack"))
    is_global = True
    owner = None
    enabled = True
    verified = False

    class Params:
        # User-owned private channel
        private = factory.Trait(
            is_global=False,
        )
        # Verified channel
        verified_channel = factory.Trait(
            verified=True,
            last_success=factory.LazyFunction(timezone.now),
        )
        # Disabled channel
        disabled = factory.Trait(
            enabled=False,
        )


class NotificationTemplateFactory(DjangoModelFactory):
    """Factory for NotificationTemplate model."""

    class Meta:
        model = NotificationTemplate

    name = factory.LazyFunction(lambda: f"template-{random.randint(1, 10000)}")
    description = "Test notification template"
    title_template = "Alert: {rule_name}"
    body_template = "{callsign} at {altitude}ft triggered {rule_name}"
    event_type = None
    priority = None
    is_default = False

    class Params:
        # Default template
        default = factory.Trait(
            name="default",
            is_default=True,
        )
        # Alert-specific
        alert = factory.Trait(
            event_type="alert",
        )
        # Critical priority
        critical = factory.Trait(
            priority="critical",
            title_template="CRITICAL: {rule_name}",
            body_template="EMERGENCY: {callsign} at {altitude}ft - {rule_name}",
        )


class UserNotificationPreferenceFactory(DjangoModelFactory):
    """Factory for UserNotificationPreference model."""

    class Meta:
        model = UserNotificationPreference

    channel = factory.SubFactory(NotificationChannelFactory)
    min_priority = "info"
    event_types = factory.LazyFunction(list)
    quiet_hours_start = None
    quiet_hours_end = None
    critical_overrides_quiet = True
    timezone = "UTC"
    enabled = True

    class Params:
        # Warning-only preference
        warnings_only = factory.Trait(
            min_priority="warning",
        )
        # With quiet hours
        with_quiet_hours = factory.Trait(
            quiet_hours_start=factory.LazyFunction(lambda: __import__("datetime").time(22, 0)),
            quiet_hours_end=factory.LazyFunction(lambda: __import__("datetime").time(8, 0)),
        )


class WatchedAircraftFactory(DjangoModelFactory):
    """Factory for WatchedAircraft model."""

    class Meta:
        model = WatchedAircraft

    hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    registration = factory.LazyFunction(generate_n_number)
    type_code = factory.LazyFunction(lambda: random.choice(["B738", "A320", "C172", "B77W", "E75L"]))
    notes = ""


class DailyStatsFactory(DjangoModelFactory):
    """Factory for DailyStats model."""

    class Meta:
        model = DailyStats

    date = factory.LazyFunction(lambda: timezone.now().date())
    unique_aircraft = fuzzy.FuzzyInteger(50, 500)
    new_aircraft = fuzzy.FuzzyInteger(0, 50)
    total_sessions = fuzzy.FuzzyInteger(50, 500)
    total_positions = fuzzy.FuzzyInteger(5000, 50000)
    military_count = fuzzy.FuzzyInteger(0, 20)
    max_distance_nm = fuzzy.FuzzyFloat(50.0, 250.0)
    max_altitude = fuzzy.FuzzyInteger(30000, 45000)
    max_speed = fuzzy.FuzzyFloat(400.0, 600.0)
    aircraft_types = factory.LazyFunction(lambda: {"B738": 45, "A320": 30, "C172": 10})
    operators = factory.LazyFunction(lambda: {"United Airlines": 20, "Delta Air Lines": 15})


class PersonalRecordFactory(DjangoModelFactory):
    """Factory for PersonalRecord model."""

    class Meta:
        model = PersonalRecord

    record_type = factory.LazyFunction(
        lambda: random.choice(["max_distance", "max_altitude", "max_speed", "longest_session", "closest_approach"])
    )
    icao_hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    aircraft_type = factory.LazyFunction(lambda: random.choice(["B738", "A320", "B77W", "C172"]))
    registration = factory.LazyFunction(generate_n_number)
    operator = factory.LazyFunction(lambda: random.choice(["United Airlines", "Delta Air Lines", "Private"]))
    value = factory.LazyAttribute(
        lambda o: {
            "max_distance": random.uniform(100, 250),
            "max_altitude": random.randint(35000, 45000),
            "max_speed": random.uniform(400, 600),
            "longest_session": random.uniform(60, 600),
            "closest_approach": random.uniform(0.1, 2.0),
        }.get(o.record_type, 100.0)
    )
    achieved_at = factory.LazyFunction(timezone.now)


class RareSightingFactory(DjangoModelFactory):
    """Factory for RareSighting model."""

    class Meta:
        model = RareSighting

    rarity_type = factory.LazyFunction(
        lambda: random.choice(["first_hex", "first_type", "rare_type", "military", "government"])
    )
    icao_hex = factory.LazyFunction(generate_icao_hex)
    callsign = factory.LazyFunction(generate_callsign)
    registration = factory.LazyFunction(generate_n_number)
    aircraft_type = factory.LazyFunction(lambda: random.choice(["B738", "C17", "A10", "B2"]))
    sighted_at = factory.LazyFunction(timezone.now)


class SightingStreakFactory(DjangoModelFactory):
    """Factory for SightingStreak model."""

    class Meta:
        model = SightingStreak

    streak_type = factory.Iterator(
        ["any_sighting", "military", "unique_new", "rare_type", "high_altitude", "long_range"]
    )
    current_streak_days = fuzzy.FuzzyInteger(0, 30)
    current_streak_start = factory.LazyFunction(lambda: timezone.now().date() - timedelta(days=random.randint(1, 30)))
    last_qualifying_date = factory.LazyFunction(lambda: timezone.now().date())
    best_streak_days = fuzzy.FuzzyInteger(5, 60)
    best_streak_start = factory.LazyFunction(lambda: (timezone.now() - timedelta(days=90)).date())
    best_streak_end = factory.LazyFunction(lambda: (timezone.now() - timedelta(days=30)).date())


class APIKeyFactory(DjangoModelFactory):
    """Factory for APIKey model."""

    class Meta:
        model = APIKey

    name = factory.LazyFunction(lambda: f"Test API Key {random.randint(1, 1000)}")
    key_hash = factory.LazyFunction(
        lambda: __import__("hashlib").sha256(f"sk_test_{random.randint(1, 999999)}".encode()).hexdigest()
    )
    key_prefix = factory.LazyFunction(lambda: f"sk_test_{random.randint(10, 99)}")
    scopes = factory.LazyFunction(list)
    is_active = True
    expires_at = None

    class Params:
        # Expired key
        expired = factory.Trait(
            expires_at=factory.LazyFunction(lambda: timezone.now() - timedelta(days=1)),
        )
        # Inactive key
        inactive = factory.Trait(
            is_active=False,
        )


class FeatureAccessFactory(DjangoModelFactory):
    """Factory for FeatureAccess model."""

    class Meta:
        model = FeatureAccess

    feature = factory.Iterator(["aircraft", "alerts", "safety", "audio", "stats", "history", "admin"])
    read_access = "public"
    write_access = "authenticated"


class CachedPirepFactory(DjangoModelFactory):
    """Factory for CachedPirep (pilot report) model."""

    class Meta:
        model = CachedPirep

    pirep_id = factory.Sequence(lambda n: f"PIREP-{n:06d}")
    report_type = "UA"
    location = "KSEA"
    latitude = 47.44
    longitude = -122.31
    observation_time = factory.LazyFunction(timezone.now)
    flight_level = 120
    altitude_ft = 12000
    aircraft_type = "B738"
    turbulence_type = "MOD"
    turbulence_freq = "OCNL"
    raw_text = factory.LazyAttribute(
        lambda o: (
            f"{o.location} UA /OV {o.location}/TM 1200/FL{o.flight_level:03d}/TP {o.aircraft_type}/TB {o.turbulence_type}"
        )
    )

    class Params:
        severe = factory.Trait(report_type="UUA", turbulence_type="SEV")
        icing = factory.Trait(turbulence_type=None, icing_type="MOD", icing_intensity="MOD")


class CachedNotamFactory(DjangoModelFactory):
    """Factory for CachedNotam model (active window spans now by default)."""

    class Meta:
        model = CachedNotam

    notam_id = factory.Sequence(lambda n: f"NOTAM-{n:06d}")
    notam_type = "D"
    location = "KSEA"
    latitude = 47.44
    longitude = -122.31
    effective_start = factory.LazyFunction(lambda: timezone.now() - timedelta(hours=1))
    effective_end = factory.LazyFunction(lambda: timezone.now() + timedelta(hours=24))
    text = "RWY 16L/34R CLSD"
    raw_text = factory.LazyAttribute(lambda o: o.text)

    class Params:
        tfr = factory.Trait(notam_type="TFR", radius_nm=10.0, floor_ft=0, ceiling_ft=18000, reason="HAZARDS")
