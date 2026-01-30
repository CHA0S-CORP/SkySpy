"""
Flight Pattern and Geographic Statistics Service.

Provides comprehensive statistics and analytics for flight patterns and geographic data:

Flight Patterns:
- Most frequent routes/city pairs (based on origin/destination from session data or ACARS)
- Busiest hours of the day (aggregate position counts by hour for heatmap data)
- Average flight duration by aircraft type
- Most common aircraft types/models

Geographic Stats:
- Countries of origin breakdown (parse registration prefixes to determine country)
- Airlines/operators frequency
- Airports most connected to coverage area

Update Intervals:
- Flight pattern stats: 2 minutes (cached)
- Geographic stats: 2 minutes (cached)
"""
import logging
import re
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict, Counter

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Avg, Max, Min, Sum, F, Q
from django.db.models.functions import TruncHour, TruncDay, ExtractHour, Extract
from django.utils import timezone

from skyspy.models import (
    AircraftSighting, AircraftSession, AircraftInfo,
    AcarsMessage, CachedAirport,
)

logger = logging.getLogger(__name__)


class ExtractEpoch(Extract):
    """Extract epoch seconds from timestamp for duration calculations."""
    lookup_name = "epoch"


# =============================================================================
# Cache Configuration
# =============================================================================

# Cache keys
CACHE_KEY_FLIGHT_PATTERNS = 'stats:flight_patterns:v2'
CACHE_KEY_GEOGRAPHIC = 'stats:geographic:v2'
CACHE_KEY_ROUTE_ANALYSIS = 'stats:routes:v2'
CACHE_KEY_AIRPORT_CONNECTIVITY = 'stats:airport_connectivity:v2'
CACHE_KEY_ALL_STATS = 'stats:flight_geo_all:v2'

# Cache timeouts (seconds)
CACHE_TIMEOUT = 300  # 5 minutes

# Update intervals
UPDATE_INTERVAL = 120  # 2 minutes


# =============================================================================
# Registration Prefix to Country Mapping (Extended)
# =============================================================================

REGISTRATION_PREFIXES = {
    # North America
    'N': 'United States',
    'C-F': 'Canada',
    'C-G': 'Canada',
    'C-I': 'Canada',
    'CF-': 'Canada',
    'XA-': 'Mexico',
    'XB-': 'Mexico',
    'XC-': 'Mexico',
    # Europe
    'G-': 'United Kingdom',
    'D-': 'Germany',
    'F-': 'France',
    'I-': 'Italy',
    'EC-': 'Spain',
    'PH-': 'Netherlands',
    'HB-': 'Switzerland',
    'OE-': 'Austria',
    'OO-': 'Belgium',
    'SE-': 'Sweden',
    'LN-': 'Norway',
    'OY-': 'Denmark',
    'OH-': 'Finland',
    'EI-': 'Ireland',
    'CS-': 'Portugal',
    'SP-': 'Poland',
    'OK-': 'Czech Republic',
    'SX-': 'Greece',
    'HA-': 'Hungary',
    'YR-': 'Romania',
    'UR-': 'Ukraine',
    'TF-': 'Iceland',
    'LX-': 'Luxembourg',
    'ES-': 'Estonia',
    'YL-': 'Latvia',
    'LY-': 'Lithuania',
    'OM-': 'Slovakia',
    'S5-': 'Slovenia',
    '9H-': 'Malta',
    '9A-': 'Croatia',
    'T7-': 'San Marino',
    # Russia/CIS
    'RA-': 'Russia',
    'RF-': 'Russia',
    'EW-': 'Belarus',
    'UP-': 'Kazakhstan',
    'UK-': 'Uzbekistan',
    'EY-': 'Tajikistan',
    '4K-': 'Azerbaijan',
    'EK-': 'Armenia',
    '4L-': 'Georgia',
    # Asia-Pacific
    'JA': 'Japan',
    'B-': 'China',
    'HL': 'South Korea',
    'VH-': 'Australia',
    'ZK-': 'New Zealand',
    '9V-': 'Singapore',
    '9M-': 'Malaysia',
    'PK-': 'Indonesia',
    'RP-': 'Philippines',
    'HS-': 'Thailand',
    'VN-': 'Vietnam',
    'VT-': 'India',
    'AP-': 'Pakistan',
    'S2-': 'Bangladesh',
    '4R-': 'Sri Lanka',
    'A7-': 'Qatar',
    'A6-': 'United Arab Emirates',
    'HZ-': 'Saudi Arabia',
    '9K-': 'Kuwait',
    'A9C-': 'Bahrain',
    'A4O-': 'Oman',
    'EP-': 'Iran',
    'TC-': 'Turkey',
    '4X-': 'Israel',
    'JY-': 'Jordan',
    'OD-': 'Lebanon',
    'YK-': 'Syria',
    # South America
    'PP-': 'Brazil',
    'PR-': 'Brazil',
    'PT-': 'Brazil',
    'PU-': 'Brazil',
    'PS-': 'Brazil',
    'LV-': 'Argentina',
    'LQ-': 'Argentina',
    'CC-': 'Chile',
    'HK-': 'Colombia',
    'HC-': 'Ecuador',
    'OB-': 'Peru',
    'CP-': 'Bolivia',
    'CX-': 'Uruguay',
    'ZP-': 'Paraguay',
    'YV-': 'Venezuela',
    # Africa
    'ZS-': 'South Africa',
    'ZT-': 'South Africa',
    'ZU-': 'South Africa',
    'CN-': 'Morocco',
    'SU-': 'Egypt',
    '5N-': 'Nigeria',
    '5H-': 'Tanzania',
    '5Y-': 'Kenya',
    'ET-': 'Ethiopia',
    '5A-': 'Libya',
    '7T-': 'Algeria',
    'TS-': 'Tunisia',
    '9G-': 'Ghana',
}


