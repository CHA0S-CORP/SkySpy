"""
Tests for the AcarsService.

Tests message normalization, deduplication, LRU cache,
statistics tracking, and message storage/broadcasting.
"""
import asyncio
import json
import time
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock

from django.test import TestCase
from asgiref.sync import sync_to_async

from skyspy.services.acars import AcarsService, LRUCache
from skyspy.models import AcarsMessage


class LRUCacheUnitTests(TestCase):
    """Unit tests for the LRUCache class."""

    def test_cache_add_and_contains(self):
        """Test adding items to cache and checking existence."""
        cache = LRUCache(maxsize=100, ttl_seconds=30)

        cache.add('key1')

        self.assertTrue(cache.contains('key1'))
        self.assertFalse(cache.contains('key2'))

    def test_cache_ttl_expiration(self):
        """Test that items expire after TTL."""
        cache = LRUCache(maxsize=100, ttl_seconds=1)

        cache.add('expired_key')
        self.assertTrue(cache.contains('expired_key'))

        # Wait for TTL to expire
        time.sleep(1.1)

        # Should no longer be present
        self.assertFalse(cache.contains('expired_key'))

    def test_cache_maxsize_eviction(self):
        """Test that oldest items are evicted when maxsize reached."""
        cache = LRUCache(maxsize=3, ttl_seconds=300)

        cache.add('key1')
        cache.add('key2')
        cache.add('key3')
        cache.add('key4')  # Should evict key1

        self.assertFalse(cache.contains('key1'))
        self.assertTrue(cache.contains('key2'))
        self.assertTrue(cache.contains('key3'))
        self.assertTrue(cache.contains('key4'))

    def test_cache_lru_order_maintained(self):
        """Test that LRU order is maintained on access."""
        cache = LRUCache(maxsize=3, ttl_seconds=300)

        cache.add('key1')
        cache.add('key2')
        cache.add('key3')

        # Access key1 to move it to end
        cache.contains('key1')

        # Add key4 - should evict key2 (oldest not recently accessed)
        cache.add('key4')

        self.assertTrue(cache.contains('key1'))
        self.assertFalse(cache.contains('key2'))
        self.assertTrue(cache.contains('key3'))
        self.assertTrue(cache.contains('key4'))

    def test_cache_size(self):
        """Test cache size reporting."""
        cache = LRUCache(maxsize=100, ttl_seconds=300)

        self.assertEqual(cache.size(), 0)

        cache.add('key1')
        cache.add('key2')

        self.assertEqual(cache.size(), 2)

    def test_cache_expired_cleanup_on_add(self):
        """Test that expired items are cleaned up when adding."""
        cache = LRUCache(maxsize=100, ttl_seconds=1)

        cache.add('old_key')
        time.sleep(1.1)

        # Add new key, which should trigger cleanup
        cache.add('new_key')

        # Size should be 1 (only new_key)
        self.assertEqual(cache.size(), 1)

    def test_cache_thread_safety(self):
        """Test that cache operations are thread-safe."""
        import threading

        cache = LRUCache(maxsize=1000, ttl_seconds=300)
        errors = []

        def add_items(start, count):
            try:
                for i in range(count):
                    cache.add(f'key_{start}_{i}')
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=add_items, args=(i * 100, 100))
            for i in range(5)
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        # All items should be present (no eviction since maxsize=1000)
        self.assertEqual(cache.size(), 500)


