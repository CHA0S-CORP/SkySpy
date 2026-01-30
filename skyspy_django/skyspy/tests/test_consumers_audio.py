"""
End-to-end tests for AudioConsumer WebSocket.

Tests cover:
- WebSocket connection/disconnection
- Topic subscription/unsubscription (transmissions, transcriptions)
- Audio transmission and transcription broadcasting
- Request/response handling (transmissions, stats)
- Error handling
"""
import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timedelta
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from asgiref.sync import sync_to_async
from django.test import override_settings
from django.utils import timezone

from skyspy.channels.consumers.audio import AudioConsumer
from skyspy.models import AudioTransmission

# Mark tests that are flaky when running locally (without Redis)
_IS_LOCAL = not os.environ.get('DATABASE_URL')


@pytest.fixture
def channel_layer():
    """Get the configured channel layer for testing."""
    return get_channel_layer()


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
        AudioTransmission.objects.create(
            filename='transmission_004.mp3',
            s3_key='audio/2024/01/transmission_004.mp3',
            s3_url='https://s3.example.com/audio/2024/01/transmission_004.mp3',
            file_size_bytes=122880,
            duration_seconds=5.5,
            format='mp3',
            frequency_mhz=121.5,
            channel_name='KJFK Tower',
            transcription_status='failed',
            transcription_error='Audio quality too low for transcription',
        ),
    ]
    return transmissions


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAudioConsumerConnection:
    """Tests for WebSocket connection lifecycle."""

    async def test_connect_accepts_websocket(self, channel_layer):
        """Test that WebSocket connection is accepted."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.disconnect()

    async def test_connect_sends_initial_snapshot(self, channel_layer, sample_audio_transmissions):
        """Test that initial audio snapshot is sent on connect."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:snapshot'
        assert 'data' in response
        assert 'recent_transmissions' in response['data']
        assert 'pending_transcriptions' in response['data']
        assert 'timestamp' in response['data']

        await communicator.disconnect()

    async def test_connect_joins_default_all_topic(self, channel_layer):
        """Test that connection joins 'all' topic by default."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()  # Discard snapshot

        # Should be in transmissions group (expanded from 'all')
        await channel_layer.group_send(
            'audio_transmissions',
            {'type': 'audio_transmission', 'data': {'test': True}}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transmission'

        await communicator.disconnect()

    async def test_connect_with_specific_topics(self, channel_layer):
        """Test connection with specific topics in query string."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions,transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Should be in transmissions group
        await channel_layer.group_send(
            'audio_transmissions',
            {'type': 'audio_transmission', 'data': {'group': 'transmissions'}}
        )
        response = await communicator.receive_json_from()
        assert response['data']['group'] == 'transmissions'

        # Should be in transcriptions group
        await channel_layer.group_send(
            'audio_transcriptions',
            {'type': 'audio_transcription_completed', 'data': {'group': 'transcriptions'}}
        )
        response = await communicator.receive_json_from()
        assert response['data']['group'] == 'transcriptions'

        await communicator.disconnect()

    async def test_disconnect_leaves_groups(self, channel_layer):
        """Test that disconnect properly leaves all groups."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions'
        )
        await communicator.connect()
        await communicator.receive_json_from()
        await communicator.disconnect()

        # Sending to the group should not cause any issues
        await channel_layer.group_send(
            'audio_transmissions',
            {'type': 'audio_transmission', 'data': {'test': True}}
        )


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAudioConsumerSubscription:
    """Tests for topic subscription and unsubscription."""

    async def test_subscribe_to_topics(self, channel_layer):
        """Test subscribing to additional topics."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to transcriptions topic
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['transcriptions']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'transcriptions' in response['topics']
        assert 'transmissions' in response['topics']

        await communicator.disconnect()

    async def test_unsubscribe_from_topics(self, channel_layer):
        """Test unsubscribing from topics."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions,transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Unsubscribe from transcriptions
        await communicator.send_json_to({
            'action': 'unsubscribe',
            'topics': ['transcriptions']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'unsubscribed'
        assert 'transcriptions' in response['topics']

        await communicator.disconnect()

    async def test_subscribe_all_supported_topics(self, channel_layer):
        """Test subscribing to all supported audio topics."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Subscribe to all topics
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['transmissions', 'transcriptions', 'all']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        assert 'transmissions' in response['topics']
        assert 'transcriptions' in response['topics']

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAudioConsumerBroadcast:
    """Tests for message broadcasting."""

    async def test_audio_transmission_broadcast(self, channel_layer):
        """Test that new transmission messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        transmission_data = {
            'id': 1,
            'filename': 'test.mp3',
            'frequency_mhz': 121.5,
            'channel_name': 'Tower',
            'duration_seconds': 10.5,
        }
        await channel_layer.group_send(
            'audio_transmissions',
            {'type': 'audio_transmission', 'data': transmission_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transmission'
        assert response['data'] == transmission_data

        await communicator.disconnect()

    async def test_transcription_started_broadcast(self, channel_layer):
        """Test that transcription started messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        event_data = {
            'transmission_id': 1,
            'status': 'processing',
            'started_at': '2024-01-01T12:00:00Z',
        }
        await channel_layer.group_send(
            'audio_transcriptions',
            {'type': 'audio_transcription_started', 'data': event_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transcription_started'
        assert response['data'] == event_data

        await communicator.disconnect()

    async def test_transcription_completed_broadcast(self, channel_layer):
        """Test that transcription completed messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        event_data = {
            'transmission_id': 1,
            'status': 'completed',
            'transcript': 'United 123 cleared for takeoff',
            'confidence': 0.95,
            'completed_at': '2024-01-01T12:02:00Z',
        }
        await channel_layer.group_send(
            'audio_transcriptions',
            {'type': 'audio_transcription_completed', 'data': event_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transcription_completed'
        assert response['data'] == event_data

        await communicator.disconnect()

    async def test_transcription_failed_broadcast(self, channel_layer):
        """Test that transcription failed messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transcriptions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        event_data = {
            'transmission_id': 1,
            'status': 'failed',
            'error': 'Audio quality too low',
            'failed_at': '2024-01-01T12:02:00Z',
        }
        await channel_layer.group_send(
            'audio_transcriptions',
            {'type': 'audio_transcription_failed', 'data': event_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:transcription_failed'
        assert response['data'] == event_data

        await communicator.disconnect()

    @pytest.mark.skipif(_IS_LOCAL, reason="Flaky timeout in local testing without Redis")
    async def test_audio_snapshot_broadcast(self, channel_layer):
        """Test that snapshot messages are broadcast correctly."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        snapshot_data = {
            'recent_transmissions': [{'id': 1}, {'id': 2}],
            'pending_transcriptions': 3,
        }
        await channel_layer.group_send(
            'audio_transmissions',
            {'type': 'audio_snapshot', 'data': snapshot_data}
        )

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:snapshot'
        assert response['data'] == snapshot_data

        await communicator.disconnect()

    async def test_multiple_consumers_receive_broadcast(self, channel_layer):
        """Test that multiple consumers in same group receive broadcasts."""
        communicator1 = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions'
        )
        communicator2 = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/?topics=transmissions'
        )

        await communicator1.connect()
        await communicator2.connect()
        await communicator1.receive_json_from()
        await communicator2.receive_json_from()

        transmission_data = {'id': 1, 'filename': 'test.mp3'}
        await channel_layer.group_send(
            'audio_transmissions',
            {'type': 'audio_transmission', 'data': transmission_data}
        )

        response1 = await communicator1.receive_json_from()
        response2 = await communicator2.receive_json_from()

        assert response1['type'] == 'audio:transmission'
        assert response2['type'] == 'audio:transmission'
        assert response1['data'] == response2['data']

        await communicator1.disconnect()
        await communicator2.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAudioConsumerRequests:
    """Tests for request/response pattern."""

    async def test_request_transmissions(self, channel_layer, sample_audio_transmissions):
        """Test requesting audio transmissions."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-001',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-001'
        assert response['request_type'] == 'transmissions'
        assert isinstance(response['data'], list)

        await communicator.disconnect()

    async def test_request_transmissions_by_frequency(self, channel_layer, sample_audio_transmissions):
        """Test requesting transmissions filtered by frequency."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-002',
            'params': {'frequency': 121.5}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        for trans in response['data']:
            assert trans['frequency_mhz'] == 121.5

        await communicator.disconnect()

    async def test_request_transmissions_by_channel_name(self, channel_layer, sample_audio_transmissions):
        """Test requesting transmissions filtered by channel name."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-003',
            'params': {'channel_name': 'KJFK'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        for trans in response['data']:
            assert 'KJFK' in trans['channel_name']

        await communicator.disconnect()

    async def test_request_transmissions_by_status(self, channel_layer, sample_audio_transmissions):
        """Test requesting transmissions filtered by transcription status."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-004',
            'params': {'transcription_status': 'completed'}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        for trans in response['data']:
            assert trans['transcription_status'] == 'completed'

        await communicator.disconnect()

    async def test_request_transmissions_with_limit(self, channel_layer, sample_audio_transmissions):
        """Test requesting transmissions with limit."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmissions',
            'request_id': 'req-005',
            'params': {'limit': 2}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert len(response['data']) <= 2

        await communicator.disconnect()

    async def test_request_single_transmission(self, channel_layer, sample_audio_transmissions):
        """Test requesting a single transmission by ID."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Get a transmission ID from the database
        transmission = await sync_to_async(AudioTransmission.objects.first)()
        assert transmission is not None

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmission',
            'request_id': 'req-006',
            'params': {'id': transmission.id}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-006'
        assert response['request_type'] == 'transmission'
        assert response['data'] is not None
        assert response['data']['id'] == transmission.id

        await communicator.disconnect()

    async def test_request_single_transmission_missing_id(self, channel_layer):
        """Test error when requesting transmission without ID."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmission',
            'request_id': 'req-007',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert response['request_id'] == 'req-007'
        assert 'Missing id parameter' in response['message']

        await communicator.disconnect()

    async def test_request_nonexistent_transmission(self, channel_layer):
        """Test requesting a non-existent transmission."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'transmission',
            'request_id': 'req-008',
            'params': {'id': 999999}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['data'] is None

        await communicator.disconnect()

    async def test_request_stats(self, channel_layer, sample_audio_transmissions):
        """Test requesting audio statistics."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'stats',
            'request_id': 'req-009',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'response'
        assert response['request_id'] == 'req-009'
        assert response['request_type'] == 'stats'
        assert 'total_transmissions' in response['data']
        assert 'last_24h' in response['data']
        assert 'total_duration_seconds' in response['data']
        assert 'status_counts' in response['data']
        assert 'top_frequencies' in response['data']
        assert 'timestamp' in response['data']

        await communicator.disconnect()

    async def test_request_unknown_type(self, channel_layer):
        """Test error response for unknown request type."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({
            'action': 'request',
            'type': 'unknown_type',
            'request_id': 'req-010',
            'params': {}
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'error'
        assert 'Unknown request type' in response['message']

        await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
class TestAudioConsumerErrorHandling:
    """Tests for error handling scenarios."""

    async def test_unknown_action_returns_error(self, channel_layer):
        """Test that unknown action returns error message."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
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
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        await communicator.send_json_to({'action': 'ping'})

        response = await communicator.receive_json_from()
        assert response['type'] == 'pong'

        await communicator.disconnect()

    async def test_empty_database_returns_empty_snapshot(self, channel_layer, db):
        """Test that empty database returns empty transmissions snapshot."""
        # Ensure no audio transmissions exist
        await sync_to_async(AudioTransmission.objects.all().delete)()

        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:snapshot'
        assert response['data']['recent_transmissions'] == []
        assert response['data']['pending_transcriptions'] == 0

        await communicator.disconnect()

    async def test_transmission_serialization(self, channel_layer, sample_audio_transmissions):
        """Test that audio transmissions are properly serialized in snapshot."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:snapshot'

        # Check that transmissions have all expected fields
        if response['data']['recent_transmissions']:
            trans = response['data']['recent_transmissions'][0]
            expected_fields = [
                'id', 'created_at', 'filename', 's3_url', 'file_size_bytes',
                'duration_seconds', 'format', 'frequency_mhz', 'channel_name',
                'squelch_level', 'transcription_status', 'transcription_queued_at',
                'transcription_completed_at', 'transcript', 'transcript_confidence',
                'transcript_language', 'identified_airframes'
            ]
            for field in expected_fields:
                assert field in trans, f"Missing field: {field}"

        await communicator.disconnect()

    async def test_subscribe_unsupported_topic_ignored(self, channel_layer):
        """Test that unsupported topics are ignored during subscription."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()
        await communicator.receive_json_from()

        # Try to subscribe to unsupported topic
        await communicator.send_json_to({
            'action': 'subscribe',
            'topics': ['nonexistent_topic', 'transmissions']
        })

        response = await communicator.receive_json_from()
        assert response['type'] == 'subscribed'
        # Only 'transmissions' should be in the list
        assert 'transmissions' in response['topics']

        await communicator.disconnect()

    async def test_pending_transcriptions_count(self, channel_layer, sample_audio_transmissions):
        """Test that pending transcriptions count includes correct statuses."""
        communicator = WebsocketCommunicator(
            AudioConsumer.as_asgi(),
            '/ws/audio/'
        )
        await communicator.connect()

        response = await communicator.receive_json_from()
        assert response['type'] == 'audio:snapshot'

        # Count pending, queued, and processing statuses
        expected_pending = await sync_to_async(
            AudioTransmission.objects.filter(
                transcription_status__in=['pending', 'queued', 'processing']
            ).count
        )()
        assert response['data']['pending_transcriptions'] == expected_pending

        await communicator.disconnect()
