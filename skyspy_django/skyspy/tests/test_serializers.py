"""
Comprehensive unit tests for all DRF serializers in SkySpy.

Tests serialization, deserialization, field validation, custom validators,
nested serializers, read-only vs writable fields, and error messages.
"""

import os
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import django
import pytest
from django.conf import settings

if not settings.configured:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "skyspy.tests.test_settings")
    django.setup()

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from skyspy.models import (
    AcarsMessage,
    AircraftInfo,
    AircraftSession,
    AircraftSighting,
    AlertAggregate,
    AlertHistory,
    AlertRule,
    AlertSubscription,
    AudioTransmission,
    NotificationChannel,
    NotificationConfig,
    NotificationLog,
    SafetyEvent,
)

# Import factories for test data
from skyspy.tests.factories import (
    AcarsMessageFactory,
    AircraftInfoFactory,
    AircraftSessionFactory,
    AircraftSightingFactory,
    AlertHistoryFactory,
    AlertRuleFactory,
    AudioTransmissionFactory,
    NotificationConfigFactory,
    NotificationLogFactory,
    SafetyEventFactory,
)

# =============================================================================
# COMMON SERIALIZER TESTS (common.py)
# =============================================================================


class TestCommonSerializers:
    """Tests for common serializers."""

    def test_success_response_serializer_valid(self):
        """Test SuccessResponseSerializer with valid data."""
        from skyspy.serializers.common import SuccessResponseSerializer

        data = {"success": True, "message": "Operation completed"}
        serializer = SuccessResponseSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["success"] is True
        assert serializer.validated_data["message"] == "Operation completed"

    def test_success_response_serializer_default(self):
        """Test SuccessResponseSerializer with default success."""
        from skyspy.serializers.common import SuccessResponseSerializer

        data = {}
        serializer = SuccessResponseSerializer(data=data)
        assert serializer.is_valid()

    def test_delete_response_serializer(self):
        """Test DeleteResponseSerializer."""
        from skyspy.serializers.common import DeleteResponseSerializer

        data = {"deleted": 5, "message": "Items deleted"}
        serializer = DeleteResponseSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["deleted"] == 5

    def test_error_response_serializer(self):
        """Test ErrorResponseSerializer."""
        from skyspy.serializers.common import ErrorResponseSerializer

        data = {"error": "ValidationError", "detail": "Invalid field"}
        serializer = ErrorResponseSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["error"] == "ValidationError"

    def test_geojson_geometry_serializer(self):
        """Test GeoJSONGeometrySerializer."""
        from skyspy.serializers.common import GeoJSONGeometrySerializer

        data = {"type": "Point", "coordinates": [-122.0, 47.5]}
        serializer = GeoJSONGeometrySerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["type"] == "Point"

    def test_geojson_feature_serializer(self):
        """Test GeoJSONFeatureSerializer."""
        from skyspy.serializers.common import GeoJSONFeatureSerializer

        data = {
            "type": "Feature",
            "id": "A12345",
            "geometry": {"type": "Point", "coordinates": [-122.0, 47.5]},
            "properties": {"hex": "A12345", "flight": "UAL123"},
        }
        serializer = GeoJSONFeatureSerializer(data=data)
        assert serializer.is_valid()

    def test_geojson_feature_collection_serializer(self):
        """Test GeoJSONFeatureCollectionSerializer."""
        from skyspy.serializers.common import GeoJSONFeatureCollectionSerializer

        data = {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {"count": 0, "timestamp": "2024-01-01T00:00:00Z"},
        }
        serializer = GeoJSONFeatureCollectionSerializer(data=data)
        assert serializer.is_valid()

    def test_paginated_response_serializer(self):
        """Test PaginatedResponseSerializer."""
        from skyspy.serializers.common import PaginatedResponseSerializer

        data = {
            "count": 100,
            "next": "http://api/page=2",
            "previous": None,
            "results": [{"id": 1}, {"id": 2}],
        }
        serializer = PaginatedResponseSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# SYSTEM SERIALIZER TESTS (system.py)
# =============================================================================