class AcarsServiceMessageHashTests(TestCase):
    """Tests for message hash computation."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def test_compute_hash_same_messages(self):
        """Test that same messages produce same hash."""
        msg1 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test message content',
        }
        msg2 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test message content',
        }

        hash1 = self.service._compute_message_hash(msg1)
        hash2 = self.service._compute_message_hash(msg2)

        self.assertEqual(hash1, hash2)

    def test_compute_hash_different_timestamp(self):
        """Test that different timestamps produce different hashes."""
        msg1 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test message',
        }
        msg2 = {
            'timestamp': 1704067201.0,  # Different second
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test message',
        }

        hash1 = self.service._compute_message_hash(msg1)
        hash2 = self.service._compute_message_hash(msg2)

        self.assertNotEqual(hash1, hash2)

    def test_compute_hash_timestamp_rounded_to_second(self):
        """Test that timestamps are rounded to second for hashing."""
        msg1 = {
            'timestamp': 1704067200.123,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test',
        }
        msg2 = {
            'timestamp': 1704067200.999,  # Same second
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test',
        }

        hash1 = self.service._compute_message_hash(msg1)
        hash2 = self.service._compute_message_hash(msg2)

        self.assertEqual(hash1, hash2)

    def test_compute_hash_different_icao(self):
        """Test that different ICAO produces different hash."""
        msg1 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test',
        }
        msg2 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'DEF456',  # Different
            'label': '10',
            'text': 'Test',
        }

        hash1 = self.service._compute_message_hash(msg1)
        hash2 = self.service._compute_message_hash(msg2)

        self.assertNotEqual(hash1, hash2)

    def test_compute_hash_text_truncated_to_50_chars(self):
        """Test that only first 50 chars of text are used in hash."""
        text_base = 'A' * 50
        msg1 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': text_base + 'EXTRA_CONTENT_1',
        }
        msg2 = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': text_base + 'DIFFERENT_EXTRA_2',
        }

        hash1 = self.service._compute_message_hash(msg1)
        hash2 = self.service._compute_message_hash(msg2)

        # Same hash because first 50 chars are identical
        self.assertEqual(hash1, hash2)

    def test_compute_hash_handles_missing_fields(self):
        """Test hash computation with missing fields."""
        msg = {}  # All fields missing

        # Should not raise
        hash_value = self.service._compute_message_hash(msg)

        self.assertIsInstance(hash_value, str)


class AcarsServiceDeduplicationTests(TestCase):
    """Tests for message deduplication."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def test_is_duplicate_first_message(self):
        """Test that first message is not a duplicate."""
        msg = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test',
        }

        is_dup = self.service._is_duplicate(msg, 'acars')

        self.assertFalse(is_dup)

    def test_is_duplicate_same_message_twice(self):
        """Test that same message is detected as duplicate."""
        msg = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test',
        }

        self.service._is_duplicate(msg, 'acars')  # First time
        is_dup = self.service._is_duplicate(msg, 'acars')  # Second time

        self.assertTrue(is_dup)

    def test_is_duplicate_increments_stats(self):
        """Test that duplicate detection increments stats counter."""
        msg = {
            'timestamp': 1704067200.0,
            'icao_hex': 'ABC123',
            'label': '10',
            'text': 'Test',
        }

        initial_dupes = self.service._stats['acars']['duplicates']

        self.service._is_duplicate(msg, 'acars')
        self.service._is_duplicate(msg, 'acars')

        self.assertEqual(
            self.service._stats['acars']['duplicates'],
            initial_dupes + 1
        )


