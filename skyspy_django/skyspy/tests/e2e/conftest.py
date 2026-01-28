"""
Pytest fixtures for E2E tests.

Provides:
- Authenticated API clients (users with various roles)
- Test users with different permission levels
- API key authentication
- Mock OIDC provider
- Database fixtures for complete workflows
- WebSocket test communicators
"""
import os
import pytest
from datetime import timedelta
from unittest.mock import MagicMock, patch

import django
from django.conf import settings

# Configure Django
if not settings.configured:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skyspy.tests.test_settings')
    django.setup()

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from channels.testing import WebsocketCommunicator

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
    NotificationChannel,
)
from skyspy.models.auth import (
    SkyspyUser,
    Role,
    UserRole,
    APIKey,
    FeatureAccess,
    DEFAULT_ROLES,
)

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


# =============================================================================
# Database Setup
# =============================================================================

@pytest.fixture(scope='session')
def django_db_setup(django_db_blocker):
    """Set up test database - use PostgreSQL from test_settings."""
    # Database is configured in test_settings.py to use PostgreSQL
    pass


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before and after each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def auth_mode_hybrid():
    """Set auth mode to hybrid (default)."""
    with override_settings(AUTH_MODE='hybrid'):
        yield


@pytest.fixture
def auth_mode_public():
    """Set auth mode to public (no auth required)."""
    with override_settings(AUTH_MODE='public'):
        yield


@pytest.fixture
def auth_mode_authenticated():
    """Set auth mode to authenticated (auth always required)."""
    with override_settings(AUTH_MODE='authenticated'):
        yield


# =============================================================================
# Role Fixtures
# =============================================================================

@pytest.fixture
def viewer_role(db):
    """Create viewer role with read-only permissions."""
    role, _ = Role.objects.get_or_create(
        name='viewer',
        defaults={
            'display_name': DEFAULT_ROLES['viewer']['display_name'],
            'description': DEFAULT_ROLES['viewer']['description'],
            'permissions': DEFAULT_ROLES['viewer']['permissions'],
            'priority': DEFAULT_ROLES['viewer']['priority'],
            'is_system': True,
        }
    )
    return role


@pytest.fixture
def operator_role(db):
    """Create operator role with alert management."""
    role, _ = Role.objects.get_or_create(
        name='operator',
        defaults={
            'display_name': DEFAULT_ROLES['operator']['display_name'],
            'description': DEFAULT_ROLES['operator']['description'],
            'permissions': DEFAULT_ROLES['operator']['permissions'],
            'priority': DEFAULT_ROLES['operator']['priority'],
            'is_system': True,
        }
    )
    return role


@pytest.fixture
def analyst_role(db):
    """Create analyst role with extended access."""
    role, _ = Role.objects.get_or_create(
        name='analyst',
        defaults={
            'display_name': DEFAULT_ROLES['analyst']['display_name'],
            'description': DEFAULT_ROLES['analyst']['description'],
            'permissions': DEFAULT_ROLES['analyst']['permissions'],
            'priority': DEFAULT_ROLES['analyst']['priority'],
            'is_system': True,
        }
    )
    return role


@pytest.fixture
def admin_role(db):
    """Create admin role with full feature access."""
    role, _ = Role.objects.get_or_create(
        name='admin',
        defaults={
            'display_name': DEFAULT_ROLES['admin']['display_name'],
            'description': DEFAULT_ROLES['admin']['description'],
            'permissions': DEFAULT_ROLES['admin']['permissions'],
            'priority': DEFAULT_ROLES['admin']['priority'],
            'is_system': True,
        }
    )
    return role


@pytest.fixture
def superadmin_role(db):
    """Create superadmin role with all permissions."""
    role, _ = Role.objects.get_or_create(
        name='superadmin',
        defaults={
            'display_name': DEFAULT_ROLES['superadmin']['display_name'],
            'description': DEFAULT_ROLES['superadmin']['description'],
            'permissions': DEFAULT_ROLES['superadmin']['permissions'],
            'priority': DEFAULT_ROLES['superadmin']['priority'],
            'is_system': True,
        }
    )
    return role


