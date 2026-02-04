"""
Cannonball Mode API views for law enforcement aircraft detection.

Provides endpoints for:
- Real-time threat data
- Session management
- Alert history
- Known aircraft database
- Statistics
- External data sources (Phase 1)
- Pattern analytics (Phase 2)
- Registration analysis (Phase 3)
- Community submissions (Phase 4)
"""

import contextlib
import logging
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from skyspy.api.throttles import AuthRateThrottle
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.models import (
    CannonballAlert,
    CannonballKnownAircraft,
    CannonballPattern,
    CannonballSession,
    CannonballStats,
    CommunitySubmission,
    LEDataSource,
    PatternAnalytics,
    RegistrationAnalysis,
    SubmitterReputation,
)
from skyspy.serializers.cannonball import (
    CannonballAlertListSerializer,
    CannonballAlertSerializer,
    CannonballKnownAircraftCreateSerializer,
    CannonballKnownAircraftSerializer,
    CannonballLocationUpdateSerializer,
    CannonballPatternSerializer,
    CannonballSessionListSerializer,
    CannonballSessionSerializer,
    CannonballStatsSerializer,
    CannonballThreatSerializer,
    CommunitySubmissionCreateSerializer,
    CommunitySubmissionListSerializer,
    CommunitySubmissionSerializer,
    LEDataSourceListSerializer,
    LEDataSourceSerializer,
    PatternAnalyticsSerializer,
    PatternFeedbackSerializer,
    RegistrationAnalysisListSerializer,
    RegistrationAnalysisSerializer,
    RegistrationReviewSerializer,
    SubmissionRejectSerializer,
    SubmissionReviewSerializer,
    SubmitterReputationSerializer,
)
from skyspy.tasks.cannonball import (
    clear_active_cannonball_user,
    set_active_cannonball_user,
    update_user_location,
)

logger = logging.getLogger(__name__)


class CannonballThreatsView(APIView):
    """
    Real-time threat data from Cannonball analysis.

    Returns current threats detected by the pattern analysis tasks.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Get current Cannonball threats",
        description="Returns real-time threat data from pattern analysis",
        responses={200: CannonballThreatSerializer(many=True)},
    )
    def get(self, request):
        """Get current threats from cache."""
        threats = cache.get("cannonball_threats", [])
        threat_count = cache.get("cannonball_threat_count", 0)

        # Filter by max range if specified
        max_range = request.query_params.get("max_range")
        if max_range:
            try:
                max_range = float(max_range)
                threats = [t for t in threats if t.get("distance_nm", 999) <= max_range]
            except ValueError:
                pass

        # Filter by threat level if specified
        threat_level = request.query_params.get("threat_level")
        if threat_level:
            threats = [t for t in threats if t.get("threat_level") == threat_level]

        return Response(
            {
                "threats": threats,
                "count": len(threats),
                "total_detected": threat_count,
                "timestamp": timezone.now().isoformat(),
            }
        )


class CannonballLocationView(APIView):
    """
    User location updates for Cannonball mode.

    Allows clients to send their GPS location for threat distance calculations.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Update user location",
        description="Send GPS location for threat distance calculations",
        request=CannonballLocationUpdateSerializer,
        responses={200: dict},
    )
    def post(self, request):
        """Update user location."""
        serializer = CannonballLocationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        lat = serializer.validated_data["lat"]
        lon = serializer.validated_data["lon"]

        if request.user.is_authenticated:
            # Store location for authenticated user
            update_user_location.delay(request.user.id, lat, lon)
        else:
            # Store in cache with session key
            session_key = request.session.session_key or "anonymous"
            cache.set(
                f"cannonball_location_{session_key}",
                {
                    "lat": lat,
                    "lon": lon,
                    "timestamp": timezone.now().isoformat(),
                },
                timeout=300,
            )

        return Response(
            {
                "status": "ok",
                "location": {"lat": lat, "lon": lon},
            }
        )


