"""
Comprehensive E2E tests for the SkySpy Django API history system.

Tests cover:
- Sighting history retrieval and filtering
- Session history retrieval
- Historical statistics
- Activity trends
- Top performers
- Distance and speed analytics
- Correlation analytics
- Antenna analytics (polar, RSSI)
- Time comparison statistics
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from skyspy.tests.factories import (
    AircraftSessionFactory,
    AircraftSightingFactory,
)

# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def sightings_history(db):
    """Create a comprehensive batch of sightings for history testing."""
    sightings = []
    now = timezone.now()

    # Create sightings spread across time and various attributes
    for day in range(3):
        for hour in range(24):
            for i in range(2):
                sighting = AircraftSightingFactory(
                    timestamp=now - timedelta(days=day, hours=hour),
                    icao_hex=f"A{day:02d}{hour:02d}{i}",
                    callsign=f"TST{day:02d}{hour:02d}",
                    altitude_baro=25000 + hour * 500 + i * 100,
                    ground_speed=350 + hour * 5,
                    distance_nm=10.0 + day * 20 + hour * 2,
                    rssi=-20.0 - day - hour * 0.5,
                    track=hour * 15,  # 0-360 coverage
                    is_military=(hour % 6 == 0),
                    aircraft_type=["B738", "A320", "E75L", "B77W"][hour % 4],
                )
                sightings.append(sighting)

    return sightings


@pytest.fixture
def sessions_history(db):
    """Create a batch of sessions for history testing."""
    sessions = []
    now = timezone.now()

    for i in range(30):
        session = AircraftSessionFactory(
            icao_hex=f"S{i:05d}",
            callsign=f"SES{i:03d}",
            first_seen=now - timedelta(hours=i + 2),
            last_seen=now - timedelta(hours=i),
            total_positions=50 + i * 10,
            min_altitude=5000 + i * 100,
            max_altitude=35000 + i * 200,
            min_distance_nm=5.0 + i * 0.5,
            max_distance_nm=50.0 + i * 5,
            min_rssi=-35.0 + i * 0.2,
            max_rssi=-15.0 + i * 0.1,
            is_military=(i % 5 == 0),
            aircraft_type=["B738", "A320", "E75L", "C17", "F16"][i % 5],
        )
        sessions.append(session)

    return sessions


# =============================================================================
# Sighting History Tests
# =============================================================================


@pytest.mark.django_db
class TestSightingHistory:
    """Tests for GET /api/v1/sightings endpoint."""

    def test_list_returns_200_ok(self, api_client, sightings_history):
        """Test that sightings list returns 200 OK."""
        response = api_client.get("/api/v1/sightings/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_response_structure(self, api_client, sightings_history):
        """Test sightings response structure."""
        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        assert "results" in data
        assert "count" in data

    def test_filter_by_icao(self, api_client, sightings_history):
        """Test filtering sightings by ICAO hex."""
        response = api_client.get("/api/v1/sightings/?icao=A00000")
        data = response.json()

        for sighting in data["results"]:
            assert sighting["icao_hex"].upper() == "A00000"

    def test_filter_by_callsign(self, api_client, sightings_history):
        """Test filtering sightings by callsign."""
        response = api_client.get("/api/v1/sightings/?callsign=TST")
        data = response.json()

        for sighting in data["results"]:
            assert "TST" in sighting["callsign"].upper()

    def test_filter_by_hours(self, api_client, sightings_history):
        """Test filtering sightings by time range."""
        response_48h = api_client.get("/api/v1/sightings/?hours=48")
        response_24h = api_client.get("/api/v1/sightings/?hours=24")

        data_48h = response_48h.json()
        data_24h = response_24h.json()

        assert data_24h["count"] <= data_48h["count"]

    def test_filter_by_military_only(self, api_client, sightings_history):
        """Test filtering sightings for military only."""
        response = api_client.get("/api/v1/sightings/?military_only=true")
        data = response.json()

        for sighting in data["results"]:
            assert sighting["is_military"] is True

    def test_filter_by_altitude_range(self, api_client, sightings_history):
        """Test filtering sightings by altitude range."""
        response = api_client.get("/api/v1/sightings/?min_altitude=30000&max_altitude=40000")
        data = response.json()

        for sighting in data["results"]:
            altitude = sighting.get("altitude") or sighting.get("altitude_baro")
            if altitude:
                assert 30000 <= altitude <= 40000

    def test_filter_by_distance_range(self, api_client, sightings_history):
        """Test filtering sightings by distance range."""
        response = api_client.get("/api/v1/sightings/?min_distance=20&max_distance=50")
        data = response.json()

        for sighting in data["results"]:
            if sighting.get("distance_nm"):
                assert 20 <= sighting["distance_nm"] <= 50

    def test_filter_by_aircraft_type(self, api_client, sightings_history):
        """Test filtering sightings by aircraft type."""
        response = api_client.get("/api/v1/sightings/?aircraft_type=B738")
        data = response.json()

        for sighting in data["results"]:
            assert sighting["aircraft_type"] == "B738"

    def test_list_with_limit(self, api_client, sightings_history):
        """Test sightings list with limit."""
        response = api_client.get("/api/v1/sightings/?limit=10")
        data = response.json()

        assert len(data["results"]) <= 10

    def test_ordered_by_timestamp_descending(self, api_client, sightings_history):
        """Test sightings are ordered by timestamp descending."""
        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        results = data["results"]
        if len(results) > 1:
            for i in range(len(results) - 1):
                assert results[i]["timestamp"] >= results[i + 1]["timestamp"]

    def test_sightings_include_emergency_and_track_keys(self, api_client, sightings_history):
        """Every serialized sighting exposes the is_emergency and track keys."""
        response = api_client.get("/api/v1/sightings/")
        data = response.json()

        assert data["results"], "expected at least one sighting in the response"
        for sighting in data["results"]:
            assert "is_emergency" in sighting
            assert "track" in sighting

    def test_emergency_sighting_serializes_flag_and_track(self, api_client, db):
        """A sighting created with is_emergency=True and a track value serializes both."""
        sighting = AircraftSightingFactory(
            icao_hex="EMG001",
            callsign="EMRG01",
            squawk="7700",
            is_emergency=True,
            track=137.5,
        )

        response = api_client.get("/api/v1/sightings/?icao=EMG001")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        match = next((s for s in data["results"] if s["id"] == sighting.id), None)
        assert match is not None, "created emergency sighting not found in response"
        assert match["is_emergency"] is True
        assert match["track"] == pytest.approx(137.5)


# =============================================================================
# Session History Tests
# =============================================================================


@pytest.mark.django_db
class TestSessionHistory:
    """Tests for GET /api/v1/sessions endpoint."""

    def test_list_returns_200_ok(self, api_client, sessions_history):
        """Test that sessions list returns 200 OK."""
        response = api_client.get("/api/v1/sessions/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_response_structure(self, api_client, sessions_history):
        """Test sessions response structure."""
        response = api_client.get("/api/v1/sessions/")
        data = response.json()

        assert "sessions" in data
        assert "count" in data

    def test_session_includes_required_fields(self, api_client, sessions_history):
        """Test that sessions include required fields."""
        response = api_client.get("/api/v1/sessions/")
        data = response.json()

        if data["sessions"]:
            session = data["sessions"][0]
            assert "icao_hex" in session
            assert "first_seen" in session
            assert "last_seen" in session

    def test_filter_by_icao_hex(self, api_client, sessions_history):
        """Test filtering sessions by ICAO hex."""
        response = api_client.get("/api/v1/sessions/?icao_hex=S00000")
        data = response.json()

        for session in data["sessions"]:
            assert session["icao_hex"] == "S00000"

    def test_filter_by_callsign(self, api_client, sessions_history):
        """Test filtering sessions by callsign."""
        response = api_client.get("/api/v1/sessions/?callsign=SES000")
        data = response.json()

        for session in data["sessions"]:
            assert session["callsign"] == "SES000"

    def test_filter_by_military(self, api_client, sessions_history):
        """Test filtering sessions by military flag."""
        response = api_client.get("/api/v1/sessions/?military_only=true")
        data = response.json()

        for session in data["sessions"]:
            assert session["is_military"] is True


# =============================================================================
# History Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestHistoryStatistics:
    """Tests for GET /api/v1/history/stats endpoint."""

    def test_stats_returns_200_ok(self, api_client, sightings_history):
        """Test that stats returns 200 OK."""
        response = api_client.get("/api/v1/history/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_stats_response_structure(self, api_client, sightings_history):
        """Test stats response structure."""
        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        assert "total_sightings" in data
        assert "unique_aircraft" in data
        assert "time_range_hours" in data

    def test_stats_includes_altitude_metrics(self, api_client, sightings_history):
        """Test stats include altitude metrics."""
        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        assert "avg_altitude" in data
        assert "max_altitude" in data

    def test_stats_includes_distance_metrics(self, api_client, sightings_history):
        """Test stats include distance metrics."""
        response = api_client.get("/api/v1/history/stats/")
        data = response.json()

        assert "avg_distance_nm" in data
        assert "max_distance_nm" in data

    def test_stats_filter_by_hours(self, api_client, sightings_history):
        """Test stats with hours filter."""
        response = api_client.get("/api/v1/history/stats/?hours=12")
        data = response.json()

        assert data["time_range_hours"] == 12


# =============================================================================
# Activity Trends Tests
# =============================================================================


@pytest.mark.django_db
class TestActivityTrends:
    """Tests for GET /api/v1/history/trends endpoint."""

    def test_trends_returns_200_ok(self, api_client, sightings_history):
        """Test that trends returns 200 OK."""
        response = api_client.get("/api/v1/history/trends/")
        assert response.status_code == status.HTTP_200_OK

    def test_trends_response_structure(self, api_client, sightings_history):
        """Test trends response structure."""
        response = api_client.get("/api/v1/history/trends/")
        data = response.json()

        assert "intervals" in data
        assert "summary" in data
        assert "time_range_hours" in data

    def test_trends_includes_interval_data(self, api_client, sightings_history):
        """Test trends include interval data."""
        response = api_client.get("/api/v1/history/trends/")
        data = response.json()

        if data["intervals"]:
            interval = data["intervals"][0]
            assert "timestamp" in interval
            assert "position_count" in interval
            assert "unique_aircraft" in interval

    def test_trends_includes_summary(self, api_client, sightings_history):
        """Test trends include summary."""
        response = api_client.get("/api/v1/history/trends/")
        data = response.json()

        summary = data["summary"]
        assert "total_unique_aircraft" in summary
        assert "peak_concurrent" in summary


# =============================================================================
# Top Performers Tests
# =============================================================================


@pytest.mark.django_db
class TestTopPerformers:
    """Tests for GET /api/v1/history/top-performers endpoint."""

    def test_top_performers_returns_200_ok(self, api_client, sessions_history):
        """Test that top performers returns 200 OK."""
        response = api_client.get("/api/v1/history/top-performers/")
        assert response.status_code == status.HTTP_200_OK

    def test_top_performers_response_structure(self, api_client, sessions_history):
        """Test top performers response structure."""
        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        assert "longest_tracked" in data
        assert "furthest_distance" in data
        assert "highest_altitude" in data
        assert "closest_approach" in data

    def test_top_performers_includes_session_data(self, api_client, sessions_history):
        """Test top performers include session data."""
        response = api_client.get("/api/v1/history/top-performers/")
        data = response.json()

        if data["longest_tracked"]:
            session = data["longest_tracked"][0]
            assert "icao_hex" in session
            assert "callsign" in session

    def test_top_performers_with_limit(self, api_client, sessions_history):
        """Test top performers with limit parameter."""
        response = api_client.get("/api/v1/history/top-performers/?limit=5")
        data = response.json()

        assert len(data["longest_tracked"]) <= 5
        assert len(data["furthest_distance"]) <= 5

    def test_top_performers_includes_aircraft_info(self, api_client, sessions_history):
        """Test top performers include aircraft info when available."""
        response = api_client.get("/api/v1/history/top-performers/?include_info=true")
        response.json()

        # Aircraft info may or may not be available
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Distance Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestDistanceAnalytics:
    """Tests for GET /api/v1/history/analytics/distance endpoint."""

    def test_distance_analytics_returns_200_ok(self, api_client, sessions_history):
        """Test that distance analytics returns 200 OK."""
        response = api_client.get("/api/v1/history/analytics/distance/")
        assert response.status_code == status.HTTP_200_OK

    def test_distance_analytics_response_structure(self, api_client, sessions_history):
        """Test distance analytics response structure."""
        response = api_client.get("/api/v1/history/analytics/distance/")
        data = response.json()

        assert "distribution" in data
        assert "statistics" in data
        assert "time_range_hours" in data

    def test_distance_analytics_includes_distribution(self, api_client, sessions_history):
        """Test distance analytics include distribution buckets."""
        response = api_client.get("/api/v1/history/analytics/distance/")
        data = response.json()

        distribution = data["distribution"]
        # Should have distance buckets
        assert isinstance(distribution, dict)

    def test_distance_analytics_filter_by_military(self, api_client, sessions_history):
        """Test distance analytics with military filter."""
        response = api_client.get("/api/v1/history/analytics/distance/?military_only=true")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Speed Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestSpeedAnalytics:
    """Tests for GET /api/v1/history/analytics/speed endpoint."""

    def test_speed_analytics_returns_200_ok(self, api_client, sightings_history):
        """Test that speed analytics returns 200 OK."""
        response = api_client.get("/api/v1/history/analytics/speed/")
        assert response.status_code == status.HTTP_200_OK

    def test_speed_analytics_response_structure(self, api_client, sightings_history):
        """Test speed analytics response structure."""
        response = api_client.get("/api/v1/history/analytics/speed/")
        data = response.json()

        assert "distribution" in data
        assert "statistics" in data
        assert "time_range_hours" in data

    def test_speed_analytics_includes_fastest(self, api_client, sightings_history):
        """Test speed analytics include fastest sessions."""
        response = api_client.get("/api/v1/history/analytics/speed/")
        data = response.json()

        assert "fastest_sessions" in data


# =============================================================================
# Correlation Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestCorrelationAnalytics:
    """Tests for GET /api/v1/history/analytics/correlation endpoint."""

    def test_correlation_returns_200_ok(self, api_client, sightings_history):
        """Test that correlation analytics returns 200 OK."""
        response = api_client.get("/api/v1/history/analytics/correlation/")
        assert response.status_code == status.HTTP_200_OK

    def test_correlation_response_structure(self, api_client, sightings_history):
        """Test correlation analytics response structure."""
        response = api_client.get("/api/v1/history/analytics/correlation/")
        data = response.json()

        assert "altitude_vs_speed" in data
        assert "distance_vs_altitude" in data
        assert "time_of_day_patterns" in data

    def test_correlation_includes_hourly_patterns(self, api_client, sightings_history):
        """Test correlation includes hourly patterns."""
        response = api_client.get("/api/v1/history/analytics/correlation/")
        data = response.json()

        patterns = data["time_of_day_patterns"]
        assert "hourly_counts" in patterns


# =============================================================================
# Antenna Polar Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaPolarAnalytics:
    """Tests for GET /api/v1/history/analytics/antenna/polar endpoint."""

    def test_polar_returns_200_ok(self, api_client, sightings_history):
        """Test that antenna polar analytics returns 200 OK."""
        response = api_client.get("/api/v1/history/analytics/antenna/polar/")
        assert response.status_code == status.HTTP_200_OK

    def test_polar_response_structure(self, api_client, sightings_history):
        """Test antenna polar response structure."""
        response = api_client.get("/api/v1/history/analytics/antenna/polar/")
        data = response.json()

        assert "bearing_data" in data
        assert "summary" in data
        assert "time_range_hours" in data

    def test_polar_includes_bearing_sectors(self, api_client, sightings_history):
        """Test polar includes bearing sectors."""
        response = api_client.get("/api/v1/history/analytics/antenna/polar/")
        data = response.json()

        bearing_data = data["bearing_data"]
        assert isinstance(bearing_data, list)
        # Should have 36 sectors (10-degree increments)
        assert len(bearing_data) == 36


# =============================================================================
# Antenna RSSI Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaRssiAnalytics:
    """Tests for GET /api/v1/history/analytics/antenna/rssi endpoint."""

    def test_rssi_returns_200_ok(self, api_client, sightings_history):
        """Test that antenna RSSI analytics returns 200 OK."""
        response = api_client.get("/api/v1/history/analytics/antenna/rssi/")
        assert response.status_code == status.HTTP_200_OK

    def test_rssi_response_structure(self, api_client, sightings_history):
        """Test antenna RSSI response structure."""
        response = api_client.get("/api/v1/history/analytics/antenna/rssi/")
        data = response.json()

        assert "scatter_data" in data
        assert "band_statistics" in data
        assert "time_range_hours" in data

    def test_rssi_includes_trend_line(self, api_client, sightings_history):
        """Test RSSI includes trend line when enough data."""
        response = api_client.get("/api/v1/history/analytics/antenna/rssi/")
        data = response.json()

        # Trend line may be present if enough data
        assert "trend_line" in data


# =============================================================================
# Antenna Summary Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaSummaryAnalytics:
    """Tests for GET /api/v1/history/analytics/antenna/summary endpoint."""

    def test_summary_returns_200_ok(self, api_client, sightings_history):
        """Test that antenna summary returns 200 OK."""
        response = api_client.get("/api/v1/history/analytics/antenna/summary/")
        assert response.status_code == status.HTTP_200_OK

    def test_summary_response_structure(self, api_client, sightings_history):
        """Test antenna summary response structure."""
        response = api_client.get("/api/v1/history/analytics/antenna/summary/")
        data = response.json()

        assert "range" in data
        assert "signal" in data
        assert "coverage" in data
        assert "time_range_hours" in data


# =============================================================================
# Time Comparison Tests
# =============================================================================


@pytest.mark.django_db
class TestTimeComparison:
    """Tests for time comparison endpoints."""

    def test_week_comparison_returns_200_ok(self, api_client, sightings_history):
        """Test week-over-week comparison returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/week/")
        assert response.status_code == status.HTTP_200_OK

    def test_seasonal_trends_returns_200_ok(self, api_client, sightings_history):
        """Test seasonal trends returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/seasonal/")
        assert response.status_code == status.HTTP_200_OK

    def test_day_night_returns_200_ok(self, api_client, sightings_history):
        """Test day vs night comparison returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/day-night/")
        assert response.status_code == status.HTTP_200_OK

    def test_weekend_weekday_returns_200_ok(self, api_client, sightings_history):
        """Test weekend vs weekday comparison returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/weekend-weekday/")
        assert response.status_code == status.HTTP_200_OK

    def test_daily_totals_returns_200_ok(self, api_client, sightings_history):
        """Test daily totals returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/daily/")
        assert response.status_code == status.HTTP_200_OK

    def test_weekly_totals_returns_200_ok(self, api_client, sightings_history):
        """Test weekly totals returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/weekly/")
        assert response.status_code == status.HTTP_200_OK

    def test_monthly_totals_returns_200_ok(self, api_client, sightings_history):
        """Test monthly totals returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/monthly/")
        assert response.status_code == status.HTTP_200_OK

    def test_all_time_comparison_returns_200_ok(self, api_client, sightings_history):
        """Test all time comparison stats returns 200 OK."""
        response = api_client.get("/api/v1/history/time-comparison/")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Permission Tests
