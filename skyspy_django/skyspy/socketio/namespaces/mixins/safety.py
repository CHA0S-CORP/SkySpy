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
                    # Frontend consumer (useSafetyEvents) keys off icao/icao_2/details;
                    # keep icao_hex/icao_hex_2 for back-compat. Matches the live
                    # safety:event push shape (services/safety.py).
                    "icao": e.icao_hex,
                    "icao_hex": e.icao_hex,
                    "icao_2": e.icao_hex_2,
                    "icao_hex_2": e.icao_hex_2,
                    "callsign": e.callsign,
                    "callsign_2": e.callsign_2,
                    "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                    "message": e.message,
                    "details": e.details or {},
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
            # Detection runs in the celery worker, which publishes its stats to
            # the shared cache; this process's monitor never tracks aircraft.
            from django.core.cache import cache

            from skyspy.services.safety import safety_monitor

            stats = cache.get("safety:monitor_stats") or safety_monitor.get_stats()
            tracked_aircraft = stats.get("tracked_aircraft", 0)
            enabled = stats.get("monitoring_enabled", enabled)
        except (ImportError, AttributeError, TypeError, KeyError):
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
                "message": event.message,
                "acknowledged": event.acknowledged,
                "acknowledged_at": event.acknowledged_at.isoformat() if event.acknowledged_at else None,
                # Position/telemetry live in the aircraft_snapshot JSON, not on the model
                "latitude": (event.aircraft_snapshot or {}).get("lat"),
                "longitude": (event.aircraft_snapshot or {}).get("lon"),
                "altitude": (event.aircraft_snapshot or {}).get("alt_baro"),
                "ground_speed": (event.aircraft_snapshot or {}).get("gs"),
                "vertical_rate": (event.aircraft_snapshot or {}).get("baro_rate"),
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
            # Broadcast so every other connected client sees the ack; the
            # worker's monitor picks the DB flag up via its periodic ack sync.
            from skyspy.services.safety import safety_monitor

            safety_monitor.broadcast_event_updated({"id": str(event.id), "db_id": event.id, "acknowledged": True})
            return {
                "success": True,
                "id": str(event.id),
                "acknowledged": True,
                "acknowledged_at": event.acknowledged_at.isoformat(),
            }
        except SafetyEvent.DoesNotExist:
            raise ValueError("Event not found")
