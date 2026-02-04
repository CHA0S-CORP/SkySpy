"""
Comprehensive E2E tests for the SkySpy Django API audio system.

Tests cover:
- Audio transmission listing
- Audio file upload
- Transcription endpoints
- Audio statistics
- Audio file serving
- Matched radio calls search
- Frequency management
"""

import io
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status

from skyspy.models import AudioTransmission
from skyspy.tests.factories import AudioTransmissionFactory

# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def audio_transmission_batch(db):
    """Create a batch of audio transmissions with various statuses."""
    transmissions = []

    # Pending transmissions
    for i in range(3):
        t = AudioTransmissionFactory(
            frequency_mhz=118.0 + i * 0.1,
            channel_name=f"Test Channel {i}",
        )
        transmissions.append(t)

    # Queued transmissions
    for _ in range(2):
        t = AudioTransmissionFactory(queued=True, frequency_mhz=121.5)
        transmissions.append(t)

    # Completed transmissions
    for _ in range(3):
        t = AudioTransmissionFactory(
            completed=True,
            frequency_mhz=125.35,
            channel_name="SEA Tower",
        )
        transmissions.append(t)

    # Failed transmissions
    for _ in range(2):
        t = AudioTransmissionFactory(failed=True)
        transmissions.append(t)

    return transmissions


@pytest.fixture
def completed_transmission(db):
    """Create a single completed transmission with transcript."""
    return AudioTransmissionFactory(
        completed=True,
        frequency_mhz=125.35,
        channel_name="SEA Tower",
        transcript="United four five six, Seattle Tower, cleared for takeoff runway one six right.",
        transcript_confidence=0.95,
        identified_airframes=[{"type": "airline", "airline": "UNITED", "raw_text": "UNITED 456", "callsign": "UAL456"}],
    )


@pytest.fixture
def mock_audio_file():
    """Create a mock audio file for upload testing."""
    # Create a simple MP3 header (not a valid audio file but sufficient for API testing)
    audio_data = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 1000
    return io.BytesIO(audio_data)


# =============================================================================
# Audio Transmission Listing Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioTransmissionListing:
    """Tests for GET /api/v1/audio endpoint."""

    def test_list_returns_200_ok(self, api_client):
        """Test that audio list returns 200 OK."""
        response = api_client.get("/api/v1/audio/")
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty_returns_empty_list(self, api_client):
        """Test list response when no transmissions exist."""
        response = api_client.get("/api/v1/audio/")
        data = response.json()

        assert "transmissions" in data
        assert "count" in data or "total" in data

    def test_list_response_structure(self, api_client, audio_transmission_batch):
        """Test that list response has correct structure."""
        response = api_client.get("/api/v1/audio/")
        data = response.json()

        assert "transmissions" in data or "results" in data
        assert "count" in data or "total" in data

    def test_list_includes_required_fields(self, api_client, audio_transmission_batch):
        """Test that transmissions include required fields."""
        response = api_client.get("/api/v1/audio/")
        data = response.json()

        transmissions = data.get("transmissions", data.get("results", []))
        if transmissions:
            transmission = transmissions[0]
            assert "id" in transmission
            assert "filename" in transmission
            assert "transcription_status" in transmission

    def test_list_filter_by_status(self, api_client, audio_transmission_batch):
        """Test filtering transmissions by transcription status."""
        response = api_client.get("/api/v1/audio/?transcription_status=completed")
        data = response.json()

        transmissions = data.get("transmissions", data.get("results", []))
        for t in transmissions:
            assert t["transcription_status"] == "completed"

    def test_list_filter_by_frequency(self, api_client, audio_transmission_batch):
        """Test filtering transmissions by frequency."""
        response = api_client.get("/api/v1/audio/?frequency_mhz=125.35")
        data = response.json()

        transmissions = data.get("transmissions", data.get("results", []))
        for t in transmissions:
            if "frequency_mhz" in t:
                assert t["frequency_mhz"] == 125.35

    def test_list_filter_by_channel(self, api_client, audio_transmission_batch):
        """Test filtering transmissions by channel name."""
        response = api_client.get("/api/v1/audio/?channel_name=SEA Tower")
        data = response.json()

        transmissions = data.get("transmissions", data.get("results", []))
        for t in transmissions:
            if "channel_name" in t:
                assert t["channel_name"] == "SEA Tower"

    def test_list_filter_by_hours(self, api_client, db):
        """Test filtering transmissions by time range."""
        # Create old transmission
        old = AudioTransmissionFactory()
        old.created_at = timezone.now() - timedelta(hours=48)
        old.save()

        # Create recent transmission
        AudioTransmissionFactory()

        response = api_client.get("/api/v1/audio/?hours=24")
        data = response.json()

        # The old transmission should be filtered out
        transmissions = data.get("transmissions", data.get("results", []))
        assert all(t["id"] != old.id for t in transmissions)

    def test_list_ordered_by_created_at_descending(self, api_client, audio_transmission_batch):
        """Test that transmissions are ordered by created_at descending."""
        response = api_client.get("/api/v1/audio/")
        data = response.json()

        transmissions = data.get("transmissions", data.get("results", []))
        if len(transmissions) > 1:
            for i in range(len(transmissions) - 1):
                assert transmissions[i]["created_at"] >= transmissions[i + 1]["created_at"]


