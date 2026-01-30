"""
Aviation weather and data API views.
"""
import logging
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import (
    AirspaceAdvisory,
    AirspaceBoundary,
    CachedAirport,
    CachedNavaid,
    CachedPirep,
)
from skyspy.serializers.aviation import (
    AirspaceAdvisorySerializer,
    AirspaceBoundarySerializer,
    CachedAirportSerializer,
    CachedNavaidSerializer,
    CachedPirepSerializer,
    AviationDataSerializer,
)

logger = logging.getLogger(__name__)


class AviationViewSet(viewsets.ViewSet):
    """ViewSet for aviation weather and data."""

    # Public endpoint - no authentication required
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Get GeoJSON overlay data",
        description="Get GeoJSON data for map overlays (ARTCC, refueling areas, etc.)",
        parameters=[
            OpenApiParameter(name='data_type', type=str, location='path', description='Data type'),
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius in nm'),
        ],
        responses={200: AviationDataSerializer}
    )
    @action(detail=False, methods=['get'], url_path='geojson/(?P<data_type>[^/]+)')
    def geojson(self, request, data_type=None):
        """Get GeoJSON overlay data by type."""
        from skyspy.services import geodata

        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 500))

        if lat and lon:
            lat = float(lat)
            lon = float(lon)
        else:
            lat = None
            lon = None

        features = geodata.get_cached_geojson(
            data_type=data_type,
            lat=lat,
            lon=lon,
            radius_nm=radius_nm
        )

        return Response({
            'type': 'FeatureCollection',
            'features': features,
            'metadata': {
                'data_type': data_type,
                'count': len(features),
                'source': 'skyspy',
            }
        })

    @extend_schema(
        summary="Get METAR data",
        description="Get current METAR weather reports for airports",
        parameters=[
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius in nm'),
            OpenApiParameter(name='icao', type=str, description='Airport ICAO code'),
            OpenApiParameter(name='hours', type=int, description='Hours of history'),
        ],
        responses={200: AviationDataSerializer}
    )
    @action(detail=False, methods=['get'])
    def metars(self, request):
        """Get METAR data."""
        from skyspy.services import weather_cache

        icao = request.query_params.get('icao')
        hours = int(request.query_params.get('hours', 2))

        if icao:
            # Fetch METARs for specific station
            metars = weather_cache.fetch_metar_by_station(icao, hours=hours)
        else:
            # Fetch METARs for bounding box (default CONUS)
            lat = request.query_params.get('lat')
            lon = request.query_params.get('lon')
            radius_nm = float(request.query_params.get('radius_nm', 200))

            if lat and lon:
                lat = float(lat)
                lon = float(lon)
                lat_delta = radius_nm / 60
                lon_delta = radius_nm / 60
                bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
            else:
                bbox = "24,-130,50,-60"  # CONUS

            metars = weather_cache.fetch_and_cache_metars(bbox=bbox, hours=hours)

        return Response({
            'data': metars,
            'count': len(metars),
            'source': 'aviationweather.gov',
            'cached': True,
        })

    @extend_schema(
        summary="Get TAF data",
        description="Get TAF forecasts for airports",
        parameters=[
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius in nm'),
        ],
        responses={200: AviationDataSerializer}
    )
    @action(detail=False, methods=['get'])
    def tafs(self, request):
        """Get TAF forecast data."""
        from skyspy.services import weather_cache

        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 200))

        if lat and lon:
            lat = float(lat)
            lon = float(lon)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60
            bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
        else:
            bbox = "24,-130,50,-60"  # CONUS

        tafs = weather_cache.fetch_and_cache_tafs(bbox=bbox)

        return Response({
            'data': tafs,
            'count': len(tafs),
            'source': 'aviationweather.gov',
            'cached': True,
        })

    @extend_schema(
        summary="Get PIREP data",
        description="Get pilot reports (PIREPs)",
        parameters=[
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius in nm'),
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
        ],
        responses={200: CachedPirepSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def pireps(self, request):
        """Get PIREP data with optional spatial filtering."""
        from math import cos, pi

        hours = int(request.query_params.get('hours', 6))
        lat_str = request.query_params.get('lat')
        lon_str = request.query_params.get('lon')
        radius_str = request.query_params.get('radius', request.query_params.get('radius_nm', '500'))

        # Build cache key from query params
        cache_key = f"pireps:{hours}:{lat_str}:{lon_str}:{radius_str}"
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return Response(cached_data)

        cutoff = timezone.now() - timedelta(hours=hours)

        query = CachedPirep.objects.filter(
            observation_time__gte=cutoff
        )

        # Add spatial filtering if lat/lon/radius provided
        if lat_str and lon_str:
            try:
                lat = float(lat_str)
                lon = float(lon_str)
                radius = float(radius_str) if radius_str else 500

                # Convert nautical miles to degrees (1 nm ≈ 1/60 degree)
                lat_delta = radius / 60.0
                # Adjust longitude delta for latitude (longitude degrees get smaller toward poles)
                lon_delta = radius / (60.0 * max(cos(lat * pi / 180), 0.1))

                query = query.filter(
                    latitude__gte=lat - lat_delta,
                    latitude__lte=lat + lat_delta,
                    longitude__gte=lon - lon_delta,
                    longitude__lte=lon + lon_delta,
                )
            except (ValueError, TypeError):
                # Invalid coordinates - skip spatial filtering
                pass

        pireps = query.order_by('-observation_time')[:100]

        response_data = {
            'data': CachedPirepSerializer(pireps, many=True).data,
            'count': pireps.count(),
            'source': 'aviationweather.gov',
            'cached': True,
        }

        # Cache for 2 minutes (PIREPs refresh every 10 minutes)
        cache.set(cache_key, response_data, timeout=120)

        return Response(response_data)

    @extend_schema(
        summary="Get SIGMET data",
        description="Get active SIGMETs and AIRMETs",
        responses={200: AirspaceAdvisorySerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def sigmets(self, request):
        """Get SIGMET/AIRMET data."""
        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(
            valid_from__lte=now,
            valid_to__gte=now
        ).order_by('-fetched_at')

        return Response({
            'data': AirspaceAdvisorySerializer(advisories, many=True).data,
            'count': advisories.count(),
            'source': 'aviationweather.gov',
            'cached': True,
        })

    @extend_schema(
        summary="Get active airspace advisories",
        responses={200: AirspaceAdvisorySerializer(many=True)}
    )
    @action(detail=False, methods=['get'], url_path='airspace/advisories')
    def airspace_advisories(self, request):
        """Get active airspace advisories."""
        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(
            valid_from__lte=now,
            valid_to__gte=now
        )

        hazard = request.query_params.get('hazard')
        if hazard:
            advisories = advisories.filter(hazard=hazard)

        return Response({
            'advisories': AirspaceAdvisorySerializer(advisories, many=True).data,
            'count': advisories.count(),
        })

    @extend_schema(
        summary="Get airspace boundaries",
        parameters=[
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius'),
            OpenApiParameter(name='airspace_class', type=str, description='Filter by class'),
        ],
        responses={200: AirspaceBoundarySerializer(many=True)}
    )
    @action(detail=False, methods=['get'], url_path='airspace/boundaries')
    def airspace_boundaries(self, request):
        """Get airspace boundaries."""
        queryset = AirspaceBoundary.objects.all()

        airspace_class = request.query_params.get('airspace_class')
        if airspace_class:
            queryset = queryset.filter(airspace_class=airspace_class)

        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 100))

        if lat and lon:
            lat = float(lat)
            lon = float(lon)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60

            queryset = queryset.filter(
                center_lat__gte=lat - lat_delta,
                center_lat__lte=lat + lat_delta,
                center_lon__gte=lon - lon_delta,
                center_lon__lte=lon + lon_delta,
            )

        boundaries = queryset[:200]

        return Response({
            'boundaries': AirspaceBoundarySerializer(boundaries, many=True).data,
            'count': boundaries.count(),
        })

    @extend_schema(
        summary="Get airports",
        parameters=[
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius'),
            OpenApiParameter(name='type', type=str, description='Airport type filter'),
        ],
        responses={200: CachedAirportSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def airports(self, request):
        """Get airport data."""
        airport_type = request.query_params.get('type')
        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 100))
        limit = int(request.query_params.get('limit', 500))

        # Build cache key from query params (round lat/lon for better cache hits)
        lat_rounded = round(float(lat), 2) if lat else None
        lon_rounded = round(float(lon), 2) if lon else None
        radius_rounded = round(radius_nm, 0)
        cache_key = f"airports:{lat_rounded}:{lon_rounded}:{radius_rounded}:{airport_type}:{limit}"

        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return Response(cached_data)

        queryset = CachedAirport.objects.all()

        if airport_type:
            queryset = queryset.filter(airport_type=airport_type)

        if lat and lon:
            lat = float(lat)
            lon = float(lon)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60

            queryset = queryset.filter(
                latitude__gte=lat - lat_delta,
                latitude__lte=lat + lat_delta,
                longitude__gte=lon - lon_delta,
                longitude__lte=lon + lon_delta,
            )

        airports = queryset[:limit]

        response_data = {
            'airports': CachedAirportSerializer(airports, many=True).data,
            'count': airports.count(),
        }

        # Cache for 5 minutes (airport data rarely changes)
        cache.set(cache_key, response_data, timeout=300)

        return Response(response_data)

    @extend_schema(
        summary="Get navaids",
        parameters=[
            OpenApiParameter(name='lat', type=float, description='Center latitude'),
            OpenApiParameter(name='lon', type=float, description='Center longitude'),
            OpenApiParameter(name='radius_nm', type=float, description='Search radius'),
            OpenApiParameter(name='type', type=str, description='Navaid type filter'),
        ],
        responses={200: CachedNavaidSerializer(many=True)}
    )
    @action(detail=False, methods=['get'])
    def navaids(self, request):
        """Get navaid data."""
        queryset = CachedNavaid.objects.all()

        navaid_type = request.query_params.get('type')
        if navaid_type:
            queryset = queryset.filter(navaid_type=navaid_type)

        lat = request.query_params.get('lat')
        lon = request.query_params.get('lon')
        radius_nm = float(request.query_params.get('radius_nm', 100))

        if lat and lon:
            lat = float(lat)
            lon = float(lon)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60

            queryset = queryset.filter(
                latitude__gte=lat - lat_delta,
                latitude__lte=lat + lat_delta,
                longitude__gte=lon - lon_delta,
                longitude__lte=lon + lon_delta,
            )

        navaids = queryset[:500]

        return Response({
            'navaids': CachedNavaidSerializer(navaids, many=True).data,
            'count': navaids.count(),
        })
