"""
Airframe information API views.
"""
import logging

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AircraftInfo
from skyspy.serializers.aircraft import (
    AircraftInfoSerializer,
    AircraftPhotoSerializer,
    BulkAircraftInfoSerializer,
    AircraftInfoCacheStatsSerializer,
)

logger = logging.getLogger(__name__)


class PhotoServeView(APIView):
    """Serve cached aircraft photos."""

    authentication_classes = []
    permission_classes = []

    def get(self, request, icao_hex, photo_type='full'):
        """
        Serve a cached photo by ICAO hex.

        photo_type: 'full' or 'thumb'
        """
        from pathlib import Path

        icao_hex = icao_hex.upper().strip()
        is_thumbnail = photo_type == 'thumb'

        # Check S3 first
        if settings.S3_ENABLED:
            from skyspy.services.photo_cache import get_photo_url
            url = get_photo_url(icao_hex, is_thumbnail=is_thumbnail, signed=True, verify_exists=True)
            if url:
                from django.http import HttpResponseRedirect
                return HttpResponseRedirect(url)
            raise Http404("Photo not found")

        # Local filesystem
        cache_dir = Path(settings.PHOTO_CACHE_DIR)
        suffix = "_thumb" if is_thumbnail else ""
        photo_path = cache_dir / f"{icao_hex}{suffix}.jpg"

        if not photo_path.exists() or photo_path.stat().st_size == 0:
            raise Http404("Photo not found")

        response = FileResponse(
            open(photo_path, 'rb'),
            content_type='image/jpeg'
        )
        response['Cache-Control'] = 'public, max-age=86400'  # 1 day cache
        return response


