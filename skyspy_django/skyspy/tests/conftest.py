"""
Pytest fixtures for SkysPy integration tests.

This module provides reusable fixtures for:
- Database fixtures (aircraft, alerts, safety events, ACARS messages)
- API client fixtures
- WebSocket client fixtures
- Mocked external services
- Test settings overrides
"""
import asyncio
import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

# Configure Django before importing models
import django
from django.conf import settings

# Ensure Django is configured
if not settings.configured:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skyspy.tests.test_settings')
    django.setup()

from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import Client, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

# Import factories (after Django setup)
from skyspy.tests.factories import (
    AircraftSightingFactory,
    AircraftSessionFactory,
    AircraftInfoFactory,
    AlertRuleFactory,
    AlertHistoryFactory,
    SafetyEventFactory,
    AcarsMessageFactory,
    AudioTransmissionFactory,
    NotificationConfigFactory,
    NotificationLogFactory,
)

# Import models (after Django setup)
from skyspy.models import (
    AircraftSighting,
    AircraftSession,
    AircraftInfo,
    AlertRule,
    AlertHistory,
    SafetyEvent,
    AcarsMessage,
    AudioTransmission,
    NotificationConfig,
    NotificationLog,
)

# Import consumers (after Django setup)
from skyspy.channels.consumers.aircraft import AircraftConsumer
from skyspy.channels.consumers.safety import SafetyConsumer
from skyspy.channels.consumers.acars import AcarsConsumer
from skyspy.channels.consumers.audio import AudioConsumer


# =============================================================================
# Test Configuration Fixtures
# =============================================================================

@pytest.fixture(scope='session')
def django_db_setup():
    """
    Set up test database.

    When DATABASE_URL is set (e.g., in Docker), use the configured PostgreSQL database.
    Otherwise, fall back to SQLite in-memory for local testing.
    """
    import os
    if not os.environ.get('DATABASE_URL'):
        # Only use SQLite for local testing without DATABASE_URL
        settings.DATABASES['default'] = {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': ':memory:',
            'TIME_ZONE': 'UTC',
            'ATOMIC_REQUESTS': False,
            'AUTOCOMMIT': True,
            'CONN_MAX_AGE': 0,
            'CONN_HEALTH_CHECKS': False,
            'OPTIONS': {},
            'TEST': {'NAME': ':memory:'},
        }
    # When DATABASE_URL is set, test_settings.py already configures the database


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def temp_audio_dir():
    """Create temporary directory for audio files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with override_settings(RADIO_AUDIO_DIR=tmpdir):
            yield tmpdir


@pytest.fixture
def temp_photo_dir():
    """Create temporary directory for photo cache."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with override_settings(PHOTO_CACHE_DIR=tmpdir):
            yield tmpdir


# =============================================================================
# API Client Fixtures
# =============================================================================

@pytest.fixture
def api_client():
    """Provide Django REST Framework test client."""
    return APIClient()


@pytest.fixture
def django_client():
    """Provide Django test client."""
    return Client()


# =============================================================================
# WebSocket Client Fixtures
# =============================================================================

@pytest.fixture
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def aircraft_communicator():
    """Create WebSocket communicator for aircraft consumer."""
    from skyspy.asgi import application

    communicator = WebsocketCommunicator(
        application,
        '/ws/aircraft/'
    )
    connected, _ = await communicator.connect()
    assert connected

    yield communicator

    await communicator.disconnect()


@pytest.fixture
async def safety_communicator():
    """Create WebSocket communicator for safety consumer."""
    from skyspy.asgi import application

    communicator = WebsocketCommunicator(
        application,
        '/ws/safety/'
    )
    connected, _ = await communicator.connect()
    assert connected

    yield communicator

    await communicator.disconnect()


@pytest.fixture
async def acars_communicator():
    """Create WebSocket communicator for ACARS consumer."""
    from skyspy.asgi import application

    communicator = WebsocketCommunicator(
        application,
        '/ws/acars/'
    )
    connected, _ = await communicator.connect()
    assert connected

    yield communicator

    await communicator.disconnect()


