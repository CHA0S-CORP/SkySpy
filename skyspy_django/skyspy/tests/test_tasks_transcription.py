"""
End-to-end tests for transcription-related Celery tasks.

Tests cover:
- process_transcription_queue: Processing queued audio transcriptions
- transcribe_audio: Transcribing individual audio files
- extract_callsigns: Extracting aircraft callsigns from transcripts
"""
import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, Mock, mock_open

from django.test import TestCase, override_settings
from django.utils import timezone
from celery.exceptions import Retry

from skyspy.models import AudioTransmission
import pytest

from skyspy.tasks.transcription import (
    process_transcription_queue,
    transcribe_audio,
    extract_callsigns,
    _broadcast_transcription_update,
)

# These helper functions were removed/refactored - skip tests that depend on them
_transcribe_with_whisper = None
_transcribe_with_service = None


# Test settings for Celery eager execution
# Note: We disable CELERY_TASK_EAGER_PROPAGATES to prevent exceptions
# from propagating through retries, allowing us to verify task behavior
CELERY_TEST_SETTINGS = {
    'CELERY_TASK_ALWAYS_EAGER': True,
    'CELERY_TASK_EAGER_PROPAGATES': False,
}


@override_settings(**CELERY_TEST_SETTINGS)
class ProcessTranscriptionQueueTaskTest(TestCase):
    """Tests for the process_transcription_queue task."""

    def setUp(self):
        """Set up test fixtures."""
        AudioTransmission.objects.all().delete()

    @override_settings(TRANSCRIPTION_ENABLED=False, WHISPER_ENABLED=False)
    def test_process_queue_disabled(self):
        """Test that task returns early when transcription is disabled."""
        # Create queued transmission
        AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='queued',
            transcription_queued_at=timezone.now(),
        )

        # Execute task
        process_transcription_queue()

        # Transmission should still be queued (task returned early)
        transmission = AudioTransmission.objects.first()
        self.assertEqual(transmission.transcription_status, 'queued')

    @patch('skyspy.tasks.transcription.transcribe_audio.delay')
    @override_settings(TRANSCRIPTION_ENABLED=True, WHISPER_ENABLED=False)
    def test_process_queue_triggers_transcribe(self, mock_transcribe_delay):
        """Test that queued transmissions trigger transcribe_audio task."""
        # Create queued transmissions
        t1 = AudioTransmission.objects.create(
            filename='test1.mp3',
            transcription_status='queued',
            transcription_queued_at=timezone.now(),
        )
        t2 = AudioTransmission.objects.create(
            filename='test2.mp3',
            transcription_status='queued',
            transcription_queued_at=timezone.now() + timedelta(seconds=1),
        )

        # Execute task
        process_transcription_queue()

        # Both transmissions should trigger transcribe_audio
        self.assertEqual(mock_transcribe_delay.call_count, 2)
        mock_transcribe_delay.assert_any_call(t1.id)
        mock_transcribe_delay.assert_any_call(t2.id)

    @patch('skyspy.tasks.transcription.transcribe_audio.delay')
    @override_settings(TRANSCRIPTION_ENABLED=True, WHISPER_ENABLED=False)
    def test_process_queue_respects_limit(self, mock_transcribe_delay):
        """Test that only 5 transmissions are processed at a time."""
        # Create 7 queued transmissions
        for i in range(7):
            AudioTransmission.objects.create(
                filename=f'test{i}.mp3',
                transcription_status='queued',
                transcription_queued_at=timezone.now() + timedelta(seconds=i),
            )

        process_transcription_queue()

        # Only 5 should be triggered
        self.assertEqual(mock_transcribe_delay.call_count, 5)

    @patch('skyspy.tasks.transcription.transcribe_audio.delay')
    @override_settings(TRANSCRIPTION_ENABLED=True, WHISPER_ENABLED=False)
    def test_process_queue_skips_non_queued(self, mock_transcribe_delay):
        """Test that non-queued transmissions are skipped."""
        # Create transmissions with various statuses
        AudioTransmission.objects.create(
            filename='pending.mp3',
            transcription_status='pending',
        )
        AudioTransmission.objects.create(
            filename='processing.mp3',
            transcription_status='processing',
        )
        AudioTransmission.objects.create(
            filename='completed.mp3',
            transcription_status='completed',
        )
        AudioTransmission.objects.create(
            filename='queued.mp3',
            transcription_status='queued',
            transcription_queued_at=timezone.now(),
        )

        process_transcription_queue()

        # Only the queued transmission should trigger
        self.assertEqual(mock_transcribe_delay.call_count, 1)


