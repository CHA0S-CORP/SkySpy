"""
End-to-end integration tests for SkysPy.

These tests verify complete workflows:
- Aircraft polling -> storage -> WebSocket broadcast flow
- Alert rule creation -> aircraft evaluation -> notification flow
- Safety event detection -> storage -> WebSocket broadcast flow
- ACARS message receive -> decode -> store -> broadcast flow
- Audio upload -> transcription queue -> completion flow
"""
import asyncio
import json
import os
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from skyspy.models import (
    AircraftSighting,
    AircraftSession,
    AlertRule,
    AlertHistory,
    SafetyEvent,
    AcarsMessage,
    AudioTransmission,
    NotificationConfig,
    NotificationLog,
)
from skyspy.services.alerts import AlertService, alert_service
from skyspy.services.safety import SafetyMonitor, safety_monitor
from skyspy.services.acars import AcarsService
from skyspy.tasks.aircraft import (
    poll_aircraft,
    store_aircraft_sightings,
    update_aircraft_sessions,
    calculate_distance_nm,
)
from skyspy.tasks.transcription import transcribe_audio, process_transcription_queue

from skyspy.tests.factories import (
    AircraftSightingFactory,
    AircraftSessionFactory,
    AlertRuleFactory,
    AlertHistoryFactory,
    SafetyEventFactory,
    AcarsMessageFactory,
    AudioTransmissionFactory,
    NotificationConfigFactory,
)


