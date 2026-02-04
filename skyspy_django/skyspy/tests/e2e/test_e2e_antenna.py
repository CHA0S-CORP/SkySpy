"""
Comprehensive E2E tests for the SkySpy Django API antenna analytics system.

Tests cover:
- Current antenna analytics
- Historical snapshots
- Performance trends
- Coverage analysis by direction
- Cleanup operations
"""

from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status

from skyspy.models import AntennaAnalyticsSnapshot

# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def antenna_snapshots(db):
    """Create a batch of antenna analytics snapshots."""
    snapshots = []
    now = timezone.now()

    for i in range(24):  # 24 hours of snapshots
        snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(hours=i),
            snapshot_type="scheduled",
            window_hours=1.0,
            max_range_nm=150.0 + i * 2,
            avg_range_nm=75.0 + i,
            min_range_nm=5.0,
            range_p50_nm=70.0,
            range_p75_nm=100.0,
            range_p90_nm=130.0,
            range_p95_nm=145.0,
            best_rssi=-10.0 - i * 0.1,
            avg_rssi=-25.0 - i * 0.2,
            worst_rssi=-40.0 - i * 0.1,
            total_positions=1000 + i * 100,
            unique_aircraft=50 + i * 2,
            positions_per_hour=1000 + i * 100,
            range_by_direction={
                "0": {"max_range": 120, "avg_range": 60, "position_count": 100, "unique_aircraft": 10},
                "30": {"max_range": 130, "avg_range": 65, "position_count": 110, "unique_aircraft": 12},
                "60": {"max_range": 140, "avg_range": 70, "position_count": 120, "unique_aircraft": 14},
                "90": {"max_range": 150, "avg_range": 75, "position_count": 130, "unique_aircraft": 16},
                "120": {"max_range": 145, "avg_range": 72, "position_count": 125, "unique_aircraft": 15},
                "150": {"max_range": 135, "avg_range": 68, "position_count": 115, "unique_aircraft": 13},
                "180": {"max_range": 125, "avg_range": 62, "position_count": 105, "unique_aircraft": 11},
                "210": {"max_range": 115, "avg_range": 58, "position_count": 95, "unique_aircraft": 9},
                "240": {"max_range": 110, "avg_range": 55, "position_count": 90, "unique_aircraft": 8},
                "270": {"max_range": 105, "avg_range": 52, "position_count": 85, "unique_aircraft": 7},
                "300": {"max_range": 100, "avg_range": 50, "position_count": 80, "unique_aircraft": 6},
                "330": {"max_range": 95, "avg_range": 48, "position_count": 75, "unique_aircraft": 5},
            },
            sectors_with_data=12,
            coverage_percentage=100.0,
            estimated_gain_db=5.5,
            performance_score=85.0 - i * 0.5,
        )
        snapshots.append(snapshot)

    return snapshots


@pytest.fixture
def hourly_snapshots(db):
    """Create hourly aggregated snapshots."""
    snapshots = []
    now = timezone.now()

    for i in range(7):  # 7 days of hourly snapshots
        snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=i),
            snapshot_type="hourly",
            window_hours=1.0,
            max_range_nm=160.0,
            avg_range_nm=80.0,
            total_positions=24000,
            unique_aircraft=500,
            coverage_percentage=95.0,
        )
        snapshots.append(snapshot)

    return snapshots


@pytest.fixture
def cached_antenna_analytics():
    """Pre-populate cache with antenna analytics data."""
    analytics_data = {
        "timestamp": timezone.now().isoformat(),
        "range": {
            "max_nm": 175.0,
            "avg_nm": 85.0,
            "min_nm": 5.0,
        },
        "signal": {
            "best_rssi": -8.0,
            "avg_rssi": -22.0,
            "worst_rssi": -38.0,
        },
        "coverage": {
            "total_positions": 2500,
            "unique_aircraft": 75,
            "sectors_with_data": 12,
            "coverage_percentage": 100.0,
        },
    }
    cache.set("antenna_analytics", analytics_data, timeout=300)
    yield analytics_data
    cache.clear()


# =============================================================================
# Current Analytics Tests
# =============================================================================


