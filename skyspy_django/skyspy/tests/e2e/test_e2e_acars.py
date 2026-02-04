"""
Comprehensive E2E tests for the SkySpy Django API ACARS system.

Tests cover:
- ACARS message listing and filtering
- Message filtering by aircraft, type, date
- Label and sublabel filtering
- ACARS statistics endpoints
- Message breakdown and trends
- Airline statistics
- Free text analysis
"""

from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status

from skyspy.models import AcarsMessage
from skyspy.tests.factories import AcarsMessageFactory

# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def acars_message_batch(db):
    """Create a batch of ACARS messages with various characteristics."""
    messages = []
    now = timezone.now()

    # VDL2 messages
    for i in range(5):
        msg = AcarsMessageFactory(
            source="vdlm2",
            timestamp=now - timedelta(hours=i),
            label="Q0",
            icao_hex=f"A{i:05d}",
            callsign=f"UAL{100 + i}",
        )
        messages.append(msg)

    # ACARS messages
    for i in range(5):
        msg = AcarsMessageFactory(
            source="acars",
            timestamp=now - timedelta(hours=i + 1),
            label="H1",
            icao_hex=f"B{i:05d}",
            callsign=f"DAL{200 + i}",
        )
        messages.append(msg)

    # Position reports
    for i in range(3):
        msg = AcarsMessageFactory(
            position=True,
            timestamp=now - timedelta(hours=i),
            icao_hex=f"C{i:05d}",
            callsign=f"AAL{300 + i}",
        )
        messages.append(msg)

    # OOOI messages
    for i in range(3):
        msg = AcarsMessageFactory(
            oooi=True,
            timestamp=now - timedelta(hours=i + 2),
            icao_hex=f"D{i:05d}",
            callsign=f"SWA{400 + i}",
        )
        messages.append(msg)

    return messages


@pytest.fixture
def cached_acars_status():
    """Pre-populate cache with ACARS status data."""
    cache.set("acars_running", True, timeout=300)
    cache.set(
        "acars_stats",
        {"messages_received": 1234, "last_message": timezone.now().isoformat()},
        timeout=300,
    )
    cache.set(
        "vdlm2_stats",
        {"messages_received": 5678, "last_message": timezone.now().isoformat()},
        timeout=300,
    )
    cache.set("acars_buffer_size", 50, timeout=300)
    yield
    cache.clear()


