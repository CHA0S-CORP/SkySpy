"""
Safety event monitoring API views.
"""
import logging
from datetime import timedelta
from collections import defaultdict

from django.conf import settings
from django.db.models import Count
from django.db.models.functions import TruncHour
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import SafetyEvent
from skyspy.serializers.safety import (
    SafetyEventSerializer,
    SafetyStatsSerializer,
    AircraftSafetyStatsSerializer,
)

logger = logging.getLogger(__name__)


class SafetyEventViewSet(viewsets.ModelViewSet):
    """ViewSet for safety event monitoring."""

    queryset = SafetyEvent.objects.all()
    serializer_class = SafetyEventSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['event_type', 'severity', 'icao_hex', 'acknowledged']
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        """Apply query filters."""
        queryset = super().get_queryset()

        # Time range filter
        hours = self.request.query_params.get('hours', 24)
        try:
            hours = int(hours)
        except ValueError:
            hours = 24

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = queryset.filter(timestamp__gte=cutoff)

        return queryset.order_by('-timestamp')

    @extend_schema(
        summary="List safety events",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='event_type', type=str, description='Filter by event type'),
            OpenApiParameter(name='severity', type=str, description='Filter by severity'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List safety events."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'events': serializer.data,
            'count': queryset.count()
        })

    @extend_schema(
        summary="Get safety statistics",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
        ],
        responses={200: SafetyStatsSerializer}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get safety monitoring statistics."""
        hours = int(request.query_params.get('hours', 24))
        cutoff = timezone.now() - timedelta(hours=hours)

        events = SafetyEvent.objects.filter(timestamp__gte=cutoff)

        # Count by type
        by_type = dict(events.values_list('event_type').annotate(count=Count('id')))

        # Count by severity
        by_severity = dict(events.values_list('severity').annotate(count=Count('id')))

        # Per-type severity breakdown
        by_type_severity = defaultdict(dict)
        for event in events.values('event_type', 'severity').annotate(count=Count('id')):
            by_type_severity[event['event_type']][event['severity']] = event['count']

        # Unique aircraft
        unique_aircraft = events.values('icao_hex').distinct().count()

        # Events per hour
        total_events = events.count()
        event_rate = total_events / max(hours, 1)

        # Hourly breakdown
        events_by_hour = list(
            events.annotate(hour=TruncHour('timestamp'))
            .values('hour')
            .annotate(count=Count('id'))
            .order_by('hour')
        )
        # Format for response
        events_by_hour_formatted = [
            {
                'hour': item['hour'].isoformat() if item['hour'] else None,
                'count': item['count']
            }
            for item in events_by_hour
        ]

        # Top aircraft
        top_aircraft = list(
            events.values('icao_hex', 'callsign')
            .annotate(count=Count('id'))
            .order_by('-count')[:10]
        )

        # Recent events
        recent = SafetyEventSerializer(events[:5], many=True).data

        return Response({
            'monitoring_enabled': settings.SAFETY_MONITORING_ENABLED,
            'thresholds': {
                'vs_change_threshold': settings.SAFETY_VS_CHANGE_THRESHOLD,
                'vs_extreme_threshold': settings.SAFETY_VS_EXTREME_THRESHOLD,
                'proximity_nm': settings.SAFETY_PROXIMITY_NM,
                'altitude_diff_ft': settings.SAFETY_ALTITUDE_DIFF_FT,
                'closure_rate_kt': settings.SAFETY_CLOSURE_RATE_KT,
                'tcas_vs_threshold': settings.SAFETY_TCAS_VS_THRESHOLD,
            },
            'time_range_hours': hours,
            'events_by_type': by_type,
            'events_by_severity': by_severity,
            'events_by_type_severity': dict(by_type_severity),
            'total_events': total_events,
            'unique_aircraft': unique_aircraft,
            'event_rate_per_hour': round(event_rate, 2),
            'events_by_hour': events_by_hour_formatted,
            'top_aircraft': top_aircraft,
            'recent_events': recent,
            'monitor_state': {},
            'timestamp': timezone.now().isoformat()
        })

    @extend_schema(
        summary="Get aircraft safety stats",
        description="Get safety statistics per aircraft",
        responses={200: AircraftSafetyStatsSerializer}
    )
    @action(detail=False, methods=['get'])
    def aircraft(self, request):
        """Get per-aircraft safety statistics."""
        hours = int(request.query_params.get('hours', 24))
        cutoff = timezone.now() - timedelta(hours=hours)

        # Get aircraft with events
        aircraft_stats = (
            SafetyEvent.objects.filter(timestamp__gte=cutoff)
            .values('icao_hex')
            .annotate(total_events=Count('id'))
            .order_by('-total_events')[:50]
        )

        result = []
        for ac in aircraft_stats:
            icao = ac['icao_hex']
            events = SafetyEvent.objects.filter(
                timestamp__gte=cutoff,
                icao_hex=icao
            )

            # Get event breakdown
            by_type = dict(events.values_list('event_type').annotate(count=Count('id')))
            by_severity = dict(events.values_list('severity').annotate(count=Count('id')))

            # Get last event
            last_event = events.order_by('-timestamp').first()

            result.append({
                'icao_hex': icao,
                'callsign': last_event.callsign if last_event else None,
                'total_events': ac['total_events'],
                'events_by_type': by_type,
                'events_by_severity': by_severity,
                'worst_severity': 'critical' if 'critical' in by_severity else (
                    'warning' if 'warning' in by_severity else 'info'
                ),
                'last_event_time': last_event.timestamp.isoformat() if last_event else None,
                'last_event_type': last_event.event_type if last_event else None,
            })

        return Response({
            'aircraft': result,
            'total_aircraft': len(result),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat()
        })

    @extend_schema(
        summary="Acknowledge safety event",
        description="Mark a safety event as acknowledged"
    )
    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        """Acknowledge a safety event."""
        event = self.get_object()
        event.acknowledged = True
        event.acknowledged_at = timezone.now()
        event.save()
        return Response(SafetyEventSerializer(event).data)

    @extend_schema(
        summary="Unacknowledge safety event",
        description="Remove acknowledgement from a safety event"
    )
    @action(detail=True, methods=['delete'])
    def unacknowledge(self, request, pk=None):
        """Remove acknowledgement from a safety event."""
        event = self.get_object()
        event.acknowledged = False
        event.acknowledged_at = None
        event.save()
        return Response(SafetyEventSerializer(event).data)
