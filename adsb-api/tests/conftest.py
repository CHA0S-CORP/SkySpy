"""
Shared pytest fixtures for ADS-B API tests.

Provides fixtures for database sessions, HTTP clients, mock data,
and utilities for mocking external services.
"""
import os
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timedelta
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# Set test environment variables before importing app
os.environ.setdefault('DATABASE_URL', 'sqlite+aiosqlite:///:memory:')
os.environ.setdefault('ULTRAFEEDER_HOST', 'ultrafeeder')
os.environ.setdefault('ULTRAFEEDER_PORT', '80')
os.environ.setdefault('DUMP978_HOST', 'dump978')
os.environ.setdefault('DUMP978_PORT', '80')
os.environ.setdefault('FEEDER_LAT', '47.9377')
os.environ.setdefault('FEEDER_LON', '-121.9687')
os.environ.setdefault('APPRISE_URLS', '')
os.environ.setdefault('NOTIFICATION_COOLDOWN', '300')
os.environ.setdefault('SAFETY_MONITORING_ENABLED', 'true')
os.environ.setdefault('SAFETY_VS_CHANGE_THRESHOLD', '3000')
os.environ.setdefault('SAFETY_VS_EXTREME_THRESHOLD', '4500')
os.environ.setdefault('SAFETY_PROXIMITY_NM', '1.0')
os.environ.setdefault('SAFETY_ALTITUDE_DIFF_FT', '1000')

from app.main import app
from app.core.database import Base, get_db
from app.models import (
    NotificationConfig, AlertRule, AlertHistory, SafetyEvent,
    AircraftSighting, AircraftSession, AircraftInfo, AcarsMessage,
    NotificationLog, AirspaceAdvisory, AirspaceBoundary
)


@pytest.fixture(scope="session")
def anyio_backend():
    """Use asyncio for async tests."""
    return "asyncio"


@pytest_asyncio.fixture
async def db_engine():
    """Create async test database engine."""
    database_url = os.getenv(
        "DATABASE_URL",
        "sqlite+aiosqlite:///:memory:"
    )

    # SQLite doesn't support pool_pre_ping
    if database_url.startswith("sqlite"):
        engine = create_async_engine(database_url, echo=False)
    else:
        engine = create_async_engine(database_url, echo=False, pool_pre_ping=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create async test database session with proper cleanup."""
    async_session = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        # Clean up tables before each test (use DELETE instead of TRUNCATE to avoid locks)
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(table.delete())
        await session.commit()

        # Create default notification config
        config = NotificationConfig(
            apprise_urls='',
            cooldown_seconds=300,
            enabled=True
        )
        session.add(config)
        await session.commit()

        yield session

        # Rollback any uncommitted changes
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create async test client with database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# =============================================================================
# Sample Aircraft Data Fixtures
# =============================================================================

@pytest.fixture
def sample_aircraft_data():
    """Sample aircraft.json response from ultrafeeder."""
    return {
        "now": 1703001234.567,
        "messages": 123456,
        "aircraft": [
            {
                "hex": "a12345",
                "flight": "UAL123  ",
                "lat": 47.95,
                "lon": -121.95,
                "alt_baro": 35000,
                "alt_geom": 35100,
                "gs": 450,
                "track": 180,
                "baro_rate": -500,
                "squawk": "1200",
                "category": "A3",
                "t": "B738",
                "rssi": -25.5,
            },
            {
                "hex": "ae1234",
                "flight": "RCH001  ",
                "lat": 47.90,
                "lon": -121.90,
                "alt_baro": 25000,
                "gs": 380,
                "track": 90,
                "baro_rate": 1500,
                "squawk": "4567",
                "category": "A5",
                "t": "C17",
                "rssi": -22.0,
                "dbFlags": 1,  # Military flag
            },
            {
                "hex": "b99999",
                "flight": "EMG777  ",
                "lat": 47.94,
                "lon": -121.97,
                "alt_baro": 8000,
                "gs": 200,
                "baro_rate": -2000,
                "squawk": "7700",  # Emergency
                "category": "A1",
                "t": "C172",
                "rssi": -18.0,
            }
        ]
    }


@pytest.fixture
def sample_uat_data():
    """Sample UAT aircraft data from dump978."""
    return {
        "now": 1703001234.567,
        "aircraft": [
            {
                "hex": "a11111",
                "lat": 47.92,
                "lon": -121.93,
                "alt_baro": 5000,
                "gs": 120,
                "track": 270,
                "squawk": "1200",
            }
        ]
    }


@pytest.fixture
def sample_aircraft_with_conflicts():
    """Sample aircraft data with proximity conflicts."""
    return {
        "now": 1703001234.567,
        "messages": 123456,
        "aircraft": [
            {
                "hex": "a11111",
                "flight": "AAL100  ",
                "lat": 47.9500,
                "lon": -121.9500,
                "alt_baro": 10000,
                "gs": 300,
                "track": 90,
                "baro_rate": 0,
                "squawk": "1200",
            },
            {
                "hex": "a22222",
                "flight": "DAL200  ",
                "lat": 47.9505,  # Very close - ~0.3nm
                "lon": -121.9480,
                "alt_baro": 10500,  # Within 1000ft
                "gs": 280,
                "track": 270,  # Head-on
                "baro_rate": -500,
                "squawk": "1200",
            },
        ]
    }


# =============================================================================
# Aviation Data Fixtures
# =============================================================================

@pytest.fixture
def sample_metar_response():
    """Sample METAR response from aviationweather.gov."""
    return [
        {
            "icaoId": "KSEA",
            "rawOb": "KSEA 211256Z 18008KT 10SM FEW045 12/06 A3012",
            "temp": 12,
            "dewp": 6,
            "wdir": 180,
            "wspd": 8,
            "visib": 10,
            "altim": 30.12,
            "fltcat": "VFR",
            "lat": 47.449,
            "lon": -122.309,
        }
    ]


@pytest.fixture
def sample_taf_response():
    """Sample TAF response from aviationweather.gov."""
    return [
        {
            "icaoId": "KSEA",
            "rawTAF": "TAF KSEA 211130Z 2112/2212 18010KT P6SM FEW050 SCT150",
            "validTimeFrom": 1703160000,
            "validTimeTo": 1703246400,
            "lat": 47.449,
            "lon": -122.309,
        }
    ]


@pytest.fixture
def sample_airport_response():
    """Sample airport info response from aviationweather.gov."""
    return [
        {
            "icaoId": "KSEA",
            "name": "Seattle-Tacoma International",
            "lat": 47.449,
            "lon": -122.309,
            "elev": 433,
            "type": "large_airport",
        }
    ]


@pytest.fixture
def sample_navaid_response():
    """Sample navaid response from aviationweather.gov."""
    return [
        {
            "id": "SEA",
            "name": "SEATTLE",
            "type": "VORTAC",
            "lat": 47.435,
            "lon": -122.310,
            "freq": 116.80,
        }
    ]


@pytest.fixture
def sample_pirep_response():
    """Sample PIREP response from aviationweather.gov."""
    return [
        {
            "rawOb": "KSEA UA /OV SEA/TM 1230/FL350/TP B738/TB LGT",
            "acType": "B738",
            "fltlvl": 350,
            "turbType": "LGT",
            "lat": 47.5,
            "lon": -122.3,
        }
    ]


@pytest.fixture
def sample_sigmet_response():
    """Sample SIGMET response from aviationweather.gov."""
    return [
        {
            "airSigmetType": "SIGMET",
            "hazard": "TURB",
            "severity": "SEV",
            "validTimeFrom": 1703160000,
            "validTimeTo": 1703174400,
            "lat": 47.5,
            "lon": -122.3,
        }
    ]


# =============================================================================
# Aircraft Info Fixtures
# =============================================================================

@pytest.fixture
def sample_hexdb_response():
    """Sample response from hexdb.io API."""
    return {
        "icao_hex": "A12345",
        "registration": "N12345",
        "type": "B738",
        "manufacturer": "Boeing",
        "model": "737-8AS",
        "operator": "United Airlines",
        "operator_icao": "UAL",
        "built": "2007",
        "country": "United States",
    }


@pytest.fixture
def sample_planespotters_response():
    """Sample response from planespotters.net API."""
    return {
        "photos": [
            {
                "id": "12345",
                "thumbnail": {
                    "src": "https://cdn.planespotters.net/photo/12345_thumb.jpg"
                },
                "link": "https://cdn.planespotters.net/photo/12345.jpg",
                "photographer": "John Doe",
            }
        ]
    }


# =============================================================================
# ACARS Message Fixtures
# =============================================================================

@pytest.fixture
def sample_acars_messages():
    """Sample ACARS messages for testing."""
    now = datetime.utcnow()
    return [
        AcarsMessage(
            timestamp=now - timedelta(minutes=5),
            source="acars",
            frequency=130.025,
            icao_hex="A12345",
            callsign="UAL123",
            label="H1",
            text="DEPARTURE CLEARANCE CONFIRMED",
        ),
        AcarsMessage(
            timestamp=now - timedelta(minutes=3),
            source="vdlm2",
            frequency=136.975,
            icao_hex="A12345",
            callsign="UAL123",
            label="SA",
            text="POSITION REPORT 47.5N 122.3W",
        ),
        AcarsMessage(
            timestamp=now - timedelta(minutes=1),
            source="acars",
            frequency=130.025,
            icao_hex="B67890",
            callsign="DAL456",
            label="QA",
            text="WEATHER REQUEST KSEA",
        ),
    ]


# =============================================================================
# Alert Rule Fixtures
# =============================================================================

@pytest.fixture
def sample_alert_rules():
    """Sample alert rules for testing."""
    return [
        AlertRule(
            name="Emergency Aircraft",
            rule_type="squawk",
            operator="eq",
            value="7700",
            description="Alert on emergency squawk",
            enabled=True,
            priority="critical",
        ),
        AlertRule(
            name="Low Altitude",
            rule_type="altitude",
            operator="lt",
            value="3000",
            description="Aircraft below 3000ft",
            enabled=True,
            priority="warning",
        ),
        AlertRule(
            name="Military Aircraft",
            rule_type="military",
            operator="eq",
            value="true",
            description="Any military aircraft",
            enabled=False,
            priority="info",
        ),
    ]


@pytest.fixture
def sample_complex_alert_rule():
    """Sample complex alert rule with AND/OR logic."""
    return AlertRule(
        name="Military Low Approach",
        conditions={
            "logic": "AND",
            "groups": [
                {
                    "logic": "AND",
                    "conditions": [
                        {"type": "military", "operator": "eq", "value": "true"},
                        {"type": "altitude", "operator": "lt", "value": "5000"},
                    ]
                }
            ]
        },
        description="Military aircraft below 5000ft",
        enabled=True,
        priority="critical",
    )


# =============================================================================
# Safety Event Fixtures
# =============================================================================

@pytest.fixture
def sample_safety_events():
    """Sample safety events for testing."""
    now = datetime.utcnow()
    return [
        SafetyEvent(
            timestamp=now - timedelta(hours=1),
            event_type="emergency_squawk",
            severity="critical",
            icao_hex="a12345",
            callsign="EMG777",
            message="Emergency squawk 7700 detected",
            details={"squawk": "7700", "altitude": 8000},
        ),
        SafetyEvent(
            timestamp=now - timedelta(minutes=30),
            event_type="proximity_conflict",
            severity="warning",
            icao_hex="b67890",
            icao_hex_2="c11111",
            callsign="UAL001",
            callsign_2="DAL002",
            message="Proximity conflict: 0.8nm separation",
            details={"distance_nm": 0.8, "altitude_diff_ft": 500, "closure_rate_kts": 200},
        ),
        SafetyEvent(
            timestamp=now - timedelta(minutes=15),
            event_type="extreme_vertical_rate",
            severity="warning",
            icao_hex="d44444",
            callsign="SWA333",
            message="Extreme descent rate: -5000 ft/min",
            details={"vertical_rate": -5000, "altitude": 15000},
        ),
    ]


# =============================================================================
# Mock Helpers
# =============================================================================

@pytest.fixture
def mock_httpx_client():
    """Mock httpx.AsyncClient for external API calls."""
    with patch('httpx.AsyncClient') as mock_class:
        mock_client = AsyncMock()
        mock_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_class.return_value.__aexit__ = AsyncMock(return_value=None)
        yield mock_client


def create_mock_response(data, status_code=200):
    """Create a mock httpx response."""
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = data
    mock.text = str(data)
    mock.raise_for_status = MagicMock()
    if status_code >= 400:
        from httpx import HTTPStatusError, Request
        mock.raise_for_status.side_effect = HTTPStatusError(
            message="Error",
            request=Request("GET", "http://test"),
            response=mock
        )
    return mock


# =============================================================================
# Database Helpers
# =============================================================================

@pytest_asyncio.fixture
async def populated_db(db_session: AsyncSession, sample_safety_events, sample_acars_messages):
    """Pre-populate database with sample data."""
    # Add safety events
    for event in sample_safety_events:
        db_session.add(event)

    # Add ACARS messages
    for msg in sample_acars_messages:
        db_session.add(msg)

    await db_session.commit()
    return db_session


@pytest_asyncio.fixture
async def db_with_aircraft_info(db_session: AsyncSession):
    """Pre-populate database with aircraft info."""
    info = AircraftInfo(
        icao_hex="A12345",
        registration="N12345",
        type_code="B738",
        type_name="Boeing 737-800",
        manufacturer="Boeing",
        model="737-8AS",
        serial_number="29934",
        year_built=2007,
        operator="United Airlines",
        operator_icao="UAL",
        country="United States",
        is_military=False,
        photo_url="https://cdn.planespotters.net/photo/12345.jpg",
        photo_thumbnail_url="https://cdn.planespotters.net/photo/12345_thumb.jpg",
        photo_photographer="John Doe",
        photo_source="planespotters.net",
    )
    db_session.add(info)
    await db_session.commit()
    return db_session


@pytest_asyncio.fixture
async def db_with_alert_rules(db_session: AsyncSession, sample_alert_rules):
    """Pre-populate database with alert rules."""
    for rule in sample_alert_rules:
        db_session.add(rule)
    await db_session.commit()
    return db_session


@pytest_asyncio.fixture
async def db_with_sightings(db_session: AsyncSession):
    """Pre-populate database with aircraft sightings."""
    now = datetime.utcnow()
    sightings = [
        AircraftSighting(
            timestamp=now - timedelta(minutes=i),
            icao_hex="a12345",
            callsign="UAL123",
            latitude=47.95 + (i * 0.001),
            longitude=-121.95 + (i * 0.001),
            altitude_baro=35000 - (i * 100),
            ground_speed=450,
            track=180,
            vertical_rate=-500,
            squawk="1200",
            aircraft_type="B738",
            is_military=False,
            is_emergency=False,
        )
        for i in range(10)
    ]
    for s in sightings:
        db_session.add(s)

    session = AircraftSession(
        icao_hex="a12345",
        callsign="UAL123",
        first_seen=now - timedelta(minutes=10),
        last_seen=now,
        total_positions=10,
        max_altitude=35000,
        min_altitude=34000,
        min_distance_nm=5.0,
        max_distance_nm=15.0,
    )
    db_session.add(session)
    await db_session.commit()
    return db_session


@pytest_asyncio.fixture
async def db_with_airspace_data(db_session: AsyncSession):
    """Pre-populate database with airspace data."""
    now = datetime.utcnow()
    advisory = AirspaceAdvisory(
        fetched_at=now,
        advisory_id="GAIRMET-SIERRA-1",
        advisory_type="GAIRMET",
        hazard="IFR",
        severity="LIFR",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=5),
        lower_alt_ft=0,
        upper_alt_ft=8000,
        region="PACIFIC",
        polygon={"type": "Polygon", "coordinates": [[[-122, 47], [-121, 47], [-121, 48], [-122, 48], [-122, 47]]]},
        raw_text="IFR CONDITIONS EXPECTED",
    )
    db_session.add(advisory)

    boundary = AirspaceBoundary(
        fetched_at=now,
        name="Seattle Class B",
        icao="KSEA",
        airspace_class="B",
        floor_ft=0,
        ceiling_ft=10000,
        center_lat=47.449,
        center_lon=-122.309,
        radius_nm=30,
        polygon={"type": "Polygon", "coordinates": [[[-122.5, 47.3], [-122.0, 47.3], [-122.0, 47.6], [-122.5, 47.6], [-122.5, 47.3]]]},
        controlling_agency="Seattle TRACON",
        source="embedded",
    )
    db_session.add(boundary)
    await db_session.commit()
    return db_session
