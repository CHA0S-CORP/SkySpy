"""
Analytics and metrics calculation tasks.

Uses the comprehensive stats_cache service for:
- History stats (aggregate historical data)
- History trends (time-series data)
- Top performers
- Safety statistics
"""
import logging
from datetime import datetime, timedelta
from collections import defaultdict

from celery import shared_task
from django.core.cache import cache
from django.db.models import Count, Avg, Max, Min, F
from django.utils import timezone

from skyspy.models import AircraftSighting, AircraftSession
from skyspy.services.stats_cache import (
    refresh_history_cache,
    refresh_safety_cache,
    update_aircraft_stats_cache,
    refresh_acars_stats_cache,
    refresh_tracking_quality_cache,
    refresh_engagement_cache,
    refresh_flight_patterns_cache,
    refresh_geographic_cache,
)
from skyspy.services.flight_pattern_stats import (
    refresh_all_stats_cache as refresh_flight_pattern_stats_cache_v2,
)

logger = logging.getLogger(__name__)


@shared_task
def update_antenna_analytics():
    """
    Update antenna performance analytics.

    Calculates:
    - Reception range by direction (12 sectors of 30 degrees each)
    - Signal strength statistics (RSSI)
    - Message rates and coverage percentages
    - Range percentiles (p50, p75, p90, p95)

    Stores snapshot to database and broadcasts via WebSocket.
    Runs every 5 minutes.
    """
    logger.debug("Updating antenna analytics")

    from django.conf import settings
    from skyspy.models import AntennaAnalyticsSnapshot
    from skyspy.socketio.utils import sync_emit
    import math
    import numpy as np

    cutoff = timezone.now() - timedelta(hours=1)
    now = timezone.now()

    # Get sightings from last hour
    sightings = AircraftSighting.objects.filter(
        timestamp__gte=cutoff,
        latitude__isnull=False,
        longitude__isnull=False
    )

    if not sightings.exists():
        # Store empty snapshot
        analytics = {
            'max_range_by_direction': {},
            'overall_max_range': None,
            'avg_range': 0,
            'min_range': None,
            'total_positions': 0,
            'unique_aircraft': 0,
            'avg_rssi': None,
            'best_rssi': None,
            'worst_rssi': None,
            'positions_per_hour': 0,
            'sectors_with_data': 0,
            'coverage_percentage': 0,
            'range_percentiles': {'p50': None, 'p75': None, 'p90': None, 'p95': None},
            'timestamp': now.isoformat() + 'Z',
        }
        cache.set('antenna_analytics', analytics, timeout=600)
        return analytics

    feeder_lat = settings.FEEDER_LAT
    feeder_lon = settings.FEEDER_LON

    direction_data = defaultdict(lambda: {'distances': [], 'rssi': [], 'aircraft': set()})
    all_distances = []
    all_rssi = []

    for s in sightings.values('latitude', 'longitude', 'distance_nm', 'rssi', 'icao_hex'):
        if s['distance_nm'] is None:
            continue

        # Calculate bearing
        lat = s['latitude']
        lon = s['longitude']

        dlat = math.radians(lat - feeder_lat)
        dlon = math.radians(lon - feeder_lon)

        x = math.sin(dlon) * math.cos(math.radians(lat))
        y = (math.cos(math.radians(feeder_lat)) * math.sin(math.radians(lat)) -
             math.sin(math.radians(feeder_lat)) * math.cos(math.radians(lat)) * math.cos(dlon))

        bearing = math.degrees(math.atan2(x, y))
        bearing = (bearing + 360) % 360

        # Group into 30-degree sectors
        sector = int(bearing / 30) * 30
        direction_data[sector]['distances'].append(s['distance_nm'])
        direction_data[sector]['aircraft'].add(s['icao_hex'])
        if s['rssi'] is not None:
            direction_data[sector]['rssi'].append(s['rssi'])

        all_distances.append(s['distance_nm'])
        if s['rssi'] is not None:
            all_rssi.append(s['rssi'])

    # Calculate range by direction with detailed stats
    range_by_direction = {}
    for sector in range(0, 360, 30):
        if sector in direction_data:
            data = direction_data[sector]
            range_by_direction[sector] = {
                'max_range': round(max(data['distances']), 1),
                'avg_range': round(sum(data['distances']) / len(data['distances']), 1),
                'position_count': len(data['distances']),
                'unique_aircraft': len(data['aircraft']),
                'avg_rssi': round(sum(data['rssi']) / len(data['rssi']), 1) if data['rssi'] else None,
            }
        else:
            range_by_direction[sector] = {
                'max_range': None,
                'avg_range': None,
                'position_count': 0,
                'unique_aircraft': 0,
                'avg_rssi': None,
            }

    # Legacy format for compatibility
    max_range_by_direction = {
        sector: data['max_range']
        for sector, data in range_by_direction.items()
        if data['max_range'] is not None
    }

    # Calculate percentiles
    if all_distances:
        distances_array = np.array(all_distances)
        range_percentiles = {
            'p50': round(float(np.percentile(distances_array, 50)), 1),
            'p75': round(float(np.percentile(distances_array, 75)), 1),
            'p90': round(float(np.percentile(distances_array, 90)), 1),
            'p95': round(float(np.percentile(distances_array, 95)), 1),
        }
    else:
        range_percentiles = {'p50': None, 'p75': None, 'p90': None, 'p95': None}

    # Overall statistics
    stats = sightings.aggregate(
        total_positions=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        avg_distance=Avg('distance_nm'),
        max_distance=Max('distance_nm'),
        min_distance=Min('distance_nm'),
        avg_rssi=Avg('rssi'),
        max_rssi=Max('rssi'),  # Best signal (less negative = stronger)
        min_rssi=Min('rssi'),  # Weakest signal (more negative = weaker)
    )

    # Coverage analysis
    sectors_with_data = sum(1 for s in range(0, 360, 30) if s in direction_data)
    coverage_percentage = round((sectors_with_data / 12) * 100, 1)

    analytics = {
        'max_range_by_direction': max_range_by_direction,
        'range_by_direction': range_by_direction,
        'overall_max_range': stats['max_distance'],
        'avg_range': round(stats['avg_distance'] or 0, 1),
        'min_range': stats['min_distance'],
        'total_positions': stats['total_positions'],
        'unique_aircraft': stats['unique_aircraft'],
        'avg_rssi': round(stats['avg_rssi'], 1) if stats['avg_rssi'] else None,
        'best_rssi': round(stats['max_rssi'], 1) if stats['max_rssi'] else None,
        'worst_rssi': round(stats['min_rssi'], 1) if stats['min_rssi'] else None,
        'positions_per_hour': stats['total_positions'],
        'sectors_with_data': sectors_with_data,
        'coverage_percentage': coverage_percentage,
        'range_percentiles': range_percentiles,
        'timestamp': now.isoformat() + 'Z',
    }

    # Store in cache
    cache.set('antenna_analytics', analytics, timeout=600)

    # Store snapshot in database
    try:
        snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now,
            snapshot_type='scheduled',
            window_hours=1.0,
            max_range_nm=stats['max_distance'],
            avg_range_nm=round(stats['avg_distance'] or 0, 1),
            min_range_nm=stats['min_distance'],
            range_p50_nm=range_percentiles['p50'],
            range_p75_nm=range_percentiles['p75'],
            range_p90_nm=range_percentiles['p90'],
            range_p95_nm=range_percentiles['p95'],
            best_rssi=stats['max_rssi'],
            avg_rssi=round(stats['avg_rssi'], 1) if stats['avg_rssi'] else None,
            worst_rssi=stats['min_rssi'],
            total_positions=stats['total_positions'],
            unique_aircraft=stats['unique_aircraft'],
            positions_per_hour=float(stats['total_positions']),
            range_by_direction=range_by_direction,
            sectors_with_data=sectors_with_data,
            coverage_percentage=coverage_percentage,
        )
        logger.debug(f"Stored antenna analytics snapshot {snapshot.id}")
    except Exception as e:
        logger.error(f"Failed to store antenna analytics snapshot: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'update_antenna_analytics', extra={'step': 'store_snapshot'})
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")

    # Broadcast via Socket.IO
    try:
        sync_emit(
            'antenna:analytics_update',
            analytics,
            room='topic_aircraft'
        )
        logger.debug("Broadcast antenna analytics update")
    except Exception as e:
        logger.warning(f"Failed to broadcast antenna analytics: {e}")

    if stats['max_distance']:
        logger.debug(f"Updated antenna analytics: max range {stats['max_distance']:.1f}nm, coverage {coverage_percentage}%")

    return analytics


@shared_task
def calculate_daily_stats():
    """
    Calculate daily statistics for reporting.

    Generates:
    - Daily aircraft counts
    - Peak traffic times
    - Military activity
    - Coverage statistics
    """
    today = timezone.now().date()
    yesterday = today - timedelta(days=1)

    # Get yesterday's sightings
    start = datetime.combine(yesterday, datetime.min.time())
    end = datetime.combine(today, datetime.min.time())

    sightings = AircraftSighting.objects.filter(
        timestamp__gte=start,
        timestamp__lt=end
    )

    sessions = AircraftSession.objects.filter(
        last_seen__gte=start,
        last_seen__lt=end
    )

    stats = {
        'date': yesterday.isoformat(),
        'total_sightings': sightings.count(),
        'unique_aircraft': sightings.values('icao_hex').distinct().count(),
        'total_sessions': sessions.count(),
        'military_sessions': sessions.filter(is_military=True).count(),
        'max_concurrent': 0,  # Would need more complex calculation
        'avg_distance': round(
            sightings.aggregate(Avg('distance_nm'))['distance_nm__avg'] or 0,
            1
        ),
        'max_distance': sightings.aggregate(Max('distance_nm'))['distance_nm__max'] or 0,
    }

    # Store in cache for quick retrieval
    cache_key = f'daily_stats_{yesterday.isoformat()}'
    cache.set(cache_key, stats, timeout=86400 * 7)  # Keep for 7 days

    logger.info(f"Daily stats for {yesterday}: {stats['unique_aircraft']} aircraft")

    return stats


@shared_task
def refresh_history_stats():
    """
    Refresh history statistics cache.

    Calculates and caches:
    - Aggregate historical data (24h rolling)
    - Time-series trends (hourly buckets)
    - Top performers (longest tracked, furthest, highest, etc.)

    Runs every 60 seconds.
    """
    try:
        refresh_history_cache()
        logger.debug("History stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing history stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_history_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def refresh_safety_stats():
    """
    Refresh safety statistics cache.

    Calculates and caches:
    - Events by type and severity
    - Type/severity cross-tabulation
    - Unique aircraft count
    - Event rate per hour
    - Hourly distribution
    - Top aircraft by event count
    - Recent events

    Runs every 30 seconds.
    """
    try:
        refresh_safety_cache()
        logger.debug("Safety stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing safety stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_safety_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def refresh_acars_stats():
    """
    Refresh ACARS/VDL2 statistics cache.

    Calculates and caches:
    - Message type breakdown (by label and category)
    - Source breakdown (ACARS vs VDL2)
    - Airline activity statistics
    - Message trends over time
    - Peak activity times
    - Hourly distribution

    Runs every 60 seconds.
    """
    try:
        refresh_acars_stats_cache()
        logger.debug("ACARS stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing ACARS stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_acars_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def update_realtime_stats():
    """
    Update real-time aircraft statistics from polling data.

    Called from the aircraft polling task to update:
    - Current aircraft stats (total, with position, military, emergency)
    - Top aircraft (closest, highest, fastest, climbing, military)

    This is called frequently (every poll cycle) so it must be fast.
    """
    # Get current aircraft from cache
    aircraft_list = cache.get('current_aircraft', [])

    if aircraft_list:
        try:
            update_aircraft_stats_cache(aircraft_list)
            logger.debug(f"Updated realtime stats for {len(aircraft_list)} aircraft")
        except Exception as e:
            logger.error(f"Error updating realtime stats: {e}")


@shared_task
def cleanup_memory_cache():
    """
    Clean up expired entries from in-memory caches.

    Runs periodically (every 5 minutes) to free memory from:
    - Expired memory cache entries
    - Old rate limit timestamps
    - Notification cooldowns
    - Seen aircraft tracking

    This is critical for preventing unbounded memory growth in long-running processes.
    """
    from skyspy.services.cache import cleanup_all_caches, get_cache_stats

    try:
        # Get stats before cleanup
        stats_before = get_cache_stats()

        # Clean all caches
        cleanup_all_caches()

        # Clean seen aircraft from aircraft tasks
        from skyspy.tasks.aircraft import _seen_aircraft, _seen_aircraft_max
        if len(_seen_aircraft) > _seen_aircraft_max * 0.8:
            _seen_aircraft.clear()
            logger.info("Cleared seen aircraft tracking set")

        # Get stats after cleanup
        stats_after = get_cache_stats()

        logger.debug(
            f"Memory cache cleanup complete: "
            f"memory_cache {stats_before['memory_cache_entries']} -> {stats_after['memory_cache_entries']}, "
            f"rate_limits {stats_before['rate_limit_entries']} -> {stats_after['rate_limit_entries']}"
        )
    except Exception as e:
        logger.error(f"Error cleaning up memory cache: {e}")


@shared_task
def cleanup_antenna_analytics_snapshots(retention_days: int = 7):
    """
    Clean up old antenna analytics snapshots.

    Deletes scheduled snapshots older than retention_days (default 7).
    Keeps hourly and daily aggregates longer.

    Runs daily at 4 AM.
    """
    from skyspy.models import AntennaAnalyticsSnapshot

    try:
        cutoff = timezone.now() - timedelta(days=retention_days)

        # Delete old scheduled (5-min) snapshots
        deleted_scheduled, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=cutoff,
            snapshot_type='scheduled'
        ).delete()

        # Delete hourly snapshots older than 30 days
        hourly_cutoff = timezone.now() - timedelta(days=30)
        deleted_hourly, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=hourly_cutoff,
            snapshot_type='hourly'
        ).delete()

        # Delete daily snapshots older than 365 days
        daily_cutoff = timezone.now() - timedelta(days=365)
        deleted_daily, _ = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__lt=daily_cutoff,
            snapshot_type='daily'
        ).delete()

        total_deleted = deleted_scheduled + deleted_hourly + deleted_daily
        logger.info(
            f"Antenna analytics cleanup: deleted {deleted_scheduled} scheduled, "
            f"{deleted_hourly} hourly, {deleted_daily} daily snapshots"
        )

        return {
            'scheduled_deleted': deleted_scheduled,
            'hourly_deleted': deleted_hourly,
            'daily_deleted': deleted_daily,
            'total_deleted': total_deleted
        }

    except Exception as e:
        logger.error(f"Error cleaning up antenna analytics snapshots: {e}")
        return {'error': str(e)}


@shared_task
def aggregate_hourly_antenna_analytics():
    """
    Aggregate scheduled snapshots into hourly summaries.

    Runs every hour to create consolidated hourly snapshots
    from the 5-minute scheduled snapshots.
    """
    from skyspy.models import AntennaAnalyticsSnapshot
    from django.db.models import Avg, Max, Min, Sum

    try:
        # Get the previous hour's time range
        now = timezone.now()
        hour_end = now.replace(minute=0, second=0, microsecond=0)
        hour_start = hour_end - timedelta(hours=1)

        # Check if hourly aggregate already exists
        existing = AntennaAnalyticsSnapshot.objects.filter(
            timestamp=hour_end,
            snapshot_type='hourly'
        ).exists()

        if existing:
            logger.debug(f"Hourly aggregate for {hour_end} already exists")
            return None

        # Get scheduled snapshots for the hour
        snapshots = AntennaAnalyticsSnapshot.objects.filter(
            timestamp__gte=hour_start,
            timestamp__lt=hour_end,
            snapshot_type='scheduled'
        )

        if not snapshots.exists():
            logger.debug(f"No scheduled snapshots for hour ending {hour_end}")
            return None

        # Aggregate statistics
        agg = snapshots.aggregate(
            avg_max_range=Avg('max_range_nm'),
            max_max_range=Max('max_range_nm'),
            avg_avg_range=Avg('avg_range_nm'),
            avg_coverage=Avg('coverage_percentage'),
            max_coverage=Max('coverage_percentage'),
            total_positions=Sum('total_positions'),
            max_unique_aircraft=Max('unique_aircraft'),
            avg_best_rssi=Avg('best_rssi'),
            avg_avg_rssi=Avg('avg_rssi'),
            avg_worst_rssi=Avg('worst_rssi'),
        )

        # Get the latest direction data (most representative)
        latest = snapshots.order_by('-timestamp').first()
        range_by_direction = latest.range_by_direction if latest else {}

        # Create hourly aggregate
        hourly_snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=hour_end,
            snapshot_type='hourly',
            window_hours=1.0,
            max_range_nm=agg['max_max_range'],
            avg_range_nm=round(agg['avg_avg_range'] or 0, 1),
            best_rssi=round(agg['avg_best_rssi'], 1) if agg['avg_best_rssi'] else None,
            avg_rssi=round(agg['avg_avg_rssi'], 1) if agg['avg_avg_rssi'] else None,
            worst_rssi=round(agg['avg_worst_rssi'], 1) if agg['avg_worst_rssi'] else None,
            total_positions=agg['total_positions'] or 0,
            unique_aircraft=agg['max_unique_aircraft'] or 0,
            positions_per_hour=float(agg['total_positions'] or 0),
            coverage_percentage=round(agg['avg_coverage'] or 0, 1),
            range_by_direction=range_by_direction,
        )

        logger.info(f"Created hourly antenna analytics aggregate for {hour_end}")
        return hourly_snapshot.id

    except Exception as e:
        logger.error(f"Error aggregating hourly antenna analytics: {e}")
        return None