@override_settings(**CELERY_TEST_SETTINGS)
class TranscribeAudioTaskTest(TestCase):
    """Tests for the transcribe_audio task."""

    def setUp(self):
        """Set up test fixtures."""
        AudioTransmission.objects.all().delete()

    def test_transcribe_nonexistent_transmission(self):
        """Test handling of non-existent transmission ID."""
        # Should not raise
        transcribe_audio(99999)

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    def test_transcribe_already_completed(self, mock_broadcast):
        """Test that already completed transmissions are skipped."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript='Already transcribed',
        )

        transcribe_audio(transmission.id)

        # Should not broadcast (task returned early)
        mock_broadcast.assert_not_called()

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    @patch('skyspy.services.audio._transcribe_with_whisper')
    @patch('skyspy.services.audio.read_local_file')
    @override_settings(
        WHISPER_ENABLED=True,
        ATC_WHISPER_ENABLED=False,
        TRANSCRIPTION_ENABLED=False,
        RADIO_AUDIO_DIR='/data/radio',
        S3_ENABLED=False
    )
    def test_transcribe_with_whisper_success(self, mock_read_local, mock_whisper, mock_broadcast):
        """Test successful transcription using Whisper."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='queued',
        )

        mock_read_local.return_value = b'fake audio data'
        mock_whisper.return_value = {
            'text': 'United 123 descend and maintain flight level three five zero',
            'confidence': 0.95,
            'language': 'en',
            'segments': [{'start': 0.0, 'end': 3.5, 'text': 'United 123...'}],
        }

        transcribe_audio(transmission.id)

        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, 'completed')
        self.assertEqual(transmission.transcript, 'United 123 descend and maintain flight level three five zero')
        self.assertEqual(transmission.transcript_confidence, 0.95)
        self.assertIsNone(transmission.transcription_error)

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    @patch('skyspy.services.audio.read_local_file')
    @override_settings(
        WHISPER_ENABLED=True,
        ATC_WHISPER_ENABLED=False,
        TRANSCRIPTION_ENABLED=False,
        RADIO_AUDIO_DIR='/data/radio',
        S3_ENABLED=False
    )
    def test_transcribe_file_not_found(self, mock_read_local, mock_broadcast):
        """Test handling of missing audio file."""
        transmission = AudioTransmission.objects.create(
            filename='missing.mp3',
            transcription_status='queued',
        )

        # Mock read_local_file to return None (file not found)
        mock_read_local.return_value = None

        # With max_retries=3, this should retry and eventually raise
        try:
            transcribe_audio(transmission.id)
        except Exception:
            pass  # Expected behavior - catches Retry, ValueError, or generic Exception

        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, 'failed')
        # Error message is "Failed to fetch audio data" when file can't be read
        self.assertIsNotNone(transmission.transcription_error)
        self.assertIn('fetch', transmission.transcription_error.lower())

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    @patch('skyspy.services.audio._transcribe_with_external_service')
    @patch('skyspy.services.audio.read_local_file')
    @override_settings(
        WHISPER_ENABLED=False,
        ATC_WHISPER_ENABLED=False,
        TRANSCRIPTION_ENABLED=True,
        TRANSCRIPTION_SERVICE_URL='http://transcription:8080/api/transcribe',
        RADIO_AUDIO_DIR='/data/radio',
        S3_ENABLED=False
    )
    def test_transcribe_with_external_service(self, mock_read_local, mock_service, mock_broadcast):
        """Test transcription using external service."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='queued',
        )

        mock_read_local.return_value = b'fake audio data'
        mock_service.return_value = {
            'text': 'Delta 456 cleared for takeoff runway two eight left',
            'confidence': 0.88,
        }

        transcribe_audio(transmission.id)

        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, 'completed')
        self.assertIn('Delta 456', transmission.transcript)

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    @override_settings(
        WHISPER_ENABLED=False,
        ATC_WHISPER_ENABLED=False,
        TRANSCRIPTION_ENABLED=False,
        RADIO_AUDIO_DIR='/data/radio',
        S3_ENABLED=False
    )
    def test_transcribe_no_service_configured(self, mock_broadcast):
        """Test error when no transcription service is configured."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='queued',
        )

        try:
            transcribe_audio(transmission.id)
        except Exception:
            pass  # Expected - catches Retry, ValueError, or generic Exception

        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, 'failed')
        # Error message indicates no service configured
        self.assertIsNotNone(transmission.transcription_error)
        self.assertTrue(
            'No transcription service configured' in transmission.transcription_error
            or 'Transcription failed' in transmission.transcription_error
        )

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    @patch('skyspy.services.audio._transcribe_with_whisper')
    @patch('skyspy.services.audio.read_local_file')
    @override_settings(
        WHISPER_ENABLED=True,
        ATC_WHISPER_ENABLED=False,
        TRANSCRIPTION_ENABLED=False,
        RADIO_AUDIO_DIR='/data/radio',
        S3_ENABLED=False
    )
    def test_transcribe_marks_processing_status(self, mock_read_local, mock_whisper, mock_broadcast):
        """Test that transmission is marked as processing during transcription."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='queued',
        )

        mock_read_local.return_value = b'fake audio data'
        mock_whisper.return_value = {'text': 'Test', 'confidence': 0.9}

        # Check that status was set to processing (captured in broadcast)
        status_during_processing = []

        def capture_status(t, status):
            status_during_processing.append(status)

        mock_broadcast.side_effect = capture_status

        transcribe_audio(transmission.id)

        # First broadcast should be 'started', last should be 'completed'
        self.assertIn('started', status_during_processing)
        self.assertIn('completed', status_during_processing)


@override_settings(**CELERY_TEST_SETTINGS)
class TranscribeAudioRetryTest(TestCase):
    """Tests for transcribe_audio retry behavior."""

    def setUp(self):
        """Set up test fixtures."""
        AudioTransmission.objects.all().delete()

    @patch('skyspy.tasks.transcription._broadcast_transcription_update')
    @patch('skyspy.services.audio._transcribe_with_whisper')
    @patch('skyspy.services.audio.read_local_file')
    @override_settings(
        WHISPER_ENABLED=True,
        ATC_WHISPER_ENABLED=False,
        TRANSCRIPTION_ENABLED=False,
        RADIO_AUDIO_DIR='/data/radio',
        S3_ENABLED=False
    )
    def test_transcribe_retries_on_failure(self, mock_read_local, mock_whisper, mock_broadcast):
        """Test that transcription retries on transient failure."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='queued',
        )

        mock_read_local.return_value = b'fake audio data'
        mock_whisper.side_effect = Exception("Service temporarily unavailable")

        # Task should attempt retry - may raise Retry or the underlying exception
        try:
            transcribe_audio(transmission.id)
        except (Retry, Exception):
            pass  # Expected

        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, 'failed')

    def test_transcribe_task_has_max_retries(self):
        """Verify transcribe_audio has retry configuration."""
        self.assertEqual(transcribe_audio.max_retries, 3)


