"""
ACARS WebSocket consumer for ACARS/VDL2 message streaming.
"""
import logging
from datetime import datetime, timedelta
from channels.db import database_sync_to_async
from django.utils import timezone

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.models import AcarsMessage

logger = logging.getLogger(__name__)


class AcarsConsumer(BaseConsumer):
    """
    WebSocket consumer for ACARS/VDL2 messages.

    Events:
    - acars:message - New ACARS/VDL2 message received
    - acars:snapshot - Recent messages on connect

    Topics:
    - messages - All ACARS messages
    - vdlm2 - VDL Mode 2 messages only
    - all - All ACARS data
    """

    group_name_prefix = 'acars'
    supported_topics = ['messages', 'vdlm2', 'all']

    async def send_initial_state(self):
        """Send recent ACARS messages on connect."""
        recent_messages = await self.get_recent_messages()

        await self.send_json({
            'type': 'acars:snapshot',
            'data': {
                'messages': recent_messages,
                'count': len(recent_messages),
                'timestamp': datetime.utcnow().isoformat()
            }
        })

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response messages."""
        if request_type == 'messages' or request_type == 'acars-messages':
            # Support both 'icao' and 'icao_hex' parameter names
            icao = params.get('icao') or params.get('icao_hex')
            messages = await self.get_messages(
                icao=icao,
                callsign=params.get('callsign'),
                label=params.get('label'),
                source=params.get('source'),
                frequency=params.get('frequency'),
                hours=params.get('hours'),
                limit=params.get('limit', 50)
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': request_type,
                'data': messages
            })

        elif request_type == 'stats':
            stats = await self.get_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'stats',
                'data': stats
            })

        elif request_type == 'labels':
            # Return label reference data
            from skyspy.data.message_labels import ACARS_LABELS
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'labels',
                'data': ACARS_LABELS
            })

        else:
            await super().handle_request(request_type, request_id, params)

    @database_sync_to_async
    def get_recent_messages(self, limit=20):
        """Get recent ACARS messages."""
        messages = []
        for msg in AcarsMessage.objects.order_by('-timestamp')[:limit]:
            messages.append(self._serialize_message(msg))
        return messages

    @database_sync_to_async
    def get_messages(self, icao=None, callsign=None, label=None, source=None, frequency=None, hours=None, limit=50):
        """Get ACARS messages with filters."""
        queryset = AcarsMessage.objects.all()

        # Time filter
        if hours:
            cutoff = timezone.now() - timedelta(hours=int(hours))
            queryset = queryset.filter(timestamp__gte=cutoff)

        if icao:
            queryset = queryset.filter(icao_hex=icao.upper())
        if callsign:
            queryset = queryset.filter(callsign__icontains=callsign)
        if label:
            queryset = queryset.filter(label=label)
        if source:
            queryset = queryset.filter(source=source)
        if frequency:
            queryset = queryset.filter(frequency=frequency)

        messages = []
        for msg in queryset.order_by('-timestamp')[:limit]:
            messages.append(self._serialize_message(msg))
        return messages

    @database_sync_to_async
    def get_stats(self):
        """Get ACARS statistics."""
        now = timezone.now()
        last_hour = now - timedelta(hours=1)
        last_24h = now - timedelta(hours=24)

        total = AcarsMessage.objects.count()
        last_hour_count = AcarsMessage.objects.filter(timestamp__gte=last_hour).count()
        last_24h_count = AcarsMessage.objects.filter(timestamp__gte=last_24h).count()

        # Get counts by source
        from django.db.models import Count
        by_source = dict(
            AcarsMessage.objects.filter(timestamp__gte=last_24h)
            .values_list('source')
            .annotate(count=Count('id'))
        )

        # Get top labels
        top_labels = list(
            AcarsMessage.objects.filter(timestamp__gte=last_24h)
            .values('label')
            .annotate(count=Count('id'))
            .order_by('-count')[:10]
        )

        return {
            'total_messages': total,
            'last_hour': last_hour_count,
            'last_24h': last_24h_count,
            'by_source': by_source,
            'top_labels': top_labels,
            'timestamp': now.isoformat()
        }

    def _serialize_message(self, msg: AcarsMessage) -> dict:
        """Serialize an ACARS message to dict."""
        return {
            'id': msg.id,
            'timestamp': msg.timestamp.isoformat(),
            'source': msg.source,
            'channel': msg.channel,
            'frequency': msg.frequency,
            'icao_hex': msg.icao_hex,
            'registration': msg.registration,
            'callsign': msg.callsign,
            'label': msg.label,
            'block_id': msg.block_id,
            'msg_num': msg.msg_num,
            'ack': msg.ack,
            'mode': msg.mode,
            'text': msg.text,
            'decoded': msg.decoded,
            'signal_level': msg.signal_level,
            'error_count': msg.error_count,
            'station_id': msg.station_id,
        }

    # Channel layer message handlers

    async def acars_message(self, event):
        """Handle new ACARS message broadcast."""
        await self.send_json({
            'type': 'acars:message',
            'data': event['data']
        })

    async def acars_snapshot(self, event):
        """Handle ACARS snapshot broadcast."""
        await self.send_json({
            'type': 'acars:snapshot',
            'data': event['data']
        })
