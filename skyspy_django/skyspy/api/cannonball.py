"""
Cannonball Mode API views for law enforcement aircraft detection.

Provides endpoints for:
- Real-time threat data
- Session management
- Alert history
- Known aircraft database
- Statistics
"""
import logging
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import (
    CannonballPattern, CannonballSession, CannonballAlert,
    CannonballKnownAircraft, CannonballStats,
)
from skyspy.serializers.cannonball import (
    CannonballPatternSerializer, CannonballPatternSummarySerializer,
    CannonballSessionSerializer, CannonballSessionListSerializer,
    CannonballAlertSerializer, CannonballAlertListSerializer,
    CannonballKnownAircraftSerializer, CannonballKnownAircraftCreateSerializer,
    CannonballStatsSerializer, CannonballThreatSerializer,
    CannonballLocationUpdateSerializer, CannonballSettingsSerializer,
)
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.tasks.cannonball import (
    update_user_location, set_active_cannonball_user, clear_active_cannonball_user,
)

logger = logging.getLogger(__name__)


class CannonballThreatsView(APIView):
    """
    Real-time threat data from Cannonball analysis.

    Returns current threats detected by the pattern analysis tasks.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]

    @extend_schema(
        summary="Get current Cannonball threats",
        description="Returns real-time threat data from pattern analysis",
        responses={200: CannonballThreatSerializer(many=True)}
    )
    def get(self, request):
        """Get current threats from cache."""
        threats = cache.get('cannonball_threats', [])
        threat_count = cache.get('cannonball_threat_count', 0)

        # Filter by max range if specified
        max_range = request.query_params.get('max_range')
        if max_range:
            try:
                max_range = float(max_range)
                threats = [t for t in threats if t.get('distance_nm', 999) <= max_range]
            except ValueError:
                pass

        # Filter by threat level if specified
        threat_level = request.query_params.get('threat_level')
        if threat_level:
            threats = [t for t in threats if t.get('threat_level') == threat_level]

        return Response({
            'threats': threats,
            'count': len(threats),
            'total_detected': threat_count,
            'timestamp': timezone.now().isoformat(),
        })


class CannonballLocationView(APIView):
    """
    User location updates for Cannonball mode.

    Allows clients to send their GPS location for threat distance calculations.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]

    @extend_schema(
        summary="Update user location",
        description="Send GPS location for threat distance calculations",
        request=CannonballLocationUpdateSerializer,
        responses={200: dict}
    )
    def post(self, request):
        """Update user location."""
        serializer = CannonballLocationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        lat = serializer.validated_data['lat']
        lon = serializer.validated_data['lon']

        if request.user.is_authenticated:
            # Store location for authenticated user
            update_user_location.delay(request.user.id, lat, lon)
        else:
            # Store in cache with session key
            session_key = request.session.session_key or 'anonymous'
            cache.set(f'cannonball_location_{session_key}', {
                'lat': lat,
                'lon': lon,
                'timestamp': timezone.now().isoformat(),
            }, timeout=300)

        return Response({
            'status': 'ok',
            'location': {'lat': lat, 'lon': lon},
        })