def _get_country_from_registration(registration: str) -> Optional[str]:
    """
    Determine country of origin from aircraft registration prefix.

    Checks longer prefixes first for more specific matches.
    """
    if not registration:
        return None

    registration = registration.upper().strip()

    # Check longer prefixes first (3, then 2, then 1 char)
    for prefix_len in [3, 2, 1]:
        for prefix, country in REGISTRATION_PREFIXES.items():
            if len(prefix) == prefix_len and registration.startswith(prefix):
                return country

    # Special case for US N-number (N followed by digit)
    if registration and registration[0] == 'N' and len(registration) > 1:
        if registration[1].isdigit():
            return 'United States'

    # Special case for Japan (JA followed by digits)
    if registration and registration[:2] == 'JA' and len(registration) > 2:
        return 'Japan'

    # Special case for South Korea (HL followed by digits)
    if registration and registration[:2] == 'HL' and len(registration) > 2:
        return 'South Korea'

    return 'Unknown'


# =============================================================================
# Flight Pattern Statistics
# =============================================================================

def calculate_frequent_routes(hours: int = 24, limit: int = 20) -> list:
    """
    Calculate most frequent routes/city pairs.

    Uses multiple data sources:
    1. ACARS messages with origin/destination information
    2. Callsign patterns to identify airline routes
    3. Session data grouped by operator
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    routes = []

    # === Method 1: Extract from ACARS decoded data ===
    try:
        acars_routes = _extract_routes_from_acars(cutoff, limit)
        routes.extend(acars_routes)
    except Exception as e:
        logger.warning(f"Error extracting ACARS routes: {e}")

    # === Method 2: Analyze callsign patterns (airline codes) ===
    try:
        callsign_routes = _analyze_callsign_routes(cutoff, limit)
        routes.extend(callsign_routes)
    except Exception as e:
        logger.warning(f"Error analyzing callsign routes: {e}")

    # Deduplicate and sort by frequency
    route_map = {}
    for route in routes:
        key = route.get('route_key', route.get('airline_code', ''))
        if key in route_map:
            route_map[key]['count'] += route.get('count', 1)
        else:
            route_map[key] = route

    sorted_routes = sorted(
        route_map.values(),
        key=lambda x: x.get('count', 0),
        reverse=True
    )

    return sorted_routes[:limit]


def _extract_routes_from_acars(cutoff: datetime, limit: int = 20) -> list:
    """Extract route information from ACARS decoded data."""
    routes = []

    # Look for ACARS messages with decoded route data
    messages = AcarsMessage.objects.filter(
        timestamp__gte=cutoff,
        decoded__isnull=False
    ).values('decoded', 'callsign')[:1000]

    route_counts = Counter()
    route_details = {}

    for msg in messages:
        decoded = msg.get('decoded') or {}

        # Look for origin/destination in various formats
        origin = decoded.get('dep') or decoded.get('origin') or decoded.get('departure')
        dest = decoded.get('arr') or decoded.get('dest') or decoded.get('destination') or decoded.get('arrival')

        if origin and dest:
            route_key = f"{origin}-{dest}"
            route_counts[route_key] += 1
            if route_key not in route_details:
                route_details[route_key] = {
                    'origin': origin,
                    'destination': dest,
                    'callsigns': set()
                }
            if msg.get('callsign'):
                route_details[route_key]['callsigns'].add(msg['callsign'])

    for route_key, count in route_counts.most_common(limit):
        details = route_details.get(route_key, {})
        routes.append({
            'route_key': route_key,
            'origin': details.get('origin'),
            'destination': details.get('destination'),
            'count': count,
            'sample_callsigns': list(details.get('callsigns', set()))[:5],
            'source': 'acars'
        })

    return routes


def _analyze_callsign_routes(cutoff: datetime, limit: int = 20) -> list:
    """
    Analyze callsign patterns to identify airline activity.

    ICAO callsigns typically start with 3-letter airline code followed by flight number.
    """
    callsign_data = (
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            callsign__isnull=False
        )
        .exclude(callsign='')
        .values('callsign')
        .annotate(count=Count('id'))
        .order_by('-count')[:500]
    )

    # Group by airline code (first 3 characters if alphabetic)
    airline_flights = defaultdict(lambda: {
        'count': 0,
        'callsigns': [],
        'unique_flights': set()
    })

    for row in callsign_data:
        callsign = (row['callsign'] or '').strip().upper()
        if not callsign:
            continue

        # Extract airline code (typically first 3 letters)
        match = re.match(r'^([A-Z]{2,3})(\d+[A-Z]?)?$', callsign)
        if match:
            airline_code = match.group(1)
            flight_num = match.group(2) or ''

            airline_flights[airline_code]['count'] += row['count']
            airline_flights[airline_code]['unique_flights'].add(callsign)

            if len(airline_flights[airline_code]['callsigns']) < 10:
                airline_flights[airline_code]['callsigns'].append(callsign)

    routes = []
    for code, data in airline_flights.items():
        routes.append({
            'route_key': code,
            'airline_code': code,
            'count': data['count'],
            'unique_flights': len(data['unique_flights']),
            'sample_callsigns': data['callsigns'][:5],
            'source': 'callsign'
        })

    return sorted(routes, key=lambda x: x['count'], reverse=True)[:limit]


def calculate_busiest_hours(hours: int = 24) -> dict:
    """
    Calculate busiest hours of the day for heatmap visualization.

    Returns position counts aggregated by hour (0-23) with additional metrics.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

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
            max_altitude=Max('altitude_baro'),
            max_speed=Max('ground_speed'),
            avg_distance=Avg('distance_nm'),
        )
        .order_by('hour')
    )

    hourly_stats = {}
    peak_hour = None
    peak_count = 0
    total_positions = 0

    for row in hourly_data:
        hour = row['hour'] if row['hour'] is not None else 0
        unique = row['unique_aircraft'] or 0
        positions = row['position_count'] or 0

        total_positions += positions

        if unique > peak_count:
            peak_count = unique
            peak_hour = hour

        hourly_stats[hour] = {
            'hour': hour,
            'position_count': positions,
            'unique_aircraft': unique,
            'military_count': row['military_count'] or 0,
            'avg_altitude': round(row['avg_altitude']) if row['avg_altitude'] else None,
            'max_altitude': row['max_altitude'],
            'avg_speed': round(row['avg_speed']) if row['avg_speed'] else None,
            'max_speed': row['max_speed'],
            'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
        }

    # Fill in missing hours with zero values
    busiest_hours = []
    for hour in range(24):
        if hour in hourly_stats:
            busiest_hours.append(hourly_stats[hour])
        else:
            busiest_hours.append({
                'hour': hour,
                'position_count': 0,
                'unique_aircraft': 0,
                'military_count': 0,
                'avg_altitude': None,
                'max_altitude': None,
                'avg_speed': None,
                'max_speed': None,
                'avg_distance_nm': None,
            })

    # Calculate quietest hour
    quietest_hour = min(busiest_hours, key=lambda x: x['unique_aircraft'])['hour']

    # Calculate day vs night breakdown (6am-6pm is day)
    day_positions = sum(h['position_count'] for h in busiest_hours if 6 <= h['hour'] < 18)
    night_positions = sum(h['position_count'] for h in busiest_hours if h['hour'] < 6 or h['hour'] >= 18)

    return {
        'busiest_hours': busiest_hours,
        'peak_hour': peak_hour,
        'peak_aircraft_count': peak_count,
        'quietest_hour': quietest_hour,
        'total_positions': total_positions,
        'day_positions': day_positions,
        'night_positions': night_positions,
        'day_night_ratio': round(day_positions / night_positions, 2) if night_positions > 0 else None,
    }


