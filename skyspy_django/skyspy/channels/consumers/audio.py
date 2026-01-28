"""
Audio WebSocket consumer for transcription updates and audio transmission streaming.
"""
import logging
from datetime import datetime, timedelta
from channels.db import database_sync_to_async
from django.utils import timezone

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.models import AudioTransmission

logger = logging.getLogger(__name__)


class AudioConsumer(BaseConsumer):
    """
    WebSocket consumer for audio transcription updates.

    Events:
    - audio:transmission - New audio transmission uploaded
    - audio:transcription_started - Transcription processing started
    - audio:transcription_completed - Transcription completed
    - audio:transcription_failed - Transcription failed

    Topics:
    - transmissions - All audio transmissions
    - transcriptions - Transcription updates only
    - all - All audio data
    """

    group_name_prefix = 'audio'
    supported_topics = ['transmissions', 'transcriptions', 'all']

    async def send_initial_state(self):
        """Send recent transmissions on connect."""
        recent = await self.get_recent_transmissions()
        pending = await self.get_pending_transcriptions()

        await self.send_json({
            'type': 'audio:snapshot',
            'data': {
                'recent_transmissions': recent,
                'pending_transcriptions': len(pending),
                'timestamp': datetime.utcnow().isoformat()
            }
        })

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response messages."""
        if request_type == 'transmissions':
            transmissions = await self.get_transmissions(
                frequency=params.get('frequency'),
                channel_name=params.get('channel_name'),
                transcription_status=params.get('transcription_status'),
                limit=params.get('limit', 50)
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'transmissions',
                'data': transmissions
            })

        elif request_type == 'transmission':
            transmission_id = params.get('id')
            if transmission_id:
                transmission = await self.get_transmission(transmission_id)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'transmission',
                    'data': transmission
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing id parameter'
                })

        elif request_type == 'stats':
            stats = await self.get_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'stats',
                'data': stats
            })

        else:
            await super().handle_request(request_type, request_id, params)

    @database_sync_to_async
    def get_recent_transmissions(self, limit=10):
        """Get recent audio transmissions."""
        transmissions = []
        for trans in AudioTransmission.objects.order_by('-created_at')[:limit]:
            transmissions.append(self._serialize_transmission(trans))
        return transmissions

    @database_sync_to_async
    def get_pending_transcriptions(self):
        """Get pending transcription queue."""
        return list(
            AudioTransmission.objects.filter(
                transcription_status__in=['pending', 'queued', 'processing']
            ).values_list('id', flat=True)[:100]
        )

    @database_sync_to_async
    def get_transmissions(self, frequency=None, channel_name=None,
                          transcription_status=None, limit=50):
        """Get audio transmissions with filters."""
        queryset = AudioTransmission.objects.all()

        if frequency:
            queryset = queryset.filter(frequency_mhz=frequency)
        if channel_name:
            queryset = queryset.filter(channel_name__icontains=channel_name)
        if transcription_status:
            queryset = queryset.filter(transcription_status=transcription_status)

        transmissions = []
        for trans in queryset.order_by('-created_at')[:limit]:
            transmissions.append(self._serialize_transmission(trans))
        return transmissions

    @database_sync_to_async
    def get_transmission(self, transmission_id: int):
        """Get single audio transmission."""
        try:
            trans = AudioTransmission.objects.get(id=transmission_id)
            return self._serialize_transmission(trans)
        except AudioTransmission.DoesNotExist:
            return None

    @database_sync_to_async
    def get_stats(self):
        """Get audio statistics."""
        now = timezone.now()
        last_24h = now - timedelta(hours=24)

        total = AudioTransmission.objects.count()
        last_24h_count = AudioTransmission.objects.filter(created_at__gte=last_24h).count()

        # Status counts
        from django.db.models import Count, Sum
        status_counts = dict(
            AudioTransmission.objects.values_list('transcription_status')
            .annotate(count=Count('id'))
        )

        # Total duration
        total_duration = AudioTransmission.objects.aggregate(
            total=Sum('duration_seconds')
        )['total'] or 0

        # Get top frequencies
        top_frequencies = list(
            AudioTransmission.objects.filter(frequency_mhz__isnull=False)
            .values('frequency_mhz')
            .annotate(count=Count('id'))
            .order_by('-count')[:10]
        )

        return {
            'total_transmissions': total,
            'last_24h': last_24h_count,
            'total_duration_seconds': total_duration,
            'status_counts': status_counts,
            'top_frequencies': top_frequencies,
            'timestamp': now.isoformat()
        }

    def _serialize_transmission(self, trans: AudioTransmission) -> dict:
        """Serialize an audio transmission to dict."""
        return {
            'id': trans.id,
            'created_at': trans.created_at.isoformat(),
            'filename': trans.filename,
            's3_url': trans.s3_url,
            'file_size_bytes': trans.file_size_bytes,
            'duration_seconds': trans.duration_seconds,
            'format': trans.format,
            'frequency_mhz': trans.frequency_mhz,
            'channel_name': trans.channel_name,
            'squelch_level': trans.squelch_level,
            'transcription_status': trans.transcription_status,
            'transcription_queued_at': (
                trans.transcription_queued_at.isoformat()
                if trans.transcription_queued_at else None
            ),
            'transcription_completed_at': (
                trans.transcription_completed_at.isoformat()
                if trans.transcription_completed_at else None
            ),
            'transcript': trans.transcript,
            'transcript_confidence': trans.transcript_confidence,
            'transcript_language': trans.transcript_language,
            'identified_airframes': trans.identified_airframes,
        }

    # Channel layer message handlers

    async def audio_transmission(self, event):
        """Handle new audio transmission broadcast."""
        await self.send_json({
            'type': 'audio:transmission',
            'data': event['data']
        })

    async def audio_transcription_started(self, event):
        """Handle transcription started broadcast."""
        await self.send_json({
            'type': 'audio:transcription_started',
            'data': event['data']
        })

    async def audio_transcription_completed(self, event):
        """Handle transcription completed broadcast."""
        await self.send_json({
            'type': 'audio:transcription_completed',
            'data': event['data']
        })

    async def audio_transcription_failed(self, event):
        """Handle transcription failed broadcast."""
        await self.send_json({
            'type': 'audio:transcription_failed',
            'data': event['data']
        })

    async def audio_snapshot(self, event):
        """Handle audio snapshot broadcast."""
        await self.send_json({
            'type': 'audio:snapshot',
            'data': event['data']
        })