@pytest.fixture
async def audio_communicator():
    """Create WebSocket communicator for audio consumer."""
    from skyspy.asgi import application

    communicator = WebsocketCommunicator(
        application,
        '/ws/audio/'
    )
    connected, _ = await communicator.connect()
    assert connected

    yield communicator

    await communicator.disconnect()


@pytest.fixture
def channel_layer():
    """Provide access to the channel layer."""
    return get_channel_layer()


# =============================================================================
# Database Model Fixtures
# =============================================================================

@pytest.fixture
def aircraft_sighting(db):
    """Create a single aircraft sighting."""
    return AircraftSightingFactory()


@pytest.fixture
def aircraft_sightings(db):
    """Create multiple aircraft sightings."""
    return AircraftSightingFactory.create_batch(10)


@pytest.fixture
def aircraft_session(db):
    """Create a single aircraft session."""
    return AircraftSessionFactory()


@pytest.fixture
def aircraft_sessions(db):
    """Create multiple aircraft sessions."""
    return AircraftSessionFactory.create_batch(5)


@pytest.fixture
def aircraft_info(db):
    """Create aircraft info record."""
    return AircraftInfoFactory()


@pytest.fixture
def military_aircraft_info(db):
    """Create military aircraft info record."""
    return AircraftInfoFactory(military=True)


@pytest.fixture
def alert_rule(db):
    """Create a single alert rule."""
    return AlertRuleFactory()


@pytest.fixture
def alert_rules(db):
    """Create multiple alert rules."""
    return AlertRuleFactory.create_batch(5)


@pytest.fixture
def complex_alert_rule(db):
    """Create an alert rule with complex conditions."""
    return AlertRuleFactory(complex=True)


@pytest.fixture
def alert_history(db):
    """Create alert history record."""
    return AlertHistoryFactory()


@pytest.fixture
def safety_event(db):
    """Create a single safety event."""
    return SafetyEventFactory()


@pytest.fixture
def safety_events(db):
    """Create multiple safety events."""
    return SafetyEventFactory.create_batch(5)


@pytest.fixture
def tcas_event(db):
    """Create TCAS safety event."""
    return SafetyEventFactory(tcas=True)


@pytest.fixture
def proximity_event(db):
    """Create proximity conflict event."""
    return SafetyEventFactory(proximity=True)


@pytest.fixture
def emergency_event(db):
    """Create emergency squawk event."""
    return SafetyEventFactory(emergency=True)


@pytest.fixture
def acars_message(db):
    """Create a single ACARS message."""
    return AcarsMessageFactory()


@pytest.fixture
def acars_messages(db):
    """Create multiple ACARS messages."""
    return AcarsMessageFactory.create_batch(10)


@pytest.fixture
def position_acars(db):
    """Create position report ACARS message."""
    return AcarsMessageFactory(position=True)


@pytest.fixture
def audio_transmission(db):
    """Create audio transmission record."""
    return AudioTransmissionFactory()


@pytest.fixture
def queued_transcription(db):
    """Create queued transcription."""
    return AudioTransmissionFactory(queued=True)


@pytest.fixture
def completed_transcription(db):
    """Create completed transcription."""
    return AudioTransmissionFactory(completed=True)


@pytest.fixture
def failed_transcription(db):
    """Create failed transcription."""
    return AudioTransmissionFactory(failed=True)


@pytest.fixture
def notification_config(db):
    """Create notification config."""
    return NotificationConfigFactory()


@pytest.fixture
def notification_log(db):
    """Create notification log entry."""
    return NotificationLogFactory()


# =============================================================================
# Mock Aircraft Data Fixtures
# =============================================================================

