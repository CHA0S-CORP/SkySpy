"""
Stats API views for tracking quality, engagement analytics, and gamification.
"""
import logging
from datetime import timedelta

from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AircraftFavorite, AircraftSession, AircraftInfo
from skyspy.services.stats_cache import (
    get_tracking_quality_stats,
    get_engagement_stats,
    get_coverage_gaps_analysis,
    get_flight_patterns_stats,
    get_geographic_stats,
    calculate_tracking_quality_stats,
    calculate_engagement_stats,
    calculate_flight_patterns_stats,
    calculate_geographic_stats,
)
from skyspy.services.gamification import gamification_service
from skyspy.models.stats import (
    PersonalRecord, RareSighting, SpottedAircraft, SpottedCount,
    SightingStreak, DailyStats, NotableRegistration, NotableCallsign, RareAircraftType,
)
from skyspy.serializers.stats import (
    PersonalRecordSerializer, PersonalRecordsResponseSerializer,
    RareSightingSerializer, RareSightingsResponseSerializer, RareSightingAcknowledgeSerializer,
    SpottedAircraftSerializer, SpottedCountSerializer,
    CollectionStatsResponseSerializer, SpottedByTypeResponseSerializer, SpottedByOperatorResponseSerializer,
    SightingStreakSerializer, StreaksResponseSerializer,
    DailyStatsSerializer, DailyStatsResponseSerializer,
    LifetimeStatsResponseSerializer, GamificationDashboardSerializer,
    NotableRegistrationSerializer, NotableCallsignSerializer, RareAircraftTypeSerializer,
)

logger = logging.getLogger(__name__)


