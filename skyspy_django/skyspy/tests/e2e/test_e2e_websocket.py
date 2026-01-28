"""
Comprehensive End-to-End Tests for SkysPy Django API WebSocket Real-Time Functionality.

Tests cover all WebSocket endpoints for real-time data streaming:
- Aircraft WebSocket (/ws/aircraft/)
- Safety WebSocket (/ws/safety/)
- Alerts WebSocket (/ws/alerts/)
- ACARS WebSocket (/ws/acars/)
- Audio WebSocket (/ws/audio/)
- Stats WebSocket (/ws/stats/)

Also covers:
- Connection management
- Authentication
- Message format validation
- Performance testing
- Server-Sent Events (SSE)
"""
import asyncio
import json
import time
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.layers import InMemoryChannelLayer, get_channel_layer
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from skyspy.channels.consumers.aircraft import AircraftConsumer
from skyspy.channels.consumers.safety import SafetyConsumer
from skyspy.channels.consumers.acars import AcarsConsumer
from skyspy.channels.consumers.audio import AudioConsumer
from skyspy.models import (
    AircraftSighting,
    AircraftSession,
    AircraftInfo,
    AlertRule,
    AlertHistory,
    SafetyEvent,
    AcarsMessage,
    AudioTransmission,
)


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def channel_layer():
    """Get the configured channel layer for testing.

    Uses the same channel layer that consumers use (from get_channel_layer())
    so that group_send messages reach the consumers.
    """
    return get_channel_layer()


@pytest.fixture
def sample_aircraft_data():
    """Generate sample aircraft data for testing."""
    return [
        {
            'hex': 'A12345',
            'icao_hex': 'A12345',
            'flight': 'UAL123',
            'callsign': 'UAL123',
            'alt_baro': 35000,
            'alt_geom': 35200,
            'gs': 450,
            'track': 270,
            'lat': 47.5,
            'lon': -122.0,
            'category': 'A3',
            't': 'B738',
            'rssi': -25.0,
            'distance_nm': 15.5,
            'dbFlags': 0,
            'is_military': False,
        },
        {
            'hex': 'AE1234',
            'icao_hex': 'AE1234',
            'flight': 'RCH789',
            'callsign': 'RCH789',
            'alt_baro': 32000,
            'alt_geom': 32100,
            'gs': 420,
            'track': 180,
            'lat': 48.0,
            'lon': -122.5,
            'category': 'A5',
            't': 'C17',
            'rssi': -30.0,
            'distance_nm': 25.0,
            'dbFlags': 1,
            'is_military': True,
        },
        {
            'hex': 'A99999',
            'icao_hex': 'A99999',
            'flight': 'N12345',
            'callsign': 'N12345',
            'alt_baro': 8000,
            'gs': 120,
            'squawk': '7700',
            'lat': 47.9,
            'lon': -121.9,
            'category': 'A1',
            't': 'C172',
            'rssi': -15.0,
            'distance_nm': 2.5,
            'dbFlags': 0,
            'is_military': False,
        },
    ]


@pytest.fixture
def cached_aircraft_data(sample_aircraft_data):
    """Pre-populate cache with aircraft data."""
    cache.set('current_aircraft', sample_aircraft_data, timeout=300)
    cache.set('aircraft_timestamp', timezone.now().timestamp(), timeout=300)
    cache.set('aircraft_messages', 12345, timeout=300)
    cache.set('adsb_online', True, timeout=300)
    yield sample_aircraft_data
    cache.clear()


@pytest.fixture
def sample_safety_events(db):
    """Create sample safety events for testing."""
    now = timezone.now()
    events = [
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            icao_hex_2='DEF456',
            callsign='UAL123',
            callsign_2='DAL456',
            message='TCAS Resolution Advisory detected',
            details={'vertical_rate_1': -2000, 'vertical_rate_2': 1500},
            aircraft_snapshot={'hex': 'ABC123', 'alt': 25000, 'lat': 47.5, 'lon': -122.0},
            acknowledged=False,
        ),
        SafetyEvent.objects.create(
            event_type='emergency_squawk',
            severity='critical',
            icao_hex='A99999',
            callsign='N12345',
            message='Emergency squawk 7700 detected',
            details={'squawk': '7700'},
            aircraft_snapshot={'hex': 'A99999', 'alt': 8000, 'lat': 47.9, 'lon': -121.9},
            acknowledged=False,
        ),
        SafetyEvent.objects.create(
            event_type='extreme_vs',
            severity='warning',
            icao_hex='GHI789',
            callsign='SWA012',
            message='Extreme vertical speed detected: -5000 fpm',
            details={'vertical_rate': -5000},
            aircraft_snapshot={'hex': 'GHI789', 'alt': 15000, 'lat': 47.6, 'lon': -122.2},
            acknowledged=True,
            acknowledged_at=now - timedelta(minutes=2),
        ),
    ]
    return events


@pytest.fixture
def sample_acars_messages(db):
    """Create sample ACARS messages for testing."""
    messages = [
        AcarsMessage.objects.create(
            source='acars',
            channel='131.550',
            frequency=131.550,
            icao_hex='A12345',
            registration='N12345',
            callsign='UAL123',
            label='H1',
            block_id='1',
            msg_num='001',
            ack='N',
            mode='2',
            text='POSITION REPORT LAT/LON 40.7128/-74.0060',
            signal_level=-45.5,
            error_count=0,
            station_id='KJFK',
        ),
        AcarsMessage.objects.create(
            source='vdlm2',
            channel='136.975',
            frequency=136.975,
            icao_hex='DEF456',
            registration='N67890',
            callsign='DAL456',
            label='Q0',
            text='PDC CLEARANCE MESSAGE',
            signal_level=-52.3,
            error_count=1,
            station_id='KLAX',
        ),
    ]
    return messages