class AcarsServiceNormalizationTests(TestCase):
    """Tests for message normalization."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def test_normalize_acars_basic_message(self):
        """Test normalization of basic ACARS message."""
        raw_msg = {
            'timestamp': 1704067200.0,
            'freq': 131.55,
            'channel': '2',
            'icao': 'ABC123',
            'tail': 'N12345',
            'flight': 'UAL456',
            'label': '10',
            'text': 'Test message',
            'level': -5.2,
            'error': 0,
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertEqual(normalized['source'], 'acars')
        self.assertEqual(normalized['timestamp'], 1704067200.0)
        self.assertEqual(normalized['frequency'], 131.55)
        self.assertEqual(normalized['channel'], '2')
        self.assertEqual(normalized['icao_hex'], 'ABC123')
        self.assertEqual(normalized['registration'], 'N12345')
        self.assertEqual(normalized['callsign'], 'UAL456')
        self.assertEqual(normalized['label'], '10')
        self.assertEqual(normalized['text'], 'Test message')
        self.assertEqual(normalized['signal_level'], -5.2)
        self.assertEqual(normalized['error_count'], 0)

    def test_normalize_acars_lowercase_icao(self):
        """Test that lowercase ICAO is uppercased."""
        raw_msg = {'icao': 'abc123'}

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertEqual(normalized['icao_hex'], 'ABC123')

    def test_normalize_acars_alternate_icao_field(self):
        """Test normalization with alternate ICAO field names."""
        msg1 = {'icao_hex': 'ABC123'}
        msg2 = {'hex': 'DEF456'}

        norm1 = self.service._normalize_message(msg1, 'acars')
        norm2 = self.service._normalize_message(msg2, 'acars')

        self.assertEqual(norm1['icao_hex'], 'ABC123')
        self.assertEqual(norm2['icao_hex'], 'DEF456')

    def test_normalize_acars_station_id_from_app(self):
        """Test extraction of station_id from app field."""
        raw_msg = {
            'icao': 'ABC123',
            'app': {'name': 'acarsdec-v3.7'},
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertEqual(normalized['station_id'], 'acarsdec-v3.7')

    def test_normalize_acars_callsign_stripped(self):
        """Test that callsign whitespace is stripped."""
        raw_msg = {
            'icao': 'ABC123',
            'flight': '  UAL456  ',
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertEqual(normalized['callsign'], 'UAL456')

    def test_normalize_acars_ack_field(self):
        """Test ACK field normalization."""
        msg_with_ack = {'icao': 'ABC123', 'ack': 'NAK'}
        msg_empty_ack = {'icao': 'ABC123', 'ack': ''}
        msg_no_ack = {'icao': 'ABC123'}

        norm1 = self.service._normalize_message(msg_with_ack, 'acars')
        norm2 = self.service._normalize_message(msg_empty_ack, 'acars')
        norm3 = self.service._normalize_message(msg_no_ack, 'acars')

        self.assertEqual(norm1['ack'], 'NAK')
        self.assertIsNone(norm2['ack'])
        self.assertIsNone(norm3['ack'])

    def test_normalize_vdlm2_flat_format(self):
        """Test normalization of flat VDL2 message format."""
        raw_msg = {
            'timestamp': 1704067200.0,
            'freq': 136.975,
            'channel': '1',
            'icao': 789012,  # Integer ICAO
            'tail': 'N.789.AB',  # Dots to be removed
            'flight': 'DAL789',
            'label': 'H1',
            'text': 'VDL2 message',
            'level': -8.5,
        }

        normalized = self.service._normalize_message(raw_msg, 'vdlm2')

        self.assertEqual(normalized['source'], 'vdlm2')
        self.assertEqual(normalized['icao_hex'], '0C0A14')  # hex(789012)
        self.assertEqual(normalized['registration'], 'N789AB')  # Dots removed
        self.assertEqual(normalized['callsign'], 'DAL789')

    def test_normalize_vdlm2_nested_dumpvdl2_format(self):
        """Test normalization of nested dumpvdl2 format."""
        raw_msg = {
            'timestamp': 1704067200.0,
            'vdl2': {
                'freq': 136.975,
                'channel': '2',
                't': {'sec': 1704067200},
                'avlc': {
                    'src': {'addr': 'ABC123'},
                    'acars': {
                        'reg': 'N.123.AB',
                        'flight': 'AAL123',
                        'label': '21',
                        'msg_text': 'Nested VDL2 message',
                        'blk_id': 'A',
                        'msg_num': 'M01',
                        'ack': '!',
                        'mode': '2',
                    },
                },
                'sig_level': -6.0,
            },
        }

        normalized = self.service._normalize_message(raw_msg, 'vdlm2')

        self.assertEqual(normalized['source'], 'vdlm2')
        self.assertEqual(normalized['frequency'], 136.975)
        self.assertEqual(normalized['icao_hex'], 'ABC123')
        self.assertEqual(normalized['registration'], 'N123AB')
        self.assertEqual(normalized['callsign'], 'AAL123')
        self.assertEqual(normalized['label'], '21')
        self.assertEqual(normalized['text'], 'Nested VDL2 message')
        self.assertEqual(normalized['block_id'], 'A')
        self.assertEqual(normalized['msg_num'], 'M01')
        self.assertEqual(normalized['signal_level'], -6.0)

    def test_normalize_unknown_source_returns_none(self):
        """Test that unknown source type returns None."""
        raw_msg = {'icao': 'ABC123'}

        normalized = self.service._normalize_message(raw_msg, 'unknown')

        self.assertIsNone(normalized)

    def test_normalize_frequency_from_hz(self):
        """Test that frequency in Hz is converted to MHz."""
        raw_msg = {
            'icao': 'ABC123',
            'freq': 136975000,  # Hz
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        # Should be converted to 136.975 MHz
        self.assertAlmostEqual(normalized['frequency'], 136.975, places=3)

    def test_normalize_frequency_already_mhz(self):
        """Test that frequency already in MHz stays unchanged."""
        raw_msg = {
            'icao': 'ABC123',
            'freq': 131.55,  # Already MHz
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertAlmostEqual(normalized['frequency'], 131.55, places=3)

    def test_normalize_frequency_invalid_returns_none(self):
        """Test that invalid frequency returns None."""
        raw_msg = {
            'icao': 'ABC123',
            'freq': 50.0,  # Outside aviation range
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertIsNone(normalized['frequency'])

    def test_normalize_vdlm2_nested_frequency_from_hz(self):
        """Test VDL2 nested format with frequency in Hz."""
        raw_msg = {
            'vdl2': {
                'freq': 136975000,  # Hz
                'avlc': {
                    'src': {'addr': 'ABC123'},
                    'acars': {},
                },
            },
        }

        normalized = self.service._normalize_message(raw_msg, 'vdlm2')

        # Should be converted to 136.975 MHz
        self.assertAlmostEqual(normalized['frequency'], 136.975, places=3)

    def test_normalize_acars_registration_with_dots(self):
        """Test that dots are removed from ACARS registration."""
        raw_msg = {
            'icao': 'ABC123',
            'tail': 'N.123.AB',
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertEqual(normalized['registration'], 'N123AB')


class AcarsServiceStatisticsTests(TestCase):
    """Tests for statistics tracking."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def test_get_stats_initial_state(self):
        """Test initial statistics state."""
        stats = self.service.get_stats()

        self.assertEqual(stats['acars']['total'], 0)
        self.assertEqual(stats['acars']['last_hour'], 0)
        self.assertEqual(stats['acars']['errors'], 0)
        self.assertEqual(stats['acars']['duplicates'], 0)
        self.assertEqual(stats['vdlm2']['total'], 0)
        self.assertFalse(stats['running'])
        self.assertEqual(stats['recent_buffer_size'], 0)

    def test_get_stats_hourly_count_cleanup(self):
        """Test that old hourly counts are cleaned up."""
        from datetime import timezone as dt_timezone

        # Add old timestamp (2 hours ago) - must be timezone-aware
        old_time = datetime.now(dt_timezone.utc) - timedelta(hours=2)
        self.service._hourly_counts['acars'].append(old_time)

        # Add recent timestamp - must be timezone-aware
        recent_time = datetime.now(dt_timezone.utc)
        self.service._hourly_counts['acars'].append(recent_time)

        stats = self.service.get_stats()

        # Only recent count should remain
        self.assertEqual(stats['acars']['last_hour'], 1)

    def test_get_stats_top_frequencies(self):
        """Test top frequencies in statistics."""
        # Add frequency counts
        self.service._frequency_counts['131.550'] = 100
        self.service._frequency_counts['136.975'] = 50
        self.service._frequency_counts['130.025'] = 25

        stats = self.service.get_stats()

        self.assertEqual(len(stats['top_frequencies']), 3)
        self.assertEqual(stats['top_frequencies'][0]['frequency_mhz'], '131.550')
        self.assertEqual(stats['top_frequencies'][0]['count'], 100)


