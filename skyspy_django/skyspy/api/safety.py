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

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
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
        return super().get_permissions()

    def get_queryset(self):
        """Apply query filters."""
        queryset = super().get_queryset()

        # Time range filter
        hours = self.request.query_params.get("hours", 24)
        try:
            hours = int(hours)
        except ValueError:
            hours = 24

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = queryset.filter(timestamp__gte=cutoff)

        return queryset.order_by("-timestamp")

    @extend_schema(
        summary="List safety events",
        parameters=[
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
            OpenApiParameter(name="event_type", type=str, description="Filter by event type"),
            OpenApiParameter(name="severity", type=str, description="Filter by severity"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List safety events."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({"events": serializer.data, "count": queryset.count()})

    @extend_schema(
        summary="Get safety monitor status", description="Get the current status of the safety monitoring system"
    )
    @action(detail=False, methods=["get"], url_path="monitor/status")
    def monitor_status(self, request):
        """Get safety monitor status."""
        enabled = settings.SAFETY_MONITORING_ENABLED
        tracked_aircraft = 0

        try:
            from skyspy.services.safety import safety_monitor

            stats = safety_monitor.get_stats()
            tracked_aircraft = stats.get("tracked_aircraft", 0)
        except Exception:
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
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
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
                    else ("warning" if "warning" in by_severity else "info"),
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
        return Response(SafetyEventSerializer(event).data)

    @extend_schema(summary="Unacknowledge safety event", description="Remove acknowledgement from a safety event")
    @action(detail=True, methods=["delete"])
    def unacknowledge(self, request, pk=None):
        """Remove acknowledgement from a safety event."""
        event = self.get_object()
        event.acknowledged = False
        event.acknowledged_at = None
        event.save()
        return Response(SafetyEventSerializer(event).data)


class ActiveSafetyEventAcknowledgeView(APIView):
    """Acknowledge an in-memory active safety event by its monitor key.

    Active events live in the SafetyMonitor singleton under composite string
    keys (e.g. "vs_reversal:A3F7F6") until they resolve; they are not
    addressable through the SafetyEvent DB viewset. The map alarm UI posts
    here to silence an active event.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]

    @extend_schema(
        summary="Acknowledge active safety event",
        description="Acknowledge an active (in-memory) safety event by its monitor event key",
    )
    def post(self, request, event_id: str):
        from skyspy.services.safety import safety_monitor

        if safety_monitor.acknowledge_event(event_id):
            return Response({"success": True, "id": event_id, "acknowledged": True})
        return Response({"error": "not_found", "id": event_id}, status=404)