# =============================================================================


@pytest.mark.django_db
class TestHistoryPermissions:
    """Tests for history endpoint permissions."""

    def test_viewer_can_access_sightings(self, viewer_client, sightings_history):
        """Test viewer can access sightings."""
        response = viewer_client.get("/api/v1/sightings/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_sessions(self, viewer_client, sessions_history):
        """Test viewer can access sessions."""
        response = viewer_client.get("/api/v1/sessions/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_stats(self, viewer_client, sightings_history):
        """Test viewer can access stats."""
        response = viewer_client.get("/api/v1/history/stats/")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestHistoryIntegration:
    """Integration tests for history workflows."""

    def test_complete_history_workflow(self, api_client, sightings_history, sessions_history):
        """Test complete history data retrieval workflow."""
        # 1. Get stats overview
        stats_response = api_client.get("/api/v1/history/stats/")
        assert stats_response.status_code == status.HTTP_200_OK

        # 2. Get trends
        trends_response = api_client.get("/api/v1/history/trends/")
        assert trends_response.status_code == status.HTTP_200_OK

        # 3. Get top performers
        top_response = api_client.get("/api/v1/history/top-performers/")
        assert top_response.status_code == status.HTTP_200_OK

        # 4. Get sightings list
        sightings_response = api_client.get("/api/v1/sightings/")
        assert sightings_response.status_code == status.HTTP_200_OK

        # 5. Get sessions list
        sessions_response = api_client.get("/api/v1/sessions/")
        assert sessions_response.status_code == status.HTTP_200_OK

    def test_analytics_consistency(self, api_client, sightings_history, sessions_history):
        """Test analytics data consistency."""
        # Get stats
        stats_response = api_client.get("/api/v1/history/stats/?hours=24")
        stats_data = stats_response.json()

        # Get trends
        trends_response = api_client.get("/api/v1/history/trends/?hours=24")
        trends_data = trends_response.json()

        # Total sightings should be consistent
        total_from_stats = stats_data["total_sightings"]
        total_from_trends = sum(i["position_count"] for i in trends_data["intervals"])

        # Allow for some variance due to timing/caching
        assert abs(total_from_stats - total_from_trends) <= total_from_stats * 0.1 or total_from_stats == 0

    def test_all_history_endpoints_return_json(self, api_client, sightings_history, sessions_history):
        """Test all history endpoints return valid JSON."""
        endpoints = [
            "/api/v1/sightings/",
            "/api/v1/sessions/",
            "/api/v1/history/stats/",
            "/api/v1/history/trends/",
            "/api/v1/history/top-performers/",
            "/api/v1/history/analytics/distance/",
            "/api/v1/history/analytics/speed/",
            "/api/v1/history/analytics/correlation/",
            "/api/v1/history/analytics/antenna/polar/",
            "/api/v1/history/analytics/antenna/rssi/",
            "/api/v1/history/analytics/antenna/summary/",
            "/api/v1/history/time-comparison/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                data = response.json()
                assert data is not None, f"No data returned from {endpoint}"

    def test_filtering_produces_subset(self, api_client, sightings_history):
        """Test that filtering produces proper subsets."""
        # Get all sightings
        all_response = api_client.get("/api/v1/sightings/?hours=72")
        all_count = all_response.json()["count"]

        # Filter by military
        military_response = api_client.get("/api/v1/sightings/?hours=72&military_only=true")
        military_count = military_response.json()["count"]

        # Military should be subset
        assert military_count <= all_count