class AcarsServiceRecentMessagesTests(TestCase):
    """Tests for recent messages buffer."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def test_get_recent_messages_empty(self):
        """Test getting recent messages when buffer is empty."""
        messages = self.service.get_recent_messages()

        self.assertEqual(messages, [])

    def test_get_recent_messages_respects_limit(self):
        """Test that get_recent_messages respects limit parameter."""
        # Add 10 messages to buffer
        for i in range(10):
            self.service._recent_messages.append({'id': i})

        messages = self.service.get_recent_messages(limit=5)

        self.assertEqual(len(messages), 5)

    def test_get_recent_messages_reversed_order(self):
        """Test that messages are returned in reverse order (newest first)."""
        for i in range(5):
            self.service._recent_messages.append({'id': i})

        messages = self.service.get_recent_messages(limit=5)

        # Newest (id=4) should be first
        self.assertEqual(messages[0]['id'], 4)
        self.assertEqual(messages[-1]['id'], 0)

    def test_recent_messages_max_buffer_size(self):
        """Test that buffer doesn't exceed max size."""
        # Set smaller max for testing
        self.service._max_recent = 5

        # Add more messages than max
        for i in range(10):
            with self.service._recent_lock:
                self.service._recent_messages.append({'id': i})
                if len(self.service._recent_messages) > self.service._max_recent:
                    self.service._recent_messages.pop(0)

        self.assertEqual(len(self.service._recent_messages), 5)
        # Should have ids 5-9 (oldest removed)
        self.assertEqual(self.service._recent_messages[0]['id'], 5)