@pytest.fixture
def mock_aircraft_data():
    """Generate mock aircraft data as returned by ultrafeeder."""
    return [
        {
            'hex': 'A12345',
            'flight': 'UAL123',
            'alt_baro': 35000,
            'alt_geom': 35200,
            'gs': 450,
            'track': 270,
            'baro_rate': 0,
            'squawk': '4521',
            'lat': 47.5,
            'lon': -122.0,
            'category': 'A3',
            't': 'B738',
            'rssi': -25.0,
            'distance_nm': 15.5,
            'dbFlags': 0,
        },
        {
            'hex': 'A67890',
            'flight': 'DAL456',
            'alt_baro': 28000,
            'alt_geom': 28100,
            'gs': 480,
            'track': 90,
            'baro_rate': -1500,
            'squawk': '1200',
            'lat': 47.8,
            'lon': -121.5,
            'category': 'A3',
            't': 'A320',
            'rssi': -22.0,
            'distance_nm': 8.2,
            'dbFlags': 0,
        },
        {
            'hex': 'AE1234',
            'flight': 'RCH789',
            'alt_baro': 32000,
            'alt_geom': 32100,
            'gs': 420,
            'track': 180,
            'baro_rate': 500,
            'squawk': '4000',
            'lat': 48.0,
            'lon': -122.5,
            'category': 'A5',
            't': 'C17',
            'rssi': -30.0,
            'distance_nm': 25.0,
            'dbFlags': 1,  # Military flag
        },
    ]


@pytest.fixture
def mock_emergency_aircraft():
    """Generate mock aircraft with emergency squawk."""
    return {
        'hex': 'A99999',
        'flight': 'N12345',
        'alt_baro': 8000,
        'alt_geom': 8100,
        'gs': 120,
        'track': 45,
        'baro_rate': -2000,
        'squawk': '7700',
        'lat': 47.9,
        'lon': -121.9,
        'category': 'A1',
        't': 'C172',
        'rssi': -15.0,
        'distance_nm': 2.5,
        'dbFlags': 0,
    }


@pytest.fixture
def mock_proximity_aircraft():
    """Generate two aircraft in close proximity."""
    return [
        {
            'hex': 'A11111',
            'flight': 'UAL100',
            'alt_baro': 25000,
            'alt_geom': 25100,
            'gs': 450,
            'track': 270,
            'baro_rate': 0,
            'squawk': '4521',
            'lat': 47.9377,
            'lon': -121.9687,
            'category': 'A3',
            't': 'B738',
            'rssi': -20.0,
            'distance_nm': 0.2,
            'dbFlags': 0,
        },
        {
            'hex': 'A22222',
            'flight': 'DAL200',
            'alt_baro': 25200,
            'alt_geom': 25300,
            'gs': 460,
            'track': 90,
            'baro_rate': 0,
            'squawk': '4522',
            'lat': 47.9380,
            'lon': -121.9680,
            'category': 'A3',
            't': 'A320',
            'rssi': -22.0,
            'distance_nm': 0.25,
            'dbFlags': 0,
        },
    ]


# =============================================================================
# Mock ACARS Data Fixtures
# =============================================================================

@pytest.fixture
def mock_acars_message():
    """Generate mock ACARS message as received from acars_router."""
    return {
        'timestamp': datetime.utcnow().timestamp(),
        'channel': '1',
        'freq': 129.125,
        'icao': 'A12345',
        'tail': 'N12345',
        'flight': 'UAL123',
        'label': 'Q0',
        'block_id': '1',
        'msgno': 'M001',
        'ack': 'NAK',
        'mode': '2',
        'text': 'POS N4756.3W12158.2,ALT 35000,SPD 450,HDG 270',
        'level': -25.0,
        'error': 0,
        'station_id': 'test-station',
    }


@pytest.fixture
def mock_vdlm2_message():
    """Generate mock VDL2 message (dumpvdl2 format)."""
    return {
        'timestamp': datetime.utcnow().timestamp(),
        'vdl2': {
            't': {'sec': datetime.utcnow().timestamp()},
            'channel': 1,
            'freq': 136.975,
            'sig_level': -20.0,
            'noise_level': 0,
            'avlc': {
                'src': {'addr': 'A67890'},
                'acars': {
                    'reg': 'N67890',
                    'flight': 'DAL456',
                    'label': 'H1',
                    'blk_id': '2',
                    'msg_num': 'M002',
                    'ack': '!',
                    'mode': 'X',
                    'msg_text': 'REQUEST SIGMET ROUTE',
                }
            }
        },
        'station_id': 'test-station',
    }


# =============================================================================
# Mock External Service Fixtures
# =============================================================================