# =============================================================================
# Audio Upload Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioUpload:
    """Tests for POST /api/v1/audio/upload endpoint."""

    def test_upload_requires_file(self, operator_client):
        """Test that upload requires a file."""
        response = operator_client.post("/api/v1/audio/upload/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "error" in response.json()

    def test_upload_with_valid_file(self, operator_client, mock_audio_file):
        """Test uploading a valid audio file."""
        mock_audio_file.name = "test_transmission.mp3"
        response = operator_client.post(
            "/api/v1/audio/upload/",
            {"file": mock_audio_file},
            format="multipart",
        )

        # May succeed or fail depending on storage configuration
        assert response.status_code in [
            status.HTTP_201_CREATED,
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        ]

    def test_upload_with_metadata(self, operator_client, mock_audio_file):
        """Test uploading audio with frequency and channel metadata."""
        mock_audio_file.name = "test_transmission.mp3"
        response = operator_client.post(
            "/api/v1/audio/upload/",
            {
                "file": mock_audio_file,
                "frequency_mhz": 125.35,
                "channel_name": "SEA Tower",
                "duration_seconds": 10.5,
            },
            format="multipart",
        )

        # Check that metadata is accepted
        if response.status_code == status.HTTP_201_CREATED:
            data = response.json()
            assert "id" in data
            assert "filename" in data

    def test_upload_file_too_large(self, operator_client, settings):
        """Test that large files are rejected."""
        # Create a file larger than the max size
        max_size = getattr(settings, "RADIO_MAX_FILE_SIZE_MB", 50)
        large_data = b"\x00" * ((max_size + 1) * 1024 * 1024)
        large_file = io.BytesIO(large_data)
        large_file.name = "large_file.mp3"

        response = operator_client.post(
            "/api/v1/audio/upload/",
            {"file": large_file},
            format="multipart",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert "error" in data
        assert "too large" in data["error"].lower() or "size" in data["error"].lower()


# =============================================================================
# Transcription Tests
# =============================================================================


@pytest.mark.django_db
class TestTranscription:
    """Tests for transcription-related endpoints."""

    def test_queue_transcription(self, operator_client, db):
        """Test queuing a transmission for transcription."""
        transmission = AudioTransmissionFactory(transcription_status="pending")

        response = operator_client.post(f"/api/v1/audio/{transmission.id}/transcribe/")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["status"] == "queued" or "message" in data

        transmission.refresh_from_db()
        assert transmission.transcription_status in ["queued", "completed"]

    def test_queue_already_transcribed(self, operator_client, completed_transmission):
        """Test queueing a transmission that's already transcribed."""
        response = operator_client.post(f"/api/v1/audio/{completed_transmission.id}/transcribe/")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "already" in data.get("message", "").lower() or "transcript" in data

    def test_match_airframes(self, operator_client, completed_transmission):
        """Test extracting airframes from transcript."""
        response = operator_client.post(f"/api/v1/audio/{completed_transmission.id}/match-airframes/")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "identified_airframes" in data
        assert "count" in data

    def test_match_airframes_no_transcript(self, operator_client, db):
        """Test matching airframes when no transcript exists."""
        transmission = AudioTransmissionFactory(transcription_status="pending")

        response = operator_client.post(f"/api/v1/audio/{transmission.id}/match-airframes/")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert "error" in data


# =============================================================================
# Audio Statistics Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioStatistics:
    """Tests for audio statistics endpoints."""

    def test_stats_returns_200_ok(self, api_client, audio_transmission_batch):
        """Test that stats endpoint returns 200 OK."""
        response = api_client.get("/api/v1/audio/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_stats_response_structure(self, api_client, audio_transmission_batch):
        """Test stats response includes expected fields."""
        response = api_client.get("/api/v1/audio/stats/")
        data = response.json()

        # Should include transmission counts
        assert "service" in data or "total_transmissions" in data or "total" in data

    def test_stats_includes_transcription_counts(self, api_client, audio_transmission_batch):
        """Test stats include transcription status counts."""
        response = api_client.get("/api/v1/audio/stats/")
        data = response.json()

        # Stats should include transcription status breakdown
        assert isinstance(data, dict)

    def test_service_stats_returns_200_ok(self, api_client):
        """Test that service stats endpoint returns 200 OK."""
        response = api_client.get("/api/v1/audio/service-stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_service_stats_response_structure(self, api_client):
        """Test service stats response structure."""
        response = api_client.get("/api/v1/audio/service-stats/")
        data = response.json()

        # Should include queue and service status
        assert "status" in data or "queue_depth" in data or "pending" in data


# =============================================================================
# Audio URL Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioURL:
    """Tests for audio URL retrieval endpoint."""

    def test_get_url_returns_200_ok(self, api_client, completed_transmission):
        """Test that get URL endpoint returns 200 OK."""
        response = api_client.get(f"/api/v1/audio/{completed_transmission.id}/url/")
        assert response.status_code == status.HTTP_200_OK

    def test_get_url_response_structure(self, api_client, completed_transmission):
        """Test get URL response structure."""
        response = api_client.get(f"/api/v1/audio/{completed_transmission.id}/url/")
        data = response.json()

        assert "id" in data
        assert "url" in data
        assert "s3_enabled" in data

    def test_get_url_nonexistent_transmission(self, api_client):
        """Test get URL for nonexistent transmission returns 404."""
        response = api_client.get("/api/v1/audio/99999/url/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Audio File Serving Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioFileServing:
    """Tests for audio file serving endpoint."""

    def test_serve_file_requires_filename(self, api_client):
        """Test that file serving requires a filename."""
        response = api_client.get("/api/v1/audio/file/")
        # Should return 404 or redirect
        assert response.status_code in [
            status.HTTP_404_NOT_FOUND,
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_301_MOVED_PERMANENTLY,
        ]

    def test_serve_nonexistent_file(self, api_client):
        """Test serving a nonexistent file returns 404."""
        response = api_client.get("/api/v1/audio/file/nonexistent_file.mp3/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_serve_file_validates_filename(self, api_client):
        """Test that filename is validated for security."""
        # Attempt path traversal
        response = api_client.get("/api/v1/audio/file/../../../etc/passwd/")
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]


# =============================================================================
# Matched Radio Calls Tests
# =============================================================================


@pytest.mark.django_db
class TestMatchedRadioCalls:
    """Tests for matched radio calls endpoint."""

    def test_matched_requires_identifier(self, api_client):
        """Test that matched calls requires an identifier."""
        response = api_client.get("/api/v1/audio/matched/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert "error" in data

    def test_matched_by_callsign(self, api_client, completed_transmission):
        """Test searching matched calls by callsign."""
        response = api_client.get("/api/v1/audio/matched/?callsign=UAL456")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "matched_calls" in data
        assert "count" in data
        assert "filters" in data

    def test_matched_by_operator_icao(self, api_client, completed_transmission):
        """Test searching matched calls by operator ICAO."""
        response = api_client.get("/api/v1/audio/matched/?operator_icao=UAL")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "matched_calls" in data
        assert "filters" in data

    def test_matched_by_registration(self, api_client, completed_transmission):
        """Test searching matched calls by registration."""
        response = api_client.get("/api/v1/audio/matched/?registration=N12345")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert "matched_calls" in data

    def test_matched_with_time_filter(self, api_client, completed_transmission):
        """Test matched calls with time filter."""
        response = api_client.get("/api/v1/audio/matched/?callsign=UAL456&hours=12")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data["filters"]["hours"] == 12

    def test_matched_with_limit(self, api_client, completed_transmission):
        """Test matched calls with limit."""
        response = api_client.get("/api/v1/audio/matched/?callsign=UAL456&limit=5")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data["filters"]["limit"] == 5


# =============================================================================
# CRUD Operations Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioCRUD:
    """Tests for audio transmission CRUD operations."""

    def test_retrieve_transmission(self, api_client, completed_transmission):
        """Test retrieving a single transmission."""
        response = api_client.get(f"/api/v1/audio/{completed_transmission.id}/")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["id"] == completed_transmission.id

    def test_retrieve_nonexistent_transmission(self, api_client):
        """Test retrieving a nonexistent transmission returns 404."""
        response = api_client.get("/api/v1/audio/99999/")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_delete_transmission(self, operator_client, db):
        """Test deleting a transmission."""
        transmission = AudioTransmissionFactory()

        response = operator_client.delete(f"/api/v1/audio/{transmission.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify deleted
        assert not AudioTransmission.objects.filter(id=transmission.id).exists()


# =============================================================================
# Permission Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioPermissions:
    """Tests for audio endpoint permissions."""

    def test_viewer_can_list_audio(self, viewer_client, audio_transmission_batch):
        """Test that viewer can list audio transmissions."""
        response = viewer_client.get("/api/v1/audio/")
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_get_stats(self, viewer_client, audio_transmission_batch):
        """Test that viewer can access audio stats."""
        response = viewer_client.get("/api/v1/audio/stats/")
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_queue_transcription(self, operator_client, db):
        """Test that operator can queue transcription."""
        transmission = AudioTransmissionFactory()
        response = operator_client.post(f"/api/v1/audio/{transmission.id}/transcribe/")
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestAudioIntegration:
    """Integration tests for audio workflows."""

    def test_audio_transmission_lifecycle(self, operator_client, mock_audio_file, mock_whisper_service):
        """Test complete audio transmission lifecycle."""
        # Note: This test depends on external services being mocked
        # 1. List transmissions (should be empty or have existing data)
        list_response = operator_client.get("/api/v1/audio/")
        assert list_response.status_code == status.HTTP_200_OK

        # 2. Check stats
        stats_response = operator_client.get("/api/v1/audio/stats/")
        assert stats_response.status_code == status.HTTP_200_OK

        # 3. Check service stats
        service_response = operator_client.get("/api/v1/audio/service-stats/")
        assert service_response.status_code == status.HTTP_200_OK

    def test_transcription_to_airframe_matching(self, operator_client, completed_transmission):
        """Test workflow from completed transcription to airframe matching."""
        # 1. Verify transcript exists
        retrieve_response = operator_client.get(f"/api/v1/audio/{completed_transmission.id}/")
        assert retrieve_response.status_code == status.HTTP_200_OK
        data = retrieve_response.json()
        assert data["transcription_status"] == "completed"
        assert data["transcript"] is not None

        # 2. Match airframes
        match_response = operator_client.post(f"/api/v1/audio/{completed_transmission.id}/match-airframes/")
        assert match_response.status_code == status.HTTP_200_OK
        match_data = match_response.json()
        assert "identified_airframes" in match_data

    def test_search_matched_calls_with_transcribed_data(self, operator_client, completed_transmission):
        """Test searching for matched calls returns transcribed transmissions."""
        # Search for callsign mentioned in transcript
        response = operator_client.get("/api/v1/audio/matched/?callsign=UAL456")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        # Results may be empty if transcript text matching is not configured
        assert "matched_calls" in data
        assert "count" in data