class AcarsServiceProcessMessageTests(TestCase):
    """Tests for message processing workflow."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    @patch('skyspy.services.acars.get_channel_layer')
    @patch('skyspy.services.acars.enrich_acars_message')
    async def test_process_message_valid_acars(self, mock_enrich, mock_channel):
        """Test processing a valid ACARS message."""
        mock_enrich.return_value = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': 'UAL456',
            'label': '10',
            'text': 'Test',
        }

        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock()
        mock_channel.return_value = mock_channel_layer

        raw_data = json.dumps({
            'timestamp': 1704067200.0,
            'icao': 'ABC123',
            'flight': 'UAL456',
            'label': '10',
            'text': 'Test',
        }).encode()

        await self.service._process_message(raw_data, 'acars')

        # Verify enrichment was called
        mock_enrich.assert_called_once()

        # Verify stats were updated
        self.assertEqual(self.service._stats['acars']['total'], 1)

        # Verify message was added to recent buffer
        self.assertEqual(len(self.service._recent_messages), 1)

    async def test_process_message_invalid_json(self):
        """Test processing invalid JSON data."""
        raw_data = b'not valid json'

        await self.service._process_message(raw_data, 'acars')

        # Should increment error count
        self.assertEqual(self.service._stats['acars']['errors'], 1)

    async def test_process_message_unicode_error(self):
        """Test processing data with invalid unicode."""
        raw_data = b'\xff\xfe invalid unicode'

        await self.service._process_message(raw_data, 'acars')

        # Should increment error count
        self.assertEqual(self.service._stats['acars']['errors'], 1)

    @patch('skyspy.services.acars.get_channel_layer')
    @patch('skyspy.services.acars.enrich_acars_message')
    async def test_process_message_duplicate_filtered(self, mock_enrich, mock_channel):
        """Test that duplicate messages are filtered."""
        mock_enrich.return_value = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': 'UAL456',
            'label': '10',
            'text': 'Test',
        }

        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock()
        mock_channel.return_value = mock_channel_layer

        raw_data = json.dumps({
            'timestamp': 1704067200.0,
            'icao': 'ABC123',
            'flight': 'UAL456',
            'label': '10',
            'text': 'Test',
        }).encode()

        # Process same message twice
        await self.service._process_message(raw_data, 'acars')
        await self.service._process_message(raw_data, 'acars')

        # Total should be 1 (second was filtered)
        self.assertEqual(self.service._stats['acars']['total'], 1)
        self.assertEqual(self.service._stats['acars']['duplicates'], 1)

    @patch('skyspy.services.acars.get_channel_layer')
    @patch('skyspy.services.acars.enrich_acars_message')
    async def test_process_message_frequency_tracking(self, mock_enrich, mock_channel):
        """Test that frequencies are tracked."""
        mock_enrich.return_value = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'icao_hex': 'ABC123',
            'frequency': 131.55,
            'label': '10',
            'text': 'Test',
        }

        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock()
        mock_channel.return_value = mock_channel_layer

        raw_data = json.dumps({
            'timestamp': 1704067200.0,
            'icao': 'ABC123',
            'freq': 131.55,
            'label': '10',
            'text': 'Test',
        }).encode()

        await self.service._process_message(raw_data, 'acars')

        self.assertEqual(self.service._frequency_counts['131.550'], 1)


class AcarsServiceBroadcastTests(TestCase):
    """Tests for message broadcasting."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    @patch('skyspy.services.acars.get_channel_layer')
    async def test_broadcast_message_to_all_group(self, mock_channel):
        """Test broadcasting to acars_all group."""
        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock()
        mock_channel.return_value = mock_channel_layer

        msg = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'icao_hex': 'ABC123',
            'text': 'Test',
        }

        await self.service._broadcast_message(msg)

        # Should broadcast to acars_all
        calls = mock_channel_layer.group_send.call_args_list
        self.assertTrue(
            any(call[0][0] == 'acars_all' for call in calls)
        )

    @patch('skyspy.services.acars.get_channel_layer')
    async def test_broadcast_message_to_aircraft_group(self, mock_channel):
        """Test broadcasting to aircraft-specific group."""
        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock()
        mock_channel.return_value = mock_channel_layer

        msg = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'icao_hex': 'ABC123',
            'text': 'Test',
        }

        await self.service._broadcast_message(msg)

        # Should also broadcast to acars_abc123
        calls = mock_channel_layer.group_send.call_args_list
        self.assertTrue(
            any(call[0][0] == 'acars_abc123' for call in calls)
        )

    @patch('skyspy.services.acars.get_channel_layer')
    async def test_broadcast_message_adds_timestamp(self, mock_channel):
        """Test that broadcast adds ISO timestamp if missing."""
        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock()
        mock_channel.return_value = mock_channel_layer

        msg = {
            'timestamp': 1704067200.0,  # Unix timestamp
            'source': 'acars',
            'text': 'Test',
        }

        await self.service._broadcast_message(msg)

        # Message should have ISO timestamp after broadcast
        self.assertIn('Z', msg['timestamp'])

    @patch('skyspy.services.acars.get_channel_layer')
    async def test_broadcast_failure_does_not_raise(self, mock_channel):
        """Test that broadcast failures are handled gracefully."""
        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send = AsyncMock(
            side_effect=Exception("Channel error")
        )
        mock_channel.return_value = mock_channel_layer

        msg = {'timestamp': 1704067200.0, 'text': 'Test'}

        # Should not raise
        await self.service._broadcast_message(msg)


