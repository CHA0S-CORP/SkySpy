"""
ACARS message decoding tasks.

Handles background processing of ACARS messages with libacars:
- Complex message format decoding (FANS-1/A, CPDLC, MIAM, etc.)
- Batch processing of queued messages
- Retry handling for failed decodes
"""

import logging

from celery import shared_task

from skyspy.models import AcarsMessage
from skyspy.services.acars_decoder import decode_message_text
from skyspy.services.libacars_binding import is_available as libacars_is_available

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=5)
def decode_acars_message(self, message_id: int):
    """
    Decode a single ACARS message using libacars.

    This task is queued after a message is stored in the database.
    It runs libacars decoding and updates the decoded field.

    Args:
        message_id: ID of the AcarsMessage to decode
    """
    try:
        message = AcarsMessage.objects.get(id=message_id)
    except AcarsMessage.DoesNotExist:
        logger.warning(f"ACARS message {message_id} not found for decoding")
        return

    # Skip if already decoded
    if message.decoded:
        return

    # Skip if no text to decode
    if not message.text:
        return

    try:
        # Determine message direction
        # In ACARS, we typically don't have explicit direction in our model
        # Default to unknown
        direction = 0

        # Decode the message text
        decoded = decode_message_text(
            text=message.text,
            label=message.label,
            libacars_data=None,  # Force fresh decode
            direction=direction,
        )

        if decoded:
            message.decoded = decoded
            message.save(update_fields=["decoded"])
            logger.debug(f"Decoded ACARS message {message_id}: {list(decoded.keys())}")
        else:
            # Undecodable content: store an empty-dict sentinel so the
            # periodic decode queue (decoded__isnull=True) doesn't requeue
            # this message forever, starving older undecoded messages
            message.decoded = {}
            message.save(update_fields=["decoded"])
            logger.debug(f"ACARS message {message_id} undecodable, marked as attempted")

    except Exception as e:  # broad: Celery task guard over libacars decode + DB save; retries transient failures
        logger.error(f"Error decoding ACARS message {message_id}: {e}")
        # Retry on transient errors
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e)


@shared_task(ignore_result=True)
def process_acars_decode_queue():
    """
    Process batch of ACARS messages that haven't been decoded yet.

    This is a periodic task that picks up messages that may have
    been missed or need re-processing.
    """
    if not libacars_is_available():
        logger.debug("libacars not available, skipping decode queue")
        return

    # Get messages without decoded content (limit batch size)
    # Only process messages with decodable labels
    decodable_labels = [
        "H1",
        "H2",  # FANS-1/A
        "SA",
        "S1",
        "S2",  # System
        "AA",
        "AB",
        "AC",  # ARINC 622
        "BA",
        "B1",
        "B2",
        "B3",
        "B4",
        "B5",
        "B6",  # Various
        "_d",
        "2Z",
        "5Z",  # MIAM
        "10",
        "11",
        "12",
        "13",
        "80",  # OOOI events
    ]

    messages = AcarsMessage.objects.filter(
        decoded__isnull=True,
        text__isnull=False,
        label__in=decodable_labels,
    ).order_by("-timestamp")[:50]

    queued = 0
    for message in messages:
        decode_acars_message.delay(message.id)
        queued += 1

    if queued > 0:
        logger.info(f"Queued {queued} ACARS messages for decoding")


@shared_task
def decode_acars_batch(message_ids: list[int]):
    """
    Decode a batch of ACARS messages.

    More efficient than individual tasks for bulk processing.

    Args:
        message_ids: List of AcarsMessage IDs to decode
    """
    if not message_ids:
        return

    messages = AcarsMessage.objects.filter(
        id__in=message_ids,
        decoded__isnull=True,
        text__isnull=False,
    )

    decoded_count = 0
    for message in messages:
        try:
            decoded = decode_message_text(
                text=message.text,
                label=message.label,
                libacars_data=None,
                direction=0,
            )

            if decoded:
                message.decoded = decoded
                message.save(update_fields=["decoded"])
                decoded_count += 1
            else:
                # Mark undecodable messages so they aren't requeued forever
                message.decoded = {}
                message.save(update_fields=["decoded"])

        except Exception as e:  # broad: batch loop must continue past any per-message decode/save failure
            logger.error(f"Error decoding ACARS message {message.id}: {e}")

    if decoded_count > 0:
        logger.info(f"Decoded {decoded_count}/{len(message_ids)} ACARS messages in batch")