@pytest.fixture
def all_roles(viewer_role, operator_role, analyst_role, admin_role, superadmin_role):
    """Create all default roles."""
    return {
        'viewer': viewer_role,
        'operator': operator_role,
        'analyst': analyst_role,
        'admin': admin_role,
        'superadmin': superadmin_role,
    }


# =============================================================================
# User Fixtures
# =============================================================================

@pytest.fixture
def create_user(db):
    """Factory fixture to create users with profiles."""
    def _create_user(
        username,
        password='testpass123',
        email=None,
        is_superuser=False,
        role=None,
        auth_provider='local'
    ):
        email = email or f'{username}@example.com'
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            is_superuser=is_superuser,
        )
        profile = SkyspyUser.objects.create(
            user=user,
            auth_provider=auth_provider,
            display_name=username.title(),
        )
        if role:
            UserRole.objects.create(user=user, role=role)
        return user, profile

    return _create_user


@pytest.fixture
def viewer_user(create_user, viewer_role):
    """Create a user with viewer role."""
    user, profile = create_user('viewer_user', role=viewer_role)
    return user


@pytest.fixture
def operator_user(create_user, operator_role):
    """Create a user with operator role."""
    user, profile = create_user('operator_user', role=operator_role)
    return user


@pytest.fixture
def analyst_user(create_user, analyst_role):
    """Create a user with analyst role."""
    user, profile = create_user('analyst_user', role=analyst_role)
    return user


@pytest.fixture
def admin_user(create_user, admin_role):
    """Create a user with admin role."""
    user, profile = create_user('admin_user', role=admin_role)
    return user


@pytest.fixture
def superadmin_user(create_user, superadmin_role):
    """Create a user with superadmin role."""
    user, profile = create_user('superadmin_user', role=superadmin_role)
    return user


@pytest.fixture
def django_superuser(create_user):
    """Create a Django superuser."""
    user, profile = create_user('django_super', is_superuser=True)
    return user


@pytest.fixture
def no_role_user(create_user):
    """Create a user with no roles assigned."""
    user, profile = create_user('no_role_user')
    return user


# =============================================================================
# Authenticated API Clients
# =============================================================================

def get_authenticated_client(user):
    """Create an authenticated API client for a user."""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


@pytest.fixture
def api_client():
    """Unauthenticated API client."""
    return APIClient()


@pytest.fixture
def viewer_client(viewer_user):
    """Authenticated API client with viewer role."""
    return get_authenticated_client(viewer_user)


@pytest.fixture
def operator_client(operator_user):
    """Authenticated API client with operator role."""
    return get_authenticated_client(operator_user)


@pytest.fixture
def analyst_client(analyst_user):
    """Authenticated API client with analyst role."""
    return get_authenticated_client(analyst_user)


@pytest.fixture
def admin_client(admin_user):
    """Authenticated API client with admin role."""
    return get_authenticated_client(admin_user)


@pytest.fixture
def superadmin_client(superadmin_user):
    """Authenticated API client with superadmin role."""
    return get_authenticated_client(superadmin_user)


@pytest.fixture
def superuser_client(django_superuser):
    """Authenticated API client as Django superuser."""
    return get_authenticated_client(django_superuser)


@pytest.fixture
def no_role_client(no_role_user):
    """Authenticated API client with no roles."""
    return get_authenticated_client(no_role_user)


# =============================================================================
# API Key Authentication
# =============================================================================

@pytest.fixture
def create_api_key(db):
    """Factory to create API keys."""
    def _create_api_key(user, name='Test Key', scopes=None, expires_days=None):
        key, key_hash, key_prefix = APIKey.generate_key()
        expires_at = None
        if expires_days:
            expires_at = timezone.now() + timedelta(days=expires_days)

        api_key = APIKey.objects.create(
            user=user,
            name=name,
            key_hash=key_hash,
            key_prefix=key_prefix,
            scopes=scopes or [],
            expires_at=expires_at,
        )
        return api_key, key  # Return the model and the raw key

    return _create_api_key


@pytest.fixture
def operator_api_key(operator_user, create_api_key):
    """API key for operator user."""
    api_key, raw_key = create_api_key(operator_user, name='Operator API Key')
    return api_key, raw_key


@pytest.fixture
def api_key_client(operator_api_key):
    """API client authenticated with API key."""
    api_key, raw_key = operator_api_key
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Api-Key {raw_key}')
    return client