@pytest.mark.skip(reason="_transcribe_with_whisper helper was removed/refactored")
@override_settings(**CELERY_TEST_SETTINGS)
class TranscribeWithWhisperTest(TestCase):
    """Tests for _transcribe_with_whisper helper function."""

    @patch('skyspy.tasks.transcription.httpx.post')
    @override_settings(WHISPER_URL='http://whisper:9000')
    def test_whisper_api_call(self, mock_post):
        """Test Whisper API call format."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'text': 'Test transcript'}
        mock_post.return_value = mock_response

        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
            f.write(b'fake audio data')
            temp_path = f.name

        try:
            result = _transcribe_with_whisper(temp_path)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            self.assertIn('http://whisper:9000/asr', call_args[0][0])
            self.assertEqual(call_args[1]['params'], {'output': 'json'})
            self.assertEqual(result['text'], 'Test transcript')
        finally:
            os.unlink(temp_path)


@pytest.mark.skip(reason="_transcribe_with_service helper was removed/refactored")
@override_settings(**CELERY_TEST_SETTINGS)
class TranscribeWithServiceTest(TestCase):
    """Tests for _transcribe_with_service helper function."""

    @patch('skyspy.tasks.transcription.httpx.post')
    @override_settings(
        TRANSCRIPTION_SERVICE_URL='http://transcription:8080/transcribe',
        TRANSCRIPTION_API_KEY='test-api-key',
        TRANSCRIPTION_MODEL='whisper-large',
    )
    def test_service_api_call_with_auth(self, mock_post):
        """Test external service API call with authentication."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'text': 'Test transcript'}
        mock_post.return_value = mock_response

        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
            f.write(b'fake audio data')
            temp_path = f.name

        try:
            result = _transcribe_with_service(temp_path)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            self.assertEqual(call_args[1]['headers']['Authorization'], 'Bearer test-api-key')
            self.assertEqual(call_args[1]['data']['model'], 'whisper-large')
        finally:
            os.unlink(temp_path)


