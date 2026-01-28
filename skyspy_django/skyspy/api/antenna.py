"""
Antenna analytics API views.

Provides endpoints for antenna performance monitoring and historical analysis.
"""
import logging
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AntennaAnalyticsSnapshot

logger = logging.getLogger(__name__)


class AntennaAnalyticsViewSet(ViewSet):
    """
    Antenna performance analytics.

    Provides current analytics from cache and historical snapshots from database.
    """

    @extend_schema(
        summary="Get current antenna analytics",
        description="Returns the latest cached antenna analytics from the periodic task",
    )
    def list(self, request):
        """Get current antenna analytics from cache."""
        analytics = cache.get('antenna_analytics')

        if analytics:
            return Response({
                'status': 'ok',
                'cached': True,
                'data': analytics
            })

        # If no cached data, try to get latest snapshot
        latest = AntennaAnalyticsSnapshot.get_latest()
        if latest:
            return Response({
                'status': 'ok',
                'cached': False,
                'data': latest.to_dict()
            })

        return Response({
            'status': 'no_data',
            'cached': False,
            'data': None,
            'message': 'No antenna analytics available yet'
        })

    @extend_schema(
        summary="Get antenna analytics history",
        description="Returns historical antenna analytics snapshots",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Hours of history (default: 24)'),
            OpenApiParameter(name='snapshot_type', type=str, description='Type: scheduled, hourly, daily'),
        ]
    )
    @action(detail=False, methods=['get'])
    def history(self, request):
        """Get historical antenna analytics snapshots."""
        hours = int(request.query_params.get('hours', 24))
        snapshot_type = request.query_params.get('snapshot_type', 'scheduled')

        cutoff = timezone.now() - timedelta(hours=hours)

        snapshots = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__gte=cutoff,
            snapshot_type=snapshot_type
        ).order_by('timestamp')

        data = [snapshot.to_dict() for snapshot in snapshots]

        return Response({
            'hours': hours,
            'snapshot_type': snapshot_type,
            'count': len(data),
            'snapshots': data
        })

    @extend_schema(
        summary="Get antenna performance trends",
        description="Returns aggregated antenna performance trends over time",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Hours of history (default: 24)'),
            OpenApiParameter(name='interval', type=str, description='Aggregation interval: 5min, hourly, daily'),
        ]
    )
    @action(detail=False, methods=['get'])
    def trends(self, request):
        """Get antenna performance trends."""
        hours = int(request.query_params.get('hours', 24))
        interval = request.query_params.get('interval', 'hourly')

        cutoff = timezone.now() - timedelta(hours=hours)

        # Get snapshots for the period
        snapshots = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__gte=cutoff,
            snapshot_type='scheduled'
        ).order_by('timestamp')

        if not snapshots.exists():
            return Response({
                'hours': hours,
                'interval': interval,
                'trends': [],
                'summary': {
                    'avg_max_range': None,
                    'peak_max_range': None,
                    'avg_coverage': None,
                    'data_points': 0
                }
            })

        # Calculate trends
        trend_data = []
        ranges = []
        coverages = []

        for snapshot in snapshots:
            trend_data.append({
                'timestamp': snapshot.timestamp.isoformat() + 'Z',
                'max_range_nm': snapshot.max_range_nm,
                'avg_range_nm': snapshot.avg_range_nm,
                'coverage_percentage': snapshot.coverage_percentage,
                'total_positions': snapshot.total_positions,
                'unique_aircraft': snapshot.unique_aircraft,
                'avg_rssi': snapshot.avg_rssi,
            })
            if snapshot.max_range_nm:
                ranges.append(snapshot.max_range_nm)
            if snapshot.coverage_percentage:
                coverages.append(snapshot.coverage_percentage)

        summary = {
            'avg_max_range': round(sum(ranges) / len(ranges), 1) if ranges else None,
            'peak_max_range': max(ranges) if ranges else None,
            'min_max_range': min(ranges) if ranges else None,
            'avg_coverage': round(sum(coverages) / len(coverages), 1) if coverages else None,
            'data_points': len(trend_data)
        }

        return Response({
            'hours': hours,
            'interval': interval,
            'trends': trend_data,
            'summary': summary
        })

    @extend_schema(
        summary="Get antenna coverage summary",
        description="Returns a summary of antenna coverage by direction",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Hours to analyze (default: 24)'),
        ]
    )
    @action(detail=False, methods=['get'])
    def coverage(self, request):
        """Get antenna coverage summary by direction."""
        hours = int(request.query_params.get('hours', 24))

        cutoff = timezone.now() - timedelta(hours=hours)

        # Get latest snapshot that has direction data
        snapshot = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__gte=cutoff,
            range_by_direction__isnull=False
        ).exclude(range_by_direction={}).order_by('-timestamp').first()

        if not snapshot:
            return Response({
                'hours': hours,
                'coverage': None,
                'message': 'No coverage data available'
            })

        # Calculate coverage metrics
        direction_data = snapshot.range_by_direction
        sectors = []
        total_sectors = 12

        for sector in range(0, 360, 30):
            sector_key = str(sector)
            if sector_key in direction_data and direction_data[sector_key].get('max_range'):
                data = direction_data[sector_key]
                sectors.append({
                    'bearing': sector,
                    'bearing_range': f"{sector}-{sector + 30}°",
                    'max_range_nm': data.get('max_range'),
                    'avg_range_nm': data.get('avg_range'),
                    'position_count': data.get('position_count', 0),
                    'unique_aircraft': data.get('unique_aircraft', 0),
                    'avg_rssi': data.get('avg_rssi'),
                    'has_data': True
                })
            elif sector in direction_data and direction_data[sector].get('max_range'):
                # Handle integer keys
                data = direction_data[sector]
                sectors.append({
                    'bearing': sector,
                    'bearing_range': f"{sector}-{sector + 30}°",
                    'max_range_nm': data.get('max_range'),
                    'avg_range_nm': data.get('avg_range'),
                    'position_count': data.get('position_count', 0),
                    'unique_aircraft': data.get('unique_aircraft', 0),
                    'avg_rssi': data.get('avg_rssi'),
                    'has_data': True
                })
            else:
                sectors.append({
                    'bearing': sector,
                    'bearing_range': f"{sector}-{sector + 30}°",
                    'max_range_nm': None,
                    'avg_range_nm': None,
                    'position_count': 0,
                    'unique_aircraft': 0,
                    'avg_rssi': None,
                    'has_data': False
                })

        sectors_with_data = sum(1 for s in sectors if s['has_data'])

        return Response({
            'hours': hours,
            'timestamp': snapshot.timestamp.isoformat() + 'Z',
            'sectors': sectors,
            'summary': {
                'total_sectors': total_sectors,
                'sectors_with_data': sectors_with_data,
                'coverage_percentage': round((sectors_with_data / total_sectors) * 100, 1),
                'best_sector': max(
                    (s for s in sectors if s['has_data']),
                    key=lambda x: x['max_range_nm'] or 0,
                    default=None
                ),
                'weakest_sector': min(
                    (s for s in sectors if s['has_data']),
                    key=lambda x: x['max_range_nm'] or float('inf'),
                    default=None
                ),
            }
        })

    @extend_schema(
        summary="Clean up old antenna analytics snapshots",
        description="Delete snapshots older than specified retention period",
        parameters=[
            OpenApiParameter(name='days', type=int, description='Retention days (default: 7)'),
        ]
    )
    @action(detail=False, methods=['delete'])
    def cleanup(self, request):
        """Delete old antenna analytics snapshots."""
        days = int(request.query_params.get('days', 7))
        cutoff = timezone.now() - timedelta(days=days)

        deleted_count, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=cutoff
        ).delete()

        return Response({
            'deleted_count': deleted_count,
            'retention_days': days,
            'cutoff': cutoff.isoformat() + 'Z'
        })