@pytest.fixture
def mock_ultrafeeder(mock_aircraft_data):
    """Mock ultrafeeder HTTP responses."""
    response_data = {
        'now': datetime.utcnow().timestamp(),
        'messages': 12345,
        'aircraft': mock_aircraft_data,
    }

    with patch('httpx.get') as mock_get:
        mock_response = MagicMock()
        mock_response.json.return_value = response_data
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        yield mock_get


@pytest.fixture
def mock_whisper_service():
    """Mock Whisper transcription service."""
    with patch('httpx.post') as mock_post:
        mock_response = MagicMock()
        mock_response.json.return_value = {
            'text': 'United four five six, Seattle Tower, cleared for takeoff.',
            'confidence': 0.95,
            'language': 'en',
            'segments': [
                {'start': 0.0, 'end': 2.5, 'text': 'United four five six,'},
                {'start': 2.5, 'end': 5.0, 'text': 'Seattle Tower, cleared for takeoff.'},
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        yield mock_post


@pytest.fixture
def mock_apprise():
    """Mock Apprise notification service."""
    with patch('apprise.Apprise') as mock_apprise_class:
        mock_instance = MagicMock()
        mock_instance.notify.return_value = True
        mock_apprise_class.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_webhook():
    """Mock external webhook calls."""
    with patch('httpx.post') as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        yield mock_post


# =============================================================================
# Service Instance Fixtures
# =============================================================================

@pytest.fixture
def alert_service():
    """Provide fresh AlertService instance."""
    from skyspy.services.alerts import AlertService
    return AlertService()


@pytest.fixture
def safety_monitor():
    """Provide fresh SafetyMonitor instance."""
    from skyspy.services.safety import SafetyMonitor
    return SafetyMonitor()


@pytest.fixture
def acars_service():
    """Provide fresh AcarsService instance."""
    from skyspy.services.acars import AcarsService
    return AcarsService()


# =============================================================================
# Cache State Fixtures
# =============================================================================

@pytest.fixture
def cached_aircraft(mock_aircraft_data):
    """Pre-populate cache with aircraft data."""
    cache.set('current_aircraft', mock_aircraft_data, timeout=30)
    cache.set('aircraft_timestamp', datetime.utcnow().timestamp(), timeout=30)
    cache.set('aircraft_messages', 12345, timeout=30)
    cache.set('adsb_online', True, timeout=30)
    yield mock_aircraft_data


# =============================================================================
# Helper Fixtures
# =============================================================================

@pytest.fixture
def sample_audio_file(temp_audio_dir):
    """Create a sample audio file for testing."""
    filename = 'test_transmission.mp3'
    filepath = os.path.join(temp_audio_dir, filename)

    # Create a minimal valid MP3-like file (just header bytes for testing)
    with open(filepath, 'wb') as f:
        # MP3 sync word and minimal frame header
        f.write(b'\xff\xfb\x90\x00' + b'\x00' * 1000)

    return filepath


@pytest.fixture
def bulk_aircraft_sightings(db):
    """Create a large batch of sightings for performance testing."""
    return AircraftSightingFactory.create_batch(100)


@pytest.fixture
def recent_safety_events(db):
    """Create safety events from the last 24 hours."""
    events = []
    now = timezone.now()
    for i in range(10):
        event = SafetyEventFactory(
            timestamp=now - timedelta(hours=i * 2)
        )
        events.append(event)
    return events


# =============================================================================
# Async Helper Functions
# =============================================================================

async def receive_json_with_timeout(communicator, timeout=1.0):
    """Receive JSON from communicator with timeout."""
    try:
        response = await asyncio.wait_for(
            communicator.receive_json_from(),
            timeout=timeout
        )
        return response
    except asyncio.TimeoutError:
        return None


async def send_and_receive(communicator, message, timeout=1.0):
    """Send message and receive response."""
    await communicator.send_json_to(message)
    return await receive_json_with_timeout(communicator, timeout)


# Export helper functions
@pytest.fixture
def ws_helpers():
    """Provide WebSocket helper functions."""
    return {
        'receive_json_with_timeout': receive_json_with_timeout,
        'send_and_receive': send_and_receive,
    }
