"""
Stats Cache Service.

Provides cached statistics that are calculated periodically in background jobs
and served immediately to clients.

Cached Stats:
- Aircraft stats (current aircraft breakdown)
- Top aircraft (closest, highest, fastest, etc.)
- History stats (aggregate historical data)
- History trends (time-series data)
- History top performers
- Safety stats (event summaries)

Update Intervals:
- Aircraft stats: Updated from polling loop
- History stats: 60 seconds
- Safety stats: 30 seconds

RPi Optimizations:
- Lite mode: Sample data instead of processing all records
- Configurable sample size via MAX_STATS_SAMPLE_SIZE setting
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Avg, Max, Min, Sum, F, Q
from django.db.models import ExpressionWrapper, F
from django.db.models.functions import TruncHour, TruncDay, ExtractHour, Extract
from django.utils import timezone

from skyspy.models import AircraftSighting, AircraftSession, SafetyEvent, AircraftInfo, AircraftFavorite


# =============================================================================
# RPi Optimization: Lite Mode Configuration
# =============================================================================
# When RPI_LITE_MODE is enabled, stats calculations will sample data
# instead of processing all records, reducing CPU and memory usage.

RPI_LITE_MODE = getattr(settings, 'RPI_LITE_MODE', False)
MAX_STATS_SAMPLE_SIZE = getattr(settings, 'MAX_STATS_SAMPLE_SIZE', 5000)


def _apply_lite_mode_sampling(queryset, sample_size: int = None):
    """
    Apply sampling to queryset if lite mode is enabled.

    In lite mode, limits the queryset to a sample for faster calculations.
    Uses timestamp-based ordering for representative sampling.

    Args:
        queryset: Django QuerySet to sample
        sample_size: Maximum records to process (default: MAX_STATS_SAMPLE_SIZE)

    Returns:
        Sampled QuerySet if lite mode enabled, original otherwise
    """
    if not RPI_LITE_MODE:
        return queryset

    size = sample_size or MAX_STATS_SAMPLE_SIZE

    # Use timestamp-based ordering for more representative sampling
    # (avoids random ordering which is slow on large tables)
    count = queryset.count()
    if count <= size:
        return queryset

    logger.debug(f"Lite mode: sampling {size} from {count} records")
    return queryset.order_by('-timestamp')[:size]

class ExtractEpoch(Extract):
    lookup_name = "epoch"

logger = logging.getLogger(__name__)

# Cache keys
CACHE_KEY_AIRCRAFT_STATS = 'stats:aircraft'
CACHE_KEY_TOP_AIRCRAFT = 'stats:top'
CACHE_KEY_HISTORY_STATS = 'stats:history'
CACHE_KEY_HISTORY_TRENDS = 'stats:trends'
CACHE_KEY_HISTORY_TOP = 'stats:top_performers'
CACHE_KEY_SAFETY_STATS = 'stats:safety'
CACHE_KEY_FLIGHT_PATTERNS = 'stats:flight_patterns'
CACHE_KEY_GEOGRAPHIC_STATS = 'stats:geographic'
CACHE_KEY_TRACKING_QUALITY = 'stats:tracking_quality'
CACHE_KEY_ENGAGEMENT = 'stats:engagement'

# Cache timeouts (seconds)
AIRCRAFT_STATS_TIMEOUT = 30
HISTORY_STATS_TIMEOUT = 120
SAFETY_STATS_TIMEOUT = 60
FLIGHT_PATTERNS_TIMEOUT = 300  # 5 minutes
GEOGRAPHIC_STATS_TIMEOUT = 300  # 5 minutes
TRACKING_QUALITY_TIMEOUT = 300  # 5 minutes
ENGAGEMENT_TIMEOUT = 300  # 5 minutes

# Update intervals
HISTORY_STATS_INTERVAL = 60  # 1 minute
SAFETY_STATS_INTERVAL = 30   # 30 seconds
FLIGHT_PATTERNS_INTERVAL = 120  # 2 minutes
GEOGRAPHIC_STATS_INTERVAL = 120  # 2 minutes
TRACKING_QUALITY_INTERVAL = 120  # 2 minutes
ENGAGEMENT_INTERVAL = 120  # 2 minutes

# Default expected update interval (seconds) - typical ADS-B update rate
DEFAULT_EXPECTED_UPDATE_INTERVAL = 5  # seconds
# Gap threshold - consider it a coverage gap if no position for this long
COVERAGE_GAP_THRESHOLD = 30  # seconds


def _is_valid_position(lat, lon):
    """Check if coordinates are valid."""
    if lat is None or lon is None:
        return False
    try:
        lat = float(lat)
        lon = float(lon)
        return -90 <= lat <= 90 and -180 <= lon <= 180
    except (TypeError, ValueError):
        return False


def _simplify_aircraft(aircraft: dict, distance_nm: float = None) -> dict:
    """Create simplified aircraft dict for top lists."""
    return {
        "hex": aircraft.get("hex"),
        "flight": aircraft.get("flight", "").strip() if aircraft.get("flight") else None,
        "alt_baro": aircraft.get("alt_baro"),
        "gs": aircraft.get("gs"),
        "baro_rate": aircraft.get("baro_rate"),
        "distance_nm": distance_nm or aircraft.get("distance_nm"),
        "lat": aircraft.get("lat"),
        "lon": aircraft.get("lon"),
        "category": aircraft.get("category"),
        "dbFlags": aircraft.get("dbFlags", 0),
    }


def calculate_aircraft_stats(aircraft_list: list[dict]) -> dict:
    """Calculate aircraft stats from in-memory aircraft list."""
    now = timezone.now()

    with_pos = sum(1 for a in aircraft_list if _is_valid_position(a.get("lat"), a.get("lon")))
    military_count = sum(1 for a in aircraft_list if a.get("dbFlags", 0) & 1)
    emergency = [
        {"hex": a.get("hex"), "flight": a.get("flight"), "squawk": a.get("squawk")}
        for a in aircraft_list if a.get("squawk") in ["7500", "7600", "7700"]
    ]

    # Category breakdown
    categories_count = {}
    for a in aircraft_list:
        cat = a.get("category", "unknown")
        categories_count[cat] = categories_count.get(cat, 0) + 1

    # Altitude breakdown
    alt_ground = sum(
        1 for a in aircraft_list
        if a.get("alt_baro") == "ground" or
        (isinstance(a.get("alt_baro"), (int, float)) and a.get("alt_baro", 99999) <= 0)
    )
    alt_low = sum(
        1 for a in aircraft_list
        if isinstance(a.get("alt_baro"), (int, float)) and 0 < a["alt_baro"] < 10000
    )
    alt_med = sum(
        1 for a in aircraft_list
        if isinstance(a.get("alt_baro"), (int, float)) and 10000 <= a["alt_baro"] < 30000
    )
    alt_high = sum(
        1 for a in aircraft_list
        if isinstance(a.get("alt_baro"), (int, float)) and a["alt_baro"] >= 30000
    )

    # Distance breakdown
    dist_close = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and a["distance_nm"] < 25)
    dist_near = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and 25 <= a["distance_nm"] < 50)
    dist_mid = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and 50 <= a["distance_nm"] < 100)
    dist_far = sum(1 for a in aircraft_list if a.get("distance_nm") is not None and a["distance_nm"] >= 100)

    # Speed breakdown
    speed_slow = sum(1 for a in aircraft_list if a.get("gs") and a["gs"] < 200)
    speed_med = sum(1 for a in aircraft_list if a.get("gs") and 200 <= a["gs"] < 400)
    speed_fast = sum(1 for a in aircraft_list if a.get("gs") and a["gs"] >= 400)

    return {
        "total": len(aircraft_list),
        "with_position": with_pos,
        "military": military_count,
        "emergency": emergency,
        "categories": categories_count,
        "altitude": {"ground": alt_ground, "low": alt_low, "medium": alt_med, "high": alt_high},
        "distance": {"close": dist_close, "near": dist_near, "mid": dist_mid, "far": dist_far},
        "speed": {"slow": speed_slow, "medium": speed_med, "fast": speed_fast},
        "timestamp": now.isoformat() + "Z"
    }


def calculate_top_aircraft(aircraft_list: list[dict]) -> dict:
    """Calculate top aircraft from in-memory aircraft list."""
    now = timezone.now()

    # Top 5 by closest
    closest = sorted(
        [a for a in aircraft_list if _is_valid_position(a.get("lat"), a.get("lon"))],
        key=lambda x: x.get("distance_nm") if x.get("distance_nm") is not None else 99999
    )[:5]

    # Top 5 by altitude
    highest = sorted(
        [a for a in aircraft_list if isinstance(a.get("alt_baro"), (int, float))],
        key=lambda x: x["alt_baro"],
        reverse=True
    )[:5]

    # Top 5 by speed
    fastest = sorted(
        [a for a in aircraft_list if a.get("gs")],
        key=lambda x: x["gs"],
        reverse=True
    )[:5]

    # Top 5 by vertical rate
    climbing = sorted(
        [a for a in aircraft_list if a.get("baro_rate")],
        key=lambda x: abs(x.get("baro_rate", 0)),
        reverse=True
    )[:5]

    # Military
    military = [a for a in aircraft_list if a.get("dbFlags", 0) & 1][:5]

    return {
        "closest": [_simplify_aircraft(a, a.get("distance_nm")) for a in closest],
        "highest": [_simplify_aircraft(a, a.get("distance_nm")) for a in highest],
        "fastest": [_simplify_aircraft(a, a.get("distance_nm")) for a in fastest],
        "climbing": [_simplify_aircraft(a, a.get("distance_nm")) for a in climbing],
        "military": [_simplify_aircraft(a, a.get("distance_nm")) for a in military],
        "total": len(aircraft_list),
        "timestamp": now.isoformat() + "Z"
    }


def update_aircraft_stats_cache(aircraft_list: list[dict], broadcast: bool = False):
    """Update aircraft stats cache from polling loop."""
    stats = calculate_aircraft_stats(aircraft_list)
    top = calculate_top_aircraft(aircraft_list)

    cache.set(CACHE_KEY_AIRCRAFT_STATS, stats, timeout=AIRCRAFT_STATS_TIMEOUT)
    cache.set(CACHE_KEY_TOP_AIRCRAFT, top, timeout=AIRCRAFT_STATS_TIMEOUT)

    # Broadcast updates (optional, usually off for high-frequency updates)
    if broadcast:
        broadcast_stats_update('aircraft', stats)
        broadcast_stats_update('top', top)


def calculate_history_stats(hours: int = 24) -> dict:
    """Calculate historical statistics."""
    cutoff = timezone.now() - timedelta(hours=hours)

    sightings_count = AircraftSighting.objects.filter(timestamp__gt=cutoff).count()
    sessions_count = AircraftSession.objects.filter(last_seen__gt=cutoff).count()
    unique_aircraft = AircraftSession.objects.filter(last_seen__gt=cutoff).values('icao_hex').distinct().count()
    military_sessions = AircraftSession.objects.filter(last_seen__gt=cutoff, is_military=True).count()

    # Altitude stats
    alt_stats = AircraftSighting.objects.filter(
        timestamp__gt=cutoff,
        altitude_baro__isnull=False
    ).aggregate(
        avg_alt=Avg('altitude_baro'),
        max_alt=Max('altitude_baro'),
        min_alt=Min('altitude_baro')
    )

    # Distance stats
    dist_stats = AircraftSighting.objects.filter(
        timestamp__gt=cutoff,
        distance_nm__isnull=False
    ).aggregate(
        avg_dist=Avg('distance_nm'),
        max_dist=Max('distance_nm'),
        min_dist=Min('distance_nm')
    )

    # Speed stats
    speed_stats = AircraftSighting.objects.filter(
        timestamp__gt=cutoff,
        ground_speed__isnull=False
    ).aggregate(
        avg_speed=Avg('ground_speed'),
        max_speed=Max('ground_speed')
    )

    return {
        "total_sightings": sightings_count,
        "total_sessions": sessions_count,
        "unique_aircraft": unique_aircraft,
        "military_sessions": military_sessions,
        "time_range_hours": hours,
        "avg_altitude": round(alt_stats['avg_alt']) if alt_stats['avg_alt'] else None,
        "max_altitude": alt_stats['max_alt'],
        "min_altitude": alt_stats['min_alt'],
        "avg_distance_nm": round(dist_stats['avg_dist'], 1) if dist_stats['avg_dist'] else None,
        "max_distance_nm": round(dist_stats['max_dist'], 1) if dist_stats['max_dist'] else None,
        "avg_speed": round(speed_stats['avg_speed']) if speed_stats['avg_speed'] else None,
        "max_speed": round(speed_stats['max_speed']) if speed_stats['max_speed'] else None,
        "timestamp": timezone.now().isoformat() + "Z"
    }


def calculate_history_trends(hours: int = 24, interval: str = "hour") -> dict:
    """Calculate time-series trend data."""
    cutoff = timezone.now() - timedelta(hours=hours)

    if interval == "day":
        trunc_func = TruncDay
    else:
        trunc_func = TruncHour

    trends = (
        AircraftSighting.objects.filter(timestamp__gt=cutoff)
        .annotate(interval_start=trunc_func('timestamp'))
        .values('interval_start')
        .annotate(
            position_count=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            military_count=Count('id', filter=Q(is_military=True)),
            avg_altitude=Avg('altitude_baro'),
            max_altitude=Max('altitude_baro'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            avg_speed=Avg('ground_speed'),
            max_speed=Max('ground_speed')
        )
        .order_by('interval_start')
    )

    intervals = []
    peak_concurrent = 0
    peak_interval = None

    for row in trends:
        unique = row['unique_aircraft'] or 0
        if unique > peak_concurrent:
            peak_concurrent = unique
            peak_interval = row['interval_start']

        intervals.append({
            "timestamp": row['interval_start'].isoformat() + "Z" if row['interval_start'] else None,
            "position_count": row['position_count'] or 0,
            "unique_aircraft": unique,
            "military_count": row['military_count'] or 0,
            "avg_altitude": round(row['avg_altitude']) if row['avg_altitude'] else None,
            "max_altitude": row['max_altitude'],
            "avg_distance_nm": round(row['avg_distance'], 1) if row['avg_distance'] else None,
            "max_distance_nm": round(row['max_distance'], 1) if row['max_distance'] else None,
            "avg_speed": round(row['avg_speed']) if row['avg_speed'] else None,
            "max_speed": row['max_speed'],
        })

    total_unique = AircraftSighting.objects.filter(
        timestamp__gt=cutoff
    ).values('icao_hex').distinct().count()

    return {
        "intervals": intervals,
        "interval_type": interval,
        "time_range_hours": hours,
        "summary": {
            "total_unique_aircraft": total_unique,
            "peak_concurrent": peak_concurrent,
            "peak_interval": peak_interval.isoformat() + "Z" if peak_interval else None,
            "total_intervals": len(intervals)
        },
        "timestamp": timezone.now().isoformat() + "Z"
    }


def calculate_history_top(hours: int = 24, limit: int = 10) -> dict:
    """Calculate top performing aircraft."""
    cutoff = timezone.now() - timedelta(hours=hours)

    def format_session(s):
        duration = (s.last_seen - s.first_seen).total_seconds() / 60 if s.last_seen and s.first_seen else 0
        return {
            "icao_hex": s.icao_hex,
            "callsign": s.callsign,
            "aircraft_type": s.aircraft_type,
            "is_military": s.is_military,
            "first_seen": s.first_seen.isoformat() + "Z" if s.first_seen else None,
            "last_seen": s.last_seen.isoformat() + "Z" if s.last_seen else None,
            "duration_min": round(duration, 1),
            "positions": s.total_positions,
            "min_distance_nm": round(s.min_distance_nm, 1) if s.min_distance_nm else None,
            "max_distance_nm": round(s.max_distance_nm, 1) if s.max_distance_nm else None,
            "min_altitude": s.min_altitude,
            "max_altitude": s.max_altitude,
        }

    base_qs = AircraftSession.objects.filter(last_seen__gt=cutoff)

    # Longest tracked (by duration)
    longest_tracked = [
        format_session(s) for s in
        base_qs.annotate(
            duration=ExtractEpoch(F('last_seen') - F('first_seen'))
        ).order_by('-duration')[:limit]
    ]

    # Furthest distance
    furthest_distance = [
        format_session(s) for s in
        base_qs.filter(max_distance_nm__isnull=False).order_by('-max_distance_nm')[:limit]
    ]

    # Highest altitude
    highest_altitude = [
        format_session(s) for s in
        base_qs.filter(max_altitude__isnull=False).order_by('-max_altitude')[:limit]
    ]

    # Most positions
    most_positions = [
        format_session(s) for s in
        base_qs.order_by('-total_positions')[:limit]
    ]

    # Closest approach
    closest_approach = [
        format_session(s) for s in
        base_qs.filter(min_distance_nm__isnull=False).order_by('min_distance_nm')[:limit]
    ]

    return {
        "longest_tracked": longest_tracked,
        "furthest_distance": furthest_distance,
        "highest_altitude": highest_altitude,
        "most_positions": most_positions,
        "closest_approach": closest_approach,
        "time_range_hours": hours,
        "limit": limit,
        "timestamp": timezone.now().isoformat() + "Z"
    }


def calculate_safety_stats(hours: int = 24) -> dict:
    """Calculate safety event statistics."""
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    base_qs = SafetyEvent.objects.filter(timestamp__gt=cutoff)

    # Events by type
    events_by_type = dict(
        base_qs.values_list('event_type').annotate(count=Count('id'))
    )

    # Events by severity
    events_by_severity = dict(
        base_qs.values_list('severity').annotate(count=Count('id'))
    )

    # Events by type AND severity
    type_severity = base_qs.values('event_type', 'severity').annotate(count=Count('id'))
    events_by_type_severity = {}
    for row in type_severity:
        event_type = row['event_type']
        severity = row['severity']
        count = row['count']
        if event_type not in events_by_type_severity:
            events_by_type_severity[event_type] = {}
        events_by_type_severity[event_type][severity] = count

    # Unique aircraft count
    unique_aircraft = base_qs.values('icao_hex').distinct().count()

    # Hourly distribution
    events_by_hour = list(
        base_qs.annotate(hour=TruncHour('timestamp'))
        .values('hour')
        .annotate(
            count=Count('id'),
            critical=Count('id', filter=Q(severity='critical')),
            warning=Count('id', filter=Q(severity='warning')),
            low=Count('id', filter=Q(severity='low'))
        )
        .order_by('hour')
    )

    events_by_hour_formatted = [
        {
            "hour": row['hour'].isoformat() + "Z" if row['hour'] else None,
            "count": row['count'] or 0,
            "critical": row['critical'] or 0,
            "warning": row['warning'] or 0,
            "low": row['low'] or 0
        }
        for row in events_by_hour
    ]

    # Top aircraft by event count
    top_aircraft_data = (
        base_qs.values('icao_hex', 'callsign')
        .annotate(count=Count('id'), worst_severity=Max('severity'))
        .order_by('-count')[:10]
    )

    severity_order = {'critical': 3, 'warning': 2, 'low': 1}
    top_aircraft = [
        {
            "icao": row['icao_hex'],
            "callsign": row['callsign'],
            "count": row['count'],
            "worst_severity": row['worst_severity']
        }
        for row in top_aircraft_data
    ]
    top_aircraft.sort(key=lambda x: (-severity_order.get(x['worst_severity'], 0), -x['count']))

    # Recent events
    recent_events = [
        {
            "id": e.id,
            "event_type": e.event_type,
            "severity": e.severity,
            "icao": e.icao_hex,
            "callsign": e.callsign,
            "message": e.message,
            "timestamp": e.timestamp.isoformat() + "Z",
        }
        for e in base_qs.order_by('-timestamp')[:10]
    ]

    total_events = sum(events_by_type.values())
    event_rate = total_events / hours if hours > 0 else 0

    # Get safety thresholds from settings
    thresholds = {
        "vs_change_threshold": settings.SAFETY_VS_CHANGE_THRESHOLD,
        "vs_extreme_threshold": settings.SAFETY_VS_EXTREME_THRESHOLD,
        "proximity_nm": settings.SAFETY_PROXIMITY_NM,
        "altitude_diff_ft": settings.SAFETY_ALTITUDE_DIFF_FT,
        "closure_rate_kt": settings.SAFETY_CLOSURE_RATE_KT,
    }

    return {
        "monitoring_enabled": settings.SAFETY_MONITORING_ENABLED,
        "thresholds": thresholds,
        "time_range_hours": hours,
        "events_by_type": events_by_type,
        "events_by_severity": events_by_severity,
        "events_by_type_severity": events_by_type_severity,
        "total_events": total_events,
        "unique_aircraft": unique_aircraft,
        "event_rate_per_hour": round(event_rate, 2),
        "events_by_hour": events_by_hour_formatted,
        "top_aircraft": top_aircraft,
        "recent_events": recent_events,
        "timestamp": now.isoformat() + "Z",
    }


# =============================================================================
# Registration prefix to country mapping
# =============================================================================

REGISTRATION_PREFIXES = {
    # United States
    'N': 'United States',
    # Canada
    'C-': 'Canada',
    'CF-': 'Canada',
    # United Kingdom
    'G-': 'United Kingdom',
    # Germany
    'D-': 'Germany',
    # France
    'F-': 'France',
    # Australia
    'VH-': 'Australia',
    # Brazil
    'PP-': 'Brazil',
    'PR-': 'Brazil',
    'PT-': 'Brazil',
    'PU-': 'Brazil',
    # Mexico
    'XA-': 'Mexico',
    'XB-': 'Mexico',
    'XC-': 'Mexico',
    # Japan
    'JA': 'Japan',
    # China
    'B-': 'China',
    # Russia
    'RA-': 'Russia',
    # India
    'VT-': 'India',
    # Italy
    'I-': 'Italy',
    # Spain
    'EC-': 'Spain',
    # Netherlands
    'PH-': 'Netherlands',
    # Switzerland
    'HB-': 'Switzerland',
    # Austria
    'OE-': 'Austria',
    # Belgium
    'OO-': 'Belgium',
    # Sweden
    'SE-': 'Sweden',
    # Norway
    'LN-': 'Norway',
    # Denmark
    'OY-': 'Denmark',
    # Finland
    'OH-': 'Finland',
    # Ireland
    'EI-': 'Ireland',
    # Portugal
    'CS-': 'Portugal',
    # Poland
    'SP-': 'Poland',
    # Czech Republic
    'OK-': 'Czech Republic',
    # South Korea
    'HL': 'South Korea',
    # Singapore
    '9V-': 'Singapore',
    # New Zealand
    'ZK-': 'New Zealand',
    # South Africa
    'ZS-': 'South Africa',
    # UAE
    'A6-': 'United Arab Emirates',
    # Israel
    '4X-': 'Israel',
    # Turkey
    'TC-': 'Turkey',
    # Argentina
    'LV-': 'Argentina',
    # Chile
    'CC-': 'Chile',
    # Colombia
    'HK-': 'Colombia',
    # Thailand
    'HS-': 'Thailand',
    # Malaysia
    '9M-': 'Malaysia',
    # Indonesia
    'PK-': 'Indonesia',
    # Philippines
    'RP-': 'Philippines',
    # Vietnam
    'VN-': 'Vietnam',
    # Greece
    'SX-': 'Greece',
    # Hungary
    'HA-': 'Hungary',
    # Romania
    'YR-': 'Romania',
    # Ukraine
    'UR-': 'Ukraine',
    # Saudi Arabia
    'HZ-': 'Saudi Arabia',
    # Qatar
    'A7-': 'Qatar',
    # Kuwait
    '9K-': 'Kuwait',
    # Morocco
    'CN-': 'Morocco',
    # Egypt
    'SU-': 'Egypt',
    # Iceland
    'TF-': 'Iceland',
    # Luxembourg
    'LX-': 'Luxembourg',
}


def _get_country_from_registration(registration: str) -> Optional[str]:
    """Determine country of origin from aircraft registration prefix."""
    if not registration:
        return None

    registration = registration.upper().strip()

    # Check longer prefixes first for more specific matches
    for prefix_len in [3, 2, 1]:
        for prefix, country in REGISTRATION_PREFIXES.items():
            if len(prefix) == prefix_len and registration.startswith(prefix):
                return country

    # Special case for US N-number (just starts with N followed by digit)
    if registration and registration[0] == 'N' and len(registration) > 1 and registration[1].isdigit():
        return 'United States'

    return 'Unknown'


def calculate_flight_patterns_stats(hours: int = 24) -> dict:
    """
    Calculate flight pattern statistics.

    Returns:
    - Most frequent routes (origin-destination pairs based on callsign patterns)
    - Busiest hours of the day (aggregate position counts by hour for heatmap)
    - Average flight duration by aircraft type
    - Most common aircraft types/models
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # ==========================================================================
    # Busiest hours of the day (for heatmap)
    # ==========================================================================
    hourly_data = (
        AircraftSighting.objects.filter(timestamp__gt=cutoff)
        .annotate(hour=ExtractHour('timestamp'))
        .values('hour')
        .annotate(
            position_count=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            military_count=Count('id', filter=Q(is_military=True)),
            avg_altitude=Avg('altitude_baro'),
            avg_speed=Avg('ground_speed'),
        )
        .order_by('hour')
    )

    busiest_hours = []
    peak_hour = None
    peak_count = 0

    for row in hourly_data:
        hour = row['hour'] if row['hour'] is not None else 0
        unique = row['unique_aircraft'] or 0

        if unique > peak_count:
            peak_count = unique
            peak_hour = hour

        busiest_hours.append({
            'hour': hour,
            'position_count': row['position_count'] or 0,
            'unique_aircraft': unique,
            'military_count': row['military_count'] or 0,
            'avg_altitude': round(row['avg_altitude']) if row['avg_altitude'] else None,
            'avg_speed': round(row['avg_speed']) if row['avg_speed'] else None,
        })

    # Fill in missing hours with zero values
    existing_hours = {h['hour'] for h in busiest_hours}
    for hour in range(24):
        if hour not in existing_hours:
            busiest_hours.append({
                'hour': hour,
                'position_count': 0,
                'unique_aircraft': 0,
                'military_count': 0,
                'avg_altitude': None,
                'avg_speed': None,
            })
    busiest_hours.sort(key=lambda x: x['hour'])

    # ==========================================================================
    # Average flight duration by aircraft type
    # ==========================================================================
    duration_by_type = (
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            aircraft_type__isnull=False
        )
        .exclude(aircraft_type='')
        .annotate(
            duration_seconds=ExtractEpoch(F('last_seen') - F('first_seen'))
        )
        .values('aircraft_type')
        .annotate(
            count=Count('id'),
            avg_duration=Avg('duration_seconds'),
            max_duration=Max('duration_seconds'),
            min_duration=Min('duration_seconds'),
            total_positions=Sum('total_positions'),
        )
        .order_by('-count')[:20]
    )

    avg_duration_by_type = []
    for row in duration_by_type:
        if row['avg_duration']:
            avg_duration_by_type.append({
                'aircraft_type': row['aircraft_type'],
                'count': row['count'],
                'avg_duration_min': round(row['avg_duration'] / 60, 1),
                'max_duration_min': round(row['max_duration'] / 60, 1) if row['max_duration'] else None,
                'min_duration_min': round(row['min_duration'] / 60, 1) if row['min_duration'] else None,
                'total_positions': row['total_positions'] or 0,
            })

    # ==========================================================================
    # Most common aircraft types/models
    # ==========================================================================
    # From sessions (recent aircraft seen)
    session_types = (
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            aircraft_type__isnull=False
        )
        .exclude(aircraft_type='')
        .values('aircraft_type')
        .annotate(
            session_count=Count('id'),
            unique_icao=Count('icao_hex', distinct=True),
            military_count=Count('id', filter=Q(is_military=True)),
        )
        .order_by('-session_count')[:25]
    )

    common_aircraft_types = [
        {
            'type_code': row['aircraft_type'],
            'session_count': row['session_count'],
            'unique_aircraft': row['unique_icao'],
            'military_count': row['military_count'],
            'military_pct': round((row['military_count'] / row['session_count']) * 100, 1) if row['session_count'] > 0 else 0,
        }
        for row in session_types
    ]

    # Enrich with type names from AircraftInfo if available
    type_codes = [t['type_code'] for t in common_aircraft_types]
    type_info = dict(
        AircraftInfo.objects.filter(type_code__in=type_codes)
        .values_list('type_code', 'type_name')
        .distinct()[:50]
    )
    for t in common_aircraft_types:
        t['type_name'] = type_info.get(t['type_code'])

    # ==========================================================================
    # Route patterns (based on callsign prefixes - airline codes)
    # Note: Full route data requires external flight tracking APIs
    # ==========================================================================
    # Extract airline codes from callsigns (typically first 3 chars for ICAO codes)
    callsign_data = (
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            callsign__isnull=False
        )
        .exclude(callsign='')
        .values('callsign')
        .annotate(count=Count('id'))
        .order_by('-count')[:100]
    )

    # Group by airline code (first 3 chars)
    airline_flights = {}
    for row in callsign_data:
        callsign = row['callsign'] or ''
        # Extract airline code (typically first 3 letters for ICAO)
        if len(callsign) >= 3 and callsign[:3].isalpha():
            code = callsign[:3].upper()
            if code not in airline_flights:
                airline_flights[code] = {'code': code, 'flight_count': 0, 'callsigns': []}
            airline_flights[code]['flight_count'] += row['count']
            if len(airline_flights[code]['callsigns']) < 5:
                airline_flights[code]['callsigns'].append(callsign)

    frequent_routes = sorted(
        airline_flights.values(),
        key=lambda x: x['flight_count'],
        reverse=True
    )[:15]

    return {
        'busiest_hours': busiest_hours,
        'peak_hour': peak_hour,
        'peak_aircraft_count': peak_count,
        'avg_duration_by_type': avg_duration_by_type,
        'common_aircraft_types': common_aircraft_types,
        'frequent_routes': frequent_routes,
        'time_range_hours': hours,
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_geographic_stats(hours: int = 24) -> dict:
    """
    Calculate geographic/origin statistics.

    Returns:
    - Countries of origin breakdown (from registration prefixes)
    - Airlines/operators frequency
    - Most connected airports (if departure/arrival data available)
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # ==========================================================================
    # Countries of origin breakdown (from registration prefixes)
    # ==========================================================================
    # Get registrations from AircraftInfo for aircraft seen recently
    recent_icaos = list(
        AircraftSession.objects.filter(last_seen__gt=cutoff)
        .values_list('icao_hex', flat=True)
        .distinct()
    )

    aircraft_with_reg = AircraftInfo.objects.filter(
        icao_hex__in=recent_icaos,
        registration__isnull=False
    ).exclude(registration='')

    country_counts = {}
    total_with_reg = 0

    for info in aircraft_with_reg.values('registration'):
        reg = info['registration']
        country = _get_country_from_registration(reg)
        if country:
            country_counts[country] = country_counts.get(country, 0) + 1
            total_with_reg += 1

    countries_breakdown = sorted(
        [
            {
                'country': country,
                'count': count,
                'percentage': round((count / total_with_reg) * 100, 1) if total_with_reg > 0 else 0,
            }
            for country, count in country_counts.items()
        ],
        key=lambda x: x['count'],
        reverse=True
    )[:20]

    # ==========================================================================
    # Airlines/Operators frequency
    # ==========================================================================
    operator_data = (
        AircraftInfo.objects.filter(
            icao_hex__in=recent_icaos,
            operator__isnull=False
        )
        .exclude(operator='')
        .values('operator', 'operator_icao')
        .annotate(
            count=Count('id'),
        )
        .order_by('-count')[:20]
    )

    operators_frequency = [
        {
            'operator': row['operator'],
            'operator_icao': row['operator_icao'],
            'aircraft_count': row['count'],
        }
        for row in operator_data
    ]

    # ==========================================================================
    # Most connected cities/regions (from AircraftInfo city/state fields)
    # ==========================================================================
    city_data = (
        AircraftInfo.objects.filter(
            icao_hex__in=recent_icaos,
            city__isnull=False
        )
        .exclude(city='')
        .values('city', 'state', 'country')
        .annotate(count=Count('id'))
        .order_by('-count')[:15]
    )

    connected_locations = [
        {
            'city': row['city'],
            'state': row['state'],
            'country': row['country'],
            'aircraft_count': row['count'],
        }
        for row in city_data
    ]

    # ==========================================================================
    # Military vs civilian breakdown by country
    # ==========================================================================
    military_by_country = {}
    civilian_by_country = {}

    sessions_with_info = list(
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            icao_hex__in=AircraftInfo.objects.filter(
                registration__isnull=False
            ).values('icao_hex')
        )
        .values('icao_hex', 'is_military')
    )

    # Map icao to registration for country lookup
    icao_to_reg = dict(
        AircraftInfo.objects.filter(
            icao_hex__in=[s['icao_hex'] for s in sessions_with_info],
            registration__isnull=False
        ).values_list('icao_hex', 'registration')
    )

    for session in sessions_with_info:
        reg = icao_to_reg.get(session['icao_hex'])
        if reg:
            country = _get_country_from_registration(reg)
            if country:
                if session['is_military']:
                    military_by_country[country] = military_by_country.get(country, 0) + 1
                else:
                    civilian_by_country[country] = civilian_by_country.get(country, 0) + 1

    military_breakdown = []
    for country in set(list(military_by_country.keys()) + list(civilian_by_country.keys())):
        mil = military_by_country.get(country, 0)
        civ = civilian_by_country.get(country, 0)
        total = mil + civ
        if total > 0:
            military_breakdown.append({
                'country': country,
                'military_count': mil,
                'civilian_count': civ,
                'total': total,
                'military_pct': round((mil / total) * 100, 1),
            })

    military_breakdown.sort(key=lambda x: x['total'], reverse=True)
    military_breakdown = military_breakdown[:15]

    # ==========================================================================
    # Summary statistics
    # ==========================================================================
    total_unique_aircraft = len(set(recent_icaos))
    total_with_info = AircraftInfo.objects.filter(icao_hex__in=recent_icaos).count()
    total_countries = len(country_counts)
    total_operators = len(operators_frequency)

    return {
        'countries_breakdown': countries_breakdown,
        'operators_frequency': operators_frequency,
        'connected_locations': connected_locations,
        'military_breakdown': military_breakdown,
        'summary': {
            'total_unique_aircraft': total_unique_aircraft,
            'aircraft_with_info': total_with_info,
            'info_coverage_pct': round((total_with_info / total_unique_aircraft) * 100, 1) if total_unique_aircraft > 0 else 0,
            'total_countries': total_countries,
            'total_operators': total_operators,
        },
        'time_range_hours': hours,
        'timestamp': now.isoformat() + 'Z',
    }


def broadcast_stats_update(stat_type: str, data: dict) -> None:
    """Broadcast stats update via WebSocket."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit('stats:update', {
            'stat_type': stat_type,
            'stats': data
        }, room='topic_stats')
        logger.debug(f"Broadcast stats update: {stat_type}")
    except Exception as e:
        logger.warning(f"Failed to broadcast stats update: {e}")