@pytest.fixture
def expired_api_key(operator_user, create_api_key):
    """Expired API key."""
    api_key, raw_key = create_api_key(
        operator_user,
        name='Expired Key',
        expires_days=-1  # Expired yesterday
    )
    return api_key, raw_key


# =============================================================================
# OIDC Mock Fixtures
# =============================================================================

@pytest.fixture
def mock_oidc_provider():
    """Mock OIDC provider responses."""
    mock_config = {
        'issuer': 'https://auth.example.com',
        'authorization_endpoint': 'https://auth.example.com/authorize',
        'token_endpoint': 'https://auth.example.com/token',
        'userinfo_endpoint': 'https://auth.example.com/userinfo',
        'jwks_uri': 'https://auth.example.com/.well-known/jwks.json',
    }

    with patch('requests.get') as mock_get:
        mock_response = MagicMock()
        mock_response.json.return_value = mock_config
        mock_response.status_code = 200
        mock_get.return_value = mock_response
        yield mock_config


@pytest.fixture
def mock_oidc_token_response():
    """Mock OIDC token exchange response."""
    return {
        'access_token': 'mock_access_token_12345',
        'token_type': 'Bearer',
        'refresh_token': 'mock_refresh_token_67890',
        'expires_in': 3600,
        'id_token': 'mock.id.token',
    }


@pytest.fixture
def mock_oidc_userinfo():
    """Mock OIDC userinfo response."""
    return {
        'sub': 'oidc-user-12345',
        'email': 'oidc.user@example.com',
        'name': 'OIDC Test User',
        'preferred_username': 'oidc_user',
        'groups': ['skyspy-operators', 'skyspy-analysts'],
    }


# =============================================================================
# Feature Access Fixtures
# =============================================================================

@pytest.fixture
def feature_access_public(db):
    """Set all features to public access."""
    features = ['aircraft', 'alerts', 'safety', 'audio', 'acars', 'history', 'system']
    for feature in features:
        FeatureAccess.objects.update_or_create(
            feature=feature,
            defaults={
                'read_access': 'public',
                'write_access': 'public',
                'is_enabled': True,
            }
        )
    yield
    FeatureAccess.objects.all().delete()


@pytest.fixture
def feature_access_authenticated(db):
    """Set all features to require authentication."""
    features = ['aircraft', 'alerts', 'safety', 'audio', 'acars', 'history', 'system']
    for feature in features:
        FeatureAccess.objects.update_or_create(
            feature=feature,
            defaults={
                'read_access': 'authenticated',
                'write_access': 'authenticated',
                'is_enabled': True,
            }
        )
    yield
    FeatureAccess.objects.all().delete()


@pytest.fixture
def feature_access_permission_based(db):
    """Set all features to require specific permissions."""
    features = ['aircraft', 'alerts', 'safety', 'audio', 'acars', 'history', 'system']
    for feature in features:
        FeatureAccess.objects.update_or_create(
            feature=feature,
            defaults={
                'read_access': 'permission',
                'write_access': 'permission',
                'is_enabled': True,
            }
        )
    yield
    FeatureAccess.objects.all().delete()


# =============================================================================
# Alert Fixtures
# =============================================================================

@pytest.fixture
def sample_alert_rule(db, operator_user):
    """Create a sample alert rule owned by operator user."""
    return AlertRule.objects.create(
        name='Test Military Alert',
        rule_type='military',
        operator='eq',
        value='true',
        description='Alert for military aircraft',
        enabled=True,
        priority='warning',
        owner=operator_user,
        visibility='private',
    )


@pytest.fixture
def complex_alert_rule(db, operator_user):
    """Create an alert rule with complex conditions."""
    return AlertRule.objects.create(
        name='Complex Test Alert',
        conditions={
            'logic': 'AND',
            'groups': [
                {
                    'logic': 'OR',
                    'conditions': [
                        {'type': 'military', 'operator': 'eq', 'value': 'true'},
                        {'type': 'squawk', 'operator': 'eq', 'value': '7700'},
                    ]
                },
                {
                    'logic': 'AND',
                    'conditions': [
                        {'type': 'distance', 'operator': 'lt', 'value': '10'},
                        {'type': 'altitude', 'operator': 'lt', 'value': '15000'},
                    ]
                }
            ]
        },
        description='Complex multi-condition alert',
        enabled=True,
        priority='critical',
        owner=operator_user,
        visibility='shared',
    )