def calculate_duration_by_type(hours: int = 24, limit: int = 25) -> list:
    """
    Calculate average flight duration statistics by aircraft type.

    Returns duration metrics (min/avg/max) for each aircraft type seen.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    duration_data = (
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            aircraft_type__isnull=False
        )
        .exclude(aircraft_type='')
        .annotate(
            duration_seconds=ExtractEpoch(F('last_seen') - F('first_seen'))
        )
        .filter(duration_seconds__gt=60)  # At least 1 minute
        .values('aircraft_type')
        .annotate(
            count=Count('id'),
            avg_duration=Avg('duration_seconds'),
            max_duration=Max('duration_seconds'),
            min_duration=Min('duration_seconds'),
            total_positions=Sum('total_positions'),
            military_count=Count('id', filter=Q(is_military=True)),
        )
        .order_by('-count')[:limit]
    )

    result = []
    for row in duration_data:
        if row['avg_duration']:
            result.append({
                'aircraft_type': row['aircraft_type'],
                'count': row['count'],
                'avg_duration_min': round(row['avg_duration'] / 60, 1),
                'max_duration_min': round(row['max_duration'] / 60, 1) if row['max_duration'] else None,
                'min_duration_min': round(row['min_duration'] / 60, 1) if row['min_duration'] else None,
                'total_positions': row['total_positions'] or 0,
                'military_count': row['military_count'] or 0,
                'military_pct': round((row['military_count'] / row['count']) * 100, 1) if row['count'] > 0 else 0,
            })

    # Enrich with type names from AircraftInfo
    type_codes = [t['aircraft_type'] for t in result]
    type_names = dict(
        AircraftInfo.objects.filter(type_code__in=type_codes)
        .values_list('type_code', 'type_name')
        .distinct()[:100]
    )

    for item in result:
        item['type_name'] = type_names.get(item['aircraft_type'])

    return result


def calculate_common_aircraft_types(hours: int = 24, limit: int = 30) -> list:
    """
    Calculate most common aircraft types/models seen in coverage area.

    Includes session counts, unique aircraft, and military percentage.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    type_data = (
        AircraftSession.objects.filter(
            last_seen__gt=cutoff,
            aircraft_type__isnull=False
        )
        .exclude(aircraft_type='')
        .values('aircraft_type')
        .annotate(
            session_count=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            military_count=Count('id', filter=Q(is_military=True)),
            total_positions=Sum('total_positions'),
            avg_duration=Avg(ExtractEpoch(F('last_seen') - F('first_seen'))),
        )
        .order_by('-session_count')[:limit]
    )

    result = []
    for row in type_data:
        result.append({
            'type_code': row['aircraft_type'],
            'session_count': row['session_count'],
            'unique_aircraft': row['unique_aircraft'],
            'military_count': row['military_count'],
            'military_pct': round((row['military_count'] / row['session_count']) * 100, 1) if row['session_count'] > 0 else 0,
            'total_positions': row['total_positions'] or 0,
            'avg_duration_min': round(row['avg_duration'] / 60, 1) if row['avg_duration'] else None,
        })

    # Enrich with type names and manufacturer info
    type_codes = [t['type_code'] for t in result]
    type_info = {}
    for info in AircraftInfo.objects.filter(type_code__in=type_codes).values('type_code', 'type_name', 'manufacturer').distinct()[:100]:
        if info['type_code'] not in type_info:
            type_info[info['type_code']] = {
                'type_name': info['type_name'],
                'manufacturer': info['manufacturer']
            }

    for item in result:
        info = type_info.get(item['type_code'], {})
        item['type_name'] = info.get('type_name')
        item['manufacturer'] = info.get('manufacturer')

    return result


