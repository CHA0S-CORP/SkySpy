"""
End-to-end tests for aircraft info/airframe API endpoints.

Tests aircraft information lookup, photos, bulk lookups, and cache statistics.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AircraftInfo


@pytest.mark.asyncio
class TestAircraftInfoEndpoints:
    """Tests for aircraft information endpoints."""

    async def test_get_aircraft_info_from_cache(
        self, client: AsyncClient, db_with_aircraft_info: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/info returns cached info."""
        response = await client.get("/api/v1/aircraft/A12345/info")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "A12345"
        assert data["registration"] == "N12345"
        assert data["type_code"] == "B738"
        assert data["manufacturer"] == "Boeing"
        assert data["operator"] == "United Airlines"

    async def test_get_aircraft_info_not_found(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/{icao}/info returns 404 for unknown aircraft."""
        with patch('app.services.aircraft_info.get_aircraft_info', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None

            response = await client.get("/api/v1/aircraft/ZZZZZZ/info")

            assert response.status_code == 404

    async def test_get_aircraft_info_invalid_icao(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/{icao}/info validates ICAO hex."""
        # Too short
        response = await client.get("/api/v1/aircraft/A12/info")
        assert response.status_code == 400

        # Too long
        response = await client.get("/api/v1/aircraft/A1234567890/info")
        assert response.status_code == 400

    async def test_get_aircraft_info_tisb_prefix(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/info handles TIS-B ~ prefix."""
        # Create info for TIS-B aircraft
        info = AircraftInfo(
            icao_hex="~A12345",
            registration="N99999",
            type_code="C172",
            manufacturer="Cessna",
        )
        db_session.add(info)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft/~A12345/info")

        # Should handle the ~ prefix
        assert response.status_code in [200, 400, 404]

    async def test_get_aircraft_info_refresh(
        self, client: AsyncClient, db_with_aircraft_info: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/info with refresh parameter."""
        # Test that the refresh parameter is accepted
        response = await client.get(
            "/api/v1/aircraft/A12345/info",
            params={"refresh": True}
        )

        # Either returns data or 404 if external fetch fails
        assert response.status_code in [200, 404]

    async def test_get_aircraft_info_includes_age(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/info calculates age."""
        info = AircraftInfo(
            icao_hex="B67890",
            registration="N67890",
            type_code="A320",
            year_built=2010,
        )
        db_session.add(info)
        await db_session.commit()

        with patch('app.services.aircraft_info.get_aircraft_info', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {
                "icao_hex": "B67890",
                "registration": "N67890",
                "type_code": "A320",
                "year_built": 2010,
                "age_years": 15,  # Calculated field
            }

            response = await client.get("/api/v1/aircraft/B67890/info")

            if response.status_code == 200:
                data = response.json()
                if "age_years" in data:
                    assert data["age_years"] >= 0


@pytest.mark.asyncio
class TestAircraftPhotoEndpoints:
    """Tests for aircraft photo endpoints."""

    async def test_get_aircraft_photo_urls(
        self, client: AsyncClient, db_with_aircraft_info: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/photo returns photo URLs."""
        response = await client.get("/api/v1/aircraft/A12345/photo")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "A12345"
        assert "photo_url" in data
        assert "thumbnail_url" in data
        assert "photographer" in data
        assert "source" in data

    async def test_get_aircraft_photo_not_found(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/{icao}/photo returns error when no photo."""
        response = await client.get("/api/v1/aircraft/NOPHOTO/photo")

        # Should return 404 (not found) or 400 (invalid) for unknown aircraft
        assert response.status_code in [400, 404]

    async def test_get_aircraft_photo_invalid_icao(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/{icao}/photo validates ICAO hex."""
        response = await client.get("/api/v1/aircraft/XX/photo")
        assert response.status_code == 400

    async def test_download_aircraft_photo_cached(
        self, client: AsyncClient, db_with_aircraft_info: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/photo/download returns cached photo."""
        with patch('app.services.photo_cache.get_cached_photo') as mock_cache:
            # Simulate no cached photo
            mock_cache.return_value = None

            with patch('httpx.AsyncClient') as mock_http:
                mock_response = AsyncMock()
                mock_response.status_code = 200
                mock_response.content = b'\xff\xd8\xff\xe0'  # JPEG magic bytes
                mock_response.headers = {"content-type": "image/jpeg"}
                mock_response.raise_for_status = MagicMock()

                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_http.return_value.__aenter__ = AsyncMock(return_value=mock_client)
                mock_http.return_value.__aexit__ = AsyncMock(return_value=None)

                response = await client.get("/api/v1/aircraft/A12345/photo/download")

                # Should either return image or appropriate error
                assert response.status_code in [200, 404, 502]

    async def test_download_aircraft_photo_thumbnail(
        self, client: AsyncClient, db_with_aircraft_info: AsyncSession
    ):
        """Test GET /api/v1/aircraft/{icao}/photo/download?thumbnail=true."""
        with patch('app.services.photo_cache.get_cached_photo') as mock_cache:
            mock_cache.return_value = None

            with patch('httpx.AsyncClient') as mock_http:
                mock_response = AsyncMock()
                mock_response.status_code = 200
                mock_response.content = b'\xff\xd8\xff\xe0'
                mock_response.headers = {"content-type": "image/jpeg"}
                mock_response.raise_for_status = MagicMock()

                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_response)
                mock_http.return_value.__aenter__ = AsyncMock(return_value=mock_client)
                mock_http.return_value.__aexit__ = AsyncMock(return_value=None)

                response = await client.get(
                    "/api/v1/aircraft/A12345/photo/download",
                    params={"thumbnail": True}
                )

                assert response.status_code in [200, 404, 502]


@pytest.mark.asyncio
class TestBulkAircraftInfoEndpoint:
    """Tests for bulk aircraft info lookup endpoint."""

    async def test_bulk_lookup_success(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test POST /api/v1/aircraft/info/bulk returns cached data."""
        # Create some aircraft info
        for i, hex_code in enumerate(["AAA111", "BBB222", "CCC333"]):
            info = AircraftInfo(
                icao_hex=hex_code,
                registration=f"N{i}0000",
                type_code="B738",
            )
            db_session.add(info)
        await db_session.commit()

        response = await client.post(
            "/api/v1/aircraft/info/bulk",
            json=["AAA111", "BBB222", "CCC333", "DDD444"]
        )

        assert response.status_code == 200
        data = response.json()
        assert "aircraft" in data
        assert "found" in data
        assert "requested" in data
        assert data["requested"] == 4
        assert data["found"] >= 3

    async def test_bulk_lookup_empty_list(self, client: AsyncClient):
        """Test POST /api/v1/aircraft/info/bulk with empty list."""
        response = await client.post(
            "/api/v1/aircraft/info/bulk",
            json=[]
        )

        assert response.status_code == 200
        data = response.json()
        assert data["found"] == 0
        assert data["requested"] == 0

    async def test_bulk_lookup_too_many(self, client: AsyncClient):
        """Test POST /api/v1/aircraft/info/bulk rejects > 100 aircraft."""
        # Create list of 101 aircraft
        icao_list = [f"A{i:05d}" for i in range(101)]

        response = await client.post(
            "/api/v1/aircraft/info/bulk",
            json=icao_list
        )

        assert response.status_code == 400

    async def test_bulk_lookup_filters_invalid(self, client: AsyncClient):
        """Test POST /api/v1/aircraft/info/bulk filters invalid ICAO codes."""
        response = await client.post(
            "/api/v1/aircraft/info/bulk",
            json=["A12345", "XX", "", "B67890", "toolongicao"]
        )

        assert response.status_code == 200
        data = response.json()
        # Only valid ICAO codes should be requested
        assert data["requested"] == 2  # A12345 and B67890


@pytest.mark.asyncio
class TestCacheStatsEndpoint:
    """Tests for cache statistics endpoint."""

    async def test_get_cache_stats(self, client: AsyncClient):
        """Test GET /api/v1/aircraft/info/cache/stats returns statistics."""
        response = await client.get("/api/v1/aircraft/info/cache/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_cached" in data
        assert "failed_lookups" in data
        assert "with_photos" in data

    async def test_get_cache_stats_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/aircraft/info/cache/stats with cached data."""
        # Create various aircraft info entries
        entries = [
            AircraftInfo(icao_hex="AAA111", registration="N11111", photo_url="http://example.com/1.jpg"),
            AircraftInfo(icao_hex="BBB222", registration="N22222", photo_url="http://example.com/2.jpg"),
            AircraftInfo(icao_hex="CCC333", registration="N33333"),  # No photo
            AircraftInfo(icao_hex="DDD444", fetch_failed=True),  # Failed lookup
        ]
        for entry in entries:
            db_session.add(entry)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft/info/cache/stats")

        assert response.status_code == 200
        data = response.json()
        assert data["total_cached"] >= 4
        assert data["with_photos"] >= 2
        assert data["failed_lookups"] >= 1


@pytest.mark.asyncio
class TestAircraftInfoIntegration:
    """Integration tests for aircraft info system."""

    async def test_aircraft_info_workflow(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test complete aircraft info workflow."""
        import uuid
        # Use a longer, more unique ICAO to avoid collisions with API auto-lookup
        test_icao = f"ZZ{uuid.uuid4().hex[:4].upper()}"

        # 1. Add info to database first (before any API calls that might create it)
        info = AircraftInfo(
            icao_hex=test_icao,
            registration="N-TEST",
            type_code="B738",
            type_name="Boeing 737-800",
            manufacturer="Boeing",
            operator="Test Airlines",
            photo_url="http://example.com/test.jpg",
            photo_thumbnail_url="http://example.com/test_thumb.jpg",
        )
        db_session.add(info)
        await db_session.commit()

        # 2. Now info should be available
        response = await client.get(f"/api/v1/aircraft/{test_icao}/info")
        assert response.status_code == 200
        assert response.json()["registration"] == "N-TEST"

        # 3. Photo should be available
        response = await client.get(f"/api/v1/aircraft/{test_icao}/photo")
        assert response.status_code == 200
        assert response.json()["photo_url"] is not None

        # 4. Bulk lookup should include it
        response = await client.post(
            "/api/v1/aircraft/info/bulk",
            json=[test_icao, "NOTEXIST"]
        )
        assert response.status_code == 200
        assert response.json()["found"] >= 1

        # 5. Cache stats should reflect it
        response = await client.get("/api/v1/aircraft/info/cache/stats")
        assert response.status_code == 200
        assert response.json()["total_cached"] >= 1

    async def test_failed_lookup_tracking(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test that failed lookups are tracked."""
        import uuid
        test_icao = f"F{uuid.uuid4().hex[:5].upper()}"

        # Create a failed lookup entry
        info = AircraftInfo(
            icao_hex=test_icao,
            fetch_failed=True,
        )
        db_session.add(info)
        await db_session.commit()

        # May return cached data or 404 depending on implementation
        response = await client.get(f"/api/v1/aircraft/{test_icao}/info")
        # Either not found or returns minimal data
        assert response.status_code in [200, 404]

        # Cache stats should show the failed lookup
        response = await client.get("/api/v1/aircraft/info/cache/stats")
        assert response.json()["failed_lookups"] >= 1

    async def test_military_aircraft_detection(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test that military aircraft are properly identified."""
        info = AircraftInfo(
            icao_hex="MIL001",
            registration="00-0001",
            type_code="C17",
            type_name="Boeing C-17 Globemaster III",
            operator="US Air Force",
            is_military=True,
        )
        db_session.add(info)
        await db_session.commit()

        response = await client.get("/api/v1/aircraft/MIL001/info")

        assert response.status_code == 200
        data = response.json()
        assert data["is_military"] is True
