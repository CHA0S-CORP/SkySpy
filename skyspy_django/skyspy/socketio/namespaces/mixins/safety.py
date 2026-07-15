"""Safety event handlers for MainNamespace."""

import logging
from datetime import datetime, timedelta

from asgiref.sync import sync_to_async
from django.conf import settings
from django.db.models import Count
from django.utils import timezone

from skyspy.socketio.namespaces.mixins import parse_int_param

logger = logging.getLogger(__name__)


class SafetyHandlerMixin:
    """Safety event stats, listing, detail, acknowledgment, and snapshot."""

    async def _handle_safety_stats(self, params: dict):
        """Get safety statistics."""
        return await self._get_safety_stats()

    async def _handle_safety_events(self, params: dict):
        """Get recent safety events."""
        return await self._get_safety_events(params)

    async def _handle_safety_monitor_status(self, params: dict):
        """Get safety monitor status."""
        return await self._get_safety_monitor_status()

    async def _handle_safety_event_detail(self, params: dict):
        """Get a specific safety event by ID."""
        event_id = params.get("id") or params.get("event_id")
        if not event_id:
            raise ValueError("Missing event id")
        return await self._get_safety_event_detail(event_id)

    async def _handle_safety_acknowledge(self, params: dict):
        """Acknowledge a safety event."""
        event_id = params.get("id") or params.get("event_id")
        if not event_id:
            raise ValueError("Missing event id")
        return await self._acknowledge_safety_event(event_id)

    async def _handle_safety_snapshot(self, params: dict):
        """Get safety events snapshot."""
        events = await self._get_safety_events(params)
        return {"events": events}

    # -----------------------------------------------------------------
    # Data access
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_safety_stats(self):
        """Get safety event statistics."""
        from skyspy.models import SafetyEvent

        cutoff = timezone.now() - timedelta(hours=24)
        events = SafetyEvent.objects.filter(timestamp__gte=cutoff)
        total = events.count()

        by_type = dict(events.values("event_type").annotate(count=Count("id")).values_list("event_type", "count"))

        by_severity = dict(events.values("severity").annotate(count=Count("id")).values_list("severity", "count"))

        return {
            "total_24h": total,
            "by_type": by_type,
            "by_severity": by_severity,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_safety_events(self, params: dict):
        """Get recent safety events."""
        from skyspy.models import SafetyEvent

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        limit = parse_int_param(params.get("limit"), 50, min_val=1, max_val=200)
        cutoff = timezone.now() - timedelta(hours=hours)

        events = SafetyEvent.objects.filter(timestamp__gte=cutoff).order_by("-timestamp")[:limit]

        result = []
        for e in events:
            result.append(
                {
                    "id": str(e.id),
                    "event_type": e.event_type,
                    "severity": e.severity,
                    "icao_hex": e.icao_hex,
                    "callsign": e.callsign,
                    "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                    "description": e.description,
                    "acknowledged": e.acknowledged,
                }
            )
        return result

    @sync_to_async
    def _get_safety_monitor_status(self):
        """Get safety monitor status."""
        enabled = getattr(settings, "SAFETY_MONITORING_ENABLED", True)
        tracked_aircraft = 0

        try:
            from skyspy.services.safety import safety_monitor

            stats = safety_monitor.get_stats()
            tracked_aircraft = stats.get("tracked_aircraft", 0)
        except Exception:
            pass

        return {
            "enabled": enabled,
            "tracked_aircraft": tracked_aircraft,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_safety_event_detail(self, event_id):
        """Get detailed safety event information."""
        from skyspy.models import SafetyEvent

        try:
            event = SafetyEvent.objects.get(id=event_id)
            return {
                "id": str(event.id),
                "event_type": event.event_type,
                "severity": event.severity,
                "icao_hex": event.icao_hex,
                "icao": event.icao_hex,
                "callsign": event.callsign,
                "timestamp": event.timestamp.isoformat() if event.timestamp else None,
                "description": event.description,
                "acknowledged": event.acknowledged,
                "acknowledged_at": event.acknowledged_at.isoformat() if event.acknowledged_at else None,
                "latitude": event.latitude,
                "longitude": event.longitude,
                "altitude": event.altitude,
                "ground_speed": event.ground_speed,
                "vertical_rate": event.vertical_rate,
                "details": event.details or {},
            }
        except SafetyEvent.DoesNotExist:
            return {"error": "not_found", "error_type": "not_found"}

    @sync_to_async
    def _acknowledge_safety_event(self, event_id):
        """Acknowledge a safety event."""
        from skyspy.models import SafetyEvent

        try:
            event = SafetyEvent.objects.get(id=event_id)
            event.acknowledged = True
            event.acknowledged_at = timezone.now()
            event.save(update_fields=["acknowledged", "acknowledged_at"])
            return {
                "success": True,
                "id": str(event.id),
                "acknowledged": True,
                "acknowledged_at": event.acknowledged_at.isoformat(),
            }
        except SafetyEvent.DoesNotExist:
            raise ValueError("Event not found")