# =============================================================================
# Geographic Statistics
# =============================================================================

def calculate_countries_breakdown(hours: int = 24, limit: int = 25) -> list:
    """
    Calculate countries of origin breakdown from registration prefixes.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # Get unique ICAO addresses from recent sessions
    recent_icaos = list(
        AircraftSession.objects.filter(last_seen__gt=cutoff)
        .values_list('icao_hex', flat=True)
        .distinct()
    )

    # Get registrations from AircraftInfo
    aircraft_with_reg = AircraftInfo.objects.filter(
        icao_hex__in=recent_icaos,
        registration__isnull=False
    ).exclude(registration='')

    country_counts = Counter()
    country_military = Counter()
    country_aircraft = defaultdict(set)

    for info in aircraft_with_reg.values('icao_hex', 'registration', 'is_military'):
        country = _get_country_from_registration(info['registration'])
        if country:
            country_counts[country] += 1
            country_aircraft[country].add(info['icao_hex'])
            if info.get('is_military'):
                country_military[country] += 1

    total_with_reg = sum(country_counts.values())

    result = []
    for country, count in country_counts.most_common(limit):
        result.append({
            'country': country,
            'count': count,
            'unique_aircraft': len(country_aircraft[country]),
            'percentage': round((count / total_with_reg) * 100, 1) if total_with_reg > 0 else 0,
            'military_count': country_military.get(country, 0),
            'military_pct': round((country_military.get(country, 0) / count) * 100, 1) if count > 0 else 0,
        })

    return result


def calculate_operators_frequency(hours: int = 24, limit: int = 25) -> list:
    """
    Calculate airlines/operators frequency from AircraftInfo.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # Get unique ICAO addresses from recent sessions
    recent_icaos = list(
        AircraftSession.objects.filter(last_seen__gt=cutoff)
        .values_list('icao_hex', flat=True)
        .distinct()
    )

    operator_data = (
        AircraftInfo.objects.filter(
            icao_hex__in=recent_icaos,
            operator__isnull=False
        )
        .exclude(operator='')
        .values('operator', 'operator_icao', 'country')
        .annotate(
            count=Count('id'),
            military_count=Count('id', filter=Q(is_military=True))
        )
        .order_by('-count')[:limit]
    )

    result = []
    for row in operator_data:
        result.append({
            'operator': row['operator'],
            'operator_icao': row['operator_icao'],
            'country': row['country'],
            'aircraft_count': row['count'],
            'military_count': row['military_count'],
        })

    return result