@pytest.fixture
def shared_alert_rule(db, admin_user):
    """Create a shared alert rule."""
    return AlertRule.objects.create(
        name='Shared Emergency Alert',
        rule_type='squawk',
        operator='in',
        value='7500,7600,7700',
        description='Shared alert for emergency squawks',
        enabled=True,
        priority='critical',
        owner=admin_user,
        visibility='shared',
    )


@pytest.fixture
def public_alert_rule(db, admin_user):
    """Create a public alert rule."""
    return AlertRule.objects.create(
        name='Public Proximity Alert',
        rule_type='distance',
        operator='lt',
        value='5',
        description='Public alert for nearby aircraft',
        enabled=True,
        priority='info',
        owner=admin_user,
        visibility='public',
    )


# =============================================================================
# Safety Event Fixtures
# =============================================================================

@pytest.fixture
def recent_safety_events(db):
    """Create safety events from the last 24 hours."""
    events = []
    now = timezone.now()
    event_types = ['tcas_ra', 'tcas_ta', '7700', '7600', 'proximity_conflict']

    for i, event_type in enumerate(event_types):
        event = SafetyEvent.objects.create(
            timestamp=now - timedelta(hours=i * 4),
            event_type=event_type,
            severity='critical' if event_type in ['tcas_ra', '7700'] else 'warning',
            icao_hex=f'A{i}1234',
            callsign=f'TEST{i}23',
            message=f'Test {event_type} event',
            details={'test': True},
            aircraft_snapshot={
                'hex': f'A{i}1234',
                'flight': f'TEST{i}23',
                'alt': 25000 + i * 1000,
                'lat': 47.0 + i * 0.1,
                'lon': -122.0,
            },
            acknowledged=False,
        )
        events.append(event)
    return events


@pytest.fixture
def proximity_event(db):
    """Create a proximity conflict event with two aircraft."""
    return SafetyEvent.objects.create(
        timestamp=timezone.now(),
        event_type='proximity_conflict',
        severity='warning',
        icao_hex='A11111',
        icao_hex_2='A22222',
        callsign='UAL100',
        callsign_2='DAL200',
        message='Proximity conflict detected',
        details={
            'horizontal_separation_nm': 0.5,
            'vertical_separation_ft': 200,
        },
        aircraft_snapshot={
            'hex': 'A11111',
            'flight': 'UAL100',
            'alt': 25000,
            'lat': 47.5,
            'lon': -122.0,
        },
        aircraft_snapshot_2={
            'hex': 'A22222',
            'flight': 'DAL200',
            'alt': 25200,
            'lat': 47.501,
            'lon': -122.001,
        },
        acknowledged=False,
    )


# =============================================================================
# Notification Fixtures
# =============================================================================

@pytest.fixture
def notification_channels(db, operator_user):
    """Create various notification channel types."""
    channels = []

    channel_configs = [
        ('Discord', 'discord', 'discord://webhook_id/webhook_token'),
        ('Slack', 'slack', 'slack://token_a/token_b/token_c'),
        ('Email', 'email', 'mailto://user:pass@smtp.example.com'),
        ('Pushover', 'pushover', 'pover://user@token'),
        ('ntfy', 'ntfy', 'ntfy://topic'),
    ]

    for name, channel_type, url in channel_configs:
        channel = NotificationChannel.objects.create(
            name=name,
            channel_type=channel_type,
            apprise_url=url,
            enabled=True,
            owner=operator_user,
        )
        channels.append(channel)

    return channels


@pytest.fixture
def global_notification_config(db):
    """Create global notification config."""
    config, _ = NotificationConfig.objects.get_or_create(
        pk=1,
        defaults={
            'apprise_urls': 'discord://test/webhook',
            'cooldown_seconds': 300,
            'enabled': True,
        }
    )
    return config


# =============================================================================
# Aircraft Data Fixtures
# =============================================================================