class TestSystemSerializers:
    """Tests for system health and status serializers."""

    def test_service_health_serializer(self):
        """Test ServiceHealthSerializer."""
        from skyspy.serializers.system import ServiceHealthSerializer

        data = {"status": "up", "latency_ms": 5.2, "message": "Healthy"}
        serializer = ServiceHealthSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["status"] == "up"

    def test_health_response_serializer(self):
        """Test HealthResponseSerializer."""
        from skyspy.serializers.system import HealthResponseSerializer

        data = {
            "status": "healthy",
            "services": {
                "database": {"status": "up", "latency_ms": 2.0},
                "redis": {"status": "up", "latency_ms": 1.0},
            },
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = HealthResponseSerializer(data=data)
        assert serializer.is_valid()

    def test_status_response_serializer(self):
        """Test StatusResponseSerializer."""
        from skyspy.serializers.system import StatusResponseSerializer

        data = {
            "version": "1.0.0",
            "adsb_online": True,
            "aircraft_count": 50,
            "total_sightings": 10000,
            "total_sessions": 500,
            "active_rules": 10,
            "alert_history_count": 100,
            "safety_event_count": 5,
            "safety_monitoring_enabled": True,
            "safety_tracked_aircraft": 50,
            "notifications_configured": True,
            "redis_enabled": True,
            "websocket_connections": 3,
            "sse_subscribers": 2,
            "acars_enabled": True,
            "acars_running": True,
            "polling_interval_seconds": 1,
            "db_store_interval_seconds": 60,
            "celery_running": True,
            "celery_tasks": [],
            "worker_pid": 12345,
            "location": {"lat": 47.5, "lon": -122.0},
        }
        serializer = StatusResponseSerializer(data=data)
        assert serializer.is_valid()

    def test_sse_status_serializer(self):
        """Test SSEStatusSerializer."""
        from skyspy.serializers.system import SSEStatusSerializer

        data = {
            "mode": "redis",
            "redis_enabled": True,
            "subscribers": 10,
            "subscribers_local": 3,
            "tracked_aircraft": 50,
            "last_publish": "2024-01-01T00:00:00Z",
            "history": {"max_size": 100, "current_size": 50},
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = SSEStatusSerializer(data=data)
        assert serializer.is_valid()

    def test_api_info_serializer(self):
        """Test ApiInfoSerializer."""
        from skyspy.serializers.system import ApiInfoSerializer

        data = {
            "version": "1.0.0",
            "name": "SkySpy API",
            "description": "Aircraft tracking API",
            "endpoints": {"aircraft": "/api/v1/aircraft/"},
        }
        serializer = ApiInfoSerializer(data=data)
        assert serializer.is_valid()

    def test_config_serializer(self):
        """Test ConfigSerializer (system.py version)."""
        from skyspy.serializers.system import ConfigSerializer

        data = {
            "feeder_location": {"lat": 47.5, "lon": -122.0},
            "polling_interval": 1,
            "safety_thresholds": {"min_separation_nm": 3},
            "acars_enabled": True,
            "transcription_enabled": True,
        }
        serializer = ConfigSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# TASKS SERIALIZER TESTS (tasks.py)
# =============================================================================


class TestTasksSerializers:
    """Tests for Celery task serializers."""

    def test_task_status_serializer(self):
        """Test TaskStatusSerializer."""
        from skyspy.serializers.tasks import TaskStatusSerializer

        data = {
            "task_id": "abc123",
            "status": "SUCCESS",
            "result": {"processed": 100},
            "traceback": None,
            "date_done": "2024-01-01T00:00:00Z",
        }
        serializer = TaskStatusSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["task_id"] == "abc123"

    def test_task_submit_response_serializer(self):
        """Test TaskSubmitResponseSerializer."""
        from skyspy.serializers.tasks import TaskSubmitResponseSerializer

        data = {
            "task_id": "abc123",
            "status": "PENDING",
            "message": "Task queued for processing",
        }
        serializer = TaskSubmitResponseSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# SAFETY SERIALIZER TESTS (safety.py)
# =============================================================================


@pytest.mark.django_db
class TestSafetySerializers:
    """Tests for safety event serializers."""

    def test_safety_event_serializer_serialization(self):
        """Test SafetyEventSerializer model serialization."""
        from skyspy.serializers.safety import SafetyEventSerializer

        event = SafetyEventFactory()
        serializer = SafetyEventSerializer(event)
        data = serializer.data

        assert data["icao"] == event.icao_hex
        assert data["event_type"] == event.event_type
        assert data["severity"] == event.severity

    def test_safety_event_serializer_read_only_fields(self):
        """Test that icao and timestamp are read-only."""
        from skyspy.serializers.safety import SafetyEventSerializer

        event = SafetyEventFactory()
        serializer = SafetyEventSerializer(event)
        data = serializer.data

        # icao and timestamp are sourced from icao_hex and timestamp
        assert "icao" in data
        assert "timestamp" in data

    def test_safety_events_list_serializer(self):
        """Test SafetyEventsListSerializer."""
        from skyspy.serializers.safety import SafetyEventsListSerializer

        data = {
            "events": [
                {
                    "id": 1,
                    "event_type": "tcas_ra",
                    "severity": "critical",
                    "icao": "A12345",
                    "callsign": "UAL123",
                    "message": "TCAS RA",
                    "details": {},
                    "aircraft_snapshot": {},
                    "acknowledged": False,
                    "timestamp": "2024-01-01T00:00:00Z",
                }
            ],
            "count": 1,
        }
        serializer = SafetyEventsListSerializer(data=data)
        assert serializer.is_valid()

    def test_safety_stats_serializer(self):
        """Test SafetyStatsSerializer."""
        from skyspy.serializers.safety import SafetyStatsSerializer

        data = {
            "monitoring_enabled": True,
            "thresholds": {"min_separation_nm": 3},
            "time_range_hours": 24,
            "events_by_type": {"tcas_ra": 5},
            "events_by_severity": {"critical": 2},
            "events_by_type_severity": {},
            "total_events": 10,
            "unique_aircraft": 8,
            "event_rate_per_hour": 0.4,
            "events_by_hour": [],
            "top_aircraft": [],
            "recent_events": [],
            "monitor_state": {},
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = SafetyStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_aircraft_safety_stats_serializer(self):
        """Test AircraftSafetyStatsSerializer."""
        from skyspy.serializers.safety import AircraftSafetyStatsSerializer

        data = {
            "icao_hex": "A12345",
            "callsign": "UAL123",
            "total_events": 3,
            "events_by_type": {"tcas_ra": 2, "7700": 1},
            "events_by_severity": {"critical": 3},
            "worst_severity": "critical",
            "last_event_time": "2024-01-01T00:00:00Z",
            "last_event_type": "tcas_ra",
        }
        serializer = AircraftSafetyStatsSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# AUDIO SERIALIZER TESTS (audio.py)
# =============================================================================


@pytest.mark.django_db
class TestAudioSerializers:
    """Tests for audio transmission serializers."""

    def test_audio_transmission_serializer_serialization(self):
        """Test AudioTransmissionSerializer model serialization."""
        from skyspy.serializers.audio import AudioTransmissionSerializer

        transmission = AudioTransmissionFactory(completed=True)
        serializer = AudioTransmissionSerializer(transmission)
        data = serializer.data

        assert data["filename"] == transmission.filename
        assert data["transcription_status"] == "completed"
        assert data["transcript"] is not None

    def test_audio_transmission_create_serializer(self):
        """Test AudioTransmissionCreateSerializer validation."""
        from skyspy.serializers.audio import AudioTransmissionCreateSerializer

        data = {
            "frequency_mhz": 118.0,
            "channel_name": "SEA Tower",
            "duration_seconds": 5.5,
            "metadata": {"test": True},
        }
        serializer = AudioTransmissionCreateSerializer(data=data)
        assert serializer.is_valid()

    def test_audio_transmission_list_serializer(self):
        """Test AudioTransmissionListSerializer."""
        from skyspy.serializers.audio import AudioTransmissionListSerializer

        data = {
            "transmissions": [],
            "count": 0,
            "total": 0,
        }
        serializer = AudioTransmissionListSerializer(data=data)
        assert serializer.is_valid()

    def test_audio_upload_serializer(self):
        """Test AudioUploadSerializer."""
        from skyspy.serializers.audio import AudioUploadSerializer

        data = {
            "id": 1,
            "filename": "test.mp3",
            "s3_url": "https://s3.example.com/test.mp3",
            "transcription_queued": True,
            "message": "Upload successful",
        }
        serializer = AudioUploadSerializer(data=data)
        assert serializer.is_valid()

    def test_audio_stats_serializer(self):
        """Test AudioStatsSerializer."""
        from skyspy.serializers.audio import AudioStatsSerializer

        data = {
            "total_transmissions": 100,
            "total_transcribed": 80,
            "pending_transcription": 10,
            "failed_transcription": 5,
            "total_duration_hours": 2.5,
            "total_size_mb": 150.0,
            "by_channel": {"SEA Tower": 50},
            "by_status": {"completed": 80},
        }
        serializer = AudioStatsSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# AIRCRAFT SERIALIZER TESTS (aircraft.py)
# =============================================================================


@pytest.mark.django_db
class TestAircraftSerializers:
    """Tests for aircraft-related serializers."""

    def test_aircraft_serializer_deserialization(self):
        """Test AircraftSerializer deserialization."""
        from skyspy.serializers.aircraft import AircraftSerializer

        data = {
            "hex": "A12345",
            "flight": "UAL123",
            "type": "B738",
            "alt": 35000,
            "gs": 450.0,
            "vr": 500,
            "distance_nm": 15.5,
            "squawk": "4521",
            "category": "A3",
            "rssi": -25.0,
            "lat": 47.5,
            "lon": -122.0,
            "track": 270.0,
            "military": False,
            "emergency": False,
        }
        serializer = AircraftSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["icao_hex"] == "A12345"
        assert serializer.validated_data["callsign"] == "UAL123"

    def test_aircraft_list_serializer(self):
        """Test AircraftListSerializer."""
        from skyspy.serializers.aircraft import AircraftListSerializer

        data = {
            "aircraft": [{"hex": "A12345", "flight": "UAL123"}],
            "count": 1,
            "now": 1704067200.0,
            "messages": 12345,
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = AircraftListSerializer(data=data)
        assert serializer.is_valid()

    def test_top_aircraft_serializer(self):
        """Test TopAircraftSerializer."""
        from skyspy.serializers.aircraft import TopAircraftSerializer

        data = {
            "closest": [{"hex": "A12345", "distance_nm": 1.0}],
            "highest": [{"hex": "A12345", "alt": 45000}],
            "fastest": [{"hex": "A12345", "gs": 550}],
            "climbing": [{"hex": "A12345", "vr": 4000}],
            "military": [{"hex": "AE1234", "military": True}],
            "total": 50,
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = TopAircraftSerializer(data=data)
        assert serializer.is_valid()

    def test_aircraft_stats_serializer(self):
        """Test AircraftStatsSerializer."""
        from skyspy.serializers.aircraft import AircraftStatsSerializer

        data = {
            "total": 50,
            "with_position": 45,
            "military": 3,
            "emergency": [],
            "categories": {"A3": 30, "A5": 5},
            "altitude": {"FL350+": 20, "FL250-350": 15},
            "messages": 12345,
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = AircraftStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_aircraft_info_serializer_serialization(self):
        """Test AircraftInfoSerializer model serialization."""
        from skyspy.serializers.aircraft import AircraftInfoSerializer

        aircraft = AircraftInfoFactory()
        serializer = AircraftInfoSerializer(aircraft)
        data = serializer.data

        assert data["icao_hex"] == aircraft.icao_hex
        assert data["registration"] == aircraft.registration
        assert "age_years" in data

    def test_aircraft_info_serializer_age_calculation(self):
        """Test age_years calculation in AircraftInfoSerializer."""
        from skyspy.serializers.aircraft import AircraftInfoSerializer

        aircraft = AircraftInfoFactory(year_built=2010)
        serializer = AircraftInfoSerializer(aircraft)
        data = serializer.data

        current_year = datetime.now().year
        expected_age = current_year - 2010
        assert data["age_years"] == expected_age

    def test_aircraft_info_serializer_ownership_fields(self):
        """AircraftInfoSerializer exposes ownership analysis fields."""
        from skyspy.serializers.aircraft import AircraftInfoSerializer

        aircraft = AircraftInfoFactory(
            owner_type="llc",
            is_shell_suspected=True,
            shell_score=0.87,
            ownership_flags={"factors": ["po_box", "registered_agent"]},
        )
        data = AircraftInfoSerializer(aircraft).data

        assert data["owner_type"] == "llc"
        assert data["is_shell_suspected"] is True
        assert data["shell_score"] == 0.87
        assert data["ownership_flags"] == {"factors": ["po_box", "registered_agent"]}

    def test_aircraft_info_serializer_dossier_text_present(self):
        """dossier_text returns AirframeDocument.content when a document exists."""
        from skyspy.models import AirframeDocument
        from skyspy.serializers.aircraft import AircraftInfoSerializer

        aircraft = AircraftInfoFactory()
        AirframeDocument.objects.create(
            icao_hex=aircraft.icao_hex,
            content="Test dossier body.",
            content_hash="abc123",
        )
        data = AircraftInfoSerializer(aircraft).data

        assert data["dossier_text"] == "Test dossier body."

    def test_aircraft_info_serializer_dossier_text_missing(self):
        """dossier_text is None (no exception) when no AirframeDocument exists."""
        from skyspy.serializers.aircraft import AircraftInfoSerializer

        aircraft = AircraftInfoFactory()
        data = AircraftInfoSerializer(aircraft).data

        assert data["dossier_text"] is None

    def test_aircraft_photo_serializer(self):
        """Test AircraftPhotoSerializer."""
        from skyspy.serializers.aircraft import AircraftPhotoSerializer

        data = {
            "icao_hex": "A12345",
            "photo_url": "https://example.com/photo.jpg",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "photographer": "John Doe",
            "source": "planespotters",
        }
        serializer = AircraftPhotoSerializer(data=data)
        assert serializer.is_valid()

    def test_bulk_aircraft_info_serializer(self):
        """Test BulkAircraftInfoSerializer."""
        from skyspy.serializers.aircraft import BulkAircraftInfoSerializer

        data = {
            "aircraft": {"A12345": {"registration": "N12345"}},
            "found": 1,
            "requested": 1,
        }
        serializer = BulkAircraftInfoSerializer(data=data)
        assert serializer.is_valid()

    def test_aircraft_info_cache_stats_serializer(self):
        """Test AircraftInfoCacheStatsSerializer."""
        from skyspy.serializers.aircraft import AircraftInfoCacheStatsSerializer

        data = {
            "total_cached": 1000,
            "failed_lookups": 50,
            "with_photos": 800,
            "cache_duration_hours": 168,
            "retry_after_hours": 24,
        }
        serializer = AircraftInfoCacheStatsSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# ALERTS SERIALIZER TESTS (alerts.py)
# =============================================================================


@pytest.mark.django_db
class TestAlertsSerializers:
    """Tests for alert-related serializers."""

    def test_condition_serializer(self):
        """Test ConditionSerializer."""
        from skyspy.serializers.alerts import ConditionSerializer

        data = {"type": "altitude", "operator": "gt", "value": "10000"}
        serializer = ConditionSerializer(data=data)
        assert serializer.is_valid()

    def test_condition_serializer_default_operator(self):
        """Test ConditionSerializer default operator."""
        from skyspy.serializers.alerts import ConditionSerializer

        data = {"type": "icao", "value": "A12345"}
        serializer = ConditionSerializer(data=data)
        assert serializer.is_valid()
        assert serializer.validated_data["operator"] == "eq"

    def test_condition_group_serializer(self):
        """Test ConditionGroupSerializer."""
        from skyspy.serializers.alerts import ConditionGroupSerializer

        data = {
            "logic": "AND",
            "conditions": [
                {"type": "altitude", "operator": "gt", "value": "10000"},
                {"type": "military", "operator": "eq", "value": "true"},
            ],
        }
        serializer = ConditionGroupSerializer(data=data)
        assert serializer.is_valid()

    def test_complex_conditions_serializer(self):
        """Test ComplexConditionsSerializer."""
        from skyspy.serializers.alerts import ComplexConditionsSerializer

        data = {
            "logic": "OR",
            "groups": [
                {
                    "logic": "AND",
                    "conditions": [{"type": "altitude", "operator": "gt", "value": "35000"}],
                },
                {
                    "logic": "AND",
                    "conditions": [{"type": "military", "operator": "eq", "value": "true"}],
                },
            ],
        }
        serializer = ComplexConditionsSerializer(data=data)
        assert serializer.is_valid()

    def test_suppression_window_serializer_valid(self):
        """Test SuppressionWindowSerializer with valid data."""
        from skyspy.serializers.alerts import SuppressionWindowSerializer

        data = {"day": "monday", "start": "22:00", "end": "23:00"}
        serializer = SuppressionWindowSerializer(data=data)
        assert serializer.is_valid()

    def test_suppression_window_serializer_invalid_time_format(self):
        """Test SuppressionWindowSerializer rejects invalid time format."""
        from skyspy.serializers.alerts import SuppressionWindowSerializer

        data = {"day": "monday", "start": "25:00", "end": "08:00"}
        serializer = SuppressionWindowSerializer(data=data)
        assert not serializer.is_valid()
        assert "start" in str(serializer.errors)

    def test_suppression_window_serializer_end_before_start(self):
        """Test SuppressionWindowSerializer rejects end before start."""
        from skyspy.serializers.alerts import SuppressionWindowSerializer

        data = {"day": "monday", "start": "10:00", "end": "08:00"}
        serializer = SuppressionWindowSerializer(data=data)
        assert not serializer.is_valid()
        assert "end" in str(serializer.errors)

    def test_alert_rule_create_serializer_simple(self):
        """Test AlertRuleCreateSerializer with simple rule."""
        from skyspy.serializers.alerts import AlertRuleCreateSerializer

        data = {
            "name": "Test Alert",
            "type": "icao",
            "operator": "eq",
            "value": "A12345",
            "priority": "warning",
        }
        serializer = AlertRuleCreateSerializer(data=data)
        assert serializer.is_valid()

    def test_alert_rule_create_serializer_complex_conditions(self):
        """Test AlertRuleCreateSerializer with complex conditions."""
        from skyspy.serializers.alerts import AlertRuleCreateSerializer

        data = {
            "name": "Complex Alert",
            "conditions": {
                "logic": "AND",
                "groups": [
                    {
                        "logic": "OR",
                        "conditions": [{"type": "military", "operator": "eq", "value": "true"}],
                    }
                ],
            },
            "priority": "critical",
        }
        serializer = AlertRuleCreateSerializer(data=data)
        assert serializer.is_valid()

    def test_alert_rule_create_serializer_validates_dates(self):
        """Test AlertRuleCreateSerializer validates starts_at/expires_at."""
        from skyspy.serializers.alerts import AlertRuleCreateSerializer

        now = timezone.now()
        data = {
            "name": "Scheduled Alert",
            "type": "icao",
            "value": "A12345",
            "starts_at": (now + timedelta(days=1)).isoformat(),
            "expires_at": now.isoformat(),  # Before starts_at
        }
        serializer = AlertRuleCreateSerializer(data=data)
        assert not serializer.is_valid()
        assert "expires_at" in str(serializer.errors)

    def test_alert_rule_create_serializer_creates_rule(self, db):
        """Test AlertRuleCreateSerializer creates AlertRule."""
        from skyspy.serializers.alerts import AlertRuleCreateSerializer

        data = {
            "name": "Created Rule",
            "type": "squawk",
            "value": "7700",
            "priority": "critical",
        }
        serializer = AlertRuleCreateSerializer(data=data)
        assert serializer.is_valid()
        rule = serializer.save()
        assert rule.name == "Created Rule"
        assert rule.rule_type == "squawk"
        assert rule.value == "7700"

    def test_alert_rule_serializer_serialization(self, db):
        """Test AlertRuleSerializer model serialization."""
        from skyspy.serializers.alerts import AlertRuleSerializer

        rule = AlertRuleFactory()
        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = MagicMock(is_authenticated=False)

        serializer = AlertRuleSerializer(rule, context={"request": request})
        data = serializer.data

        assert data["id"] == rule.id
        assert data["name"] == rule.name
        assert data["type"] == rule.rule_type

    def test_alert_rule_serializer_is_owner(self, db):
        """Test AlertRuleSerializer is_owner field."""
        from skyspy.serializers.alerts import AlertRuleSerializer

        user = User.objects.create_user(username="testuser", password="testpass")
        rule = AlertRuleFactory(owner=user)

        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = user

        serializer = AlertRuleSerializer(rule, context={"request": request})
        data = serializer.data

        assert data["is_owner"] is True

    def test_alert_history_serializer_serialization(self, db):
        """Test AlertHistorySerializer model serialization."""
        from skyspy.serializers.alerts import AlertHistorySerializer

        history = AlertHistoryFactory()
        serializer = AlertHistorySerializer(history)
        data = serializer.data

        assert data["icao"] == history.icao_hex
        assert data["timestamp"] is not None

    def test_alert_rule_test_serializer(self):
        """Test AlertRuleTestSerializer."""
        from skyspy.serializers.alerts import AlertRuleTestSerializer

        data = {
            "rule": {"type": "altitude", "operator": "gt", "value": "35000"},
            "aircraft": [{"hex": "A12345", "alt": 36000}],
        }
        serializer = AlertRuleTestSerializer(data=data)
        assert serializer.is_valid()

    def test_bulk_rule_ids_serializer(self):
        """Test BulkRuleIdsSerializer."""
        from skyspy.serializers.alerts import BulkRuleIdsSerializer

        data = {"rule_ids": [1, 2, 3], "enabled": True}
        serializer = BulkRuleIdsSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# NOTIFICATIONS SERIALIZER TESTS (notifications.py)
# =============================================================================


@pytest.mark.django_db
class TestNotificationsSerializers:
    """Tests for notification-related serializers."""

    def test_notification_channel_serializer_serialization(self, db):
        """Test NotificationChannelSerializer model serialization."""
        from skyspy.serializers.notifications import NotificationChannelSerializer

        user = User.objects.create_user(username="testuser", password="testpass")
        channel = NotificationChannel.objects.create(
            name="Test Discord",
            channel_type="discord",
            apprise_url="discord://webhook_id/webhook_token",
            owner=user,
        )
        serializer = NotificationChannelSerializer(channel)
        data = serializer.data

        assert data["name"] == "Test Discord"
        assert data["channel_type"] == "discord"
        assert data["owner_username"] == "testuser"

    def test_notification_channel_create_serializer(self):
        """Test NotificationChannelCreateSerializer."""
        from skyspy.serializers.notifications import NotificationChannelCreateSerializer

        data = {
            "name": "Test Slack",
            "channel_type": "slack",
            "apprise_url": "slack://webhook_id/webhook_token",
            "description": "Test channel",
        }
        serializer = NotificationChannelCreateSerializer(data=data)
        assert serializer.is_valid()

    def test_notification_channel_create_serializer_invalid_type(self):
        """Test NotificationChannelCreateSerializer rejects invalid type."""
        from skyspy.serializers.notifications import NotificationChannelCreateSerializer

        data = {
            "name": "Test",
            "channel_type": "invalid_type",
            "apprise_url": "test://url",
        }
        serializer = NotificationChannelCreateSerializer(data=data)
        assert not serializer.is_valid()
        assert "channel_type" in serializer.errors

    def test_notification_channel_update_serializer(self, db):
        """Test NotificationChannelUpdateSerializer updates channel."""
        from skyspy.serializers.notifications import NotificationChannelUpdateSerializer

        channel = NotificationChannel.objects.create(
            name="Original",
            channel_type="discord",
            apprise_url="discord://old",
            verified=True,
        )

        data = {"name": "Updated", "apprise_url": "discord://new"}
        serializer = NotificationChannelUpdateSerializer(channel, data=data, partial=True)
        assert serializer.is_valid()
        updated = serializer.save()

        assert updated.name == "Updated"
        assert updated.verified is False  # Reset on URL change

    def test_notification_config_serializer(self, db):
        """Test NotificationConfigSerializer."""
        from skyspy.serializers.notifications import NotificationConfigSerializer

        config = NotificationConfigFactory()
        config.apprise_urls = "discord://url1;slack://url2"
        config.save()

        serializer = NotificationConfigSerializer(config)
        data = serializer.data

        assert data["enabled"] is True
        assert data["server_count"] == 2

    def test_notification_config_update_serializer(self, db):
        """Test NotificationConfigUpdateSerializer."""
        from skyspy.serializers.notifications import NotificationConfigUpdateSerializer

        config = NotificationConfigFactory()

        data = {"enabled": False, "cooldown_seconds": 600}
        serializer = NotificationConfigUpdateSerializer(config, data=data, partial=True)
        assert serializer.is_valid()
        updated = serializer.save()

        assert updated.enabled is False
        assert updated.cooldown_seconds == 600

    def test_notification_log_serializer(self, db):
        """Test NotificationLogSerializer."""
        from skyspy.serializers.notifications import NotificationLogSerializer

        log = NotificationLogFactory()
        serializer = NotificationLogSerializer(log)
        data = serializer.data

        assert data["icao_hex"] == log.icao_hex
        assert data["notification_type"] == log.notification_type

    def test_notification_test_serializer(self):
        """Test NotificationTestSerializer."""
        from skyspy.serializers.notifications import NotificationTestSerializer

        data = {
            "success": True,
            "message": "Test notification sent",
            "servers_notified": 2,
        }
        serializer = NotificationTestSerializer(data=data)
        assert serializer.is_valid()

    def test_channel_type_info_serializer(self):
        """Test ChannelTypeInfoSerializer."""
        from skyspy.serializers.notifications import ChannelTypeInfoSerializer

        data = {
            "type": "discord",
            "name": "Discord",
            "schema": "discord://webhook_id/webhook_token",
            "description": "Discord webhook notifications",
            "supports_rich": True,
            "required_fields": ["webhook_id", "webhook_token"],
        }
        serializer = ChannelTypeInfoSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# ACARS SERIALIZER TESTS (acars.py)
# =============================================================================


@pytest.mark.django_db
class TestAcarsSerializers:
    """Tests for ACARS-related serializers."""

    def test_acars_airline_info_serializer(self):
        """Test AcarsAirlineInfoSerializer."""
        from skyspy.serializers.acars import AcarsAirlineInfoSerializer

        data = {
            "icao": "UAL",
            "iata": "UA",
            "name": "United Airlines",
            "flight_number": "123",
        }
        serializer = AcarsAirlineInfoSerializer(data=data)
        assert serializer.is_valid()

    def test_acars_message_serializer_serialization(self, db):
        """Test AcarsMessageSerializer model serialization."""
        from skyspy.serializers.acars import AcarsMessageSerializer

        message = AcarsMessageFactory()
        serializer = AcarsMessageSerializer(message)
        data = serializer.data

        assert data["icao_hex"] == message.icao_hex
        assert data["label"] == message.label
        assert data["source"] == message.source

    def test_acars_messages_list_serializer(self):
        """Test AcarsMessagesListSerializer."""
        from skyspy.serializers.acars import AcarsMessagesListSerializer

        data = {
            "messages": [],
            "count": 0,
            "filters": {"hours": 24},
        }
        serializer = AcarsMessagesListSerializer(data=data)
        assert serializer.is_valid()

    def test_acars_stats_serializer(self):
        """Test AcarsStatsSerializer."""
        from skyspy.serializers.acars import AcarsStatsSerializer

        data = {
            "total_messages": 1000,
            "last_hour": 50,
            "last_24h": 800,
            "by_source": {"acars": 600, "vdlm2": 400},
            "top_labels": [{"label": "Q0", "count": 200}],
            "service_stats": {"running": True},
        }
        serializer = AcarsStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_acars_message_stats_serializer(self):
        """Test AcarsMessageStatsSerializer."""
        from skyspy.serializers.acars import AcarsMessageStatsSerializer

        data = {
            "total_messages": 500,
            "time_range_hours": 24,
            "by_source": {"acars": 300},
            "by_label": [],
            "by_category": [],
            "top_frequencies": [],
            "messages_with_content": 400,
            "content_percentage": 80.0,
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = AcarsMessageStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_acars_trends_serializer(self):
        """Test AcarsTrendsSerializer."""
        from skyspy.serializers.acars import AcarsTrendsSerializer

        data = {
            "intervals": [],
            "interval_type": "hour",
            "time_range_hours": 24,
            "total_messages": 500,
            "peak_interval": {"timestamp": None, "count": 0},
            "hourly_distribution": [],
            "peak_hour": None,
            "quietest_hour": None,
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = AcarsTrendsSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# HISTORY SERIALIZER TESTS (history.py)
# =============================================================================


@pytest.mark.django_db
class TestHistorySerializers:
    """Tests for history-related serializers."""

    def test_sighting_serializer_serialization(self, db):
        """Test SightingSerializer model serialization."""
        from skyspy.serializers.history import SightingSerializer

        sighting = AircraftSightingFactory()
        serializer = SightingSerializer(sighting)
        data = serializer.data

        assert data["icao_hex"] == sighting.icao_hex
        assert data["lat"] == sighting.latitude
        assert data["lon"] == sighting.longitude

    def test_sighting_serializer_emergency_and_track(self, db):
        """SightingSerializer exposes is_emergency and track fields."""
        from skyspy.serializers.history import SightingSerializer

        sighting = AircraftSightingFactory(is_emergency=True, track=142.5)
        data = SightingSerializer(sighting).data

        assert data["is_emergency"] is True
        assert data["track"] == 142.5

    def test_session_serializer_serialization(self, db):
        """Test SessionSerializer model serialization."""
        from skyspy.serializers.history import SessionSerializer

        session = AircraftSessionFactory()
        serializer = SessionSerializer(session)
        data = serializer.data

        assert data["icao_hex"] == session.icao_hex
        assert "duration_min" in data
        assert data["positions"] == session.total_positions

    def test_session_serializer_duration_calculation(self, db):
        """Test SessionSerializer duration_min calculation."""
        from skyspy.serializers.history import SessionSerializer

        session = AircraftSessionFactory()
        # The model has auto_now on last_seen, so we calculate expected based on actual values
        if session.first_seen and session.last_seen:
            expected_minutes = round((session.last_seen - session.first_seen).total_seconds() / 60, 1)
        else:
            expected_minutes = 0.0

        serializer = SessionSerializer(session)
        data = serializer.data

        assert data["duration_min"] == expected_minutes

    def test_history_stats_serializer(self):
        """Test HistoryStatsSerializer."""
        from skyspy.serializers.history import HistoryStatsSerializer

        data = {
            "total_sightings": 10000,
            "total_sessions": 500,
            "unique_aircraft": 300,
            "military_sessions": 25,
            "time_range_hours": 24,
            "avg_altitude": 28000,
            "max_altitude": 45000,
        }
        serializer = HistoryStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_trends_serializer(self):
        """Test TrendsSerializer."""
        from skyspy.serializers.history import TrendsSerializer

        data = {
            "intervals": [],
            "interval_type": "hour",
            "time_range_hours": 24,
            "summary": {
                "total_unique_aircraft": 100,
                "peak_concurrent": 50,
                "peak_interval": "2024-01-01T12:00:00Z",
                "total_intervals": 24,
            },
        }
        serializer = TrendsSerializer(data=data)
        assert serializer.is_valid()

    def test_top_performers_serializer(self):
        """Test TopPerformersSerializer."""
        from skyspy.serializers.history import TopPerformersSerializer

        data = {
            "longest_tracked": [],
            "furthest_distance": [],
            "highest_altitude": [],
            "most_positions": [],
            "closest_approach": [],
            "time_range_hours": 24,
            "limit": 10,
        }
        serializer = TopPerformersSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# AVIATION SERIALIZER TESTS (aviation.py)
# =============================================================================


@pytest.mark.django_db
class TestAviationSerializers:
    """Tests for aviation data serializers."""

    def test_cached_airport_serializer(self, db):
        """Test CachedAirportSerializer."""
        from skyspy.models import CachedAirport
        from skyspy.serializers.aviation import CachedAirportSerializer

        airport = CachedAirport.objects.create(
            icao_id="KSEA",
            name="Seattle-Tacoma International",
            latitude=47.449,
            longitude=-122.309,
            elevation_ft=433,
            airport_type="large_airport",
            country="US",
        )
        serializer = CachedAirportSerializer(airport)
        data = serializer.data

        assert data["icao_id"] == "KSEA"
        assert data["lat"] == 47.449
        assert data["lon"] == -122.309

    def test_cached_navaid_serializer(self, db):
        """Test CachedNavaidSerializer."""
        from skyspy.models import CachedNavaid
        from skyspy.serializers.aviation import CachedNavaidSerializer

        navaid = CachedNavaid.objects.create(
            ident="SEA",
            name="Seattle",
            navaid_type="VOR",
            latitude=47.435,
            longitude=-122.309,
            frequency=116.8,
        )
        serializer = CachedNavaidSerializer(navaid)
        data = serializer.data

        assert data["ident"] == "SEA"
        assert data["lat"] == 47.435

    def test_aviation_data_serializer(self):
        """Test AviationDataSerializer."""
        from skyspy.serializers.aviation import AviationDataSerializer

        data = {
            "data": [{"icao": "KSEA", "name": "Seattle"}],
            "count": 1,
            "source": "aviationweather.gov",
            "cached": True,
            "cache_age_seconds": 300,
        }
        serializer = AviationDataSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# NOTAMS SERIALIZER TESTS (notams.py)
# =============================================================================


@pytest.mark.django_db
class TestNotamsSerializers:
    """Tests for NOTAM-related serializers."""

    def test_cached_notam_serializer(self, db):
        """Test CachedNotamSerializer."""
        from skyspy.models import CachedNotam
        from skyspy.serializers.notams import CachedNotamSerializer

        notam = CachedNotam.objects.create(
            notam_id="A1234/24",
            notam_type="TFR",
            location="KSEA",
            latitude=47.449,
            longitude=-122.309,
            effective_start=timezone.now(),
            text="TFR for VIP movement",
        )
        serializer = CachedNotamSerializer(notam)
        data = serializer.data

        assert data["notam_id"] == "A1234/24"
        assert data["is_active"] is True

    def test_notam_response_serializer(self):
        """Test NotamResponseSerializer."""
        from skyspy.serializers.notams import NotamResponseSerializer

        data = {
            "notam_id": "A1234/24",
            "notam_type": "TFR",
            "location": "KSEA",
            "effective_start": "2024-01-01T00:00:00Z",
            "is_permanent": False,
            "text": "TFR text",
            "is_active": True,
            "is_tfr": True,
        }
        serializer = NotamResponseSerializer(data=data)
        assert serializer.is_valid()

    def test_notam_stats_serializer(self):
        """Test NotamStatsSerializer."""
        from skyspy.serializers.notams import NotamStatsSerializer

        data = {
            "total_notams": 100,
            "active_notams": 50,
            "active_tfrs": 10,
            "by_type": {"TFR": 10, "D": 40},
            "refresh_interval_minutes": 60,
        }
        serializer = NotamStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_cached_airline_serializer(self, db):
        """Test CachedAirlineSerializer."""
        from skyspy.models import CachedAirline
        from skyspy.serializers.notams import CachedAirlineSerializer

        airline = CachedAirline.objects.create(
            icao_code="UAL",
            iata_code="UA",
            name="United Airlines",
            callsign="UNITED",
            country="US",
            active=True,
        )
        serializer = CachedAirlineSerializer(airline)
        data = serializer.data

        assert data["icao_code"] == "UAL"
        assert data["name"] == "United Airlines"


# =============================================================================
# CONFIG SERIALIZER TESTS (config.py)
# =============================================================================


@pytest.mark.django_db
class TestConfigSerializers:
    """Tests for system configuration serializers."""

    def test_config_update_serializer(self):
        """Test ConfigUpdateSerializer."""
        from skyspy.serializers.config import ConfigUpdateSerializer

        data = {"value": "new_value"}
        serializer = ConfigUpdateSerializer(data=data)
        assert serializer.is_valid()

    def test_config_bulk_update_serializer(self, db):
        """Test ConfigBulkUpdateSerializer validation."""
        from skyspy.serializers.config import ConfigBulkUpdateSerializer

        # Without existing configs, this will fail validation
        data = {"updates": {"nonexistent_key": "value"}}
        serializer = ConfigBulkUpdateSerializer(data=data)
        assert not serializer.is_valid()

    def test_config_reset_serializer(self):
        """Test ConfigResetSerializer."""
        from skyspy.serializers.config import ConfigResetSerializer

        data = {"keys": ["key1", "key2"]}
        serializer = ConfigResetSerializer(data=data)
        assert serializer.is_valid()

    def test_config_export_serializer(self):
        """Test ConfigExportSerializer."""
        from skyspy.serializers.config import ConfigExportSerializer

        data = {
            "configs": {"key1": "value1"},
            "exported_at": "2024-01-01T00:00:00Z",
            "version": "1.0",
        }
        serializer = ConfigExportSerializer(data=data)
        assert serializer.is_valid()

    def test_config_import_serializer(self):
        """Test ConfigImportSerializer."""
        from skyspy.serializers.config import ConfigImportSerializer

        data = {
            "configs": {"key1": "value1"},
            "skip_readonly": True,
            "dry_run": False,
        }
        serializer = ConfigImportSerializer(data=data)
        assert serializer.is_valid()

    def test_config_validate_serializer(self):
        """Test ConfigValidateSerializer."""
        from skyspy.serializers.config import ConfigValidateSerializer

        data = {"key": "test_key", "value": "test_value"}
        serializer = ConfigValidateSerializer(data=data)
        assert serializer.is_valid()

    def test_config_validate_response_serializer(self):
        """Test ConfigValidateResponseSerializer."""
        from skyspy.serializers.config import ConfigValidateResponseSerializer

        data = {"valid": True, "errors": []}
        serializer = ConfigValidateResponseSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# STATS SERIALIZER TESTS (stats.py)
# =============================================================================


@pytest.mark.django_db
class TestStatsSerializers:
    """Tests for gamification and stats serializers."""

    def test_personal_record_serializer(self, db):
        """Test PersonalRecordSerializer model serialization."""
        from skyspy.models import PersonalRecord
        from skyspy.serializers.stats import PersonalRecordSerializer

        record = PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="A12345",
            callsign="UAL123",
            value=250.0,
            achieved_at=timezone.now(),
        )
        serializer = PersonalRecordSerializer(record)
        data = serializer.data

        assert data["record_type"] == "max_distance"
        assert data["value"] == 250.0
        assert "record_type_display" in data

    def test_rare_sighting_serializer(self, db):
        """Test RareSightingSerializer model serialization."""
        from skyspy.models import RareSighting
        from skyspy.serializers.stats import RareSightingSerializer

        sighting = RareSighting.objects.create(
            rarity_type="military",
            icao_hex="AE1234",
            callsign="RCH123",
            sighted_at=timezone.now(),
            description="C-17 military transport",
            rarity_score=8,
        )
        serializer = RareSightingSerializer(sighting)
        data = serializer.data

        assert data["rarity_type"] == "military"
        assert data["rarity_score"] == 8

    def test_spotted_aircraft_serializer(self, db):
        """Test SpottedAircraftSerializer model serialization."""
        from skyspy.models import SpottedAircraft
        from skyspy.serializers.stats import SpottedAircraftSerializer

        spotted = SpottedAircraft.objects.create(
            icao_hex="A12345",
            registration="N12345",
            aircraft_type="B738",
            first_seen=timezone.now() - timedelta(days=30),
            last_seen=timezone.now(),
            times_seen=10,
        )
        serializer = SpottedAircraftSerializer(spotted)
        data = serializer.data

        assert data["icao_hex"] == "A12345"
        assert data["times_seen"] == 10

    def test_daily_stats_serializer(self, db):
        """Test DailyStatsSerializer model serialization."""
        from skyspy.models import DailyStats
        from skyspy.serializers.stats import DailyStatsSerializer

        stats = DailyStats.objects.create(
            date=timezone.now().date(),
            unique_aircraft=100,
            new_aircraft=5,
            total_sessions=80,
            total_positions=5000,
            military_count=3,
            aircraft_types={"B738": 30, "A320": 25},
            operators={"UAL": 20, "DAL": 15},
        )
        serializer = DailyStatsSerializer(stats)
        data = serializer.data

        assert data["unique_aircraft"] == 100
        assert "top_types" in data
        assert "top_operators" in data

    def test_collection_stats_response_serializer(self):
        """Test CollectionStatsResponseSerializer."""
        from skyspy.serializers.stats import CollectionStatsResponseSerializer

        data = {
            "total_unique_aircraft": 500,
            "military_aircraft": 25,
            "unique_types": 50,
            "unique_operators": 100,
            "unique_countries": 30,
            "first_aircraft": None,
            "last_aircraft": None,
            "most_seen": [],
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = CollectionStatsResponseSerializer(data=data)
        assert serializer.is_valid()

    def test_lifetime_stats_response_serializer(self):
        """Test LifetimeStatsResponseSerializer."""
        from skyspy.serializers.stats import LifetimeStatsResponseSerializer

        data = {
            "total_unique_aircraft": 1000,
            "total_sessions": 5000,
            "total_positions": 500000,
            "unique_aircraft_types": 100,
            "unique_operators": 200,
            "unique_countries": 50,
            "active_tracking_days": 365,
            "total_rare_sightings": 50,
            "all_time_records": {},
            "first_sighting": None,
            "timestamp": "2024-01-01T00:00:00Z",
        }
        serializer = LifetimeStatsResponseSerializer(data=data)
        assert serializer.is_valid()


# =============================================================================
# CANNONBALL SERIALIZER TESTS (cannonball.py)
# =============================================================================


@pytest.mark.django_db
class TestCannonballSerializers:
    """Tests for Cannonball mode serializers."""

    def test_cannonball_pattern_serializer(self, db):
        """Test CannonballPatternSerializer model serialization."""
        from skyspy.models import CannonballPattern
        from skyspy.serializers.cannonball import CannonballPatternSerializer

        pattern = CannonballPattern.objects.create(
            icao_hex="A12345",
            callsign="N123PD",
            pattern_type="circling",
            confidence="high",
            confidence_score=0.95,
            center_lat=47.5,
            center_lon=-122.0,
            radius_nm=2.0,
            started_at=timezone.now() - timedelta(minutes=30),
        )
        serializer = CannonballPatternSerializer(pattern)
        data = serializer.data

        assert data["pattern_type"] == "circling"
        assert data["confidence"] == "high"
        assert data["is_active"] is True

    def test_cannonball_session_serializer(self, db):
        """Test CannonballSessionSerializer model serialization."""
        from skyspy.models import CannonballSession
        from skyspy.serializers.cannonball import CannonballSessionSerializer

        session = CannonballSession.objects.create(
            icao_hex="A12345",
            callsign="N123PD",
            identification_method="callsign",
            operator_name="Police Department",
            threat_level="warning",
            urgency_score=75.0,
            is_active=True,
            first_seen=timezone.now() - timedelta(hours=1),
            last_seen=timezone.now(),
        )
        serializer = CannonballSessionSerializer(session)
        data = serializer.data

        assert data["icao_hex"] == "A12345"
        assert data["threat_level"] == "warning"

    def test_cannonball_alert_serializer(self, db):
        """Test CannonballAlertSerializer model serialization."""
        from skyspy.models import CannonballAlert, CannonballSession
        from skyspy.serializers.cannonball import CannonballAlertSerializer

        session = CannonballSession.objects.create(
            icao_hex="A12345",
            callsign="N123PD",
            first_seen=timezone.now(),
            last_seen=timezone.now(),
        )
        alert = CannonballAlert.objects.create(
            session=session,
            alert_type="proximity",
            priority="warning",
            title="LE Aircraft Nearby",
            message="Police helicopter within 2nm",
            distance_nm=1.5,
        )
        serializer = CannonballAlertSerializer(alert)
        data = serializer.data

        assert data["alert_type"] == "proximity"
        assert data["session_icao"] == "A12345"

    def test_cannonball_threat_serializer(self):
        """Test CannonballThreatSerializer."""
        from skyspy.serializers.cannonball import CannonballThreatSerializer

        data = {
            "icao_hex": "A12345",
            "callsign": "N123PD",
            "lat": 47.5,
            "lon": -122.0,
            "altitude": 2500,
            "ground_speed": 80,
            "track": 270,
            "distance_nm": 2.0,
            "bearing": 45.0,
            "closing_speed": 50.0,
            "threat_level": "warning",
            "urgency_score": 75.0,
            "is_known_le": True,
            "identification_method": "callsign",
            "identification_reason": "Matches PD callsign pattern",
            "operator_name": "Police Department",
            "agency_name": "Seattle PD",
            "agency_type": "local",
            "patterns": [],
        }
        serializer = CannonballThreatSerializer(data=data)
        assert serializer.is_valid()

    def test_cannonball_location_update_serializer(self):
        """Test CannonballLocationUpdateSerializer validation."""
        from skyspy.serializers.cannonball import CannonballLocationUpdateSerializer

        data = {"lat": 47.5, "lon": -122.0, "heading": 270.0, "speed": 60.0}
        serializer = CannonballLocationUpdateSerializer(data=data)
        assert serializer.is_valid()

    def test_cannonball_location_update_invalid_lat(self):
        """Test CannonballLocationUpdateSerializer rejects invalid lat."""
        from skyspy.serializers.cannonball import CannonballLocationUpdateSerializer

        data = {"lat": 95.0, "lon": -122.0}  # Invalid latitude
        serializer = CannonballLocationUpdateSerializer(data=data)
        assert not serializer.is_valid()

    def test_cannonball_settings_serializer(self):
        """Test CannonballSettingsSerializer."""
        from skyspy.serializers.cannonball import CannonballSettingsSerializer

        data = {
            "max_range_nm": 20.0,
            "alert_distance_nm": 3.0,
            "voice_enabled": True,
            "show_all_aircraft": False,
            "patterns_enabled": ["circling", "loitering"],
        }
        serializer = CannonballSettingsSerializer(data=data)
        assert serializer.is_valid()

    def test_cannonball_settings_invalid_range(self):
        """Test CannonballSettingsSerializer rejects invalid range."""
        from skyspy.serializers.cannonball import CannonballSettingsSerializer

        data = {"max_range_nm": 150.0}  # Exceeds max of 100
        serializer = CannonballSettingsSerializer(data=data)
        assert not serializer.is_valid()


# =============================================================================
# TIME COMPARISON SERIALIZER TESTS (time_comparison.py)
# =============================================================================


class TestTimeComparisonSerializers:
    """Tests for time comparison statistics serializers."""

    def test_week_stats_serializer(self):
        """Test WeekStatsSerializer."""
        from skyspy.serializers.time_comparison import WeekStatsSerializer

        data = {
            "total_positions": 10000,
            "unique_aircraft": 500,
            "total_sessions": 400,
            "military_aircraft": 25,
            "military_positions": 500,
            "military_sessions": 20,
            "avg_altitude": 28000,
            "avg_distance_nm": 50.0,
            "start": "2024-01-01T00:00:00Z",
            "end": "2024-01-07T23:59:59Z",
        }
        serializer = WeekStatsSerializer(data=data)
        assert serializer.is_valid()

    def test_week_comparison_serializer(self):
        """Test WeekComparisonSerializer."""
        from skyspy.serializers.time_comparison import WeekComparisonSerializer

        data = {
            "this_week": {
                "total_positions": 10000,
                "unique_aircraft": 500,
                "total_sessions": 400,
                "military_aircraft": 25,
                "military_positions": 500,
                "military_sessions": 20,
                "avg_altitude": 28000,
                "avg_distance_nm": 50.0,
                "start": "2024-01-08T00:00:00Z",
                "end": "2024-01-14T23:59:59Z",
            },
            "last_week": {
                "total_positions": 9000,
                "unique_aircraft": 450,
                "total_sessions": 350,
                "military_aircraft": 20,
                "military_positions": 400,
                "military_sessions": 15,
                "avg_altitude": 27000,
                "avg_distance_nm": 48.0,
                "start": "2024-01-01T00:00:00Z",
                "end": "2024-01-07T23:59:59Z",
            },
            "changes": {
                "total_positions": {"absolute": 1000, "percentage": 11.1},
                "unique_aircraft": {"absolute": 50, "percentage": 11.1},
                "total_sessions": {"absolute": 50, "percentage": 14.3},
                "military_aircraft": {"absolute": 5, "percentage": 25.0},
            },
            "timestamp": "2024-01-15T00:00:00Z",
        }
        serializer = WeekComparisonSerializer(data=data)
        assert serializer.is_valid()

    def test_day_night_ratio_serializer(self):
        """Test DayNightRatioSerializer."""
        from skyspy.serializers.time_comparison import DayNightRatioSerializer

        data = {
            "day": {
                "hours": "06:00-18:00",
                "start_hour": 6,
                "end_hour": 18,
                "total_positions": 8000,
                "unique_aircraft": 400,
                "military_positions": 200,
                "percentage": 80.0,
            },
            "night": {
                "hours": "18:00-06:00",
                "start_hour": 18,
                "end_hour": 6,
                "total_positions": 2000,
                "unique_aircraft": 100,
                "military_positions": 50,
                "percentage": 20.0,
            },
            "ratio": {"day_to_night": 4.0, "description": "4x more traffic during day"},
            "hourly_breakdown": [],
            "days_analyzed": 7,
            "timestamp": "2024-01-15T00:00:00Z",
        }
        serializer = DayNightRatioSerializer(data=data)
        assert serializer.is_valid()

    def test_daily_totals_serializer(self):
        """Test DailyTotalsSerializer."""
        from skyspy.serializers.time_comparison import DailyTotalsSerializer

        data = {
            "daily_data": [],
            "summary": {
                "days_included": 30,
                "total_positions": 300000,
                "avg_daily_positions": 10000,
                "peak_day": "2024-01-15",
                "peak_positions": 15000,
                "lowest_day": "2024-01-01",
                "lowest_positions": 5000,
            },
            "days_requested": 30,
            "timestamp": "2024-02-01T00:00:00Z",
        }
        serializer = DailyTotalsSerializer(data=data)
        assert serializer.is_valid()

    def test_monthly_totals_serializer(self):
        """Test MonthlyTotalsSerializer."""
        from skyspy.serializers.time_comparison import MonthlyTotalsSerializer

        data = {
            "monthly_data": [],
            "summary": {
                "months_included": 12,
                "total_positions": 3000000,
                "avg_monthly_positions": 250000,
                "peak_month": "2024-07",
                "peak_positions": 350000,
                "lowest_month": "2024-01",
                "lowest_positions": 150000,
            },
            "months_requested": 12,
            "timestamp": "2024-12-31T00:00:00Z",
        }
        serializer = MonthlyTotalsSerializer(data=data)
        assert serializer.is_valid()