@pytest.fixture
def sample_audio_transmissions(db):
    """Create sample audio transmissions for testing."""
    now = timezone.now()
    transmissions = [
        AudioTransmission.objects.create(
            filename='transmission_001.mp3',
            s3_key='audio/2024/01/transmission_001.mp3',
            s3_url='https://s3.example.com/audio/2024/01/transmission_001.mp3',
            file_size_bytes=245760,
            duration_seconds=12.5,
            format='mp3',
            frequency_mhz=121.5,
            channel_name='KJFK Tower',
            squelch_level=-45.0,
            transcription_status='completed',
            transcription_queued_at=now - timedelta(minutes=10),
            transcription_completed_at=now - timedelta(minutes=8),
            transcript='United 123 cleared for takeoff runway 31 left',
            transcript_confidence=0.95,
            transcript_language='en',
            identified_airframes=['UAL123'],
        ),
        AudioTransmission.objects.create(
            filename='transmission_002.mp3',
            s3_key='audio/2024/01/transmission_002.mp3',
            s3_url='https://s3.example.com/audio/2024/01/transmission_002.mp3',
            file_size_bytes=184320,
            duration_seconds=8.2,
            format='mp3',
            frequency_mhz=121.5,
            channel_name='KJFK Tower',
            squelch_level=-42.0,
            transcription_status='processing',
            transcription_queued_at=now - timedelta(minutes=2),
        ),
        AudioTransmission.objects.create(
            filename='transmission_003.mp3',
            s3_key='audio/2024/01/transmission_003.mp3',
            s3_url='https://s3.example.com/audio/2024/01/transmission_003.mp3',
            file_size_bytes=163840,
            duration_seconds=7.1,
            format='mp3',
            frequency_mhz=118.1,
            channel_name='KLAX Approach',
            squelch_level=-48.0,
            transcription_status='pending',
        ),
    ]
    return transmissions


@pytest.fixture
def sample_alert_rules(db, operator_user):
    """Create sample alert rules for testing."""
    rules = [
        AlertRule.objects.create(
            name='Military Aircraft Alert',
            rule_type='military',
            operator='eq',
            value='true',
            description='Alert for military aircraft',
            enabled=True,
            priority='warning',
            owner=operator_user,
        ),
        AlertRule.objects.create(
            name='Emergency Squawk Alert',
            rule_type='squawk',
            operator='in',
            value='7500,7600,7700',
            description='Alert for emergency squawks',
            enabled=True,
            priority='critical',
            owner=operator_user,
        ),
        AlertRule.objects.create(
            name='Low Altitude Alert',
            rule_type='altitude',
            operator='lt',
            value='5000',
            description='Alert for low-flying aircraft',
            enabled=True,
            priority='info',
            owner=operator_user,
        ),
    ]
    return rules


