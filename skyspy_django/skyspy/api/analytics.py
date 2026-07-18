"""Advanced Analytics API views.

Cross-correlation of aircraft sightings and data points:
- ``scatter/`` build-your-own scatter for any numeric field pair (Pearson r + regression)
- ``matrix/`` pairwise correlation matrix across all numeric fields
- ``cross-domain/`` per-aircraft rollup linking sightings/alerts/safety/ACARS
"""

import logging

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.api.params import parse_int
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.services.analytics_correlation import (
    correlation_matrix,
    cross_domain_by_aircraft,
    field_labels,
    is_valid_field,
    scatter_correlation,
)

logger = logging.getLogger(__name__)

_HOURS_PARAM = OpenApiParameter(
    name="hours",
    type=int,
    location=OpenApiParameter.QUERY,
    description="Time range in hours (default: 24, max: 720)",
    default=24,
)


def _parse_military(params):
    """Parse the optional ``military`` filter -> True/False/None (any)."""
    raw = params.get("military")
    if raw is None or raw == "":
        return None
    return raw.lower() in ("1", "true", "yes")


class AnalyticsViewSet(viewsets.ViewSet):
    """Advanced cross-domain / cross-metric analytics.

    Reuses AircraftSighting telemetry and per-aircraft activity across the
    alerts, safety, and ACARS domains. See ``services.analytics_correlation``.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Advanced analytics summary",
        description="Lists the numeric fields available for correlation and their labels/units.",
    )
    def list(self, request):
        """Available correlatable fields (for building the explorer UI)."""
        return Response(
            {
                "fields": field_labels(),
                "timestamp": timezone.now().isoformat().replace("+00:00", "Z"),
            }
        )

    @extend_schema(
        summary="Scatter correlation for a field pair",
        description="""
        Returns scatter points, Pearson correlation coefficient, and a
        least-squares regression line for any two numeric sighting fields
        (altitude, ground speed, distance, RSSI, vertical rate, hour of day).
        """,
        parameters=[
            OpenApiParameter(name="x_field", type=str, location=OpenApiParameter.QUERY, description="X-axis field key"),
            OpenApiParameter(name="y_field", type=str, location=OpenApiParameter.QUERY, description="Y-axis field key"),
            _HOURS_PARAM,
            OpenApiParameter(
                name="military",
                type=bool,
                location=OpenApiParameter.QUERY,
                description="Filter to military (true) / civilian (false) / all (omit)",
            ),
            OpenApiParameter(
                name="category", type=str, location=OpenApiParameter.QUERY, description="Filter to an aircraft category"
            ),
        ],
    )
    @action(detail=False, methods=["get"], url_path="scatter")
    def scatter(self, request):
        """Build-your-own scatter + Pearson r + regression."""
        x_field = request.query_params.get("x_field", "distance_nm")
        y_field = request.query_params.get("y_field", "rssi")
        if not is_valid_field(x_field) or not is_valid_field(y_field):
            return Response(
                {"error": "unknown correlation field", "valid_fields": [f["key"] for f in field_labels()]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        hours = parse_int(request.query_params, "hours", 24, min_value=1, max_value=720)
        category = request.query_params.get("category") or None
        data = scatter_correlation(
            x_field, y_field, hours=hours, military=_parse_military(request.query_params), category=category
        )
        return Response(data)

    @extend_schema(
        summary="Correlation matrix across all numeric fields",
        parameters=[
            _HOURS_PARAM,
            OpenApiParameter(name="military", type=bool, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="category", type=str, location=OpenApiParameter.QUERY),
        ],
    )
    @action(detail=False, methods=["get"], url_path="matrix")
    def matrix(self, request):
        """Pairwise Pearson r for every numeric field pair."""
        hours = parse_int(request.query_params, "hours", 24, min_value=1, max_value=720)
        category = request.query_params.get("category") or None
        data = correlation_matrix(hours=hours, military=_parse_military(request.query_params), category=category)
        return Response(data)

    @extend_schema(
        summary="Cross-domain per-aircraft activity",
        description="""
        Ranks aircraft by combined cross-domain activity, joining sighting counts
        with triggered alerts, safety events, and ACARS messages, enriched with
        aircraft type and operator.
        """,
        parameters=[
            _HOURS_PARAM,
            OpenApiParameter(
                name="limit",
                type=int,
                location=OpenApiParameter.QUERY,
                description="Maximum aircraft to return (default: 25)",
                default=25,
            ),
        ],
    )
    @action(detail=False, methods=["get"], url_path="cross-domain")
    def cross_domain(self, request):
        """Per-aircraft rollup across sightings/alerts/safety/ACARS."""
        hours = parse_int(request.query_params, "hours", 24, min_value=1, max_value=720)
        limit = parse_int(request.query_params, "limit", 25, min_value=1, max_value=200)
        return Response(cross_domain_by_aircraft(hours=hours, limit=limit))
