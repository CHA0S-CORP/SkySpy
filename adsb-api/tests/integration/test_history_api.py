"""Integration tests for history API endpoints"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from app.models import AircraftSighting, AircraftSession


@pytest.mark.asyncio
class TestHistoryEndpoints:
    """Tests for /api/v1/history endpoints"""

    async def test_get_sightings_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/sightings with no data"""
        response = await client.get("/api/v1/history/sightings")
        assert response.status_code == 200
        data = response.json()
        assert "sightings" in data
        assert isinstance(data["sightings"], list)
        assert data["count"] == 0

    async def test_get_sightings_with_data(self, client: AsyncClient, db_session: AsyncSession):
        """Test GET /api/v1/history/sightings with existing data"""
        # Create test sightings using correct field name
        now = datetime.utcnow()
        sighting = AircraftSighting(
            icao_hex="a12345",
            callsign="TEST123",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            ground_speed=450,
            track=180,
            vertical_rate=-500,
            squawk="1200",
            aircraft_type="B738",
            timestamp=now
        )
        db_session.add(sighting)
        await db_session.commit()

        # Get sightings
        response = await client.get("/api/v1/history/sightings?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        assert any(s["icao_hex"] == "a12345" for s in data["sightings"])

    async def test_get_sessions_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/sessions with no data"""
        response = await client.get("/api/v1/history/sessions")
        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert isinstance(data["sessions"], list)
        assert data["count"] == 0

    async def test_get_sessions_with_data(self, client: AsyncClient, db_session: AsyncSession):
        """Test GET /api/v1/history/sessions with existing data"""
        # Create test session using correct field name
        now = datetime.utcnow()
        session = AircraftSession(
            icao_hex="b67890",
            callsign="UAL456",
            first_seen=now - timedelta(minutes=10),
            last_seen=now,
            max_altitude=38000,
            min_distance_nm=2.5
        )
        db_session.add(session)
        await db_session.commit()

        # Get sessions
        response = await client.get("/api/v1/history/sessions?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        assert any(s["icao_hex"] == "b67890" for s in data["sessions"])

    async def test_get_sightings_filter_by_icao(self, client: AsyncClient, db_session: AsyncSession):
        """Test GET /api/v1/history/sightings?icao_hex=a12345"""
        # Create sightings for different aircraft
        now = datetime.utcnow()
        sighting1 = AircraftSighting(
            icao_hex="a12345",
            callsign="TEST1",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            timestamp=now
        )
        sighting2 = AircraftSighting(
            icao_hex="b67890",
            callsign="TEST2",
            latitude=47.90,
            longitude=-121.90,
            altitude_baro=25000,
            timestamp=now
        )
        db_session.add_all([sighting1, sighting2])
        await db_session.commit()

        # Filter by ICAO (use icao_hex parameter)
        response = await client.get("/api/v1/history/sightings?icao_hex=a12345")
        assert response.status_code == 200
        data = response.json()
        assert all(s["icao_hex"] == "a12345" for s in data["sightings"])
