"""
Safety event monitoring API views.
"""

import logging
from collections import defaultdict
from datetime import timedelta

from django.conf import settings
from django.db.models import Count, Max, Q
from django.db.models.functions import TruncHour
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from skyspy.api.params import parse_int
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import CanUseLLM, FeatureBasedPermission
from skyspy.models import SafetyEvent
from skyspy.serializers.safety import (
    AircraftSafetyStatsSerializer,
    SafetyEventSerializer,
    SafetyStatsSerializer,
)

logger = logging.getLogger(__name__)


class SafetyEventViewSet(viewsets.ModelViewSet):
    """ViewSet for safety event monitoring."""

    queryset = SafetyEvent.objects.all()
    serializer_class = SafetyEventSerializer
    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["event_type", "severity", "icao_hex", "acknowledged"]
    http_method_names = ["get", "post", "delete"]

    def get_permissions(self):
        """Creating or deleting safety events always requires authentication.

        Safety events are system-generated emergency records; anonymous
        clients must not be able to fabricate or remove them, even when
        AUTH_MODE is 'public'. Reads (and acknowledge/unacknowledge) keep
        the existing AUTH_MODE-based behavior.
        """
        if self.action in ("create", "destroy", "generate_test"):
            return [IsAuthenticated()]
        # The AI event explainer is an LLM call (cost/abuse) — gate it like the
        # rest of the AI features so anonymous users can't spend tokens.
        if self.action == "ai_summary":
            return [CanUseLLM()]
        return super().get_permissions()

    def get_queryset(self):
        """Apply query filters."""
        queryset = super().get_queryset()

        # Time range filter — list only. Detail actions (retrieve, acknowledge,
        # unacknowledge, destroy) resolve get_object() through this queryset,
        # and a default 24h cutoff would 404 any older event.
        if self.action == "list":
            hours = parse_int(self.request.query_params, "hours", 24, min_value=1, max_value=24 * 365)
            cutoff = timezone.now() - timedelta(hours=hours)
            queryset = queryset.filter(timestamp__gte=cutoff)

        return queryset.order_by("-timestamp")

    @extend_schema(
        summary="List safety events",
        parameters=[
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
            OpenApiParameter(name="event_type", type=str, description="Filter by event type"),
            OpenApiParameter(name="severity", type=str, description="Filter by severity"),
            OpenApiParameter(name="limit", type=int, description="Max events to return (default 1000, max 10000)"),
            OpenApiParameter(name="offset", type=int, description="Number of events to skip (for paging)"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List safety events."""
        queryset = self.filter_queryset(self.get_queryset())
        total_count = queryset.count()
        limit = parse_int(request.query_params, "limit", 1000, min_value=1, max_value=10000)
        offset = parse_int(request.query_params, "offset", 0, min_value=0)
        serializer = self.get_serializer(queryset[offset : offset + limit], many=True)
        return Response({"events": serializer.data, "count": total_count, "limit": limit, "offset": offset})

    @extend_schema(
        summary="Get safety monitor status", description="Get the current status of the safety monitoring system"
    )
    @action(detail=False, methods=["get"], url_path="monitor/status")
    def monitor_status(self, request):
        """Get safety monitor status."""
        enabled = settings.SAFETY_MONITORING_ENABLED
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

        return Response(
            {"enabled": enabled, "tracked_aircraft": tracked_aircraft, "timestamp": timezone.now().isoformat()}
        )

    @extend_schema(
        summary="Get safety statistics",
        parameters=[
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
        ],
        responses={200: SafetyStatsSerializer},
    )
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get safety monitoring statistics."""
        hours = parse_int(request.query_params, "hours", 24, min_value=1, max_value=720)  # Cap at 30 days
        cutoff = timezone.now() - timedelta(hours=hours)

        events = SafetyEvent.objects.filter(timestamp__gte=cutoff)

        # Count by type
        by_type = dict(events.values_list("event_type").annotate(count=Count("id")))

        # Count by severity
        by_severity = dict(events.values_list("severity").annotate(count=Count("id")))

        # Per-type severity breakdown
        by_type_severity = defaultdict(dict)
        for event in events.values("event_type", "severity").annotate(count=Count("id")):
            by_type_severity[event["event_type"]][event["severity"]] = event["count"]

        # Unique aircraft
        unique_aircraft = events.values("icao_hex").distinct().count()

        # Events per hour
        total_events = events.count()
        event_rate = total_events / max(hours, 1)

        # Hourly breakdown
        events_by_hour = list(
            events.annotate(hour=TruncHour("timestamp")).values("hour").annotate(count=Count("id")).order_by("hour")
        )
        # Format for response
        events_by_hour_formatted = [
            {"hour": item["hour"].isoformat() if item["hour"] else None, "count": item["count"]}
            for item in events_by_hour
        ]

        # Top aircraft
        top_aircraft = list(events.values("icao_hex", "callsign").annotate(count=Count("id")).order_by("-count")[:10])

        # Recent events
        recent = SafetyEventSerializer(events[:5], many=True).data

        return Response(
            {
                "monitoring_enabled": settings.SAFETY_MONITORING_ENABLED,
                "thresholds": {
                    "vs_change_threshold": settings.SAFETY_VS_CHANGE_THRESHOLD,
                    "vs_extreme_threshold": settings.SAFETY_VS_EXTREME_THRESHOLD,
                    "proximity_nm": settings.SAFETY_PROXIMITY_NM,
                    "altitude_diff_ft": settings.SAFETY_ALTITUDE_DIFF_FT,
                    "closure_rate_kt": settings.SAFETY_CLOSURE_RATE_KT,
                    "tcas_vs_threshold": settings.SAFETY_TCAS_VS_THRESHOLD,
                },
                "time_range_hours": hours,
                "events_by_type": by_type,
                "events_by_severity": by_severity,
                "events_by_type_severity": dict(by_type_severity),
                "total_events": total_events,
                "unique_aircraft": unique_aircraft,
                "event_rate_per_hour": round(event_rate, 2),
                "events_by_hour": events_by_hour_formatted,
                "top_aircraft": top_aircraft,
                "recent_events": recent,
                "monitor_state": {},
                "timestamp": timezone.now().isoformat(),
            }
        )

    @extend_schema(
        summary="Get aircraft safety stats",
        description="Get safety statistics per aircraft",
        responses={200: AircraftSafetyStatsSerializer},
    )
    @action(detail=False, methods=["get"])
    def aircraft(self, request):
        """Get per-aircraft safety statistics."""
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        cutoff = timezone.now() - timedelta(hours=hours)

        # Get aircraft with events
        aircraft_stats = (
            SafetyEvent.objects.filter(timestamp__gte=cutoff)
            .values("icao_hex")
            .annotate(total_events=Count("id"))
            .order_by("-total_events")[:50]
        )

        # Get all ICAOs from aircraft_stats
        icao_list = [ac["icao_hex"] for ac in aircraft_stats]

        # Batch query: get event type counts per aircraft
        type_counts = (
            SafetyEvent.objects.filter(timestamp__gte=cutoff, icao_hex__in=icao_list)
            .values("icao_hex", "event_type")
            .annotate(count=Count("id"))
        )

        # Batch query: get severity counts per aircraft
        severity_counts = (
            SafetyEvent.objects.filter(timestamp__gte=cutoff, icao_hex__in=icao_list)
            .values("icao_hex", "severity")
            .annotate(count=Count("id"))
        )

        # Batch query: get last event info per aircraft
        last_events = (
            SafetyEvent.objects.filter(timestamp__gte=cutoff, icao_hex__in=icao_list)
            .values("icao_hex")
            .annotate(last_timestamp=Max("timestamp"))
        )

        # Build lookup dicts
        type_by_icao = {}
        for row in type_counts:
            icao = row["icao_hex"]
            if icao not in type_by_icao:
                type_by_icao[icao] = {}
            type_by_icao[icao][row["event_type"]] = row["count"]

        severity_by_icao = {}
        for row in severity_counts:
            icao = row["icao_hex"]
            if icao not in severity_by_icao:
                severity_by_icao[icao] = {}
            severity_by_icao[icao][row["severity"]] = row["count"]

        last_event_times = {row["icao_hex"]: row["last_timestamp"] for row in last_events}

        # Batch fetch last event details (callsign, event_type) for each aircraft
        last_event_details = {}
        if last_event_times:
            # Build Q objects to fetch specific events
            q_objects = Q()
            for icao, ts in last_event_times.items():
                q_objects |= Q(icao_hex=icao, timestamp=ts)
            last_events_qs = SafetyEvent.objects.filter(q_objects)
            for event in last_events_qs:
                last_event_details[event.icao_hex] = {
                    "callsign": event.callsign,
                    "event_type": event.event_type,
                    "timestamp": event.timestamp,
                }

        result = []
        for ac in aircraft_stats:
            icao = ac["icao_hex"]
            by_type = type_by_icao.get(icao, {})
            by_severity = severity_by_icao.get(icao, {})
            last_event = last_event_details.get(icao)

            result.append(
                {
                    "icao_hex": icao,
                    "callsign": last_event["callsign"] if last_event else None,
                    "total_events": ac["total_events"],
                    "events_by_type": by_type,
                    "events_by_severity": by_severity,
                    "worst_severity": "critical"
                    if "critical" in by_severity
                    else ("warning" if "warning" in by_severity else ("low" if "low" in by_severity else "info")),
                    "last_event_time": last_event["timestamp"].isoformat() if last_event else None,
                    "last_event_type": last_event["event_type"] if last_event else None,
                }
            )

        return Response(
            {
                "aircraft": result,
                "total_aircraft": len(result),
                "time_range_hours": hours,
                "timestamp": timezone.now().isoformat(),
            }
        )

    @extend_schema(
        summary="Generate test safety events",
        description=(
            "Generate one synthetic safety event of each type (emergency squawk, "
            "TCAS, extreme VS, proximity) in the safety monitor's active-event "
            "set, for exercising dashboards and alarms. Events are flagged "
            "is_test and expire like real active events. Requires authentication."
        ),
    )
    @action(detail=False, methods=["post"], url_path="test")
    def generate_test(self, request):
        """Generate synthetic safety events for testing."""
        from skyspy.services.safety import safety_monitor

        events = safety_monitor.generate_test_events()
        return Response({"generated": len(events), "events": events}, status=status.HTTP_201_CREATED)

    @extend_schema(summary="Acknowledge safety event", description="Mark a safety event as acknowledged")
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        """Acknowledge a safety event."""
        event = self.get_object()
        event.acknowledged = True
        event.acknowledged_at = timezone.now()
        event.save()
        _broadcast_ack_update(event.id, acknowledged=True)
        return Response(SafetyEventSerializer(event).data)

    @extend_schema(
        summary="Get plain-English AI summary of a safety event",
        description=(
            "Uses the configured LLM to explain one safety event (proximity conflict, "
            "TCAS RA, emergency squawk, extreme vertical rate, …) in plain English, "
            "grounded in the event's separation / CPA data. Opt-in (one cached LLM "
            "call). Returns available=false when the LLM is disabled/unconfigured — "
            "the client falls back to the event's own message."
        ),
    )
    @action(detail=True, methods=["get"], url_path="ai-summary")
    def ai_summary(self, request, pk=None):
        """Plain-English LLM explanation of one safety event."""
        from skyspy.services import aviation_llm

        event = self.get_object()

        if not aviation_llm.available():
            return Response({"available": False, "summary": None})

        def _ac(snapshot, hexid, callsign):
            if not snapshot and not hexid:
                return None
            snap = snapshot or {}
            return {
                "icao_hex": hexid,
                "callsign": (callsign or snap.get("callsign") or "").strip() or None,
                "altitude_ft": snap.get("alt") or snap.get("altitude"),
                "ground_speed_kt": snap.get("gs"),
                "vertical_rate_fpm": snap.get("vr") or snap.get("vs"),
                "heading": snap.get("heading") or snap.get("track"),
            }

        context = {
            "event_type": event.event_type,
            "severity": event.severity,
            "message": event.message,
            "aircraft": [
                a
                for a in (
                    _ac(event.aircraft_snapshot, event.icao_hex, event.callsign),
                    _ac(event.aircraft_snapshot_2, event.icao_hex_2, event.callsign_2),
                )
                if a
            ],
            "closest_point_of_approach": {
                "horizontal_separation_nm": (event.details or {}).get("horizontal_sep_nm") or event.cpa_distance_nm,
                "vertical_separation_ft": (event.details or {}).get("vertical_sep_ft"),
                "closure_rate_kt": (event.details or {}).get("closure_rate_kt"),
                "time_to_cpa_seconds": (event.details or {}).get("time_to_cpa_seconds") or event.cpa_time_seconds,
            },
        }

        summary = aviation_llm.summarize_safety_event(context)
        return Response({"available": True, "summary": summary, "id": event.id})

    @extend_schema(summary="Unacknowledge safety event", description="Remove acknowledgement from a safety event")
    @action(detail=True, methods=["delete"])
    def unacknowledge(self, request, pk=None):
        """Remove acknowledgement from a safety event."""
        event = self.get_object()
        event.acknowledged = False
        event.acknowledged_at = None
        event.save()
        _broadcast_ack_update(event.id, acknowledged=False)
        return Response(SafetyEventSerializer(event).data)


def _broadcast_ack_update(db_id: int, acknowledged: bool):
    """Emit safety:event_updated so all connected clients see an ack change.

    Detection (and the authoritative in-memory event) lives in the celery
    worker; it picks the DB flag up via its periodic ack sync. The broadcast
    here gives every other dashboard the update immediately.
    """
    from skyspy.services.safety import safety_monitor

    safety_monitor.broadcast_event_updated({"id": str(db_id), "db_id": db_id, "acknowledged": acknowledged})


class ActiveSafetyEventAcknowledgeView(APIView):
    """Acknowledge an active safety event by monitor key or DB id.

    The map alarm UI posts here (with the shared/DB id) to silence an active
    event. Detection runs in the celery worker, so this process's in-memory
    monitor usually doesn't hold the event: the DB row is the shared channel —
    the worker's periodic ack sync applies it to its in-memory event.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Acknowledge active safety event",
        description="Acknowledge an active safety event by its monitor event key or database id",
    )
    def post(self, request, event_id: str):
        from skyspy.services.safety import safety_monitor

        # In-memory ack (works when detection runs in this process, e.g. dev
        # single-process mode); broadcasts event_updated itself on success.
        memory_ok = safety_monitor.acknowledge_event(event_id)

        # Persist by DB id — the cross-process path.
        db_ok = False
        try:
            db_id = int(event_id)
        except (TypeError, ValueError):
            db_id = None
        if db_id is not None:
            db_ok = SafetyEvent.objects.filter(id=db_id).update(acknowledged=True, acknowledged_at=timezone.now()) > 0
            if db_ok and not memory_ok:
                _broadcast_ack_update(db_id, acknowledged=True)

        if memory_ok or db_ok:
            return Response({"success": True, "id": event_id, "acknowledged": True})
        return Response({"error": "not_found", "id": event_id}, status=404)