def calculate_airport_connectivity(hours: int = 24, limit: int = 20) -> list:
    """
    Calculate airports most connected to coverage area.

    Uses multiple data sources:
    1. ACARS messages mentioning airports
    2. Aircraft registered in cities near airports
    3. Session callsign analysis
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    airport_mentions = Counter()

    # === Method 1: ACARS airport mentions ===
    try:
        # Look for 4-letter ICAO codes in ACARS text
        acars_messages = AcarsMessage.objects.filter(
            timestamp__gte=cutoff,
            text__isnull=False
        ).exclude(text='').values_list('text', flat=True)[:5000]

        # Pattern for ICAO airport codes (4 letters starting with common prefixes)
        airport_pattern = re.compile(r'\b([KCEGLSPRVUBIY][A-Z]{3})\b')

        for text in acars_messages:
            if text:
                airports = airport_pattern.findall(text.upper())
                for apt in airports:
                    # Filter out common non-airport codes
                    if apt not in ('METAR', 'NOTAM', 'ATIS', 'SIGMET', 'AIRMET', 'PIREP'):
                        airport_mentions[apt] += 1

        # Also check decoded fields
        acars_decoded = AcarsMessage.objects.filter(
            timestamp__gte=cutoff,
            decoded__isnull=False
        ).values_list('decoded', flat=True)[:2000]

        for decoded in acars_decoded:
            if decoded:
                for key in ['dep', 'arr', 'origin', 'dest', 'destination', 'departure', 'arrival']:
                    apt = decoded.get(key)
                    if apt and len(apt) == 4:
                        airport_mentions[apt.upper()] += 5  # Weight decoded data higher

    except Exception as e:
        logger.warning(f"Error extracting ACARS airport data: {e}")

    # === Method 2: Match with cached airports for enrichment ===
    top_airports = airport_mentions.most_common(limit * 2)
    airport_codes = [apt for apt, _ in top_airports]

    # Get airport info from cache
    airports_info = {
        apt.icao_id: {
            'name': apt.name,
            'country': apt.country,
            'airport_type': apt.airport_type,
            'latitude': apt.latitude,
            'longitude': apt.longitude,
        }
        for apt in CachedAirport.objects.filter(icao_id__in=airport_codes)
    }

    result = []
    for apt_code, count in top_airports[:limit]:
        info = airports_info.get(apt_code, {})
        result.append({
            'icao_id': apt_code,
            'name': info.get('name') or apt_code,
            'country': info.get('country'),
            'airport_type': info.get('airport_type'),
            'mention_count': count,
            'latitude': info.get('latitude'),
            'longitude': info.get('longitude'),
        })

    return result


def calculate_military_breakdown(hours: int = 24) -> list:
    """
    Calculate military vs civilian breakdown by country.
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=hours)

    # Get sessions with aircraft info
    recent_sessions = AircraftSession.objects.filter(
        last_seen__gt=cutoff
    ).values('icao_hex', 'is_military')

    session_map = {s['icao_hex']: s['is_military'] for s in recent_sessions}
    icao_list = list(session_map.keys())

    # Get registration info
    reg_info = AircraftInfo.objects.filter(
        icao_hex__in=icao_list,
        registration__isnull=False
    ).exclude(registration='').values('icao_hex', 'registration')

    # Count by country and military status
    military_by_country = Counter()
    civilian_by_country = Counter()

    for info in reg_info:
        country = _get_country_from_registration(info['registration'])
        if country:
            is_military = session_map.get(info['icao_hex'], False)
            if is_military:
                military_by_country[country] += 1
            else:
                civilian_by_country[country] += 1

    # Combine into results
    all_countries = set(military_by_country.keys()) | set(civilian_by_country.keys())

    result = []
    for country in all_countries:
        mil = military_by_country.get(country, 0)
        civ = civilian_by_country.get(country, 0)
        total = mil + civ
        if total > 0:
            result.append({
                'country': country,
                'military_count': mil,
                'civilian_count': civ,
                'total': total,
                'military_pct': round((mil / total) * 100, 1),
            })

    result.sort(key=lambda x: x['total'], reverse=True)
    return result[:20]


# =============================================================================
# Combined Statistics Functions
# =============================================================================

def calculate_flight_pattern_stats(hours: int = 24) -> dict:
    """
    Calculate comprehensive flight pattern statistics.

    Returns:
    - Frequent routes/city pairs
    - Busiest hours of day (heatmap data)
    - Duration by aircraft type
    - Common aircraft types
    """
    now = timezone.now()

    try:
        frequent_routes = calculate_frequent_routes(hours=hours)
        busiest_hours_data = calculate_busiest_hours(hours=hours)
        duration_by_type = calculate_duration_by_type(hours=hours)
        common_types = calculate_common_aircraft_types(hours=hours)

        return {
            'frequent_routes': frequent_routes,
            'busiest_hours': busiest_hours_data['busiest_hours'],
            'peak_hour': busiest_hours_data['peak_hour'],
            'peak_aircraft_count': busiest_hours_data['peak_aircraft_count'],
            'quietest_hour': busiest_hours_data['quietest_hour'],
            'day_night_ratio': busiest_hours_data['day_night_ratio'],
            'avg_duration_by_type': duration_by_type,
            'common_aircraft_types': common_types,
            'summary': {
                'total_routes': len(frequent_routes),
                'total_aircraft_types': len(common_types),
                'total_positions': busiest_hours_data['total_positions'],
                'day_positions': busiest_hours_data['day_positions'],
                'night_positions': busiest_hours_data['night_positions'],
            },
            'time_range_hours': hours,
            'timestamp': now.isoformat() + 'Z',
        }
    except Exception as e:
        logger.error(f"Error calculating flight pattern stats: {e}")
        return {
            'frequent_routes': [],
            'busiest_hours': [],
            'peak_hour': None,
            'peak_aircraft_count': 0,
            'quietest_hour': None,
            'day_night_ratio': None,
            'avg_duration_by_type': [],
            'common_aircraft_types': [],
            'summary': {},
            'time_range_hours': hours,
            'timestamp': now.isoformat() + 'Z',
            'error': str(e),
        }


