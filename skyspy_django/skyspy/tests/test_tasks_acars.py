"""
End-to-end tests for ACARS message decoding Celery tasks.

Tests cover:
- decode_acars_message: Single message decoding
- process_acars_decode_queue: Batch queue processing
- decode_acars_batch: Batch message decoding
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import AcarsMessage
from skyspy.tasks.acars import (
    decode_acars_batch,
    decode_acars_message,
    process_acars_decode_queue,
)

# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
}


@override_settings(**CELERY_TEST_SETTINGS)
class DecodeAcarsMessageTaskTest(TestCase):
    """Tests for the decode_acars_message task."""

    def setUp(self):
        """Set up test fixtures."""
        AcarsMessage.objects.filter(icao_hex__startswith="TEST").delete()

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_message_success(self, mock_decode):
        """Test successful message decoding."""
        mock_decode.return_value = {
            "type": "CPDLC",
            "message_data": {"element": "value"},
        }

        message = AcarsMessage.objects.create(
            icao_hex="TEST01",
            source="acars",
            label="H1",
            text="FANS-1/A message content",
        )

        decode_acars_message(message.id)

        message.refresh_from_db()
        self.assertIsNotNone(message.decoded)
        self.assertEqual(message.decoded["type"], "CPDLC")

    def test_decode_message_not_found(self):
        """Test handling when message doesn't exist."""
        # Should not raise
        decode_acars_message(999999)

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_message_already_decoded(self, mock_decode):
        """Test that already decoded messages are skipped."""
        message = AcarsMessage.objects.create(
            icao_hex="TEST02",
            source="acars",
            label="H1",
            text="Test message",
            decoded={"existing": "data"},
        )

        decode_acars_message(message.id)

        # decode_message_text should not be called
        mock_decode.assert_not_called()

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_message_no_text(self, mock_decode):
        """Test that messages without text are skipped."""
        message = AcarsMessage.objects.create(
            icao_hex="TEST03",
            source="acars",
            label="H1",
            text=None,
        )

        decode_acars_message(message.id)

        mock_decode.assert_not_called()

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_message_empty_result(self, mock_decode):
        """Test handling of empty decode result."""
        mock_decode.return_value = None

        message = AcarsMessage.objects.create(
            icao_hex="TEST04",
            source="acars",
            label="H1",
            text="Undecoded message",
        )

        decode_acars_message(message.id)

        message.refresh_from_db()
        self.assertIsNone(message.decoded)

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_message_updates_only_decoded_field(self, mock_decode):
        """Test that only the decoded field is updated."""
        mock_decode.return_value = {"type": "test"}

        message = AcarsMessage.objects.create(
            icao_hex="TEST05",
            source="acars",
            label="H1",
            text="Test message",
            callsign="UAL123",
        )
        original_callsign = message.callsign

        decode_acars_message(message.id)

        message.refresh_from_db()
        self.assertEqual(message.callsign, original_callsign)
        self.assertIsNotNone(message.decoded)

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_message_error_handling(self, mock_decode):
        """Test error handling during decode.

        The task catches the exception and calls self.retry(exc=e),
        which raises celery.exceptions.Retry when called directly
        (not via a Celery worker).
        """
        from celery.exceptions import Retry

        mock_decode.side_effect = Exception("Decode error")

        message = AcarsMessage.objects.create(
            icao_hex="TEST06",
            source="acars",
            label="H1",
            text="Test message",
        )

        # Task retries on error, which raises Retry when called directly
        with self.assertRaises((Retry, Exception)):
            decode_acars_message(message.id)

        # Message should remain undecoded
        message.refresh_from_db()
        self.assertIsNone(message.decoded)