class CannonballActivateView(APIView):
    """
    Activate/deactivate Cannonball mode for a user.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]

    @extend_schema(
        summary="Activate Cannonball mode",
        responses={200: dict}
    )
    def post(self, request):
        """Activate Cannonball mode."""
        if request.user.is_authenticated:
            set_active_cannonball_user.delay(request.user.id)
            return Response({
                'status': 'activated',
                'user_id': request.user.id,
            })
        return Response({
            'status': 'activated',
            'message': 'Anonymous mode - location tracking limited',
        })

    @extend_schema(
        summary="Deactivate Cannonball mode",
        responses={200: dict}
    )
    def delete(self, request):
        """Deactivate Cannonball mode."""
        if request.user.is_authenticated:
            clear_active_cannonball_user.delay(request.user.id)
        return Response({'status': 'deactivated'})


class CannonballSessionViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Cannonball tracking sessions."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    queryset = CannonballSession.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_active', 'threat_level', 'identification_method']

    def get_serializer_class(self):
        if self.action == 'list':
            return CannonballSessionListSerializer
        return CannonballSessionSerializer

    def get_queryset(self):
        """Filter sessions with optional parameters."""
        queryset = super().get_queryset()

        # Active only filter
        active_only = self.request.query_params.get('active_only', 'false')
        if active_only.lower() == 'true':
            queryset = queryset.filter(is_active=True)

        # Time range filter
        hours = self.request.query_params.get('hours')
        if hours:
            try:
                hours = int(hours)
                cutoff = timezone.now() - timedelta(hours=hours)
                queryset = queryset.filter(last_seen__gte=cutoff)
            except ValueError:
                pass

        return queryset.order_by('-last_seen')

    @extend_schema(
        summary="List Cannonball sessions",
        parameters=[
            OpenApiParameter(name='active_only', type=bool, description='Only show active sessions'),
            OpenApiParameter(name='hours', type=int, description='Filter by hours since last seen'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List sessions with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'sessions': serializer.data,
            'count': queryset.count(),
            'active_count': queryset.filter(is_active=True).count(),
        })

    @extend_schema(
        summary="Get active sessions summary",
        responses={200: CannonballSessionListSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def active(self, request):
        """Get currently active sessions."""
        queryset = self.get_queryset().filter(is_active=True)
        serializer = CannonballSessionListSerializer(queryset, many=True)
        return Response({
            'sessions': serializer.data,
            'count': queryset.count(),
        })

    @extend_schema(
        summary="End a session manually",
        responses={200: CannonballSessionSerializer}
    )
    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        """End a tracking session."""
        session = self.get_object()
        session.end_session()
        return Response(CannonballSessionSerializer(session).data)


class CannonballPatternViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for detected flight patterns."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    queryset = CannonballPattern.objects.all()
    serializer_class = CannonballPatternSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['pattern_type', 'confidence', 'icao_hex']

    def get_queryset(self):
        """Filter patterns with optional parameters."""
        queryset = super().get_queryset()

        # Active only filter
        active_only = self.request.query_params.get('active_only', 'false')
        if active_only.lower() == 'true':
            queryset = queryset.filter(ended_at__isnull=True)

        # Time range filter
        hours = self.request.query_params.get('hours', 24)
        try:
            hours = int(hours)
            cutoff = timezone.now() - timedelta(hours=hours)
            queryset = queryset.filter(detected_at__gte=cutoff)
        except ValueError:
            pass

        return queryset.order_by('-detected_at')

    @extend_schema(
        summary="List detected patterns",
        parameters=[
            OpenApiParameter(name='active_only', type=bool, description='Only show active patterns'),
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List patterns with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        # Pattern type breakdown
        pattern_counts = {}
        for p in queryset.values('pattern_type').distinct():
            ptype = p['pattern_type']
            pattern_counts[ptype] = queryset.filter(pattern_type=ptype).count()

        return Response({
            'patterns': serializer.data,
            'count': queryset.count(),
            'by_type': pattern_counts,
        })

    @extend_schema(
        summary="Get pattern statistics",
        responses={200: dict}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get pattern detection statistics."""
        hours = int(request.query_params.get('hours', 24))
        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = self.get_queryset().filter(detected_at__gte=cutoff)

        return Response({
            'total': queryset.count(),
            'by_type': {
                'circling': queryset.filter(pattern_type='circling').count(),
                'loitering': queryset.filter(pattern_type='loitering').count(),
                'grid_search': queryset.filter(pattern_type='grid_search').count(),
                'speed_trap': queryset.filter(pattern_type='speed_trap').count(),
            },
            'by_confidence': {
                'high': queryset.filter(confidence='high').count(),
                'medium': queryset.filter(confidence='medium').count(),
                'low': queryset.filter(confidence='low').count(),
            },
            'hours': hours,
        })


class CannonballAlertViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Cannonball alerts."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    queryset = CannonballAlert.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['alert_type', 'priority', 'acknowledged']

    def get_serializer_class(self):
        if self.action == 'list':
            return CannonballAlertListSerializer
        return CannonballAlertSerializer

    def get_queryset(self):
        """Filter alerts with optional parameters."""
        queryset = super().get_queryset()

        # User filtering
        if self.request.user.is_authenticated:
            queryset = queryset.filter(
                Q(user=self.request.user) | Q(user__isnull=True)
            )

        # Time range filter
        hours = self.request.query_params.get('hours', 24)
        try:
            hours = int(hours)
            cutoff = timezone.now() - timedelta(hours=hours)
            queryset = queryset.filter(created_at__gte=cutoff)
        except ValueError:
            pass

        # Unacknowledged only
        unack_only = self.request.query_params.get('unacknowledged', 'false')
        if unack_only.lower() == 'true':
            queryset = queryset.filter(acknowledged=False)

        return queryset.select_related('session').order_by('-created_at')

    @extend_schema(
        summary="List Cannonball alerts",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='unacknowledged', type=bool, description='Only unacknowledged alerts'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List alerts with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        return Response({
            'alerts': serializer.data,
            'count': queryset.count(),
            'unacknowledged': queryset.filter(acknowledged=False).count(),
        })

    @extend_schema(
        summary="Acknowledge an alert",
        responses={200: CannonballAlertSerializer}
    )
    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        """Acknowledge a single alert."""
        alert = self.get_object()
        alert.acknowledge(request.user if request.user.is_authenticated else None)
        return Response(CannonballAlertSerializer(alert).data)

    @extend_schema(
        summary="Acknowledge all alerts",
        responses={200: dict}
    )
    @action(detail=False, methods=['post'], url_path='acknowledge-all')
    def acknowledge_all(self, request):
        """Acknowledge all unacknowledged alerts."""
        queryset = self.get_queryset().filter(acknowledged=False)
        updated = queryset.update(
            acknowledged=True,
            acknowledged_at=timezone.now()
        )
        return Response({
            'acknowledged': updated,
        })


class CannonballKnownAircraftViewSet(viewsets.ModelViewSet):
    """ViewSet for known LE aircraft database."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    queryset = CannonballKnownAircraft.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['agency_type', 'agency_state', 'verified', 'source']

    def get_serializer_class(self):
        if self.action == 'create':
            return CannonballKnownAircraftCreateSerializer
        return CannonballKnownAircraftSerializer

    def get_queryset(self):
        """Filter with optional search."""
        queryset = super().get_queryset()

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(icao_hex__icontains=search) |
                Q(registration__icontains=search) |
                Q(agency_name__icontains=search)
            )

        return queryset.order_by('agency_name', 'registration')

    @extend_schema(
        summary="List known LE aircraft",
        parameters=[
            OpenApiParameter(name='search', type=str, description='Search by ICAO, registration, or agency'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List known aircraft with search."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)

        return Response({
            'aircraft': serializer.data,
            'count': queryset.count(),
            'verified_count': queryset.filter(verified=True).count(),
        })

    @extend_schema(
        summary="Check if ICAO is known LE",
        responses={200: CannonballKnownAircraftSerializer}
    )
    @action(detail=False, methods=['get'], url_path='check/(?P<icao_hex>[A-Fa-f0-9]+)')
    def check(self, request, icao_hex=None):
        """Check if an ICAO hex is in the known LE database."""
        if not icao_hex:
            return Response({'error': 'icao_hex required'}, status=status.HTTP_400_BAD_REQUEST)

        icao_hex = icao_hex.upper()
        try:
            aircraft = CannonballKnownAircraft.objects.get(icao_hex=icao_hex)
            return Response({
                'found': True,
                'aircraft': CannonballKnownAircraftSerializer(aircraft).data,
            })
        except CannonballKnownAircraft.DoesNotExist:
            return Response({
                'found': False,
                'icao_hex': icao_hex,
            })

    @extend_schema(
        summary="Verify a known aircraft entry",
        responses={200: CannonballKnownAircraftSerializer}
    )
    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        """Mark an aircraft entry as verified."""
        aircraft = self.get_object()
        aircraft.verified = True
        aircraft.verified_at = timezone.now()
        if request.user.is_authenticated:
            aircraft.verified_by = request.user
        aircraft.save()
        return Response(CannonballKnownAircraftSerializer(aircraft).data)

    @extend_schema(
        summary="Get statistics by agency type",
        responses={200: dict}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get database statistics."""
        queryset = self.get_queryset()

        by_type = {}
        for at in CannonballKnownAircraft.AGENCY_TYPES:
            by_type[at[0]] = queryset.filter(agency_type=at[0]).count()

        by_state = {}
        for state in queryset.values_list('agency_state', flat=True).distinct():
            if state:
                by_state[state] = queryset.filter(agency_state=state).count()

        return Response({
            'total': queryset.count(),
            'verified': queryset.filter(verified=True).count(),
            'by_agency_type': by_type,
            'by_state': dict(sorted(by_state.items(), key=lambda x: -x[1])[:10]),
        })


class CannonballStatsViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Cannonball statistics."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    queryset = CannonballStats.objects.all()
    serializer_class = CannonballStatsSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['period_type']

    def get_queryset(self):
        """Filter stats with optional parameters."""
        queryset = super().get_queryset()

        # Default to global stats (user=None)
        user_only = self.request.query_params.get('user_only', 'false')
        if user_only.lower() == 'true' and self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            queryset = queryset.filter(user__isnull=True)

        # Period type filter
        period = self.request.query_params.get('period', 'hourly')
        queryset = queryset.filter(period_type=period)

        # Time range
        days = self.request.query_params.get('days', 7)
        try:
            days = int(days)
            cutoff = timezone.now() - timedelta(days=days)
            queryset = queryset.filter(period_start__gte=cutoff)
        except ValueError:
            pass

        return queryset.order_by('-period_start')

    @extend_schema(
        summary="List Cannonball statistics",
        parameters=[
            OpenApiParameter(name='period', type=str, description='Period type: hourly, daily, weekly, monthly'),
            OpenApiParameter(name='days', type=int, description='Number of days to include'),
            OpenApiParameter(name='user_only', type=bool, description='Only show user stats'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List stats with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        # Calculate summary
        total_detections = sum(s.total_detections for s in queryset)
        total_alerts = sum(s.critical_alerts + s.warning_alerts + s.info_alerts for s in queryset)

        return Response({
            'stats': serializer.data,
            'count': queryset.count(),
            'summary': {
                'total_detections': total_detections,
                'total_alerts': total_alerts,
            },
        })

    @extend_schema(
        summary="Get current summary statistics",
        responses={200: dict}
    )
    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get current summary statistics."""
        now = timezone.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=7)

        # Active sessions
        active_sessions = CannonballSession.objects.filter(is_active=True).count()

        # Today's stats
        today_alerts = CannonballAlert.objects.filter(created_at__gte=today_start).count()
        today_patterns = CannonballPattern.objects.filter(detected_at__gte=today_start).count()

        # Week stats
        week_sessions = CannonballSession.objects.filter(first_seen__gte=week_start).count()
        week_alerts = CannonballAlert.objects.filter(created_at__gte=week_start).count()

        # Current threats
        current_threats = cache.get('cannonball_threat_count', 0)

        return Response({
            'current': {
                'active_sessions': active_sessions,
                'threats': current_threats,
            },
            'today': {
                'alerts': today_alerts,
                'patterns': today_patterns,
            },
            'week': {
                'sessions': week_sessions,
                'alerts': week_alerts,
            },
            'timestamp': now.isoformat(),
        })
