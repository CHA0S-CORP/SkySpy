"""
History API views for sightings, sessions, and analytics.

Includes RPi optimizations:
- MAX_HISTORY_HOURS: Limits time range for queries (default: 72 hours)
- MAX_QUERY_RESULTS: Hard cap on result sets (default: 10000)
"""
import logging
from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import Count, Avg, Max, Min, F, Q, Case, When, Value, CharField
from django.db.models.functions import TruncHour, Floor, ExtractHour
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AircraftSighting, AircraftSession, SafetyEvent
from skyspy.serializers.history import (
    SightingSerializer,
    SessionSerializer,
    HistoryStatsSerializer,
    TrendsSerializer,
    TopPerformersSerializer,
)

logger = logging.getLogger(__name__)

# =============================================================================
# Query Limits (RPi Optimization)
# =============================================================================
# These can be overridden in settings_rpi.py
MAX_HISTORY_HOURS = getattr(settings, 'MAX_HISTORY_HOURS', 168)  # 7 days default
MAX_QUERY_RESULTS = getattr(settings, 'MAX_QUERY_RESULTS', 10000)


class SightingViewSet(viewsets.ModelViewSet):
    """ViewSet for aircraft sightings."""

    queryset = AircraftSighting.objects.all()
    serializer_class = SightingSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['icao_hex', 'callsign', 'is_military']
    http_method_names = ['get']

    def get_queryset(self):
        """Apply query filters with limits for RPi optimization."""
        queryset = super().get_queryset()

        # Time range filter with hard limit
        hours = self.request.query_params.get('hours', 24)
        try:
            hours = int(hours)
        except ValueError:
            hours = 24

        # Enforce maximum history hours (RPi optimization)
        hours = min(hours, MAX_HISTORY_HOURS)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = queryset.filter(timestamp__gte=cutoff)

        # ICAO filter
        icao = self.request.query_params.get('icao')
        if icao:
            queryset = queryset.filter(icao_hex__iexact=icao)

        # Callsign filter
        callsign = self.request.query_params.get('callsign')
        if callsign:
            queryset = queryset.filter(callsign__icontains=callsign)

        # Military only filter
        military_only = self.request.query_params.get('military_only', 'false')
        if military_only.lower() == 'true':
            queryset = queryset.filter(is_military=True)

        # Altitude range filters
        min_altitude = self.request.query_params.get('min_altitude')
        if min_altitude:
            try:
                queryset = queryset.filter(altitude_baro__gte=int(min_altitude))
            except ValueError:
                logger.debug(f"Invalid min_altitude parameter: {min_altitude}")

        max_altitude = self.request.query_params.get('max_altitude')
        if max_altitude:
            try:
                queryset = queryset.filter(altitude_baro__lte=int(max_altitude))
            except ValueError:
                logger.debug(f"Invalid max_altitude parameter: {max_altitude}")

        # Distance range filters
        min_distance = self.request.query_params.get('min_distance')
        if min_distance:
            try:
                queryset = queryset.filter(distance_nm__gte=float(min_distance))
            except ValueError:
                logger.debug(f"Invalid min_distance parameter: {min_distance}")

        max_distance = self.request.query_params.get('max_distance')
        if max_distance:
            try:
                queryset = queryset.filter(distance_nm__lte=float(max_distance))
            except ValueError:
                logger.debug(f"Invalid max_distance parameter: {max_distance}")

        # Aircraft type filter
        aircraft_type = self.request.query_params.get('aircraft_type')
        if aircraft_type:
            types = [t.strip().upper() for t in aircraft_type.split(',')]
            queryset = queryset.filter(aircraft_type__in=types)

        return queryset.order_by('-timestamp')

    @extend_schema(
        summary="List sightings",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='icao', type=str, description='ICAO hex filter'),
            OpenApiParameter(name='callsign', type=str, description='Callsign filter'),
            OpenApiParameter(name='military_only', type=bool, description='Military aircraft only'),
            OpenApiParameter(name='min_altitude', type=int, description='Minimum altitude (ft)'),
            OpenApiParameter(name='max_altitude', type=int, description='Maximum altitude (ft)'),
            OpenApiParameter(name='min_distance', type=float, description='Minimum distance (nm)'),
            OpenApiParameter(name='max_distance', type=float, description='Maximum distance (nm)'),
            OpenApiParameter(name='aircraft_type', type=str, description='Aircraft type (comma-separated)'),
            OpenApiParameter(name='limit', type=int, description='Maximum results to return'),
        ]
    )
    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        # Apply limit if specified (overrides pagination)
        limit = request.query_params.get('limit')
        if limit:
            try:
                # Enforce maximum result limit (RPi optimization)
                limit = min(int(limit), MAX_QUERY_RESULTS)
                queryset = queryset[:limit]
                serializer = self.get_serializer(queryset, many=True)
                return Response({
                    'results': serializer.data,
                    'count': len(serializer.data),
                    'limited': len(serializer.data) >= MAX_QUERY_RESULTS
                })
            except ValueError:
                logger.debug(f"Invalid limit parameter: {limit}, using pagination instead")

        # Enforce hard limit on total results (RPi optimization)
        total_count = queryset.count()
        if total_count > MAX_QUERY_RESULTS:
            queryset = queryset[:MAX_QUERY_RESULTS]
            logger.debug(f"Query results limited from {total_count} to {MAX_QUERY_RESULTS}")

        # Use pagination
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'results': serializer.data,
            'count': len(serializer.data),
            'limited': total_count > MAX_QUERY_RESULTS
        })