@override_settings(**CELERY_TEST_SETTINGS)
class ProcessAcarsDecodeQueueTaskTest(TestCase):
    """Tests for the process_acars_decode_queue task."""

    def setUp(self):
        """Set up test fixtures."""
        AcarsMessage.objects.filter(icao_hex__startswith="QUEUE").delete()

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_process_queue_queues_messages(self, mock_available, mock_decode):
        """Test that undecoded messages are queued."""
        mock_available.return_value = True

        # Create messages with decodable labels
        for i, label in enumerate(["H1", "H2", "SA"]):
            AcarsMessage.objects.create(
                icao_hex=f"QUEUE0{i}",
                source="acars",
                label=label,
                text="Test message",
            )

        process_acars_decode_queue()

        # Should have queued all 3 messages
        self.assertEqual(mock_decode.delay.call_count, 3)

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_process_queue_skips_when_unavailable(self, mock_available, mock_decode):
        """Test that queue is skipped when libacars unavailable."""
        mock_available.return_value = False

        AcarsMessage.objects.create(
            icao_hex="QUEUE01",
            source="acars",
            label="H1",
            text="Test message",
        )

        process_acars_decode_queue()

        mock_decode.delay.assert_not_called()

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_process_queue_filters_by_label(self, mock_available, mock_decode):
        """Test that only decodable labels are processed."""
        mock_available.return_value = True

        # Create message with non-decodable label
        AcarsMessage.objects.create(
            icao_hex="QUEUE01",
            source="acars",
            label="XX",  # Not in decodable_labels
            text="Test message",
        )

        # Create message with decodable label
        AcarsMessage.objects.create(
            icao_hex="QUEUE02",
            source="acars",
            label="H1",  # Decodable
            text="Test message",
        )

        process_acars_decode_queue()

        # Should only queue the H1 message
        self.assertEqual(mock_decode.delay.call_count, 1)

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_process_queue_skips_already_decoded(self, mock_available, mock_decode):
        """Test that already decoded messages are skipped."""
        mock_available.return_value = True

        # Create decoded message
        AcarsMessage.objects.create(
            icao_hex="QUEUE01",
            source="acars",
            label="H1",
            text="Test message",
            decoded={"already": "decoded"},
        )

        # Create undecoded message
        AcarsMessage.objects.create(
            icao_hex="QUEUE02",
            source="acars",
            label="H1",
            text="Test message",
        )

        process_acars_decode_queue()

        # Should only queue the undecoded message
        self.assertEqual(mock_decode.delay.call_count, 1)

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_process_queue_skips_no_text(self, mock_available, mock_decode):
        """Test that messages without text are skipped."""
        mock_available.return_value = True

        # Create message with no text
        AcarsMessage.objects.create(
            icao_hex="QUEUE01",
            source="acars",
            label="H1",
            text=None,
        )

        process_acars_decode_queue()

        mock_decode.delay.assert_not_called()

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_process_queue_limits_batch_size(self, mock_available, mock_decode):
        """Test that batch size is limited to 50."""
        mock_available.return_value = True

        # Create 60 undecoded messages
        for i in range(60):
            AcarsMessage.objects.create(
                icao_hex=f"QUEUE{i:03d}",
                source="acars",
                label="H1",
                text="Test message",
            )

        process_acars_decode_queue()

        # Should only queue 50 messages
        self.assertEqual(mock_decode.delay.call_count, 50)


@override_settings(**CELERY_TEST_SETTINGS)
class DecodeAcarsBatchTaskTest(TestCase):
    """Tests for the decode_acars_batch task."""

    def setUp(self):
        """Set up test fixtures."""
        AcarsMessage.objects.filter(icao_hex__startswith="BATCH").delete()

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_batch_success(self, mock_decode):
        """Test successful batch decoding."""
        mock_decode.return_value = {"type": "decoded"}

        # Create messages
        messages = []
        for i in range(5):
            msg = AcarsMessage.objects.create(
                icao_hex=f"BATCH0{i}",
                source="acars",
                label="H1",
                text="Test message",
            )
            messages.append(msg)

        message_ids = [m.id for m in messages]
        decode_acars_batch(message_ids)

        # All messages should be decoded
        for msg in messages:
            msg.refresh_from_db()
            self.assertIsNotNone(msg.decoded)

    def test_decode_batch_empty_list(self):
        """Test batch with empty list."""
        # Should not raise
        decode_acars_batch([])

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_batch_skips_already_decoded(self, mock_decode):
        """Test that already decoded messages are skipped."""
        mock_decode.return_value = {"type": "decoded"}

        # Create decoded message
        decoded = AcarsMessage.objects.create(
            icao_hex="BATCH01",
            source="acars",
            label="H1",
            text="Test message",
            decoded={"already": "done"},
        )

        # Create undecoded message
        undecoded = AcarsMessage.objects.create(
            icao_hex="BATCH02",
            source="acars",
            label="H1",
            text="Test message",
        )

        decode_acars_batch([decoded.id, undecoded.id])

        # Only undecoded message should be processed
        self.assertEqual(mock_decode.call_count, 1)

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_batch_skips_no_text(self, mock_decode):
        """Test that messages without text are skipped."""
        mock_decode.return_value = {"type": "decoded"}

        # Create message without text
        no_text = AcarsMessage.objects.create(
            icao_hex="BATCH01",
            source="acars",
            label="H1",
            text=None,
        )

        # Create message with text
        with_text = AcarsMessage.objects.create(
            icao_hex="BATCH02",
            source="acars",
            label="H1",
            text="Test message",
        )

        decode_acars_batch([no_text.id, with_text.id])

        # Only with_text message should be processed
        self.assertEqual(mock_decode.call_count, 1)

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_batch_handles_errors(self, mock_decode):
        """Test that errors don't stop batch processing.

        The batch task iterates over an unordered queryset, so we can't
        predict which message gets the exception vs the successful decode.
        We verify that exactly one message ends up decoded and one does not.
        """
        mock_decode.side_effect = [
            Exception("Decode error"),  # One message fails
            {"type": "decoded"},  # Another message succeeds
        ]

        messages = []
        for i in range(2):
            msg = AcarsMessage.objects.create(
                icao_hex=f"BATCH0{i}",
                source="acars",
                label="H1",
                text="Test message",
            )
            messages.append(msg)

        decode_acars_batch([m.id for m in messages])

        # Refresh both messages
        for msg in messages:
            msg.refresh_from_db()

        # Exactly one message should be decoded, one should remain undecoded
        decoded_states = [msg.decoded is not None for msg in messages]
        self.assertEqual(sum(decoded_states), 1, "Exactly one message should be decoded")
        self.assertEqual(decoded_states.count(False), 1, "Exactly one message should remain undecoded")

    @patch("skyspy.tasks.acars.decode_message_text")
    def test_decode_batch_handles_nonexistent_ids(self, mock_decode):
        """Test that nonexistent message IDs are handled."""
        mock_decode.return_value = {"type": "decoded"}

        # Create one message
        msg = AcarsMessage.objects.create(
            icao_hex="BATCH01",
            source="acars",
            label="H1",
            text="Test message",
        )

        # Include nonexistent ID
        decode_acars_batch([msg.id, 999999])

        # Should still decode the valid message
        msg.refresh_from_db()
        self.assertIsNotNone(msg.decoded)