def refresh_history_cache(broadcast: bool = True) -> None:
    """Refresh history stats cache."""
    logger.debug("Refreshing history stats cache...")

    try:
        stats = calculate_history_stats()
        trends = calculate_history_trends()
        top = calculate_history_top()

        cache.set(CACHE_KEY_HISTORY_STATS, stats, timeout=HISTORY_STATS_TIMEOUT)
        cache.set(CACHE_KEY_HISTORY_TRENDS, trends, timeout=HISTORY_STATS_TIMEOUT)
        cache.set(CACHE_KEY_HISTORY_TOP, top, timeout=HISTORY_STATS_TIMEOUT)

        logger.debug("History stats cache refreshed")

        # Broadcast updates
        if broadcast:
            broadcast_stats_update('history', stats)
            broadcast_stats_update('trends', trends)
            broadcast_stats_update('top_performers', top)

    except Exception as e:
        logger.error(f"Error refreshing history cache: {e}")


def refresh_safety_cache(broadcast: bool = True) -> None:
    """Refresh safety stats cache."""
    logger.debug("Refreshing safety stats cache...")

    try:
        stats = calculate_safety_stats()
        cache.set(CACHE_KEY_SAFETY_STATS, stats, timeout=SAFETY_STATS_TIMEOUT)
        logger.debug("Safety stats cache refreshed")

        # Broadcast update
        if broadcast:
            broadcast_stats_update('safety', stats)

    except Exception as e:
        logger.error(f"Error refreshing safety cache: {e}")