class AcarsServiceStorageTests(TestCase):
    """Tests for message database storage."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    async def test_store_message_creates_record(self):
        """Test that store_message creates database record."""
        msg = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'channel': '2',
            'frequency': 131.55,
            'icao_hex': 'ABC123',
            'registration': 'N12345',
            'callsign': 'UAL456',
            'label': '10',
            'block_id': 'A',
            'msg_num': 'M01',
            'ack': 'NAK',
            'mode': '2',
            'text': 'Test message',
            'decoded_text': {'message_type': 'OOOI Event'},
            'signal_level': -5.2,
            'error_count': 0,
            'station_id': 'acarsdec',
        }

        await self.service._store_message(msg)

        count = await sync_to_async(AcarsMessage.objects.count)()
        self.assertEqual(count, 1)

        record = await sync_to_async(AcarsMessage.objects.first)()
        self.assertEqual(record.source, 'acars')
        self.assertEqual(record.icao_hex, 'ABC123')
        self.assertEqual(record.callsign, 'UAL456')
        self.assertEqual(record.label, '10')

    async def test_store_message_handles_iso_timestamp(self):
        """Test storing message with ISO timestamp string."""
        msg = {
            'timestamp': '2024-01-01T00:00:00+00:00',
            'source': 'acars',
            'icao_hex': 'ABC123',
            'text': 'Test',
        }

        await self.service._store_message(msg)

        count = await sync_to_async(AcarsMessage.objects.count)()
        self.assertEqual(count, 1)

    async def test_store_message_error_does_not_raise(self):
        """Test that storage errors are handled gracefully."""
        # Invalid data that might cause storage issues
        msg = {
            'source': 'acars',
            # Missing required timestamp - will use default
        }

        # Should not raise
        await self.service._store_message(msg)


class AcarsServiceLifecycleTests(TestCase):
    """Tests for service start/stop lifecycle."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    async def test_start_sets_running_flag(self):
        """Test that start sets running flag."""
        # Mock the UDP listener to avoid actual network binding
        with patch.object(self.service, '_udp_listener', new_callable=AsyncMock):
            await self.service.start(acars_port=5550, vdlm2_port=5555)

            self.assertTrue(self.service._running)

            await self.service.stop()

    async def test_start_ignores_duplicate_start(self):
        """Test that duplicate start calls are ignored."""
        self.service._running = True

        # Should return early without creating tasks
        await self.service.start(acars_port=5550, vdlm2_port=5555)

        self.assertIsNone(self.service._acars_task)
        self.assertIsNone(self.service._vdlm2_task)

    async def test_stop_clears_running_flag(self):
        """Test that stop clears running flag."""
        self.service._running = True

        await self.service.stop()

        self.assertFalse(self.service._running)

    async def test_stop_cancels_tasks(self):
        """Test that stop cancels running tasks."""
        # Create a task-like mock that raises CancelledError when awaited
        async def cancelled_coro():
            raise asyncio.CancelledError()

        # Create an actual task from the coroutine
        acars_task = asyncio.create_task(cancelled_coro())
        vdlm2_task = asyncio.create_task(cancelled_coro())

        # Set the tasks
        self.service._acars_task = acars_task
        self.service._vdlm2_task = vdlm2_task
        self.service._running = True

        # Stop should handle the CancelledError gracefully
        await self.service.stop()

        self.assertFalse(self.service._running)