class CannonballActivateView(APIView):
    """
    Activate/deactivate Cannonball mode for a user.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(summary="Activate Cannonball mode", responses={200: dict})
    def post(self, request):
        """Activate Cannonball mode."""
        if request.user.is_authenticated:
            set_active_cannonball_user.delay(request.user.id)
            return Response(
                {
                    "status": "activated",
                    "user_id": request.user.id,
                }
            )
        return Response(
            {
                "status": "activated",
                "message": "Anonymous mode - location tracking limited",
            }
        )

    @extend_schema(summary="Deactivate Cannonball mode", responses={200: dict})
    def delete(self, request):
        """Deactivate Cannonball mode."""
        if request.user.is_authenticated:
            clear_active_cannonball_user.delay(request.user.id)
        return Response({"status": "deactivated"})


class CannonballSessionViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Cannonball tracking sessions."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = CannonballSession.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["is_active", "threat_level", "identification_method"]

    def get_serializer_class(self):
        if self.action == "list":
            return CannonballSessionListSerializer
        return CannonballSessionSerializer

    def get_queryset(self):
        """Filter sessions with optional parameters."""
        queryset = super().get_queryset()

        # Active only filter
        active_only = self.request.query_params.get("active_only", "false")
        if active_only.lower() == "true":
            queryset = queryset.filter(is_active=True)

        # Time range filter
        hours = self.request.query_params.get("hours")
        if hours:
            try:
                hours = int(hours)
                cutoff = timezone.now() - timedelta(hours=hours)
                queryset = queryset.filter(last_seen__gte=cutoff)
            except ValueError:
                pass

        return queryset.order_by("-last_seen")

    @extend_schema(
        summary="List Cannonball sessions",
        parameters=[
            OpenApiParameter(name="active_only", type=bool, description="Only show active sessions"),
            OpenApiParameter(name="hours", type=int, description="Filter by hours since last seen"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List sessions with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response(
            {
                "sessions": serializer.data,
                "count": queryset.count(),
                "active_count": queryset.filter(is_active=True).count(),
            }
        )

    @extend_schema(summary="Get active sessions summary", responses={200: CannonballSessionListSerializer(many=True)})
    @action(detail=False, methods=["get"])
    def active(self, request):
        """Get currently active sessions."""
        queryset = self.get_queryset().filter(is_active=True)
        serializer = CannonballSessionListSerializer(queryset, many=True)
        return Response(
            {
                "sessions": serializer.data,
                "count": queryset.count(),
            }
        )

    @extend_schema(summary="End a session manually", responses={200: CannonballSessionSerializer})
    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        """End a tracking session."""
        session = self.get_object()
        session.end_session()
        return Response(CannonballSessionSerializer(session).data)


class CannonballPatternViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for detected flight patterns."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = CannonballPattern.objects.all()
    serializer_class = CannonballPatternSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["pattern_type", "confidence", "icao_hex"]

    def get_queryset(self):
        """Filter patterns with optional parameters."""
        queryset = super().get_queryset()

        # Active only filter
        active_only = self.request.query_params.get("active_only", "false")
        if active_only.lower() == "true":
            queryset = queryset.filter(ended_at__isnull=True)

        # Time range filter
        hours = self.request.query_params.get("hours", 24)
        try:
            hours = int(hours)
            cutoff = timezone.now() - timedelta(hours=hours)
            queryset = queryset.filter(detected_at__gte=cutoff)
        except ValueError:
            pass

        return queryset.order_by("-detected_at")

    @extend_schema(
        summary="List detected patterns",
        parameters=[
            OpenApiParameter(name="active_only", type=bool, description="Only show active patterns"),
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List patterns with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        # Pattern type breakdown - use single aggregated query
        from django.db.models import Count

        pattern_counts = dict(
            queryset.values("pattern_type").annotate(count=Count("id")).values_list("pattern_type", "count")
        )

        return Response(
            {
                "patterns": serializer.data,
                "count": queryset.count(),
                "by_type": pattern_counts,
            }
        )

    @extend_schema(summary="Get pattern statistics", responses={200: dict})
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get pattern detection statistics."""
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = self.get_queryset().filter(detected_at__gte=cutoff)

        return Response(
            {
                "total": queryset.count(),
                "by_type": {
                    "circling": queryset.filter(pattern_type="circling").count(),
                    "loitering": queryset.filter(pattern_type="loitering").count(),
                    "grid_search": queryset.filter(pattern_type="grid_search").count(),
                    "speed_trap": queryset.filter(pattern_type="speed_trap").count(),
                },
                "by_confidence": {
                    "high": queryset.filter(confidence="high").count(),
                    "medium": queryset.filter(confidence="medium").count(),
                    "low": queryset.filter(confidence="low").count(),
                },
                "hours": hours,
            }
        )


class CannonballAlertViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Cannonball alerts."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = CannonballAlert.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["alert_type", "priority", "acknowledged"]

    def get_serializer_class(self):
        if self.action == "list":
            return CannonballAlertListSerializer
        return CannonballAlertSerializer

    def get_queryset(self):
        """Filter alerts with optional parameters."""
        queryset = super().get_queryset()

        # User filtering
        if self.request.user.is_authenticated:
            queryset = queryset.filter(Q(user=self.request.user) | Q(user__isnull=True))

        # Time range filter
        hours = self.request.query_params.get("hours", 24)
        try:
            hours = int(hours)
            cutoff = timezone.now() - timedelta(hours=hours)
            queryset = queryset.filter(created_at__gte=cutoff)
        except ValueError:
            pass

        # Unacknowledged only
        unack_only = self.request.query_params.get("unacknowledged", "false")
        if unack_only.lower() == "true":
            queryset = queryset.filter(acknowledged=False)

        return queryset.select_related("session").order_by("-created_at")

    @extend_schema(
        summary="List Cannonball alerts",
        parameters=[
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
            OpenApiParameter(name="unacknowledged", type=bool, description="Only unacknowledged alerts"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List alerts with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        return Response(
            {
                "alerts": serializer.data,
                "count": queryset.count(),
                "unacknowledged": queryset.filter(acknowledged=False).count(),
            }
        )

    @extend_schema(summary="Acknowledge an alert", responses={200: CannonballAlertSerializer})
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        """Acknowledge a single alert."""
        alert = self.get_object()
        alert.acknowledge(request.user if request.user.is_authenticated else None)
        return Response(CannonballAlertSerializer(alert).data)

    @extend_schema(summary="Acknowledge all alerts", responses={200: dict})
    @action(detail=False, methods=["post"], url_path="acknowledge-all")
    def acknowledge_all(self, request):
        """Acknowledge all unacknowledged alerts."""
        queryset = self.get_queryset().filter(acknowledged=False)
        updated = queryset.update(acknowledged=True, acknowledged_at=timezone.now())
        return Response(
            {
                "acknowledged": updated,
            }
        )


class CannonballKnownAircraftViewSet(viewsets.ModelViewSet):
    """ViewSet for known LE aircraft database."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    throttle_classes = [AuthRateThrottle]
    queryset = CannonballKnownAircraft.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["agency_type", "agency_state", "verified", "source"]

    def get_serializer_class(self):
        if self.action == "create":
            return CannonballKnownAircraftCreateSerializer
        return CannonballKnownAircraftSerializer

    def get_queryset(self):
        """Filter with optional search."""
        queryset = super().get_queryset()

        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(icao_hex__icontains=search) | Q(registration__icontains=search) | Q(agency_name__icontains=search)
            )

        return queryset.order_by("agency_name", "registration")

    @extend_schema(
        summary="List known LE aircraft",
        parameters=[
            OpenApiParameter(name="search", type=str, description="Search by ICAO, registration, or agency"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List known aircraft with search."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)

        return Response(
            {
                "aircraft": serializer.data,
                "count": queryset.count(),
                "verified_count": queryset.filter(verified=True).count(),
            }
        )

    @extend_schema(summary="Check if ICAO is known LE", responses={200: CannonballKnownAircraftSerializer})
    @action(detail=False, methods=["get"], url_path="check/(?P<icao_hex>[A-Fa-f0-9]+)")
    def check(self, request, icao_hex=None):
        """Check if an ICAO hex is in the known LE database."""
        if not icao_hex:
            return Response({"error": "icao_hex required"}, status=status.HTTP_400_BAD_REQUEST)

        icao_hex = icao_hex.upper()
        try:
            aircraft = CannonballKnownAircraft.objects.get(icao_hex=icao_hex)
            return Response(
                {
                    "found": True,
                    "aircraft": CannonballKnownAircraftSerializer(aircraft).data,
                }
            )
        except CannonballKnownAircraft.DoesNotExist:
            return Response(
                {
                    "found": False,
                    "icao_hex": icao_hex,
                }
            )

    @extend_schema(summary="Verify a known aircraft entry", responses={200: CannonballKnownAircraftSerializer})
    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Mark an aircraft entry as verified."""
        aircraft = self.get_object()
        aircraft.verified = True
        aircraft.verified_at = timezone.now()
        if request.user.is_authenticated:
            aircraft.verified_by = request.user
        aircraft.save()
        return Response(CannonballKnownAircraftSerializer(aircraft).data)

    @extend_schema(summary="Get statistics by agency type", responses={200: dict})
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get database statistics."""
        queryset = self.get_queryset()

        # Use single aggregated query for agency type counts
        from django.db.models import Count

        by_type_qs = queryset.values("agency_type").annotate(count=Count("id"))
        by_type = {row["agency_type"]: row["count"] for row in by_type_qs if row["agency_type"]}
        # Ensure all agency types are in the dict (even if 0)
        for at in CannonballKnownAircraft.AGENCY_TYPES:
            if at[0] not in by_type:
                by_type[at[0]] = 0

        # Use single aggregated query for state counts
        by_state_qs = (
            queryset.exclude(agency_state__isnull=True)
            .exclude(agency_state="")
            .values("agency_state")
            .annotate(count=Count("id"))
        )
        by_state = {row["agency_state"]: row["count"] for row in by_state_qs}

        return Response(
            {
                "total": queryset.count(),
                "verified": queryset.filter(verified=True).count(),
                "by_agency_type": by_type,
                "by_state": dict(sorted(by_state.items(), key=lambda x: -x[1])[:10]),
            }
        )


class CannonballStatsViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for Cannonball statistics."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = CannonballStats.objects.all()
    serializer_class = CannonballStatsSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["period_type"]

    def get_queryset(self):
        """Filter stats with optional parameters."""
        queryset = super().get_queryset()

        # Default to global stats (user=None)
        user_only = self.request.query_params.get("user_only", "false")
        if user_only.lower() == "true" and self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            queryset = queryset.filter(user__isnull=True)

        # Period type filter
        period = self.request.query_params.get("period", "hourly")
        queryset = queryset.filter(period_type=period)

        # Time range
        days = self.request.query_params.get("days", 7)
        try:
            days = int(days)
            cutoff = timezone.now() - timedelta(days=days)
            queryset = queryset.filter(period_start__gte=cutoff)
        except ValueError:
            pass

        return queryset.order_by("-period_start")

    @extend_schema(
        summary="List Cannonball statistics",
        parameters=[
            OpenApiParameter(name="period", type=str, description="Period type: hourly, daily, weekly, monthly"),
            OpenApiParameter(name="days", type=int, description="Number of days to include"),
            OpenApiParameter(name="user_only", type=bool, description="Only show user stats"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List stats with filtering."""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        # Calculate summary
        total_detections = sum(s.total_detections for s in queryset)
        total_alerts = sum(s.critical_alerts + s.warning_alerts + s.info_alerts for s in queryset)

        return Response(
            {
                "stats": serializer.data,
                "count": queryset.count(),
                "summary": {
                    "total_detections": total_detections,
                    "total_alerts": total_alerts,
                },
            }
        )

    @extend_schema(summary="Get current summary statistics", responses={200: dict})
    @action(detail=False, methods=["get"])
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
        current_threats = cache.get("cannonball_threat_count", 0)

        return Response(
            {
                "current": {
                    "active_sessions": active_sessions,
                    "threats": current_threats,
                },
                "today": {
                    "alerts": today_alerts,
                    "patterns": today_patterns,
                },
                "week": {
                    "sessions": week_sessions,
                    "alerts": week_alerts,
                },
                "timestamp": now.isoformat(),
            }
        )


# ========================================
# Phase 1: External Data Sources
# ========================================


class LEDataSourceViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for external LE data sources."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = LEDataSource.objects.all()

    def get_serializer_class(self):
        if self.action == "list":
            return LEDataSourceListSerializer
        return LEDataSourceSerializer

    @extend_schema(summary="List data sources", responses={200: LEDataSourceListSerializer(many=True)})
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response(
            {
                "sources": serializer.data,
                "count": queryset.count(),
                "total_records": sum(s.record_count for s in queryset),
            }
        )

    @extend_schema(summary="Trigger sync for a source", responses={200: dict})
    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def sync(self, request, pk=None):
        """Trigger sync for a specific data source."""
        source = self.get_object()

        from skyspy.tasks.le_data_sync import import_le_source

        task = import_le_source.delay(source.name, force=True)

        return Response(
            {
                "status": "sync_started",
                "source": source.name,
                "task_id": task.id,
            }
        )

    @extend_schema(summary="Toggle source enabled status", responses={200: LEDataSourceSerializer})
    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def toggle_enabled(self, request, pk=None):
        """Enable or disable a data source."""
        source = self.get_object()
        source.fetch_enabled = not source.fetch_enabled
        source.save(update_fields=["fetch_enabled"])
        return Response(LEDataSourceSerializer(source).data)


# ========================================
# Phase 2: Pattern Analytics
# ========================================


class PatternAnalyticsViewSet(viewsets.ModelViewSet):
    """ViewSet for pattern detection analytics and feedback."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = PatternAnalytics.objects.all()
    serializer_class = PatternAnalyticsSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["pattern_type", "was_confirmed_le", "false_positive_reported"]

    def get_queryset(self):
        queryset = super().get_queryset()

        # Time range filter
        hours = self.request.query_params.get("hours", 168)  # Default 7 days
        try:
            hours = int(hours)
            cutoff = timezone.now() - timedelta(hours=hours)
            queryset = queryset.filter(detected_at__gte=cutoff)
        except ValueError:
            pass

        return queryset.order_by("-detected_at")

    @extend_schema(summary="Submit feedback for a pattern", responses={200: PatternAnalyticsSerializer})
    @action(detail=True, methods=["post"])
    def feedback(self, request, pk=None):
        """Submit user feedback on a pattern detection."""
        pattern = self.get_object()
        serializer = PatternFeedbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user if request.user.is_authenticated else None
        pattern.record_feedback(
            user=user,
            is_confirmed_le=serializer.validated_data.get("was_confirmed_le"),
            is_false_positive=serializer.validated_data.get("is_false_positive", False),
        )

        return Response(PatternAnalyticsSerializer(pattern).data)

    @extend_schema(summary="Get pattern accuracy statistics", responses={200: dict})
    @action(detail=False, methods=["get"])
    def accuracy_stats(self, request):
        """Get pattern detection accuracy statistics."""
        from django.db.models import Avg, Count

        queryset = self.get_queryset().exclude(was_confirmed_le__isnull=True)

        by_type = (
            queryset.values("pattern_type")
            .annotate(
                total=Count("id"),
                confirmed=Count("id", filter=Q(was_confirmed_le=True)),
                false_positives=Count("id", filter=Q(false_positive_reported=True)),
                avg_confidence=Avg("confidence_score"),
            )
            .order_by("pattern_type")
        )

        return Response(
            {
                "by_pattern_type": list(by_type),
                "total_with_feedback": queryset.count(),
                "total_confirmed": queryset.filter(was_confirmed_le=True).count(),
                "total_false_positives": queryset.filter(false_positive_reported=True).count(),
            }
        )


# ========================================
# Phase 3: Registration Analysis
# ========================================


class RegistrationAnalysisViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for registration analysis results."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    queryset = RegistrationAnalysis.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["risk_level", "manually_reviewed", "is_confirmed_le"]

    def get_serializer_class(self):
        if self.action == "list":
            return RegistrationAnalysisListSerializer
        return RegistrationAnalysisSerializer

    def get_queryset(self):
        queryset = super().get_queryset()

        # Search filter
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(icao_hex__icontains=search)
                | Q(registration__icontains=search)
                | Q(owner_name__icontains=search)
            )

        # Min score filter
        min_score = self.request.query_params.get("min_score")
        if min_score:
            with contextlib.suppress(ValueError):
                queryset = queryset.filter(shell_company_score__gte=float(min_score))

        return queryset.order_by("-shell_company_score")

    @extend_schema(
        summary="List registration analyses",
        parameters=[
            OpenApiParameter(name="search", type=str, description="Search by ICAO, registration, or owner"),
            OpenApiParameter(name="min_score", type=float, description="Minimum shell company score"),
        ],
    )
    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset[:100], many=True)

        return Response(
            {
                "analyses": serializer.data,
                "count": queryset.count(),
                "high_risk_count": queryset.filter(risk_level="high").count(),
            }
        )

    @extend_schema(summary="Get high-risk unreviewed registrations", responses={200: RegistrationAnalysisListSerializer(many=True)})
    @action(detail=False, methods=["get"])
    def high_risk(self, request):
        """Get high-risk registrations that need review."""
        queryset = self.get_queryset().filter(
            risk_level="high",
            manually_reviewed=False,
        )[:50]

        return Response(
            {
                "analyses": RegistrationAnalysisListSerializer(queryset, many=True).data,
                "count": queryset.count(),
            }
        )

    @extend_schema(summary="Submit review for a registration", responses={200: RegistrationAnalysisSerializer})
    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def review(self, request, pk=None):
        """Submit admin review for a registration analysis."""
        analysis = self.get_object()
        serializer = RegistrationReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        analysis.manually_reviewed = True
        analysis.is_confirmed_le = serializer.validated_data.get("is_confirmed_le")
        analysis.review_notes = serializer.validated_data.get("review_notes", "")
        analysis.reviewed_by = request.user
        analysis.reviewed_at = timezone.now()
        analysis.save()

        return Response(RegistrationAnalysisSerializer(analysis).data)

    @extend_schema(summary="Check ICAO for shell company indicators", responses={200: dict})
    @action(detail=False, methods=["get"], url_path="check/(?P<icao_hex>[A-Fa-f0-9]+)")
    def check(self, request, icao_hex=None):
        """Check if an ICAO hex has registration analysis."""
        if not icao_hex:
            return Response({"error": "icao_hex required"}, status=status.HTTP_400_BAD_REQUEST)

        icao_hex = icao_hex.upper()
        try:
            analysis = RegistrationAnalysis.objects.get(icao_hex=icao_hex)
            return Response(
                {
                    "found": True,
                    "analysis": RegistrationAnalysisSerializer(analysis).data,
                }
            )
        except RegistrationAnalysis.DoesNotExist:
            return Response(
                {
                    "found": False,
                    "icao_hex": icao_hex,
                }
            )


# ========================================
# Phase 4: Community Submissions
# ========================================


class CommunitySubmissionViewSet(viewsets.ModelViewSet):
    """ViewSet for community aircraft submissions."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    throttle_classes = [AuthRateThrottle]
    queryset = CommunitySubmission.objects.all()
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["status", "agency_type", "evidence_type"]

    def get_serializer_class(self):
        if self.action == "create":
            return CommunitySubmissionCreateSerializer
        if self.action == "list":
            return CommunitySubmissionListSerializer
        return CommunitySubmissionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()

        # Users see their own; admins see all
        if not self.request.user.is_staff:
            if self.request.user.is_authenticated:
                queryset = queryset.filter(submitted_by=self.request.user)
            else:
                queryset = queryset.none()

        return queryset.select_related("submitted_by", "reviewed_by").order_by("-submitted_at")

    @extend_schema(summary="Create a submission")
    def create(self, request, *args, **kwargs):
        """Create a new community submission."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from skyspy.services.community_submissions import ValidationError, get_submission_service

        service = get_submission_service()

        try:
            # Get client IP for abuse prevention
            x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
            ip_address = x_forwarded_for.split(",")[0] if x_forwarded_for else request.META.get("REMOTE_ADDR")

            submission = service.create_submission(
                user=request.user if request.user.is_authenticated else None,
                ip_address=ip_address,
                **serializer.validated_data,
            )

            return Response(
                CommunitySubmissionSerializer(submission).data,
                status=status.HTTP_201_CREATED,
            )

        except ValidationError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @extend_schema(summary="Get pending submissions (admin)", responses={200: CommunitySubmissionSerializer(many=True)})
    @action(detail=False, methods=["get"], permission_classes=[IsAdminUser])
    def pending(self, request):
        """Get all pending submissions for admin review."""
        queryset = CommunitySubmission.objects.filter(status="pending").select_related(
            "submitted_by"
        ).order_by("-submitted_at")

        return Response(
            {
                "submissions": CommunitySubmissionSerializer(queryset[:100], many=True).data,
                "count": queryset.count(),
            }
        )

    @extend_schema(summary="Approve a submission", responses={200: CommunitySubmissionSerializer})
    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def approve(self, request, pk=None):
        """Approve a submission and add to known aircraft database."""
        submission = self.get_object()
        serializer = SubmissionReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from skyspy.services.community_submissions import ValidationError, get_submission_service

        service = get_submission_service()

        try:
            service.approve_submission(
                submission=submission,
                reviewer=request.user,
                notes=serializer.validated_data.get("notes", ""),
            )
            return Response(CommunitySubmissionSerializer(submission).data)

        except ValidationError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @extend_schema(summary="Reject a submission", responses={200: CommunitySubmissionSerializer})
    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def reject(self, request, pk=None):
        """Reject a submission."""
        submission = self.get_object()
        serializer = SubmissionRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from skyspy.services.community_submissions import ValidationError, get_submission_service

        service = get_submission_service()

        try:
            service.reject_submission(
                submission=submission,
                reviewer=request.user,
                reason=serializer.validated_data["reason"],
            )
            return Response(CommunitySubmissionSerializer(submission).data)

        except ValidationError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @extend_schema(summary="Mark as duplicate", responses={200: CommunitySubmissionSerializer})
    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def mark_duplicate(self, request, pk=None):
        """Mark a submission as duplicate."""
        submission = self.get_object()

        from skyspy.services.community_submissions import get_submission_service

        service = get_submission_service()
        service.mark_duplicate(submission, request.user)

        return Response(CommunitySubmissionSerializer(submission).data)

    @extend_schema(summary="Get submission statistics", responses={200: dict})
    @action(detail=False, methods=["get"], permission_classes=[IsAdminUser])
    def stats(self, request):
        """Get submission statistics."""
        from skyspy.services.community_submissions import get_submission_service

        service = get_submission_service()
        return Response(service.get_submission_stats())


class SubmitterReputationViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for submitter reputation (admin only)."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [IsAdminUser]
    queryset = SubmitterReputation.objects.all()
    serializer_class = SubmitterReputationSerializer

    def get_queryset(self):
        return self.queryset.select_related("user").order_by("-reputation_score")

    @extend_schema(summary="Get trusted submitters", responses={200: SubmitterReputationSerializer(many=True)})
    @action(detail=False, methods=["get"])
    def trusted(self, request):
        """Get list of trusted submitters."""
        queryset = self.get_queryset().filter(is_trusted=True)
        return Response(
            {
                "submitters": self.get_serializer(queryset, many=True).data,
                "count": queryset.count(),
            }
        )

    @extend_schema(summary="Ban a user from submissions", responses={200: SubmitterReputationSerializer})
    @action(detail=True, methods=["post"])
    def ban(self, request, pk=None):
        """Ban a user from making submissions."""
        reputation = self.get_object()

        from skyspy.services.community_submissions import get_submission_service

        service = get_submission_service()

        reason = request.data.get("reason", "Banned by admin")
        duration_days = request.data.get("duration_days")

        service.ban_user(
            user=reputation.user,
            reason=reason,
            duration_days=int(duration_days) if duration_days else None,
        )

        return Response(self.get_serializer(reputation).data)

    @extend_schema(summary="Unban a user", responses={200: SubmitterReputationSerializer})
    @action(detail=True, methods=["post"])
    def unban(self, request, pk=None):
        """Unban a user."""
        reputation = self.get_object()

        from skyspy.services.community_submissions import get_submission_service

        service = get_submission_service()
        service.unban_user(reputation.user)

        return Response(self.get_serializer(reputation).data)
