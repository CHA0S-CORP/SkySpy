"""
NOTAM API ViewSet.

Provides REST endpoints for NOTAMs and TFRs (Temporary Flight Restrictions).
"""

import logging
from datetime import datetime

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.serializers.notams import (
    NotamListResponseSerializer,
    NotamStatsSerializer,
    TfrListResponseSerializer,
)

logger = logging.getLogger(__name__)


class NotamViewSet(viewsets.ViewSet):
    """ViewSet for NOTAM and TFR data."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="List NOTAMs",
        description="Get list of NOTAMs with optional filters",
        parameters=[
            OpenApiParameter(name="icao", type=str, description="Airport ICAO code (e.g., KSEA)"),
            OpenApiParameter(name="lat", type=float, description="Center latitude for area search"),
            OpenApiParameter(name="lon", type=float, description="Center longitude for area search"),
            OpenApiParameter(
                name="radius_nm", type=float, description="Search radius in nautical miles (default: 100)"
            ),
            OpenApiParameter(name="type", type=str, description="NOTAM type filter (D, FDC, TFR, GPS)"),
            OpenApiParameter(name="active_only", type=bool, description="Only return active NOTAMs (default: true)"),
            OpenApiParameter(name="limit", type=int, description="Maximum number of results (default: 100)"),
        ],
        responses={200: NotamListResponseSerializer},
    )
    def list(self, request):
        """List NOTAMs with optional filters."""
        from skyspy.services import notams

        icao = request.query_params.get("icao")
        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            radius_nm = float(request.query_params.get("radius_nm", 100))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 100
        notam_type = request.query_params.get("type")
        active_only = request.query_params.get("active_only", "true").lower() == "true"
        try:
            limit = int(request.query_params.get("limit", 100))
            limit = min(limit, 1000)  # Cap at 1000
        except (ValueError, TypeError):
            limit = 100

        # Convert lat/lon to float if provided
        if lat:
            try:
                lat = float(lat)
            except (ValueError, TypeError):
                lat = None
        if lon:
            try:
                lon = float(lon)
            except (ValueError, TypeError):
                lon = None

        notam_list = notams.get_notams(
            icao=icao,
            lat=lat,
            lon=lon,
            radius_nm=radius_nm,
            notam_type=notam_type,
            active_only=active_only,
            limit=limit,
        )

        return Response(
            {
                "notams": notam_list,
                "count": len(notam_list),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

    @extend_schema(
        summary="Get TFRs",
        description="Get active Temporary Flight Restrictions",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude for area search"),
            OpenApiParameter(name="lon", type=float, description="Center longitude for area search"),
            OpenApiParameter(
                name="radius_nm", type=float, description="Search radius in nautical miles (default: 500)"
            ),
            OpenApiParameter(name="active_only", type=bool, description="Only return active TFRs (default: true)"),
        ],
        responses={200: TfrListResponseSerializer},
    )
    @action(detail=False, methods=["get"])
    def tfrs(self, request):
        """Get active TFRs."""
        from skyspy.services import notams

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            radius_nm = float(request.query_params.get("radius_nm", 500))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 500
        active_only = request.query_params.get("active_only", "true").lower() == "true"

        if lat:
            try:
                lat = float(lat)
            except (ValueError, TypeError):
                lat = None
        if lon:
            try:
                lon = float(lon)
            except (ValueError, TypeError):
                lon = None

        tfr_list = notams.get_tfrs(
            lat=lat,
            lon=lon,
            radius_nm=radius_nm,
            active_only=active_only,
        )

        return Response(
            {
                "tfrs": tfr_list,
                "count": len(tfr_list),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

    @extend_schema(
        summary="Get nearby NOTAMs",
        description="Get NOTAMs near a specific location",
        parameters=[
            OpenApiParameter(name="lat", type=float, required=True, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, required=True, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius in nautical miles (default: 50)"),
        ],
        responses={200: NotamListResponseSerializer},
    )
    @action(detail=False, methods=["get"])
    def nearby(self, request):
        """Get NOTAMs near a location."""
        from skyspy.services import notams

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")

        if not lat or not lon:
            return Response({"error": "lat and lon parameters are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            lat = float(lat)
            lon = float(lon)
        except (ValueError, TypeError):
            return Response({"error": "lat and lon must be valid numbers"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            radius_nm = float(request.query_params.get("radius_nm", 50))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 50

        notam_list = notams.get_notams(
            lat=lat,
            lon=lon,
            radius_nm=radius_nm,
            active_only=True,
        )

        return Response(
            {
                "notams": notam_list,
                "count": len(notam_list),
                "center": {"lat": lat, "lon": lon},
                "radius_nm": radius_nm,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

    @extend_schema(
        summary="Get NOTAMs for airport",
        description="Get all NOTAMs for a specific airport",
        responses={200: NotamListResponseSerializer},
    )
    @action(detail=False, methods=["get"], url_path="airport/(?P<icao>[A-Za-z0-9]{3,4})")
    def airport(self, request, icao=None):
        """Get NOTAMs for a specific airport."""
        from skyspy.services import notams

        if not icao:
            return Response({"error": "Airport ICAO code is required"}, status=status.HTTP_400_BAD_REQUEST)

        active_only = request.query_params.get("active_only", "true").lower() == "true"

        notam_list = notams.get_notams_for_airport(
            icao=icao.upper(),
            active_only=active_only,
        )

        return Response(
            {
                "notams": notam_list,
                "count": len(notam_list),
                "airport": icao.upper(),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

    @extend_schema(
        summary="Get plain-English AI summary of a NOTAM",
        description=(
            "Uses the configured LLM to explain a stored NOTAM in plain English. Opt-in "
            "(one LLM call, cached). Falls back to the rule-based decoder summary when the "
            "LLM is disabled/unconfigured."
        ),
    )
    @action(detail=False, methods=["get"], url_path=r"(?P<notam_id>[^/]+)/ai-summary")
    def ai_summary(self, request, notam_id=None):
        """Plain-English summary of one NOTAM (LLM if available, else rule-based)."""
        from skyspy.models import CachedNotam
        from skyspy.services import aviation_llm, notam_decoder

        notam = CachedNotam.objects.filter(notam_id=notam_id).first()
        if not notam:
            return Response({"error": "NOTAM not found"}, status=status.HTTP_404_NOT_FOUND)

        decoded = notam_decoder.decode_notam(notam)
        rule_summary = decoded.get("human_summary")
        raw = notam.raw_text or notam.text or ""

        ai = aviation_llm.explain_notam(raw, decoded=decoded) if aviation_llm.available() else None

        return Response(
            {
                "notam_id": notam_id,
                "summary": ai or rule_summary,
                "source": "llm" if ai else "rule",
                "severity": decoded.get("severity"),
                "category": decoded.get("category"),
            }
        )

    @extend_schema(
        summary="Get one NOTAM by id",
        description="Full detail (including raw text and schedule) for a single cached NOTAM.",
        parameters=[OpenApiParameter(name="notam_id", type=str, required=True, description="NOTAM id")],
        responses={200: NotamListResponseSerializer},
    )
    @action(detail=False, methods=["get"], url_path="detail")
    def record(self, request):
        """Full detail for a single NOTAM (powers the NOTAM detail page).

        Uses a query param (``?notam_id=6/6038``) because NOTAM ids can contain
        slashes, which would break a path segment.
        """
        from skyspy.services import notams

        notam_id = request.query_params.get("notam_id")
        if not notam_id:
            return Response({"error": "notam_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        detail = notams.get_notam_detail(notam_id)
        if not detail:
            return Response({"error": "NOTAM not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(detail)

    @extend_schema(
        summary="Get structured AI briefing for a NOTAM",
        description=(
            "LLM-generated flight-ops briefing broken into headline, plain-language "
            "summary, key restrictions, and observer implications. Opt-in (one cached "
            "LLM call). Falls back to the rule-based summary when the LLM is disabled "
            "or the structured response can't be parsed."
        ),
        parameters=[OpenApiParameter(name="notam_id", type=str, required=True, description="NOTAM id")],
    )
    @action(detail=False, methods=["get"])
    def brief(self, request):
        """Structured plain-language briefing for one NOTAM (query-param id)."""
        from skyspy.models import CachedNotam
        from skyspy.services import aviation_llm, notam_decoder

        notam_id = request.query_params.get("notam_id")
        if not notam_id:
            return Response({"error": "notam_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        notam = CachedNotam.objects.filter(notam_id=notam_id).first()
        if not notam:
            return Response({"error": "NOTAM not found"}, status=status.HTTP_404_NOT_FOUND)

        decoded = notam_decoder.decode_notam(notam)
        raw = notam.raw_text or notam.text or ""

        brief = aviation_llm.brief_notam(raw, decoded=decoded) if aviation_llm.available() else None
        if brief:
            return Response(
                {
                    "notam_id": notam_id,
                    "available": True,
                    "source": "llm",
                    **brief,
                    "severity": decoded.get("severity"),
                    "category": decoded.get("category"),
                }
            )

        # Fallback: single-string rule-based summary, no structured columns.
        return Response(
            {
                "notam_id": notam_id,
                "available": False,
                "source": "rule",
                "headline": decoded.get("human_summary") or "",
                "summary": decoded.get("human_summary") or "",
                "restrictions": [],
                "implications": [],
                "severity": decoded.get("severity"),
                "category": decoded.get("category"),
            }
        )

    @extend_schema(
        summary="Get NOTAM statistics",
        description="Get statistics about cached NOTAMs",
        responses={200: NotamStatsSerializer},
    )
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get NOTAM cache statistics."""
        from skyspy.services import notams

        stats = notams.get_notam_stats()
        stats["timestamp"] = datetime.utcnow().isoformat() + "Z"

        return Response(stats)

    @extend_schema(
        summary="Refresh NOTAM cache",
        description="Manually trigger a NOTAM cache refresh",
        responses={200: NotamStatsSerializer},
    )
    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """Manually refresh NOTAM cache."""
        from skyspy.tasks.notams import refresh_notams

        # Queue the refresh task
        refresh_notams.delay()

        return Response(
            {
                "message": "NOTAM refresh queued",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )
