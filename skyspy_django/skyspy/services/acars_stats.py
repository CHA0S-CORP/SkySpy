"""
ACARS/VDL2 Statistics Service.

Provides statistics and analytics for ACARS/VDL2 messages including:
- Message type breakdown (OOOI, position reports, weather, etc.)
- Airlines with most activity
- Message source breakdown (ACARS vs VDL2)
- Free-text message categories
- Trends over time (hourly/daily)
- Peak activity analysis
"""
import logging
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Avg, Max, Min, F, Q
from django.db.models.functions import TruncHour, TruncDay, ExtractHour
from django.utils import timezone

from skyspy.models import AcarsMessage
from skyspy.services.acars_decoder import MESSAGE_LABELS, parse_callsign

logger = logging.getLogger(__name__)

# Cache keys
CACHE_KEY_ACARS_STATS = 'stats:acars'
CACHE_KEY_ACARS_TRENDS = 'stats:acars_trends'
CACHE_KEY_ACARS_AIRLINES = 'stats:acars_airlines'

# Cache timeout
ACARS_STATS_TIMEOUT = 120  # 2 minutes


# Message label categories for grouping
MESSAGE_CATEGORIES = {
    'oooi': {
        'name': 'OOOI Events',
        'description': 'Out/Off/On/In flight phase events',
        'labels': ['10', '11', '12', '13', '80'],
    },
    'position': {
        'name': 'Position Reports',
        'description': 'Aircraft position and progress reports',
        'labels': ['H1', 'H2', '2P', '22'],
    },
    'weather': {
        'name': 'Weather',
        'description': 'Weather requests and data',
        'labels': ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'Q0', 'Q1', 'Q2', '44', '21'],
    },
    'operational': {
        'name': 'Operational',
        'description': 'Operational requests and advisories',
        'labels': ['15', '16', '17', '20', '33'],
    },
    'system': {
        'name': 'System/Technical',
        'description': 'System messages and ACMS data',
        'labels': ['SA', 'SQ', '5Z', '83'],
    },
    'general': {
        'name': 'General/Free Text',
        'description': 'General communications and free text',
        'labels': ['B9', '_d'],
    },
}

# Build reverse lookup: label -> category
LABEL_TO_CATEGORY = {}
for cat_key, cat_data in MESSAGE_CATEGORIES.items():
    for label in cat_data['labels']:
        LABEL_TO_CATEGORY[label] = cat_key


def get_label_category(label: str) -> str:
    """Get category for a message label."""
    if not label:
        return 'unknown'
    return LABEL_TO_CATEGORY.get(label, 'other')