class AirframeViewSet(viewsets.ViewSet):
    """ViewSet for aircraft information and photos."""

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="Get aircraft info by ICAO",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.PATH,
                description='ICAO hex code'
            )
        ],
        responses={200: AircraftInfoSerializer, 404: None}
    )
    def retrieve(self, request, pk=None):
        """Get aircraft information by ICAO hex."""
        try:
            info = AircraftInfo.objects.get(icao_hex__iexact=pk)
            return Response(AircraftInfoSerializer(info).data)
        except AircraftInfo.DoesNotExist:
            # Queue background lookup for this aircraft
            icao = pk.upper().strip()
            try:
                from skyspy.tasks.external_db import fetch_aircraft_info
                fetch_aircraft_info.delay(icao)
                logger.debug(f"Queued aircraft info lookup for {icao}")
            except Exception as e:
                logger.warning(f"Failed to queue aircraft info lookup for {icao}: {e}")

            return Response(
                {
                    'error': 'Aircraft info not found',
                    'icao_hex': icao,
                    'status': 'lookup_queued',
                    'message': 'Aircraft info lookup has been queued. Try again shortly.'
                },
                status=status.HTTP_404_NOT_FOUND
            )

    @extend_schema(
        summary="Get aircraft photos",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.PATH,
                description='ICAO hex code'
            )
        ],
        responses={200: AircraftPhotoSerializer}
    )
    @action(detail=True, methods=['get'])
    def photos(self, request, pk=None):
        """Get aircraft photos."""
        try:
            info = AircraftInfo.objects.get(icao_hex__iexact=pk)
            return Response({
                'icao_hex': info.icao_hex,
                'photo_url': info.photo_url,
                'thumbnail_url': info.photo_thumbnail_url,
                'photographer': info.photo_photographer,
                'source': info.photo_source,
            })
        except AircraftInfo.DoesNotExist:
            return Response(
                {'error': 'Aircraft not found'},
                status=status.HTTP_404_NOT_FOUND
            )

    @extend_schema(
        summary="Bulk aircraft info lookup",
        description="Get info for multiple aircraft at once",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.QUERY,
                description='Comma-separated ICAO hex codes'
            )
        ],
        responses={200: BulkAircraftInfoSerializer}
    )
    @action(detail=False, methods=['get'])
    def bulk(self, request):
        """Bulk lookup aircraft info."""
        icao_param = request.query_params.get('icao', '')
        icao_list = [i.strip().upper() for i in icao_param.split(',') if i.strip()]

        if not icao_list:
            return Response({
                'aircraft': {},
                'found': 0,
                'requested': 0
            })

        # Limit to 100 aircraft
        icao_list = icao_list[:100]

        # Get cached info
        cached = AircraftInfo.objects.filter(icao_hex__in=icao_list)
        result = {}

        for info in cached:
            result[info.icao_hex] = AircraftInfoSerializer(info).data

        return Response({
            'aircraft': result,
            'found': len(result),
            'requested': len(icao_list)
        })

    @extend_schema(
        summary="Get aircraft by registration",
        parameters=[
            OpenApiParameter(
                name='registration',
                type=str,
                location=OpenApiParameter.PATH,
                description='Aircraft registration number'
            )
        ],
        responses={200: AircraftInfoSerializer, 404: None}
    )
    @action(detail=False, methods=['get'], url_path='registration/(?P<registration>[^/.]+)')
    def by_registration(self, request, registration=None):
        """Get aircraft info by registration."""
        try:
            info = AircraftInfo.objects.get(registration__iexact=registration)
            return Response(AircraftInfoSerializer(info).data)
        except AircraftInfo.DoesNotExist:
            return Response(
                {'error': 'Aircraft not found', 'registration': registration},
                status=status.HTTP_404_NOT_FOUND
            )

    @extend_schema(
        summary="Search aircraft",
        parameters=[
            OpenApiParameter(name='q', type=str, description='Search query'),
            OpenApiParameter(name='operator', type=str, description='Filter by operator'),
            OpenApiParameter(name='type', type=str, description='Filter by type code'),
        ],
        responses={200: AircraftInfoSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def search(self, request):
        """Search aircraft info."""
        from django.db.models import Q

        queryset = AircraftInfo.objects.all()

        q = request.query_params.get('q')
        if q:
            queryset = queryset.filter(
                Q(registration__icontains=q) |
                Q(icao_hex__icontains=q) |
                Q(operator__icontains=q)
            )

        operator = request.query_params.get('operator')
        if operator:
            queryset = queryset.filter(operator__icontains=operator)

        type_code = request.query_params.get('type')
        if type_code:
            queryset = queryset.filter(type_code__iexact=type_code)

        # Safely parse limit with fallback
        try:
            limit = min(int(request.query_params.get('limit', 50)), 500)
        except (ValueError, TypeError):
            limit = 50

        # Evaluate queryset to list to avoid extra count query
        results = list(queryset[:limit])

        return Response({
            'aircraft': AircraftInfoSerializer(results, many=True).data,
            'count': len(results),
        })

    @extend_schema(
        summary="Get cache statistics",
        responses={200: AircraftInfoCacheStatsSerializer}
    )
    @action(detail=False, methods=['get'], url_path='cache/stats')
    def cache_stats(self, request):
        """Get aircraft info cache statistics."""
        from django.db.models import Count

        total = AircraftInfo.objects.count()
        failed = AircraftInfo.objects.filter(fetch_failed=True).count()
        with_photos = AircraftInfo.objects.exclude(photo_url__isnull=True).exclude(photo_url='').count()
        with_local_photos = AircraftInfo.objects.filter(photo_local_path__isnull=False).count()
        military = AircraftInfo.objects.filter(is_military=True).count()

        # By source
        by_source = dict(
            AircraftInfo.objects.exclude(source__isnull=True).exclude(source='')
            .values('source').annotate(count=Count('id'))
            .values_list('source', 'count')
        )

        return Response({
            'total_cached': total,
            'failed_lookups': failed,
            'with_photos': with_photos,
            'with_local_photos': with_local_photos,
            'military': military,
            'by_source': by_source,
            'cache_duration_hours': 168,  # 7 days
            'retry_after_hours': 24,
        })

    @extend_schema(
        summary="Refresh aircraft info",
        description="Force refresh aircraft info from external sources",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.PATH,
                description='ICAO hex code'
            )
        ],
        responses={200: AircraftInfoSerializer, 202: None}
    )
    @action(detail=True, methods=['post'])
    def refresh(self, request, pk=None):
        """Force refresh aircraft info from external sources."""
        from skyspy.tasks.external_db import fetch_aircraft_info
        from skyspy.services import aircraft_info as aircraft_info_service

        icao = pk.upper().strip().lstrip('~')

        # Invalidate in-memory cache first
        aircraft_info_service.invalidate_cache(icao)

        # Delete existing record to force fresh lookup
        AircraftInfo.objects.filter(icao_hex=icao).delete()

        # Queue background fetch
        fetch_aircraft_info.delay(icao)

        return Response({
            'icao_hex': icao,
            'status': 'queued',
            'message': 'Aircraft info refresh queued'
        }, status=status.HTTP_202_ACCEPTED)

    @extend_schema(
        summary="Lookup aircraft info (fetch if not cached)",
        description="Get aircraft info, fetching from external sources if not in cache",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.PATH,
                description='ICAO hex code'
            ),
            OpenApiParameter(
                name='wait',
                type=bool,
                location=OpenApiParameter.QUERY,
                description='Wait for fetch to complete (default: false)'
            )
        ],
        responses={200: AircraftInfoSerializer, 202: None, 404: None}
    )
    @action(detail=True, methods=['get'])
    def lookup(self, request, pk=None):
        """
        Look up aircraft info, fetching from external sources if needed.

        If wait=true, waits up to 10 seconds for the fetch to complete.
        Otherwise, returns immediately with 202 Accepted if fetching.
        """
        from skyspy.tasks.external_db import fetch_aircraft_info
        from django.db import connection
        import select

        icao = pk.upper().strip().lstrip('~')
        wait = request.query_params.get('wait', 'false').lower() == 'true'

        # Check cache first
        try:
            info = AircraftInfo.objects.get(icao_hex=icao)
            if not info.fetch_failed:
                return Response(AircraftInfoSerializer(info).data)
        except AircraftInfo.DoesNotExist:
            pass

        # Queue fetch
        fetch_aircraft_info.delay(icao)

        if wait:
            # Poll for result (up to 10 seconds) using database polling
            # This is more efficient than time.sleep() in async context
            import time
            start_time = time.monotonic()
            timeout = 10.0
            poll_interval = 0.5

            while time.monotonic() - start_time < timeout:
                try:
                    info = AircraftInfo.objects.get(icao_hex=icao)
                    if not info.fetch_failed:
                        return Response(AircraftInfoSerializer(info).data)
                    elif info.fetch_failed:
                        return Response({
                            'icao_hex': icao,
                            'status': 'not_found',
                            'message': 'Aircraft not found in external databases'
                        }, status=status.HTTP_404_NOT_FOUND)
                except AircraftInfo.DoesNotExist:
                    pass

                # Use select for non-blocking wait (works better with ASGI)
                try:
                    select.select([], [], [], poll_interval)
                except (OSError, ValueError):
                    # Fallback for systems where select doesn't work on empty lists
                    time.sleep(poll_interval)

            # Timeout
            return Response({
                'icao_hex': icao,
                'status': 'timeout',
                'message': 'Lookup timed out, please try again'
            }, status=status.HTTP_202_ACCEPTED)

        return Response({
            'icao_hex': icao,
            'status': 'queued',
            'message': 'Aircraft info lookup queued'
        }, status=status.HTTP_202_ACCEPTED)

    @extend_schema(
        summary="Fetch aircraft photos",
        description="Trigger photo fetch for an aircraft",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.PATH,
                description='ICAO hex code'
            ),
            OpenApiParameter(
                name='force',
                type=bool,
                location=OpenApiParameter.QUERY,
                description='Force re-download even if cached'
            )
        ],
        responses={202: None}
    )
    @action(detail=True, methods=['post'], url_path='photos/fetch')
    def fetch_photos(self, request, pk=None):
        """Trigger photo fetch for an aircraft."""
        from skyspy.tasks.external_db import fetch_aircraft_photos

        icao = pk.upper().strip().lstrip('~')
        force = request.query_params.get('force', 'false').lower() == 'true'

        fetch_aircraft_photos.delay(icao, force=force)

        return Response({
            'icao_hex': icao,
            'status': 'queued',
            'message': 'Photo fetch queued',
            'force': force
        }, status=status.HTTP_202_ACCEPTED)

    @extend_schema(
        summary="Upgrade aircraft photo",
        description="Attempt to upgrade to a higher resolution photo",
        parameters=[
            OpenApiParameter(
                name='icao',
                type=str,
                location=OpenApiParameter.PATH,
                description='ICAO hex code'
            )
        ],
        responses={202: None}
    )
    @action(detail=True, methods=['post'], url_path='photos/upgrade')
    def upgrade_photo(self, request, pk=None):
        """Attempt to upgrade to a higher resolution photo."""
        from skyspy.tasks.external_db import upgrade_aircraft_photo

        icao = pk.upper().strip().lstrip('~')

        upgrade_aircraft_photo.delay(icao)

        return Response({
            'icao_hex': icao,
            'status': 'queued',
            'message': 'Photo upgrade queued'
        }, status=status.HTTP_202_ACCEPTED)
