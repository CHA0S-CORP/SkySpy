"""
Safety WebSocket consumer for TCAS and safety event monitoring.
"""
import logging
from datetime import datetime, timedelta
from channels.db import database_sync_to_async
from django.utils import timezone

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.models import SafetyEvent

logger = logging.getLogger(__name__)


class SafetyConsumer(BaseConsumer):
    """
    WebSocket consumer for safety events.

    Events:
    - safety:snapshot - Initial active safety events on connect
    - safety:event - New safety event (TCAS, conflicts, emergencies)
    - safety:event_updated - Event status changed
    - safety:event_resolved - Event resolved/expired

    Topics:
    - events - All safety events
    - tcas - TCAS-specific events
    - emergency - Emergency squawk events
    - all - All safety data
    """

    group_name_prefix = 'safety'
    supported_topics = ['events', 'tcas', 'emergency', 'all']

    async def send_initial_state(self):
        """Send initial safety events snapshot on connect."""
        active_events = await self.get_active_events()

        await self.send_json({
            'type': 'safety:snapshot',
            'data': {
                'events': active_events,
                'count': len(active_events),
                'timestamp': datetime.utcnow().isoformat()
            }
        })

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response messages."""
        if request_type == 'active_events':
            events = await self.get_active_events(
                event_type=params.get('event_type'),
                severity=params.get('severity')
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'active_events',
                'data': events
            })

        elif request_type == 'event_history':
            events = await self.get_event_history(
                event_type=params.get('event_type'),
                icao=params.get('icao'),
                limit=params.get('limit', 50)
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'event_history',
                'data': events
            })

        elif request_type == 'acknowledge' or request_type == 'safety-acknowledge':
            event_id = params.get('event_id') or params.get('id')
            if event_id:
                result = await self.acknowledge_event(event_id)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': request_type,
                    'data': result
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing event_id parameter'
                })

        elif request_type == 'safety-event-detail':
            event_id = params.get('event_id') or params.get('id')
            if event_id:
                event = await self.get_event_detail(event_id)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'safety-event-detail',
                    'data': event
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing event_id parameter'
                })

        else:
            await super().handle_request(request_type, request_id, params)

    @database_sync_to_async
    def get_active_events(self, event_type=None, severity=None):
        """Get active (recent) safety events."""
        # Events active within last 5 minutes
        cutoff = timezone.now() - timedelta(minutes=5)
        queryset = SafetyEvent.objects.filter(
            timestamp__gte=cutoff,
            acknowledged=False
        )

        if event_type:
            queryset = queryset.filter(event_type=event_type)
        if severity:
            queryset = queryset.filter(severity=severity)

        events = []
        for event in queryset.order_by('-timestamp')[:100]:
            events.append(self._serialize_event(event))
        return events

    @database_sync_to_async
    def get_event_history(self, event_type=None, icao=None, limit=50):
        """Get historical safety events."""
        queryset = SafetyEvent.objects.all()

        if event_type:
            queryset = queryset.filter(event_type=event_type)
        if icao:
            queryset = queryset.filter(icao_hex=icao)

        events = []
        for event in queryset.order_by('-timestamp')[:limit]:
            events.append(self._serialize_event(event))
        return events

    @database_sync_to_async
    def acknowledge_event(self, event_id: int):
        """Acknowledge a safety event."""
        try:
            event = SafetyEvent.objects.get(id=event_id)
            event.acknowledged = True
            event.acknowledged_at = timezone.now()
            event.save()
            return {'success': True, 'event_id': event_id}
        except SafetyEvent.DoesNotExist:
            return {'success': False, 'error': 'Event not found'}

    @database_sync_to_async
    def get_event_detail(self, event_id: int):
        """Get detailed safety event by ID."""
        try:
            event = SafetyEvent.objects.get(id=event_id)
            return self._serialize_event(event)
        except SafetyEvent.DoesNotExist:
            return {'error': 'Event not found'}

    def _serialize_event(self, event: SafetyEvent) -> dict:
        """Serialize a safety event to dict."""
        return {
            'id': event.id,
            'timestamp': event.timestamp.isoformat(),
            'event_type': event.event_type,
            'severity': event.severity,
            'icao_hex': event.icao_hex,
            'icao_hex_2': event.icao_hex_2,
            'callsign': event.callsign,
            'callsign_2': event.callsign_2,
            'message': event.message,
            'details': event.details,
            'aircraft_snapshot': event.aircraft_snapshot,
            'aircraft_snapshot_2': event.aircraft_snapshot_2,
            'acknowledged': event.acknowledged,
            'acknowledged_at': event.acknowledged_at.isoformat() if event.acknowledged_at else None,
        }

    # Channel layer message handlers

    async def safety_snapshot(self, event):
        """Handle safety snapshot broadcast."""
        await self.send_json({
            'type': 'safety:snapshot',
            'data': event['data']
        })

    async def safety_event(self, event):
        """Handle new safety event broadcast."""
        await self.send_json({
            'type': 'safety:event',
            'data': event['data']
        })

    async def safety_event_updated(self, event):
        """Handle safety event update broadcast."""
        await self.send_json({
            'type': 'safety:event_updated',
            'data': event['data']
        })

    async def safety_event_resolved(self, event):
        """Handle safety event resolution broadcast."""
        await self.send_json({
            'type': 'safety:event_resolved',
            'data': event['data']
        })
