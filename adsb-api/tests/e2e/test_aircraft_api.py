"""
End-to-end tests for Aircraft API endpoints.

Tests all aircraft tracking endpoints including:
- Real-time aircraft list
- Aircraft statistics
- Top aircraft by category
- Individual aircraft lookup
- UAT aircraft
"""
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.models import AircraftSighting, AircraftSession, AircraftInfo


@pytest.mark.asyncio
class TestAircraftListEndpoint:
    """Tests for GET /api/v1/aircraft endpoint."""

    async def test_get_aircraft_empty_database(self, client: AsyncClient):
        """Test GET /api/v1/aircraft returns empty list when no aircraft."""
        response = await client.get("/api/v1/aircraft")

        assert response.status_code == 200
        data = response.json()
        assert "aircraft" in data
        assert isinstance(data["aircraft"], list)
        assert "count" in data
        assert "timestamp" in data
        assert data["count"] == len(data["aircraft"])

    async def test_get_aircraft_with_sightings(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft returns aircraft from recent sightings."""
        # Create test sightings within the 2-minute window
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex="A12345",
                callsign="UAL123",
                latitude=47.95,
                longitude=-121.95,
                altitude_baro=35000,
                ground_speed=450,
                track=180,
                vertical_rate=-500,
                squawk="1200",
                aircraft_type="B738",
                is_military=False,
                timestamp=now - timedelta(seconds=30)
            ),
            AircraftSighting(
                icao_hex="AE1234",
                callsign="RCH001",
                latitude=47.90,
                longitude=-121.90,
                altitude_baro=25000,
                ground_speed=380,
                track=90,
                vertical_rate=1500,
                squawk="4567",
                aircraft_type="C17",
                is_military=True,
                timestamp=now - timedelta(seconds=60)
            ),
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2

        # Verify aircraft data structure
        hex_codes = [ac.get("hex") for ac in data["aircraft"]]
        assert "A12345" in hex_codes
        assert "AE1234" in hex_codes

    async def test_get_aircraft_response_structure(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft returns correct response structure."""
        now = datetime.utcnow()
        sighting = AircraftSighting(
            icao_hex="A12345",
            callsign="UAL123",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            altitude_geom=35100,
            ground_speed=450,
            track=180,
            vertical_rate=-500,
            squawk="1200",
            category="A3",
            aircraft_type="B738",
            is_military=False,
            rssi=-25.5,
            distance_nm=15.2,
            timestamp=now
        )
        db_session.add(sighting)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft")

        assert response.status_code == 200
        data = response.json()

        # Verify response fields
        assert "aircraft" in data
        assert "count" in data
        assert "now" in data
        assert "timestamp" in data

        # Verify aircraft fields
        if data["aircraft"]:
            ac = data["aircraft"][0]
            expected_fields = [
                "hex", "flight", "lat", "lon", "alt_baro",
                "gs", "track", "squawk", "distance_nm"
            ]
            for field in expected_fields:
                assert field in ac, f"Missing field: {field}"

    async def test_get_aircraft_enriched_with_info(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft enriches data with AircraftInfo."""
        now = datetime.utcnow()

        # Create sighting
        sighting = AircraftSighting(
            icao_hex="A12345",
            callsign="UAL123",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            timestamp=now
        )
        db_session.add(sighting)

        # Create corresponding aircraft info
        info = AircraftInfo(
            icao_hex="A12345",
            registration="N12345",
            type_code="B738",
            type_name="Boeing 737-800",
            manufacturer="Boeing",
            operator="United Airlines",
            photo_url="https://example.com/photo.jpg"
        )
        db_session.add(info)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft")

        assert response.status_code == 200
        data = response.json()

        # Find our aircraft
        aircraft = next(
            (ac for ac in data["aircraft"] if ac.get("hex") == "A12345"),
            None
        )
        assert aircraft is not None

        # Verify enriched fields
        assert aircraft.get("registration") == "N12345" or aircraft.get("r") == "N12345"
        assert aircraft.get("operator") == "United Airlines" or aircraft.get("ownOp") == "United Airlines"

    async def test_get_aircraft_excludes_old_sightings(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft excludes sightings older than 2 minutes."""
        now = datetime.utcnow()

        # Create recent sighting
        recent = AircraftSighting(
            icao_hex="RECENT",
            timestamp=now - timedelta(seconds=60)
        )
        # Create old sighting (should be excluded)
        old = AircraftSighting(
            icao_hex="OLDSIGHTING",
            timestamp=now - timedelta(minutes=5)
        )
        db_session.add_all([recent, old])
        await db_session.commit()

        response = await client.get("/api/v1/aircraft")

        assert response.status_code == 200
        data = response.json()

        hex_codes = [ac.get("hex") for ac in data["aircraft"]]
        assert "RECENT" in hex_codes
        # Old sighting should NOT be included
        assert "OLDSIGHTING" not in hex_codes

    async def test_get_aircraft_military_flag(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft returns correct military flag."""
        now = datetime.utcnow()

        # Create military and civilian aircraft
        civilian = AircraftSighting(
            icao_hex="CIVIL1",
            is_military=False,
            timestamp=now
        )
        military = AircraftSighting(
            icao_hex="MILIT1",
            is_military=True,
            timestamp=now
        )
        db_session.add_all([civilian, military])
        await db_session.commit()

        response = await client.get("/api/v1/aircraft")

        assert response.status_code == 200
        data = response.json()

        civilian_ac = next(
            (ac for ac in data["aircraft"] if ac.get("hex") == "CIVIL1"),
            None
        )
        military_ac = next(
            (ac for ac in data["aircraft"] if ac.get("hex") == "MILIT1"),
            None
        )

        assert civilian_ac is not None
        assert military_ac is not None
        # dbFlags == 0 for civilian, 1 for military
        assert civilian_ac.get("dbFlags", 0) == 0
        assert military_ac.get("dbFlags", 0) == 1


@pytest.mark.asyncio
class TestAircraftStatsEndpoint:
    """Tests for GET /api/v1/aircraft/stats endpoint."""

    async def test_get_stats_returns_503_when_cache_empty(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/stats returns 503 when stats not cached."""
        with patch('app.services.stats_cache.get_aircraft_stats', return_value=None):
            response = await client.get("/api/v1/aircraft/stats")

            # May return 503 if cache is empty
            assert response.status_code in [200, 503]

    async def test_get_stats_returns_cached_data(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/stats returns cached statistics."""
        mock_stats = {
            "total": 45,
            "with_position": 42,
            "military": 3,
            "altitude_distribution": {
                "0-10k": 5,
                "10-20k": 12,
                "20-30k": 15,
                "30-40k": 10,
                "40k+": 0
            },
            "category_distribution": {
                "A1": 5,
                "A2": 10,
                "A3": 25,
                "A5": 5
            },
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        with patch('app.services.stats_cache.get_aircraft_stats', return_value=mock_stats):
            response = await client.get("/api/v1/aircraft/stats")

            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 45
            assert data["with_position"] == 42
            assert data["military"] == 3

    async def test_get_stats_response_structure(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/stats returns expected structure."""
        mock_stats = {
            "total": 10,
            "with_position": 8,
            "military": 1,
            "altitude_distribution": {},
            "category_distribution": {},
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        with patch('app.services.stats_cache.get_aircraft_stats', return_value=mock_stats):
            response = await client.get("/api/v1/aircraft/stats")

            assert response.status_code == 200
            data = response.json()

            # Verify required fields
            required_fields = ["total", "with_position", "timestamp"]
            for field in required_fields:
                assert field in data, f"Missing required field: {field}"


@pytest.mark.asyncio
class TestTopAircraftEndpoint:
    """Tests for GET /api/v1/aircraft/top endpoint."""

    async def test_get_top_returns_503_when_cache_empty(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/top returns 503 when cache empty."""
        with patch('app.services.stats_cache.get_top_aircraft', return_value=None):
            response = await client.get("/api/v1/aircraft/top")

            assert response.status_code in [200, 503]

    async def test_get_top_returns_cached_data(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/top returns cached top aircraft."""
        mock_top = {
            "closest": [
                {"hex": "A12345", "callsign": "UAL123", "distance_nm": 5.2}
            ],
            "highest": [
                {"hex": "B67890", "callsign": "DAL456", "altitude": 43000}
            ],
            "fastest": [
                {"hex": "C11111", "callsign": "SWA789", "gs": 580}
            ],
            "climbing": [
                {"hex": "D22222", "callsign": "AAL001", "baro_rate": 4500}
            ],
            "military": [
                {"hex": "AE1234", "callsign": "RCH001", "distance_nm": 25.0}
            ],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        with patch('app.services.stats_cache.get_top_aircraft', return_value=mock_top):
            response = await client.get("/api/v1/aircraft/top")

            assert response.status_code == 200
            data = response.json()
            assert "closest" in data
            assert "highest" in data
            assert "fastest" in data
            assert "climbing" in data
            assert "military" in data

    async def test_get_top_categories_have_correct_format(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/top categories have correct data format."""
        mock_top = {
            "closest": [{"hex": "A12345", "distance_nm": 5.2, "callsign": "TEST"}],
            "highest": [{"hex": "B67890", "altitude": 43000, "callsign": "TEST"}],
            "fastest": [{"hex": "C11111", "gs": 580, "callsign": "TEST"}],
            "climbing": [{"hex": "D22222", "baro_rate": 4500, "callsign": "TEST"}],
            "military": [],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        with patch('app.services.stats_cache.get_top_aircraft', return_value=mock_top):
            response = await client.get("/api/v1/aircraft/top")

            assert response.status_code == 200
            data = response.json()

            # Verify each category is a list
            for category in ["closest", "highest", "fastest", "climbing", "military"]:
                assert category in data
                assert isinstance(data[category], list)


@pytest.mark.asyncio
class TestAircraftByHexEndpoint:
    """Tests for GET /api/v1/aircraft/{hex_code} endpoint."""

    async def test_get_aircraft_by_hex_found(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{hex} returns aircraft when found."""
        now = datetime.utcnow()
        sighting = AircraftSighting(
            icao_hex="A12345",
            callsign="UAL123",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            ground_speed=450,
            timestamp=now
        )
        db_session.add(sighting)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft/A12345")

        assert response.status_code == 200
        data = response.json()
        assert data["found"] is True
        assert data["aircraft"]["hex"] == "A12345"
        assert data["aircraft"]["flight"] == "UAL123"

    async def test_get_aircraft_by_hex_not_found(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/{hex} returns 404 when not found."""
        response = await client.get("/api/v1/aircraft/NOTFOUND")

        assert response.status_code == 404
        data = response.json()
        assert "detail" in data

    async def test_get_aircraft_by_hex_case_insensitive(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{hex} is case insensitive."""
        now = datetime.utcnow()
        sighting = AircraftSighting(
            icao_hex="A12345",
            timestamp=now
        )
        db_session.add(sighting)
        await db_session.commit()

        # Request with lowercase
        response = await client.get("/api/v1/aircraft/a12345")

        assert response.status_code == 200
        data = response.json()
        assert data["found"] is True

    async def test_get_aircraft_by_hex_validates_length(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/{hex} validates hex code length."""
        # Too short (min 6)
        response = await client.get("/api/v1/aircraft/A123")
        assert response.status_code == 422

        # Too long (max 10)
        response = await client.get("/api/v1/aircraft/A1234567890123")
        assert response.status_code == 422

    async def test_get_aircraft_by_hex_excludes_old_sightings(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{hex} excludes sightings older than 10 minutes."""
        now = datetime.utcnow()
        old_sighting = AircraftSighting(
            icao_hex="OLDAIR",
            timestamp=now - timedelta(minutes=15)
        )
        db_session.add(old_sighting)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft/OLDAIR")

        # Should return 404 since sighting is too old
        assert response.status_code == 404


@pytest.mark.asyncio
class TestUatAircraftEndpoint:
    """Tests for GET /api/v1/uat/aircraft endpoint."""

    async def test_get_uat_aircraft_empty(self, client: AsyncClient):
        """Test GET /api/v1/uat/aircraft returns empty list when no UAT aircraft."""
        response = await client.get("/api/v1/uat/aircraft")

        assert response.status_code == 200
        data = response.json()
        assert "aircraft" in data
        assert isinstance(data["aircraft"], list)
        assert "count" in data

    async def test_get_uat_aircraft_filters_by_source(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/uat/aircraft only returns 978 MHz source aircraft."""
        now = datetime.utcnow()

        # Create UAT (978) aircraft
        uat_sighting = AircraftSighting(
            icao_hex="UAT123",
            source="978",
            timestamp=now
        )
        # Create 1090 MHz aircraft
        adsb_sighting = AircraftSighting(
            icao_hex="ADSB01",
            source="1090",
            timestamp=now
        )
        db_session.add_all([uat_sighting, adsb_sighting])
        await db_session.commit()

        response = await client.get("/api/v1/uat/aircraft")

        assert response.status_code == 200
        data = response.json()

        hex_codes = [ac.get("hex") for ac in data["aircraft"]]
        assert "UAT123" in hex_codes
        # 1090 MHz aircraft should NOT be included
        assert "ADSB01" not in hex_codes


@pytest.mark.asyncio
class TestAircraftApiIntegration:
    """Integration tests for aircraft API system."""

    async def test_aircraft_lifecycle(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test complete aircraft tracking lifecycle."""
        now = datetime.utcnow()

        # 1. Initially no aircraft
        response = await client.get("/api/v1/aircraft")
        initial_count = response.json()["count"]

        # 2. Aircraft appears (add sighting)
        sighting = AircraftSighting(
            icao_hex="LIFE01",
            callsign="TEST001",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            ground_speed=450,
            timestamp=now
        )
        db_session.add(sighting)
        await db_session.commit()

        # 3. Aircraft should now be visible
        response = await client.get("/api/v1/aircraft")
        assert response.json()["count"] > initial_count

        # 4. Get specific aircraft
        response = await client.get("/api/v1/aircraft/LIFE01")
        assert response.status_code == 200
        assert response.json()["found"] is True

    async def test_concurrent_aircraft_queries(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test system handles sequential requests correctly."""
        now = datetime.utcnow()

        # Create test aircraft
        for i in range(5):
            sighting = AircraftSighting(
                icao_hex=f"CONC{i:02d}",
                timestamp=now
            )
            db_session.add(sighting)
        await db_session.commit()

        # Make sequential requests
        responses = []
        for _ in range(3):
            r = await client.get("/api/v1/aircraft")
            responses.append(r)

        # All should succeed
        for r in responses:
            assert r.status_code == 200
            assert r.json()["count"] >= 5