def refresh_flight_patterns_cache(broadcast: bool = True) -> None:
    """Refresh flight patterns stats cache."""
    logger.debug("Refreshing flight patterns stats cache...")

    try:
        stats = calculate_flight_patterns_stats()
        cache.set(CACHE_KEY_FLIGHT_PATTERNS, stats, timeout=FLIGHT_PATTERNS_TIMEOUT)
        logger.debug("Flight patterns stats cache refreshed")

        if broadcast:
            broadcast_stats_update('flight_patterns', stats)

    except Exception as e:
        logger.error(f"Error refreshing flight patterns cache: {e}")


def refresh_geographic_cache(broadcast: bool = True) -> None:
    """Refresh geographic stats cache."""
    logger.debug("Refreshing geographic stats cache...")

    try:
        stats = calculate_geographic_stats()
        cache.set(CACHE_KEY_GEOGRAPHIC_STATS, stats, timeout=GEOGRAPHIC_STATS_TIMEOUT)
        logger.debug("Geographic stats cache refreshed")

        if broadcast:
            broadcast_stats_update('geographic', stats)

    except Exception as e:
        logger.error(f"Error refreshing geographic cache: {e}")


# Public API - Get Cached Data

def get_aircraft_stats() -> Optional[dict]:
    """Get cached aircraft stats."""
    return cache.get(CACHE_KEY_AIRCRAFT_STATS)


