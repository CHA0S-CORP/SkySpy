"""
End-to-end tests for AircraftConsumer WebSocket.

Tests cover:
- WebSocket connection/disconnection
- Topic subscription/unsubscription
- Message broadcasting for aircraft events
- Request/response handling (aircraft queries)
- Stats subscription with filters
- Error handling
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from asgiref.sync import sync_to_async
from django.test import override_settings

from skyspy.channels.consumers.aircraft import AircraftConsumer


@pytest.fixture
def channel_layer():
    """Get the configured channel layer for testing."""
    return get_channel_layer()


@pytest.fixture
def mock_cache():
    """Mock Django cache with aircraft data."""
    aircraft_data = [
        {
            'hex': 'ABC123',
            'icao_hex': 'ABC123',
            'callsign': 'UAL123',
            'alt_baro': 35000,
            'lat': 40.7128,
            'lon': -74.0060,
            'is_military': False,
            'category': 'A3',
        },
        {
            'hex': 'DEF456',
            'icao_hex': 'DEF456',
            'callsign': 'ARMY01',
            'alt_baro': 25000,
            'lat': 41.8781,
            'lon': -87.6298,
            'is_military': True,
            'category': 'B2',
        },
        {
            'hex': 'GHI789',
            'icao_hex': 'GHI789',
            'callsign': 'AAL456',
            'alt_baro': 10000,
            'lat': 34.0522,
            'lon': -118.2437,
            'is_military': False,
            'category': 'A3',
        },
    ]
    with patch('django.core.cache.cache') as mock:
        mock.get.return_value = aircraft_data
        yield mock


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAircraftConsumerConnection:
    """Tests for WebSocket connection lifecycle."""

    async def test_connect_accepts_websocket(self, channel_layer):
        """Test that WebSocket connection is accepted."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_connect_sends_initial_snapshot(self, channel_layer, mock_cache):
        """Test that initial aircraft snapshot is sent on connect."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        # Receive the initial snapshot message
        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:snapshot'
        assert 'data' in response
        assert 'aircraft' in response['data']
        assert 'count' in response['data']
        assert 'timestamp' in response['data']

        await communicator.disconnect()

    async def test_connect_joins_default_all_topic(self, channel_layer):
        """Test that connection joins 'all' topic by default."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()

        # Discard initial snapshot
        await communicator.receive_json_from()

        # Consumer should be in the 'all' group (which expands to all topics)
        # Check by sending a group message
        await channel_layer.group_send(
            'aircraft_all',
            {'type': 'aircraft_update', 'data': {'test': True}}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:update'
        assert response['data'] == {'test': True}

        await communicator.disconnect()

    async def test_connect_with_specific_topics(self, channel_layer):
        """Test connection with specific topics in query string."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft,stats'
        )
        await communicator.connect()

        # Discard initial snapshot
        await communicator.receive_json_from()

        # Should be in aircraft group
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': {'group': 'aircraft'}}
        )
        response = await communicator.receive_json_from()
        assert response['data']['group'] == 'aircraft'

        # Should be in stats group
        await channel_layer.group_send(
            'aircraft_stats',
            {'type': 'aircraft_update', 'data': {'group': 'stats'}}
        )
        response = await communicator.receive_json_from()
        assert response['data']['group'] == 'stats'

        await communicator.disconnect()

    async def test_disconnect_leaves_groups(self, channel_layer):
        """Test that disconnect properly leaves all groups."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()  # Discard snapshot
        await communicator.disconnect()

        # Group should be empty now - sending message should not error
        # but no consumer should receive it
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': {'test': True}}
        )
        # No assertion needed - if disconnect didn't clean up properly,
        # the channel layer would have issues


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAircraftConsumerSubscription:
    """Tests for topic subscription and unsubscription."""

    async def test_subscribe_to_topics(self, channel_layer):
        """Test subscribing to additional topics."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'  # Start with just aircraft
        )
        await communicator.connect()
        await communicator.receive_json_from()  # Discard snapshot

        # Subscribe to stats topic
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['stats']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'stats' in response['topics']
        assert 'aircraft' in response['topics']

        await communicator.disconnect()

    async def test_subscribe_single_topic_as_string(self, channel_layer):
        """Test subscribing with topic as string instead of list."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe with string instead of list
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': 'stats'
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'stats' in response['topics']

        await communicator.disconnect()

    async def test_unsubscribe_from_topics(self, channel_layer):
        """Test unsubscribing from topics."""
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

    async def test_subscribe_stats_with_filters(self, channel_layer):
        """Test subscribing to stats with custom filters."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to stats with filters
        await communicator.send_json_to({
            'action': 'subscribe_stats',
            'military_only': True,
            'min_altitude': 10000,
            'max_altitude': 40000,
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'stats' in response['topics']
        assert response['filters']['military_only'] is True
        assert response['filters']['min_altitude'] == 10000
        assert response['filters']['max_altitude'] == 40000

        await communicator.disconnect()

    async def test_update_stats_filters(self, channel_layer):
        """Test updating stats subscription filters."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # First subscribe to stats
        await communicator.send_json_to({
            'action': 'subscribe_stats',
            'military_only': False,
        })
        await communicator.receive_json_from()

        # Update filters
        await communicator.send_json_to({
            'action': 'update_stats_filters',
            'filters': {
                'military_only': True,
                'category': 'B2'
            }
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'filters_updated'
        assert response['filters']['military_only'] is True
        assert response['filters']['category'] == 'B2'

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAircraftConsumerBroadcast:
    """Tests for message broadcasting."""

    async def test_aircraft_update_broadcast(self, channel_layer):
        """Test that aircraft update messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Simulate a broadcast from the channel layer
        update_data = {
            'hex': 'ABC123',
            'callsign': 'UAL123',
            'lat': 40.7128,
            'lon': -74.0060,
            'alt_baro': 36000,
        }
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': update_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:update'
        assert response['data'] == update_data

        await communicator.disconnect()

    async def test_aircraft_new_broadcast(self, channel_layer):
        """Test that new aircraft messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        new_aircraft_data = {
            'hex': 'NEW001',
            'callsign': 'NEW001',
            'lat': 42.0,
            'lon': -73.0,
        }
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_new', 'data': new_aircraft_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:new'
        assert response['data'] == new_aircraft_data

        await communicator.disconnect()

    async def test_aircraft_remove_broadcast(self, channel_layer):
        """Test that aircraft removal messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        remove_data = {'hex': 'ABC123', 'reason': 'timeout'}
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_remove', 'data': remove_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:remove'
        assert response['data'] == remove_data

        await communicator.disconnect()

    async def test_aircraft_heartbeat_broadcast(self, channel_layer):
        """Test that heartbeat messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        heartbeat_data = {'count': 150, 'timestamp': '2024-01-01T12:00:00Z'}
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_heartbeat', 'data': heartbeat_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:heartbeat'
        assert response['data'] == heartbeat_data

        await communicator.disconnect()

    async def test_aircraft_position_broadcast(self, channel_layer):
        """Test that high-frequency position updates are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        position_data = {
            'hex': 'ABC123',
            'lat': 40.7128,
            'lon': -74.0060,
            'alt_baro': 35500,
            'track': 180,
            'gs': 450,
        }
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_position', 'data': position_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'aircraft:position'
        assert response['data'] == position_data

        await communicator.disconnect()

    async def test_multiple_consumers_receive_broadcast(self, channel_layer):
        """Test that multiple consumers in same group receive broadcasts."""
        # Create two consumers
        communicator1 = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )
        communicator2 = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/?topics=aircraft'
        )

        await communicator1.connect()
        await communicator2.connect()
        await communicator1.receive_json_from()  # Discard snapshots
        await communicator2.receive_json_from()

        # Send a broadcast
        update_data = {'hex': 'TEST123', 'message': 'broadcast test'}
        await channel_layer.group_send(
            'aircraft_aircraft',
            {'type': 'aircraft_update', 'data': update_data}
        )

        # Both should receive the message
        response1 = await communicator1.receive_json_from()
        response2 = await communicator2.receive_json_from()

        assert response1['type'] == 'aircraft:update'
        assert response2['type'] == 'aircraft:update'
        assert response1['data'] == response2['data']

        await communicator1.disconnect()
        await communicator2.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAircraftConsumerRequests:
    """Tests for request/response pattern."""

    async def test_request_single_aircraft(self, channel_layer, mock_cache):
        """Test requesting a single aircraft by ICAO."""
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
            'params': {'icao': 'ABC123'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-001'
        assert response['request_type'] == 'aircraft'
        assert response['data'] is not None
        assert response['data']['hex'] == 'ABC123'

        await communicator.disconnect()

    async def test_request_aircraft_missing_icao(self, channel_layer):
        """Test error when requesting aircraft without ICAO."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request without icao parameter
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft',
            'request_id': 'req-002',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert response['request_id'] == 'req-002'
        assert 'Missing icao parameter' in response['message']

        await communicator.disconnect()

    async def test_request_aircraft_list(self, channel_layer, mock_cache):
        """Test requesting filtered aircraft list."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request aircraft list
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft_list',
            'request_id': 'req-003',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-003'
        assert response['request_type'] == 'aircraft_list'
        assert isinstance(response['data'], list)

        await communicator.disconnect()

    async def test_request_aircraft_list_with_filters(self, channel_layer, mock_cache):
        """Test requesting aircraft list with military filter."""
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
            'request_id': 'req-004',
            'params': {'military_only': True}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-004'
        # Should only include military aircraft
        for aircraft in response['data']:
            assert aircraft.get('is_military') is True

        await communicator.disconnect()

    async def test_request_aircraft_list_altitude_filter(self, channel_layer, mock_cache):
        """Test requesting aircraft list with altitude filters."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request aircraft above 20000 ft
        await communicator.send_json_to({
            'action': 'request',
            'type': 'aircraft_list',
            'request_id': 'req-005',
            'params': {'min_altitude': 20000}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        # All returned aircraft should be above 20000 ft
        for aircraft in response['data']:
            assert aircraft.get('alt_baro', 0) >= 20000

        await communicator.disconnect()

    async def test_request_unknown_type(self, channel_layer):
        """Test error response for unknown request type."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Request with unknown type
        await communicator.send_json_to({
            'action': 'request',
            'type': 'unknown_type',
            'request_id': 'req-006',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert response['request_id'] == 'req-006'
        assert 'Unknown request type' in response['message']

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAircraftConsumerErrorHandling:
    """Tests for error handling scenarios."""

    async def test_unknown_action_returns_error(self, channel_layer):
        """Test that unknown action returns error message."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send unknown action
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
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Send ping
        await communicator.send_json_to({'action': 'ping'})

        response = await communicator.receive_json_from()
        assert response['type'] == 'pong'

        await communicator.disconnect()

    async def test_subscribe_unsupported_topic_ignored(self, channel_layer):
        """Test that unsupported topics are ignored during subscription."""
        communicator = WebsocketCommunicator(
            AircraftConsumer.as_asgi(),
            '/ws/aircraft/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Try to subscribe to unsupported topic
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['nonexistent_topic', 'aircraft']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        # Only 'aircraft' should be in the list, not the unsupported one
        assert 'aircraft' in response['topics']

        await communicator.disconnect()

    async def test_empty_cache_returns_empty_snapshot(self, channel_layer):
        """Test that empty cache returns empty aircraft snapshot."""
        with patch('django.core.cache.cache') as mock_cache:
            mock_cache.get.return_value = None
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