def calculate_acars_message_stats(hours: int = 24) -> dict:
    """
    Calculate comprehensive ACARS message statistics.

    Returns breakdown by:
    - Message type/label
    - Message category
    - Source (ACARS vs VDL2)
    - Airlines
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    base_qs = AcarsMessage.objects.filter(timestamp__gte=cutoff)

    total_messages = base_qs.count()

    # Count by source
    by_source = dict(
        base_qs.values_list('source')
        .annotate(count=Count('id'))
    )

    # Count by label
    label_counts_raw = list(
        base_qs.values('label')
        .annotate(count=Count('id'))
        .order_by('-count')
    )

    # Enrich label data with descriptions
    by_label = []
    for row in label_counts_raw:
        label = row['label']
        label_info = MESSAGE_LABELS.get(label, {})
        by_label.append({
            'label': label or 'unknown',
            'count': row['count'],
            'name': label_info.get('name', 'Unknown'),
            'description': label_info.get('description', ''),
            'category': get_label_category(label),
        })

    # Aggregate by category
    category_counts = defaultdict(int)
    for row in label_counts_raw:
        cat = get_label_category(row['label'])
        category_counts[cat] += row['count']

    by_category = []
    for cat_key, count in sorted(category_counts.items(), key=lambda x: x[1], reverse=True):
        cat_info = MESSAGE_CATEGORIES.get(cat_key, {
            'name': cat_key.title() if cat_key else 'Other',
            'description': '',
        })
        by_category.append({
            'category': cat_key,
            'name': cat_info.get('name', cat_key.title()),
            'description': cat_info.get('description', ''),
            'count': count,
            'percentage': round(count / total_messages * 100, 1) if total_messages > 0 else 0,
        })

    # Top frequencies
    top_frequencies = list(
        base_qs.filter(frequency__isnull=False)
        .values('frequency')
        .annotate(count=Count('id'))
        .order_by('-count')[:10]
    )

    # Format frequencies
    for freq in top_frequencies:
        freq['frequency_mhz'] = f"{freq['frequency']:.3f}" if freq['frequency'] else None

    # Messages with decoded content
    with_decoded = base_qs.filter(
        Q(decoded__isnull=False) | Q(text__isnull=False)
    ).exclude(text='').count()

    return {
        'total_messages': total_messages,
        'time_range_hours': hours,
        'by_source': by_source,
        'by_label': by_label[:20],  # Top 20 labels
        'by_category': by_category,
        'top_frequencies': top_frequencies,
        'messages_with_content': with_decoded,
        'content_percentage': round(with_decoded / total_messages * 100, 1) if total_messages > 0 else 0,
        'timestamp': timezone.now().isoformat() + 'Z',
    }


def calculate_acars_airline_stats(hours: int = 24, limit: int = 20) -> dict:
    """
    Calculate ACARS statistics by airline/operator.

    Groups messages by the airline ICAO code extracted from callsign.
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    base_qs = AcarsMessage.objects.filter(
        timestamp__gte=cutoff,
        callsign__isnull=False,
    ).exclude(callsign='')

    # Get callsign counts
    callsign_counts = list(
        base_qs.values('callsign')
        .annotate(count=Count('id'))
        .order_by('-count')[:500]  # Get more for aggregation
    )

    # Aggregate by airline
    airline_stats = defaultdict(lambda: {
        'count': 0,
        'flights': set(),
        'icao': None,
        'iata': None,
        'name': None,
    })

    for row in callsign_counts:
        callsign = row['callsign']
        count = row['count']

        # Parse callsign to get airline info
        parsed = parse_callsign(callsign)
        airline_icao = parsed.get('airline_icao')

        if airline_icao:
            key = airline_icao
            airline_stats[key]['count'] += count
            airline_stats[key]['flights'].add(callsign)

            # Store airline info if not already set
            if not airline_stats[key]['icao']:
                airline_stats[key]['icao'] = airline_icao
                airline_stats[key]['iata'] = parsed.get('airline_iata')
                airline_stats[key]['name'] = parsed.get('airline_name')

    # Convert to list and sort
    airlines = []
    for key, data in airline_stats.items():
        airlines.append({
            'airline_icao': data['icao'],
            'airline_iata': data['iata'],
            'airline_name': data['name'] or 'Unknown',
            'message_count': data['count'],
            'unique_flights': len(data['flights']),
        })

    airlines.sort(key=lambda x: x['message_count'], reverse=True)
    airlines = airlines[:limit]

    # Calculate totals
    total_with_airline = sum(a['message_count'] for a in airlines)
    total_messages = base_qs.count()

    return {
        'airlines': airlines,
        'total_with_airline_info': total_with_airline,
        'total_messages': total_messages,
        'time_range_hours': hours,
        'timestamp': timezone.now().isoformat() + 'Z',
    }