def get_top_aircraft() -> Optional[dict]:
    """Get cached top aircraft."""
    return cache.get(CACHE_KEY_TOP_AIRCRAFT)


def get_history_stats() -> Optional[dict]:
    """Get cached history stats."""
    stats = cache.get(CACHE_KEY_HISTORY_STATS)
    if stats is None:
        refresh_history_cache()
        stats = cache.get(CACHE_KEY_HISTORY_STATS)
    return stats


def get_history_trends() -> Optional[dict]:
    """Get cached history trends."""
    trends = cache.get(CACHE_KEY_HISTORY_TRENDS)
    if trends is None:
        refresh_history_cache()
        trends = cache.get(CACHE_KEY_HISTORY_TRENDS)
    return trends


def get_history_top() -> Optional[dict]:
    """Get cached history top performers."""
    top = cache.get(CACHE_KEY_HISTORY_TOP)
    if top is None:
        refresh_history_cache()
        top = cache.get(CACHE_KEY_HISTORY_TOP)
    return top


def get_safety_stats() -> Optional[dict]:
    """Get cached safety stats."""
    stats = cache.get(CACHE_KEY_SAFETY_STATS)
    if stats is None:
        refresh_safety_cache()
        stats = cache.get(CACHE_KEY_SAFETY_STATS)
    return stats


