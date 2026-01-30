"""
Flight Pattern and Geographic Statistics API views.

Provides endpoints for:
- Flight patterns (routes, busiest hours, duration by type, aircraft types)
- Geographic stats (countries, operators, airports, military breakdown)
"""
import logging
from datetime import timedelta

from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.services.flight_pattern_stats import (
    get_flight_pattern_stats,
    get_geographic_stats,
    get_all_stats,
    get_frequent_routes,
    get_busiest_hours,
    get_airport_connectivity,
    calculate_flight_pattern_stats,
    calculate_geographic_stats,
    calculate_frequent_routes,
    calculate_busiest_hours,
    calculate_duration_by_type,
    calculate_common_aircraft_types,
    calculate_countries_breakdown,
    calculate_operators_frequency,
    calculate_airport_connectivity,
    calculate_military_breakdown,
)
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.auth.permissions import FeatureBasedPermission

logger = logging.getLogger(__name__)


class FlightPatternStatsViewSet(viewsets.ViewSet):
    """
    ViewSet for flight pattern statistics.

    Provides cached statistics about:
    - Most frequent routes/city pairs
    - Busiest hours of the day (heatmap data)
    - Average flight duration by aircraft type
    - Most common aircraft types/models
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Get all flight pattern statistics",
        description="""
        Returns comprehensive flight pattern statistics including:
        - Most frequent routes/city pairs (from ACARS and callsign analysis)
        - Busiest hours of the day (for heatmap visualization)
        - Average flight duration by aircraft type
        - Most common aircraft types/models seen in coverage area
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
        """Get all flight pattern statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh:
            stats = calculate_flight_pattern_stats(hours=hours)
        else:
            stats = get_flight_pattern_stats()
            if stats and stats.get('time_range_hours') != hours:
                stats = calculate_flight_pattern_stats(hours=hours)

        if stats is None:
            stats = calculate_flight_pattern_stats(hours=hours)

        return Response(stats)

    @extend_schema(
        summary="Get frequent routes and city pairs",
        description="""
        Returns most frequent routes/city pairs based on:
        - ACARS message origin/destination data
        - Callsign patterns (airline codes)

        Useful for understanding which routes are most common in your coverage area.
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
                description='Maximum number of routes to return (default: 20)',
                default=20
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='routes')
    def frequent_routes(self, request):
        """Get frequent routes and city pairs."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 20))

        routes = calculate_frequent_routes(hours=hours, limit=limit)

        return Response({
            'routes': routes,
            'total_routes': len(routes),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get busiest hours heatmap data",
        description="""
        Returns hourly activity data optimized for heatmap visualization.

        Shows position counts, unique aircraft, and other metrics by hour (0-23).
        Includes peak/quietest hour identification and day/night breakdown.
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
        """Get busiest hours heatmap data."""
        hours = int(request.query_params.get('hours', 24))

        data = calculate_busiest_hours(hours=hours)

        return Response({
            'busiest_hours': data['busiest_hours'],
            'peak_hour': data['peak_hour'],
            'peak_aircraft_count': data['peak_aircraft_count'],
            'quietest_hour': data['quietest_hour'],
            'day_night_ratio': data['day_night_ratio'],
            'day_positions': data['day_positions'],
            'night_positions': data['night_positions'],
            'total_positions': data['total_positions'],
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get flight duration by aircraft type",
        description="""
        Returns average flight duration statistics grouped by aircraft type.

        Shows min/max/avg duration in minutes for each aircraft type,
        along with military percentage and position counts.
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
    @action(detail=False, methods=['get'], url_path='duration-by-type')
    def duration_by_type(self, request):
        """Get flight duration by aircraft type."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 25))

        data = calculate_duration_by_type(hours=hours, limit=limit)

        return Response({
            'duration_by_type': data,
            'total_types': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get most common aircraft types",
        description="""
        Returns the most common aircraft types/models seen in the coverage area.

        Includes session counts, unique aircraft, military percentage,
        and average tracking duration for each type.
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
                description='Maximum number of types to return (default: 30)',
                default=30
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='aircraft-types')
    def aircraft_types(self, request):
        """Get most common aircraft types."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 30))

        data = calculate_common_aircraft_types(hours=hours, limit=limit)

        return Response({
            'aircraft_types': data,
            'total_types': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })


class GeographicStatsViewSet(viewsets.ViewSet):
    """
    ViewSet for geographic and origin statistics.

    Provides statistics about:
    - Countries of origin (from registration prefixes)
    - Airlines/operators frequency
    - Airport connectivity
    - Military vs civilian breakdown
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Get all geographic statistics",
        description="""
        Returns comprehensive geographic and origin statistics including:
        - Countries of origin breakdown (from registration prefixes)
        - Airlines/operators frequency
        - Airports most connected to coverage area
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
        """Get all geographic statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh:
            stats = calculate_geographic_stats(hours=hours)
        else:
            stats = get_geographic_stats()
            if stats and stats.get('time_range_hours') != hours:
                stats = calculate_geographic_stats(hours=hours)

        if stats is None:
            stats = calculate_geographic_stats(hours=hours)

        return Response(stats)

    @extend_schema(
        summary="Get countries of origin breakdown",
        description="""
        Returns breakdown of aircraft by country of origin.

        Country is determined from registration prefix (e.g., N = USA, G- = UK).
        Includes military percentage for each country.
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
                description='Maximum number of countries to return (default: 25)',
                default=25
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='countries')
    def countries(self, request):
        """Get countries of origin breakdown."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 25))

        data = calculate_countries_breakdown(hours=hours, limit=limit)

        return Response({
            'countries': data,
            'total_countries': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get operators/airlines frequency",
        description="""
        Returns breakdown of aircraft by operator/airline.

        Shows aircraft count per operator from AircraftInfo database.
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
                description='Maximum number of operators to return (default: 25)',
                default=25
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='operators')
    def operators(self, request):
        """Get operators/airlines frequency."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 25))

        data = calculate_operators_frequency(hours=hours, limit=limit)

        return Response({
            'operators': data,
            'total_operators': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get airport connectivity",
        description="""
        Returns airports most connected to the coverage area.

        Based on ACARS message mentions and decoded origin/destination data.
        Includes airport name, country, and type when available.
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
                description='Maximum number of airports to return (default: 20)',
                default=20
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='airports')
    def airports(self, request):
        """Get airport connectivity."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 20))

        data = calculate_airport_connectivity(hours=hours, limit=limit)

        return Response({
            'airports': data,
            'total_airports': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get military vs civilian breakdown",
        description="""
        Returns breakdown of military vs civilian aircraft by country.

        Shows counts and percentages for each country based on
        aircraft registration and session is_military flag.
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

        data = calculate_military_breakdown(hours=hours)

        return Response({
            'military_breakdown': data,
            'total_countries': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get connected locations",
        description="""
        Returns most connected cities/locations based on aircraft registration data.
        This is an alias for the airports endpoint for API compatibility.
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
                description='Maximum number of locations to return (default: 20)',
                default=20
            ),
        ],
    )
    @action(detail=False, methods=['get'], url_path='locations')
    def locations(self, request):
        """Get connected locations (alias for airports)."""
        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 20))

        data = calculate_airport_connectivity(hours=hours, limit=limit)

        return Response({
            'locations': data,
            'total_locations': len(data),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get geographic stats summary",
        description="""
        Returns a summary of geographic statistics.
        Provides key metrics for dashboard overview.
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
        """Get geographic stats summary."""
        hours = int(request.query_params.get('hours', 24))

        stats = get_geographic_stats()

        if stats is None or stats.get('time_range_hours') != hours:
            stats = calculate_geographic_stats(hours=hours)

        geo_summary = stats.get('summary', {})

        return Response({
            'summary': {
                'total_countries': geo_summary.get('total_countries', 0),
                'total_operators': geo_summary.get('total_operators', 0),
                'total_airports': geo_summary.get('total_airports', 0),
                'top_country': geo_summary.get('top_country'),
                'top_operator': geo_summary.get('top_operator'),
                'top_airport': geo_summary.get('top_airport'),
            },
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })


class CombinedStatsViewSet(viewsets.ViewSet):
    """
    ViewSet for combined flight pattern and geographic statistics.

    Provides a unified endpoint for retrieving all stats in a single request.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Get all flight pattern and geographic statistics",
        description="""
        Returns combined flight pattern and geographic statistics in a single response.

        Useful when you need both stat types and want to minimize API calls.
        Includes:
        - Flight patterns (routes, busiest hours, duration by type, aircraft types)
        - Geographic stats (countries, operators, airports, military breakdown)
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
        """Get all flight pattern and geographic statistics."""
        hours = int(request.query_params.get('hours', 24))
        refresh = request.query_params.get('refresh', 'false').lower() == 'true'

        if refresh or hours != 24:
            flight_patterns = calculate_flight_pattern_stats(hours=hours)
            geographic = calculate_geographic_stats(hours=hours)
        else:
            stats = get_all_stats()
            if stats:
                flight_patterns = stats.get('flight_patterns')
                geographic = stats.get('geographic')
            else:
                flight_patterns = calculate_flight_pattern_stats(hours=hours)
                geographic = calculate_geographic_stats(hours=hours)

        return Response({
            'flight_patterns': flight_patterns,
            'geographic': geographic,
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })

    @extend_schema(
        summary="Get summary of all statistics",
        description="""
        Returns a high-level summary of flight pattern and geographic statistics.

        Provides key metrics without the full detail, useful for dashboard overview.
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
        """Get summary of all statistics."""
        hours = int(request.query_params.get('hours', 24))

        flight_patterns = get_flight_pattern_stats()
        geographic = get_geographic_stats()

        if flight_patterns is None or flight_patterns.get('time_range_hours') != hours:
            flight_patterns = calculate_flight_pattern_stats(hours=hours)

        if geographic is None or geographic.get('time_range_hours') != hours:
            geographic = calculate_geographic_stats(hours=hours)

        # Extract summaries
        fp_summary = flight_patterns.get('summary', {})
        geo_summary = geographic.get('summary', {})

        return Response({
            'summary': {
                'flight_patterns': {
                    'total_routes': fp_summary.get('total_routes', 0),
                    'total_aircraft_types': fp_summary.get('total_aircraft_types', 0),
                    'total_positions': fp_summary.get('total_positions', 0),
                    'peak_hour': flight_patterns.get('peak_hour'),
                    'peak_aircraft_count': flight_patterns.get('peak_aircraft_count', 0),
                    'day_night_ratio': flight_patterns.get('day_night_ratio'),
                },
                'geographic': {
                    'total_countries': geo_summary.get('total_countries', 0),
                    'total_operators': geo_summary.get('total_operators', 0),
                    'total_airports': geo_summary.get('total_airports', 0),
                    'top_country': geo_summary.get('top_country'),
                    'top_operator': geo_summary.get('top_operator'),
                    'top_airport': geo_summary.get('top_airport'),
                },
            },
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z',
        })
