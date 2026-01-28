"""
End-to-end tests for AcarsConsumer WebSocket.

Tests cover:
- WebSocket connection/disconnection
- Topic subscription/unsubscription (messages, vdlm2)
- ACARS message broadcasting
- Request/response handling (messages, stats, labels)
- Error handling
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timedelta
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from django.test import override_settings
from django.utils import timezone

from skyspy.channels.consumers.acars import AcarsConsumer
from skyspy.models import AcarsMessage


@pytest.fixture
def channel_layer():
    """Create an in-memory channel layer for testing."""
    from channels.layers import InMemoryChannelLayer
    return InMemoryChannelLayer()


@pytest.fixture
def sample_acars_messages(db):
    """Create sample ACARS messages for testing."""
    now = timezone.now()
    messages = [
        AcarsMessage.objects.create(
            source='acars',
            channel='131.550',
            frequency=131.550,
            icao_hex='ABC123',
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
        AcarsMessage.objects.create(
            source='acars',
            channel='131.550',
            frequency=131.550,
            icao_hex='GHI789',
            registration='N11111',
            callsign='AAL789',
            label='SA',
            text='WEATHER REQUEST',
            signal_level=-48.0,
            error_count=0,
            station_id='KORD',
        ),
    ]
    return messages


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAcarsConsumerConnection:
    """Tests for WebSocket connection lifecycle."""

    async def test_connect_accepts_websocket(self, channel_layer):
        """Test that WebSocket connection is accepted."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            connected, _ = await communicator.connect()
            assert connected is True
            await communicator.disconnect()

    async def test_connect_sends_initial_snapshot(self, channel_layer, sample_acars_messages):
        """Test that initial ACARS messages snapshot is sent on connect."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:snapshot'
            assert 'data' in response
            assert 'messages' in response['data']
            assert 'count' in response['data']
            assert 'timestamp' in response['data']
            assert response['data']['count'] >= 1

            await communicator.disconnect()

    async def test_connect_joins_default_all_topic(self, channel_layer):
        """Test that connection joins 'all' topic by default."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()  # Discard snapshot

            # Should be in messages group (expanded from 'all')
            await channel_layer.group_send(
                'acars_messages',
                {'type': 'acars_message', 'data': {'test': True}}
            )

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:message'

            await communicator.disconnect()

    async def test_connect_with_specific_topics(self, channel_layer):
        """Test connection with specific topics in query string."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages,vdlm2'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            # Should be in messages group
            await channel_layer.group_send(
                'acars_messages',
                {'type': 'acars_message', 'data': {'group': 'messages'}}
            )
            response = await communicator.receive_json_from()
            assert response['data']['group'] == 'messages'

            # Should be in vdlm2 group
            await channel_layer.group_send(
                'acars_vdlm2',
                {'type': 'acars_message', 'data': {'group': 'vdlm2'}}
            )
            response = await communicator.receive_json_from()
            assert response['data']['group'] == 'vdlm2'

            await communicator.disconnect()

    async def test_disconnect_leaves_groups(self, channel_layer):
        """Test that disconnect properly leaves all groups."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages'
            )
            await communicator.connect()
            await communicator.receive_json_from()
            await communicator.disconnect()

            # Sending to the group should not cause any issues
            await channel_layer.group_send(
                'acars_messages',
                {'type': 'acars_message', 'data': {'test': True}}
            )


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAcarsConsumerSubscription:
    """Tests for topic subscription and unsubscription."""

    async def test_subscribe_to_topics(self, channel_layer):
        """Test subscribing to additional topics."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            # Subscribe to vdlm2 topic
            await communicator.send_json_to({
                'action': 'subscribe',
                'topics': ['vdlm2']
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'subscribed'
            assert 'vdlm2' in response['topics']
            assert 'messages' in response['topics']

            await communicator.disconnect()

    async def test_unsubscribe_from_topics(self, channel_layer):
        """Test unsubscribing from topics."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages,vdlm2'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            # Unsubscribe from vdlm2
            await communicator.send_json_to({
                'action': 'unsubscribe',
                'topics': ['vdlm2']
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'unsubscribed'
            assert 'vdlm2' in response['topics']

            await communicator.disconnect()

    async def test_subscribe_all_supported_topics(self, channel_layer):
        """Test subscribing to all supported ACARS topics."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            # Subscribe to all topics
            await communicator.send_json_to({
                'action': 'subscribe',
                'topics': ['messages', 'vdlm2', 'all']
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'subscribed'
            assert 'messages' in response['topics']
            assert 'vdlm2' in response['topics']

            await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAcarsConsumerBroadcast:
    """Tests for message broadcasting."""

    async def test_acars_message_broadcast(self, channel_layer):
        """Test that ACARS messages are broadcast correctly."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            message_data = {
                'id': 1,
                'source': 'acars',
                'icao_hex': 'ABC123',
                'callsign': 'UAL123',
                'label': 'H1',
                'text': 'POSITION REPORT',
            }
            await channel_layer.group_send(
                'acars_messages',
                {'type': 'acars_message', 'data': message_data}
            )

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:message'
            assert response['data'] == message_data

            await communicator.disconnect()

    async def test_acars_snapshot_broadcast(self, channel_layer):
        """Test that snapshot messages are broadcast correctly."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            snapshot_data = {
                'messages': [{'id': 1}, {'id': 2}],
                'count': 2,
            }
            await channel_layer.group_send(
                'acars_messages',
                {'type': 'acars_snapshot', 'data': snapshot_data}
            )

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:snapshot'
            assert response['data'] == snapshot_data

            await communicator.disconnect()

    async def test_vdlm2_specific_topic_broadcast(self, channel_layer):
        """Test that VDL2-specific topic receives VDL2 messages."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=vdlm2'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            vdlm2_message = {
                'source': 'vdlm2',
                'icao_hex': 'DEF456',
                'label': 'Q0',
            }
            await channel_layer.group_send(
                'acars_vdlm2',
                {'type': 'acars_message', 'data': vdlm2_message}
            )

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:message'
            assert response['data']['source'] == 'vdlm2'

            await communicator.disconnect()

    async def test_multiple_consumers_receive_broadcast(self, channel_layer):
        """Test that multiple consumers in same group receive broadcasts."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator1 = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages'
            )
            communicator2 = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/?topics=messages'
            )

            await communicator1.connect()
            await communicator2.connect()
            await communicator1.receive_json_from()
            await communicator2.receive_json_from()

            message_data = {'id': 1, 'source': 'acars'}
            await channel_layer.group_send(
                'acars_messages',
                {'type': 'acars_message', 'data': message_data}
            )

            response1 = await communicator1.receive_json_from()
            response2 = await communicator2.receive_json_from()

            assert response1['type'] == 'acars:message'
            assert response2['type'] == 'acars:message'
            assert response1['data'] == response2['data']

            await communicator1.disconnect()
            await communicator2.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAcarsConsumerRequests:
    """Tests for request/response pattern."""

    async def test_request_messages(self, channel_layer, sample_acars_messages):
        """Test requesting ACARS messages."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'messages',
                'request_id': 'req-001',
                'params': {}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            assert response['request_id'] == 'req-001'
            assert response['request_type'] == 'messages'
            assert isinstance(response['data'], list)

            await communicator.disconnect()

    async def test_request_messages_by_icao(self, channel_layer, sample_acars_messages):
        """Test requesting messages filtered by ICAO."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'messages',
                'request_id': 'req-002',
                'params': {'icao': 'ABC123'}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            for msg in response['data']:
                assert msg['icao_hex'] == 'ABC123'

            await communicator.disconnect()

    async def test_request_messages_by_callsign(self, channel_layer, sample_acars_messages):
        """Test requesting messages filtered by callsign."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'messages',
                'request_id': 'req-003',
                'params': {'callsign': 'UAL'}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            for msg in response['data']:
                assert 'UAL' in msg['callsign'].upper()

            await communicator.disconnect()

    async def test_request_messages_by_label(self, channel_layer, sample_acars_messages):
        """Test requesting messages filtered by label."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'messages',
                'request_id': 'req-004',
                'params': {'label': 'H1'}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            for msg in response['data']:
                assert msg['label'] == 'H1'

            await communicator.disconnect()

    async def test_request_messages_by_source(self, channel_layer, sample_acars_messages):
        """Test requesting messages filtered by source."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'messages',
                'request_id': 'req-005',
                'params': {'source': 'vdlm2'}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            for msg in response['data']:
                assert msg['source'] == 'vdlm2'

            await communicator.disconnect()

    async def test_request_messages_with_limit(self, channel_layer, sample_acars_messages):
        """Test requesting messages with limit."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'messages',
                'request_id': 'req-006',
                'params': {'limit': 2}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            assert len(response['data']) <= 2

            await communicator.disconnect()

    async def test_request_stats(self, channel_layer, sample_acars_messages):
        """Test requesting ACARS statistics."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({
                'action': 'request',
                'type': 'stats',
                'request_id': 'req-007',
                'params': {}
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'response'
            assert response['request_id'] == 'req-007'
            assert response['request_type'] == 'stats'
            assert 'total_messages' in response['data']
            assert 'last_hour' in response['data']
            assert 'last_24h' in response['data']
            assert 'by_source' in response['data']
            assert 'top_labels' in response['data']
            assert 'timestamp' in response['data']

            await communicator.disconnect()

    async def test_request_labels(self, channel_layer):
        """Test requesting ACARS label reference data."""
        # Mock the ACARS_LABELS import
        mock_labels = {
            'H1': 'Position Report',
            'Q0': 'Pre-Departure Clearance',
            'SA': 'Weather Request',
        }
        with patch.dict('sys.modules', {'skyspy.data.message_labels': MagicMock(ACARS_LABELS=mock_labels)}):
            with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
                communicator = WebsocketCommunicator(
                    AcarsConsumer.as_asgi(),
                    '/ws/acars/'
                )
                await communicator.connect()
                await communicator.receive_json_from()

                await communicator.send_json_to({
                    'action': 'request',
                    'type': 'labels',
                    'request_id': 'req-008',
                    'params': {}
                })

                response = await communicator.receive_json_from()
                assert response['type'] == 'response'
                assert response['request_id'] == 'req-008'
                assert response['request_type'] == 'labels'
                # Data should be the ACARS_LABELS dictionary
                assert isinstance(response['data'], dict)

                await communicator.disconnect()

    async def test_request_unknown_type(self, channel_layer):
        """Test error response for unknown request type."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
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
class TestAcarsConsumerErrorHandling:
    """Tests for error handling scenarios."""

    async def test_unknown_action_returns_error(self, channel_layer):
        """Test that unknown action returns error message."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
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
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({'action': 'ping'})

            response = await communicator.receive_json_from()
            assert response['type'] == 'pong'

            await communicator.disconnect()

    async def test_empty_database_returns_empty_snapshot(self, channel_layer, db):
        """Test that empty database returns empty messages snapshot."""
        # Ensure no ACARS messages exist
        AcarsMessage.objects.all().delete()

        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:snapshot'
            assert response['data']['messages'] == []
            assert response['data']['count'] == 0

            await communicator.disconnect()

    async def test_message_serialization(self, channel_layer, sample_acars_messages):
        """Test that ACARS messages are properly serialized in snapshot."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()

            response = await communicator.receive_json_from()
            assert response['type'] == 'acars:snapshot'

            # Check that messages have all expected fields
            if response['data']['messages']:
                msg = response['data']['messages'][0]
                expected_fields = [
                    'id', 'timestamp', 'source', 'channel', 'frequency',
                    'icao_hex', 'registration', 'callsign', 'label',
                    'block_id', 'msg_num', 'ack', 'mode', 'text',
                    'decoded', 'signal_level', 'error_count', 'station_id'
                ]
                for field in expected_fields:
                    assert field in msg, f"Missing field: {field}"

            await communicator.disconnect()

    async def test_subscribe_unsupported_topic_ignored(self, channel_layer):
        """Test that unsupported topics are ignored during subscription."""
        with patch.object(AcarsConsumer, 'channel_layer', channel_layer):
            communicator = WebsocketCommunicator(
                AcarsConsumer.as_asgi(),
                '/ws/acars/'
            )
            await communicator.connect()
            await communicator.receive_json_from()

            # Try to subscribe to unsupported topic
            await communicator.send_json_to({
                'action': 'subscribe',
                'topics': ['nonexistent_topic', 'messages']
            })

            response = await communicator.receive_json_from()
            assert response['type'] == 'subscribed'
            # Only 'messages' should be in the list
            assert 'messages' in response['topics']

            await communicator.disconnect()