@pytest.mark.django_db
class TestCurrentAntennaAnalytics:
    """Tests for GET /api/v1/antenna endpoint."""

    def test_list_returns_200_ok(self, api_client):
        """Test that antenna list returns 200 OK."""
        response = api_client.get("/api/v1/antenna/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_with_cached_data(self, api_client, cached_antenna_analytics):
        """Test list response with cached analytics data."""
        response = api_client.get("/api/v1/antenna/")
        data = response.json()

        assert data["status"] == "ok"
        assert data["cached"] is True
        assert "data" in data
        assert data["data"] is not None

    def test_list_with_snapshot_fallback(self, api_client, antenna_snapshots):
        """Test list falls back to latest snapshot when cache is empty."""
        cache.clear()
        response = api_client.get("/api/v1/antenna/")
        data = response.json()

        assert data["status"] == "ok"
        assert data["cached"] is False
        assert "data" in data

    def test_list_no_data_available(self, api_client):
        """Test list response when no analytics data exists."""
        cache.clear()
        response = api_client.get("/api/v1/antenna/")
        data = response.json()

        assert data["status"] == "no_data"
        assert data["data"] is None


# =============================================================================
# History Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaHistory:
    """Tests for GET /api/v1/antenna/history endpoint."""

    def test_history_returns_200_ok(self, api_client, antenna_snapshots):
        """Test that history endpoint returns 200 OK."""
        response = api_client.get("/api/v1/antenna/history/")
        assert response.status_code == status.HTTP_200_OK

    def test_history_response_structure(self, api_client, antenna_snapshots):
        """Test history response structure."""
        response = api_client.get("/api/v1/antenna/history/")
        data = response.json()

        assert "hours" in data
        assert "snapshot_type" in data
        assert "count" in data
        assert "snapshots" in data

    def test_history_includes_snapshots(self, api_client, antenna_snapshots):
        """Test that history includes snapshots."""
        response = api_client.get("/api/v1/antenna/history/")
        data = response.json()

        assert data["count"] > 0
        assert len(data["snapshots"]) > 0

    def test_history_filter_by_hours(self, api_client, antenna_snapshots):
        """Test filtering history by hours."""
        response_24h = api_client.get("/api/v1/antenna/history/?hours=24")
        response_12h = api_client.get("/api/v1/antenna/history/?hours=12")

        data_24h = response_24h.json()
        data_12h = response_12h.json()

        assert data_12h["count"] <= data_24h["count"]
        assert data_12h["hours"] == 12
        assert data_24h["hours"] == 24

    def test_history_filter_by_snapshot_type(self, api_client, antenna_snapshots, hourly_snapshots):
        """Test filtering history by snapshot type."""
        # Get scheduled snapshots
        scheduled_response = api_client.get("/api/v1/antenna/history/?snapshot_type=scheduled")
        scheduled_data = scheduled_response.json()
        assert scheduled_data["snapshot_type"] == "scheduled"

        # Get hourly snapshots
        hourly_response = api_client.get("/api/v1/antenna/history/?snapshot_type=hourly")
        hourly_data = hourly_response.json()
        assert hourly_data["snapshot_type"] == "hourly"

    def test_history_ordered_by_timestamp(self, api_client, antenna_snapshots):
        """Test that history is ordered by timestamp ascending."""
        response = api_client.get("/api/v1/antenna/history/")
        data = response.json()

        snapshots = data["snapshots"]
        if len(snapshots) > 1:
            for i in range(len(snapshots) - 1):
                assert snapshots[i]["timestamp"] <= snapshots[i + 1]["timestamp"]


# =============================================================================
# Trends Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaTrends:
    """Tests for GET /api/v1/antenna/trends endpoint."""

    def test_trends_returns_200_ok(self, api_client, antenna_snapshots):
        """Test that trends endpoint returns 200 OK."""
        response = api_client.get("/api/v1/antenna/trends/")
        assert response.status_code == status.HTTP_200_OK

    def test_trends_response_structure(self, api_client, antenna_snapshots):
        """Test trends response structure."""
        response = api_client.get("/api/v1/antenna/trends/")
        data = response.json()

        assert "hours" in data
        assert "interval" in data
        assert "trends" in data
        assert "summary" in data

    def test_trends_includes_trend_data(self, api_client, antenna_snapshots):
        """Test that trends include data points."""
        response = api_client.get("/api/v1/antenna/trends/")
        data = response.json()

        if data["trends"]:
            trend_point = data["trends"][0]
            assert "timestamp" in trend_point
            assert "max_range_nm" in trend_point
            assert "avg_range_nm" in trend_point

    def test_trends_includes_summary(self, api_client, antenna_snapshots):
        """Test that trends include summary statistics."""
        response = api_client.get("/api/v1/antenna/trends/")
        data = response.json()

        summary = data["summary"]
        assert "avg_max_range" in summary
        assert "peak_max_range" in summary
        assert "data_points" in summary

    def test_trends_filter_by_hours(self, api_client, antenna_snapshots):
        """Test filtering trends by hours."""
        response = api_client.get("/api/v1/antenna/trends/?hours=12")
        data = response.json()

        assert data["hours"] == 12

    def test_trends_filter_by_interval(self, api_client, antenna_snapshots):
        """Test filtering trends by interval."""
        response = api_client.get("/api/v1/antenna/trends/?interval=hourly")
        data = response.json()

        assert data["interval"] == "hourly"

    def test_trends_empty_when_no_data(self, api_client):
        """Test trends response when no data exists."""
        response = api_client.get("/api/v1/antenna/trends/")
        data = response.json()

        assert data["trends"] == []
        assert data["summary"]["data_points"] == 0


# =============================================================================
# Coverage Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaCoverage:
    """Tests for GET /api/v1/antenna/coverage endpoint."""

    def test_coverage_returns_200_ok(self, api_client, antenna_snapshots):
        """Test that coverage endpoint returns 200 OK."""
        response = api_client.get("/api/v1/antenna/coverage/")
        assert response.status_code == status.HTTP_200_OK

    def test_coverage_response_structure(self, api_client, antenna_snapshots):
        """Test coverage response structure."""
        response = api_client.get("/api/v1/antenna/coverage/")
        data = response.json()

        assert "hours" in data
        # Coverage data may or may not be available
        if "sectors" in data:
            assert "summary" in data

    def test_coverage_includes_sectors(self, api_client, antenna_snapshots):
        """Test that coverage includes sector data."""
        response = api_client.get("/api/v1/antenna/coverage/")
        data = response.json()

        if "sectors" in data and data["sectors"]:
            sector = data["sectors"][0]
            assert "bearing" in sector
            assert "bearing_range" in sector
            assert "has_data" in sector

    def test_coverage_includes_summary(self, api_client, antenna_snapshots):
        """Test that coverage includes summary."""
        response = api_client.get("/api/v1/antenna/coverage/")
        data = response.json()

        if "summary" in data:
            summary = data["summary"]
            assert "total_sectors" in summary
            assert "sectors_with_data" in summary
            assert "coverage_percentage" in summary

    def test_coverage_identifies_best_sector(self, api_client, antenna_snapshots):
        """Test that coverage identifies best and weakest sectors."""
        response = api_client.get("/api/v1/antenna/coverage/")
        data = response.json()

        if "summary" in data:
            summary = data["summary"]
            if summary.get("sectors_with_data", 0) > 0:
                assert "best_sector" in summary
                assert "weakest_sector" in summary

    def test_coverage_no_data_available(self, api_client):
        """Test coverage response when no direction data exists."""
        AntennaAnalyticsSnapshot.objects.create(
            timestamp=timezone.now(),
            snapshot_type="scheduled",
            range_by_direction={},
        )

        response = api_client.get("/api/v1/antenna/coverage/")
        response.json()

        # Should indicate no coverage data
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Cleanup Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaCleanup:
    """Tests for DELETE /api/v1/antenna/cleanup endpoint."""

    def test_cleanup_returns_200_ok(self, admin_client, antenna_snapshots):
        """Test that cleanup endpoint returns 200 OK."""
        response = admin_client.delete("/api/v1/antenna/cleanup/")
        assert response.status_code == status.HTTP_200_OK

    def test_cleanup_response_structure(self, admin_client, antenna_snapshots):
        """Test cleanup response structure."""
        response = admin_client.delete("/api/v1/antenna/cleanup/")
        data = response.json()

        assert "deleted_count" in data
        assert "retention_days" in data
        assert "cutoff" in data

    def test_cleanup_respects_retention_days(self, admin_client, db):
        """Test that cleanup respects retention days parameter."""
        now = timezone.now()

        # Create old snapshot (8 days old)
        old_snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=8),
            snapshot_type="scheduled",
        )

        # Create recent snapshot (6 days old)
        recent_snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=6),
            snapshot_type="scheduled",
        )

        # Cleanup with 7 days retention
        response = admin_client.delete("/api/v1/antenna/cleanup/?days=7")
        response.json()

        # Old snapshot should be deleted
        assert not AntennaAnalyticsSnapshot.objects.filter(id=old_snapshot.id).exists()
        # Recent snapshot should still exist
        assert AntennaAnalyticsSnapshot.objects.filter(id=recent_snapshot.id).exists()

    def test_cleanup_default_retention(self, admin_client, db):
        """Test cleanup with default retention period."""
        now = timezone.now()

        # Create very old snapshot
        AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=30),
            snapshot_type="scheduled",
        )

        response = admin_client.delete("/api/v1/antenna/cleanup/")
        data = response.json()

        # Default retention is 7 days
        assert data["retention_days"] == 7