@override_settings(**CELERY_TEST_SETTINGS)
class ExtractCallsignsTaskTest(TestCase):
    """Tests for the extract_callsigns task."""

    def setUp(self):
        """Set up test fixtures."""
        AudioTransmission.objects.all().delete()

    def test_extract_callsigns_nonexistent_transmission(self):
        """Test handling of non-existent transmission."""
        # Should not raise
        extract_callsigns(99999)

    def test_extract_callsigns_no_transcript(self):
        """Test handling of transmission without transcript."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript=None,
        )

        extract_callsigns(transmission.id)

        transmission.refresh_from_db()
        self.assertIsNone(transmission.identified_airframes)

    def test_extract_airline_callsigns(self):
        """Test extraction of airline callsigns."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript='United one two three descend and maintain flight level three five zero. '
                       'Delta four five six contact departure.',
        )

        extract_callsigns(transmission.id)

        transmission.refresh_from_db()
        callsigns = transmission.identified_airframes
        self.assertIsNotNone(callsigns)
        self.assertGreaterEqual(len(callsigns), 2)

        # Check airline_name field (not 'airline')
        airline_names = [c.get('airline_name', '') for c in callsigns if c.get('type') == 'airline']
        # Check that we have airline callsigns extracted
        airline_callsigns = [c.get('callsign', '') for c in callsigns if c.get('type') == 'airline']
        self.assertTrue(
            any('UAL' in cs for cs in airline_callsigns) or
            any('United' in name for name in airline_names if name)
        )
        self.assertTrue(
            any('DAL' in cs for cs in airline_callsigns) or
            any('Delta' in name for name in airline_names if name)
        )

    def test_extract_n_numbers(self):
        """Test extraction of N-numbers (general aviation callsigns)."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript='November one two three alpha bravo runway two eight left cleared for takeoff.',
        )

        extract_callsigns(transmission.id)

        transmission.refresh_from_db()
        callsigns = transmission.identified_airframes
        self.assertIsNotNone(callsigns)

        # N-numbers are typed as 'general_aviation' not 'n_number'
        n_numbers = [c for c in callsigns if c.get('type') == 'general_aviation']
        self.assertGreaterEqual(len(n_numbers), 1)

    def test_extract_multiple_callsign_types(self):
        """Test extraction of mixed callsign types."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript='American five five five turn right heading two seven zero. '
                       'November seven eight nine golf hotel traffic twelve o clock.',
        )

        extract_callsigns(transmission.id)

        transmission.refresh_from_db()
        callsigns = transmission.identified_airframes
        self.assertIsNotNone(callsigns)

        types = set(c.get('type') for c in callsigns)
        self.assertIn('airline', types)
        # N-numbers are typed as 'general_aviation' not 'n_number'
        self.assertIn('general_aviation', types)