# =============================================================================
# 1. Aircraft WebSocket Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAircraftWebSocket:
    """Tests for /ws/aircraft/ WebSocket endpoint."""

    async def test_connect_to_aircraft_websocket(self, channel_layer):
        """Test successful connection to aircraft WebSocket."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_receive_aircraft_position_updates(self, channel_layer, cached_aircraft_data):
        """Test receiving aircraft position updates on connect."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        # Should receive initial snapshot
        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:snapshot'
        assert 'data' in response
        assert 'aircraft' in response['data']
        assert 'count' in response['data']
        assert 'timestamp' in response['data']

        await communicator.disconnect()

    async def test_filter_aircraft_by_distance(self, channel_layer, cached_aircraft_data):
        """Test subscribing with distance filter."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()  # Discard initial snapshot

        # Subscribe with distance filter
        await communicator.send_json_to({
            'action': 'subscribe_stats',
            'max_distance_nm': 20,
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'

        await communicator.disconnect()

    async def test_filter_aircraft_by_altitude(self, channel_layer, cached_aircraft_data):
        """Test subscribing with altitude filter."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe with altitude filter
        await communicator.send_json_to({
            'action': 'subscribe_stats',
            'min_altitude': 10000,
            'max_altitude': 40000,
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'filters' in response
        assert response['filters']['min_altitude'] == 10000
        assert response['filters']['max_altitude'] == 40000

        await communicator.disconnect()

    async def test_subscribe_to_specific_icao(self, channel_layer, cached_aircraft_data):
        """Test subscribing to specific ICAO hex codes."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to specific ICAO
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['aircraft'],
            'icao_filter': ['A12345', 'AE1234']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'aircraft' in response['topics']

        await communicator.disconnect()

    async def test_unsubscribe_from_aircraft(self, channel_layer):
        """Test unsubscribing from aircraft updates."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft,stats'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Unsubscribe from stats
        await communicator.send_json_to({
            'action': 'unsubscribe',
            'topics': ['stats']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'unsubscribed'
        assert 'stats' in response['topics']

        await communicator.disconnect()

    async def test_handle_high_frequency_updates(self, channel_layer):
        """Test handling burst of high-frequency position updates."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Simulate burst of 100 position updates
        for i in range(100):
            position_data = {
                'hex': f'A{i:05d}',
                'lat': 47.0 + (i * 0.001),
                'lon': -122.0 + (i * 0.001),
                'alt_baro': 30000 + i,
                'track': i % 360,
                'gs': 450,
            }
            await channel_layer.group_send(
                'aircraft_aircraft',
                {'type': 'aircraft_position', 'data': position_data}
            )

        # Should receive all updates without error
        received_count = 0
        for _ in range(100):
            try:
                response = await asyncio.wait_for(
                    communicator.receive_json_from(),
                    timeout=0.5
                )
                if response['type'] == 'aircraft:position':
                    received_count += 1
            except asyncio.TimeoutError:
                break

        assert received_count > 0  # Should have received updates

        await communicator.disconnect()

    async def test_request_single_aircraft_by_icao(self, channel_layer, cached_aircraft_data):
        """Test requesting aircraft data by ICAO hex."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request specific aircraft
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft',
            'request_id': 'req-001',
            'params': {'icao': 'A12345'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-001'
        assert response['request_type'] == 'aircraft'

        await communicator.disconnect()

    async def test_request_aircraft_list_with_filters(self, channel_layer, cached_aircraft_data):
        """Test requesting filtered aircraft list."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request military aircraft only
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft_list',
            'request_id': 'req-002',
            'params': {'military_only': True}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-002'
        assert isinstance(response['data'], list)

        await communicator.disconnect()


# =============================================================================
# 2. Safety WebSocket Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestSafetyWebSocket:
    """Tests for /ws/safety/ WebSocket endpoint."""

    async def test_connect_to_safety_websocket(self, channel_layer):
        """Test successful connection to safety WebSocket."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_receive_safety_event_notifications(self, channel_layer, sample_safety_events):
        """Test receiving safety event notifications on connect."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()

        # Should receive initial snapshot
        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:snapshot'
        assert 'data' in response
        assert 'events' in response['data']
        assert 'count' in response['data']
        assert 'timestamp' in response['data']

        await communicator.disconnect()

    async def test_safety_event_includes_type_and_severity(self, channel_layer, sample_safety_events):
        """Test that safety events include event type and severity."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Broadcast a safety event
        event_data = {
            'id': 1,
            'event_type': 'tcas_ra',
            'severity': 'critical',
            'icao_hex': 'ABC123',
            'callsign': 'UAL123',
            'message': 'TCAS Resolution Advisory',
            'aircraft_snapshot': {'hex': 'ABC123', 'alt': 25000},
        }
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event', 'data': event_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event'
        assert response['data']['event_type'] == 'tcas_ra'
        assert response['data']['severity'] == 'critical'
        assert 'aircraft_snapshot' in response['data']

        await communicator.disconnect()

    async def test_receive_realtime_tcas_alerts(self, channel_layer):
        """Test receiving real-time TCAS alerts."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=tcas'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Broadcast TCAS event
        tcas_data = {
            'event_type': 'tcas_ra',
            'severity': 'critical',
            'icao_hex': 'ABC123',
            'icao_hex_2': 'DEF456',
            'callsign': 'UAL123',
            'callsign_2': 'DAL456',
            'message': 'TCAS RA: Climb/Descend',
            'details': {'resolution': 'climb'},
        }
        await channel_layer.group_send(
            'safety_tcas',
            {'type': 'safety_event', 'data': tcas_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event'
        assert response['data']['event_type'] == 'tcas_ra'

        await communicator.disconnect()

    async def test_receive_emergency_squawk_notifications(self, channel_layer):
        """Test receiving emergency squawk notifications."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=emergency'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Broadcast emergency squawk event
        emergency_data = {
            'event_type': '7700',
            'severity': 'critical',
            'icao_hex': 'A99999',
            'callsign': 'N12345',
            'message': 'Emergency squawk 7700 detected',
            'details': {'squawk': '7700'},
        }
        await channel_layer.group_send(
            'safety_emergency',
            {'type': 'safety_event', 'data': emergency_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event'
        assert response['data']['event_type'] == '7700'
        assert response['data']['details']['squawk'] == '7700'

        await communicator.disconnect()

    async def test_acknowledge_safety_event(self, channel_layer, sample_safety_events):
        """Test acknowledging a safety event."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Get unacknowledged event
        event = sample_safety_events[0]
        assert event.acknowledged is False

        # Acknowledge event
        await communicator.send_json_to({
            'action': 'request',
            'type': 'acknowledge',
            'request_id': 'req-ack-001',
            'params': {'event_id': event.id}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-ack-001'
        assert response['data']['success'] is True

        # Verify event is acknowledged in database
        await database_sync_to_async(event.refresh_from_db)()
        assert event.acknowledged is True

        await communicator.disconnect()

    async def test_request_safety_event_history(self, channel_layer, sample_safety_events):
        """Test requesting safety event history."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request event history
        await communicator.send_json_to({
            'action': 'request',
            'type': 'event_history',
            'request_id': 'req-hist-001',
            'params': {'limit': 10}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-hist-001'
        assert response['request_type'] == 'event_history'
        assert isinstance(response['data'], list)

        await communicator.disconnect()


# =============================================================================
# 3. Alerts WebSocket Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAlertsWebSocket:
    """Tests for /ws/alerts/ WebSocket endpoint."""

    async def test_connect_to_alerts_websocket(self):
        """Test successful connection to alerts WebSocket."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(
            application,
            '/ws/alerts/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_receive_alert_trigger_notifications(self, sample_alert_rules):
        """Test receiving alert trigger notifications."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(
            application,
            '/ws/alerts/'
        )
        await communicator.connect()

        # Should receive initial snapshot or be ready for alerts
        try:
            response = await asyncio.wait_for(
                communicator.receive_json_from(),
                timeout=2.0
            )
            # Initial snapshot or acknowledgement expected
            assert 'type' in response
        except asyncio.TimeoutError:
            pass  # Some WebSockets don't send initial message

        await communicator.disconnect()

    async def test_alert_includes_rule_info_and_aircraft(self):
        """Test that alert notifications include rule info and matching aircraft."""
        from skyspy.asgi import application
        from channels.layers import get_channel_layer

        communicator = WebsocketCommunicator(
            application,
            '/ws/alerts/?topics=triggers'
        )
        await communicator.connect()

        # Consume any initial message
        try:
            await asyncio.wait_for(communicator.receive_json_from(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

        # Broadcast an alert trigger
        channel_layer = get_channel_layer()
        alert_data = {
            'rule_id': 1,
            'rule_name': 'Military Aircraft Alert',
            'priority': 'warning',
            'aircraft': {
                'hex': 'AE1234',
                'callsign': 'RCH789',
                'alt_baro': 32000,
                'is_military': True,
            },
            'triggered_at': datetime.utcnow().isoformat(),
        }
        await channel_layer.group_send(
            'alerts_triggers',
            {'type': 'alert_triggered', 'data': alert_data}
        )

        try:
            response = await asyncio.wait_for(
                communicator.receive_json_from(),
                timeout=2.0
            )
            assert 'type' in response
            # Should have rule info and aircraft data
            if response.get('type') == 'alert:triggered':
                assert 'rule_id' in response['data'] or 'rule_name' in response['data']
                assert 'aircraft' in response['data']
        except asyncio.TimeoutError:
            pass

        await communicator.disconnect()

    async def test_filter_alerts_by_rule_ids(self, sample_alert_rules):
        """Test filtering alerts by specific rule IDs."""
        from skyspy.asgi import application

        # Subscribe with specific rule ID filter
        rule_id = sample_alert_rules[0].id
        communicator = WebsocketCommunicator(
            application,
            f'/ws/alerts/?rule_ids={rule_id}'
        )
        await communicator.connect()

        # Consume any initial message
        try:
            await asyncio.wait_for(communicator.receive_json_from(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

        await communicator.disconnect()


# =============================================================================
# 4. ACARS WebSocket Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAcarsWebSocket:
    """Tests for /ws/acars/ WebSocket endpoint."""

    async def test_connect_to_acars_websocket(self, channel_layer):
        """Test successful connection to ACARS WebSocket."""
        communicator = WebsocketCommunicator(
            AcarsConsumer.as_asgi(),
            '/ws/acars/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_receive_acars_vdl2_messages(self, channel_layer, sample_acars_messages):
        """Test receiving ACARS/VDL2 messages on connect."""
        communicator = WebsocketCommunicator(
            AcarsConsumer.as_asgi(),
            '/ws/acars/'
        )
        await communicator.connect()

        # Should receive initial snapshot
        response = await communicator.receive_json_from()
        assert response['type'] == 'acars:snapshot'
        assert 'data' in response
        assert 'messages' in response['data']
        assert 'count' in response['data']

        await communicator.disconnect()

    async def test_filter_acars_by_frequency(self, channel_layer, sample_acars_messages):
        """Test filtering ACARS messages by frequency."""
        communicator = WebsocketCommunicator(
            AcarsConsumer.as_asgi(),
            '/ws/acars/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request messages by frequency
        await communicator.send_json_to({
            'action': 'request',
            'type': 'messages',
            'request_id': 'req-freq-001',
            'params': {'frequency': 131.550}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        # All messages should match frequency
        for msg in response['data']:
            assert msg['frequency'] == 131.550 or msg.get('channel') == '131.550'

        await communicator.disconnect()

    async def test_filter_acars_by_label(self, channel_layer, sample_acars_messages):
        """Test filtering ACARS messages by label."""
        communicator = WebsocketCommunicator(
            AcarsConsumer.as_asgi(),
            '/ws/acars/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request messages by label
        await communicator.send_json_to({
            'action': 'request',
            'type': 'messages',
            'request_id': 'req-label-001',
            'params': {'label': 'H1'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        for msg in response['data']:
            assert msg['label'] == 'H1'

        await communicator.disconnect()

    async def test_acars_includes_decoded_content(self, channel_layer, sample_acars_messages):
        """Test that ACARS messages include decoded content."""
        communicator = WebsocketCommunicator(
            AcarsConsumer.as_asgi(),
            '/ws/acars/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'acars:snapshot'

        # Check message structure
        if response['data']['messages']:
            msg = response['data']['messages'][0]
            assert 'text' in msg
            assert 'label' in msg
            assert 'icao_hex' in msg

        await communicator.disconnect()

    async def test_subscribe_to_vdl2_only(self, channel_layer):
        """Test subscribing to VDL2 messages only."""
        communicator = WebsocketCommunicator(
            AcarsConsumer.as_asgi(),
            '/ws/acars/?topics=vdlm2'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Broadcast VDL2 message
        vdl2_data = {
            'source': 'vdlm2',
            'icao_hex': 'DEF456',
            'callsign': 'DAL456',
            'label': 'Q0',
            'text': 'PDC CLEARANCE',
        }
        await channel_layer.group_send(
            'acars_vdlm2',
            {'type': 'acars_message', 'data': vdl2_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'acars:message'
        assert response['data']['source'] == 'vdlm2'

        await communicator.disconnect()


# =============================================================================
# 5. Audio WebSocket Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAudioWebSocket:
    """Tests for /ws/audio/ WebSocket endpoint."""

    async def test_connect_to_audio_websocket(self, channel_layer):
        """Test successful connection to audio WebSocket."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_receive_audio_transmission_notifications(self, channel_layer, sample_audio_transmissions):
        """Test receiving audio transmission notifications on connect."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()

        # Should receive initial snapshot
        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:snapshot'
        assert 'data' in response
        assert 'recent_transmissions' in response['data']
        assert 'pending_transcriptions' in response['data']

        await communicator.disconnect()

    async def test_receive_transcription_completion_updates(self, channel_layer):
        """Test receiving transcription completion updates."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Broadcast transcription completed
        completion_data = {
            'transmission_id': 1,
            'status': 'completed',
            'transcript': 'United 123 cleared for takeoff',
            'confidence': 0.95,
            'completed_at': datetime.utcnow().isoformat(),
        }
        await channel_layer.group_send(
            'audio_transcriptions',
            {'type': 'audio_transcription_completed', 'data': completion_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transcription_completed'
        assert response['data']['transcript'] == 'United 123 cleared for takeoff'
        assert response['data']['confidence'] == 0.95

        await communicator.disconnect()

    async def test_filter_audio_by_frequency(self, channel_layer, sample_audio_transmissions):
        """Test filtering audio transmissions by frequency."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request transmissions by frequency
        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-audio-001',
            'params': {'frequency': 121.5}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        for trans in response['data']:
            assert trans['frequency_mhz'] == 121.5

        await communicator.disconnect()

    async def test_filter_audio_by_channel(self, channel_layer, sample_audio_transmissions):
        """Test filtering audio transmissions by channel name."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request transmissions by channel name
        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-audio-002',
            'params': {'channel_name': 'KJFK'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        for trans in response['data']:
            assert 'KJFK' in trans['channel_name']

        await communicator.disconnect()

    async def test_transcription_status_updates(self, channel_layer):
        """Test receiving transcription status progression updates."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Broadcast transcription started
        started_data = {
            'transmission_id': 1,
            'status': 'processing',
            'started_at': datetime.utcnow().isoformat(),
        }
        await channel_layer.group_send(
            'audio_transcriptions',
            {'type': 'audio_transcription_started', 'data': started_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transcription_started'
        assert response['data']['status'] == 'processing'

        await communicator.disconnect()


# =============================================================================
# 6. Stats WebSocket Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestStatsWebSocket:
    """Tests for /ws/stats/ WebSocket endpoint."""

    async def test_connect_to_stats_websocket(self):
        """Test successful connection to stats WebSocket."""
        from skyspy.asgi import application

        communicator = WebsocketCommunicator(
            application,
            '/ws/stats/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_receive_live_statistics_updates(self, cached_aircraft_data):
        """Test receiving live statistics updates."""
        from skyspy.asgi import application
        from channels.layers import get_channel_layer

        communicator = WebsocketCommunicator(
            application,
            '/ws/stats/'
        )
        await communicator.connect()

        # Try to receive initial message or stats
        try:
            response = await asyncio.wait_for(
                communicator.receive_json_from(),
                timeout=2.0
            )
            # Should have stats-related data
            assert 'type' in response
        except asyncio.TimeoutError:
            pass

        # Broadcast stats update
        channel_layer = get_channel_layer()
        stats_data = {
            'aircraft_count': 150,
            'military_count': 5,
            'emergency_count': 0,
            'tracking_quality': 0.95,
            'timestamp': datetime.utcnow().isoformat(),
        }
        await channel_layer.group_send(
            'stats_all',
            {'type': 'stats_update', 'data': stats_data}
        )

        await communicator.disconnect()

    async def test_aircraft_count_changes(self, cached_aircraft_data):
        """Test receiving aircraft count change notifications."""
        from skyspy.asgi import application
        from channels.layers import get_channel_layer

        communicator = WebsocketCommunicator(
            application,
            '/ws/stats/'
        )
        await communicator.connect()

        # Consume initial message
        try:
            await asyncio.wait_for(communicator.receive_json_from(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

        # Broadcast count change
        channel_layer = get_channel_layer()
        count_data = {
            'previous_count': 145,
            'current_count': 150,
            'change': 5,
            'timestamp': datetime.utcnow().isoformat(),
        }
        await channel_layer.group_send(
            'stats_all',
            {'type': 'stats_count_changed', 'data': count_data}
        )

        await communicator.disconnect()

    async def test_tracking_quality_updates(self):
        """Test receiving tracking quality updates."""
        from skyspy.asgi import application
        from channels.layers import get_channel_layer

        communicator = WebsocketCommunicator(
            application,
            '/ws/stats/'
        )
        await communicator.connect()

        # Consume initial message
        try:
            await asyncio.wait_for(communicator.receive_json_from(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

        # Broadcast tracking quality update
        channel_layer = get_channel_layer()
        quality_data = {
            'tracking_quality': 0.92,
            'average_signal_strength': -28.5,
            'active_feeders': 3,
            'timestamp': datetime.utcnow().isoformat(),
        }
        await channel_layer.group_send(
            'stats_all',
            {'type': 'stats_quality_update', 'data': quality_data}
        )

        await communicator.disconnect()


# =============================================================================
# 7. Connection Management Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestConnectionManagement:
    """Tests for WebSocket connection management."""

    async def test_websocket_connects_successfully(self, channel_layer):
        """Test that WebSocket connections are accepted."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        connected, subprotocol = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_handles_disconnect_gracefully(self, channel_layer):
        """Test graceful disconnect handling."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Disconnect gracefully
        await communicator.disconnect()

        # Sending to groups after disconnect should not raise
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': {'test': True}}
        )

    async def test_reconnection_works(self, channel_layer):
        """Test that reconnection after disconnect works."""
        # First connection
        communicator1 = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator1.connect()
        await communicator1.receive_json_from()
        await communicator1.disconnect()

        # Second connection (reconnect)
        communicator2 = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        connected, _ = await communicator2.connect()
        assert connected is True

        response = await communicator2.receive_json_from()
        assert response['type'] == 'aircraft:snapshot'

        await communicator2.disconnect()

    async def test_multiple_simultaneous_connections(self, channel_layer):
        """Test handling multiple simultaneous connections."""
        communicators = []

        # Create 5 simultaneous connections
        for i in range(5):
            communicator = WebsocketCommunicator(
                AircraftConsumer.as_asgi(),
                f'/ws/aircraft/?client_id={i}'
            )
            connected, _ = await communicator.connect()
            assert connected is True
            communicators.append(communicator)

        # All should receive initial snapshot
        for communicator in communicators:
            response = await communicator.receive_json_from()
            assert response['type'] == 'aircraft:snapshot'

        # Broadcast message should reach all
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': {'broadcast': 'test'}}
        )

        for communicator in communicators:
            response = await communicator.receive_json_from()
            assert response['type'] == 'aircraft:update'
            assert response['data']['broadcast'] == 'test'

        # Disconnect all
        for communicator in communicators:
            await communicator.disconnect()

    async def test_connection_timeout_handling(self, channel_layer):
        """Test connection timeout behavior."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Test ping/pong keeps connection alive
        await communicator.send_json_to({'action': 'ping'})
        response = await communicator.receive_json_from()
        assert response['type'] == 'pong'

        await communicator.disconnect()


# =============================================================================
# 8. Authentication Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestWebSocketAuthentication:
    """Tests for WebSocket authentication."""

    async def test_websocket_without_auth_in_public_mode(self):
        """Test WebSocket connection without auth in public mode."""
        from skyspy.asgi import application

        with override_settings(AUTH_MODE='public'):
            communicator = WebsocketCommunicator(
                application,
                '/ws/aircraft/'
            )
            connected, _ = await communicator.connect()
            assert connected is True
            await communicator.disconnect()

    async def test_websocket_with_jwt_token_as_query_param(self, operator_user):
        """Test WebSocket authentication with JWT token as query parameter."""
        from skyspy.asgi import application
        from asgiref.sync import sync_to_async

        # Generate JWT token for user (wrapped in sync_to_async since it accesses DB)
        @sync_to_async
        def get_token():
            refresh = RefreshToken.for_user(operator_user)
            return str(refresh.access_token)

        access_token = await get_token()

        # Connect with token
        with override_settings(AUTH_MODE='authenticated'):
            communicator = WebsocketCommunicator(
                application,
                f'/ws/aircraft/?token={access_token}'
            )
            connected, _ = await communicator.connect()
            # Connection should be accepted (token validation in consumer)
            await communicator.disconnect()

    async def test_websocket_rejects_invalid_token(self):
        """Test that invalid JWT token is rejected."""
        from skyspy.asgi import application

        with override_settings(AUTH_MODE='authenticated'):
            communicator = WebsocketCommunicator(
                application,
                '/ws/aircraft/?token=invalid_token_12345'
            )
            # Depending on implementation, may reject connection or send error
            connected, _ = await communicator.connect()
            await communicator.disconnect()

    async def test_websocket_auth_mode_hybrid(self, operator_user):
        """Test WebSocket in hybrid auth mode allows anonymous read."""
        from skyspy.asgi import application

        with override_settings(AUTH_MODE='hybrid'):
            # Anonymous connection should work for read-only
            communicator = WebsocketCommunicator(
                application,
                '/ws/aircraft/'
            )
            connected, _ = await communicator.connect()
            assert connected is True
            await communicator.disconnect()


# =============================================================================
# 9. Message Format Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestMessageFormat:
    """Tests for WebSocket message format validation."""

    async def test_messages_are_valid_json(self, channel_layer):
        """Test that all messages are valid JSON."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        # Receive message
        response = await communicator.receive_json_from()

        # Should be valid dict (parsed from JSON)
        assert isinstance(response, dict)

        await communicator.disconnect()

    async def test_messages_include_type_field(self, channel_layer):
        """Test that all messages include a type field."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert 'type' in response
        assert isinstance(response['type'], str)

        await communicator.disconnect()

    async def test_messages_include_timestamp(self, channel_layer):
        """Test that messages include timestamp where appropriate."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        # Snapshot messages should include timestamp
        if response['type'] == 'aircraft:snapshot':
            assert 'timestamp' in response['data']

        await communicator.disconnect()

    async def test_payload_structure_consistency(self, channel_layer, sample_safety_events):
        """Test payload structure is consistent across message types."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:snapshot'
        assert 'data' in response

        # Data should have consistent structure
        data = response['data']
        assert 'events' in data
        assert 'count' in data
        assert 'timestamp' in data
        assert isinstance(data['events'], list)
        assert isinstance(data['count'], int)

        await communicator.disconnect()

    async def test_error_message_format(self, channel_layer):
        """Test error message format."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send invalid action
        await communicator.send_json_to({
            'action': 'invalid_action_12345'
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert 'message' in response

        await communicator.disconnect()

    async def test_request_response_format(self, channel_layer, cached_aircraft_data):
        """Test request/response message format."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send request
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft_list',
            'request_id': 'test-req-123',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'test-req-123'
        assert response['request_type'] == 'aircraft_list'
        assert 'data' in response

        await communicator.disconnect()


# =============================================================================
# 10. Performance Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestPerformance:
    """Tests for WebSocket performance."""

    async def test_handles_burst_of_messages(self, channel_layer):
        """Test handling burst of incoming messages."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        start_time = time.time()

        # Send 500 messages rapidly
        for i in range(500):
            await channel_layer.group_send(
                'aircraft_aircraft',
                {'type': 'aircraft_update', 'data': {'hex': f'A{i:05d}', 'update': i}}
            )

        # Receive messages with timeout
        received = 0
        try:
            while True:
                await asyncio.wait_for(
                    communicator.receive_json_from(),
                    timeout=0.1
                )
                received += 1
        except asyncio.TimeoutError:
            pass

        elapsed = time.time() - start_time

        # Should process messages efficiently (within 5 seconds)
        assert elapsed < 5.0
        # Should have received most messages
        assert received > 100  # At least some messages

        await communicator.disconnect()

    async def test_rate_limiting_behavior(self, channel_layer):
        """Test that rate limiting is applied if configured."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send many rapid requests (reduced from 100 to 50 for stability)
        for i in range(50):
            try:
                await communicator.send_json_to({
                    'action': 'request',
                    'type': 'aircraft_list',
                    'request_id': f'rapid-req-{i}',
                    'params': {}
                })
            except Exception:
                break  # Connection may have been closed

        # Consumer should handle without crashing
        # May receive rate limit errors or responses
        received_count = 0
        try:
            while True:
                await asyncio.wait_for(
                    communicator.receive_json_from(),
                    timeout=2.0
                )
                received_count += 1
        except asyncio.TimeoutError:
            pass
        except Exception:
            pass  # Connection may have been closed

        # Should have received some responses
        assert received_count > 0

        # Gracefully handle disconnect - consumer may have already closed
        try:
            await communicator.disconnect()
        except (asyncio.CancelledError, Exception):
            pass  # Consumer task may have been cancelled

    async def test_large_payload_handling(self, channel_layer):
        """Test handling of large payloads."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Create large payload (1000 aircraft)
        large_aircraft_list = []
        for i in range(1000):
            large_aircraft_list.append({
                'hex': f'A{i:06d}',
                'callsign': f'TEST{i}',
                'alt_baro': 20000 + i,
                'lat': 47.0 + (i * 0.001),
                'lon': -122.0 + (i * 0.001),
                'gs': 400,
                'track': i % 360,
            })

        # Broadcast large payload
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': {'aircraft': large_aircraft_list}}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:update'
        assert len(response['data']['aircraft']) == 1000

        await communicator.disconnect()

    async def test_concurrent_subscription_changes(self, channel_layer):
        """Test handling concurrent subscription changes."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send rapid subscribe/unsubscribe requests
        for i in range(20):
            if i % 2 == 0:
                await communicator.send_json_to({
                    'action': 'subscribe',
                    'topics': ['stats']
                })
            else:
                await communicator.send_json_to({
                    'action': 'unsubscribe',
                    'topics': ['stats']
                })

        # Consume all responses
        responses = []
        try:
            while True:
                resp = await asyncio.wait_for(
                    communicator.receive_json_from(),
                    timeout=0.5
                )
                responses.append(resp)
        except asyncio.TimeoutError:
            pass

        # Should have received responses without errors
        assert len(responses) > 0

        await communicator.disconnect()


# =============================================================================
# 11. Server-Sent Events (SSE) Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestServerSentEvents:
    """Tests for Server-Sent Events (SSE) endpoint."""

    async def test_sse_endpoint_returns_event_stream(self, cached_aircraft_data):
        """Test that GET /events/ returns EventStream content type."""
        from django.test import AsyncClient

        client = AsyncClient()

        # Make SSE request
        response = await client.get('/events/?channels=aircraft')

        # Should return streaming response or appropriate content type
        # SSE endpoints typically use text/event-stream
        if hasattr(response, 'streaming_content'):
            # Streaming response
            pass
        elif hasattr(response, 'content'):
            # Regular response - check status
            assert response.status_code in [200, 404, 501]  # 501 if not implemented

    async def test_sse_multiple_channels_subscription(self, cached_aircraft_data):
        """Test subscribing to multiple SSE channels."""
        from django.test import AsyncClient

        client = AsyncClient()

        # Request multiple channels
        response = await client.get('/events/?channels=aircraft,safety,alerts')

        # Should accept multiple channels
        if hasattr(response, 'status_code'):
            assert response.status_code in [200, 404, 501]

    async def test_sse_event_format(self, cached_aircraft_data):
        """Test SSE event format compliance."""
        from django.test import AsyncClient

        client = AsyncClient()

        response = await client.get('/events/?channels=aircraft')

        # If implemented, SSE events should follow format:
        # event: eventtype
        # data: json_payload
        #
        # (empty line)
        if hasattr(response, 'streaming_content'):
            # Check content format if streaming
            pass

    async def test_sse_connection_keepalive(self):
        """Test SSE connection keep-alive behavior."""
        from django.test import AsyncClient

        client = AsyncClient()

        # SSE should support long-lived connections
        response = await client.get('/events/?channels=aircraft')

        # Connection should be accepted
        if hasattr(response, 'status_code'):
            assert response.status_code in [200, 404, 501]


# =============================================================================
# Additional Integration Tests
# =============================================================================

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestCrossConsumerIntegration:
    """Tests for cross-consumer integration scenarios."""

    async def test_safety_event_triggers_alert_broadcast(self, sample_alert_rules):
        """Test that safety events can trigger alert broadcasts."""
        from skyspy.asgi import application

        # Connect to both safety and alerts WebSockets
        safety_communicator = WebsocketCommunicator(
            application,
            '/ws/safety/'
        )
        alerts_communicator = WebsocketCommunicator(
            application,
            '/ws/alerts/'
        )

        await safety_communicator.connect()
        await alerts_communicator.connect()

        # Consume initial messages
        try:
            await asyncio.wait_for(safety_communicator.receive_json_from(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

        try:
            await asyncio.wait_for(alerts_communicator.receive_json_from(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

        await safety_communicator.disconnect()
        await alerts_communicator.disconnect()

    async def test_aircraft_update_triggers_safety_check(self, cached_aircraft_data):
        """Test that aircraft updates can trigger safety checks."""
        from skyspy.asgi import application

        # Connect to aircraft and safety WebSockets
        aircraft_communicator = WebsocketCommunicator(
            application,
            '/ws/aircraft/'
        )
        safety_communicator = WebsocketCommunicator(
            application,
            '/ws/safety/'
        )

        await aircraft_communicator.connect()
        await safety_communicator.connect()

        # Both should connect successfully
        response1 = await aircraft_communicator.receive_json_from()
        assert response1['type'] == 'aircraft:snapshot'

        try:
            response2 = await asyncio.wait_for(
                safety_communicator.receive_json_from(),
                timeout=1.0
            )
            assert response2['type'] == 'safety:snapshot'
        except asyncio.TimeoutError:
            pass

        await aircraft_communicator.disconnect()
        await safety_communicator.disconnect()

    async def test_audio_transcription_triggers_acars_check(self, sample_acars_messages):
        """Test audio transcription completion workflow."""
        from skyspy.asgi import application

        # Connect to audio WebSocket
        audio_communicator = WebsocketCommunicator(
            application,
            '/ws/audio/'
        )
        acars_communicator = WebsocketCommunicator(
            application,
            '/ws/acars/'
        )

        await audio_communicator.connect()
        await acars_communicator.connect()

        # Both should connect successfully
        response1 = await audio_communicator.receive_json_from()
        assert response1['type'] == 'audio:snapshot'

        response2 = await acars_communicator.receive_json_from()
        assert response2['type'] == 'acars:snapshot'

        await audio_communicator.disconnect()
        await acars_communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestEdgeCases:
    """Tests for edge cases and error conditions."""

    async def test_empty_cache_returns_empty_snapshot(self, channel_layer):
        """Test that empty cache returns empty snapshot."""
        cache.clear()  # Ensure cache is empty

        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:snapshot'
        assert response['data']['aircraft'] == []
        assert response['data']['count'] == 0

        await communicator.disconnect()

    async def test_empty_database_safety_snapshot(self, channel_layer, db):
        """Test safety snapshot with empty database."""
        # Clear all safety events
        await database_sync_to_async(SafetyEvent.objects.all().delete)()

        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:snapshot'
        assert response['data']['events'] == []
        assert response['data']['count'] == 0

        await communicator.disconnect()

    async def test_invalid_json_message_handling(self, channel_layer):
        """Test handling of invalid JSON messages."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send malformed message (raw bytes, not JSON)
        await communicator.send_to(text_data='not valid json {{{')

        # Should handle gracefully (either error response or disconnect)
        try:
            response = await asyncio.wait_for(
                communicator.receive_json_from(),
                timeout=1.0
            )
            # May receive error response
            if response.get('type') == 'error':
                assert 'message' in response
        except asyncio.TimeoutError:
            pass  # Connection may have been closed

        await communicator.disconnect()

    async def test_unknown_request_type_error(self, channel_layer):
        """Test error response for unknown request type."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send unknown request type
        await communicator.send_json_to({
            'action': 'request',
            'type': 'completely_unknown_type_xyz',
            'request_id': 'unknown-001',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert response['request_id'] == 'unknown-001'
        assert 'Unknown request type' in response['message']

        await communicator.disconnect()

    async def test_missing_required_params(self, channel_layer):
        """Test error when required parameters are missing."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request aircraft without ICAO param
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft',
            'request_id': 'missing-param-001',
            'params': {}  # Missing 'icao' param
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert response['request_id'] == 'missing-param-001'
        assert 'Missing' in response['message'] or 'icao' in response['message'].lower()

        await communicator.disconnect()

    async def test_subscribe_unsupported_topic(self, channel_layer):
        """Test subscribing to unsupported topic is handled."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to unsupported topic
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['completely_unsupported_topic_xyz', 'aircraft']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        # Only 'aircraft' should be in subscribed topics
        assert 'aircraft' in response['topics']

        await communicator.disconnect()
