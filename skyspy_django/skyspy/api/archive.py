"""
Archive API ViewSet.

Provides REST endpoints for browsing historical/archived data:
NOTAMs, PIREPs, and other cached objects that have expired or been archived.
"""
import logging
from datetime import datetime, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models.notams import CachedNotam
from skyspy.models.aviation import CachedPirep
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.auth.permissions import FeatureBasedPermission

logger = logging.getLogger(__name__)


class ArchiveViewSet(viewsets.ViewSet):
    """ViewSet for archived/historical data."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="List archived NOTAMs",
        description="Get list of archived NOTAMs with filters",
        parameters=[
            OpenApiParameter(
                name='days', type=int,
                description='Number of days to look back (default: 30)'
            ),
            OpenApiParameter(
                name='icao', type=str,
                description='Filter by airport ICAO code'
            ),
            OpenApiParameter(
                name='type', type=str,
                description='NOTAM type filter (D, FDC, TFR, GPS)'
            ),
            OpenApiParameter(
                name='search', type=str,
                description='Text search in NOTAM content'
            ),
            OpenApiParameter(
                name='limit', type=int,
                description='Maximum number of results (default: 50)'
            ),
            OpenApiParameter(
                name='offset', type=int,
                description='Offset for pagination (default: 0)'
            ),
        ]
    )
    @action(detail=False, methods=['get'])
    def notams(self, request):
        """List archived NOTAMs with filters."""
        from skyspy.services import notams

        days = int(request.query_params.get('days', 30))
        icao = request.query_params.get('icao')
        notam_type = request.query_params.get('type')
        search = request.query_params.get('search')
        limit = int(request.query_params.get('limit', 50))
        offset = int(request.query_params.get('offset', 0))

        result = notams.get_archived_notams(
            icao=icao,
            notam_type=notam_type,
            days=days,
            search=search,
            limit=limit,
            offset=offset,
        )

        return Response({
            **result,
            'days': days,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="List archived PIREPs",
        description="Get list of historical pilot reports",
        parameters=[
            OpenApiParameter(
                name='days', type=int,
                description='Number of days to look back (default: 30)'
            ),
            OpenApiParameter(
                name='icao', type=str,
                description='Filter by airport/location ICAO code'
            ),
            OpenApiParameter(
                name='report_type', type=str,
                description='Report type (UA=routine, UUA=urgent)'
            ),
            OpenApiParameter(
                name='turbulence', type=str,
                description='Filter by turbulence type'
            ),
            OpenApiParameter(
                name='icing', type=str,
                description='Filter by icing type'
            ),
            OpenApiParameter(
                name='search', type=str,
                description='Text search in PIREP content'
            ),
            OpenApiParameter(
                name='limit', type=int,
                description='Maximum number of results (default: 50)'
            ),
            OpenApiParameter(
                name='offset', type=int,
                description='Offset for pagination (default: 0)'
            ),
        ]
    )
    @action(detail=False, methods=['get'])
    def pireps(self, request):
        """List archived/historical PIREPs."""
        days = int(request.query_params.get('days', 30))
        icao = request.query_params.get('icao')
        report_type = request.query_params.get('report_type')
        turbulence = request.query_params.get('turbulence')
        icing = request.query_params.get('icing')
        search = request.query_params.get('search')
        limit = int(request.query_params.get('limit', 50))
        offset = int(request.query_params.get('offset', 0))

        now = timezone.now()
        cutoff = now - timedelta(days=days)

        # Query archived PIREPs
        queryset = CachedPirep.objects.filter(is_archived=True)

        # If no archived PIREPs, fall back to old PIREPs by observation time
        if not queryset.exists():
            queryset = CachedPirep.objects.filter(
                observation_time__lt=now - timedelta(hours=6)
            )

        queryset = queryset.filter(
            Q(archived_at__gte=cutoff) | Q(observation_time__gte=cutoff)
        )

        if icao:
            queryset = queryset.filter(location__iexact=icao)

        if report_type:
            queryset = queryset.filter(report_type__iexact=report_type)

        if turbulence:
            queryset = queryset.filter(turbulence_type__iexact=turbulence)

        if icing:
            queryset = queryset.filter(icing_type__iexact=icing)

        if search:
            queryset = queryset.filter(
                Q(raw_text__icontains=search) |
                Q(location__icontains=search) |
                Q(aircraft_type__icontains=search)
            )

        total_count = queryset.count()
        pireps = list(queryset.order_by('-observation_time')[offset:offset + limit])

        results = []
        for pirep in pireps:
            results.append({
                "pirep_id": pirep.pirep_id,
                "report_type": pirep.report_type,
                "location": pirep.location,
                "latitude": pirep.latitude,
                "longitude": pirep.longitude,
                "observation_time": pirep.observation_time.isoformat() if pirep.observation_time else None,
                "flight_level": pirep.flight_level,
                "altitude_ft": pirep.altitude_ft,
                "aircraft_type": pirep.aircraft_type,
                "turbulence_type": pirep.turbulence_type,
                "turbulence_freq": pirep.turbulence_freq,
                "icing_type": pirep.icing_type,
                "icing_intensity": pirep.icing_intensity,
                "sky_cover": pirep.sky_cover,
                "visibility_sm": pirep.visibility_sm,
                "weather": pirep.weather,
                "temperature_c": pirep.temperature_c,
                "wind_dir": pirep.wind_dir,
                "wind_speed_kt": pirep.wind_speed_kt,
                "raw_text": pirep.raw_text,
                "archived_at": pirep.archived_at.isoformat() if pirep.archived_at else None,
                "archive_reason": pirep.archive_reason,
            })

        return Response({
            'pireps': results,
            'total_count': total_count,
            'limit': limit,
            'offset': offset,
            'days': days,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get archive statistics",
        description="Get statistics about archived data",
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get archive statistics."""
        from skyspy.services import notams

        now = timezone.now()

        # NOTAM archive stats
        notam_stats = notams.get_archive_stats()

        # PIREP archive stats
        pirep_archived_count = CachedPirep.objects.filter(is_archived=True).count()
        pirep_total = CachedPirep.objects.count()

        # PIREP stats by type
        pirep_by_type = dict(
            CachedPirep.objects.filter(is_archived=True)
            .values('report_type')
            .annotate(count=Count('id'))
            .values_list('report_type', 'count')
        )

        # PIREP stats by condition
        pirep_turbulence = dict(
            CachedPirep.objects.filter(
                is_archived=True,
                turbulence_type__isnull=False
            )
            .values('turbulence_type')
            .annotate(count=Count('id'))
            .values_list('turbulence_type', 'count')
        )

        pirep_icing = dict(
            CachedPirep.objects.filter(
                is_archived=True,
                icing_type__isnull=False
            )
            .values('icing_type')
            .annotate(count=Count('id'))
            .values_list('icing_type', 'count')
        )

        return Response({
            'notams': notam_stats,
            'pireps': {
                'total_archived': pirep_archived_count,
                'total_records': pirep_total,
                'by_type': pirep_by_type,
                'by_turbulence': pirep_turbulence,
                'by_icing': pirep_icing,
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get archived NOTAM by ID",
        description="Get a specific archived NOTAM by its ID",
    )
    @action(detail=False, methods=['get'], url_path='notams/(?P<notam_id>[^/]+)')
    def notam_detail(self, request, notam_id=None):
        """Get a specific archived NOTAM."""
        try:
            notam = CachedNotam.objects.get(notam_id=notam_id)

            return Response({
                "notam_id": notam.notam_id,
                "notam_type": notam.notam_type,
                "classification": notam.classification,
                "location": notam.location,
                "latitude": notam.latitude,
                "longitude": notam.longitude,
                "radius_nm": notam.radius_nm,
                "floor_ft": notam.floor_ft,
                "ceiling_ft": notam.ceiling_ft,
                "effective_start": notam.effective_start.isoformat() if notam.effective_start else None,
                "effective_end": notam.effective_end.isoformat() if notam.effective_end else None,
                "is_permanent": notam.is_permanent,
                "text": notam.text,
                "raw_text": notam.raw_text,
                "geometry": notam.geometry,
                "reason": notam.reason,
                "keywords": notam.keywords,
                "is_archived": notam.is_archived,
                "archived_at": notam.archived_at.isoformat() if notam.archived_at else None,
                "archive_reason": notam.archive_reason,
                "fetched_at": notam.fetched_at.isoformat() if notam.fetched_at else None,
                "created_at": notam.created_at.isoformat() if notam.created_at else None,
            })
        except CachedNotam.DoesNotExist:
            return Response(
                {'error': f'NOTAM {notam_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )

    @extend_schema(
        summary="Get archived PIREP by ID",
        description="Get a specific archived PIREP by its ID",
    )
    @action(detail=False, methods=['get'], url_path='pireps/(?P<pirep_id>[^/]+)')
    def pirep_detail(self, request, pirep_id=None):
        """Get a specific archived PIREP."""
        try:
            pirep = CachedPirep.objects.get(pirep_id=pirep_id)

            return Response({
                "pirep_id": pirep.pirep_id,
                "report_type": pirep.report_type,
                "location": pirep.location,
                "latitude": pirep.latitude,
                "longitude": pirep.longitude,
                "observation_time": pirep.observation_time.isoformat() if pirep.observation_time else None,
                "flight_level": pirep.flight_level,
                "altitude_ft": pirep.altitude_ft,
                "aircraft_type": pirep.aircraft_type,
                "turbulence_type": pirep.turbulence_type,
                "turbulence_freq": pirep.turbulence_freq,
                "turbulence_base_ft": pirep.turbulence_base_ft,
                "turbulence_top_ft": pirep.turbulence_top_ft,
                "icing_type": pirep.icing_type,
                "icing_intensity": pirep.icing_intensity,
                "icing_base_ft": pirep.icing_base_ft,
                "icing_top_ft": pirep.icing_top_ft,
                "sky_cover": pirep.sky_cover,
                "visibility_sm": pirep.visibility_sm,
                "weather": pirep.weather,
                "temperature_c": pirep.temperature_c,
                "wind_dir": pirep.wind_dir,
                "wind_speed_kt": pirep.wind_speed_kt,
                "raw_text": pirep.raw_text,
                "is_archived": pirep.is_archived,
                "archived_at": pirep.archived_at.isoformat() if pirep.archived_at else None,
                "archive_reason": pirep.archive_reason,
                "fetched_at": pirep.fetched_at.isoformat() if pirep.fetched_at else None,
            })
        except CachedPirep.DoesNotExist:
            return Response(
                {'error': f'PIREP {pirep_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )
