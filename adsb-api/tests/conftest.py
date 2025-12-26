"""
Shared pytest fixtures for ADS-B API tests
"""
import os
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

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
from app.models import NotificationConfig


@pytest.fixture(scope="session")
def anyio_backend():
    """Use asyncio for async tests"""
    return "asyncio"


@pytest_asyncio.fixture
async def db_engine():
    """Create async test database engine"""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create async test database session"""
    async_session = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        # Create default notification config
        config = NotificationConfig(
            apprise_urls='',
            cooldown_seconds=300,
            enabled=True
        )
        session.add(config)
        await session.commit()

        yield session

        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create async test client with database override"""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def sample_aircraft_data():
    """Sample aircraft.json response from ultrafeeder"""
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
    """Sample UAT aircraft data"""
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