def calculate_geographic_stats(hours: int = 24) -> dict:
    """
    Calculate comprehensive geographic statistics.

    Returns:
    - Countries of origin breakdown
    - Operators/airlines frequency
    - Airport connectivity
    - Military vs civilian breakdown
    """
    now = timezone.now()

    try:
        countries = calculate_countries_breakdown(hours=hours)
        operators = calculate_operators_frequency(hours=hours)
        airports = calculate_airport_connectivity(hours=hours)
        military = calculate_military_breakdown(hours=hours)

        return {
            'countries_breakdown': countries,
            'operators_frequency': operators,
            'airport_connectivity': airports,
            'military_breakdown': military,
            'summary': {
                'total_countries': len(countries),
                'total_operators': len(operators),
                'total_airports': len(airports),
                'top_country': countries[0]['country'] if countries else None,
                'top_operator': operators[0]['operator'] if operators else None,
                'top_airport': airports[0]['icao_id'] if airports else None,
            },
            'time_range_hours': hours,
            'timestamp': now.isoformat() + 'Z',
        }
    except Exception as e:
        logger.error(f"Error calculating geographic stats: {e}")
        return {
            'countries_breakdown': [],
            'operators_frequency': [],
            'airport_connectivity': [],
            'military_breakdown': [],
            'summary': {},
            'time_range_hours': hours,
            'timestamp': now.isoformat() + 'Z',
            'error': str(e),
        }


def calculate_all_stats(hours: int = 24) -> dict:
    """
    Calculate all flight pattern and geographic statistics.

    Combined endpoint for efficiency when both stat types are needed.
    """
    now = timezone.now()

    flight_patterns = calculate_flight_pattern_stats(hours=hours)
    geographic = calculate_geographic_stats(hours=hours)

    return {
        'flight_patterns': flight_patterns,
        'geographic': geographic,
        'time_range_hours': hours,
        'timestamp': now.isoformat() + 'Z',
    }


# =============================================================================
# Cache Management
# =============================================================================

def refresh_flight_pattern_stats_cache(broadcast: bool = True) -> None:
    """Refresh flight pattern stats cache."""
    logger.debug("Refreshing flight pattern stats cache...")

    try:
        stats = calculate_flight_pattern_stats()
        cache.set(CACHE_KEY_FLIGHT_PATTERNS, stats, timeout=CACHE_TIMEOUT)
        logger.debug("Flight pattern stats cache refreshed")

        if broadcast:
            broadcast_stats_update('flight_patterns', stats)

    except Exception as e:
        logger.error(f"Error refreshing flight pattern stats cache: {e}")