@shared_task
def refresh_tracking_quality_stats():
    """
    Refresh tracking quality statistics cache.

    Calculates and caches:
    - Average position update rate per aircraft (positions per minute)
    - Session completeness scores (% of expected positions received)
    - Quality grade distribution (excellent, good, fair, poor)
    - Top and worst quality sessions

    Runs every 2 minutes.
    """
    try:
        refresh_tracking_quality_cache()
        logger.debug("Tracking quality stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing tracking quality stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_tracking_quality_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def refresh_engagement_stats():
    """
    Refresh engagement statistics cache.

    Calculates and caches:
    - Most favorited/watched aircraft
    - Peak concurrent tracking sessions
    - Return visitors (aircraft seen multiple times)
    - Favorite activity statistics

    Runs every 2 minutes.
    """
    try:
        refresh_engagement_cache()
        logger.debug("Engagement stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing engagement stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_engagement_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def refresh_flight_patterns_stats():
    """
    Refresh flight patterns statistics cache.

    Calculates and caches:
    - Busiest hours of the day (for heatmap visualization)
    - Average flight duration by aircraft type
    - Most common aircraft types/models
    - Frequent airline routes (based on callsign analysis)

    Runs every 2 minutes.
    """
    try:
        refresh_flight_patterns_cache()
        logger.debug("Flight patterns stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing flight patterns stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_flight_patterns_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def refresh_geographic_stats():
    """
    Refresh geographic statistics cache.

    Calculates and caches:
    - Countries of origin breakdown (from registration prefixes)
    - Airlines/operators frequency
    - Most connected cities/locations
    - Military vs civilian breakdown by country

    Runs every 2 minutes.
    """
    try:
        refresh_geographic_cache()
        logger.debug("Geographic stats cache refreshed")
    except Exception as e:
        logger.error(f"Error refreshing geographic stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_geographic_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def update_favorite_tracking():
    """
    Update tracking statistics for favorited aircraft.

    When favorited aircraft are seen, updates:
    - times_seen counter
    - last_seen_at timestamp
    - total_tracking_minutes

    Runs every 5 minutes.
    """
    from skyspy.models import AircraftFavorite, AircraftSession

    try:
        cutoff = timezone.now() - timedelta(minutes=5)

        # Get recently active sessions
        recent_sessions = AircraftSession.objects.filter(
            last_seen__gte=cutoff
        ).values('icao_hex', 'total_positions', 'first_seen', 'last_seen')

        session_map = {s['icao_hex']: s for s in recent_sessions}

        # Update favorites for active aircraft
        favorites_to_update = AircraftFavorite.objects.filter(
            icao_hex__in=session_map.keys()
        )

        updated_count = 0
        for fav in favorites_to_update:
            session = session_map.get(fav.icao_hex)
            if session:
                fav.times_seen = F('times_seen') + 1
                fav.last_seen_at = session['last_seen']

                # Calculate tracking minutes for this period
                duration = (session['last_seen'] - session['first_seen']).total_seconds() / 60
                fav.total_tracking_minutes = F('total_tracking_minutes') + duration

                fav.save(update_fields=['times_seen', 'last_seen_at', 'total_tracking_minutes'])
                updated_count += 1

        if updated_count > 0:
            logger.debug(f"Updated tracking stats for {updated_count} favorited aircraft")

    except Exception as e:
        logger.error(f"Error updating favorite tracking: {e}")


@shared_task
def refresh_time_comparison_stats():
    """
    Refresh time comparison statistics cache.

    Calculates and caches:
    - Week-over-week comparison
    - Seasonal trends (monthly aggregates)
    - Day vs night traffic ratios
    - Weekend vs weekday patterns
    - Daily totals (30 days)
    - Weekly totals (12 weeks)
    - Monthly totals (12 months)

    Runs every 5 minutes. These calculations can be expensive, so
    we cache them aggressively and update periodically.
    """
    try:
        from skyspy.services.time_comparison_stats import refresh_time_comparison_cache
        result = refresh_time_comparison_cache()
        if result:
            logger.debug("Time comparison stats cache refreshed")
        return result
    except Exception as e:
        logger.error(f"Error refreshing time comparison stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_time_comparison_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")
        return None


@shared_task
def refresh_flight_pattern_geographic_stats():
    """
    Refresh flight pattern and geographic statistics cache.

    Calculates and caches comprehensive statistics from the new flight_pattern_stats service:

    Flight Patterns:
    - Most frequent routes/city pairs (from ACARS and callsign analysis)
    - Busiest hours of the day (for heatmap visualization)
    - Average flight duration by aircraft type
    - Most common aircraft types/models

    Geographic Stats:
    - Countries of origin breakdown (from registration prefixes)
    - Airlines/operators frequency
    - Airports most connected to coverage area
    - Military vs civilian breakdown by country

    Runs every 2 minutes.
    """
    try:
        result = refresh_flight_pattern_stats_cache_v2()
        if result:
            logger.debug("Flight pattern and geographic stats cache refreshed (v2)")
        return result
    except Exception as e:
        logger.error(f"Error refreshing flight pattern geographic stats: {e}")
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'refresh_flight_pattern_geographic_stats')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")
        return None