def calculate_acars_trends(hours: int = 24, interval: str = 'hour') -> dict:
    """
    Calculate ACARS message trends over time.

    Returns time-series data with message counts by source and category.
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    if interval == 'day':
        trunc_func = TruncDay
    else:
        trunc_func = TruncHour

    base_qs = AcarsMessage.objects.filter(timestamp__gte=cutoff)

    # Time-series by interval
    trends_raw = (
        base_qs
        .annotate(interval_start=trunc_func('timestamp'))
        .values('interval_start')
        .annotate(
            total=Count('id'),
            acars_count=Count('id', filter=Q(source='acars')),
            vdl2_count=Count('id', filter=Q(source='vdlm2')),
            unique_aircraft=Count('icao_hex', distinct=True),
            unique_callsigns=Count('callsign', distinct=True),
        )
        .order_by('interval_start')
    )

    intervals = []
    peak_count = 0
    peak_interval = None
    total_messages = 0

    for row in trends_raw:
        count = row['total']
        total_messages += count

        if count > peak_count:
            peak_count = count
            peak_interval = row['interval_start']

        intervals.append({
            'timestamp': row['interval_start'].isoformat() + 'Z' if row['interval_start'] else None,
            'total': count,
            'acars': row['acars_count'],
            'vdl2': row['vdl2_count'],
            'unique_aircraft': row['unique_aircraft'],
            'unique_flights': row['unique_callsigns'],
        })

    # Calculate hourly distribution (for all hours 0-23)
    hourly_distribution = (
        base_qs
        .annotate(hour=ExtractHour('timestamp'))
        .values('hour')
        .annotate(count=Count('id'))
        .order_by('hour')
    )

    hourly_counts = {i: 0 for i in range(24)}
    for row in hourly_distribution:
        hourly_counts[row['hour']] = row['count']

    hourly_data = [
        {'hour': h, 'count': c}
        for h, c in sorted(hourly_counts.items())
    ]

    # Find peak hours
    peak_hour = max(hourly_data, key=lambda x: x['count']) if hourly_data else None
    quietest_hour = min(hourly_data, key=lambda x: x['count']) if hourly_data else None

    return {
        'intervals': intervals,
        'interval_type': interval,
        'time_range_hours': hours,
        'total_messages': total_messages,
        'peak_interval': {
            'timestamp': peak_interval.isoformat() + 'Z' if peak_interval else None,
            'count': peak_count,
        },
        'hourly_distribution': hourly_data,
        'peak_hour': peak_hour,
        'quietest_hour': quietest_hour,
        'timestamp': timezone.now().isoformat() + 'Z',
    }


def calculate_acars_category_trends(hours: int = 24) -> dict:
    """
    Calculate message category distribution over time.

    Shows how different message types (OOOI, weather, etc.)
    are distributed throughout the day.
    """
    cutoff = timezone.now() - timedelta(hours=hours)

    base_qs = AcarsMessage.objects.filter(timestamp__gte=cutoff)

    # Get hourly counts by label
    hourly_labels = list(
        base_qs
        .annotate(hour=ExtractHour('timestamp'))
        .values('hour', 'label')
        .annotate(count=Count('id'))
        .order_by('hour')
    )

    # Organize by hour and category
    hourly_categories = defaultdict(lambda: defaultdict(int))

    for row in hourly_labels:
        hour = row['hour']
        label = row['label']
        count = row['count']
        category = get_label_category(label)
        hourly_categories[hour][category] += count

    # Build output
    category_trends = []
    for hour in range(24):
        hour_data = {
            'hour': hour,
            'categories': dict(hourly_categories.get(hour, {})),
            'total': sum(hourly_categories.get(hour, {}).values()),
        }
        category_trends.append(hour_data)

    # Category totals across all hours
    category_totals = defaultdict(int)
    for hour_cats in hourly_categories.values():
        for cat, count in hour_cats.items():
            category_totals[cat] += count

    return {
        'hourly_category_trends': category_trends,
        'category_totals': dict(category_totals),
        'time_range_hours': hours,
        'timestamp': timezone.now().isoformat() + 'Z',
    }


def calculate_free_text_analysis(hours: int = 24, limit: int = 20) -> dict:
    """
    Analyze free-text message content to identify patterns.

    Looks for common patterns like airport codes, flight numbers,
    weather data, etc.
    """
    import re
    from collections import Counter

    cutoff = timezone.now() - timedelta(hours=hours)

    # Get messages with text content
    messages = AcarsMessage.objects.filter(
        timestamp__gte=cutoff,
        text__isnull=False,
    ).exclude(text='').values_list('text', 'label')[:5000]

    # Pattern counters
    airport_mentions = Counter()
    weather_types = Counter()
    message_patterns = Counter()

    airport_pattern = re.compile(r'\b([A-Z]{4})\b')

    for text, label in messages:
        if not text:
            continue

        text_upper = text.upper()

        # Extract airport codes (4 letter codes starting with K, C, P, E, G, L, S)
        airports = airport_pattern.findall(text)
        for apt in airports:
            if apt[0] in 'KCPEGLS' and apt not in ('METAR', 'NOTAM', 'ATIS'):
                airport_mentions[apt] += 1

        # Detect weather content
        if 'METAR' in text_upper or 'TAF' in text_upper:
            weather_types['metar_taf'] += 1
        if 'PIREP' in text_upper:
            weather_types['pirep'] += 1
        if 'SIGMET' in text_upper or 'AIRMET' in text_upper:
            weather_types['sigmet_airmet'] += 1
        if any(x in text_upper for x in ['TURBULENCE', 'TURB', 'CHOP']):
            weather_types['turbulence'] += 1

        # Detect message patterns
        if '/POS/' in text or re.search(r'[NS]\d{2,5}[EW]\d{3,6}', text):
            message_patterns['position_report'] += 1
        if '/FPN/' in text or 'ROUTE' in text_upper:
            message_patterns['flight_plan'] += 1
        if any(x in text_upper for x in ['FUEL', 'FOB']):
            message_patterns['fuel_data'] += 1
        if any(x in text_upper for x in ['ETA', 'ARRIVAL', 'LANDING']):
            message_patterns['eta_arrival'] += 1
        if 'DELAY' in text_upper or 'LATE' in text_upper:
            message_patterns['delay_notice'] += 1

    return {
        'top_airports_mentioned': [
            {'airport': apt, 'count': count}
            for apt, count in airport_mentions.most_common(limit)
        ],
        'weather_content': dict(weather_types),
        'message_patterns': dict(message_patterns),
        'total_analyzed': len(list(messages)),
        'time_range_hours': hours,
        'timestamp': timezone.now().isoformat() + 'Z',
    }


def get_acars_summary_stats(hours: int = 24) -> dict:
    """
    Get a high-level summary of ACARS statistics.

    Combines key metrics from various stat functions for dashboard display.
    """
    cutoff = timezone.now() - timedelta(hours=hours)
    last_hour = timezone.now() - timedelta(hours=1)

    base_qs = AcarsMessage.objects.filter(timestamp__gte=cutoff)

    total = base_qs.count()
    last_hour_count = base_qs.filter(timestamp__gte=last_hour).count()

    by_source = dict(
        base_qs.values_list('source')
        .annotate(count=Count('id'))
    )

    unique_aircraft = base_qs.values('icao_hex').distinct().count()
    unique_flights = base_qs.filter(callsign__isnull=False).values('callsign').distinct().count()

    # Top label
    top_label = (
        base_qs.values('label')
        .annotate(count=Count('id'))
        .order_by('-count')
        .first()
    )

    # Messages per hour average
    hourly_avg = total / hours if hours > 0 else 0

    return {
        'total_messages': total,
        'last_hour': last_hour_count,
        'time_range_hours': hours,
        'by_source': by_source,
        'unique_aircraft': unique_aircraft,
        'unique_flights': unique_flights,
        'messages_per_hour': round(hourly_avg, 1),
        'top_label': top_label['label'] if top_label else None,
        'top_label_count': top_label['count'] if top_label else 0,
        'timestamp': timezone.now().isoformat() + 'Z',
    }


# Cache management functions

def refresh_acars_stats_cache(broadcast: bool = True) -> None:
    """Refresh all ACARS stats caches."""
    logger.debug("Refreshing ACARS stats cache...")

    try:
        stats = calculate_acars_message_stats()
        trends = calculate_acars_trends()
        airlines = calculate_acars_airline_stats()

        cache.set(CACHE_KEY_ACARS_STATS, stats, timeout=ACARS_STATS_TIMEOUT)
        cache.set(CACHE_KEY_ACARS_TRENDS, trends, timeout=ACARS_STATS_TIMEOUT)
        cache.set(CACHE_KEY_ACARS_AIRLINES, airlines, timeout=ACARS_STATS_TIMEOUT)

        logger.debug("ACARS stats cache refreshed")

        if broadcast:
            broadcast_acars_stats_update('acars_stats', stats)

    except Exception as e:
        logger.error(f"Error refreshing ACARS stats cache: {e}")


def broadcast_acars_stats_update(stat_type: str, data: dict) -> None:
    """Broadcast ACARS stats update via WebSocket."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit('acars:update', {
            'stat_type': stat_type,
            'stats': data
        }, room='topic_acars')
        logger.debug(f"Broadcast ACARS stats update: {stat_type}")
    except Exception as e:
        logger.warning(f"Failed to broadcast ACARS stats update: {e}")


def get_cached_acars_stats() -> Optional[dict]:
    """Get cached ACARS stats, refreshing if needed."""
    stats = cache.get(CACHE_KEY_ACARS_STATS)
    if stats is None:
        refresh_acars_stats_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_ACARS_STATS)
    return stats


def get_cached_acars_trends() -> Optional[dict]:
    """Get cached ACARS trends, refreshing if needed."""
    trends = cache.get(CACHE_KEY_ACARS_TRENDS)
    if trends is None:
        refresh_acars_stats_cache(broadcast=False)
        trends = cache.get(CACHE_KEY_ACARS_TRENDS)
    return trends


def get_cached_acars_airlines() -> Optional[dict]:
    """Get cached ACARS airline stats, refreshing if needed."""
    airlines = cache.get(CACHE_KEY_ACARS_AIRLINES)
    if airlines is None:
        refresh_acars_stats_cache(broadcast=False)
        airlines = cache.get(CACHE_KEY_ACARS_AIRLINES)
    return airlines