@override_settings(**CELERY_TEST_SETTINGS)
class AcarsTaskSchedulingTest(TestCase):
    """Tests for ACARS task scheduling configuration."""

    def test_decode_acars_message_is_shared_task(self):
        """Verify decode_acars_message is a shared task."""
        self.assertTrue(hasattr(decode_acars_message, "delay"))
        self.assertTrue(hasattr(decode_acars_message, "apply_async"))

    def test_process_acars_decode_queue_is_shared_task(self):
        """Verify process_acars_decode_queue is a shared task."""
        self.assertTrue(hasattr(process_acars_decode_queue, "delay"))

    def test_decode_acars_batch_is_shared_task(self):
        """Verify decode_acars_batch is a shared task."""
        self.assertTrue(hasattr(decode_acars_batch, "delay"))


@override_settings(**CELERY_TEST_SETTINGS)
class AcarsTaskRetryBehaviorTest(TestCase):
    """Tests for ACARS task retry behavior."""

    def test_decode_acars_message_has_retries(self):
        """Verify decode_acars_message has retry configuration."""
        self.assertEqual(decode_acars_message.max_retries, 2)

    def test_decode_acars_message_retry_delay(self):
        """Verify decode_acars_message has retry delay."""
        self.assertEqual(decode_acars_message.default_retry_delay, 5)


@override_settings(**CELERY_TEST_SETTINGS)
class AcarsDecodableLabelTest(TestCase):
    """Tests for decodable label filtering."""

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_fans1a_labels_are_decodable(self, mock_available, mock_decode):
        """Test that FANS-1/A labels are processed."""
        mock_available.return_value = True

        # FANS-1/A labels
        for label in ["H1", "H2"]:
            AcarsMessage.objects.create(
                icao_hex=f"FANS{label}",
                source="acars",
                label=label,
                text="Test message",
            )

        process_acars_decode_queue()

        self.assertEqual(mock_decode.delay.call_count, 2)

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_oooi_labels_are_decodable(self, mock_available, mock_decode):
        """Test that OOOI event labels are processed."""
        mock_available.return_value = True

        # OOOI labels
        for label in ["10", "11", "12", "13", "80"]:
            AcarsMessage.objects.create(
                icao_hex=f"OOOI{label}",
                source="acars",
                label=label,
                text="Test message",
            )

        process_acars_decode_queue()

        self.assertEqual(mock_decode.delay.call_count, 5)

    @patch("skyspy.tasks.acars.decode_acars_message")
    @patch("skyspy.tasks.acars.libacars_is_available")
    def test_miam_labels_are_decodable(self, mock_available, mock_decode):
        """Test that MIAM labels are processed."""
        mock_available.return_value = True

        # MIAM labels
        for label in ["_d", "2Z", "5Z"]:
            AcarsMessage.objects.create(
                icao_hex=f"MIAM{label}",
                source="acars",
                label=label,
                text="Test message",
            )

        process_acars_decode_queue()

        self.assertEqual(mock_decode.delay.call_count, 3)


@override_settings(**CELERY_TEST_SETTINGS)
class AcarsMessageModelTest(TestCase):
    """Tests for AcarsMessage model integration with tasks."""

    def test_message_source_choices(self):
        """Test message source field choices."""
        # Test ACARS source
        acars_msg = AcarsMessage.objects.create(
            icao_hex="TEST01",
            source="acars",
        )
        self.assertEqual(acars_msg.source, "acars")

        # Test VDL2 source
        vdl2_msg = AcarsMessage.objects.create(
            icao_hex="TEST02",
            source="vdlm2",
        )
        self.assertEqual(vdl2_msg.source, "vdlm2")

    def test_decoded_field_is_json(self):
        """Test that decoded field stores JSON correctly."""
        msg = AcarsMessage.objects.create(
            icao_hex="TEST01",
            source="acars",
            decoded={
                "type": "CPDLC",
                "nested": {"key": "value"},
                "list": [1, 2, 3],
            },
        )

        msg.refresh_from_db()
        self.assertEqual(msg.decoded["type"], "CPDLC")
        self.assertEqual(msg.decoded["nested"]["key"], "value")
        self.assertEqual(msg.decoded["list"], [1, 2, 3])