# =============================================================================
# Permission Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaPermissions:
    """Tests for antenna endpoint permissions."""

    def test_viewer_can_access_analytics(self, viewer_client, antenna_snapshots):
        """Test that viewer can access antenna analytics."""
        response = viewer_client.get("/api/v1/antenna/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_history(self, viewer_client, antenna_snapshots):
        """Test that viewer can access history."""
        response = viewer_client.get("/api/v1/antenna/history/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_trends(self, viewer_client, antenna_snapshots):
        """Test that viewer can access trends."""
        response = viewer_client.get("/api/v1/antenna/trends/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_coverage(self, viewer_client, antenna_snapshots):
        """Test that viewer can access coverage."""
        response = viewer_client.get("/api/v1/antenna/coverage/")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestAntennaIntegration:
    """Integration tests for antenna analytics workflows."""

    def test_complete_analytics_workflow(self, api_client, antenna_snapshots, cached_antenna_analytics):
        """Test complete antenna analytics workflow."""
        # 1. Get current analytics
        current_response = api_client.get("/api/v1/antenna/")
        assert current_response.status_code == status.HTTP_200_OK
        current_data = current_response.json()
        assert current_data["data"] is not None

        # 2. Get historical data
        history_response = api_client.get("/api/v1/antenna/history/?hours=24")
        assert history_response.status_code == status.HTTP_200_OK
        assert history_response.json()["count"] > 0

        # 3. Get trends
        trends_response = api_client.get("/api/v1/antenna/trends/?hours=24")
        assert trends_response.status_code == status.HTTP_200_OK

        # 4. Get coverage
        coverage_response = api_client.get("/api/v1/antenna/coverage/")
        assert coverage_response.status_code == status.HTTP_200_OK

    def test_analytics_consistency(self, api_client, antenna_snapshots):
        """Test that analytics are consistent across endpoints."""
        # Get history count
        history_response = api_client.get("/api/v1/antenna/history/?hours=24")
        history_count = history_response.json()["count"]

        # Get trends data points
        trends_response = api_client.get("/api/v1/antenna/trends/?hours=24")
        trends_count = trends_response.json()["summary"]["data_points"]

        # Should be similar (may not be exactly equal due to filtering)
        assert abs(history_count - trends_count) <= 1

    def test_all_endpoints_return_json(self, api_client, antenna_snapshots):
        """Test that all antenna endpoints return valid JSON."""
        endpoints = [
            "/api/v1/antenna/",
            "/api/v1/antenna/history/",
            "/api/v1/antenna/trends/",
            "/api/v1/antenna/coverage/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                data = response.json()
                assert data is not None, f"No data returned from {endpoint}"

    def test_snapshot_data_integrity(self, api_client, antenna_snapshots):
        """Test that snapshot data maintains integrity."""
        response = api_client.get("/api/v1/antenna/history/?hours=24")
        data = response.json()

        for snapshot in data["snapshots"]:
            # Check range consistency
            if snapshot.get("range"):
                range_data = snapshot["range"]
                if range_data.get("max_nm") and range_data.get("avg_nm"):
                    assert range_data["max_nm"] >= range_data["avg_nm"]

            # Check coverage percentage bounds
            if snapshot.get("coverage"):
                coverage = snapshot["coverage"]
                if coverage.get("coverage_percentage") is not None:
                    assert 0 <= coverage["coverage_percentage"] <= 100