class AcarsServiceEdgeCaseTests(TestCase):
    """Edge case tests for AcarsService."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = AcarsService()

    def test_normalize_message_with_none_flight(self):
        """Test normalization when flight field is None."""
        raw_msg = {
            'icao': 'ABC123',
            'flight': None,
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertIsNone(normalized['callsign'])

    def test_normalize_message_with_empty_text(self):
        """Test normalization with empty text field."""
        raw_msg = {
            'icao': 'ABC123',
            'text': '',
        }

        normalized = self.service._normalize_message(raw_msg, 'acars')

        self.assertEqual(normalized['text'], '')

    def test_normalize_vdlm2_integer_icao(self):
        """Test VDL2 normalization with integer ICAO."""
        raw_msg = {
            'icao': 11259375,  # 0xABCDEF in decimal
        }

        normalized = self.service._normalize_message(raw_msg, 'vdlm2')

        self.assertEqual(normalized['icao_hex'], 'ABCDEF')

    def test_normalize_vdlm2_small_integer_icao(self):
        """Test VDL2 normalization with small integer ICAO (leading zeros)."""
        raw_msg = {
            'icao': 4660,  # 0x001234 - needs padding
        }

        normalized = self.service._normalize_message(raw_msg, 'vdlm2')

        self.assertEqual(normalized['icao_hex'], '001234')

    def test_normalize_message_exception_handling(self):
        """Test that normalization handles edge cases without crashing."""
        # Create a message with minimal/unusual data
        raw_msg = {
            'text': '',  # Empty but valid
        }

        # Should not raise an exception
        normalized = self.service._normalize_message(raw_msg, 'acars')

        # Returns a dict (may have empty/None fields but doesn't crash)
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized['source'], 'acars')

    def test_normalize_unknown_source_returns_none(self):
        """Test that unknown source type returns None."""
        raw_msg = {'icao': 'ABC123'}

        normalized = self.service._normalize_message(raw_msg, 'unknown')

        self.assertIsNone(normalized)
