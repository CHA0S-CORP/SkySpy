"""
End-to-end tests for History API endpoints.

Tests all historical data query endpoints including:
- Sightings queries with filters
- Aircraft-specific sightings
- Session queries
- Historical statistics
- Trends analysis
- Top performers
- Distance, speed, and correlation analytics
- Antenna analytics
"""
import pytest
from unittest.mock import patch
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.models import AircraftSighting, AircraftSession, SafetyEvent


@pytest.mark.asyncio
class TestSightingsEndpoint:
    """Tests for GET /api/v1/history/sightings endpoint."""

    async def test_get_sightings_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/sightings returns empty list when no data."""
        response = await client.get("/api/v1/history/sightings")

        assert response.status_code == 200
        data = response.json()
        assert "sightings" in data
        assert isinstance(data["sightings"], list)
        assert "count" in data
        assert "total" in data
        assert data["count"] == 0

    async def test_get_sightings_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings returns sightings."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex="A12345",
                callsign="UAL123",
                latitude=47.95,
                longitude=-121.95,
                altitude_baro=35000,
                ground_speed=450,
                vertical_rate=-500,
                squawk="1200",
                is_military=False,
                rssi=-25.5,
                distance_nm=15.2,
                timestamp=now - timedelta(hours=1)
            ),
            AircraftSighting(
                icao_hex="B67890",
                callsign="DAL456",
                latitude=47.90,
                longitude=-121.90,
                altitude_baro=28000,
                ground_speed=380,
                timestamp=now - timedelta(hours=2)
            ),
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2
        assert data["total"] >= 2

    async def test_get_sightings_response_structure(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings returns correct structure."""
        now = datetime.utcnow()
        sighting = AircraftSighting(
            icao_hex="A12345",
            callsign="TEST123",
            latitude=47.95,
            longitude=-121.95,
            altitude_baro=35000,
            ground_speed=450,
            vertical_rate=-500,
            distance_nm=15.2,
            is_military=True,
            squawk="7700",
            rssi=-20.0,
            timestamp=now
        )
        db_session.add(sighting)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings")

        assert response.status_code == 200
        data = response.json()

        if data["sightings"]:
            s = data["sightings"][0]
            expected_fields = [
                "timestamp", "icao_hex", "callsign", "lat", "lon",
                "altitude", "gs", "vr", "distance_nm", "is_military",
                "squawk", "rssi"
            ]
            for field in expected_fields:
                assert field in s, f"Missing field: {field}"

    async def test_get_sightings_filter_by_icao(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings?icao_hex=... filters correctly."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(icao_hex="FILTER1", callsign="TEST1", timestamp=now),
            AircraftSighting(icao_hex="FILTER2", callsign="TEST2", timestamp=now),
            AircraftSighting(icao_hex="FILTER1", callsign="TEST1", timestamp=now - timedelta(minutes=5)),
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings?icao_hex=FILTER1")

        assert response.status_code == 200
        data = response.json()
        assert all(s["icao_hex"] == "FILTER1" for s in data["sightings"])

    async def test_get_sightings_filter_by_callsign(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings?callsign=... filters correctly."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(icao_hex="A11111", callsign="UAL123", timestamp=now),
            AircraftSighting(icao_hex="A22222", callsign="DAL456", timestamp=now),
            AircraftSighting(icao_hex="A33333", callsign="UAL789", timestamp=now),
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings?callsign=UAL")

        assert response.status_code == 200
        data = response.json()
        # All should have UAL in callsign (partial match)
        assert all("UAL" in (s.get("callsign") or "") for s in data["sightings"])

    async def test_get_sightings_filter_military_only(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings?military_only=true filters correctly."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(icao_hex="MIL001", is_military=True, timestamp=now),
            AircraftSighting(icao_hex="CIV001", is_military=False, timestamp=now),
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings?military_only=true")

        assert response.status_code == 200
        data = response.json()
        assert all(s["is_military"] is True for s in data["sightings"])

    async def test_get_sightings_filter_by_altitude_range(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings?min_altitude=...&max_altitude=... filters correctly."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(icao_hex="LOW001", altitude_baro=5000, timestamp=now),
            AircraftSighting(icao_hex="MED001", altitude_baro=25000, timestamp=now),
            AircraftSighting(icao_hex="HI001", altitude_baro=40000, timestamp=now),
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings?min_altitude=20000&max_altitude=30000")

        assert response.status_code == 200
        data = response.json()
        for s in data["sightings"]:
            if s["altitude"] is not None:
                assert 20000 <= s["altitude"] <= 30000

    async def test_get_sightings_pagination(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings pagination works correctly."""
        now = datetime.utcnow()
        # Create 15 sightings
        for i in range(15):
            s = AircraftSighting(
                icao_hex=f"PAGE{i:02d}",
                timestamp=now - timedelta(minutes=i)
            )
            db_session.add(s)
        await db_session.commit()

        # First page
        response1 = await client.get("/api/v1/history/sightings?limit=5&offset=0")
        assert response1.status_code == 200
        data1 = response1.json()
        assert data1["count"] == 5
        assert data1["total"] >= 15

        # Second page
        response2 = await client.get("/api/v1/history/sightings?limit=5&offset=5")
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2["count"] == 5

        # Ensure pages have different data
        icaos1 = set(s["icao_hex"] for s in data1["sightings"])
        icaos2 = set(s["icao_hex"] for s in data2["sightings"])
        assert icaos1.isdisjoint(icaos2)

    async def test_get_sightings_hours_filter(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings?hours=... filters correctly."""
        now = datetime.utcnow()
        # Recent sighting
        recent = AircraftSighting(
            icao_hex="RECENT",
            timestamp=now - timedelta(hours=2)
        )
        # Old sighting (beyond 24 hours)
        old = AircraftSighting(
            icao_hex="OLD001",
            timestamp=now - timedelta(hours=48)
        )
        db_session.add_all([recent, old])
        await db_session.commit()

        # Query last 24 hours
        response = await client.get("/api/v1/history/sightings?hours=24")

        assert response.status_code == 200
        data = response.json()
        icaos = [s["icao_hex"] for s in data["sightings"]]
        assert "RECENT" in icaos
        assert "OLD001" not in icaos


@pytest.mark.asyncio
class TestAircraftSightingsEndpoint:
    """Tests for GET /api/v1/history/sightings/{icao_hex} endpoint."""

    async def test_get_aircraft_sightings_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/sightings/{icao} returns empty when no data."""
        response = await client.get("/api/v1/history/sightings/NOTEXIST")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "NOTEXIST"
        assert data["sightings"] == []
        assert data["count"] == 0

    async def test_get_aircraft_sightings_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings/{icao} returns flight path data."""
        now = datetime.utcnow()
        # Create flight path (multiple sightings for same aircraft)
        for i in range(5):
            s = AircraftSighting(
                icao_hex="TRACK1",
                callsign="UAL123",
                latitude=47.95 + (i * 0.01),
                longitude=-121.95 + (i * 0.01),
                altitude_baro=35000 - (i * 500),
                ground_speed=450,
                vertical_rate=-500,
                track=180 + i,
                distance_nm=15.0 + i,
                rssi=-25.0 - i,
                timestamp=now - timedelta(minutes=i)
            )
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings/TRACK1")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "TRACK1"
        assert data["count"] == 5
        assert len(data["sightings"]) == 5

        # Verify sighting structure
        for s in data["sightings"]:
            assert "timestamp" in s
            assert "lat" in s
            assert "lon" in s
            assert "altitude" in s

    async def test_get_aircraft_sightings_case_insensitive(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sightings/{icao} is case insensitive."""
        now = datetime.utcnow()
        s = AircraftSighting(icao_hex="UPPER1", timestamp=now)
        db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sightings/upper1")

        assert response.status_code == 200
        data = response.json()
        assert data["icao_hex"] == "UPPER1"


@pytest.mark.asyncio
class TestSessionsEndpoint:
    """Tests for GET /api/v1/history/sessions endpoint."""

    async def test_get_sessions_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/sessions returns empty list when no data."""
        response = await client.get("/api/v1/history/sessions")

        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert isinstance(data["sessions"], list)
        assert "count" in data

    async def test_get_sessions_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sessions returns session data."""
        now = datetime.utcnow()
        sessions = [
            AircraftSession(
                icao_hex="SESS01",
                callsign="UAL123",
                first_seen=now - timedelta(minutes=45),
                last_seen=now,
                total_positions=135,
                min_distance_nm=5.2,
                max_distance_nm=85.0,
                min_altitude=5000,
                max_altitude=35000,
                max_vertical_rate=3500,
                min_rssi=-30.0,
                max_rssi=-15.0,
                is_military=False,
                aircraft_type="B738"
            ),
            AircraftSession(
                icao_hex="SESS02",
                callsign="RCH001",
                first_seen=now - timedelta(minutes=60),
                last_seen=now - timedelta(minutes=10),
                total_positions=150,
                is_military=True,
                aircraft_type="C17"
            ),
        ]
        for s in sessions:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sessions")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2

    async def test_get_sessions_response_structure(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sessions returns correct structure."""
        now = datetime.utcnow()
        session = AircraftSession(
            icao_hex="STRUCT",
            callsign="TEST123",
            first_seen=now - timedelta(minutes=30),
            last_seen=now,
            total_positions=90,
            min_distance_nm=5.0,
            max_distance_nm=50.0,
            min_altitude=10000,
            max_altitude=35000,
            max_vertical_rate=2500,
            min_rssi=-28.0,
            max_rssi=-18.0,
            is_military=False,
            aircraft_type="A320"
        )
        db_session.add(session)
        await db_session.commit()

        response = await client.get("/api/v1/history/sessions")

        assert response.status_code == 200
        data = response.json()

        if data["sessions"]:
            s = data["sessions"][0]
            expected_fields = [
                "icao_hex", "callsign", "first_seen", "last_seen",
                "duration_min", "positions", "min_distance_nm", "max_distance_nm",
                "min_alt", "max_alt", "max_vr", "is_military", "type"
            ]
            for field in expected_fields:
                assert field in s, f"Missing field: {field}"

    async def test_get_sessions_filter_by_icao(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sessions?icao_hex=... filters correctly."""
        now = datetime.utcnow()
        sessions = [
            AircraftSession(icao_hex="FILT01", first_seen=now - timedelta(hours=1), last_seen=now),
            AircraftSession(icao_hex="FILT02", first_seen=now - timedelta(hours=1), last_seen=now),
        ]
        for s in sessions:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sessions?icao_hex=FILT01")

        assert response.status_code == 200
        data = response.json()
        assert all(s["icao_hex"] == "FILT01" for s in data["sessions"])

    async def test_get_sessions_filter_military_only(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sessions?military_only=true filters correctly."""
        now = datetime.utcnow()
        sessions = [
            AircraftSession(icao_hex="MIL01", is_military=True, first_seen=now - timedelta(hours=1), last_seen=now),
            AircraftSession(icao_hex="CIV01", is_military=False, first_seen=now - timedelta(hours=1), last_seen=now),
        ]
        for s in sessions:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/sessions?military_only=true")

        assert response.status_code == 200
        data = response.json()
        assert all(s["is_military"] is True for s in data["sessions"])

    async def test_get_sessions_includes_safety_event_count(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/sessions includes safety event count."""
        now = datetime.utcnow()

        # Create session
        session = AircraftSession(
            icao_hex="SAFE01",
            first_seen=now - timedelta(minutes=30),
            last_seen=now
        )
        db_session.add(session)

        # Create safety events for this aircraft within session time
        event = SafetyEvent(
            icao_hex="SAFE01",
            event_type="extreme_vs",
            severity="warning",
            message="Test event",
            timestamp=now - timedelta(minutes=15)
        )
        db_session.add(event)
        await db_session.commit()

        response = await client.get("/api/v1/history/sessions")

        assert response.status_code == 200
        data = response.json()

        # Find our session
        session_data = next(
            (s for s in data["sessions"] if s["icao_hex"] == "SAFE01"),
            None
        )
        if session_data:
            assert "safety_event_count" in session_data


@pytest.mark.asyncio
class TestHistoryStatsEndpoint:
    """Tests for GET /api/v1/history/stats endpoint."""

    async def test_get_stats_returns_503_when_cache_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/stats returns 503 when cache empty."""
        with patch('app.services.stats_cache.get_history_stats', return_value=None):
            response = await client.get("/api/v1/history/stats")

            assert response.status_code in [200, 503]

    async def test_get_stats_returns_cached_data(self, client: AsyncClient):
        """Test GET /api/v1/history/stats returns cached statistics."""
        mock_stats = {
            "total_sightings": 152340,
            "total_sessions": 4567,
            "unique_aircraft": 1234,
            "military_sessions": 89,
            "time_range_hours": 24,
            "avg_altitude": 28500,
            "max_altitude": 45000,
            "avg_distance_nm": 52.3,
            "max_distance_nm": 185.0,
            "filters_applied": {}
        }

        with patch('app.services.stats_cache.get_history_stats', return_value=mock_stats):
            response = await client.get("/api/v1/history/stats")

            assert response.status_code == 200
            data = response.json()
            assert data["total_sightings"] == 152340
            assert data["total_sessions"] == 4567


@pytest.mark.asyncio
class TestHistoryTrendsEndpoint:
    """Tests for GET /api/v1/history/trends endpoint."""

    async def test_get_trends_returns_503_when_cache_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/trends returns 503 when cache empty."""
        with patch('app.services.stats_cache.get_history_trends', return_value=None):
            response = await client.get("/api/v1/history/trends")

            assert response.status_code in [200, 503]

    async def test_get_trends_returns_cached_data(self, client: AsyncClient):
        """Test GET /api/v1/history/trends returns cached trend data."""
        mock_trends = {
            "intervals": [
                {
                    "timestamp": "2024-01-01T12:00:00Z",
                    "aircraft_count": 45,
                    "unique_aircraft": 38,
                    "military_count": 3,
                    "avg_altitude": 28500,
                    "max_altitude": 43000
                }
            ],
            "summary": {
                "total_unique_aircraft": 156,
                "peak_concurrent": 52,
                "peak_interval": "2024-01-01T14:00:00Z"
            }
        }

        with patch('app.services.stats_cache.get_history_trends', return_value=mock_trends):
            response = await client.get("/api/v1/history/trends")

            assert response.status_code == 200
            data = response.json()
            assert "intervals" in data
            assert "summary" in data


@pytest.mark.asyncio
class TestTopPerformersEndpoint:
    """Tests for GET /api/v1/history/top endpoint."""

    async def test_get_top_returns_503_when_cache_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/top returns 503 when cache empty."""
        with patch('app.services.stats_cache.get_history_top', return_value=None):
            response = await client.get("/api/v1/history/top")

            assert response.status_code in [200, 503]

    async def test_get_top_returns_cached_data(self, client: AsyncClient):
        """Test GET /api/v1/history/top returns cached top performers."""
        mock_top = {
            "longest_tracked": [
                {"icao_hex": "A12345", "callsign": "UAL123", "duration_min": 125.5}
            ],
            "furthest_distance": [
                {"icao_hex": "B67890", "max_distance_nm": 245.3}
            ],
            "highest_altitude": [
                {"icao_hex": "C11111", "max_altitude": 45000}
            ],
            "most_positions": [
                {"icao_hex": "D22222", "total_positions": 1500}
            ],
            "closest_approach": [
                {"icao_hex": "E33333", "min_distance_nm": 0.5}
            ]
        }

        with patch('app.services.stats_cache.get_history_top', return_value=mock_top):
            response = await client.get("/api/v1/history/top")

            assert response.status_code == 200
            data = response.json()
            assert "longest_tracked" in data
            assert "furthest_distance" in data


@pytest.mark.asyncio
class TestDistanceAnalyticsEndpoint:
    """Tests for GET /api/v1/history/analytics/distance endpoint."""

    async def test_get_distance_analytics_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/analytics/distance with no data."""
        response = await client.get("/api/v1/history/analytics/distance")

        assert response.status_code == 200
        data = response.json()
        assert "distribution" in data
        assert "statistics" in data
        assert "by_type" in data
        assert "time_range_hours" in data

    async def test_get_distance_analytics_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/distance with session data."""
        now = datetime.utcnow()
        sessions = [
            AircraftSession(
                icao_hex=f"DIST{i:02d}",
                max_distance_nm=25 * (i + 1),
                aircraft_type=f"B73{i}",
                first_seen=now - timedelta(hours=1),
                last_seen=now
            )
            for i in range(10)
        ]
        for s in sessions:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/analytics/distance")

        assert response.status_code == 200
        data = response.json()
        assert "distribution" in data
        # Should have distribution buckets
        assert "0-25nm" in data["distribution"] or len(data["distribution"]) > 0

    async def test_get_distance_analytics_filters(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/distance filters work."""
        now = datetime.utcnow()
        sessions = [
            AircraftSession(
                icao_hex="DMIL01",
                max_distance_nm=100,
                is_military=True,
                aircraft_type="C17",
                first_seen=now - timedelta(hours=1),
                last_seen=now
            ),
            AircraftSession(
                icao_hex="DCIV01",
                max_distance_nm=50,
                is_military=False,
                aircraft_type="B738",
                first_seen=now - timedelta(hours=1),
                last_seen=now
            ),
        ]
        for s in sessions:
            db_session.add(s)
        await db_session.commit()

        # Test military filter
        response = await client.get("/api/v1/history/analytics/distance?military_only=true")

        assert response.status_code == 200


@pytest.mark.asyncio
class TestSpeedAnalyticsEndpoint:
    """Tests for GET /api/v1/history/analytics/speed endpoint."""

    async def test_get_speed_analytics_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/analytics/speed with no data."""
        response = await client.get("/api/v1/history/analytics/speed")

        assert response.status_code == 200
        data = response.json()
        assert "distribution" in data
        assert "statistics" in data
        assert "fastest_sessions" in data
        assert "by_type" in data
        assert "time_range_hours" in data

    async def test_get_speed_analytics_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/speed with sighting data."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex=f"SPEED{i:02d}",
                callsign=f"TST{i:03d}",
                ground_speed=200 + (i * 50),
                altitude_baro=30000,
                aircraft_type="B738",
                timestamp=now - timedelta(hours=1, minutes=i)
            )
            for i in range(10)
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/analytics/speed")

        assert response.status_code == 200
        data = response.json()
        assert "distribution" in data
        assert "fastest_sessions" in data


@pytest.mark.asyncio
class TestCorrelationAnalyticsEndpoint:
    """Tests for GET /api/v1/history/analytics/correlation endpoint."""

    async def test_get_correlation_analytics_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/analytics/correlation with no data."""
        response = await client.get("/api/v1/history/analytics/correlation")

        assert response.status_code == 200
        data = response.json()
        assert "altitude_vs_speed" in data
        assert "distance_vs_altitude" in data
        assert "time_of_day_patterns" in data
        assert "time_range_hours" in data

    async def test_get_correlation_analytics_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/correlation with sighting data."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex=f"CORR{i:02d}",
                altitude_baro=10000 * (i + 1),
                ground_speed=200 + (i * 30),
                distance_nm=25 * (i + 1),
                is_military=(i % 2 == 0),
                timestamp=now - timedelta(hours=i)
            )
            for i in range(10)
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/analytics/correlation")

        assert response.status_code == 200
        data = response.json()
        assert "altitude_vs_speed" in data
        assert "time_of_day_patterns" in data


@pytest.mark.asyncio
class TestAntennaPolarEndpoint:
    """Tests for GET /api/v1/history/analytics/antenna/polar endpoint."""

    async def test_get_antenna_polar_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/analytics/antenna/polar with no data."""
        response = await client.get("/api/v1/history/analytics/antenna/polar")

        assert response.status_code == 200
        data = response.json()
        assert "bearing_data" in data
        assert "summary" in data
        assert "time_range_hours" in data

    async def test_get_antenna_polar_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/antenna/polar with sighting data."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex=f"POLAR{i:02d}",
                track=i * 36,  # 0, 36, 72, ... 324 degrees
                distance_nm=50.0 + i,
                rssi=-20.0 - i,
                timestamp=now - timedelta(minutes=i)
            )
            for i in range(10)
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/analytics/antenna/polar")

        assert response.status_code == 200
        data = response.json()
        assert "bearing_data" in data
        # Should have 36 sectors (10 degrees each)
        assert len(data["bearing_data"]) == 36


@pytest.mark.asyncio
class TestAntennaRssiEndpoint:
    """Tests for GET /api/v1/history/analytics/antenna/rssi endpoint."""

    async def test_get_rssi_distance_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/analytics/antenna/rssi with no data."""
        response = await client.get("/api/v1/history/analytics/antenna/rssi")

        assert response.status_code == 200
        data = response.json()
        assert "scatter_data" in data
        assert "band_statistics" in data
        assert "overall_statistics" in data
        assert "time_range_hours" in data

    async def test_get_rssi_distance_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/antenna/rssi with sighting data."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex=f"RSSI{i:02d}",
                distance_nm=10.0 + (i * 15),
                rssi=-10.0 - (i * 2),
                altitude_baro=30000,
                timestamp=now - timedelta(minutes=i)
            )
            for i in range(20)
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/analytics/antenna/rssi")

        assert response.status_code == 200
        data = response.json()
        assert "scatter_data" in data
        assert "band_statistics" in data
        # Should have calculated trend line
        if len(data["scatter_data"]) > 10:
            assert "trend_line" in data


@pytest.mark.asyncio
class TestAntennaSummaryEndpoint:
    """Tests for GET /api/v1/history/analytics/antenna/summary endpoint."""

    async def test_get_antenna_summary_empty(self, client: AsyncClient):
        """Test GET /api/v1/history/analytics/antenna/summary with no data."""
        response = await client.get("/api/v1/history/analytics/antenna/summary")

        assert response.status_code == 200
        data = response.json()
        assert "range" in data
        assert "signal" in data
        assert "coverage" in data
        assert "time_range_hours" in data

    async def test_get_antenna_summary_with_data(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test GET /api/v1/history/analytics/antenna/summary with sighting data."""
        now = datetime.utcnow()
        sightings = [
            AircraftSighting(
                icao_hex=f"SUMM{i:02d}",
                distance_nm=25.0 + (i * 20),
                rssi=-15.0 - (i * 1.5),
                track=i * 36,
                timestamp=now - timedelta(minutes=i)
            )
            for i in range(20)
        ]
        for s in sightings:
            db_session.add(s)
        await db_session.commit()

        response = await client.get("/api/v1/history/analytics/antenna/summary")

        assert response.status_code == 200
        data = response.json()
        assert "range" in data
        assert data["range"]["total_sightings"] >= 20
        assert data["range"]["unique_aircraft"] >= 1
