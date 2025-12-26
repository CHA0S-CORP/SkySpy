"""Integration tests for aircraft API endpoints"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestAircraftEndpoints:
    """Tests for /api/v1/aircraft endpoints"""

    async def test_get_aircraft_live_empty(self, client: AsyncClient):
        """Test GET /api/v1/aircraft with no data"""
        response = await client.get("/api/v1/aircraft")
        assert response.status_code == 200
        data = response.json()
        assert "aircraft" in data
        assert isinstance(data["aircraft"], list)

    async def test_get_aircraft_stats(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/stats"""
        response = await client.get("/api/v1/aircraft/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "with_position" in data
        assert "timestamp" in data

    async def test_get_aircraft_top(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/top"""
        response = await client.get("/api/v1/aircraft/top")
        assert response.status_code == 200
        data = response.json()
        assert "highest" in data
        assert "fastest" in data
        assert "closest" in data


@pytest.mark.asyncio
class TestHealthEndpoint:
    """Tests for health check endpoint"""

    async def test_health_check(self, client: AsyncClient):
        """Test GET /api/v1/health"""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    async def test_status_endpoint(self, client: AsyncClient):
        """Test GET /api/v1/status"""
        response = await client.get("/api/v1/status")
        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert "adsb_online" in data
        assert "aircraft_count" in data