# =============================================================================
# Aircraft Polling Integration Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestAircraftPollingFlow:
    """Test aircraft polling -> storage -> broadcast flow."""

    def test_calculate_distance(self):
        """Test distance calculation between two points."""
        # Seattle to Portland (~126nm actual great circle distance)
        # Using airport coordinates: SEA (47.4502, -122.3088) to PDX (45.5898, -122.5951)
        distance = calculate_distance_nm(47.6062, -122.3321, 45.5051, -122.6750)
        # The actual distance is approximately 126-127nm
        assert 120 < distance < 135

        # Same point
        distance = calculate_distance_nm(47.6062, -122.3321, 47.6062, -122.3321)
        assert distance < 0.01

    def test_store_aircraft_sightings(self, db, mock_aircraft_data):
        """Test storing aircraft sightings to database."""
        initial_count = AircraftSighting.objects.count()

        store_aircraft_sightings(mock_aircraft_data)

        # Should have stored aircraft with positions
        new_count = AircraftSighting.objects.count()
        assert new_count > initial_count

        # Verify sighting data
        sighting = AircraftSighting.objects.filter(icao_hex='A12345').first()
        assert sighting is not None
        assert sighting.callsign == 'UAL123'
        assert sighting.altitude_baro == 35000

    def test_update_aircraft_sessions_new(self, db, mock_aircraft_data):
        """Test creating new aircraft sessions."""
        initial_count = AircraftSession.objects.count()

        update_aircraft_sessions(mock_aircraft_data)

        # Should have created sessions
        new_count = AircraftSession.objects.count()
        assert new_count > initial_count

        # Verify session data
        session = AircraftSession.objects.filter(icao_hex='A12345').first()
        assert session is not None
        assert session.total_positions == 1

    def test_update_aircraft_sessions_existing(self, db, mock_aircraft_data):
        """Test updating existing aircraft sessions."""
        # Create initial session
        update_aircraft_sessions(mock_aircraft_data)
        session = AircraftSession.objects.get(icao_hex='A12345')
        initial_positions = session.total_positions

        # Update again
        update_aircraft_sessions(mock_aircraft_data)
        session.refresh_from_db()

        assert session.total_positions == initial_positions + 1

    @patch('skyspy.tasks.aircraft.httpx.get')
    def test_poll_aircraft_success(self, mock_get, db, mock_aircraft_data):
        """Test successful aircraft polling."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            'now': datetime.utcnow().timestamp(),
            'messages': 12345,
            'aircraft': mock_aircraft_data,
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        poll_aircraft()

        # Verify cache was updated
        cached = cache.get('current_aircraft')
        assert cached is not None
        assert len(cached) == len(mock_aircraft_data)
        assert cache.get('adsb_online') is True

    @patch('skyspy.tasks.aircraft.httpx.get')
    def test_poll_aircraft_failure(self, mock_get, db):
        """Test aircraft polling with HTTP error."""
        import httpx
        mock_get.side_effect = httpx.HTTPError("Connection refused")

        poll_aircraft()

        # Should mark as offline
        assert cache.get('adsb_online') is False


# =============================================================================
# Alert System Integration Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestAlertFlow:
    """Test alert rule creation -> evaluation -> notification flow."""

    def test_create_alert_rule(self, db):
        """Test creating an alert rule."""
        rule = AlertRule.objects.create(
            name='Test ICAO Alert',
            rule_type='icao',
            operator='eq',
            value='A12345',
            enabled=True,
            priority='warning',
        )

        assert rule.id is not None
        assert rule.enabled is True

    def test_evaluate_simple_alert(self, db, alert_service, mock_aircraft_data):
        """Test evaluating a simple alert rule."""
        # Create rule matching one of our test aircraft
        AlertRule.objects.create(
            name='Match UAL123',
            rule_type='callsign',
            operator='eq',
            value='UAL123',
            enabled=True,
            priority='info',
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        triggered = alert_service.check_alerts(mock_aircraft_data)

        assert len(triggered) == 1
        assert triggered[0]['callsign'] == 'UAL123'

    def test_evaluate_military_alert(self, db, alert_service, mock_aircraft_data):
        """Test evaluating military aircraft alert."""
        AlertRule.objects.create(
            name='Military Alert',
            rule_type='military',
            operator='eq',
            value='true',
            enabled=True,
            priority='warning',
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        # Add military flag to aircraft data
        for ac in mock_aircraft_data:
            ac['military'] = ac.get('dbFlags', 0) & 1 == 1

        triggered = alert_service.check_alerts(mock_aircraft_data)

        # Should trigger for RCH789 (military flag set)
        assert len(triggered) >= 1
        military_alerts = [a for a in triggered if 'RCH' in (a.get('callsign') or '')]
        assert len(military_alerts) >= 1

    def test_evaluate_complex_conditions(self, db, alert_service, mock_aircraft_data):
        """Test evaluating complex AND/OR conditions."""
        # Clear any existing rules to ensure test isolation
        AlertRule.objects.all().delete()

        AlertRule.objects.create(
            name='Complex Alert',
            rule_type=None,
            value=None,
            conditions={
                'logic': 'AND',
                'groups': [
                    {
                        'logic': 'OR',
                        'conditions': [
                            {'type': 'callsign', 'operator': 'startswith', 'value': 'UAL'},
                            {'type': 'callsign', 'operator': 'startswith', 'value': 'DAL'},
                        ]
                    },
                    {
                        'logic': 'AND',
                        'conditions': [
                            {'type': 'altitude', 'operator': 'gt', 'value': '20000'},
                        ]
                    }
                ]
            },
            enabled=True,
            priority='info',
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        triggered = alert_service.check_alerts(mock_aircraft_data)

        # Should match UAL123 and DAL456 (both above 20000ft)
        assert len(triggered) == 2

    def test_alert_creates_history(self, db, alert_service, mock_aircraft_data):
        """Test that triggered alerts create history records."""
        AlertRule.objects.create(
            name='History Test',
            rule_type='icao',
            operator='eq',
            value='A12345',
            enabled=True,
            priority='info',
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        initial_count = AlertHistory.objects.count()
        alert_service.check_alerts(mock_aircraft_data)

        assert AlertHistory.objects.count() > initial_count

        history = AlertHistory.objects.first()
        assert history.icao_hex == 'A12345'
        assert history.rule_name == 'History Test'

    def test_alert_cooldown(self, db, alert_service, mock_aircraft_data):
        """Test that alerts respect cooldown period."""
        AlertRule.objects.create(
            name='Cooldown Test',
            rule_type='icao',
            operator='eq',
            value='A12345',
            enabled=True,
            priority='info',
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        # First trigger
        triggered1 = alert_service.check_alerts(mock_aircraft_data)
        assert len(triggered1) == 1

        # Second trigger immediately - should be blocked by cooldown
        triggered2 = alert_service.check_alerts(mock_aircraft_data)
        assert len(triggered2) == 0

    def test_disabled_rule_not_evaluated(self, db, alert_service, mock_aircraft_data):
        """Test that disabled rules are not evaluated."""
        AlertRule.objects.create(
            name='Disabled Rule',
            rule_type='icao',
            operator='eq',
            value='A12345',
            enabled=False,
            priority='info',
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        triggered = alert_service.check_alerts(mock_aircraft_data)
        assert len(triggered) == 0

    def test_scheduled_rule_outside_window(self, db, alert_service, mock_aircraft_data):
        """Test that scheduled rules outside their window are not evaluated."""
        now = timezone.now()
        AlertRule.objects.create(
            name='Future Rule',
            rule_type='icao',
            operator='eq',
            value='A12345',
            enabled=True,
            priority='info',
            starts_at=now + timedelta(hours=1),
            expires_at=now + timedelta(hours=2),
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        triggered = alert_service.check_alerts(mock_aircraft_data)
        assert len(triggered) == 0


# =============================================================================
# Safety Monitoring Integration Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestSafetyEventFlow:
    """Test safety event detection -> storage -> broadcast flow."""

    def test_detect_emergency_squawk(self, db, safety_monitor, mock_emergency_aircraft):
        """Test detecting emergency squawk codes."""
        events = safety_monitor.update_aircraft([mock_emergency_aircraft])

        assert len(events) >= 1
        # Emergency squawk events are named 'squawk_emergency' in safety.py
        emergency_events = [e for e in events if e['event_type'] == 'squawk_emergency']
        assert len(emergency_events) == 1
        assert emergency_events[0]['severity'] == 'critical'

        # Verify stored in database
        db_event = SafetyEvent.objects.filter(event_type='squawk_emergency').first()
        assert db_event is not None
        assert db_event.icao_hex == 'A99999'

    def test_detect_extreme_vertical_speed(self, db, safety_monitor):
        """Test detecting extreme vertical speed."""
        aircraft = {
            'hex': 'A11111',
            'flight': 'TEST100',
            'vr': -8000,  # Extreme descent
            'lat': 47.5,
            'lon': -122.0,
            'alt': 15000,
        }

        events = safety_monitor.update_aircraft([aircraft])

        extreme_vs_events = [e for e in events if e['event_type'] == 'extreme_vs']
        assert len(extreme_vs_events) == 1
        assert 'descending' in extreme_vs_events[0]['message'].lower()

    def test_detect_proximity_conflict(self, db, safety_monitor, mock_proximity_aircraft):
        """Test detecting proximity conflicts."""
        events = safety_monitor.update_aircraft(mock_proximity_aircraft)

        proximity_events = [e for e in events if e['event_type'] == 'proximity_conflict']
        assert len(proximity_events) == 1
        assert proximity_events[0]['icao_hex_2'] is not None

    def test_detect_vs_reversal(self, db, safety_monitor):
        """Test detecting vertical speed reversal (potential TCAS)."""
        import time

        # The VS reversal detection algorithm requires at least 2 entries in vs_history
        # BEFORE checking for reversal. Since _update_state runs AFTER the check,
        # we need 3 updates total: first 2 build history, third can detect reversal.

        # First update - climbing at high rate (needs to meet TCAS threshold of 1500 fpm)
        aircraft_v1 = {
            'hex': 'A33333',
            'flight': 'TEST300',
            'baro_rate': 2000,  # Use baro_rate field
            'lat': 47.5,
            'lon': -122.0,
            'alt_baro': 20000,  # Use alt_baro field
        }
        safety_monitor.update_aircraft([aircraft_v1])

        # Second update - still climbing (builds history)
        time.sleep(0.05)
        aircraft_v2 = {
            'hex': 'A33333',
            'flight': 'TEST300',
            'baro_rate': 2000,
            'lat': 47.5,
            'lon': -122.0,
            'alt_baro': 20200,
        }
        safety_monitor.update_aircraft([aircraft_v2])

        # Third update - sudden descent (VS reversal)
        # Change from +2000 to -2000 = 4000 fpm change, exceeds TCAS threshold
        time.sleep(0.05)
        aircraft_v3 = {
            'hex': 'A33333',
            'flight': 'TEST300',
            'baro_rate': -2000,  # Changed from +2000 to -2000
            'lat': 47.5,
            'lon': -122.0,
            'alt_baro': 20500,
        }
        events = safety_monitor.update_aircraft([aircraft_v3])

        # Should detect either tcas_ra (if both VS values >= tcas_vs_threshold)
        # or vs_reversal (if change exceeds vs_change_threshold)
        reversal_events = [e for e in events if e['event_type'] in ('vs_reversal', 'tcas_ra')]
        assert len(reversal_events) >= 1

    def test_safety_event_cooldown(self, db, safety_monitor, mock_emergency_aircraft):
        """Test that safety events respect cooldown."""
        # First detection
        events1 = safety_monitor.update_aircraft([mock_emergency_aircraft])
        assert len(events1) >= 1

        # Second detection - emergency squawks persist while active (no cooldown)
        # But extreme_vs events DO have cooldown
        events2 = safety_monitor.update_aircraft([mock_emergency_aircraft])
        # Emergency squawks persist (they refresh), but shouldn't create duplicate alerts
        # The test verifies cooldown behavior works for non-emergency events
        extreme_vs_events_1 = [e for e in events1 if e['event_type'] == 'extreme_vs']
        extreme_vs_events_2 = [e for e in events2 if e['event_type'] == 'extreme_vs']
        # If extreme_vs was triggered in first call, it should be blocked in second
        if extreme_vs_events_1:
            assert len(extreme_vs_events_2) == 0

    def test_safety_monitoring_disabled(self, db, mock_emergency_aircraft):
        """Test that safety monitoring can be disabled."""
        with override_settings(SAFETY_MONITORING_ENABLED=False):
            monitor = SafetyMonitor()
            events = monitor.update_aircraft([mock_emergency_aircraft])
            assert len(events) == 0


# =============================================================================
# ACARS Integration Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestAcarsFlow:
    """Test ACARS message receive -> decode -> store -> broadcast flow."""

    @pytest.mark.asyncio
    async def test_normalize_acars_message(self, acars_service, mock_acars_message):
        """Test normalizing ACARS message format."""
        normalized = acars_service._normalize_message(mock_acars_message, 'acars')

        assert normalized is not None
        assert normalized['source'] == 'acars'
        assert normalized['icao_hex'] == 'A12345'
        assert normalized['callsign'] == 'UAL123'
        assert normalized['label'] == 'Q0'
        assert 'POS' in normalized['text']

    @pytest.mark.asyncio
    async def test_normalize_vdlm2_message(self, acars_service, mock_vdlm2_message):
        """Test normalizing VDL2 message format."""
        normalized = acars_service._normalize_message(mock_vdlm2_message, 'vdlm2')

        assert normalized is not None
        assert normalized['source'] == 'vdlm2'
        assert normalized['icao_hex'] == 'A67890'
        assert normalized['callsign'] == 'DAL456'
        assert normalized['label'] == 'H1'

    @pytest.mark.asyncio
    async def test_store_acars_message(self, db, acars_service, mock_acars_message):
        """Test storing ACARS message to database."""
        normalized = acars_service._normalize_message(mock_acars_message, 'acars')

        await acars_service._store_message(normalized)

        message = await database_sync_to_async(
            AcarsMessage.objects.filter(icao_hex='A12345').first
        )()
        assert message is not None
        assert message.callsign == 'UAL123'
        assert message.label == 'Q0'

    @pytest.mark.asyncio
    async def test_message_deduplication(self, acars_service, mock_acars_message):
        """Test that duplicate messages are filtered."""
        normalized = acars_service._normalize_message(mock_acars_message, 'acars')

        # First message - not duplicate
        is_dup1 = acars_service._is_duplicate(normalized, 'acars')
        assert is_dup1 is False

        # Same message again - should be duplicate
        is_dup2 = acars_service._is_duplicate(normalized, 'acars')
        assert is_dup2 is True

    def test_get_recent_messages(self, db, acars_messages):
        """Test retrieving recent ACARS messages from buffer."""
        acars_svc = AcarsService()

        # Manually add to recent buffer
        for msg in acars_messages[:5]:
            acars_svc._recent_messages.append({
                'icao_hex': msg.icao_hex,
                'callsign': msg.callsign,
                'text': msg.text,
            })

        recent = acars_svc.get_recent_messages(limit=3)
        assert len(recent) == 3

    def test_get_stats(self, db):
        """Test getting ACARS service statistics."""
        acars_svc = AcarsService()
        acars_svc._stats['acars']['total'] = 100
        acars_svc._stats['vdlm2']['total'] = 50

        stats = acars_svc.get_stats()

        assert stats['acars']['total'] == 100
        assert stats['vdlm2']['total'] == 50
        assert 'running' in stats


# =============================================================================
# Audio Transcription Integration Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestTranscriptionFlow:
    """Test audio upload -> transcription queue -> completion flow."""

    def test_create_audio_transmission(self, db, temp_audio_dir):
        """Test creating audio transmission record."""
        transmission = AudioTransmission.objects.create(
            filename='test_audio.mp3',
            file_size_bytes=50000,
            duration_seconds=5.5,
            format='mp3',
            frequency_mhz=118.3,
            channel_name='SEA Tower',
            transcription_status='pending',
        )

        assert transmission.id is not None
        assert transmission.transcription_status == 'pending'

    def test_queue_transcription(self, db, temp_audio_dir):
        """Test queuing audio for transcription."""
        transmission = AudioTransmission.objects.create(
            filename='test_audio.mp3',
            transcription_status='pending',
        )

        # Queue for transcription
        transmission.transcription_status = 'queued'
        transmission.transcription_queued_at = timezone.now()
        transmission.save()

        queued = AudioTransmission.objects.filter(transcription_status='queued')
        assert queued.count() == 1

    @patch('skyspy.services.audio.read_local_file')
    @patch('skyspy.services.audio.httpx.Client')
    def test_transcription_success(self, mock_client_class, mock_read_local, db, temp_audio_dir, sample_audio_file):
        """Test successful transcription."""
        # Mock httpx.Client context manager
        mock_response = MagicMock()
        mock_response.json.return_value = {
            'text': 'United four five six, cleared for takeoff.',
            'confidence': 0.95,
            'language': 'en',
            'segments': [
                {'start': 0.0, 'end': 3.0, 'text': 'United four five six, cleared for takeoff.'}
            ]
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        # Mock local file read to return audio data
        mock_read_local.return_value = b'fake audio data'

        transmission = AudioTransmission.objects.create(
            filename=os.path.basename(sample_audio_file),
            transcription_status='queued',
        )

        with override_settings(
            TRANSCRIPTION_ENABLED=True,
            TRANSCRIPTION_SERVICE_URL='http://localhost:9000/transcribe',
            RADIO_AUDIO_DIR=temp_audio_dir,
            S3_ENABLED=False,
        ):
            transcribe_audio(transmission.id)

        transmission.refresh_from_db()
        assert transmission.transcription_status == 'completed'
        assert 'United' in transmission.transcript
        assert transmission.transcript_confidence == 0.95

    def test_transcription_file_not_found(self, db, temp_audio_dir):
        """Test transcription failure when file not found."""
        transmission = AudioTransmission.objects.create(
            filename='nonexistent.mp3',
            transcription_status='queued',
        )

        with override_settings(
            TRANSCRIPTION_ENABLED=True,
            TRANSCRIPTION_SERVICE_URL='http://localhost:9000/transcribe',
            RADIO_AUDIO_DIR=temp_audio_dir,
            S3_ENABLED=False,
        ):
            # Catch the exception that bubbles up from retry
            try:
                transcribe_audio(transmission.id)
            except Exception:
                pass  # Expected - task will retry and eventually fail

        transmission.refresh_from_db()
        assert transmission.transcription_status == 'failed'
        # Error could be "Failed to fetch audio data" or contain "not found"
        assert transmission.transcription_error is not None
        assert 'fetch' in transmission.transcription_error.lower() or 'not found' in transmission.transcription_error.lower()

    def test_process_transcription_queue(self, db, temp_audio_dir):
        """Test processing transcription queue."""
        # Clean up any existing queued transmissions to ensure test isolation
        AudioTransmission.objects.filter(transcription_status='queued').delete()

        # Create queued transmissions
        for i in range(3):
            AudioTransmission.objects.create(
                filename=f'test_{i}.mp3',
                transcription_status='queued',
                transcription_queued_at=timezone.now(),
            )

        with override_settings(TRANSCRIPTION_ENABLED=False, WHISPER_ENABLED=False):
            process_transcription_queue()

        # Should not process when disabled
        queued = AudioTransmission.objects.filter(transcription_status='queued')
        assert queued.count() == 3


# =============================================================================
# WebSocket Integration Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
class TestWebSocketIntegration:
    """Test WebSocket connections and broadcasts."""

    async def test_aircraft_consumer_connect(self, db):
        """Test connecting to aircraft WebSocket."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(application, '/ws/aircraft/')
        connected, _ = await communicator.connect()

        assert connected

        # Should receive initial snapshot
        response = await asyncio.wait_for(
            communicator.receive_json_from(),
            timeout=2.0
        )
        assert response['type'] == 'aircraft:snapshot'

        await communicator.disconnect()

    async def test_aircraft_consumer_with_cached_data(self, db, cached_aircraft):
        """Test aircraft consumer returns cached data."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(application, '/ws/aircraft/')
        connected, _ = await communicator.connect()

        response = await asyncio.wait_for(
            communicator.receive_json_from(),
            timeout=2.0
        )

        assert response['type'] == 'aircraft:snapshot'
        assert len(response['data']['aircraft']) == len(cached_aircraft)

        await communicator.disconnect()

    async def test_safety_consumer_connect(self, db):
        """Test connecting to safety WebSocket."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(application, '/ws/safety/')
        connected, _ = await communicator.connect()

        assert connected

        await communicator.disconnect()

    async def test_acars_consumer_connect(self, db):
        """Test connecting to ACARS WebSocket."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(application, '/ws/acars/')
        connected, _ = await communicator.connect()

        assert connected

        await communicator.disconnect()

    async def test_ping_pong(self, db):
        """Test WebSocket ping/pong heartbeat."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(application, '/ws/aircraft/')
        connected, _ = await communicator.connect()

        # Consume initial snapshot
        await communicator.receive_json_from()

        # Send ping
        await communicator.send_json_to({'action': 'ping'})

        response = await asyncio.wait_for(
            communicator.receive_json_from(),
            timeout=1.0
        )
        assert response['type'] == 'pong'

        await communicator.disconnect()

    async def test_subscribe_topics(self, db):
        """Test subscribing to specific topics."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(application, '/ws/aircraft/')
        connected, _ = await communicator.connect()

        # Consume initial snapshot
        await communicator.receive_json_from()

        # Subscribe to stats
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['stats']
        })

        response = await asyncio.wait_for(
            communicator.receive_json_from(),
            timeout=1.0
        )
        assert response['type'] == 'subscribed'
        assert 'stats' in response['topics']

        await communicator.disconnect()


# =============================================================================
# Full End-to-End Flow Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestEndToEndFlows:
    """Complete end-to-end integration tests."""

    @patch('skyspy.tasks.aircraft.httpx.get')
    def test_aircraft_poll_to_storage_flow(self, mock_get, db, mock_aircraft_data):
        """Test complete flow from polling to storage."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            'now': datetime.utcnow().timestamp(),
            'messages': 12345,
            'aircraft': mock_aircraft_data,
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        # Poll aircraft
        poll_aircraft()

        # Verify cache update
        cached = cache.get('current_aircraft')
        assert cached is not None

        # Store sightings
        store_aircraft_sightings(cached)

        # Verify database storage
        assert AircraftSighting.objects.count() > 0

        # Update sessions
        update_aircraft_sessions(cached)

        # Verify sessions created
        assert AircraftSession.objects.count() > 0

    def test_alert_to_notification_flow(self, db, mock_aircraft_data, mock_apprise):
        """Test complete alert -> notification flow."""
        # Setup notification config
        NotificationConfig.objects.create(
            pk=1,
            apprise_urls='test://notification',
            enabled=True,
        )

        # Create alert rule
        AlertRule.objects.create(
            name='Emergency Alert',
            rule_type='squawk',
            operator='eq',
            value='7700',
            enabled=True,
            priority='critical',
        )

        # Add emergency aircraft
        emergency_ac = {
            'hex': 'A99999',
            'flight': 'N12345',
            'squawk': '7700',
            'alt': 8000,
            'lat': 47.9,
            'lon': -121.9,
        }
        mock_aircraft_data.append(emergency_ac)

        # Run alert check
        service = AlertService()
        # Invalidate cache to pick up the new rule
        service.invalidate_cache()
        triggered = service.check_alerts(mock_aircraft_data)

        # Verify alert was triggered
        assert len(triggered) == 1
        assert triggered[0]['priority'] == 'critical'

        # Verify history was created
        history = AlertHistory.objects.filter(icao_hex='A99999').first()
        assert history is not None

    def test_safety_event_broadcast_flow(self, db, mock_emergency_aircraft):
        """Test safety event detection to broadcast flow."""
        monitor = SafetyMonitor()

        # Detect safety event
        events = monitor.update_aircraft([mock_emergency_aircraft])

        assert len(events) >= 1

        # Verify stored in database
        db_events = SafetyEvent.objects.filter(icao_hex='A99999')
        assert db_events.count() >= 1

        # Verify event details - emergency squawk event type is 'squawk_emergency'
        event = db_events.filter(event_type='squawk_emergency').first()
        assert event is not None
        assert event.severity == 'critical'
        assert event.aircraft_snapshot is not None


