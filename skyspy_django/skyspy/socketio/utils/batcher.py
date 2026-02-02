"""
Message batcher for Socket.IO.

Batches messages for efficient sending, reducing the number of
individual emissions while maintaining responsiveness.
"""
import asyncio
import json
import logging
from collections import deque
from datetime import datetime
from typing import Callable, Optional, Any

logger = logging.getLogger(__name__)


# Default batch configuration
DEFAULT_BATCH_CONFIG = {
    'window_ms': 200,                              # Batch window in milliseconds
    'max_size': 50,                                # Maximum messages per batch
    'max_bytes': 1024 * 1024,                      # Maximum batch size (1MB)
    'immediate_types': ['alert', 'safety', 'emergency'],  # Types sent immediately
}


class MessageBatcher:
    """Batches messages for efficient sending."""

    def __init__(
        self,
        send_callback: Callable[[dict], Any],
        config: Optional[dict] = None
    ):
        """
        Initialize the message batcher.

        Args:
            send_callback: Async callable that takes a dict message to send.
            config: Optional configuration dict with keys:
                - window_ms: Batch window in milliseconds (default: 200)
                - max_size: Maximum messages per batch (default: 50)
                - max_bytes: Maximum batch size in bytes (default: 1MB)
                - immediate_types: List of message types to send immediately
        """
        self._batch: deque = deque()
        self._batch_size_bytes: int = 0  # Track total byte size of batch
        self._send_callback = send_callback
        self._batch_task: Optional[asyncio.Task] = None
        self._config = config if config is not None else DEFAULT_BATCH_CONFIG.copy()
        self._lock = asyncio.Lock()

    async def add(self, message: dict):
        """
        Add a message to the batch.

        Messages with types matching immediate_types will be sent immediately.
        Other messages are batched and sent when the batch window expires,
        the batch is full (by count), or the batch exceeds max_bytes.

        Args:
            message: The message dict to add. Should have a 'type' key.
        """
        msg_type = message.get('type', '')

        # Check if this message type should be sent immediately
        for immediate_type in self._config['immediate_types']:
            if immediate_type in msg_type:
                await self._send_callback(message)
                return

        # Estimate message size for byte limit enforcement
        try:
            msg_size = len(json.dumps(message))
        except (TypeError, ValueError):
            msg_size = 1024  # Default estimate if serialization fails

        # Determine if we need to flush after adding (check outside lock to avoid deadlock)
        should_flush = False

        async with self._lock:
            self._batch.append(message)
            self._batch_size_bytes += msg_size

            # Start batch timer if not running
            if self._batch_task is None or self._batch_task.done():
                self._batch_task = asyncio.create_task(self._flush_after_delay())

            # Check if batch is full (by count OR by bytes)
            max_bytes = self._config.get('max_bytes', 1024 * 1024)
            if len(self._batch) >= self._config['max_size'] or self._batch_size_bytes >= max_bytes:
                if self._batch_task and not self._batch_task.done():
                    self._batch_task.cancel()
                should_flush = True

        # Flush outside the lock to avoid deadlock (since _flush acquires the lock)
        if should_flush:
            try:
                await self._flush()
            except Exception as e:
                # Log error but don't lose already-cleared messages
                # (messages were already removed from batch in _flush)
                logger.error(f"Error flushing message batch: {e}", exc_info=True)

    async def _flush_after_delay(self):
        """Wait for batch window then flush."""
        try:
            await asyncio.sleep(self._config['window_ms'] / 1000.0)
            await self._flush()
        except asyncio.CancelledError:
            # Task was cancelled (likely due to immediate flush), this is expected
            pass
        except Exception as e:
            # Log error to prevent silent message loss
            logger.error(f"Error in delayed batch flush: {e}", exc_info=True)

    async def _flush(self):
        """Send all batched messages."""
        async with self._lock:
            if not self._batch:
                return

            # Group messages by type for combined sending
            messages = list(self._batch)
            self._batch.clear()
            self._batch_size_bytes = 0  # Reset byte counter

        if len(messages) == 1:
            # Single message, send directly
            await self._send_callback(messages[0])
        else:
            # Multiple messages, send as batch
            await self._send_callback({
                'type': 'batch',
                'messages': messages,
                'count': len(messages),
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            })

    async def flush_now(self):
        """Force flush any pending messages."""
        if self._batch_task and not self._batch_task.done():
            self._batch_task.cancel()
        try:
            await self._flush()
        except Exception as e:
            logger.error(f"Error in flush_now: {e}", exc_info=True)

    @property
    def pending_count(self) -> int:
        """Return the number of messages currently in the batch."""
        return len(self._batch)

    @property
    def pending_bytes(self) -> int:
        """Return the estimated size of the current batch in bytes."""
        return self._batch_size_bytes