class SessionViewSet(viewsets.ModelViewSet):
    """ViewSet for aircraft tracking sessions."""

    queryset = AircraftSession.objects.all()
    serializer_class = SessionSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['icao_hex', 'callsign', 'is_military']
    http_method_names = ['get']

    def get_queryset(self):
        """Apply query filters with limits for RPi optimization."""
        queryset = super().get_queryset()

        # Time range filter with hard limit
        hours = self.request.query_params.get('hours', 24)
        try:
            hours = int(hours)
        except ValueError:
            hours = 24

        # Enforce maximum history hours (RPi optimization)
        hours = min(hours, MAX_HISTORY_HOURS)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = queryset.filter(last_seen__gte=cutoff)

        # Military only filter
        military_only = self.request.query_params.get('military_only', 'false')
        if military_only.lower() == 'true':
            queryset = queryset.filter(is_military=True)

        return queryset.order_by('-last_seen')

    @extend_schema(
        summary="List sessions",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='military_only', type=bool, description='Military only'),
        ]
    )
    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'results': serializer.data,
            'count': queryset.count()
        })


class HistoryViewSet(viewsets.ViewSet):
    """ViewSet for history statistics and analytics."""

    @extend_schema(
        summary="Get history statistics",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
        ],
        responses={200: HistoryStatsSerializer}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get historical statistics."""
        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        cutoff = timezone.now() - timedelta(hours=hours)

        # Get sighting stats
        sighting_stats = AircraftSighting.objects.filter(
            timestamp__gte=cutoff
        ).aggregate(
            total=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            avg_altitude=Avg('altitude_baro'),
            max_altitude=Max('altitude_baro'),
            min_altitude=Min('altitude_baro'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            avg_speed=Avg('ground_speed'),
            max_speed=Max('ground_speed'),
        )

        # Get session stats
        session_stats = AircraftSession.objects.filter(
            last_seen__gte=cutoff
        ).aggregate(
            total=Count('id'),
            military=Count('id', filter=Q(is_military=True)),
        )

        return Response({
            'total_sightings': sighting_stats['total'] or 0,
            'total_sessions': session_stats['total'] or 0,
            'unique_aircraft': sighting_stats['unique_aircraft'] or 0,
            'military_sessions': session_stats['military'] or 0,
            'time_range_hours': hours,
            'avg_altitude': int(sighting_stats['avg_altitude'] or 0),
            'max_altitude': sighting_stats['max_altitude'],
            'min_altitude': sighting_stats['min_altitude'],
            'avg_distance_nm': round(sighting_stats['avg_distance'] or 0, 1),
            'max_distance_nm': round(sighting_stats['max_distance'] or 0, 1),
            'avg_speed': int(sighting_stats['avg_speed'] or 0),
            'max_speed': sighting_stats['max_speed'],
        })

    @extend_schema(
        summary="Get activity trends",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='interval', type=str, description='Interval: 15min, hour, day'),
        ],
        responses={200: TrendsSerializer}
    )
    @action(detail=False, methods=['get'])
    def trends(self, request):
        """Get time-based activity trends."""
        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        interval = request.query_params.get('interval', 'hour')
        cutoff = timezone.now() - timedelta(hours=hours)

        # Group by hour
        hourly = AircraftSighting.objects.filter(
            timestamp__gte=cutoff
        ).annotate(
            hour=TruncHour('timestamp')
        ).values('hour').annotate(
            position_count=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            military_count=Count('id', filter=F('is_military')),
            avg_altitude=Avg('altitude_baro'),
            max_altitude=Max('altitude_baro'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            avg_speed=Avg('ground_speed'),
            max_speed=Max('ground_speed'),
        ).order_by('hour')

        intervals = []
        for h in hourly:
            intervals.append({
                'timestamp': h['hour'].isoformat() if h['hour'] else None,
                'position_count': h['position_count'],
                'unique_aircraft': h['unique_aircraft'],
                'military_count': h['military_count'],
                'avg_altitude': int(h['avg_altitude'] or 0),
                'max_altitude': h['max_altitude'],
                'avg_distance_nm': round(h['avg_distance'] or 0, 1),
                'max_distance_nm': round(h['max_distance'] or 0, 1),
                'avg_speed': int(h['avg_speed'] or 0),
                'max_speed': h['max_speed'],
            })

        # Calculate summary
        total_unique = AircraftSighting.objects.filter(
            timestamp__gte=cutoff
        ).values('icao_hex').distinct().count()

        peak_interval = max(intervals, key=lambda x: x['unique_aircraft']) if intervals else None

        return Response({
            'intervals': intervals,
            'interval_type': interval,
            'time_range_hours': hours,
            'summary': {
                'total_unique_aircraft': total_unique,
                'peak_concurrent': peak_interval['unique_aircraft'] if peak_interval else 0,
                'peak_interval': peak_interval['timestamp'] if peak_interval else None,
                'total_intervals': len(intervals),
            }
        })

    @extend_schema(
        summary="Get top performers",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='limit', type=int, description='Results per category'),
        ],
        responses={200: TopPerformersSerializer}
    )
    @action(detail=False, methods=['get'], url_path='top-performers')
    def top_performers(self, request):
        """Get top performing sessions by various metrics."""
        from skyspy.models import AircraftInfo

        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        try:
            limit = int(request.query_params.get('limit', 10))
        except (ValueError, TypeError):
            limit = 10
        include_info = request.query_params.get('include_info', 'true').lower() == 'true'
        cutoff = timezone.now() - timedelta(hours=hours)

        sessions = AircraftSession.objects.filter(last_seen__gte=cutoff)

        # Pre-fetch aircraft info for enrichment
        aircraft_info_cache = {}
        if include_info:
            # Get all ICAOs we'll need
            all_icaos = set()
            for qs in [
                sessions.order_by('-total_positions')[:limit],
                sessions.filter(max_distance_nm__isnull=False).order_by('-max_distance_nm')[:limit],
                sessions.filter(max_altitude__isnull=False).order_by('-max_altitude')[:limit],
                sessions.filter(min_distance_nm__isnull=False).order_by('min_distance_nm')[:limit],
            ]:
                for s in qs:
                    all_icaos.add(s.icao_hex)

            # Batch fetch aircraft info
            infos = AircraftInfo.objects.filter(icao_hex__in=all_icaos)
            for info in infos:
                aircraft_info_cache[info.icao_hex] = {
                    'registration': info.registration,
                    'manufacturer': info.manufacturer,
                    'model': info.model,
                    'operator': info.operator,
                    'country': info.country,
                    'photo_url': info.photo_url,
                    'photo_thumbnail_url': info.photo_thumbnail_url,
                }

        def serialize_session(s):
            duration = (s.last_seen - s.first_seen).total_seconds() / 60
            result = {
                'icao_hex': s.icao_hex,
                'callsign': s.callsign,
                'aircraft_type': s.aircraft_type,
                'is_military': s.is_military,
                'first_seen': s.first_seen.isoformat(),
                'last_seen': s.last_seen.isoformat(),
                'duration_min': round(duration, 1),
                'positions': s.total_positions,
                'min_distance_nm': s.min_distance_nm,
                'max_distance_nm': s.max_distance_nm,
                'min_altitude': s.min_altitude,
                'max_altitude': s.max_altitude,
            }

            # Add aircraft info if available
            if include_info and s.icao_hex in aircraft_info_cache:
                result['aircraft_info'] = aircraft_info_cache[s.icao_hex]

            return result

        # Longest tracked (by position count as proxy for duration)
        longest = sessions.order_by('-total_positions')[:limit]

        # Furthest distance
        furthest = sessions.filter(
            max_distance_nm__isnull=False
        ).order_by('-max_distance_nm')[:limit]

        # Highest altitude
        highest = sessions.filter(
            max_altitude__isnull=False
        ).order_by('-max_altitude')[:limit]

        # Most positions
        most_positions = sessions.order_by('-total_positions')[:limit]

        # Closest approach
        closest = sessions.filter(
            min_distance_nm__isnull=False
        ).order_by('min_distance_nm')[:limit]

        # Fastest (by max speed if tracked in session, otherwise skip)
        fastest = []
        try:
            fastest_qs = sessions.filter(
                max_ground_speed__isnull=False
            ).order_by('-max_ground_speed')[:limit]
            fastest = [serialize_session(s) for s in fastest_qs]
        except Exception as e:
            # Field may not exist in older schema versions
            logger.debug(f"max_ground_speed field not available: {e}")

        return Response({
            'longest_tracked': [serialize_session(s) for s in longest],
            'furthest_distance': [serialize_session(s) for s in furthest],
            'highest_altitude': [serialize_session(s) for s in highest],
            'most_positions': [serialize_session(s) for s in most_positions],
            'closest_approach': [serialize_session(s) for s in closest],
            'fastest': fastest,
            'time_range_hours': hours,
            'limit': limit,
        })

    # ==========================================================================
    # Analytics Endpoints
    # ==========================================================================

    @extend_schema(
        summary="Get distance analytics",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='military_only', type=bool, description='Military only'),
            OpenApiParameter(name='aircraft_type', type=str, description='Filter by aircraft type'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='analytics/distance')
    def analytics_distance(self, request):
        """Get detailed distance statistics and distribution."""
        import statistics as stats_lib
        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        military_only = request.query_params.get('military_only', 'false').lower() == 'true'
        aircraft_type = request.query_params.get('aircraft_type')
        cutoff = timezone.now() - timedelta(hours=hours)

        # Build queryset
        sessions = AircraftSession.objects.filter(
            last_seen__gte=cutoff,
            max_distance_nm__isnull=False
        )
        if military_only:
            sessions = sessions.filter(is_military=True)
        if aircraft_type:
            types = [t.strip().upper() for t in aircraft_type.split(',')]
            sessions = sessions.filter(aircraft_type__in=types)

        # Get all distances
        distances = list(sessions.values_list('max_distance_nm', flat=True))
        type_data = list(sessions.values('aircraft_type', 'max_distance_nm'))

        # Calculate distribution buckets
        distribution = {
            '0-25nm': sum(1 for d in distances if d < 25),
            '25-50nm': sum(1 for d in distances if 25 <= d < 50),
            '50-100nm': sum(1 for d in distances if 50 <= d < 100),
            '100-150nm': sum(1 for d in distances if 100 <= d < 150),
            '150-200nm': sum(1 for d in distances if 150 <= d < 200),
            '200+nm': sum(1 for d in distances if d >= 200),
        }

        # Calculate statistics
        statistics = {}
        if distances:
            sorted_distances = sorted(distances)
            n = len(sorted_distances)
            statistics = {
                'count': n,
                'mean_nm': round(stats_lib.mean(distances), 1),
                'median_nm': round(stats_lib.median(distances), 1),
                'std_dev_nm': round(stats_lib.stdev(distances), 1) if n > 1 else 0,
                'min_nm': round(min(distances), 1),
                'max_nm': round(max(distances), 1),
                'percentile_25': round(sorted_distances[n // 4], 1),
                'percentile_75': round(sorted_distances[3 * n // 4], 1),
                'percentile_90': round(sorted_distances[int(n * 0.9)], 1),
                'percentile_95': round(sorted_distances[int(n * 0.95)], 1),
            }

        # Group by aircraft type
        type_distances = {}
        for row in type_data:
            ac_type = row['aircraft_type'] or 'Unknown'
            if ac_type not in type_distances:
                type_distances[ac_type] = []
            type_distances[ac_type].append(row['max_distance_nm'])

        by_type = []
        for ac_type, dists in sorted(type_distances.items(), key=lambda x: max(x[1]) if x[1] else 0, reverse=True)[:10]:
            if dists:
                by_type.append({
                    'type': ac_type,
                    'count': len(dists),
                    'mean_nm': round(stats_lib.mean(dists), 1),
                    'max_nm': round(max(dists), 1),
                })

        return Response({
            'distribution': distribution,
            'statistics': statistics,
            'by_type': by_type,
            'time_range_hours': hours,
        })

    @extend_schema(
        summary="Get speed analytics",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='military_only', type=bool, description='Military only'),
            OpenApiParameter(name='min_altitude', type=int, description='Minimum altitude filter'),
            OpenApiParameter(name='aircraft_type', type=str, description='Filter by aircraft type'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='analytics/speed')
    def analytics_speed(self, request):
        """Get detailed speed statistics and distribution."""
        import statistics as stats_lib
        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        military_only = request.query_params.get('military_only', 'false').lower() == 'true'
        min_altitude = request.query_params.get('min_altitude')
        cutoff = timezone.now() - timedelta(hours=hours)

        # Build queryset for sightings (more granular speed data)
        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            ground_speed__isnull=False,
            ground_speed__gt=0
        )
        if military_only:
            sightings = sightings.filter(is_military=True)
        if min_altitude:
            sightings = sightings.filter(altitude_baro__gte=int(min_altitude))

        # Get max speed per aircraft
        speed_data = sightings.values('icao_hex', 'callsign').annotate(
            max_speed=Max('ground_speed'),
            avg_speed=Avg('ground_speed'),
            sample_count=Count('id')
        )

        all_speeds = []
        aircraft_speeds = []
        for row in speed_data:
            if row['max_speed']:
                all_speeds.append(row['max_speed'])
                aircraft_speeds.append({
                    'icao_hex': row['icao_hex'],
                    'callsign': row['callsign'],
                    'max_speed': round(row['max_speed']),
                    'avg_speed': round(row['avg_speed']) if row['avg_speed'] else None,
                    'samples': row['sample_count']
                })

        # Calculate distribution buckets
        distribution = {
            '0-100kt': sum(1 for s in all_speeds if s < 100),
            '100-200kt': sum(1 for s in all_speeds if 100 <= s < 200),
            '200-300kt': sum(1 for s in all_speeds if 200 <= s < 300),
            '300-400kt': sum(1 for s in all_speeds if 300 <= s < 400),
            '400-500kt': sum(1 for s in all_speeds if 400 <= s < 500),
            '500+kt': sum(1 for s in all_speeds if s >= 500),
        }

        # Calculate statistics
        statistics = {}
        if all_speeds:
            sorted_speeds = sorted(all_speeds)
            statistics = {
                'count': len(all_speeds),
                'mean_kt': round(stats_lib.mean(all_speeds)),
                'median_kt': round(stats_lib.median(all_speeds)),
                'max_kt': round(max(all_speeds)),
                'percentile_90': round(sorted_speeds[int(len(sorted_speeds) * 0.9)]),
            }

        # Fastest sessions
        fastest_sessions = sorted(aircraft_speeds, key=lambda x: x['max_speed'], reverse=True)[:10]

        # By aircraft type
        type_data = sightings.filter(
            aircraft_type__isnull=False
        ).values('aircraft_type').annotate(
            avg_max_speed=Avg('ground_speed'),
            peak_speed=Max('ground_speed'),
            count=Count('id')
        ).order_by('-peak_speed')[:15]

        by_type = [{
            'type': row['aircraft_type'],
            'avg_max_speed': round(row['avg_max_speed']) if row['avg_max_speed'] else None,
            'peak_speed': round(row['peak_speed']) if row['peak_speed'] else None,
            'count': row['count']
        } for row in type_data]

        return Response({
            'distribution': distribution,
            'statistics': statistics,
            'fastest_sessions': fastest_sessions,
            'by_type': by_type,
            'time_range_hours': hours,
        })

    @extend_schema(
        summary="Get correlation analytics",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='military_only', type=bool, description='Military only'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='analytics/correlation')
    def analytics_correlation(self, request):
        """Get correlation and pattern analytics."""
        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        military_only = request.query_params.get('military_only', 'false').lower() == 'true'
        cutoff = timezone.now() - timedelta(hours=hours)

        # Build queryset
        sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff)
        if military_only:
            sightings = sightings.filter(is_military=True)

        # Altitude vs Speed correlation
        altitude_bands = sightings.filter(
            altitude_baro__isnull=False,
            ground_speed__isnull=False
        ).annotate(
            altitude_band=Case(
                When(altitude_baro__lt=10000, then=Value('0-10k')),
                When(altitude_baro__lt=20000, then=Value('10-20k')),
                When(altitude_baro__lt=30000, then=Value('20-30k')),
                When(altitude_baro__lt=40000, then=Value('30-40k')),
                default=Value('40k+'),
                output_field=CharField()
            )
        ).values('altitude_band').annotate(
            avg_speed=Avg('ground_speed'),
            sample_count=Count('id')
        ).order_by('altitude_band')

        altitude_vs_speed = [{
            'altitude_band': row['altitude_band'],
            'avg_speed': round(row['avg_speed']) if row['avg_speed'] else None,
            'sample_count': row['sample_count']
        } for row in altitude_bands]

        # Time of day patterns (hourly)
        hourly_data = sightings.annotate(
            hour=ExtractHour('timestamp')
        ).values('hour').annotate(
            unique_aircraft=Count('icao_hex', distinct=True),
            position_count=Count('id'),
            military_count=Count('id', filter=Q(is_military=True))
        ).order_by('hour')

        hourly_counts = []
        peak_hour = None
        peak_count = 0
        for row in hourly_data:
            count = row['unique_aircraft'] or 0
            if count > peak_count:
                peak_count = count
                peak_hour = row['hour']

            hourly_counts.append({
                'hour': row['hour'],
                'unique_aircraft': count,
                'position_count': row['position_count'] or 0,
                'military_count': row['military_count'] or 0,
                'military_pct': round((row['military_count'] or 0) / count * 100, 1) if count > 0 else 0
            })

        # Distance vs Altitude correlation
        distance_bands = sightings.filter(
            distance_nm__isnull=False,
            altitude_baro__isnull=False
        ).annotate(
            distance_band=Case(
                When(distance_nm__lt=25, then=Value('0-25nm')),
                When(distance_nm__lt=50, then=Value('25-50nm')),
                When(distance_nm__lt=100, then=Value('50-100nm')),
                default=Value('100+nm'),
                output_field=CharField()
            )
        ).values('distance_band').annotate(
            avg_altitude=Avg('altitude_baro'),
            sample_count=Count('id')
        )

        distance_vs_altitude = [{
            'distance_band': row['distance_band'],
            'avg_altitude': round(row['avg_altitude']) if row['avg_altitude'] else None,
            'sample_count': row['sample_count']
        } for row in distance_bands]

        return Response({
            'altitude_vs_speed': altitude_vs_speed,
            'distance_vs_altitude': distance_vs_altitude,
            'time_of_day_patterns': {
                'hourly_counts': hourly_counts,
                'peak_hour': peak_hour,
                'peak_aircraft_count': peak_count
            },
            'time_range_hours': hours,
        })

    @extend_schema(
        summary="Get antenna polar coverage data",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='min_distance', type=float, description='Minimum distance filter (nm)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='analytics/antenna/polar')
    def analytics_antenna_polar(self, request):
        """Get antenna polar coverage data for polar diagram visualization."""
        from django.db.models.functions import Floor

        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        min_distance = request.query_params.get('min_distance')
        cutoff = timezone.now() - timedelta(hours=hours)

        # Build queryset
        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            track__isnull=False,
            distance_nm__isnull=False
        )
        if min_distance:
            sightings = sightings.filter(distance_nm__gte=float(min_distance))

        # Group by bearing sector (10 degree increments)
        bearing_data_raw = sightings.annotate(
            bearing_sector=Floor(F('track') / 10) * 10
        ).values('bearing_sector').annotate(
            count=Count('id'),
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            unique_aircraft=Count('icao_hex', distinct=True)
        ).order_by('bearing_sector')

        bearing_data = []
        total_count = 0
        sectors_with_data = 0
        existing_sectors = set()

        for row in bearing_data_raw:
            sector = int(row['bearing_sector']) if row['bearing_sector'] is not None else 0
            count = row['count'] or 0
            total_count += count
            if count > 0:
                sectors_with_data += 1
            existing_sectors.add(sector)

            bearing_data.append({
                'bearing_start': sector,
                'bearing_end': (sector + 10) % 360,
                'count': count,
                'avg_rssi': round(row['avg_rssi'], 1) if row['avg_rssi'] else None,
                'min_rssi': round(row['min_rssi'], 1) if row['min_rssi'] else None,
                'max_rssi': round(row['max_rssi'], 1) if row['max_rssi'] else None,
                'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
                'max_distance_nm': round(row['max_distance'], 1) if row['max_distance'] else None,
                'unique_aircraft': row['unique_aircraft'] or 0,
            })

        # Fill in missing sectors with zero data
        for sector in range(0, 360, 10):
            if sector not in existing_sectors:
                bearing_data.append({
                    'bearing_start': sector,
                    'bearing_end': (sector + 10) % 360,
                    'count': 0,
                    'avg_rssi': None,
                    'min_rssi': None,
                    'max_rssi': None,
                    'avg_distance_nm': None,
                    'max_distance_nm': None,
                    'unique_aircraft': 0,
                })

        # Sort by bearing
        bearing_data.sort(key=lambda x: x['bearing_start'])

        return Response({
            'bearing_data': bearing_data,
            'summary': {
                'total_sightings': total_count,
                'sectors_with_data': sectors_with_data,
                'coverage_pct': round((sectors_with_data / 36) * 100, 1),
            },
            'time_range_hours': hours,
        })

    @extend_schema(
        summary="Get RSSI vs distance data",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='sample_size', type=int, description='Max scatter points'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='analytics/antenna/rssi')
    def analytics_antenna_rssi(self, request):
        """Get RSSI vs distance correlation data for scatter plot visualization."""
        import statistics as stats_lib

        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        try:
            sample_size = int(request.query_params.get('sample_size', 500))
        except (ValueError, TypeError):
            sample_size = 500
        cutoff = timezone.now() - timedelta(hours=hours)

        # Build queryset
        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            rssi__isnull=False,
            distance_nm__isnull=False,
            distance_nm__gt=0
        )

        # Get sampled scatter data points - use deterministic ordering to avoid full table scan
        scatter_data = list(sightings.order_by('-timestamp').values(
            'distance_nm', 'rssi', 'altitude_baro', 'icao_hex'
        )[:sample_size])

        scatter_result = [{
            'distance_nm': round(row['distance_nm'], 1),
            'rssi': round(row['rssi'], 1),
            'altitude': row['altitude_baro'],
            'icao': row['icao_hex'],
        } for row in scatter_data]

        # Get band statistics
        band_data = sightings.annotate(
            distance_band=Case(
                When(distance_nm__lt=25, then=Value('0-25nm')),
                When(distance_nm__lt=50, then=Value('25-50nm')),
                When(distance_nm__lt=75, then=Value('50-75nm')),
                When(distance_nm__lt=100, then=Value('75-100nm')),
                When(distance_nm__lt=150, then=Value('100-150nm')),
                default=Value('150+nm'),
                output_field=CharField()
            )
        ).values('distance_band').annotate(
            count=Count('id'),
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi'),
            avg_distance=Avg('distance_nm')
        )

        band_order = ['0-25nm', '25-50nm', '50-75nm', '75-100nm', '100-150nm', '150+nm']
        band_statistics = []
        total_count = 0
        all_rssi = []

        for row in band_data:
            count = row['count'] or 0
            total_count += count
            if row['avg_rssi']:
                all_rssi.extend([row['avg_rssi']] * min(count, 100))

            band_statistics.append({
                'band': row['distance_band'],
                'count': count,
                'avg_rssi': round(row['avg_rssi'], 1) if row['avg_rssi'] else None,
                'min_rssi': round(row['min_rssi'], 1) if row['min_rssi'] else None,
                'max_rssi': round(row['max_rssi'], 1) if row['max_rssi'] else None,
                'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
            })

        band_statistics.sort(key=lambda x: band_order.index(x['band']) if x['band'] in band_order else 99)

        # Calculate overall statistics
        overall_stats = {}
        if all_rssi:
            overall_stats = {
                'count': total_count,
                'avg_rssi': round(stats_lib.mean(all_rssi), 1),
                'median_rssi': round(stats_lib.median(all_rssi), 1),
            }

        # Calculate linear regression trend line
        trend_line = None
        if len(scatter_result) > 10:
            distances = [d['distance_nm'] for d in scatter_result]
            rssis = [d['rssi'] for d in scatter_result]
            n = len(distances)
            sum_x = sum(distances)
            sum_y = sum(rssis)
            sum_xy = sum(d * r for d, r in zip(distances, rssis))
            sum_x2 = sum(d ** 2 for d in distances)

            denom = n * sum_x2 - sum_x ** 2
            if denom != 0:
                slope = (n * sum_xy - sum_x * sum_y) / denom
                intercept = (sum_y - slope * sum_x) / n
                trend_line = {
                    'slope': round(slope, 4),
                    'intercept': round(intercept, 2),
                    'interpretation': f"RSSI decreases by {abs(round(slope * 10, 2))} dB per 10nm" if slope < 0 else f"RSSI increases by {round(slope * 10, 2)} dB per 10nm"
                }

        return Response({
            'scatter_data': scatter_result,
            'band_statistics': band_statistics,
            'overall_statistics': overall_stats,
            'trend_line': trend_line,
            'time_range_hours': hours,
            'sample_size': len(scatter_result),
        })

    @extend_schema(
        summary="Get antenna performance summary",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='analytics/antenna/summary')
    def analytics_antenna_summary(self, request):
        """Get antenna performance summary statistics."""
        from django.db.models.functions import Floor

        try:
            hours = int(request.query_params.get('hours', 24))
        except (ValueError, TypeError):
            hours = 24
        cutoff = timezone.now() - timedelta(hours=hours)

        # Build queryset
        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            distance_nm__isnull=False
        )

        # Get range statistics
        range_stats = sightings.aggregate(
            total_sightings=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            min_distance=Min('distance_nm')
        )

        # Get RSSI statistics
        rssi_stats = sightings.filter(rssi__isnull=False).aggregate(
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi')
        )

        # Get coverage by bearing
        coverage_data = sightings.filter(track__isnull=False).annotate(
            sector=Floor(F('track') / 10)
        ).values('sector').distinct().count()

        # Get distance percentiles with bounds check
        total_count = sightings.count()
        sample_limit = min(total_count, 5000)
        if total_count > 5000:
            logger.warning(f"Large query: {total_count} sightings, sampling {sample_limit}")
        distances = list(sightings.values_list('distance_nm', flat=True)[:sample_limit])
        percentiles = {}
        if distances:
            sorted_dist = sorted([d for d in distances if d is not None])
            n = len(sorted_dist)
            if n > 0:
                percentiles = {
                    'p50': round(sorted_dist[n // 2], 1),
                    'p75': round(sorted_dist[int(n * 0.75)], 1),
                    'p90': round(sorted_dist[int(n * 0.90)], 1),
                    'p95': round(sorted_dist[int(n * 0.95)], 1),
                }

        return Response({
            'range': {
                'total_sightings': range_stats['total_sightings'] or 0,
                'unique_aircraft': range_stats['unique_aircraft'] or 0,
                'avg_nm': round(range_stats['avg_distance'], 1) if range_stats['avg_distance'] else None,
                'max_nm': round(range_stats['max_distance'], 1) if range_stats['max_distance'] else None,
                'min_nm': round(range_stats['min_distance'], 1) if range_stats['min_distance'] else None,
                **percentiles,
            },
            'signal': {
                'avg_rssi': round(rssi_stats['avg_rssi'], 1) if rssi_stats['avg_rssi'] else None,
                'best_rssi': round(rssi_stats['max_rssi'], 1) if rssi_stats['max_rssi'] else None,
                'worst_rssi': round(rssi_stats['min_rssi'], 1) if rssi_stats['min_rssi'] else None,
            },
            'coverage': {
                'sectors_active': coverage_data or 0,
                'total_sectors': 36,
                'coverage_pct': round((coverage_data or 0) / 36 * 100, 1),
            },
            'time_range_hours': hours,
        })

    # ==========================================================================
    # Time Comparison Endpoints
    # ==========================================================================

    @extend_schema(
        summary="Get week-over-week comparison",
        description="Compare this week's traffic to last week's traffic",
        responses={200: 'WeekComparisonSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/week')
    def time_comparison_week(self, request):
        """Get week-over-week traffic comparison."""
        from skyspy.services.time_comparison_stats import get_week_comparison
        return Response(get_week_comparison())

    @extend_schema(
        summary="Get seasonal trends",
        description="Monthly aggregates for year-over-year comparison",
        parameters=[
            OpenApiParameter(name='months', type=int, description='Number of months to include'),
        ],
        responses={200: 'SeasonalTrendsSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/seasonal')
    def time_comparison_seasonal(self, request):
        """Get seasonal/monthly trend data."""
        from skyspy.services.time_comparison_stats import (
            get_seasonal_trends,
            calculate_seasonal_trends
        )
        try:
            months = int(request.query_params.get('months', 12))
        except (ValueError, TypeError):
            months = 12
        if months != 12:
            return Response(calculate_seasonal_trends(months))
        return Response(get_seasonal_trends())

    @extend_schema(
        summary="Get day vs night traffic ratio",
        description="Compare daytime (6am-6pm) vs nighttime traffic",
        parameters=[
            OpenApiParameter(name='days', type=int, description='Number of days to analyze'),
        ],
        responses={200: 'DayNightRatioSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/day-night')
    def time_comparison_day_night(self, request):
        """Get day vs night traffic comparison."""
        from skyspy.services.time_comparison_stats import (
            get_day_night_ratio,
            calculate_day_night_ratio
        )
        try:
            days = int(request.query_params.get('days', 30))
        except (ValueError, TypeError):
            days = 30
        if days != 30:
            return Response(calculate_day_night_ratio(days))
        return Response(get_day_night_ratio())

    @extend_schema(
        summary="Get weekend vs weekday patterns",
        description="Compare weekend (Sat-Sun) vs weekday (Mon-Fri) traffic",
        parameters=[
            OpenApiParameter(name='weeks', type=int, description='Number of weeks to analyze'),
        ],
        responses={200: 'WeekendWeekdaySerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/weekend-weekday')
    def time_comparison_weekend_weekday(self, request):
        """Get weekend vs weekday traffic comparison."""
        from skyspy.services.time_comparison_stats import (
            get_weekend_weekday_patterns,
            calculate_weekend_weekday_patterns
        )
        try:
            weeks = int(request.query_params.get('weeks', 4))
        except (ValueError, TypeError):
            weeks = 4
        if weeks != 4:
            return Response(calculate_weekend_weekday_patterns(weeks))
        return Response(get_weekend_weekday_patterns())

    @extend_schema(
        summary="Get daily totals for charts",
        description="Daily totals for the past N days, suitable for time-series charts",
        parameters=[
            OpenApiParameter(name='days', type=int, description='Number of days to include'),
        ],
        responses={200: 'DailyTotalsSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/daily')
    def time_comparison_daily(self, request):
        """Get daily totals trend data."""
        from skyspy.services.time_comparison_stats import get_daily_totals
        try:
            days = int(request.query_params.get('days', 30))
        except (ValueError, TypeError):
            days = 30
        return Response(get_daily_totals(days))

    @extend_schema(
        summary="Get weekly totals for charts",
        description="Weekly totals for the past N weeks, suitable for time-series charts",
        parameters=[
            OpenApiParameter(name='weeks', type=int, description='Number of weeks to include'),
        ],
        responses={200: 'WeeklyTotalsSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/weekly')
    def time_comparison_weekly(self, request):
        """Get weekly totals trend data."""
        from skyspy.services.time_comparison_stats import get_weekly_totals
        try:
            weeks = int(request.query_params.get('weeks', 12))
        except (ValueError, TypeError):
            weeks = 12
        return Response(get_weekly_totals(weeks))

    @extend_schema(
        summary="Get monthly totals for charts",
        description="Monthly totals for the past N months, suitable for time-series charts",
        parameters=[
            OpenApiParameter(name='months', type=int, description='Number of months to include'),
        ],
        responses={200: 'MonthlyTotalsSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison/monthly')
    def time_comparison_monthly(self, request):
        """Get monthly totals trend data."""
        from skyspy.services.time_comparison_stats import get_monthly_totals
        try:
            months = int(request.query_params.get('months', 12))
        except (ValueError, TypeError):
            months = 12
        return Response(get_monthly_totals(months))

    @extend_schema(
        summary="Get all time comparison stats",
        description="Get all time-based comparison statistics in a single request",
        responses={200: 'TimeComparisonStatsSerializer'}
    )
    @action(detail=False, methods=['get'], url_path='time-comparison')
    def time_comparison_all(self, request):
        """Get all time comparison statistics."""
        from skyspy.services.time_comparison_stats import get_all_time_comparison_stats
        return Response(get_all_time_comparison_stats())