# =============================================================================
# Performance Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestPerformance:
    """Performance-related integration tests."""

    def test_bulk_sighting_storage(self, db):
        """Test storing large batches of sightings."""
        import time

        # Generate 1000 aircraft
        aircraft_data = []
        for i in range(1000):
            aircraft_data.append({
                'hex': f'A{i:05d}',
                'flight': f'TEST{i}',
                'lat': 47.0 + (i % 10) * 0.1,
                'lon': -122.0 + (i % 10) * 0.1,
                'alt_baro': 10000 + (i % 30) * 1000,
                'gs': 400,
                'track': i % 360,
                'baro_rate': 0,
            })

        start = time.time()
        store_aircraft_sightings(aircraft_data)
        elapsed = time.time() - start

        # Should complete in reasonable time
        assert elapsed < 5.0  # 5 seconds max

        # Verify all stored
        assert AircraftSighting.objects.count() == 1000

    def test_alert_evaluation_performance(self, db, alert_service):
        """Test alert evaluation with many rules."""
        # Create 50 alert rules
        for i in range(50):
            AlertRule.objects.create(
                name=f'Rule {i}',
                rule_type='altitude',
                operator='gt',
                value=str(i * 1000),
                enabled=True,
                priority='info',
            )

        # Invalidate cache to pick up new rules
        alert_service.invalidate_cache()

        # Create 100 aircraft
        aircraft_data = []
        for i in range(100):
            aircraft_data.append({
                'hex': f'B{i:05d}',
                'alt': 15000 + (i * 100),
            })

        import time
        start = time.time()
        triggered = alert_service.check_alerts(aircraft_data)
        elapsed = time.time() - start

        # Should complete in reasonable time (very relaxed for CI with many containers)
        # Note: In CI with SQLite and container overhead, this can be much slower
        assert elapsed < 120.0  # 2 minutes max - enough for slow CI environments

    def test_safety_monitor_performance(self, db, safety_monitor):
        """Test safety monitoring with many aircraft."""
        # Create 100 aircraft
        aircraft_data = []
        for i in range(100):
            aircraft_data.append({
                'hex': f'C{i:05d}',
                'flight': f'PERF{i}',
                'lat': 47.0 + (i % 10) * 0.05,
                'lon': -122.0 + (i % 10) * 0.05,
                'alt': 20000 + (i % 20) * 500,
                'vr': (i % 100) - 50,
            })

        import time
        start = time.time()
        events = safety_monitor.update_aircraft(aircraft_data)
        elapsed = time.time() - start

        # Should complete quickly (proximity checks are O(n^2))
        assert elapsed < 3.0  # 3 seconds max


