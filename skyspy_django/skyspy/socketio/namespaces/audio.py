"""
Audio Socket.IO namespace for SkysPy.

Provides real-time audio transcription updates and transmission streaming.

Events emitted:
- audio:snapshot - Initial state with recent transmissions and pending count
- audio:transmission - New audio transmission uploaded
- audio:transcription_started - Transcription processing started
- audio:transcription_completed - Transcription completed
- audio:transcription_failed - Transcription failed

Request/Response types:
- transmissions - Get filtered list of transmissions
- transmission - Get single transmission by ID
- stats - Get audio statistics
"""

import asyncio
import logging
from datetime import datetime, timedelta

import socketio
from asgiref.sync import sync_to_async
from django.utils import timezone

from skyspy.models import AudioTransmission
from skyspy.socketio.middleware import authenticate_socket, check_topic_permission
from skyspy.socketio.namespaces.mixins import parse_int_param
from skyspy.socketio.server import sio
from skyspy.socketio.utils.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)


class AudioNamespace(socketio.AsyncNamespace):
    """
    Socket.IO namespace for audio transcription updates.

    Rooms:
    - audio_transmissions - All audio transmissions
    - audio_transcriptions - Transcription updates only
    - audio_all - All audio data
    """

    def __init__(self):
        super().__init__("/audio")
        self.supported_topics = ["transmissions", "transcriptions", "all"]

    async def on_connect(self, sid, environ, auth=None):
        """
        Handle client connection.

        Authenticates the user, checks permissions, joins default rooms,
        and sends initial state.
        """
        # Authenticate the connection
        user, error = await authenticate_socket(auth)

        if error:
            from django.conf import settings as django_settings

            auth_mode = getattr(django_settings, "AUTH_MODE", "hybrid")
            reject_invalid = getattr(django_settings, "WS_REJECT_INVALID_TOKENS", False)
            if auth_mode == "private" or (auth_mode == "hybrid" and reject_invalid):
                logger.warning(f"Audio namespace auth rejected for {sid}: {error}")
                return False
            logger.warning(f"Audio namespace auth error for {sid}: {error}")

        # Store user in session with rate limiter
        await sio.save_session(
            sid,
            {
                "user": user,
                "auth_error": error,
                "rate_limiter": RateLimiter(),
            },
            namespace="/audio",
        )

        # Check permission to access audio
        if not await check_topic_permission(user, "audio"):
            logger.warning(f"Audio namespace permission denied for {sid}")
            return False  # Reject connection

        # Join default rooms
        await self.enter_room(sid, "audio_transmissions")
        await self.enter_room(sid, "audio_transcriptions")
        await self.enter_room(sid, "audio_all")

        logger.info(f"Client connected to /audio: {sid}")

        # Send initial state
        await self._send_initial_state(sid)

        return True

    async def on_disconnect(self, sid):
        """Handle client disconnection and clean up resources."""
        try:
            session = await sio.get_session(sid, namespace="/audio")

            # Clean up rate limiter to prevent memory leaks
            rate_limiter = session.get("rate_limiter")
            if rate_limiter:
                rate_limiter.cleanup_old_entries()
                rate_limiter.reset()

            # Clear session data
            await sio.save_session(sid, {}, namespace="/audio")
        except Exception as e:  # broad: disconnect cleanup must never raise
            logger.debug(f"Error during audio disconnect cleanup for {sid}: {e}")

        logger.info(f"Client disconnected from /audio: {sid}")

    async def _send_initial_state(self, sid):
        """Send recent transmissions and pending count on connect."""
        recent = await self._get_recent_transmissions()
        pending = await self._get_pending_transcriptions()

        await self.emit(
            "audio:snapshot",
            {
                "recent_transmissions": recent,
                "pending_transcriptions": len(pending),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room=sid,
        )

    async def on_request(self, sid, data):
        """
        Handle request/response pattern messages.

        Expected data format:
        {
            "type": "transmissions" | "transmission" | "stats",
            "request_id": "unique-id",
            "params": {...}
        }
        """
        if not isinstance(data, dict):
            logger.warning(f"Invalid audio request from {sid}: expected dict, got {type(data).__name__}")
            await self.emit(
                "error",
                {"request_id": None, "message": "Invalid request: expected dict payload"},
                room=sid,
            )
            return

        # Check rate limiting
        session = await sio.get_session(sid, namespace="/audio")
        rate_limiter = session.get("rate_limiter")
        if rate_limiter and not rate_limiter.can_send("request"):
            await self.emit(
                "error",
                {"request_id": data.get("request_id"), "message": "Rate limit exceeded, please slow down"},
                room=sid,
            )
            return

        request_type = data.get("type")
        request_id = data.get("request_id")
        params = data.get("params", {})

        # Validate params is actually a dict
        if not isinstance(params, dict):
            params = {}

        try:
            if request_type == "transmissions":
                transmissions = await self._get_transmissions(
                    frequency=params.get("frequency"),
                    channel_name=params.get("channel_name"),
                    transcription_status=params.get("transcription_status"),
                    limit=parse_int_param(params.get("limit"), 50, min_val=1, max_val=500),
                )
                await self.emit(
                    "response",
                    {"request_id": request_id, "request_type": "transmissions", "data": transmissions},
                    room=sid,
                )

            elif request_type == "transmission":
                transmission_id = params.get("id")
                if transmission_id:
                    transmission = await self._get_transmission(transmission_id)
                    await self.emit(
                        "response",
                        {"request_id": request_id, "request_type": "transmission", "data": transmission},
                        room=sid,
                    )
                else:
                    await self.emit("error", {"request_id": request_id, "message": "Missing id parameter"}, room=sid)

            elif request_type == "stats":
                stats = await self._get_stats()
                await self.emit(
                    "response", {"request_id": request_id, "request_type": "stats", "data": stats}, room=sid
                )

            else:
                await self.emit(
                    "error", {"request_id": request_id, "message": f"Unknown request type: {request_type}"}, room=sid
                )
        except asyncio.CancelledError:
            logger.debug(f"Audio request {request_type} cancelled for {sid} (client disconnected)")
        except Exception as e:  # broad: top-level dispatch guard; must degrade to error response, not a hung client
            logger.exception(f"Error handling audio request {request_type} for {sid}: {e}")
            await self.emit("error", {"request_id": request_id, "message": "Internal server error"}, room=sid)

    async def on_subscribe(self, sid, data):
        """
        Handle topic subscription.

        Expected data:
        {"topics": ["transmissions", "transcriptions"]}
        or
        {"topics": "all"}
        """
        if not isinstance(data, dict):
            logger.warning(f"Invalid audio subscribe from {sid}: expected dict, got {type(data).__name__}")
            await self.emit(
                "error",
                {"message": "Invalid subscription request: expected dict with 'topics' key"},
                room=sid,
            )
            return

        topics = data.get("topics", [])
        if isinstance(topics, str):
            topics = [topics]

        session = await sio.get_session(sid, namespace="/audio")
        user = session.get("user")

        joined = []
        for topic in topics:
            topics_to_join = self.supported_topics if topic == "all" else [topic]

            for t in topics_to_join:
                if t in self.supported_topics and await check_topic_permission(user, "audio"):
                    room_name = f"audio_{t}"
                    await self.enter_room(sid, room_name)
                    joined.append(t)

        await self.emit("subscribed", {"topics": joined}, room=sid)

    async def on_unsubscribe(self, sid, data):
        """
        Handle topic unsubscription.

        Expected data:
        {"topics": ["transmissions"]}
        """
        if not isinstance(data, dict):
            logger.warning(f"Invalid audio unsubscribe from {sid}: expected dict, got {type(data).__name__}")
            await self.emit(
                "error",
                {"message": "Invalid unsubscription request: expected dict with 'topics' key"},
                room=sid,
            )
            return

        topics = data.get("topics", [])
        if isinstance(topics, str):
            topics = [topics]

        left = []
        for topic in topics:
            if topic in self.supported_topics:
                room_name = f"audio_{topic}"
                await self.leave_room(sid, room_name)
                left.append(topic)

        await self.emit("unsubscribed", {"topics": left}, room=sid)

    # Database query methods

    @sync_to_async(thread_sensitive=True)
    def _get_recent_transmissions(self, limit: int = 10):
        """Get recent audio transmissions."""
        transmissions = []
        for trans in AudioTransmission.objects.order_by("-created_at")[:limit]:
            transmissions.append(self._serialize_transmission(trans))
        return transmissions

    @sync_to_async(thread_sensitive=True)
    def _get_pending_transcriptions(self):
        """Get pending transcription queue."""
        return list(
            AudioTransmission.objects.filter(transcription_status__in=["pending", "queued", "processing"]).values_list(
                "id", flat=True
            )[:100]
        )

    @sync_to_async(thread_sensitive=True)
    def _get_transmissions(
        self,
        frequency: float | None = None,
        channel_name: str | None = None,
        transcription_status: str | None = None,
        limit: int = 50,
    ):
        """Get audio transmissions with filters."""
        queryset = AudioTransmission.objects.all()

        if frequency:
            queryset = queryset.filter(frequency_mhz=frequency)
        if channel_name:
            queryset = queryset.filter(channel_name__icontains=channel_name)
        if transcription_status:
            queryset = queryset.filter(transcription_status=transcription_status)

        transmissions = []
        for trans in queryset.order_by("-created_at")[:limit]:
            transmissions.append(self._serialize_transmission(trans))
        return transmissions

    @sync_to_async(thread_sensitive=True)
    def _get_transmission(self, transmission_id: int):
        """Get single audio transmission."""
        try:
            trans = AudioTransmission.objects.get(id=transmission_id)
            return self._serialize_transmission(trans)
        except AudioTransmission.DoesNotExist:
            return None

    @sync_to_async(thread_sensitive=True)
    def _get_stats(self):
        """Get audio statistics."""
        now = timezone.now()
        last_24h = now - timedelta(hours=24)

        total = AudioTransmission.objects.count()
        last_24h_count = AudioTransmission.objects.filter(created_at__gte=last_24h).count()

        # Status counts
        from django.db.models import Count, Sum

        status_counts = dict(AudioTransmission.objects.values_list("transcription_status").annotate(count=Count("id")))

        # Total duration
        total_duration = AudioTransmission.objects.aggregate(total=Sum("duration_seconds"))["total"] or 0

        # Get top frequencies
        top_frequencies = list(
            AudioTransmission.objects.filter(frequency_mhz__isnull=False)
            .values("frequency_mhz")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        return {
            "total_transmissions": total,
            "last_24h": last_24h_count,
            "total_duration_seconds": total_duration,
            "status_counts": status_counts,
            "top_frequencies": top_frequencies,
            "timestamp": now.isoformat(),
        }

    def _serialize_transmission(self, trans: AudioTransmission) -> dict:
        """Serialize an audio transmission to dict."""
        return {
            "id": trans.id,
            "created_at": trans.created_at.isoformat(),
            "filename": trans.filename,
            "s3_url": trans.s3_url,
            "file_size_bytes": trans.file_size_bytes,
            "duration_seconds": trans.duration_seconds,
            "format": trans.format,
            "frequency_mhz": trans.frequency_mhz,
            "channel_name": trans.channel_name,
            "squelch_level": trans.squelch_level,
            "transcription_status": trans.transcription_status,
            "transcription_queued_at": (
                trans.transcription_queued_at.isoformat() if trans.transcription_queued_at else None
            ),
            "transcription_completed_at": (
                trans.transcription_completed_at.isoformat() if trans.transcription_completed_at else None
            ),
            "transcript": trans.transcript,
            "transcript_confidence": trans.transcript_confidence,
            "transcript_language": trans.transcript_language,
            "identified_airframes": trans.identified_airframes,
        }


# Create and register the namespace
audio_namespace = AudioNamespace()


def register_audio_namespace():
    """Register the audio namespace with the Socket.IO server."""
    sio.register_namespace(audio_namespace)
    logger.info("Registered AudioNamespace at /audio")


# Broadcast helper functions for use by other parts of the application
#
# Note: Clients in 'audio_all' also join specific rooms (audio_transmissions,
# audio_transcriptions), so we only emit to the specific room to avoid
# duplicate messages. The 'audio_all' room is used during on_connect to join
# all rooms, but broadcasts go to specific rooms only.


async def broadcast_transmission(data: dict):
    """Broadcast a new audio transmission to subscribers."""
    # Only emit to audio_transmissions room - clients subscribed to 'all'
    # are also in this room, so they will receive the message
    await sio.emit("audio:transmission", data, room="audio_transmissions", namespace="/audio")


async def broadcast_transcription_started(data: dict):
    """Broadcast transcription started event."""
    # Only emit to audio_transcriptions room - clients subscribed to 'all'
    # are also in this room, so they will receive the message
    await sio.emit("audio:transcription_started", data, room="audio_transcriptions", namespace="/audio")


async def broadcast_transcription_completed(data: dict):
    """Broadcast transcription completed event."""
    # Only emit to audio_transcriptions room - clients subscribed to 'all'
    # are also in this room, so they will receive the message
    await sio.emit("audio:transcription_completed", data, room="audio_transcriptions", namespace="/audio")


async def broadcast_transcription_failed(data: dict):
    """Broadcast transcription failed event."""
    # Only emit to audio_transcriptions room - clients subscribed to 'all'
    # are also in this room, so they will receive the message
    await sio.emit("audio:transcription_failed", data, room="audio_transcriptions", namespace="/audio")