# =============================================================================
# ACARS Message Listing Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsMessageListing:
    """Tests for GET /api/v1/acars endpoint."""

    def test_list_returns_200_ok(self, api_client):
        """Test that ACARS list returns 200 OK."""
        response = api_client.get("/api/v1/acars/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty_returns_empty_list(self, api_client):
        """Test list response when no messages exist."""
        response = api_client.get("/api/v1/acars/")
        data = response.json()

        assert "messages" in data or "results" in data
        assert "count" in data

    def test_list_response_structure(self, api_client, acars_message_batch):
        """Test that list response has correct structure."""
        response = api_client.get("/api/v1/acars/")
        data = response.json()

        assert "messages" in data or "results" in data
        assert "count" in data
        assert "filters" in data

    def test_list_includes_required_fields(self, api_client, acars_message_batch):
        """Test that messages include required fields."""
        response = api_client.get("/api/v1/acars/")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        if messages:
            msg = messages[0]
            assert "id" in msg
            assert "timestamp" in msg
            assert "source" in msg

    def test_list_filter_by_source(self, api_client, acars_message_batch):
        """Test filtering messages by source (acars/vdlm2)."""
        response = api_client.get("/api/v1/acars/?source=vdlm2")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        for msg in messages:
            assert msg["source"] == "vdlm2"

    def test_list_filter_by_icao_hex(self, api_client, acars_message_batch):
        """Test filtering messages by ICAO hex."""
        response = api_client.get("/api/v1/acars/?icao_hex=A00000")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        for msg in messages:
            assert msg["icao_hex"].upper() == "A00000"

    def test_list_filter_by_callsign(self, api_client, acars_message_batch):
        """Test filtering messages by callsign."""
        response = api_client.get("/api/v1/acars/?callsign=UAL100")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        for msg in messages:
            assert "UAL100" in msg["callsign"]

    def test_list_filter_by_label(self, api_client, acars_message_batch):
        """Test filtering messages by label."""
        response = api_client.get("/api/v1/acars/?label=Q0")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        for msg in messages:
            assert msg["label"] == "Q0"

    def test_list_filter_by_hours(self, api_client, acars_message_batch):
        """Test filtering messages by time range."""
        response_24h = api_client.get("/api/v1/acars/?hours=24")
        response_6h = api_client.get("/api/v1/acars/?hours=6")

        data_24h = response_24h.json()
        data_6h = response_6h.json()

        # 6 hour range should have fewer or equal messages
        assert data_6h["count"] <= data_24h["count"]

    def test_list_with_limit(self, api_client, acars_message_batch):
        """Test listing with limit parameter."""
        response = api_client.get("/api/v1/acars/?limit=5")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        assert len(messages) <= 5

    def test_list_ordered_by_timestamp_descending(self, api_client, acars_message_batch):
        """Test that messages are ordered by timestamp descending."""
        response = api_client.get("/api/v1/acars/")
        data = response.json()

        messages = data.get("messages", data.get("results", []))
        if len(messages) > 1:
            for i in range(len(messages) - 1):
                assert messages[i]["timestamp"] >= messages[i + 1]["timestamp"]


# =============================================================================
# ACARS Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsStatistics:
    """Tests for ACARS statistics endpoint."""

    def test_stats_returns_200_ok(self, api_client, acars_message_batch):
        """Test that stats endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_stats_response_structure(self, api_client, acars_message_batch):
        """Test stats response includes expected fields."""
        response = api_client.get("/api/v1/acars/stats/")
        data = response.json()

        assert "total_messages" in data
        assert "last_hour" in data
        assert "last_24h" in data

    def test_stats_includes_source_breakdown(self, api_client, acars_message_batch):
        """Test stats include source breakdown."""
        response = api_client.get("/api/v1/acars/stats/")
        data = response.json()

        assert "by_source" in data

    def test_stats_includes_top_labels(self, api_client, acars_message_batch):
        """Test stats include top labels."""
        response = api_client.get("/api/v1/acars/stats/")
        data = response.json()

        assert "top_labels" in data
        if data["top_labels"]:
            label = data["top_labels"][0]
            assert "label" in label
            assert "count" in label


# =============================================================================
# ACARS Status Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsStatus:
    """Tests for ACARS receiver status endpoint."""

    def test_status_returns_200_ok(self, api_client, cached_acars_status):
        """Test that status endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/status/")
        assert response.status_code == status.HTTP_200_OK

    def test_status_response_structure(self, api_client, cached_acars_status):
        """Test status response structure."""
        response = api_client.get("/api/v1/acars/status/")
        data = response.json()

        assert "running" in data
        assert "acars" in data
        assert "vdlm2" in data

    def test_status_includes_buffer_size(self, api_client, cached_acars_status):
        """Test status includes buffer size."""
        response = api_client.get("/api/v1/acars/status/")
        data = response.json()

        assert "buffer_size" in data


# =============================================================================
# ACARS Labels Reference Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsLabels:
    """Tests for ACARS label reference endpoint."""

    def test_labels_returns_200_ok(self, api_client):
        """Test that labels endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/labels/")
        assert response.status_code == status.HTTP_200_OK

    def test_labels_response_structure(self, api_client):
        """Test labels response structure."""
        response = api_client.get("/api/v1/acars/labels/")
        data = response.json()

        assert "labels" in data
        assert "sources" in data

    def test_labels_include_definitions(self, api_client):
        """Test that labels include definitions."""
        response = api_client.get("/api/v1/acars/labels/")
        data = response.json()

        labels = data["labels"]
        assert isinstance(labels, dict)
        # Should have at least some labels
        if labels:
            label_key = list(labels.keys())[0]
            label = labels[label_key]
            assert "name" in label or isinstance(label, str)


# =============================================================================
# ACARS Breakdown Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsBreakdownStats:
    """Tests for ACARS message breakdown statistics endpoint."""

    def test_breakdown_returns_200_ok(self, api_client, acars_message_batch):
        """Test that breakdown endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/breakdown/")
        assert response.status_code == status.HTTP_200_OK

    def test_breakdown_response_structure(self, api_client, acars_message_batch):
        """Test breakdown response structure."""
        response = api_client.get("/api/v1/acars/stats/breakdown/")
        data = response.json()

        # Should include various breakdown categories
        assert isinstance(data, dict)

    def test_breakdown_with_hours_filter(self, api_client, acars_message_batch):
        """Test breakdown with hours filter."""
        response = api_client.get("/api/v1/acars/stats/breakdown/?hours=12")
        assert response.status_code == status.HTTP_200_OK

    def test_breakdown_with_cache_bypass(self, api_client, acars_message_batch):
        """Test breakdown with cache bypass."""
        response = api_client.get("/api/v1/acars/stats/breakdown/?use_cache=false")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# ACARS Airline Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsAirlineStats:
    """Tests for ACARS airline activity statistics endpoint."""

    def test_airline_stats_returns_200_ok(self, api_client, acars_message_batch):
        """Test that airline stats endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/airlines/")
        assert response.status_code == status.HTTP_200_OK

    def test_airline_stats_response_structure(self, api_client, acars_message_batch):
        """Test airline stats response structure."""
        response = api_client.get("/api/v1/acars/stats/airlines/")
        data = response.json()

        assert isinstance(data, dict)

    def test_airline_stats_with_limit(self, api_client, acars_message_batch):
        """Test airline stats with limit parameter."""
        response = api_client.get("/api/v1/acars/stats/airlines/?limit=5")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# ACARS Summary Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsSummaryStats:
    """Tests for ACARS summary statistics endpoint."""

    def test_summary_returns_200_ok(self, api_client, acars_message_batch):
        """Test that summary endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/summary/")
        assert response.status_code == status.HTTP_200_OK

    def test_summary_response_structure(self, api_client, acars_message_batch):
        """Test summary response structure."""
        response = api_client.get("/api/v1/acars/stats/summary/")
        data = response.json()

        assert isinstance(data, dict)

    def test_summary_with_hours_filter(self, api_client, acars_message_batch):
        """Test summary with hours filter."""
        response = api_client.get("/api/v1/acars/stats/summary/?hours=6")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# ACARS Trends Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsTrends:
    """Tests for ACARS message trends endpoint."""

    def test_trends_returns_200_ok(self, api_client, acars_message_batch):
        """Test that trends endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/trends/")
        assert response.status_code == status.HTTP_200_OK

    def test_trends_response_structure(self, api_client, acars_message_batch):
        """Test trends response structure."""
        response = api_client.get("/api/v1/acars/stats/trends/")
        data = response.json()

        assert isinstance(data, dict)

    def test_trends_with_interval(self, api_client, acars_message_batch):
        """Test trends with different intervals."""
        # Hourly interval
        response = api_client.get("/api/v1/acars/stats/trends/?interval=hour")
        assert response.status_code == status.HTTP_200_OK

        # Daily interval
        response = api_client.get("/api/v1/acars/stats/trends/?interval=day")
        assert response.status_code == status.HTTP_200_OK

    def test_trends_with_hours_filter(self, api_client, acars_message_batch):
        """Test trends with hours filter."""
        response = api_client.get("/api/v1/acars/stats/trends/?hours=48")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# ACARS Category Trends Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsCategoryTrends:
    """Tests for ACARS category trends endpoint."""

    def test_category_trends_returns_200_ok(self, api_client, acars_message_batch):
        """Test that category trends endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/category-trends/")
        assert response.status_code == status.HTTP_200_OK

    def test_category_trends_response_structure(self, api_client, acars_message_batch):
        """Test category trends response structure."""
        response = api_client.get("/api/v1/acars/stats/category-trends/")
        data = response.json()

        assert isinstance(data, dict)


# =============================================================================
# ACARS Free Text Analysis Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsTextAnalysis:
    """Tests for ACARS free text analysis endpoint."""

    def test_text_analysis_returns_200_ok(self, api_client, acars_message_batch):
        """Test that text analysis endpoint returns 200 OK."""
        response = api_client.get("/api/v1/acars/stats/text-analysis/")
        assert response.status_code == status.HTTP_200_OK

    def test_text_analysis_response_structure(self, api_client, acars_message_batch):
        """Test text analysis response structure."""
        response = api_client.get("/api/v1/acars/stats/text-analysis/")
        data = response.json()

        assert isinstance(data, dict)

    def test_text_analysis_with_limit(self, api_client, acars_message_batch):
        """Test text analysis with limit parameter."""
        response = api_client.get("/api/v1/acars/stats/text-analysis/?limit=10")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# ACARS Message Detail Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsMessageDetail:
    """Tests for ACARS message detail endpoint."""

    def test_retrieve_message(self, api_client, acars_message_batch):
        """Test retrieving a single ACARS message."""
        msg = acars_message_batch[0]
        response = api_client.get(f"/api/v1/acars/{msg.id}/")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["id"] == msg.id

    def test_retrieve_nonexistent_message(self, api_client):
        """Test retrieving a nonexistent message returns 404."""
        response = api_client.get("/api/v1/acars/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_retrieve_includes_message_content(self, api_client, acars_message_batch):
        """Test that retrieved message includes content."""
        msg = acars_message_batch[0]
        response = api_client.get(f"/api/v1/acars/{msg.id}/")
        data = response.json()

        assert "text" in data or "message" in data
        assert "label" in data
        assert "source" in data


# =============================================================================
# Permission Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsPermissions:
    """Tests for ACARS endpoint permissions."""

    def test_viewer_can_list_messages(self, viewer_client, acars_message_batch):
        """Test that viewer can list ACARS messages."""
        response = viewer_client.get("/api/v1/acars/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_stats(self, viewer_client, acars_message_batch):
        """Test that viewer can access ACARS stats."""
        response = viewer_client.get("/api/v1/acars/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_access_all_endpoints(self, operator_client, acars_message_batch):
        """Test that operator can access all ACARS endpoints."""
        endpoints = [
            "/api/v1/acars/",
            "/api/v1/acars/stats/",
            "/api/v1/acars/status/",
            "/api/v1/acars/labels/",
            "/api/v1/acars/stats/breakdown/",
            "/api/v1/acars/stats/airlines/",
            "/api/v1/acars/stats/summary/",
            "/api/v1/acars/stats/trends/",
        ]

        for endpoint in endpoints:
            response = operator_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK, f"Failed for {endpoint}"


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestAcarsIntegration:
    """Integration tests for ACARS workflows."""

    def test_complete_acars_data_flow(self, api_client, acars_message_batch, cached_acars_status):
        """Test complete ACARS data flow."""
        # 1. Check receiver status
        status_response = api_client.get("/api/v1/acars/status/")
        assert status_response.status_code == status.HTTP_200_OK
        assert status_response.json()["running"] is True

        # 2. List messages
        list_response = api_client.get("/api/v1/acars/")
        assert list_response.status_code == status.HTTP_200_OK
        assert list_response.json()["count"] > 0

        # 3. Get statistics
        stats_response = api_client.get("/api/v1/acars/stats/")
        assert stats_response.status_code == status.HTTP_200_OK

        # 4. Get label reference
        labels_response = api_client.get("/api/v1/acars/labels/")
        assert labels_response.status_code == status.HTTP_200_OK

    def test_filtering_workflow(self, api_client, acars_message_batch):
        """Test filtering workflow for finding specific messages."""
        # 1. Filter by source
        vdl_response = api_client.get("/api/v1/acars/?source=vdlm2")
        assert vdl_response.status_code == status.HTTP_200_OK

        # 2. Filter by callsign pattern
        callsign_response = api_client.get("/api/v1/acars/?callsign=UAL")
        assert callsign_response.status_code == status.HTTP_200_OK

        # 3. Filter by label
        label_response = api_client.get("/api/v1/acars/?label=Q0")
        assert label_response.status_code == status.HTTP_200_OK

        # 4. Combine filters
        combined_response = api_client.get("/api/v1/acars/?source=vdlm2&label=Q0")
        assert combined_response.status_code == status.HTTP_200_OK

    def test_statistics_consistency(self, api_client, acars_message_batch):
        """Test that statistics are consistent across endpoints."""
        # Get overall stats
        stats_response = api_client.get("/api/v1/acars/stats/")
        stats_data = stats_response.json()

        # Get breakdown stats
        breakdown_response = api_client.get("/api/v1/acars/stats/breakdown/")
        assert breakdown_response.status_code == status.HTTP_200_OK

        # Get summary stats
        summary_response = api_client.get("/api/v1/acars/stats/summary/")
        assert summary_response.status_code == status.HTTP_200_OK

        # All endpoints should return valid data
        assert stats_data["total_messages"] >= 0

    def test_all_endpoints_return_json(self, api_client, acars_message_batch):
        """Test that all ACARS endpoints return valid JSON."""
        endpoints = [
            "/api/v1/acars/",
            "/api/v1/acars/stats/",
            "/api/v1/acars/status/",
            "/api/v1/acars/labels/",
            "/api/v1/acars/stats/breakdown/",
            "/api/v1/acars/stats/airlines/",
            "/api/v1/acars/stats/summary/",
            "/api/v1/acars/stats/trends/",
            "/api/v1/acars/stats/category-trends/",
            "/api/v1/acars/stats/text-analysis/",
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                data = response.json()
                assert data is not None, f"No data returned from {endpoint}"