def get_flight_patterns_stats() -> Optional[dict]:
    """Get cached flight patterns stats."""
    stats = cache.get(CACHE_KEY_FLIGHT_PATTERNS)
    if stats is None:
        refresh_flight_patterns_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_FLIGHT_PATTERNS)
    return stats


def get_geographic_stats() -> Optional[dict]:
    """Get cached geographic stats."""
    stats = cache.get(CACHE_KEY_GEOGRAPHIC_STATS)
    if stats is None:
        refresh_geographic_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_GEOGRAPHIC_STATS)
    return stats


def get_all_cached_stats() -> dict:
    """Get all cached stats with metadata."""
    from skyspy.services.acars_stats import (
        get_cached_acars_stats,
        get_cached_acars_trends,
        get_cached_acars_airlines,
    )

    return {
        "aircraft_stats": get_aircraft_stats(),
        "top_aircraft": get_top_aircraft(),
        "history_stats": get_history_stats(),
        "history_trends": get_history_trends(),
        "history_top": get_history_top(),
        "safety_stats": get_safety_stats(),
        "flight_patterns": get_flight_patterns_stats(),
        "geographic": get_geographic_stats(),
        "tracking_quality": get_tracking_quality_stats(),
        "engagement": get_engagement_stats(),
        "acars_stats": get_cached_acars_stats(),
        "acars_trends": get_cached_acars_trends(),
        "acars_airlines": get_cached_acars_airlines(),
    }