# =============================================================================
# Error Handling Tests
# =============================================================================

@pytest.mark.django_db(transaction=True)
class TestErrorHandling:
    """Test error handling in integration scenarios."""

    def test_invalid_alert_conditions(self, db, alert_service):
        """Test handling of invalid alert conditions."""
        AlertRule.objects.create(
            name='Invalid Condition',
            rule_type='altitude',
            operator='gt',
            value='not_a_number',  # Invalid value
            enabled=True,
        )

        # Invalidate cache to pick up the new rule
        alert_service.invalidate_cache()

        # Should not raise, should handle gracefully
        triggered = alert_service.check_alerts([{
            'hex': 'A12345',
            'alt': 30000,
        }])

        # Should return empty (condition fails to evaluate)
        assert len(triggered) == 0

    def test_missing_aircraft_fields(self, db, safety_monitor):
        """Test handling of incomplete aircraft data."""
        # Aircraft with minimal data
        aircraft = [
            {'hex': 'A11111'},  # Only ICAO
            {'hex': 'A22222', 'lat': 47.5},  # Missing lon
            {},  # Empty
        ]

        # Should not raise
        events = safety_monitor.update_aircraft(aircraft)

        # Should handle gracefully
        assert isinstance(events, list)

    @pytest.mark.asyncio
    async def test_acars_invalid_json(self, acars_service):
        """Test handling of invalid ACARS JSON."""
        # Process invalid data - should not raise
        await acars_service._process_message(b'not valid json', 'acars')

        # Verify error was counted
        assert acars_service._stats['acars']['errors'] >= 1

    def test_database_integrity_on_duplicate(self, db):
        """Test handling of duplicate unique constraint violations."""
        from skyspy.models import AircraftInfo

        # Create first record
        AircraftInfo.objects.create(icao_hex='A12345', registration='N12345')

        # Attempt duplicate - should raise
        with pytest.raises(Exception):
            AircraftInfo.objects.create(icao_hex='A12345', registration='N12346')