@pytest.fixture
def cached_aircraft():
    """Pre-populate cache with aircraft data."""
    aircraft_data = [
        {
            'hex': 'A12345',
            'flight': 'UAL123',
            'alt_baro': 35000,
            'gs': 450,
            'track': 270,
            'lat': 47.5,
            'lon': -122.0,
            'category': 'A3',
            't': 'B738',
            'rssi': -25.0,
            'distance_nm': 15.5,
            'dbFlags': 0,
        },
        {
            'hex': 'AE1234',
            'flight': 'RCH789',
            'alt_baro': 32000,
            'gs': 420,
            'track': 180,
            'lat': 48.0,
            'lon': -122.5,
            'category': 'A5',
            't': 'C17',
            'rssi': -30.0,
            'distance_nm': 25.0,
            'dbFlags': 1,  # Military
        },
        {
            'hex': 'A99999',
            'flight': 'N12345',
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
        },
    ]

    cache.set('current_aircraft', aircraft_data, timeout=300)
    cache.set('aircraft_timestamp', timezone.now().timestamp(), timeout=300)
    cache.set('aircraft_messages', 12345, timeout=300)
    cache.set('adsb_online', True, timeout=300)

    return aircraft_data


@pytest.fixture
def aircraft_sightings_batch(db):
    """Create a batch of aircraft sightings."""
    return AircraftSightingFactory.create_batch(50)


@pytest.fixture
def aircraft_sessions_batch(db):
    """Create a batch of aircraft sessions."""
    return AircraftSessionFactory.create_batch(20)


# =============================================================================
# ACARS Fixtures
# =============================================================================

@pytest.fixture
def acars_messages_batch(db):
    """Create a batch of ACARS messages."""
    return AcarsMessageFactory.create_batch(30)


# =============================================================================
# Audio Fixtures
# =============================================================================

@pytest.fixture
def audio_transmissions_batch(db):
    """Create a batch of audio transmissions."""
    transmissions = []
    for i in range(10):
        status = ['pending', 'queued', 'processing', 'completed', 'failed'][i % 5]
        if status == 'completed':
            t = AudioTransmissionFactory(completed=True)
        elif status == 'failed':
            t = AudioTransmissionFactory(failed=True)
        elif status == 'queued':
            t = AudioTransmissionFactory(queued=True)
        else:
            t = AudioTransmissionFactory()
        transmissions.append(t)
    return transmissions


# =============================================================================
# Mock External Services
# =============================================================================

@pytest.fixture
def mock_apprise():
    """Mock Apprise notification service."""
    with patch('apprise.Apprise') as mock_apprise_class:
        mock_instance = MagicMock()
        mock_instance.notify.return_value = True
        mock_apprise_class.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_httpx_requests():
    """Mock httpx for external API calls."""
    with patch('httpx.AsyncClient') as mock_client_class:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {}
        mock_client.get.return_value = mock_response
        mock_client.post.return_value = mock_response
        mock_client_class.return_value.__aenter__.return_value = mock_client
        yield mock_client


@pytest.fixture
def mock_whisper_service():
    """Mock Whisper transcription service."""
    with patch('httpx.post') as mock_post:
        mock_response = MagicMock()
        mock_response.json.return_value = {
            'text': 'United four five six, Seattle Tower, cleared for takeoff.',
            'confidence': 0.95,
            'language': 'en',
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        yield mock_post


# =============================================================================
# WebSocket Fixtures
# =============================================================================

@pytest.fixture
async def ws_aircraft_communicator():
    """WebSocket communicator for aircraft updates."""
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
async def ws_safety_communicator():
    """WebSocket communicator for safety events."""
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
async def ws_alerts_communicator():
    """WebSocket communicator for alert triggers."""
    from skyspy.asgi import application

    communicator = WebsocketCommunicator(
        application,
        '/ws/alerts/'
    )
    connected, _ = await communicator.connect()
    assert connected
    yield communicator
    await communicator.disconnect()


# =============================================================================
# Utility Functions
# =============================================================================

def create_jwt_token(user):
    """Create JWT token for a user."""
    refresh = RefreshToken.for_user(user)
    return str(refresh.access_token), str(refresh)


def make_authenticated_request(client, user, method, url, **kwargs):
    """Make an authenticated request as a specific user."""
    access_token, _ = create_jwt_token(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
    method_func = getattr(client, method.lower())
    return method_func(url, **kwargs)