# =============================================================================
# Tracking Quality Stats
# =============================================================================

def calculate_tracking_quality_stats(hours: int = 24) -> dict:
    """
    Calculate tracking quality statistics for sessions.

    Metrics:
    - Average position update rate per aircraft (positions per minute)
    - Coverage gaps analysis (periods without positions during a session)
    - Session completeness score (% of expected positions received)
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # Get sessions with meaningful data (at least 2 positions and > 1 minute duration)
    sessions = AircraftSession.objects.filter(
        last_seen__gt=cutoff,
        total_positions__gte=2
    ).annotate(
        duration_seconds=ExtractEpoch(F('last_seen') - F('first_seen'))
    ).filter(
        duration_seconds__gt=60  # At least 1 minute
    )

    if not sessions.exists():
        return {
            "time_range_hours": hours,
            "total_sessions_analyzed": 0,
            "sessions_analyzed": 0,  # Alias for compatibility
            "total_sessions": 0,  # Alias for compatibility
            "avg_update_rate_per_min": None,
            "average_update_rate": None,  # Alias for compatibility
            "median_update_rate_per_min": None,
            "update_rate_distribution": {},
            "completeness": {
                "avg_score": None,
                "excellent_count": 0,
                "good_count": 0,
                "fair_count": 0,
                "poor_count": 0,
            },
            "coverage_gaps": {
                "sessions_with_gaps": 0,
                "avg_gaps_per_session": None,
                "max_gap_seconds": None,
                "avg_gap_seconds": None,
            },
            "quality_breakdown": {
                "excellent": 0,
                "good": 0,
                "fair": 0,
                "poor": 0,
            },
            "top_quality_sessions": [],
            "worst_quality_sessions": [],
            "timestamp": now.isoformat() + "Z",
        }

    # Calculate update rates
    update_rates = []
    completeness_scores = []
    quality_grades = {'excellent': 0, 'good': 0, 'fair': 0, 'poor': 0}
    session_details = []

    # RPi optimization: Use configurable sample size
    sample_size = MAX_STATS_SAMPLE_SIZE if RPI_LITE_MODE else 1000
    for session in sessions[:sample_size]:
        duration_min = session.duration_seconds / 60
        if duration_min > 0:
            rate = session.total_positions / duration_min
            update_rates.append(rate)

            # Calculate completeness (expected positions based on ~5 second updates)
            expected = session.duration_seconds / DEFAULT_EXPECTED_UPDATE_INTERVAL
            completeness = min(100, (session.total_positions / expected) * 100) if expected > 0 else 0
            completeness_scores.append(completeness)

            # Determine quality grade
            if completeness >= 90 and rate >= 10:
                grade = 'excellent'
            elif completeness >= 70 and rate >= 6:
                grade = 'good'
            elif completeness >= 50:
                grade = 'fair'
            else:
                grade = 'poor'

            quality_grades[grade] += 1

            session_details.append({
                'icao_hex': session.icao_hex,
                'callsign': session.callsign,
                'duration_min': round(duration_min, 1),
                'positions': session.total_positions,
                'update_rate': round(rate, 2),
                'completeness': round(completeness, 1),
                'quality_grade': grade,
                'first_seen': session.first_seen.isoformat() + "Z" if session.first_seen else None,
                'last_seen': session.last_seen.isoformat() + "Z" if session.last_seen else None,
            })

    # Calculate statistics
    total_analyzed = len(update_rates)
    sorted_rates = sorted(update_rates)
    sorted_completeness = sorted(completeness_scores)

    avg_rate = sum(update_rates) / total_analyzed if total_analyzed else None
    median_rate = sorted_rates[total_analyzed // 2] if total_analyzed else None

    avg_completeness = sum(completeness_scores) / total_analyzed if total_analyzed else None

    # Update rate distribution
    rate_distribution = {
        "0-2_per_min": sum(1 for r in update_rates if r < 2),
        "2-5_per_min": sum(1 for r in update_rates if 2 <= r < 5),
        "5-10_per_min": sum(1 for r in update_rates if 5 <= r < 10),
        "10-15_per_min": sum(1 for r in update_rates if 10 <= r < 15),
        "15+_per_min": sum(1 for r in update_rates if r >= 15),
    }

    # Completeness breakdown
    completeness_breakdown = {
        "excellent_count": sum(1 for c in completeness_scores if c >= 90),
        "good_count": sum(1 for c in completeness_scores if 70 <= c < 90),
        "fair_count": sum(1 for c in completeness_scores if 50 <= c < 70),
        "poor_count": sum(1 for c in completeness_scores if c < 50),
        "avg_score": round(avg_completeness, 1) if avg_completeness else None,
    }

    # Sort sessions by quality metrics
    session_details.sort(key=lambda x: (-x['completeness'], -x['update_rate']))
    top_quality = session_details[:10]
    session_details.sort(key=lambda x: (x['completeness'], x['update_rate']))
    worst_quality = session_details[:10]

    return {
        "time_range_hours": hours,
        "total_sessions_analyzed": total_analyzed,
        "sessions_analyzed": total_analyzed,  # Alias for compatibility
        "total_sessions": total_analyzed,  # Alias for compatibility
        "avg_update_rate_per_min": round(avg_rate, 2) if avg_rate else None,
        "average_update_rate": round(avg_rate, 2) if avg_rate else None,  # Alias for compatibility
        "median_update_rate_per_min": round(median_rate, 2) if median_rate else None,
        "update_rate_distribution": rate_distribution,
        "completeness": completeness_breakdown,
        "quality_breakdown": quality_grades,
        "top_quality_sessions": top_quality,
        "worst_quality_sessions": worst_quality,
        "timestamp": now.isoformat() + "Z",
    }


def calculate_coverage_gaps_analysis(hours: int = 24, limit: int = 100) -> dict:
    """
    Analyze coverage gaps in tracking sessions.

    Looks at individual sighting timestamps to find periods without data.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # Get sessions with enough positions to analyze gaps
    sessions = AircraftSession.objects.filter(
        last_seen__gt=cutoff,
        total_positions__gte=5  # Need enough positions to detect gaps
    ).order_by('-total_positions')[:limit]

    gap_analysis = []
    all_gaps = []
    sessions_with_gaps = 0

    for session in sessions:
        # Get all sightings for this session
        sightings = AircraftSighting.objects.filter(
            icao_hex=session.icao_hex,
            timestamp__gte=session.first_seen,
            timestamp__lte=session.last_seen
        ).order_by('timestamp').values_list('timestamp', flat=True)

        sighting_times = list(sightings)
        if len(sighting_times) < 2:
            continue

        # Calculate gaps
        gaps = []
        for i in range(1, len(sighting_times)):
            gap_seconds = (sighting_times[i] - sighting_times[i-1]).total_seconds()
            if gap_seconds > COVERAGE_GAP_THRESHOLD:
                gaps.append({
                    'start': sighting_times[i-1].isoformat() + "Z",
                    'end': sighting_times[i].isoformat() + "Z",
                    'duration_seconds': int(gap_seconds),
                })
                all_gaps.append(gap_seconds)

        if gaps:
            sessions_with_gaps += 1
            duration_seconds = (session.last_seen - session.first_seen).total_seconds()
            total_gap_time = sum(g['duration_seconds'] for g in gaps)
            gap_percentage = (total_gap_time / duration_seconds * 100) if duration_seconds > 0 else 0

            gap_analysis.append({
                'icao_hex': session.icao_hex,
                'callsign': session.callsign,
                'total_gaps': len(gaps),
                'max_gap_seconds': max(g['duration_seconds'] for g in gaps),
                'total_gap_time_seconds': int(total_gap_time),
                'gap_percentage': round(gap_percentage, 1),
                'gaps': gaps[:5],  # Limit to first 5 gaps
            })

    # Sort by gap severity
    gap_analysis.sort(key=lambda x: -x['max_gap_seconds'])

    return {
        "time_range_hours": hours,
        "sessions_analyzed": len(sessions),
        "sessions_with_gaps": sessions_with_gaps,
        "sessions_with_gaps_pct": round(sessions_with_gaps / len(sessions) * 100, 1) if sessions else 0,
        "total_gaps_found": len(all_gaps),
        "avg_gap_seconds": round(sum(all_gaps) / len(all_gaps), 1) if all_gaps else None,
        "max_gap_seconds": max(all_gaps) if all_gaps else None,
        "min_gap_seconds": min(all_gaps) if all_gaps else None,
        "gap_distribution": {
            "30-60s": sum(1 for g in all_gaps if 30 <= g < 60),
            "60-120s": sum(1 for g in all_gaps if 60 <= g < 120),
            "120-300s": sum(1 for g in all_gaps if 120 <= g < 300),
            "300-600s": sum(1 for g in all_gaps if 300 <= g < 600),
            "600s+": sum(1 for g in all_gaps if g >= 600),
        },
        "worst_sessions": gap_analysis[:20],
        "timestamp": now.isoformat() + "Z",
    }


