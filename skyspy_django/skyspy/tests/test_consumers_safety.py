"""
End-to-end tests for SafetyConsumer WebSocket.

Tests cover:
- WebSocket connection/disconnection
- Topic subscription/unsubscription (events, tcas, emergency)
- Safety event broadcasting
- Request/response handling (active events, history, acknowledge)
- Error handling
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timedelta
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from asgiref.sync import sync_to_async
from django.test import override_settings
from django.utils import timezone

from skyspy.channels.consumers.safety import SafetyConsumer
from skyspy.models import SafetyEvent


@pytest.fixture
def channel_layer():
    """Get the configured channel layer for testing."""
    return get_channel_layer()


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
            acknowledged=False,
        ),
        SafetyEvent.objects.create(
            event_type='emergency_squawk',
            severity='critical',
            icao_hex='GHI789',
            callsign='AAL789',
            message='Emergency squawk 7700 detected',
            details={'squawk': '7700'},
            acknowledged=False,
        ),
        SafetyEvent.objects.create(
            event_type='extreme_vs',
            severity='warning',
            icao_hex='JKL012',
            callsign='SWA012',
            message='Extreme vertical speed detected',
            details={'vertical_rate': -5000},
            acknowledged=True,
            acknowledged_at=now - timedelta(minutes=2),
        ),
    ]
    return events


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestSafetyConsumerConnection:
    """Tests for WebSocket connection lifecycle."""

    async def test_connect_accepts_websocket(self, channel_layer):
        """Test that WebSocket connection is accepted."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_connect_sends_initial_snapshot(self, channel_layer, sample_safety_events):
        """Test that initial safety events snapshot is sent on connect."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:snapshot'
        assert 'data' in response
        assert 'events' in response['data']
        assert 'count' in response['data']
        assert 'timestamp' in response['data']
        # Should include unacknowledged events from last 5 minutes
        assert response['data']['count'] >= 1

        await communicator.disconnect()

    async def test_connect_joins_default_all_topic(self, channel_layer):
        """Test that connection joins 'all' topic by default."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()  # Discard snapshot

        # Should be in all groups (expanded from 'all')
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event', 'data': {'test': True}}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event'

        await communicator.disconnect()

    async def test_connect_with_specific_topics(self, channel_layer):
        """Test connection with specific topics in query string."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=tcas,emergency'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Should be in tcas group
        await channel_layer.group_send(
            'safety_tcas',
            {'type': 'safety_event', 'data': {'group': 'tcas'}}
        )
        response = await communicator.receive_json_from()
        assert response['data']['group'] == 'tcas'

        # Should be in emergency group
        await channel_layer.group_send(
            'safety_emergency',
            {'type': 'safety_event', 'data': {'group': 'emergency'}}
        )
        response = await communicator.receive_json_from()
        assert response['data']['group'] == 'emergency'

        await communicator.disconnect()

    async def test_disconnect_leaves_groups(self, channel_layer):
        """Test that disconnect properly leaves all groups."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()
        await communicator.disconnect()

        # Sending to the group should not cause any issues
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event', 'data': {'test': True}}
        )


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestSafetyConsumerSubscription:
    """Tests for topic subscription and unsubscription."""

    async def test_subscribe_to_topics(self, channel_layer):
        """Test subscribing to additional topics."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to tcas topic
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['tcas']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'tcas' in response['topics']
        assert 'events' in response['topics']

        await communicator.disconnect()

    async def test_unsubscribe_from_topics(self, channel_layer):
        """Test unsubscribing from topics."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events,tcas'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Unsubscribe from tcas
        await communicator.send_json_to({
            'action': 'unsubscribe',
            'topics': ['tcas']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'unsubscribed'
        assert 'tcas' in response['topics']

        await communicator.disconnect()

    async def test_subscribe_all_supported_topics(self, channel_layer):
        """Test subscribing to all supported safety topics."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to all topics
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['events', 'tcas', 'emergency', 'all']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        # When 'all' is included, all supported topics should be subscribed
        assert 'events' in response['topics']
        assert 'tcas' in response['topics']
        assert 'emergency' in response['topics']

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestSafetyConsumerBroadcast:
    """Tests for message broadcasting."""

    async def test_safety_event_broadcast(self, channel_layer):
        """Test that safety event messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        event_data = {
            'id': 1,
            'event_type': 'tcas_ra',
            'severity': 'critical',
            'icao_hex': 'ABC123',
            'callsign': 'UAL123',
            'message': 'TCAS RA detected',
        }
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event', 'data': event_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event'
        assert response['data'] == event_data

        await communicator.disconnect()

    async def test_safety_event_updated_broadcast(self, channel_layer):
        """Test that event update messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        update_data = {
            'id': 1,
            'event_type': 'tcas_ra',
            'severity': 'warning',  # Downgraded
            'icao_hex': 'ABC123',
        }
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event_updated', 'data': update_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event_updated'
        assert response['data'] == update_data

        await communicator.disconnect()

    async def test_safety_event_resolved_broadcast(self, channel_layer):
        """Test that event resolution messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        resolved_data = {
            'id': 1,
            'event_type': 'tcas_ra',
            'resolution': 'Aircraft separated',
        }
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event_resolved', 'data': resolved_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event_resolved'
        assert response['data'] == resolved_data

        await communicator.disconnect()

    async def test_safety_snapshot_broadcast(self, channel_layer):
        """Test that snapshot messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        snapshot_data = {
            'events': [{'id': 1}, {'id': 2}],
            'count': 2,
        }
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_snapshot', 'data': snapshot_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:snapshot'
        assert response['data'] == snapshot_data

        await communicator.disconnect()

    async def test_tcas_specific_topic_broadcast(self, channel_layer):
        """Test that TCAS-specific topic receives TCAS events."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=tcas'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        tcas_event = {
            'event_type': 'tcas_ra',
            'icao_hex': 'ABC123',
        }
        await channel_layer.group_send(
            'safety_tcas',
            {'type': 'safety_event', 'data': tcas_event}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'safety:event'
        assert response['data']['event_type'] == 'tcas_ra'

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestSafetyConsumerRequests:
    """Tests for request/response pattern."""

    async def test_request_active_events(self, channel_layer, sample_safety_events):
        """Test requesting active safety events."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'active_events',
            'request_id': 'req-001',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-001'
        assert response['request_type'] == 'active_events'
        assert isinstance(response['data'], list)

        await communicator.disconnect()

    async def test_request_active_events_with_type_filter(self, channel_layer, sample_safety_events):
        """Test requesting active events filtered by type."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'active_events',
            'request_id': 'req-002',
            'params': {'event_type': 'tcas_ra'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-002'
        # All returned events should be TCAS RA
        for event in response['data']:
            assert event['event_type'] == 'tcas_ra'

        await communicator.disconnect()

    async def test_request_active_events_with_severity_filter(self, channel_layer, sample_safety_events):
        """Test requesting active events filtered by severity."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'active_events',
            'request_id': 'req-003',
            'params': {'severity': 'critical'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        # All returned events should be critical
        for event in response['data']:
            assert event['severity'] == 'critical'

        await communicator.disconnect()

    async def test_request_event_history(self, channel_layer, sample_safety_events):
        """Test requesting event history."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'event_history',
            'request_id': 'req-004',
            'params': {'limit': 10}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-004'
        assert response['request_type'] == 'event_history'
        assert isinstance(response['data'], list)
        assert len(response['data']) <= 10

        await communicator.disconnect()

    async def test_request_event_history_by_icao(self, channel_layer, sample_safety_events):
        """Test requesting event history for specific ICAO."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'event_history',
            'request_id': 'req-005',
            'params': {'icao': 'ABC123'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        # All returned events should involve ABC123
        for event in response['data']:
            assert event['icao_hex'] == 'ABC123'

        await communicator.disconnect()

    async def test_acknowledge_event(self, channel_layer, sample_safety_events):
        """Test acknowledging a safety event."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Get an unacknowledged event
        event = await sync_to_async(SafetyEvent.objects.filter(acknowledged=False).first)()
        assert event is not None

        await communicator.send_json_to({
            'action': 'request',
            'type': 'acknowledge',
            'request_id': 'req-006',
            'params': {'event_id': event.id}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-006'
        assert response['request_type'] == 'acknowledge'
        assert response['data']['success'] is True
        assert response['data']['event_id'] == event.id

        # Verify event is now acknowledged in database
        await sync_to_async(event.refresh_from_db)()
        assert event.acknowledged is True
        assert event.acknowledged_at is not None

        await communicator.disconnect()

    async def test_acknowledge_event_missing_id(self, channel_layer):
        """Test error when acknowledging without event_id."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'acknowledge',
            'request_id': 'req-007',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert response['request_id'] == 'req-007'
        assert 'Missing event_id' in response['message']

        await communicator.disconnect()

    async def test_acknowledge_nonexistent_event(self, channel_layer):
        """Test acknowledging a non-existent event."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'acknowledge',
            'request_id': 'req-008',
            'params': {'event_id': 999999}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['data']['success'] is False
        assert 'not found' in response['data']['error']

        await communicator.disconnect()

    async def test_request_unknown_type(self, channel_layer):
        """Test error response for unknown request type."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'unknown_type',
            'request_id': 'req-009',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert 'Unknown request type' in response['message']

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestSafetyConsumerErrorHandling:
    """Tests for error handling scenarios."""

    async def test_unknown_action_returns_error(self, channel_layer):
        """Test that unknown action returns error message."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'invalid_action'
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert 'Unknown action' in response['message']

        await communicator.disconnect()

    async def test_ping_pong(self, channel_layer):
        """Test ping/pong heartbeat functionality."""
        communicator = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({'action': 'ping'})

        response = await communicator.receive_json_from()
        assert response['type'] == 'pong'

        await communicator.disconnect()

    async def test_empty_database_returns_empty_snapshot(self, channel_layer, db):
        """Test that empty database returns empty events snapshot."""
        # Ensure no safety events exist
        await sync_to_async(SafetyEvent.objects.all().delete)()

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

    async def test_multiple_consumers_receive_broadcast(self, channel_layer):
        """Test that multiple consumers in same group receive broadcasts."""
        communicator1 = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )
        communicator2 = WebsocketCommunicator(
            SafetyConsumer.as_asgi(),
            '/ws/safety/?topics=events'
        )

        await communicator1.connect()
        await communicator2.connect()
        await communicator1.receive_json_from()
        await communicator2.receive_json_from()

        event_data = {'id': 1, 'event_type': 'tcas_ra'}
        await channel_layer.group_send(
            'safety_events',
            {'type': 'safety_event', 'data': event_data}
        )

        response1 = await communicator1.receive_json_from()
        response2 = await communicator2.receive_json_from()

        assert response1['type'] == 'safety:event'
        assert response2['type'] == 'safety:event'
        assert response1['data'] == response2['data']

        await communicator1.disconnect()
        await communicator2.disconnect()
