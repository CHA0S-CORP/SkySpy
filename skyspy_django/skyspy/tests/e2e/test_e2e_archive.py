"""
Comprehensive E2E tests for the SkySpy Django API archive system.

Tests cover:
- Archived NOTAMs listing and filtering
- Archived PIREPs listing and filtering
- Archive statistics
- Individual NOTAM/PIREP detail retrieval
- Search functionality
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from skyspy.models.aviation import CachedPirep
from skyspy.models.notams import CachedNotam

# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def archived_notams(db):
    """Create a batch of archived NOTAMs."""
    notams = []
    now = timezone.now()

    # TFR NOTAMs
    for i in range(3):
        notam = CachedNotam.objects.create(
            notam_id=f"TFR-{i:04d}",
            notam_type="TFR",
            classification="FDC",
            location=f"K{chr(65 + i)}BC",  # KABC, KBBC, KCBC
            latitude=47.5 + i * 0.1,
            longitude=-122.0 - i * 0.1,
            radius_nm=10 + i * 5,
            floor_ft=0,
            ceiling_ft=5000 + i * 1000,
            effective_start=now - timedelta(days=30),
            effective_end=now - timedelta(days=15),
            text=f"Temporary Flight Restriction for VIP movement {i}",
            raw_text=f"!TFR {i:04d} TFR VIP MOVEMENT",
            is_archived=True,
            archived_at=now - timedelta(days=14),
            archive_reason="expired",
        )
        notams.append(notam)

    # GPS NOTAMs
    for i in range(2):
        notam = CachedNotam.objects.create(
            notam_id=f"GPS-{i:04d}",
            notam_type="GPS",
            classification="DOM",
            location="KSEA",
            latitude=47.45,
            longitude=-122.3,
            effective_start=now - timedelta(days=20),
            effective_end=now - timedelta(days=10),
            text=f"GPS interference testing {i}",
            raw_text=f"!GPS {i:04d} GPS INTERFERENCE",
            is_archived=True,
            archived_at=now - timedelta(days=9),
            archive_reason="expired",
        )
        notams.append(notam)

    # D NOTAMs (NOTAM D)
    for i in range(3):
        notam = CachedNotam.objects.create(
            notam_id=f"NOTAM-D-{i:04d}",
            notam_type="D",
            classification="DOM",
            location="KPDX",
            latitude=45.59,
            longitude=-122.6,
            effective_start=now - timedelta(days=45),
            effective_end=now - timedelta(days=30),
            text=f"Runway closure for maintenance {i}",
            raw_text=f"!D {i:04d} RWY CLOSURE",
            is_archived=True,
            archived_at=now - timedelta(days=29),
            archive_reason="expired",
        )
        notams.append(notam)

    return notams


@pytest.fixture
def archived_pireps(db):
    """Create a batch of archived PIREPs."""
    pireps = []
    now = timezone.now()

    # Turbulence PIREPs
    for i in range(3):
        pirep = CachedPirep.objects.create(
            pirep_id=f"TURB-{i:04d}",
            report_type="UA",
            location=f"K{chr(65 + i)}BC",
            latitude=47.5 + i * 0.1,
            longitude=-122.0 - i * 0.1,
            observation_time=now - timedelta(days=20 + i),
            flight_level=350 - i * 10,
            altitude_ft=(350 - i * 10) * 100,
            aircraft_type="B738",
            turbulence_type=["LGT", "MOD", "SEV"][i % 3],
            turbulence_freq="OCNL",
            raw_text=f"UA /OV KABC/TM 1234/FL350/TP B738/TB {['LGT', 'MOD', 'SEV'][i % 3]}",
            is_archived=True,
            archived_at=now - timedelta(days=10 + i),
            archive_reason="expired",
        )
        pireps.append(pirep)

    # Icing PIREPs
    for i in range(2):
        pirep = CachedPirep.objects.create(
            pirep_id=f"ICE-{i:04d}",
            report_type="UUA",  # Urgent
            location="KSEA",
            latitude=47.45,
            longitude=-122.3,
            observation_time=now - timedelta(days=15 + i),
            flight_level=180,
            altitude_ft=18000,
            aircraft_type="E75L",
            icing_type=["LGT", "MOD"][i % 2],
            icing_intensity=["LGT", "MOD"][i % 2],
            raw_text=f"UUA /OV KSEA/TM 0900/FL180/TP E75L/IC {['LGT', 'MOD'][i % 2]}",
            is_archived=True,
            archived_at=now - timedelta(days=5 + i),
            archive_reason="expired",
        )
        pireps.append(pirep)

    # Mixed condition PIREPs
    for i in range(2):
        pirep = CachedPirep.objects.create(
            pirep_id=f"MIX-{i:04d}",
            report_type="UA",
            location="KPDX",
            latitude=45.59,
            longitude=-122.6,
            observation_time=now - timedelta(days=25 + i),
            flight_level=250,
            altitude_ft=25000,
            aircraft_type="A320",
            turbulence_type="LGT-MOD",
            icing_type="TRC",
            sky_cover="OVC100",
            temperature_c=-35,
            wind_dir=270,
            wind_speed_kt=45,
            raw_text="UA /OV KPDX/TM 1500/FL250/TP A320/TB LGT-MOD/IC TRC",
            is_archived=True,
            archived_at=now - timedelta(days=12),
            archive_reason="expired",
        )
        pireps.append(pirep)

    return pireps


# =============================================================================
# Archived NOTAMs Tests
# =============================================================================


@pytest.mark.django_db
class TestArchivedNotams:
    """Tests for GET /api/v1/archive/notams endpoint."""

    def test_list_notams_returns_200_ok(self, api_client, archived_notams):
        """Test that archived NOTAMs list returns 200 OK."""
        response = api_client.get("/api/v1/archive/notams/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_notams_response_structure(self, api_client, archived_notams):
        """Test archived NOTAMs response structure."""
        response = api_client.get("/api/v1/archive/notams/")
        data = response.json()

        assert "notams" in data or "results" in data
        assert "total_count" in data or "count" in data
        assert "days" in data
        assert "timestamp" in data

    def test_list_notams_filter_by_days(self, api_client, archived_notams):
        """Test filtering archived NOTAMs by days."""
        response_60d = api_client.get("/api/v1/archive/notams/?days=60")
        response_15d = api_client.get("/api/v1/archive/notams/?days=15")

        data_60d = response_60d.json()
        data_15d = response_15d.json()

        # 15 day range should have fewer or equal NOTAMs
        count_60d = data_60d.get("total_count", data_60d.get("count", 0))
        count_15d = data_15d.get("total_count", data_15d.get("count", 0))
        assert count_15d <= count_60d

    def test_list_notams_filter_by_icao(self, api_client, archived_notams):
        """Test filtering archived NOTAMs by ICAO."""
        response = api_client.get("/api/v1/archive/notams/?icao=KSEA")
        data = response.json()

        notams = data.get("notams", data.get("results", []))
        for notam in notams:
            assert notam["location"].upper() == "KSEA"

    def test_list_notams_filter_by_type(self, api_client, archived_notams):
        """Test filtering archived NOTAMs by type."""
        response = api_client.get("/api/v1/archive/notams/?type=TFR")
        data = response.json()

        notams = data.get("notams", data.get("results", []))
        for notam in notams:
            assert notam["notam_type"] == "TFR"

    def test_list_notams_search(self, api_client, archived_notams):
        """Test searching archived NOTAMs by text."""
        response = api_client.get("/api/v1/archive/notams/?search=VIP")
        data = response.json()

        notams = data.get("notams", data.get("results", []))
        # All results should contain search term
        for notam in notams:
            text_fields = f"{notam.get('text', '')} {notam.get('raw_text', '')}".upper()
            assert "VIP" in text_fields

    def test_list_notams_pagination(self, api_client, archived_notams):
        """Test archived NOTAMs pagination."""
        response = api_client.get("/api/v1/archive/notams/?limit=2&offset=0")
        data = response.json()

        notams = data.get("notams", data.get("results", []))
        assert len(notams) <= 2

    def test_get_notam_detail(self, api_client, archived_notams):
        """Test getting a specific archived NOTAM."""
        notam = archived_notams[0]
        response = api_client.get(f"/api/v1/archive/notams/{notam.notam_id}/")
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data["notam_id"] == notam.notam_id
        assert data["notam_type"] == notam.notam_type

    def test_get_notam_detail_not_found(self, api_client):
        """Test getting a nonexistent NOTAM returns 404."""
        response = api_client.get("/api/v1/archive/notams/NONEXISTENT-0000/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_notam_detail_includes_all_fields(self, api_client, archived_notams):
        """Test that NOTAM detail includes all expected fields."""
        notam = archived_notams[0]
        response = api_client.get(f"/api/v1/archive/notams/{notam.notam_id}/")
        data = response.json()

        expected_fields = [
            "notam_id",
            "notam_type",
            "location",
            "text",
            "effective_start",
            "is_archived",
        ]
        for field in expected_fields:
            assert field in data


# =============================================================================
# Archived PIREPs Tests
# =============================================================================


@pytest.mark.django_db
class TestArchivedPireps:
    """Tests for GET /api/v1/archive/pireps endpoint."""

    def test_list_pireps_returns_200_ok(self, api_client, archived_pireps):
        """Test that archived PIREPs list returns 200 OK."""
        response = api_client.get("/api/v1/archive/pireps/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_pireps_response_structure(self, api_client, archived_pireps):
        """Test archived PIREPs response structure."""
        response = api_client.get("/api/v1/archive/pireps/")
        data = response.json()

        assert "pireps" in data
        assert "total_count" in data
        assert "days" in data
        assert "timestamp" in data

    def test_list_pireps_filter_by_days(self, api_client, archived_pireps):
        """Test filtering archived PIREPs by days."""
        response_60d = api_client.get("/api/v1/archive/pireps/?days=60")
        response_15d = api_client.get("/api/v1/archive/pireps/?days=15")

        data_60d = response_60d.json()
        data_15d = response_15d.json()

        # 15 day range should have fewer or equal PIREPs
        assert data_15d["total_count"] <= data_60d["total_count"]

    def test_list_pireps_filter_by_icao(self, api_client, archived_pireps):
        """Test filtering archived PIREPs by location ICAO."""
        response = api_client.get("/api/v1/archive/pireps/?icao=KSEA")
        data = response.json()

        for pirep in data["pireps"]:
            assert pirep["location"].upper() == "KSEA"

    def test_list_pireps_filter_by_report_type(self, api_client, archived_pireps):
        """Test filtering archived PIREPs by report type."""
        response = api_client.get("/api/v1/archive/pireps/?report_type=UUA")
        data = response.json()

        for pirep in data["pireps"]:
            assert pirep["report_type"] == "UUA"

    def test_list_pireps_filter_by_turbulence(self, api_client, archived_pireps):
        """Test filtering archived PIREPs by turbulence type."""
        response = api_client.get("/api/v1/archive/pireps/?turbulence=MOD")
        data = response.json()

        for pirep in data["pireps"]:
            assert pirep["turbulence_type"] == "MOD"

    def test_list_pireps_filter_by_icing(self, api_client, archived_pireps):
        """Test filtering archived PIREPs by icing type."""
        response = api_client.get("/api/v1/archive/pireps/?icing=LGT")
        data = response.json()

        for pirep in data["pireps"]:
            assert pirep["icing_type"] == "LGT"

    def test_list_pireps_search(self, api_client, archived_pireps):
        """Test searching archived PIREPs."""
        response = api_client.get("/api/v1/archive/pireps/?search=B738")
        data = response.json()

        for pirep in data["pireps"]:
            text_fields = f"{pirep.get('raw_text', '')} {pirep.get('aircraft_type', '')}".upper()
            assert "B738" in text_fields

    def test_list_pireps_pagination(self, api_client, archived_pireps):
        """Test archived PIREPs pagination."""
        response = api_client.get("/api/v1/archive/pireps/?limit=2&offset=0")
        data = response.json()

        assert len(data["pireps"]) <= 2

    def test_get_pirep_detail(self, api_client, archived_pireps):
        """Test getting a specific archived PIREP."""
        pirep = archived_pireps[0]
        response = api_client.get(f"/api/v1/archive/pireps/{pirep.pirep_id}/")
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data["pirep_id"] == pirep.pirep_id
        assert data["report_type"] == pirep.report_type

    def test_get_pirep_detail_not_found(self, api_client):
        """Test getting a nonexistent PIREP returns 404."""
        response = api_client.get("/api/v1/archive/pireps/NONEXISTENT-0000/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_pirep_detail_includes_all_fields(self, api_client, archived_pireps):
        """Test that PIREP detail includes all expected fields."""
        pirep = archived_pireps[0]
        response = api_client.get(f"/api/v1/archive/pireps/{pirep.pirep_id}/")
        data = response.json()

        expected_fields = [
            "pirep_id",
            "report_type",
            "location",
            "observation_time",
            "is_archived",
        ]
        for field in expected_fields:
            assert field in data


# =============================================================================
# Archive Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestArchiveStatistics:
    """Tests for GET /api/v1/archive/stats endpoint."""

    def test_stats_returns_200_ok(self, api_client, archived_notams, archived_pireps):
        """Test that archive stats returns 200 OK."""
        response = api_client.get("/api/v1/archive/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_stats_response_structure(self, api_client, archived_notams, archived_pireps):
        """Test archive stats response structure."""
        response = api_client.get("/api/v1/archive/stats/")
        data = response.json()

        assert "notams" in data
        assert "pireps" in data
        assert "timestamp" in data

    def test_stats_includes_notam_counts(self, api_client, archived_notams, archived_pireps):
        """Test that stats include NOTAM counts."""
        response = api_client.get("/api/v1/archive/stats/")
        data = response.json()

        notam_stats = data["notams"]
        # Should have total or by_type counts
        assert "total" in notam_stats or "total_archived" in notam_stats or "by_type" in notam_stats

    def test_stats_includes_pirep_counts(self, api_client, archived_notams, archived_pireps):
        """Test that stats include PIREP counts."""
        response = api_client.get("/api/v1/archive/stats/")
        data = response.json()

        pirep_stats = data["pireps"]
        assert "total_archived" in pirep_stats
        assert "total_records" in pirep_stats

    def test_stats_includes_pirep_breakdown(self, api_client, archived_notams, archived_pireps):
        """Test that stats include PIREP breakdown by type."""
        response = api_client.get("/api/v1/archive/stats/")
        data = response.json()

        pirep_stats = data["pireps"]
        assert "by_type" in pirep_stats

    def test_stats_includes_condition_breakdown(self, api_client, archived_notams, archived_pireps):
        """Test that stats include PIREP condition breakdown."""
        response = api_client.get("/api/v1/archive/stats/")
        data = response.json()

        pirep_stats = data["pireps"]
        assert "by_turbulence" in pirep_stats
        assert "by_icing" in pirep_stats


# =============================================================================
# Permission Tests
# =============================================================================


@pytest.mark.django_db
class TestArchivePermissions:
    """Tests for archive endpoint permissions."""

    def test_viewer_can_list_archived_notams(self, viewer_client, archived_notams):
        """Test that viewer can list archived NOTAMs."""
        response = viewer_client.get("/api/v1/archive/notams/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_list_archived_pireps(self, viewer_client, archived_pireps):
        """Test that viewer can list archived PIREPs."""
        response = viewer_client.get("/api/v1/archive/pireps/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_stats(self, viewer_client, archived_notams, archived_pireps):
        """Test that viewer can access archive stats."""
        response = viewer_client.get("/api/v1/archive/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_access_all_endpoints(self, operator_client, archived_notams, archived_pireps):
        """Test that operator can access all archive endpoints."""
        endpoints = [
            "/api/v1/archive/notams/",
            "/api/v1/archive/pireps/",
            "/api/v1/archive/stats/",
        ]

        for endpoint in endpoints:
            response = operator_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK, f"Failed for {endpoint}"


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestArchiveIntegration:
    """Integration tests for archive workflows."""

    def test_complete_archive_workflow(self, api_client, archived_notams, archived_pireps):
        """Test complete archive data retrieval workflow."""
        # 1. Get archive statistics
        stats_response = api_client.get("/api/v1/archive/stats/")
        assert stats_response.status_code == status.HTTP_200_OK
        stats_response.json()

        # 2. List archived NOTAMs
        notams_response = api_client.get("/api/v1/archive/notams/")
        assert notams_response.status_code == status.HTTP_200_OK
        notams_data = notams_response.json()

        # 3. List archived PIREPs
        pireps_response = api_client.get("/api/v1/archive/pireps/")
        assert pireps_response.status_code == status.HTTP_200_OK
        pireps_data = pireps_response.json()

        # 4. Get detail for first NOTAM
        if notams_data.get("notams"):
            notam_id = notams_data["notams"][0]["notam_id"]
            detail_response = api_client.get(f"/api/v1/archive/notams/{notam_id}/")
            assert detail_response.status_code == status.HTTP_200_OK

        # 5. Get detail for first PIREP
        if pireps_data.get("pireps"):
            pirep_id = pireps_data["pireps"][0]["pirep_id"]
            detail_response = api_client.get(f"/api/v1/archive/pireps/{pirep_id}/")
            assert detail_response.status_code == status.HTTP_200_OK

    def test_filtering_consistency(self, api_client, archived_notams):
        """Test that filtering is consistent across requests."""
        # Get TFR NOTAMs
        tfr_response = api_client.get("/api/v1/archive/notams/?type=TFR")
        tfr_data = tfr_response.json()
        tfr_count = tfr_data.get("total_count", len(tfr_data.get("notams", [])))

        # Get GPS NOTAMs
        gps_response = api_client.get("/api/v1/archive/notams/?type=GPS")
        gps_data = gps_response.json()
        gps_count = gps_data.get("total_count", len(gps_data.get("notams", [])))

        # Get all NOTAMs
        all_response = api_client.get("/api/v1/archive/notams/")
        all_data = all_response.json()
        all_count = all_data.get("total_count", len(all_data.get("notams", [])))

        # Sum of filtered should not exceed total
        assert tfr_count + gps_count <= all_count

    def test_search_across_types(self, api_client, archived_notams, archived_pireps):
        """Test searching across different archive types."""
        # Search NOTAMs for runway
        notams_response = api_client.get("/api/v1/archive/notams/?search=runway")
        assert notams_response.status_code == status.HTTP_200_OK

        # Search PIREPs for B738
        pireps_response = api_client.get("/api/v1/archive/pireps/?search=B738")
        assert pireps_response.status_code == status.HTTP_200_OK

    def test_all_endpoints_return_json(self, api_client, archived_notams, archived_pireps):
        """Test that all archive endpoints return valid JSON."""
        endpoints = [
            "/api/v1/archive/notams/",
            "/api/v1/archive/pireps/",
            "/api/v1/archive/stats/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                data = response.json()
                assert data is not None, f"No data returned from {endpoint}"

    def test_archive_data_ordering(self, api_client, archived_pireps):
        """Test that archive data is properly ordered."""
        response = api_client.get("/api/v1/archive/pireps/")
        data = response.json()

        pireps = data["pireps"]
        if len(pireps) > 1:
            # Should be ordered by observation_time descending
            for i in range(len(pireps) - 1):
                if pireps[i]["observation_time"] and pireps[i + 1]["observation_time"]:
                    assert pireps[i]["observation_time"] >= pireps[i + 1]["observation_time"]
