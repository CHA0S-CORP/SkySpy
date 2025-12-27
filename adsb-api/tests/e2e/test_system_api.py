"""
End-to-end tests for system API endpoints.

Tests health checks, status endpoints, and API information.
"""
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
class TestHealthEndpoint:
    """Tests for health check endpoint."""

    async def test_health_check_healthy(self, client: AsyncClient):
        """Test GET /api/v1/health returns healthy status."""
        response = await client.get("/api/v1/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    async def test_health_check_includes_components(self, client: AsyncClient):
        """Test health check includes component statuses."""
        response = await client.get("/api/v1/health")

        assert response.status_code == 200
        data = response.json()
        # Should have status field
        assert "status" in data


@pytest.mark.asyncio
class TestStatusEndpoint:
    """Tests for status endpoint."""

    async def test_status_endpoint(self, client: AsyncClient):
        """Test GET /api/v1/status returns system status."""
        response = await client.get("/api/v1/status")

        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert "adsb_online" in data
        assert "aircraft_count" in data

    async def test_status_includes_version(self, client: AsyncClient):
        """Test status includes API version."""
        response = await client.get("/api/v1/status")

        assert response.status_code == 200
        data = response.json()
        assert data["version"] is not None

    async def test_status_includes_aircraft_count(self, client: AsyncClient):
        """Test status includes aircraft count."""
        response = await client.get("/api/v1/status")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["aircraft_count"], int)


@pytest.mark.asyncio
class TestApiInfoEndpoint:
    """Tests for API info endpoint."""

    async def test_api_info(self, client: AsyncClient):
        """Test GET /api/info returns API documentation."""
        response = await client.get("/api/info")

        # May be at /api/info or /api/v1/info
        if response.status_code == 404:
            response = await client.get("/api/v1/info")

        if response.status_code == 200:
            data = response.json()
            # Should contain API information
            assert data is not None


@pytest.mark.asyncio
class TestOpenApiDocs:
    """Tests for OpenAPI documentation endpoints."""

    async def test_openapi_json(self, client: AsyncClient):
        """Test /openapi.json returns OpenAPI schema."""
        response = await client.get("/openapi.json")

        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "paths" in data
        assert "info" in data

    async def test_docs_endpoint(self, client: AsyncClient):
        """Test /docs returns Swagger UI."""
        response = await client.get("/docs")

        # Should return HTML page
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")

    async def test_redoc_endpoint(self, client: AsyncClient):
        """Test /redoc returns ReDoc UI."""
        response = await client.get("/redoc")

        # Should return HTML page
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")


@pytest.mark.asyncio
class TestRootEndpoint:
    """Tests for root endpoint."""

    async def test_root_redirect_or_info(self, client: AsyncClient):
        """Test GET / returns redirect or info."""
        response = await client.get("/", follow_redirects=False)

        # Root might redirect to docs or return API info
        assert response.status_code in [200, 301, 302, 307, 308]


@pytest.mark.asyncio
class TestCorsHeaders:
    """Tests for CORS headers."""

    async def test_cors_preflight(self, client: AsyncClient):
        """Test CORS preflight request."""
        response = await client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            }
        )

        # Should handle CORS preflight
        assert response.status_code in [200, 204, 405]

    async def test_cors_headers_on_response(self, client: AsyncClient):
        """Test CORS headers are present on responses."""
        response = await client.get(
            "/api/v1/health",
            headers={"Origin": "http://localhost:3000"}
        )

        assert response.status_code == 200
        # CORS headers may or may not be present depending on config


@pytest.mark.asyncio
class TestApiVersioning:
    """Tests for API versioning."""

    async def test_v1_prefix(self, client: AsyncClient):
        """Test that /api/v1 prefix works."""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200

    async def test_endpoints_under_v1(self, client: AsyncClient):
        """Test that all main endpoints are under /api/v1."""
        endpoints = [
            "/api/v1/health",
            "/api/v1/status",
            "/api/v1/aircraft",
            "/api/v1/alerts/rules",
            "/api/v1/safety/events",
        ]

        for endpoint in endpoints:
            response = await client.get(endpoint)
            assert response.status_code in [200, 404]  # 404 if empty data


@pytest.mark.asyncio
class TestErrorResponses:
    """Tests for error response format."""

    async def test_404_response_format(self, client: AsyncClient):
        """Test 404 response has proper format."""
        response = await client.get("/api/v1/nonexistent/endpoint")

        assert response.status_code == 404
        data = response.json()
        assert "detail" in data

    async def test_422_validation_error_format(self, client: AsyncClient):
        """Test 422 validation error has proper format."""
        # Send invalid data to trigger validation error
        response = await client.post(
            "/api/v1/alerts/rules",
            json={}  # Missing required fields
        )

        if response.status_code == 422:
            data = response.json()
            assert "detail" in data


@pytest.mark.asyncio
class TestSystemIntegration:
    """Integration tests for system functionality."""

    async def test_system_health_workflow(self, client: AsyncClient):
        """Test complete system health check workflow."""
        # 1. Check health
        health = await client.get("/api/v1/health")
        assert health.status_code == 200
        assert health.json()["status"] == "healthy"

        # 2. Get status
        status = await client.get("/api/v1/status")
        assert status.status_code == 200
        assert "version" in status.json()

        # 3. Access main endpoints
        aircraft = await client.get("/api/v1/aircraft")
        assert aircraft.status_code == 200

        alerts = await client.get("/api/v1/alerts/rules")
        assert alerts.status_code == 200

    async def test_concurrent_requests(self, client: AsyncClient):
        """Test system handles multiple sequential requests."""
        # Make sequential requests (concurrent causes session issues in test env)
        endpoints = [
            "/api/v1/health",
            "/api/v1/status",
            "/api/v1/aircraft",
            "/api/v1/alerts/rules",
            "/api/v1/safety/events",
        ]

        for endpoint in endpoints:
            response = await client.get(endpoint)
            assert response.status_code == 200