def refresh_geographic_stats_cache(broadcast: bool = True) -> None:
    """Refresh geographic stats cache."""
    logger.debug("Refreshing geographic stats cache...")

    try:
        stats = calculate_geographic_stats()
        cache.set(CACHE_KEY_GEOGRAPHIC, stats, timeout=CACHE_TIMEOUT)
        logger.debug("Geographic stats cache refreshed")

        if broadcast:
            broadcast_stats_update('geographic', stats)

    except Exception as e:
        logger.error(f"Error refreshing geographic stats cache: {e}")


def refresh_all_stats_cache(broadcast: bool = True) -> dict:
    """
    Refresh all flight pattern and geographic stats cache.

    Returns the complete stats data.
    """
    logger.debug("Refreshing all flight pattern and geographic stats cache...")

    try:
        flight_patterns = calculate_flight_pattern_stats()
        geographic = calculate_geographic_stats()

        cache.set(CACHE_KEY_FLIGHT_PATTERNS, flight_patterns, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_GEOGRAPHIC, geographic, timeout=CACHE_TIMEOUT)

        all_stats = {
            'flight_patterns': flight_patterns,
            'geographic': geographic,
            'timestamp': timezone.now().isoformat() + 'Z',
        }
        cache.set(CACHE_KEY_ALL_STATS, all_stats, timeout=CACHE_TIMEOUT)

        logger.debug("All flight pattern and geographic stats cache refreshed")

        if broadcast:
            broadcast_stats_update('flight_patterns', flight_patterns)
            broadcast_stats_update('geographic', geographic)

        return all_stats

    except Exception as e:
        logger.error(f"Error refreshing all stats cache: {e}")
        return {}


def broadcast_stats_update(stat_type: str, data: dict) -> None:
    """Broadcast stats update via WebSocket."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit('stats:update', {
            'stat_type': stat_type,
            'stats': data
        }, room='topic_stats')
        logger.debug(f"Broadcast flight pattern stats update: {stat_type}")
    except Exception as e:
        logger.warning(f"Failed to broadcast flight pattern stats update: {e}")


# =============================================================================
# Public API - Get Cached Data
# =============================================================================

def get_flight_pattern_stats() -> Optional[dict]:
    """Get cached flight pattern stats, refreshing if needed."""
    stats = cache.get(CACHE_KEY_FLIGHT_PATTERNS)
    if stats is None:
        refresh_flight_pattern_stats_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_FLIGHT_PATTERNS)
    return stats


def get_geographic_stats() -> Optional[dict]:
    """Get cached geographic stats, refreshing if needed."""
    stats = cache.get(CACHE_KEY_GEOGRAPHIC)
    if stats is None:
        refresh_geographic_stats_cache(broadcast=False)
        stats = cache.get(CACHE_KEY_GEOGRAPHIC)
    return stats


def get_all_stats() -> Optional[dict]:
    """Get all cached stats, refreshing if needed."""
    stats = cache.get(CACHE_KEY_ALL_STATS)
    if stats is None:
        stats = refresh_all_stats_cache(broadcast=False)
    return stats


def get_frequent_routes(hours: int = 24) -> list:
    """Get frequent routes, using cache if available."""
    stats = get_flight_pattern_stats()
    if stats and stats.get('time_range_hours') == hours:
        return stats.get('frequent_routes', [])
    return calculate_frequent_routes(hours=hours)


def get_busiest_hours(hours: int = 24) -> list:
    """Get busiest hours, using cache if available."""
    stats = get_flight_pattern_stats()
    if stats and stats.get('time_range_hours') == hours:
        return stats.get('busiest_hours', [])
    return calculate_busiest_hours(hours=hours).get('busiest_hours', [])


def get_airport_connectivity(hours: int = 24) -> list:
    """Get airport connectivity, using cache if available."""
    stats = get_geographic_stats()
    if stats and stats.get('time_range_hours') == hours:
        return stats.get('airport_connectivity', [])
    return calculate_airport_connectivity(hours=hours)
