"""
NOTAM API ViewSet.

Provides REST endpoints for NOTAMs and TFRs (Temporary Flight Restrictions).
"""
import logging
from datetime import datetime

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.serializers.notams import (
    CachedNotamSerializer,
    NotamListResponseSerializer,
    TfrListResponseSerializer,
    NotamStatsSerializer,
)

logger = logging.getLogger(__name__)


class NotamViewSet(viewsets.ViewSet):
    """ViewSet for NOTAM and TFR data."""

    @extend_schema(
        summary="List NOTAMs",
        description="Get list of NOTAMs with optional filters",
        parameters=[
            OpenApiParameter(
                name='icao', type=str,
                description='Airport ICAO code (e.g., KSEA)'
            ),
            OpenApiParameter(
                name='lat', type=float,
                description='Center latitude for area search'
            ),
            OpenApiParameter(
                name='lon', type=float,
                description='Center longitude for area search'
            ),
            OpenApiParameter(
                name='radius_nm', type=float,
                description='Search radius in nautical miles (default: 100)'
            ),
            OpenApiParameter(
                name='type', type=str,
                description='NOTAM type filter (D, FDC, TFR, GPS)'
            ),
            OpenApiParameter(
                name='active_only', type=bool,
                description='Only return active NOTAMs (default: true)'
            ),
            OpenApiParameter(
                name='limit', type=int,
                description='Maximum number of results (default: 100)'
            ),
        ],
        responses={200: NotamListResponseSerializer}
    )
    def list(self, request):
        """List NOTAMs with optional filters."""
        from skyspy.services import notams

        icao = request.query_params.get('icao')
        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 100))
        notam_type = request.query_params.get('type')
        active_only = request.query_params.get('active_only', 'true').lower() == 'true'
        limit = int(request.query_params.get('limit', 100))

        # Convert lat/lon to float if provided
        if lat:
            lat = float(lat)
        if lon:
            lon = float(lon)

        notam_list = notams.get_notams(
            icao=icao,
            lat=lat,
            lon=lon,
            radius_nm=radius_nm,
            notam_type=notam_type,
            active_only=active_only,
            limit=limit,
        )

        return Response({
            'notams': notam_list,
            'count': len(notam_list),
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get TFRs",
        description="Get active Temporary Flight Restrictions",
        parameters=[
            OpenApiParameter(
                name='lat', type=float,
                description='Center latitude for area search'
            ),
            OpenApiParameter(
                name='lon', type=float,
                description='Center longitude for area search'
            ),
            OpenApiParameter(
                name='radius_nm', type=float,
                description='Search radius in nautical miles (default: 500)'
            ),
            OpenApiParameter(
                name='active_only', type=bool,
                description='Only return active TFRs (default: true)'
            ),
        ],
        responses={200: TfrListResponseSerializer}
    )
    @action(detail=False, methods=['get'])
    def tfrs(self, request):
        """Get active TFRs."""
        from skyspy.services import notams

        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 500))
        active_only = request.query_params.get('active_only', 'true').lower() == 'true'

        if lat:
            lat = float(lat)
        if lon:
            lon = float(lon)

        tfr_list = notams.get_tfrs(
            lat=lat,
            lon=lon,
            radius_nm=radius_nm,
            active_only=active_only,
        )

        return Response({
            'tfrs': tfr_list,
            'count': len(tfr_list),
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get nearby NOTAMs",
        description="Get NOTAMs near a specific location",
        parameters=[
            OpenApiParameter(
                name='lat', type=float, required=True,
                description='Center latitude'
            ),
            OpenApiParameter(
                name='lon', type=float, required=True,
                description='Center longitude'
            ),
            OpenApiParameter(
                name='radius_nm', type=float,
                description='Search radius in nautical miles (default: 50)'
            ),
        ],
        responses={200: NotamListResponseSerializer}
    )
    @action(detail=False, methods=['get'])
    def nearby(self, request):
        """Get NOTAMs near a location."""
        from skyspy.services import notams

        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')

        if not lat or not lon:
            return Response(
                {'error': 'lat and lon parameters are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        lat = float(lat)
        lon = float(lon)
        radius_nm = float(request.query_params.get('radius_nm', 50))

        notam_list = notams.get_notams(
            lat=lat,
            lon=lon,
            radius_nm=radius_nm,
            active_only=True,
        )

        return Response({
            'notams': notam_list,
            'count': len(notam_list),
            'center': {'lat': lat, 'lon': lon},
            'radius_nm': radius_nm,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get NOTAMs for airport",
        description="Get all NOTAMs for a specific airport",
        responses={200: NotamListResponseSerializer}
    )
    @action(detail=False, methods=['get'], url_path='airport/(?P<icao>[A-Za-z0-9]{3,4})')
    def airport(self, request, icao=None):
        """Get NOTAMs for a specific airport."""
        from skyspy.services import notams

        if not icao:
            return Response(
                {'error': 'Airport ICAO code is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        active_only = request.query_params.get('active_only', 'true').lower() == 'true'

        notam_list = notams.get_notams_for_airport(
            icao=icao.upper(),
            active_only=active_only,
        )

        return Response({
            'notams': notam_list,
            'count': len(notam_list),
            'airport': icao.upper(),
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get NOTAM statistics",
        description="Get statistics about cached NOTAMs",
        responses={200: NotamStatsSerializer}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get NOTAM cache statistics."""
        from skyspy.services import notams

        stats = notams.get_notam_stats()
        stats['timestamp'] = datetime.utcnow().isoformat() + 'Z'

        return Response(stats)

    @extend_schema(
        summary="Refresh NOTAM cache",
        description="Manually trigger a NOTAM cache refresh",
        responses={200: NotamStatsSerializer}
    )
    @action(detail=False, methods=['post'])
    def refresh(self, request):
        """Manually refresh NOTAM cache."""
        from skyspy.tasks.notams import refresh_notams

        # Queue the refresh task
        refresh_notams.delay()

        return Response({
            'message': 'NOTAM refresh queued',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })
