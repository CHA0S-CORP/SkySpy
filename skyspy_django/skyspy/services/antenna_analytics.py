"""
Antenna Analytics Service.

Provides cached antenna performance metrics:
- Polar coverage by bearing (reception pattern)
- RSSI vs distance correlation (signal strength analysis)
- Overall antenna performance summary

Works with the Celery task for periodic updates and provides
real-time cache access for API/WebSocket consumers.
"""
import logging
import math
import statistics
from datetime import datetime, timedelta
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.db.models import Avg, Count, Max, Min, F
from django.db.models.functions import Floor
from django.utils import timezone

from skyspy.models import AircraftSighting

logger = logging.getLogger(__name__)

# Cache keys
CACHE_KEY_POLAR = 'antenna_polar'
CACHE_KEY_RSSI = 'antenna_rssi'
CACHE_KEY_SUMMARY = 'antenna_summary'
CACHE_KEY_LAST_UPDATED = 'antenna_last_updated'

# Cache timeout (10 minutes)
CACHE_TIMEOUT = 600


def calculate_polar_data(hours: int = 24) -> dict:
    """
    Calculate antenna polar coverage data.

    Returns bearing-grouped data (36 sectors of 10 degrees each).
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    sightings = AircraftSighting.objects.filter(
        timestamp__gte=cutoff,
        track__isnull=False,
        distance_nm__isnull=False
    )

    if not sightings.exists():
        return {
            'bearing_data': [
                {
                    'bearing_start': sector,
                    'bearing_end': (sector + 10) % 360,
                    'count': 0,
                    'avg_rssi': None,
                    'min_rssi': None,
                    'max_rssi': None,
                    'avg_distance_nm': None,
                    'max_distance_nm': None,
                    'unique_aircraft': 0,
                }
                for sector in range(0, 360, 10)
            ],
            'summary': {
                'total_sightings': 0,
                'sectors_with_data': 0,
                'coverage_pct': 0,
            },
            'time_range_hours': hours,
        }

    # Query with bearing sectors
    bearing_data = []
    total_count = 0
    sectors_with_data = 0

    for sector in range(0, 360, 10):
        sector_sightings = sightings.filter(
            track__gte=sector,
            track__lt=sector + 10
        )

        stats = sector_sightings.aggregate(
            count=Count('id'),
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            unique_aircraft=Count('icao_hex', distinct=True),
        )

        count = stats['count'] or 0
        total_count += count
        if count > 0:
            sectors_with_data += 1

        bearing_data.append({
            'bearing_start': sector,
            'bearing_end': (sector + 10) % 360,
            'count': count,
            'avg_rssi': round(stats['avg_rssi'], 1) if stats['avg_rssi'] else None,
            'min_rssi': round(stats['min_rssi'], 1) if stats['min_rssi'] else None,
            'max_rssi': round(stats['max_rssi'], 1) if stats['max_rssi'] else None,
            'avg_distance_nm': round(stats['avg_distance'], 1) if stats['avg_distance'] else None,
            'max_distance_nm': round(stats['max_distance'], 1) if stats['max_distance'] else None,
            'unique_aircraft': stats['unique_aircraft'] or 0,
        })

    return {
        'bearing_data': bearing_data,
        'summary': {
            'total_sightings': total_count,
            'sectors_with_data': sectors_with_data,
            'coverage_pct': round((sectors_with_data / 36) * 100, 1),
        },
        'time_range_hours': hours,
    }


def calculate_rssi_data(hours: int = 24, sample_size: int = 500) -> dict:
    """
    Calculate RSSI vs distance correlation data.

    Returns scatter data and band statistics for signal analysis.
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    base_queryset = AircraftSighting.objects.filter(
        timestamp__gte=cutoff,
        rssi__isnull=False,
        distance_nm__isnull=False,
        distance_nm__gt=0
    )

    if not base_queryset.exists():
        return {
            'scatter_data': [],
            'band_statistics': [],
            'overall_statistics': {},
            'trend_line': None,
            'time_range_hours': hours,
            'sample_size': 0,
        }

    # Get sampled scatter data points
    scatter_queryset = base_queryset.order_by('?')[:sample_size]
    scatter_data = []
    for row in scatter_queryset.values('distance_nm', 'rssi', 'altitude_baro', 'icao_hex'):
        scatter_data.append({
            'distance_nm': round(row['distance_nm'], 1),
            'rssi': round(row['rssi'], 1),
            'altitude': row['altitude_baro'],
            'icao': row['icao_hex'],
        })

    # Get aggregated statistics by distance bands
    band_definitions = [
        ('0-25nm', 0, 25),
        ('25-50nm', 25, 50),
        ('50-75nm', 50, 75),
        ('75-100nm', 75, 100),
        ('100-150nm', 100, 150),
        ('150+nm', 150, 10000),
    ]

    band_statistics = []
    total_count = 0
    all_rssi = []

    for band_name, min_dist, max_dist in band_definitions:
        band_queryset = base_queryset.filter(
            distance_nm__gte=min_dist,
            distance_nm__lt=max_dist
        )

        stats = band_queryset.aggregate(
            count=Count('id'),
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi'),
            avg_distance=Avg('distance_nm'),
        )

        count = stats['count'] or 0
        total_count += count

        if stats['avg_rssi']:
            all_rssi.extend([stats['avg_rssi']] * min(count, 100))

        band_statistics.append({
            'band': band_name,
            'count': count,
            'avg_rssi': round(stats['avg_rssi'], 1) if stats['avg_rssi'] else None,
            'min_rssi': round(stats['min_rssi'], 1) if stats['min_rssi'] else None,
            'max_rssi': round(stats['max_rssi'], 1) if stats['max_rssi'] else None,
            'avg_distance_nm': round(stats['avg_distance'], 1) if stats['avg_distance'] else None,
        })

    # Calculate overall statistics
    overall_stats = {}
    if all_rssi:
        overall_stats = {
            'count': total_count,
            'avg_rssi': round(statistics.mean(all_rssi), 1),
            'median_rssi': round(statistics.median(all_rssi), 1),
        }

    # Calculate linear regression trend line
    trend_line = None
    if len(scatter_data) > 10:
        distances = [d['distance_nm'] for d in scatter_data]
        rssis = [d['rssi'] for d in scatter_data]
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
                'interpretation': (
                    f"RSSI decreases by {abs(round(slope * 10, 2))} dB per 10nm"
                    if slope < 0
                    else f"RSSI increases by {round(slope * 10, 2)} dB per 10nm"
                )
            }

    return {
        'scatter_data': scatter_data,
        'band_statistics': band_statistics,
        'overall_statistics': overall_stats,
        'trend_line': trend_line,
        'time_range_hours': hours,
        'sample_size': len(scatter_data),
    }


def calculate_summary(hours: int = 24) -> dict:
    """Calculate antenna performance summary."""
    cutoff = timezone.now() - timedelta(hours=hours)

    base_queryset = AircraftSighting.objects.filter(
        timestamp__gte=cutoff,
        distance_nm__isnull=False
    )

    if not base_queryset.exists():
        return {
            'range': {
                'total_sightings': 0,
                'unique_aircraft': 0,
                'avg_nm': None,
                'max_nm': None,
                'min_nm': None,
            },
            'signal': {
                'avg_rssi': None,
                'best_rssi': None,
                'worst_rssi': None,
            },
            'coverage': {
                'sectors_active': 0,
                'total_sectors': 36,
                'coverage_pct': 0,
            },
            'time_range_hours': hours,
        }

    # Get range statistics
    range_stats = base_queryset.aggregate(
        total_sightings=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        avg_distance=Avg('distance_nm'),
        max_distance=Max('distance_nm'),
        min_distance=Min('distance_nm'),
    )

    # Get RSSI statistics
    rssi_stats = base_queryset.filter(rssi__isnull=False).aggregate(
        avg_rssi=Avg('rssi'),
        min_rssi=Min('rssi'),
        max_rssi=Max('rssi'),
    )

    # Get coverage by bearing (count distinct 10-degree sectors)
    sectors_with_data = base_queryset.filter(
        track__isnull=False
    ).annotate(
        sector=Floor(F('track') / 10)
    ).values('sector').distinct().count()

    # Calculate percentiles
    percentiles = {}
    distances = list(base_queryset.values_list('distance_nm', flat=True)[:10000])
    if distances:
        sorted_dist = sorted(d for d in distances if d is not None)
        n = len(sorted_dist)
        if n > 0:
            percentiles = {
                'p50': round(sorted_dist[n // 2], 1),
                'p75': round(sorted_dist[int(n * 0.75)], 1),
                'p90': round(sorted_dist[int(n * 0.90)], 1),
                'p95': round(sorted_dist[min(int(n * 0.95), n - 1)], 1),
            }

    return {
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
            'sectors_active': sectors_with_data,
            'total_sectors': 36,
            'coverage_pct': round((sectors_with_data / 36) * 100, 1),
        },
        'time_range_hours': hours,
    }


def refresh_cache(hours: int = 24) -> dict:
    """
    Refresh all antenna analytics cache.

    Returns the complete analytics data.
    """
    logger.debug("Refreshing antenna analytics cache...")
    start = datetime.now()

    try:
        polar = calculate_polar_data(hours)
        rssi = calculate_rssi_data(hours)
        summary = calculate_summary(hours)
        last_updated = datetime.utcnow().isoformat() + 'Z'

        # Update cache
        cache.set(CACHE_KEY_POLAR, polar, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_RSSI, rssi, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_SUMMARY, summary, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_LAST_UPDATED, last_updated, timeout=CACHE_TIMEOUT)

        duration = (datetime.now() - start).total_seconds()
        logger.debug(f"Antenna analytics cache refreshed in {duration:.2f}s")

        return {
            'polar': polar,
            'rssi': rssi,
            'summary': summary,
            'last_updated': last_updated,
        }

    except Exception as e:
        logger.error(f"Error refreshing antenna cache: {e}")
        return {}


def broadcast_antenna_update(data: dict = None):
    """Broadcast antenna analytics update via WebSocket."""
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    try:
        if data is None:
            data = get_cached_data()

        channel_layer = get_channel_layer()
        if channel_layer:
            sync_group_send(
                channel_layer,
                'aircraft_all',
                {
                    'type': 'antenna_analytics_update',
                    'data': data
                }
            )
            logger.debug("Antenna analytics broadcast sent")
    except Exception as e:
        logger.error(f"Error broadcasting antenna analytics: {e}")


def get_cached_data() -> dict:
    """Get all cached antenna analytics data."""
    return {
        'polar': cache.get(CACHE_KEY_POLAR),
        'rssi': cache.get(CACHE_KEY_RSSI),
        'summary': cache.get(CACHE_KEY_SUMMARY),
        'last_updated': cache.get(CACHE_KEY_LAST_UPDATED),
    }


def get_cached_polar() -> Optional[dict]:
    """Get cached polar data."""
    return cache.get(CACHE_KEY_POLAR)


def get_cached_rssi() -> Optional[dict]:
    """Get cached RSSI data."""
    return cache.get(CACHE_KEY_RSSI)


def get_cached_summary() -> Optional[dict]:
    """Get cached summary."""
    return cache.get(CACHE_KEY_SUMMARY)


def get_or_calculate_polar(hours: int = 24) -> dict:
    """Get cached polar data or calculate if not available."""
    cached = get_cached_polar()
    if cached and cached.get('time_range_hours') == hours:
        return cached
    return calculate_polar_data(hours)


def get_or_calculate_rssi(hours: int = 24, sample_size: int = 500) -> dict:
    """Get cached RSSI data or calculate if not available."""
    cached = get_cached_rssi()
    if cached and cached.get('time_range_hours') == hours:
        return cached
    return calculate_rssi_data(hours, sample_size)


def get_or_calculate_summary(hours: int = 24) -> dict:
    """Get cached summary or calculate if not available."""
    cached = get_cached_summary()
    if cached and cached.get('time_range_hours') == hours:
        return cached
    return calculate_summary(hours)