class TrackingQualityViewSet(viewsets.ViewSet):
    """ViewSet for tracking quality statistics."""

    @extend_schema(
        summary="Get tracking quality stats",
        description="""
        Get session tracking quality statistics including:
        - Average position update rate per aircraft (positions per minute)
        - Session completeness scores (% of expected positions received)
        - Quality grade distribution (excellent, good, fair, poor)
        - Top and worst quality sessions
        """,
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours (default: 24)'),
            OpenApiParameter(name='refresh', type=bool, description='Force cache refresh'),
        ]
    )
    def list(self, request):
        """Get tracking quality statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh or hours != 24:
            # Calculate fresh stats for custom time range
            stats = calculate_tracking_quality_stats(hours=hours)
        else:
            # Use cached stats for default 24h
            stats = get_tracking_quality_stats()

        if stats is None:
            return Response({
                "error": "Unable to calculate tracking quality stats"
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response(stats)

    @extend_schema(
        summary="Get coverage gaps analysis",
        description="""
        Analyze coverage gaps in tracking sessions.

        Returns detailed information about periods where aircraft were not
        receiving position updates, including:
        - Gap duration distribution
        - Sessions with worst coverage gaps
        - Average and maximum gap times
        """,
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours (default: 24)'),
            OpenApiParameter(name='limit', type=int, description='Max sessions to analyze (default: 100)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='gaps')
    def coverage_gaps(self, request):
        """Get detailed coverage gaps analysis."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 100))

        try:
            gaps = get_coverage_gaps_analysis(hours=hours)
            return Response(gaps)
        except Exception as e:
            logger.error(f"Error calculating coverage gaps: {e}")
            return Response({
                "error": "Unable to calculate coverage gaps"
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    @extend_schema(
        summary="Get session quality details",
        description="Get quality metrics for a specific aircraft session",
        parameters=[
            OpenApiParameter(name='icao_hex', type=str, description='Aircraft ICAO hex', location='path'),
            OpenApiParameter(name='hours', type=int, description='Time range to search (default: 24)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path=r'session/(?P<icao_hex>[A-Za-z0-9]+)')
    def session_quality(self, request, icao_hex=None):
        """Get quality metrics for a specific aircraft's recent session."""
        from skyspy.models import AircraftSighting
        from skyspy.services.stats_cache import DEFAULT_EXPECTED_UPDATE_INTERVAL, COVERAGE_GAP_THRESHOLD

        hours = int(request.query_params.get('hours', 24))
        cutoff = timezone.now() - timedelta(hours=hours)

        # Get the most recent session for this aircraft
        session = AircraftSession.objects.filter(
            icao_hex__iexact=icao_hex,
            last_seen__gt=cutoff
        ).order_by('-last_seen').first()

        if not session:
            return Response({
                "error": f"No recent session found for {icao_hex}"
            }, status=status.HTTP_404_NOT_FOUND)

        # Get all sightings for this session
        sightings = AircraftSighting.objects.filter(
            icao_hex__iexact=icao_hex,
            timestamp__gte=session.first_seen,
            timestamp__lte=session.last_seen
        ).order_by('timestamp')

        # Calculate metrics
        duration_seconds = (session.last_seen - session.first_seen).total_seconds()
        duration_min = duration_seconds / 60

        update_rate = session.total_positions / duration_min if duration_min > 0 else 0
        expected_positions = duration_seconds / DEFAULT_EXPECTED_UPDATE_INTERVAL
        completeness = min(100, (session.total_positions / expected_positions) * 100) if expected_positions > 0 else 0

        # Analyze gaps
        sighting_times = list(sightings.values_list('timestamp', flat=True))
        gaps = []
        for i in range(1, len(sighting_times)):
            gap_seconds = (sighting_times[i] - sighting_times[i-1]).total_seconds()
            if gap_seconds > COVERAGE_GAP_THRESHOLD:
                gaps.append({
                    'start': sighting_times[i-1].isoformat() + "Z",
                    'end': sighting_times[i].isoformat() + "Z",
                    'duration_seconds': int(gap_seconds),
                })

        total_gap_time = sum(g['duration_seconds'] for g in gaps)
        gap_percentage = (total_gap_time / duration_seconds * 100) if duration_seconds > 0 else 0

        # Determine quality grade
        if completeness >= 90 and update_rate >= 10:
            grade = 'excellent'
        elif completeness >= 70 and update_rate >= 6:
            grade = 'good'
        elif completeness >= 50:
            grade = 'fair'
        else:
            grade = 'poor'

        # RSSI stats
        from django.db.models import Avg, Min, Max
        rssi_stats = sightings.filter(rssi__isnull=False).aggregate(
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi'),
        )

        return Response({
            'icao_hex': session.icao_hex,
            'callsign': session.callsign,
            'session': {
                'first_seen': session.first_seen.isoformat() + "Z",
                'last_seen': session.last_seen.isoformat() + "Z",
                'duration_minutes': round(duration_min, 1),
                'total_positions': session.total_positions,
            },
            'quality': {
                'grade': grade,
                'update_rate_per_min': round(update_rate, 2),
                'expected_positions': int(expected_positions),
                'completeness_pct': round(completeness, 1),
            },
            'gaps': {
                'total_count': len(gaps),
                'total_time_seconds': int(total_gap_time),
                'gap_percentage': round(gap_percentage, 1),
                'max_gap_seconds': max(g['duration_seconds'] for g in gaps) if gaps else 0,
                'gaps': gaps[:10],  # Limit to 10 gaps
            },
            'signal': {
                'avg_rssi': round(rssi_stats['avg_rssi'], 1) if rssi_stats['avg_rssi'] else None,
                'min_rssi': round(rssi_stats['min_rssi'], 1) if rssi_stats['min_rssi'] else None,
                'max_rssi': round(rssi_stats['max_rssi'], 1) if rssi_stats['max_rssi'] else None,
            }
        })


# Need to import models at module level for the aggregate
from django.db import models as django_models


class EngagementViewSet(viewsets.ViewSet):
    """ViewSet for engagement statistics."""

    @extend_schema(
        summary="Get engagement stats",
        description="""
        Get engagement statistics including:
        - Most favorited/watched aircraft
        - Peak concurrent tracking sessions
        - Return visitors (aircraft seen multiple times)
        - Favorite activity statistics
        """,
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours (default: 24)'),
            OpenApiParameter(name='refresh', type=bool, description='Force cache refresh'),
        ]
    )
    def list(self, request):
        """Get engagement statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh or hours != 24:
            stats = calculate_engagement_stats(hours=hours)
        else:
            stats = get_engagement_stats()

        if stats is None:
            return Response({
                "error": "Unable to calculate engagement stats"
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response(stats)

    @extend_schema(
        summary="Get most watched aircraft",
        description="Get the most favorited/watched aircraft with engagement details",
        parameters=[
            OpenApiParameter(name='limit', type=int, description='Number of results (default: 20)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='most-watched')
    def most_watched(self, request):
        """Get most watched aircraft."""
        from django.db.models import Count, Sum

        limit = int(request.query_params.get('limit', 20))

        most_favorited = list(
            AircraftFavorite.objects.values('icao_hex', 'registration')
            .annotate(
                favorite_count=Count('id'),
                total_times_seen=Sum('times_seen'),
                total_tracking_minutes=Sum('total_tracking_minutes'),
            )
            .order_by('-favorite_count')[:limit]
        )

        # Enrich with aircraft info
        icao_hexes = [f['icao_hex'] for f in most_favorited]
        aircraft_infos = {
            info.icao_hex: info
            for info in AircraftInfo.objects.filter(icao_hex__in=icao_hexes)
        }

        result = []
        for fav in most_favorited:
            info = aircraft_infos.get(fav['icao_hex'])
            result.append({
                'icao_hex': fav['icao_hex'],
                'registration': fav['registration'] or (info.registration if info else None),
                'favorite_count': fav['favorite_count'],
                'total_times_seen': fav['total_times_seen'] or 0,
                'total_tracking_minutes': round(fav['total_tracking_minutes'] or 0, 1),
                'aircraft_type': info.type_code if info else None,
                'type_name': info.type_name if info else None,
                'operator': info.operator if info else None,
                'country': info.country if info else None,
                'photo_url': info.photo_thumbnail_url or info.photo_url if info else None,
            })

        return Response({
            'most_watched': result,
            'total_count': len(result),
        })

    @extend_schema(
        summary="Get return visitors",
        description="Get aircraft that have been seen in multiple tracking sessions",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours (default: 24)'),
            OpenApiParameter(name='min_sessions', type=int, description='Minimum sessions (default: 2)'),
            OpenApiParameter(name='limit', type=int, description='Number of results (default: 30)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='return-visitors')
    def return_visitors(self, request):
        """Get aircraft that have returned multiple times."""
        from django.db.models import Count, Sum, Min, Max

        hours = int(request.query_params.get('hours', 24))
        min_sessions = int(request.query_params.get('min_sessions', 2))
        limit = int(request.query_params.get('limit', 30))

        cutoff = timezone.now() - timedelta(hours=hours)

        return_visitors = list(
            AircraftSession.objects.filter(last_seen__gt=cutoff)
            .values('icao_hex')
            .annotate(
                session_count=Count('id'),
                total_positions=Sum('total_positions'),
                first_session=Min('first_seen'),
                last_session=Max('last_seen'),
            )
            .filter(session_count__gte=min_sessions)
            .order_by('-session_count')[:limit]
        )

        # Enrich with aircraft info
        icao_hexes = [rv['icao_hex'] for rv in return_visitors]
        aircraft_infos = {
            info.icao_hex: info
            for info in AircraftInfo.objects.filter(icao_hex__in=icao_hexes)
        }

        result = []
        for rv in return_visitors:
            info = aircraft_infos.get(rv['icao_hex'])
            result.append({
                'icao_hex': rv['icao_hex'],
                'registration': info.registration if info else None,
                'session_count': rv['session_count'],
                'total_positions': rv['total_positions'],
                'first_session': rv['first_session'].isoformat() + "Z" if rv['first_session'] else None,
                'last_session': rv['last_session'].isoformat() + "Z" if rv['last_session'] else None,
                'aircraft_type': info.type_code if info else None,
                'operator': info.operator if info else None,
            })

        # Calculate stats
        total_unique = AircraftSession.objects.filter(
            last_seen__gt=cutoff
        ).values('icao_hex').distinct().count()

        return Response({
            'return_visitors': result,
            'stats': {
                'total_unique_aircraft': total_unique,
                'returning_aircraft': len(return_visitors),
                'return_rate_pct': round(len(return_visitors) / total_unique * 100, 1) if total_unique > 0 else 0,
            },
            'time_range_hours': hours,
        })

    @extend_schema(
        summary="Get peak tracking periods",
        description="Get periods with the most concurrent aircraft being tracked",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours (default: 24)'),
            OpenApiParameter(name='limit', type=int, description='Number of peak periods to return (default: 10)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='peak-tracking')
    def peak_tracking(self, request):
        """Get peak concurrent tracking periods."""
        from django.db.models import Count
        from django.db.models.functions import TruncHour
        from skyspy.models import AircraftSighting

        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 10))

        cutoff = timezone.now() - timedelta(hours=hours)

        hourly_data = list(
            AircraftSighting.objects.filter(timestamp__gt=cutoff)
            .annotate(hour=TruncHour('timestamp'))
            .values('hour')
            .annotate(
                unique_aircraft=Count('icao_hex', distinct=True),
                position_count=Count('id'),
                military_count=Count('id', filter=django_models.Q(is_military=True)),
            )
            .order_by('-unique_aircraft')[:limit]
        )

        peak_periods = []
        for h in hourly_data:
            peak_periods.append({
                'hour': h['hour'].isoformat() + "Z" if h['hour'] else None,
                'unique_aircraft': h['unique_aircraft'],
                'position_count': h['position_count'],
                'military_count': h['military_count'],
            })

        # Calculate overall stats
        overall = AircraftSighting.objects.filter(timestamp__gt=cutoff).annotate(
            hour=TruncHour('timestamp')
        ).values('hour').annotate(
            unique=Count('icao_hex', distinct=True)
        ).aggregate(
            avg_aircraft=django_models.Avg('unique'),
            max_aircraft=django_models.Max('unique'),
        )

        return Response({
            'peak_periods': peak_periods,
            'summary': {
                'avg_aircraft_per_hour': round(overall['avg_aircraft'], 1) if overall['avg_aircraft'] else 0,
                'max_aircraft_in_hour': overall['max_aircraft'] or 0,
            },
            'time_range_hours': hours,
        })


class FavoritesViewSet(viewsets.ViewSet):
    """ViewSet for managing aircraft favorites."""

    @extend_schema(
        summary="List user favorites",
        description="Get list of favorited aircraft for the current user/session"
    )
    def list(self, request):
        """List user's favorite aircraft."""
        user = request.user if request.user.is_authenticated else None
        session_key = request.session.session_key if not user else None

        if not user and not session_key:
            return Response({'favorites': [], 'count': 0})

        filters = {'user': user} if user else {'session_key': session_key}
        favorites = AircraftFavorite.objects.filter(**filters).order_by('-updated_at')

        # Enrich with aircraft info
        icao_hexes = [f.icao_hex for f in favorites]
        aircraft_infos = {
            info.icao_hex: info
            for info in AircraftInfo.objects.filter(icao_hex__in=icao_hexes)
        }

        result = []
        for fav in favorites:
            info = aircraft_infos.get(fav.icao_hex)
            result.append({
                'id': fav.id,
                'icao_hex': fav.icao_hex,
                'registration': fav.registration or (info.registration if info else None),
                'callsign': fav.callsign,
                'notes': fav.notes,
                'times_seen': fav.times_seen,
                'last_seen_at': fav.last_seen_at.isoformat() + "Z" if fav.last_seen_at else None,
                'total_tracking_minutes': round(fav.total_tracking_minutes, 1),
                'notify_on_detection': fav.notify_on_detection,
                'created_at': fav.created_at.isoformat() + "Z",
                'aircraft_info': {
                    'type_code': info.type_code if info else None,
                    'type_name': info.type_name if info else None,
                    'operator': info.operator if info else None,
                    'country': info.country if info else None,
                    'photo_url': info.photo_thumbnail_url or info.photo_url if info else None,
                } if info else None,
            })

        return Response({
            'favorites': result,
            'count': len(result),
        })

    @extend_schema(
        summary="Toggle aircraft favorite",
        description="Add or remove an aircraft from favorites"
    )
    @action(detail=False, methods=['post'], url_path=r'toggle/(?P<icao_hex>[A-Za-z0-9]+)')
    def toggle(self, request, icao_hex=None):
        """Toggle favorite status for an aircraft."""
        user = request.user if request.user.is_authenticated else None
        session_key = request.session.session_key if not user else None

        if not user and not session_key:
            # Create session if needed
            if not request.session.session_key:
                request.session.create()
            session_key = request.session.session_key

        # Get registration if available
        registration = None
        info = AircraftInfo.objects.filter(icao_hex__iexact=icao_hex).first()
        if info:
            registration = info.registration

        favorite, created = AircraftFavorite.toggle_favorite(
            icao_hex=icao_hex,
            user=user,
            session_key=session_key,
            registration=registration,
        )

        return Response({
            'icao_hex': icao_hex.upper(),
            'is_favorite': created,
            'action': 'added' if created else 'removed',
            'favorite_id': favorite.id if favorite else None,
        })

    @extend_schema(
        summary="Check if aircraft is favorite",
        description="Check if an aircraft is in user's favorites"
    )
    @action(detail=False, methods=['get'], url_path=r'check/(?P<icao_hex>[A-Za-z0-9]+)')
    def check(self, request, icao_hex=None):
        """Check if aircraft is favorited."""
        user = request.user if request.user.is_authenticated else None
        session_key = request.session.session_key if not user else None

        is_favorite = AircraftFavorite.is_favorite(
            icao_hex=icao_hex,
            user=user,
            session_key=session_key,
        )

        return Response({
            'icao_hex': icao_hex.upper(),
            'is_favorite': is_favorite,
        })

    @extend_schema(
        summary="Update favorite notes",
        description="Update notes for a favorited aircraft"
    )
    @action(detail=True, methods=['patch'])
    def notes(self, request, pk=None):
        """Update notes for a favorite."""
        user = request.user if request.user.is_authenticated else None
        session_key = request.session.session_key if not user else None

        filters = {'pk': pk}
        if user:
            filters['user'] = user
        elif session_key:
            filters['session_key'] = session_key
        else:
            return Response({'error': 'Not authenticated'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            favorite = AircraftFavorite.objects.get(**filters)
        except AircraftFavorite.DoesNotExist:
            return Response({'error': 'Favorite not found'}, status=status.HTTP_404_NOT_FOUND)

        notes = request.data.get('notes', '')
        notify = request.data.get('notify_on_detection')

        if notes is not None:
            favorite.notes = notes
        if notify is not None:
            favorite.notify_on_detection = notify

        favorite.save()

        return Response({
            'id': favorite.id,
            'icao_hex': favorite.icao_hex,
            'notes': favorite.notes,
            'notify_on_detection': favorite.notify_on_detection,
        })


class FlightPatternsViewSet(viewsets.ViewSet):
    """
    ViewSet for flight patterns and geographic statistics.

    Provides cached statistics about:
    - Flight patterns (busiest hours, aircraft types, duration by type)
    - Geographic data (countries of origin, operators, locations)
    """

    @extend_schema(
        summary="Get flight patterns statistics",
        description="""
        Returns flight pattern statistics including:
        - Busiest hours of the day (for heatmap visualization)
        - Average flight duration by aircraft type
        - Most common aircraft types/models
        - Frequent airline routes (based on callsign analysis)
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
            OpenApiParameter(
                name='refresh',
                type=bool,
                location=OpenApiParameter.QUERY,
                description='Force refresh from database instead of using cache',
                default=False
            ),
        ],
    )
    def list(self, request):
        """Get flight patterns statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh:
            stats = calculate_flight_patterns_stats(hours=hours)
        else:
            stats = get_flight_patterns_stats()
            # If cached stats have a different time range, recalculate
            if stats and stats.get('time_range_hours') != hours:
                stats = calculate_flight_patterns_stats(hours=hours)

        if stats is None:
            stats = calculate_flight_patterns_stats(hours=hours)

        return Response(stats)

    @extend_schema(
        summary="Get busiest hours heatmap data",
        description="""
        Returns hourly activity data optimized for heatmap visualization.
        Shows position counts and unique aircraft by hour of day.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='busiest-hours')
    def busiest_hours(self, request):
        """Get busiest hours data for heatmap."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_flight_patterns_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_flight_patterns_stats(hours=hours)

        return Response({
            'busiest_hours': stats.get('busiest_hours', []),
            'peak_hour': stats.get('peak_hour'),
            'peak_aircraft_count': stats.get('peak_aircraft_count'),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get aircraft types breakdown",
        description="""
        Returns the most common aircraft types/models seen in the coverage area.
        Includes session counts, unique aircraft, and military percentage.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
            OpenApiParameter(
                name='limit',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Maximum number of types to return (default: 25)',
                default=25
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='aircraft-types')
    def aircraft_types(self, request):
        """Get aircraft types breakdown."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 25))
        stats = get_flight_patterns_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_flight_patterns_stats(hours=hours)

        types = stats.get('common_aircraft_types', [])[:limit]

        return Response({
            'aircraft_types': types,
            'total_types': len(stats.get('common_aircraft_types', [])),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get flight duration by type",
        description="""
        Returns average flight duration statistics grouped by aircraft type.
        Shows min/max/avg duration in minutes for each type.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='duration-by-type')
    def duration_by_type(self, request):
        """Get flight duration by aircraft type."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_flight_patterns_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_flight_patterns_stats(hours=hours)

        return Response({
            'duration_by_type': stats.get('avg_duration_by_type', []),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get frequent routes/airlines",
        description="""
        Returns most frequent airline codes based on callsign analysis.
        Groups flights by ICAO airline prefix (first 3 chars of callsign).
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='routes')
    def routes(self, request):
        """Get frequent routes/airlines."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_flight_patterns_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_flight_patterns_stats(hours=hours)

        return Response({
            'routes': stats.get('frequent_routes', []),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })


class GeographicStatsViewSet(viewsets.ViewSet):
    """
    ViewSet for geographic and origin statistics.

    Provides statistics about:
    - Countries of origin (from registration prefixes)
    - Airlines/operators frequency
    - Connected locations
    - Military vs civilian breakdown
    """

    @extend_schema(
        summary="Get geographic statistics",
        description="""
        Returns geographic and origin statistics including:
        - Countries of origin breakdown (from registration prefixes)
        - Airlines/operators frequency
        - Most connected cities/locations
        - Military vs civilian breakdown by country
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
            OpenApiParameter(
                name='refresh',
                type=bool,
                location=OpenApiParameter.QUERY,
                description='Force refresh from database instead of using cache',
                default=False
            ),
        ],
    )
    def list(self, request):
        """Get geographic statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh:
            stats = calculate_geographic_stats(hours=hours)
        else:
            stats = get_geographic_stats()
            # If cached stats have a different time range, recalculate
            if stats and stats.get('time_range_hours') != hours:
                stats = calculate_geographic_stats(hours=hours)

        if stats is None:
            stats = calculate_geographic_stats(hours=hours)

        return Response(stats)

    @extend_schema(
        summary="Get countries of origin breakdown",
        description="""
        Returns breakdown of aircraft by country of origin.
        Country is determined from registration prefix.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='countries')
    def countries(self, request):
        """Get countries of origin breakdown."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_geographic_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_geographic_stats(hours=hours)

        return Response({
            'countries': stats.get('countries_breakdown', []),
            'total_countries': stats.get('summary', {}).get('total_countries', 0),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get operators/airlines frequency",
        description="""
        Returns breakdown of aircraft by operator/airline.
        Shows aircraft count per operator.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='operators')
    def operators(self, request):
        """Get operators/airlines frequency."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_geographic_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_geographic_stats(hours=hours)

        return Response({
            'operators': stats.get('operators_frequency', []),
            'total_operators': stats.get('summary', {}).get('total_operators', 0),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get military vs civilian breakdown",
        description="""
        Returns breakdown of military vs civilian aircraft by country.
        Shows counts and percentages for each country.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='military-breakdown')
    def military_breakdown(self, request):
        """Get military vs civilian breakdown by country."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_geographic_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_geographic_stats(hours=hours)

        return Response({
            'military_breakdown': stats.get('military_breakdown', []),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get connected locations",
        description="""
        Returns most connected cities/locations based on aircraft registration data.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='locations')
    def locations(self, request):
        """Get connected locations."""
        hours = int(request.query_params.get('hours', 24))
        stats = get_geographic_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_geographic_stats(hours=hours)

        return Response({
            'locations': stats.get('connected_locations', []),
            'time_range_hours': hours,
            'timestamp': stats.get('timestamp'),
        })

    @extend_schema(
        summary="Get all stats summary",
        description="""
        Returns a summary of all flight patterns and geographic statistics.
        """,
        parameters=[
            OpenApiParameter(
                name='hours',
                type=int,
                location=OpenApiParameter.QUERY,
                description='Time range in hours (default: 24)',
                default=24
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        """Get all stats summary."""
        hours = int(request.query_params.get('hours', 24))

        flight_patterns = get_flight_patterns_stats()
        geographic = get_geographic_stats()

        if flight_patterns is None or flight_patterns.get('time_range_hours') != hours:
            flight_patterns = calculate_flight_patterns_stats(hours=hours)

        if geographic is None or geographic.get('time_range_hours') != hours:
            geographic = calculate_geographic_stats(hours=hours)

        return Response({
            'flight_patterns': flight_patterns,
            'geographic': geographic,
            'time_range_hours': hours,
        })