# =============================================================================
# Engagement Stats
# =============================================================================

def calculate_engagement_stats(hours: int = 24) -> dict:
    """
    Calculate engagement statistics.

    Metrics:
    - Most-watched aircraft (favorites)
    - Peak concurrent tracking sessions
    - Return visitors (same aircraft seen multiple times)
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # === Most Favorited Aircraft ===
    most_favorited = list(
        AircraftFavorite.objects.values('icao_hex', 'registration')
        .annotate(
            favorite_count=Count('id'),
            total_times_seen=Sum('times_seen'),
            total_tracking_minutes=Sum('total_tracking_minutes'),
        )
        .order_by('-favorite_count')[:20]
    )

    # Enrich with aircraft info
    enriched_favorites = []
    icao_hexes = [f['icao_hex'] for f in most_favorited]
    aircraft_infos = {
        info.icao_hex: info
        for info in AircraftInfo.objects.filter(icao_hex__in=icao_hexes)
    }

    for fav in most_favorited:
        info = aircraft_infos.get(fav['icao_hex'])
        enriched_favorites.append({
            'icao_hex': fav['icao_hex'],
            'registration': fav['registration'] or (info.registration if info else None),
            'favorite_count': fav['favorite_count'],
            'total_times_seen': fav['total_times_seen'] or 0,
            'total_tracking_minutes': round(fav['total_tracking_minutes'] or 0, 1),
            'aircraft_type': info.type_code if info else None,
            'operator': info.operator if info else None,
        })

    # === Peak Concurrent Tracking Sessions ===
    # Calculate from hourly trends
    hourly_data = (
        AircraftSighting.objects.filter(timestamp__gt=cutoff)
        .annotate(hour=TruncHour('timestamp'))
        .values('hour')
        .annotate(
            unique_aircraft=Count('icao_hex', distinct=True),
            position_count=Count('id'),
        )
        .order_by('-unique_aircraft')
    )

    peak_data = hourly_data.first() if hourly_data.exists() else None
    peak_concurrent = {
        'max_aircraft': peak_data['unique_aircraft'] if peak_data else 0,
        'peak_hour': peak_data['hour'].isoformat() + "Z" if peak_data and peak_data['hour'] else None,
        'positions_in_peak': peak_data['position_count'] if peak_data else 0,
    }

    # Calculate hourly averages
    hourly_stats = hourly_data.aggregate(
        avg_aircraft=Avg('unique_aircraft'),
        avg_positions=Avg('position_count'),
    )

    # === Return Visitors (Aircraft seen in multiple sessions) ===
    return_visitors = list(
        AircraftSession.objects.filter(last_seen__gt=cutoff)
        .values('icao_hex')
        .annotate(
            session_count=Count('id'),
            total_positions=Sum('total_positions'),
            first_session=Min('first_seen'),
            last_session=Max('last_seen'),
        )
        .filter(session_count__gte=2)  # Seen at least twice
        .order_by('-session_count')[:30]
    )

    # Get registration info for return visitors
    return_visitor_icaos = [rv['icao_hex'] for rv in return_visitors]
    visitor_infos = {
        info.icao_hex: info
        for info in AircraftInfo.objects.filter(icao_hex__in=return_visitor_icaos)
    }

    enriched_return_visitors = []
    for rv in return_visitors:
        info = visitor_infos.get(rv['icao_hex'])
        enriched_return_visitors.append({
            'icao_hex': rv['icao_hex'],
            'registration': info.registration if info else None,
            'session_count': rv['session_count'],
            'total_positions': rv['total_positions'],
            'first_session': rv['first_session'].isoformat() + "Z" if rv['first_session'] else None,
            'last_session': rv['last_session'].isoformat() + "Z" if rv['last_session'] else None,
            'aircraft_type': info.type_code if info else None,
            'operator': info.operator if info else None,
        })

    # Session return rate
    total_unique_aircraft = AircraftSession.objects.filter(
        last_seen__gt=cutoff
    ).values('icao_hex').distinct().count()

    returning_aircraft = AircraftSession.objects.filter(
        last_seen__gt=cutoff
    ).values('icao_hex').annotate(
        cnt=Count('id')
    ).filter(cnt__gte=2).count()

    return_rate = (returning_aircraft / total_unique_aircraft * 100) if total_unique_aircraft > 0 else 0

    # === Favorite Activity Stats ===
    total_favorites = AircraftFavorite.objects.count()
    recent_favorites = AircraftFavorite.objects.filter(created_at__gt=cutoff).count()
    active_users = AircraftFavorite.objects.filter(
        last_seen_at__gt=cutoff
    ).values('user').distinct().count()

    return {
        "time_range_hours": hours,
        "most_favorited_aircraft": enriched_favorites,
        "peak_concurrent": peak_concurrent,
        "hourly_averages": {
            "avg_aircraft_per_hour": round(hourly_stats['avg_aircraft'], 1) if hourly_stats['avg_aircraft'] else 0,
            "avg_positions_per_hour": round(hourly_stats['avg_positions'], 1) if hourly_stats['avg_positions'] else 0,
        },
        "return_visitors": enriched_return_visitors,
        "return_visitor_stats": {
            "total_unique_aircraft": total_unique_aircraft,
            "returning_aircraft_count": returning_aircraft,
            "return_rate_pct": round(return_rate, 1),
        },
        "favorites_stats": {
            "total_favorites": total_favorites,
            "recent_favorites": recent_favorites,
            "active_favoriting_users": active_users,
        },
        "timestamp": now.isoformat() + "Z",
    }


def refresh_tracking_quality_cache(broadcast: bool = True) -> None:
    """Refresh tracking quality stats cache."""
    logger.debug("Refreshing tracking quality stats cache...")

    try:
        stats = calculate_tracking_quality_stats()
        cache.set(CACHE_KEY_TRACKING_QUALITY, stats, timeout=TRACKING_QUALITY_TIMEOUT)
        logger.debug("Tracking quality stats cache refreshed")

        if broadcast:
            broadcast_stats_update('tracking_quality', stats)

    except Exception as e:
        logger.error(f"Error refreshing tracking quality cache: {e}")


def refresh_engagement_cache(broadcast: bool = True) -> None:
    """Refresh engagement stats cache."""
    logger.debug("Refreshing engagement stats cache...")

    try:
        stats = calculate_engagement_stats()
        cache.set(CACHE_KEY_ENGAGEMENT, stats, timeout=ENGAGEMENT_TIMEOUT)
        logger.debug("Engagement stats cache refreshed")

        if broadcast:
            broadcast_stats_update('engagement', stats)

    except Exception as e:
        logger.error(f"Error refreshing engagement cache: {e}")


def get_tracking_quality_stats() -> Optional[dict]:
    """Get cached tracking quality stats."""
    stats = cache.get(CACHE_KEY_TRACKING_QUALITY)
    if stats is None:
        refresh_tracking_quality_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_TRACKING_QUALITY)
    return stats


def get_engagement_stats() -> Optional[dict]:
    """Get cached engagement stats."""
    stats = cache.get(CACHE_KEY_ENGAGEMENT)
    if stats is None:
        refresh_engagement_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_ENGAGEMENT)
    return stats


def get_coverage_gaps_analysis(hours: int = 24) -> dict:
    """Get coverage gaps analysis (not cached, computed on demand)."""
    return calculate_coverage_gaps_analysis(hours=hours)


# =============================================================================
# ACARS Stats Integration
# =============================================================================

def refresh_acars_stats_cache(broadcast: bool = True) -> None:
    """Refresh ACARS stats cache."""
    from skyspy.services.acars_stats import refresh_acars_stats_cache as _refresh_acars
    _refresh_acars(broadcast=broadcast)


def get_acars_stats() -> Optional[dict]:
    """Get cached ACARS stats."""
    from skyspy.services.acars_stats import get_cached_acars_stats
    return get_cached_acars_stats()


def get_acars_trends() -> Optional[dict]:
    """Get cached ACARS trends."""
    from skyspy.services.acars_stats import get_cached_acars_trends
    return get_cached_acars_trends()


def get_acars_airlines() -> Optional[dict]:
    """Get cached ACARS airline stats."""
    from skyspy.services.acars_stats import get_cached_acars_airlines
    return get_cached_acars_airlines()


def refresh_all_caches(broadcast: bool = True) -> None:
    """Refresh all stats caches."""
    logger.info("Refreshing all stats caches...")
    refresh_history_cache(broadcast=broadcast)
    refresh_safety_cache(broadcast=broadcast)
    refresh_flight_patterns_cache(broadcast=broadcast)
    refresh_geographic_cache(broadcast=broadcast)
    refresh_tracking_quality_cache(broadcast=broadcast)
    refresh_engagement_cache(broadcast=broadcast)
    refresh_acars_stats_cache(broadcast=broadcast)
    logger.info("All stats caches refreshed")