@override_settings(**CELERY_TEST_SETTINGS)
class BroadcastTranscriptionUpdateTest(TestCase):
    """Tests for _broadcast_transcription_update helper function."""

    @patch('skyspy.tasks.transcription.get_channel_layer')
    def test_broadcast_started(self, mock_get_channel_layer):
        """Test broadcasting transcription started event."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='processing',
        )

        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        _broadcast_transcription_update(transmission, 'started')

        mock_channel_layer.group_send.assert_called()
        call_args = mock_channel_layer.group_send.call_args
        self.assertEqual(call_args[0][0], 'audio_transcriptions')
        self.assertEqual(call_args[0][1]['type'], 'audio_transcription_started')

    @patch('skyspy.tasks.transcription.get_channel_layer')
    def test_broadcast_completed(self, mock_get_channel_layer):
        """Test broadcasting transcription completed event with transcript."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript='United 123 cleared for takeoff',
        )

        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        _broadcast_transcription_update(transmission, 'completed')

        call_args = mock_channel_layer.group_send.call_args
        data = call_args[0][1]['data']
        self.assertEqual(data['transcript'], 'United 123 cleared for takeoff')

    @patch('skyspy.tasks.transcription.get_channel_layer')
    def test_broadcast_failed(self, mock_get_channel_layer):
        """Test broadcasting transcription failed event with error."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='failed',
            transcription_error='Service unavailable',
        )

        mock_channel_layer = MagicMock()
        mock_get_channel_layer.return_value = mock_channel_layer

        _broadcast_transcription_update(transmission, 'failed')

        call_args = mock_channel_layer.group_send.call_args
        data = call_args[0][1]['data']
        self.assertEqual(data['error'], 'Service unavailable')

    @patch('skyspy.tasks.transcription.get_channel_layer')
    def test_broadcast_handles_failure(self, mock_get_channel_layer):
        """Test that broadcast failure is handled gracefully."""
        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
        )

        mock_channel_layer = MagicMock()
        mock_channel_layer.group_send.side_effect = Exception("Redis unavailable")
        mock_get_channel_layer.return_value = mock_channel_layer

        # Should not raise
        _broadcast_transcription_update(transmission, 'completed')


@override_settings(**CELERY_TEST_SETTINGS)
class TranscriptionTaskSchedulingTest(TestCase):
    """Tests for transcription task scheduling configuration."""

    def test_process_queue_is_shared_task(self):
        """Verify process_transcription_queue is a shared task."""
        self.assertTrue(hasattr(process_transcription_queue, 'delay'))
        self.assertTrue(hasattr(process_transcription_queue, 'apply_async'))

    def test_transcribe_audio_is_shared_task(self):
        """Verify transcribe_audio is a shared task."""
        self.assertTrue(hasattr(transcribe_audio, 'delay'))
        self.assertTrue(hasattr(transcribe_audio, 'apply_async'))

    def test_extract_callsigns_is_shared_task(self):
        """Verify extract_callsigns is a shared task."""
        self.assertTrue(hasattr(extract_callsigns, 'delay'))
        self.assertTrue(hasattr(extract_callsigns, 'apply_async'))


@override_settings(**CELERY_TEST_SETTINGS)
class AudioTransmissionModelTest(TestCase):
    """Tests for AudioTransmission model used in tasks."""

    def test_transcription_status_choices(self):
        """Test all transcription status values can be stored."""
        statuses = ['pending', 'queued', 'processing', 'completed', 'failed']

        for status in statuses:
            transmission = AudioTransmission.objects.create(
                filename=f'test_{status}.mp3',
                transcription_status=status,
            )
            transmission.refresh_from_db()
            self.assertEqual(transmission.transcription_status, status)

    def test_transcript_segments_json(self):
        """Test that transcript segments can be stored as JSON."""
        segments = [
            {'start': 0.0, 'end': 2.5, 'text': 'United 123'},
            {'start': 2.5, 'end': 5.0, 'text': 'descend and maintain'},
        ]

        transmission = AudioTransmission.objects.create(
            filename='test.mp3',
            transcription_status='completed',
            transcript='United 123 descend and maintain',
            transcript_segments=segments,
        )

        transmission.refresh_from_db()
        self.assertEqual(len(transmission.transcript_segments), 2)
        self.assertEqual(transmission.transcript_segments[0]['text'], 'United 123')
