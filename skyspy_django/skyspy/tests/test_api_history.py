"""
End-to-end tests for history API endpoints.

Tests for:
- SightingViewSet (GET /api/v1/sightings/)
- SessionViewSet (GET /api/v1/sessions/)
- HistoryViewSet
  - stats (GET /api/v1/history/stats/)
  - trends (GET /api/v1/history/trends/)
  - top_performers (GET /api/v1/history/top-performers/)
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from skyspy.models import AircraftSession, AircraftSighting


@pytest.mark.django_db
class TestSightingViewSetList:
    """Tests for the sightings list endpoint."""

    def test_list_returns_200(self, api_client):
        """Test that list returns 200 OK."""
        response = api_client.get("/api/v1/sightings/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty(self, api_client):
        """Test list response when no sightings exist."""
        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        # Should have results key (from pagination)
        assert "results" in data

    def test_list_with_sightings(self, api_client):
        """Test list with existing sightings."""
        AircraftSighting.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            latitude=47.5,
            longitude=-122.3,
            altitude_baro=35000,
            ground_speed=450,
            vertical_rate=0,
        )
        AircraftSighting.objects.create(
            icao_hex="DEF456",
            callsign="DAL456",
            latitude=47.6,
            longitude=-122.4,
            altitude_baro=30000,
            ground_speed=420,
            vertical_rate=-500,
        )

        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        assert len(data["results"]) > 0

    def test_list_sighting_structure(self, api_client):
        """Test that sightings have expected fields."""
        AircraftSighting.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            latitude=47.5,
            longitude=-122.3,
            altitude_baro=35000,
            ground_speed=450,
            vertical_rate=1000,
            distance_nm=15.5,
            is_military=False,
            squawk="1234",
        )

        response = api_client.get("/api/v1/sightings/")
        sighting = response.json()["results"][0]

        expected_fields = [
            "id",
            "timestamp",
            "icao_hex",
            "callsign",
            "lat",
            "lon",
            "altitude",
            "gs",
            "vr",
            "distance_nm",
            "is_military",
            "squawk",
        ]
        for field in expected_fields:
            assert field in sighting, f"Missing field: {field}"

    def test_list_time_filter(self, api_client):
        """Test filtering by time range."""
        # Create old sighting
        old_sighting = AircraftSighting.objects.create(
            icao_hex="OLD123",
            latitude=47.5,
            longitude=-122.3,
        )
        old_sighting.timestamp = timezone.now() - timedelta(hours=48)
        old_sighting.save()

        # Create recent sighting
        AircraftSighting.objects.create(
            icao_hex="NEW123",
            latitude=47.5,
            longitude=-122.3,
        )

        response = api_client.get("/api/v1/sightings/?hours=24")
        data = response.json()

        icao_list = [s["icao_hex"] for s in data["results"]]
        assert "NEW123" in icao_list
        assert "OLD123" not in icao_list

    def test_list_filter_by_icao(self, api_client):
        """Test filtering by ICAO hex."""
        AircraftSighting.objects.create(icao_hex="ABC123", latitude=47.5, longitude=-122.3)
        AircraftSighting.objects.create(icao_hex="DEF456", latitude=47.6, longitude=-122.4)

        response = api_client.get("/api/v1/sightings/?icao=ABC123")
        data = response.json()

        for sighting in data["results"]:
            assert sighting["icao_hex"] == "ABC123"

    def test_list_filter_by_callsign(self, api_client):
        """Test filtering by callsign (contains)."""
        AircraftSighting.objects.create(icao_hex="A", callsign="UAL123", latitude=47.5, longitude=-122.3)
        AircraftSighting.objects.create(icao_hex="B", callsign="DAL456", latitude=47.6, longitude=-122.4)

        response = api_client.get("/api/v1/sightings/?callsign=UAL")
        data = response.json()

        for sighting in data["results"]:
            assert "UAL" in sighting["callsign"]

    def test_list_filter_by_military(self, api_client):
        """Test filtering by military status."""
        AircraftSighting.objects.create(icao_hex="A", is_military=True, latitude=47.5, longitude=-122.3)
        AircraftSighting.objects.create(icao_hex="B", is_military=False, latitude=47.6, longitude=-122.4)

        response = api_client.get("/api/v1/sightings/?is_military=true")
        data = response.json()

        for sighting in data["results"]:
            assert sighting["is_military"]

    def test_list_ordered_by_timestamp(self, api_client):
        """Test that sightings are ordered by timestamp descending."""
        AircraftSighting.objects.create(icao_hex="FIRST", latitude=47.5, longitude=-122.3)
        AircraftSighting.objects.create(icao_hex="SECOND", latitude=47.6, longitude=-122.4)

        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        # Most recent should be first
        if len(data["results"]) >= 2:
            assert data["results"][0]["icao_hex"] == "SECOND"

    def test_list_large_result_set(self, api_client):
        """Test handling of large result sets."""
        for i in range(150):
            AircraftSighting.objects.create(
                icao_hex=f"AC{i:03d}",
                latitude=47.5,
                longitude=-122.3,
            )

        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        # Should return all results with count
        assert "results" in data
        assert "count" in data
        assert data["count"] == 150

    def test_list_read_only(self, api_client):
        """Test that POST is not allowed."""
        response = api_client.post("/api/v1/sightings/", {"icao_hex": "TEST"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


@pytest.mark.django_db
class TestSightingRetrieve:
    """Tests for retrieving a single sighting."""

    @pytest.fixture(autouse=True)
    def setup_sighting(self):
        """Set up test fixtures."""
        self.sighting = AircraftSighting.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            latitude=47.5,
            longitude=-122.3,
            altitude_baro=35000,
        )

    def test_retrieve_existing_sighting(self, api_client):
        """Test retrieving an existing sighting."""
        response = api_client.get(f"/api/v1/sightings/{self.sighting.id}/")
        assert response.status_code == status.HTTP_200_OK

    def test_retrieve_sighting_data(self, api_client):
        """Test that retrieved sighting has correct data."""
        response = api_client.get(f"/api/v1/sightings/{self.sighting.id}/")
        data = response.json()

        assert data["icao_hex"] == "ABC123"
        assert data["callsign"] == "UAL123"
        assert data["lat"] == 47.5
        assert data["lon"] == -122.3
        assert data["altitude"] == 35000

    def test_retrieve_nonexistent_sighting(self, api_client):
        """Test retrieving non-existent sighting returns 404."""
        response = api_client.get("/api/v1/sightings/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestSessionViewSetList:
    """Tests for the sessions list endpoint."""

    def test_list_returns_200(self, api_client):
        """Test that list returns 200 OK."""
        response = api_client.get("/api/v1/sessions/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty(self, api_client):
        """Test list response when no sessions exist."""
        response = api_client.get("/api/v1/sessions/")
        data = response.json()

        assert "sessions" in data

    def test_list_with_sessions(self, api_client):
        """Test list with existing sessions."""
        AircraftSession.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            total_positions=100,
            min_altitude=25000,
            max_altitude=35000,
            min_distance_nm=5.0,
            max_distance_nm=50.0,
        )

        response = api_client.get("/api/v1/sessions/")
        data = response.json()

        assert len(data["sessions"]) > 0

    def test_list_session_structure(self, api_client):
        """Test that sessions have expected fields."""
        now = timezone.now()
        session = AircraftSession.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            total_positions=100,
            min_altitude=25000,
            max_altitude=35000,
            min_distance_nm=5.0,
            max_distance_nm=50.0,
            max_vertical_rate=2500,
            min_rssi=-20.0,
            max_rssi=-5.0,
            is_military=True,
            aircraft_type="B738",
        )
        # Force update timestamps for duration calculation
        session.first_seen = now - timedelta(hours=1)
        session.last_seen = now
        session.save()

        response = api_client.get("/api/v1/sessions/")
        sess = response.json()["sessions"][0]

        expected_fields = [
            "id",
            "icao_hex",
            "callsign",
            "first_seen",
            "last_seen",
            "duration_min",
            "positions",
            "min_distance_nm",
            "max_distance_nm",
            "min_alt",
            "max_alt",
            "max_vr",
            "min_rssi",
            "max_rssi",
            "is_military",
            "type",
        ]
        for field in expected_fields:
            assert field in sess, f"Missing field: {field}"

    def test_list_duration_calculation(self, api_client):
        """Test that duration is calculated correctly."""
        now = timezone.now()
        session = AircraftSession.objects.create(
            icao_hex="ABC123",
            total_positions=100,
        )
        session.first_seen = now - timedelta(minutes=30)
        session.last_seen = now
        session.save()

        response = api_client.get("/api/v1/sessions/")
        sess = response.json()["sessions"][0]

        # Duration should be approximately 30 minutes
        assert abs(sess["duration_min"] - 30.0) <= 1.0

    def test_list_time_filter(self, api_client):
        """Test filtering by time range."""
        # Create old session - use update() to bypass auto_now
        old_session = AircraftSession.objects.create(
            icao_hex="OLD123",
            total_positions=50,
        )
        AircraftSession.objects.filter(pk=old_session.pk).update(last_seen=timezone.now() - timedelta(hours=48))

        # Create recent session
        AircraftSession.objects.create(
            icao_hex="NEW123",
            total_positions=50,
        )

        response = api_client.get("/api/v1/sessions/?hours=24")
        data = response.json()

        icao_list = [s["icao_hex"] for s in data["sessions"]]
        assert "NEW123" in icao_list
        assert "OLD123" not in icao_list

    def test_list_filter_military_only(self, api_client):
        """Test filtering for military only."""
        AircraftSession.objects.create(icao_hex="MIL001", is_military=True)
        AircraftSession.objects.create(icao_hex="CIV001", is_military=False)

        response = api_client.get("/api/v1/sessions/?military_only=true")
        data = response.json()

        for session in data["sessions"]:
            assert session["is_military"]

    def test_list_filter_by_icao(self, api_client):
        """Test filtering by ICAO hex."""
        AircraftSession.objects.create(icao_hex="ABC123")
        AircraftSession.objects.create(icao_hex="DEF456")

        response = api_client.get("/api/v1/sessions/?icao_hex=ABC123")
        data = response.json()

        for session in data["sessions"]:
            assert session["icao_hex"] == "ABC123"

    def test_list_ordered_by_last_seen(self, api_client):
        """Test that sessions are ordered by last_seen descending."""
        AircraftSession.objects.create(icao_hex="FIRST")
        AircraftSession.objects.create(icao_hex="SECOND")

        response = api_client.get("/api/v1/sessions/")
        data = response.json()

        if len(data["sessions"]) >= 2:
            assert data["sessions"][0]["icao_hex"] == "SECOND"

    def test_list_read_only(self, api_client):
        """Test that POST is not allowed."""
        response = api_client.post("/api/v1/sessions/", {"icao_hex": "TEST"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


@pytest.mark.django_db
class TestSessionRetrieve:
    """Tests for retrieving a single session."""

    @pytest.fixture(autouse=True)
    def setup_session(self):
        """Set up test fixtures."""
        self.session = AircraftSession.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            total_positions=100,
            max_altitude=35000,
        )

    def test_retrieve_existing_session(self, api_client):
        """Test retrieving an existing session."""
        response = api_client.get(f"/api/v1/sessions/{self.session.id}/")
        assert response.status_code == status.HTTP_200_OK

    def test_retrieve_session_data(self, api_client):
        """Test that retrieved session has correct data."""
        response = api_client.get(f"/api/v1/sessions/{self.session.id}/")
        data = response.json()

        assert data["icao_hex"] == "ABC123"
        assert data["callsign"] == "UAL123"
        assert data["positions"] == 100
        assert data["max_alt"] == 35000

    def test_retrieve_nonexistent_session(self, api_client):
        """Test retrieving non-existent session returns 404."""
        response = api_client.get("/api/v1/sessions/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestHistoryStatsView:
    """Tests for the history stats endpoint."""

    def test_stats_returns_200(self, api_client):
        """Test that stats returns 200 OK."""
        response = api_client.get("/api/v1/history/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_stats_response_structure(self, api_client):
        """Test that stats response has expected fields."""
        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        expected_fields = [
            "total_sightings",
            "total_sessions",
            "unique_aircraft",
            "military_sessions",
            "time_range_hours",
            "avg_altitude",
            "max_altitude",
            "min_altitude",
            "avg_distance_nm",
            "max_distance_nm",
            "avg_speed",
            "max_speed",
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"

    def test_stats_empty(self, api_client):
        """Test stats with no data."""
        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        assert data["total_sightings"] == 0
        assert data["total_sessions"] == 0
        assert data["unique_aircraft"] == 0

    def test_stats_with_data(self, api_client):
        """Test stats with sightings and sessions."""
        # Create sightings
        AircraftSighting.objects.create(
            icao_hex="ABC123",
            latitude=47.5,
            longitude=-122.3,
            altitude_baro=35000,
            ground_speed=450,
            distance_nm=10.0,
        )
        AircraftSighting.objects.create(
            icao_hex="DEF456",
            latitude=47.6,
            longitude=-122.4,
            altitude_baro=30000,
            ground_speed=400,
            distance_nm=20.0,
        )

        # Create sessions
        AircraftSession.objects.create(icao_hex="ABC123", is_military=True)
        AircraftSession.objects.create(icao_hex="DEF456", is_military=False)

        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        assert data["total_sightings"] == 2
        assert data["total_sessions"] == 2
        assert data["unique_aircraft"] == 2
        assert data["military_sessions"] == 1  # One military session (ABC123)

    def test_stats_calculations(self, api_client):
        """Test that stats calculations are correct."""
        AircraftSighting.objects.create(
            icao_hex="A",
            latitude=47.5,
            longitude=-122.3,
            altitude_baro=30000,
            ground_speed=400,
            distance_nm=10.0,
        )
        AircraftSighting.objects.create(
            icao_hex="B",
            latitude=47.6,
            longitude=-122.4,
            altitude_baro=40000,
            ground_speed=500,
            distance_nm=20.0,
        )

        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        # Average altitude should be 35000
        assert data["avg_altitude"] == 35000
        assert data["max_altitude"] == 40000
        assert data["min_altitude"] == 30000

        # Average speed should be 450
        assert data["avg_speed"] == 450
        assert data["max_speed"] == 500

        # Average distance should be 15
        assert data["avg_distance_nm"] == 15.0
        assert data["max_distance_nm"] == 20.0

    def test_stats_time_filter(self, api_client):
        """Test that stats respect time filter."""
        # Create old sighting
        old_sighting = AircraftSighting.objects.create(icao_hex="OLD", latitude=47.5, longitude=-122.3)
        old_sighting.timestamp = timezone.now() - timedelta(hours=48)
        old_sighting.save()

        # Create recent sighting
        AircraftSighting.objects.create(icao_hex="NEW", latitude=47.6, longitude=-122.4)

        response = api_client.get("/api/v1/history/stats/?hours=24")
        data = response.json()

        assert data["total_sightings"] == 1
        assert data["unique_aircraft"] == 1


@pytest.mark.django_db
class TestHistoryTrendsView:
    """Tests for the history trends endpoint."""

    def test_trends_returns_200(self, api_client):
        """Test that trends returns 200 OK."""
        response = api_client.get("/api/v1/history/trends/")
        assert response.status_code == status.HTTP_200_OK

    def test_trends_response_structure(self, api_client):
        """Test that trends response has expected structure."""
        response = api_client.get("/api/v1/history/trends/")
        data = response.json()

        assert "intervals" in data
        assert "interval_type" in data
        assert "time_range_hours" in data
        assert "summary" in data

    def test_trends_summary_structure(self, api_client):
        """Test that trends summary has expected fields."""
        response = api_client.get("/api/v1/history/trends/")
        summary = response.json()["summary"]

        expected_fields = ["total_unique_aircraft", "peak_concurrent", "peak_interval", "total_intervals"]
        for field in expected_fields:
            assert field in summary, f"Missing field: {field}"

    def test_trends_empty(self, api_client):
        """Test trends with no data."""
        response = api_client.get("/api/v1/history/trends/")
        data = response.json()

        assert data["intervals"] == []
        assert data["summary"]["total_unique_aircraft"] == 0

    def test_trends_with_data(self, api_client):
        """Test trends with sighting data."""
        now = timezone.now()

        # Create sightings at different hours
        for hour_offset in range(3):
            timestamp = now - timedelta(hours=hour_offset)
            for i in range(5):
                sighting = AircraftSighting.objects.create(
                    icao_hex=f"AC{i}",
                    latitude=47.5,
                    longitude=-122.3,
                )
                sighting.timestamp = timestamp
                sighting.save()

        response = api_client.get("/api/v1/history/trends/?hours=6")
        data = response.json()

        # Should have intervals
        assert len(data["intervals"]) > 0

    def test_trends_interval_structure(self, api_client):
        """Test that trend intervals have expected fields."""
        # Create a sighting
        AircraftSighting.objects.create(
            icao_hex="ABC123",
            latitude=47.5,
            longitude=-122.3,
            altitude_baro=35000,
            ground_speed=450,
            distance_nm=10.0,
            is_military=True,
        )

        response = api_client.get("/api/v1/history/trends/")
        data = response.json()

        if data["intervals"]:
            interval = data["intervals"][0]
            expected_fields = [
                "timestamp",
                "position_count",
                "unique_aircraft",
                "military_count",
                "avg_altitude",
                "max_altitude",
                "avg_distance_nm",
                "max_distance_nm",
                "avg_speed",
                "max_speed",
            ]
            for field in expected_fields:
                assert field in interval, f"Missing field: {field}"


@pytest.mark.django_db
class TestHistoryTopPerformersView:
    """Tests for the history top performers endpoint."""

    def test_top_performers_returns_200(self, api_client):
        """Test that top-performers returns 200 OK."""
        response = api_client.get("/api/v1/history/top-performers/")
        assert response.status_code == status.HTTP_200_OK

    def test_top_performers_response_structure(self, api_client):
        """Test that response has expected categories."""
        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        expected_categories = [
            "longest_tracked",
            "furthest_distance",
            "highest_altitude",
            "most_positions",
            "closest_approach",
        ]
        for category in expected_categories:
            assert category in data, f"Missing category: {category}"

        assert "time_range_hours" in data
        assert "limit" in data

    def test_top_performers_empty(self, api_client):
        """Test top performers with no sessions."""
        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        assert data["longest_tracked"] == []
        assert data["furthest_distance"] == []

    def test_top_performers_with_sessions(self, api_client):
        """Test top performers with session data."""
        now = timezone.now()

        # Create sessions with varying metrics
        for i in range(5):
            session = AircraftSession.objects.create(
                icao_hex=f"AC{i}",
                callsign=f"FLT{i}",
                aircraft_type="B738",
                is_military=i % 2 == 0,
                total_positions=100 * (i + 1),
                max_altitude=30000 + (i * 5000),
                min_distance_nm=float(i + 1),
                max_distance_nm=float(50 + i * 10),
            )
            session.first_seen = now - timedelta(hours=i + 1)
            session.last_seen = now
            session.save()

        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        # Should have results in each category
        assert len(data["longest_tracked"]) > 0
        assert len(data["furthest_distance"]) > 0
        assert len(data["highest_altitude"]) > 0

    def test_top_performers_entry_structure(self, api_client):
        """Test that performer entries have expected fields."""
        now = timezone.now()
        session = AircraftSession.objects.create(
            icao_hex="ABC123",
            callsign="UAL123",
            aircraft_type="B738",
            is_military=False,
            total_positions=100,
            min_altitude=25000,
            max_altitude=35000,
            min_distance_nm=5.0,
            max_distance_nm=50.0,
        )
        session.first_seen = now - timedelta(hours=1)
        session.last_seen = now
        session.save()

        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        if data["longest_tracked"]:
            entry = data["longest_tracked"][0]
            expected_fields = [
                "icao_hex",
                "callsign",
                "aircraft_type",
                "is_military",
                "first_seen",
                "last_seen",
                "duration_min",
                "positions",
                "min_distance_nm",
                "max_distance_nm",
                "min_altitude",
                "max_altitude",
            ]
            for field in expected_fields:
                assert field in entry, f"Missing field: {field}"

    def test_top_performers_limit(self, api_client):
        """Test limit parameter."""
        now = timezone.now()
        for i in range(15):
            session = AircraftSession.objects.create(
                icao_hex=f"AC{i:02d}",
                total_positions=100 * (i + 1),
                max_altitude=30000 + i * 1000,
                max_distance_nm=float(50 + i),
            )
            session.last_seen = now
            session.save()

        response = api_client.get("/api/v1/history/top-performers/?limit=5")
        data = response.json()

        assert len(data["longest_tracked"]) <= 5
        assert len(data["highest_altitude"]) <= 5

    def test_top_performers_sorted_correctly(self, api_client):
        """Test that performers are sorted correctly."""
        now = timezone.now()

        # Create sessions with clear ordering
        session1 = AircraftSession.objects.create(
            icao_hex="LOW",
            max_altitude=20000,
        )
        session1.last_seen = now
        session1.save()

        session2 = AircraftSession.objects.create(
            icao_hex="HIGH",
            max_altitude=45000,
        )
        session2.last_seen = now
        session2.save()

        session3 = AircraftSession.objects.create(
            icao_hex="MED",
            max_altitude=35000,
        )
        session3.last_seen = now
        session3.save()

        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        # Highest altitude should be first
        assert data["highest_altitude"][0]["icao_hex"] == "HIGH"


@pytest.mark.django_db
class TestHistoryIntegration:
    """Integration tests for history endpoints."""

    def test_all_endpoints_return_json(self, api_client):
        """Test that all endpoints return JSON."""
        # Create some data
        AircraftSighting.objects.create(icao_hex="ABC123", latitude=47.5, longitude=-122.3)
        AircraftSession.objects.create(icao_hex="ABC123")

        endpoints = [
            "/api/v1/sightings/",
            "/api/v1/sessions/",
            "/api/v1/history/stats/",
            "/api/v1/history/trends/",
            "/api/v1/history/top-performers/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response["Content-Type"] == "application/json", f"Endpoint {endpoint} should return JSON"

    def test_no_authentication_required(self, api_client):
        """Test that no authentication is required."""
        api_client.credentials()

        endpoints = [
            "/api/v1/sightings/",
            "/api/v1/sessions/",
            "/api/v1/history/stats/",
            "/api/v1/history/trends/",
            "/api/v1/history/top-performers/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response.status_code not in [
                status.HTTP_401_UNAUTHORIZED,
                status.HTTP_403_FORBIDDEN,
            ], f"{endpoint} should not require authentication"

    def test_consistent_time_filtering(self, api_client):
        """Test that time filtering is consistent across endpoints."""
        now = timezone.now()

        # Create old data - use update() to bypass auto_now fields
        old_sighting = AircraftSighting.objects.create(icao_hex="OLD", latitude=47.5, longitude=-122.3)
        AircraftSighting.objects.filter(pk=old_sighting.pk).update(timestamp=now - timedelta(hours=48))

        old_session = AircraftSession.objects.create(icao_hex="OLD")
        AircraftSession.objects.filter(pk=old_session.pk).update(last_seen=now - timedelta(hours=48))

        # Create recent data
        AircraftSighting.objects.create(icao_hex="NEW", latitude=47.6, longitude=-122.4)
        AircraftSession.objects.create(icao_hex="NEW")

        # All endpoints should only return recent data with hours=24
        sightings_response = api_client.get("/api/v1/sightings/?hours=24")
        sessions_response = api_client.get("/api/v1/sessions/?hours=24")
        stats_response = api_client.get("/api/v1/history/stats/?hours=24")

        # Check that old data is excluded
        sighting_icaos = [s["icao_hex"] for s in sightings_response.json()["results"]]
        session_icaos = [s["icao_hex"] for s in sessions_response.json()["sessions"]]

        assert "OLD" not in sighting_icaos
        assert "OLD" not in session_icaos
        assert stats_response.json()["time_range_hours"] == 24

    def test_stats_match_list_counts(self, api_client):
        """Test that stats counts match list data."""
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"AC{i}",
                latitude=47.5,
                longitude=-122.3,
            )
            AircraftSession.objects.create(icao_hex=f"AC{i}")

        sightings_response = api_client.get("/api/v1/sightings/")
        api_client.get("/api/v1/sessions/")
        stats_response = api_client.get("/api/v1/history/stats/")

        stats = stats_response.json()

        # Note: pagination affects counts - use the count field
        assert stats["total_sightings"] == sightings_response.json()["count"]

    def test_read_only_endpoints(self, api_client):
        """Test that history endpoints are read-only."""
        sighting = AircraftSighting.objects.create(icao_hex="ABC123", latitude=47.5, longitude=-122.3)
        session = AircraftSession.objects.create(icao_hex="ABC123")

        # Test POST, PUT, DELETE are not allowed
        test_cases = [
            ("/api/v1/sightings/", "POST"),
            (f"/api/v1/sightings/{sighting.id}/", "PUT"),
            (f"/api/v1/sightings/{sighting.id}/", "DELETE"),
            ("/api/v1/sessions/", "POST"),
            (f"/api/v1/sessions/{session.id}/", "PUT"),
            (f"/api/v1/sessions/{session.id}/", "DELETE"),
        ]

        for endpoint, method in test_cases:
            if method == "POST":
                response = api_client.post(endpoint, {}, format="json")
            elif method == "PUT":
                response = api_client.put(endpoint, {}, format="json")
            elif method == "DELETE":
                response = api_client.delete(endpoint)

            assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED, (
                f"{method} {endpoint} should be disallowed"
            )
