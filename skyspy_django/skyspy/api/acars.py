"""
ACARS/VDL2 message API views.
"""

import logging
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Count
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.api.throttles import ExternalLookupRateThrottle
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import CanUseLLM, FeatureBasedPermission
from skyspy.models import AcarsMessage
from skyspy.serializers.acars import (
    AcarsAirlineStatsSerializer,
    AcarsCategoryTrendsSerializer,
    AcarsFreeTextAnalysisSerializer,
    AcarsMessageSerializer,
    AcarsMessageStatsSerializer,
    AcarsStatsSerializer,
    AcarsStatusSerializer,
    AcarsSummaryStatsSerializer,
    AcarsTrendsSerializer,
)
from skyspy.services.acars_stats import (
    calculate_acars_airline_stats,
    calculate_acars_category_trends,
    calculate_acars_message_stats,
    calculate_acars_trends,
    calculate_free_text_analysis,
    get_acars_summary_stats,
    get_cached_acars_airlines,
    get_cached_acars_stats,
    get_cached_acars_trends,
)

logger = logging.getLogger(__name__)


def _cached_decode(msg):
    """Return the message's cached libacars decode from the DB.

    Decoding is done ONCE at ingest by the isolated Celery worker
    (``decode_acars_message``) and persisted to ``AcarsMessage.decoded`` — we
    never run libacars in the web process (it can segfault on malformed
    CPDLC/ARINC, which would take down the API worker). ``decoded is None``
    means "not decoded yet"; ``{}`` is the "undecodable" sentinel. When it is
    not yet decoded, queue the background task and answer from the raw text.
    """
    if msg.decoded is not None:
        return msg.decoded or None
    if msg.text and msg.label:
        try:
            from skyspy.tasks.acars import decode_acars_message

            decode_acars_message.delay(msg.id)
        except Exception as e:  # broad: enqueue must never break the response
            logger.debug("Failed to queue ACARS decode for %s: %s", msg.id, e)
    return None


class AcarsViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for ACARS/VDL2 messages."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    # LLM-backed ACARS explainers (cost money) — require AI access, not just the
    # acars feature, and rate-limit.
    _LLM_ACTIONS = {"ai_summary", "ai_analysis"}

    def get_permissions(self):
        if getattr(self, "action", None) in self._LLM_ACTIONS:
            return [CanUseLLM()]
        return super().get_permissions()

    def get_throttles(self):
        if getattr(self, "action", None) in self._LLM_ACTIONS:
            return [ExternalLookupRateThrottle()]
        return super().get_throttles()

    queryset = AcarsMessage.objects.all()
    serializer_class = AcarsMessageSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["source", "icao_hex", "callsign", "label"]

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
        summary="List ACARS messages",
        parameters=[
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
            OpenApiParameter(name="source", type=str, description="Filter by source"),
            OpenApiParameter(name="icao_hex", type=str, description="Filter by ICAO"),
            OpenApiParameter(name="callsign", type=str, description="Filter by callsign"),
            OpenApiParameter(name="label", type=str, description="Filter by label"),
            OpenApiParameter(name="limit", type=int, description="Max results"),
        ],
    )
    def list(self, request, *args, **kwargs):
        """List ACARS messages."""
        queryset = self.filter_queryset(self.get_queryset())

        filters = {
            k: v for k, v in request.query_params.items() if k in ["source", "icao_hex", "callsign", "label", "hours"]
        }

        # Apply limit if specified (overrides pagination)
        limit = request.query_params.get("limit")
        if limit:
            try:
                queryset = queryset[: int(limit)]
                serializer = self.get_serializer(queryset, many=True)
                return Response(
                    {
                        "messages": serializer.data,
                        "count": len(serializer.data),
                        "filters": filters,
                    }
                )
            except ValueError:
                pass

        # Use pagination
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(
            {
                "messages": serializer.data,
                "count": len(serializer.data),
                "filters": filters,
            }
        )

    @extend_schema(
        summary="Get plain-English AI summary of an ACARS message",
        description=(
            "Uses the configured LLM to explain a single ACARS/VDL2 message in plain "
            "English. Opt-in (one LLM call, cached). Returns available=false if the LLM "
            "is disabled/unconfigured; the client should fall back to the decoded fields."
        ),
    )
    @action(detail=True, methods=["get"], url_path="ai-summary")
    def ai_summary(self, request, pk=None):
        """Plain-English LLM summary of one ACARS message."""
        from skyspy.services import aviation_llm

        msg = self.get_object()

        if not aviation_llm.available():
            return Response({"available": False, "summary": None})

        decoded = _cached_decode(msg)

        # Ground the summary in the turbulence risk at the message's position.
        pos = (decoded or {}).get("position") if isinstance(decoded, dict) else None
        lat = pos.get("lat") if isinstance(pos, dict) else None
        lon = pos.get("lon") if isinstance(pos, dict) else None

        summary = aviation_llm.summarize_acars(
            msg.text or "",
            label=msg.label,
            callsign=msg.callsign,
            decoded=decoded,
            lat=lat,
            lon=lon,
        )
        return Response({"available": True, "summary": summary, "id": msg.id})

    @extend_schema(
        summary="Get structured AI analysis of an ACARS message",
        description=(
            "Uses the configured LLM to decode a single ACARS/VDL2 message into a structured "
            "object (headline, message type, decoded fields, airports, notes) for rich UI "
            "rendering. Opt-in (one LLM call, cached). Returns available=false when the LLM is "
            "disabled/unconfigured; analysis=null when nothing could be decoded."
        ),
    )
    @action(detail=True, methods=["get"], url_path="ai-analysis")
    def ai_analysis(self, request, pk=None):
        """Structured LLM decode of one ACARS message."""
        from skyspy.services import aviation_llm

        msg = self.get_object()

        if not aviation_llm.available():
            return Response({"available": False, "analysis": None})

        decoded = _cached_decode(msg)

        # Pull a position out of the decoded message (position/ADS reports carry
        # one) so the analysis can be grounded in the turbulence risk there.
        pos = (decoded or {}).get("position") if isinstance(decoded, dict) else None
        lat = pos.get("lat") if isinstance(pos, dict) else None
        lon = pos.get("lon") if isinstance(pos, dict) else None

        analysis = aviation_llm.analyze_acars(
            msg.text or "",
            label=msg.label,
            callsign=msg.callsign,
            decoded=decoded,
            lat=lat,
            lon=lon,
        )
        return Response({"available": True, "analysis": analysis, "id": msg.id})

    @extend_schema(summary="Get ACARS statistics", responses={200: AcarsStatsSerializer})
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get ACARS statistics."""
        now = timezone.now()
        last_hour = now - timedelta(hours=1)
        last_24h = now - timedelta(hours=24)

        total = AcarsMessage.objects.count()
        last_hour_count = AcarsMessage.objects.filter(timestamp__gte=last_hour).count()
        last_24h_count = AcarsMessage.objects.filter(timestamp__gte=last_24h).count()

        # By source
        by_source = dict(
            AcarsMessage.objects.filter(timestamp__gte=last_24h).values_list("source").annotate(count=Count("id"))
        )

        # Top labels
        top_labels = list(
            AcarsMessage.objects.filter(timestamp__gte=last_24h)
            .values("label")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        # Service stats from cache
        service_stats = cache.get("acars_service_stats", {})

        return Response(
            {
                "total_messages": total,
                "last_hour": last_hour_count,
                "last_24h": last_24h_count,
                "by_source": by_source,
                "top_labels": top_labels,
                "service_stats": service_stats,
            }
        )

    @extend_schema(summary="Get ACARS receiver status", responses={200: AcarsStatusSerializer})
    @action(detail=False, methods=["get"])
    def status(self, request):
        """Get ACARS receiver status."""
        running = bool(cache.get("acars_running"))
        acars_stats = cache.get("acars_stats", {})
        vdlm2_stats = cache.get("vdlm2_stats", {})
        buffer_size = cache.get("acars_buffer_size", 0)

        return Response(
            {
                "running": running,
                "acars": acars_stats,
                "vdlm2": vdlm2_stats,
                "buffer_size": buffer_size,
            }
        )

    @extend_schema(summary="Get ACARS label reference", description="Get reference data for ACARS message labels")
    @action(detail=False, methods=["get"])
    def labels(self, request):
        """Get ACARS label reference."""
        # Import label definitions
        try:
            from skyspy.data.message_labels import ACARS_LABELS, SOURCE_TYPES

            return Response(
                {
                    "labels": ACARS_LABELS,
                    "sources": SOURCE_TYPES,
                }
            )
        except ImportError:
            # Return basic labels if data file not available
            return Response(
                {
                    "labels": {
                        "H1": {"name": "Pre-Departure Clearance", "description": "DCL"},
                        "Q0": {"name": "Link Test", "description": "Connection test"},
                        "_d": {"name": "Downlink", "description": "Aircraft to ground"},
                        "SA": {"name": "Aircraft Performance", "description": "Performance data"},
                    },
                    "sources": {
                        "acars": "ACARS (VHF)",
                        "vdlm2": "VDL Mode 2",
                    },
                }
            )

    # ==========================================================================
    # Message Type Breakdown Stats
    # ==========================================================================

    @extend_schema(
        summary="Get ACARS message breakdown statistics",
        description="Detailed breakdown of ACARS messages by type, label, category, and source",
        parameters=[
            OpenApiParameter(name="hours", type=int, default=24, description="Time range in hours (default: 24)"),
            OpenApiParameter(name="use_cache", type=bool, default=True, description="Use cached stats if available"),
        ],
        responses={200: AcarsMessageStatsSerializer},
    )
    @action(detail=False, methods=["get"], url_path="stats/breakdown")
    def stats_breakdown(self, request):
        """
        Get detailed ACARS message breakdown statistics.

        Returns:
        - Message counts by source (ACARS vs VDL2)
        - Top message labels with descriptions
        - Messages grouped by category (OOOI, weather, position, etc.)
        - Top frequencies
        """
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        use_cache = request.query_params.get("use_cache", "true").lower() == "true"

        # Try cached stats for default time range
        if use_cache and hours == 24:
            stats = get_cached_acars_stats()
            if stats:
                return Response(stats)

        # Calculate fresh stats
        stats = calculate_acars_message_stats(hours=hours)
        return Response(stats)

    @extend_schema(
        summary="Get ACARS airline activity statistics",
        description="Statistics on ACARS activity grouped by airline/operator",
        parameters=[
            OpenApiParameter(name="hours", type=int, default=24, description="Time range in hours (default: 24)"),
            OpenApiParameter(name="limit", type=int, default=20, description="Maximum number of airlines to return"),
            OpenApiParameter(name="use_cache", type=bool, default=True, description="Use cached stats if available"),
        ],
        responses={200: AcarsAirlineStatsSerializer},
    )
    @action(detail=False, methods=["get"], url_path="stats/airlines")
    def stats_airlines(self, request):
        """
        Get ACARS message statistics grouped by airline.

        Returns airlines ranked by message activity with:
        - Airline ICAO/IATA codes and name
        - Total message count
        - Unique flight callsigns
        """
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        try:
            limit = int(request.query_params.get("limit", 20))
            limit = min(limit, 1000)  # Cap at 1000
        except (ValueError, TypeError):
            limit = 20
        use_cache = request.query_params.get("use_cache", "true").lower() == "true"

        # Try cached stats for default parameters
        if use_cache and hours == 24 and limit == 20:
            stats = get_cached_acars_airlines()
            if stats:
                return Response(stats)

        # Calculate fresh stats
        stats = calculate_acars_airline_stats(hours=hours, limit=limit)
        return Response(stats)

    @extend_schema(
        summary="Get ACARS summary statistics",
        description="High-level summary of ACARS message statistics for dashboard",
        parameters=[
            OpenApiParameter(name="hours", type=int, default=24, description="Time range in hours (default: 24)"),
        ],
        responses={200: AcarsSummaryStatsSerializer},
    )
    @action(detail=False, methods=["get"], url_path="stats/summary")
    def stats_summary(self, request):
        """
        Get high-level ACARS summary statistics.

        Quick overview with key metrics for dashboard display.
        """
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        stats = get_acars_summary_stats(hours=hours)
        return Response(stats)

    # ==========================================================================
    # Trends & Time-Series Stats
    # ==========================================================================

    @extend_schema(
        summary="Get ACARS message trends",
        description="Time-series data showing message activity over time",
        parameters=[
            OpenApiParameter(name="hours", type=int, default=24, description="Time range in hours (default: 24)"),
            OpenApiParameter(name="interval", type=str, default="hour", description="Time interval: hour or day"),
            OpenApiParameter(name="use_cache", type=bool, default=True, description="Use cached stats if available"),
        ],
        responses={200: AcarsTrendsSerializer},
    )
    @action(detail=False, methods=["get"], url_path="stats/trends")
    def stats_trends(self, request):
        """
        Get ACARS message trends over time.

        Returns:
        - Time series with message counts per interval
        - Breakdown by source (ACARS/VDL2) per interval
        - Unique aircraft and flights per interval
        - Peak activity times
        - Hourly distribution across all days
        """
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        interval = request.query_params.get("interval", "hour")
        use_cache = request.query_params.get("use_cache", "true").lower() == "true"

        # Try cached stats for default parameters
        if use_cache and hours == 24 and interval == "hour":
            trends = get_cached_acars_trends()
            if trends:
                return Response(trends)

        # Calculate fresh trends
        trends = calculate_acars_trends(hours=hours, interval=interval)
        return Response(trends)

    @extend_schema(
        summary="Get ACARS category trends",
        description="Message category distribution over time (hourly)",
        parameters=[
            OpenApiParameter(name="hours", type=int, default=24, description="Time range in hours (default: 24)"),
        ],
        responses={200: AcarsCategoryTrendsSerializer},
    )
    @action(detail=False, methods=["get"], url_path="stats/category-trends")
    def stats_category_trends(self, request):
        """
        Get message category distribution over time.

        Shows how different message types (OOOI, weather, position reports, etc.)
        are distributed throughout the day.
        """
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        trends = calculate_acars_category_trends(hours=hours)
        return Response(trends)

    # ==========================================================================
    # Free Text Analysis
    # ==========================================================================

    @extend_schema(
        summary="Analyze ACARS free text content",
        description="Pattern analysis of message text content",
        parameters=[
            OpenApiParameter(name="hours", type=int, default=24, description="Time range in hours (default: 24)"),
            OpenApiParameter(name="limit", type=int, default=20, description="Maximum items per category"),
        ],
        responses={200: AcarsFreeTextAnalysisSerializer},
    )
    @action(detail=False, methods=["get"], url_path="stats/text-analysis")
    def stats_text_analysis(self, request):
        """
        Analyze patterns in ACARS message text content.

        Returns:
        - Most mentioned airports
        - Weather content breakdown (METAR, TAF, PIREP, etc.)
        - Detected message patterns (position reports, flight plans, fuel data, etc.)
        """
        try:
            hours = int(request.query_params.get("hours", 24))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 24
        try:
            limit = int(request.query_params.get("limit", 20))
            limit = min(limit, 1000)  # Cap at 1000
        except (ValueError, TypeError):
            limit = 20
        analysis = calculate_free_text_analysis(hours=hours, limit=limit)
        return Response(analysis)
