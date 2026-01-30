"""
Time Comparison Stats Service.

Provides cached time-based comparison statistics:
- Week-over-week comparison (this week vs last week)
- Seasonal trends (monthly aggregates for year-over-year comparison)
- Day vs night traffic ratios
- Weekend vs weekday patterns
- Daily, weekly, monthly trend data for charts

Update Intervals:
- Time comparison stats: 5 minutes (cached)
- Trend data: 5 minutes (cached)
"""
import logging
from datetime import datetime, timedelta, date, time
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Avg, Max, Min, Sum, F, Q
from django.db.models.functions import TruncDay, TruncWeek, TruncMonth, ExtractHour, ExtractWeekDay
from django.utils import timezone

from skyspy.models import AircraftSighting, AircraftSession

logger = logging.getLogger(__name__)

# Cache keys
CACHE_KEY_WEEK_COMPARISON = 'stats:time:week_comparison'
CACHE_KEY_SEASONAL_TRENDS = 'stats:time:seasonal'
CACHE_KEY_DAY_NIGHT = 'stats:time:day_night'
CACHE_KEY_WEEKEND_WEEKDAY = 'stats:time:weekend_weekday'
CACHE_KEY_DAILY_TOTALS = 'stats:time:daily_totals'
CACHE_KEY_WEEKLY_TOTALS = 'stats:time:weekly_totals'
CACHE_KEY_MONTHLY_TOTALS = 'stats:time:monthly_totals'
CACHE_KEY_TIME_COMPARISON_ALL = 'stats:time:all'

# Cache timeout (5 minutes)
CACHE_TIMEOUT = 300

# Day/Night hours configuration (6am-6pm is day by default)
DAY_START_HOUR = 6
DAY_END_HOUR = 18


def _get_week_dates(weeks_ago: int = 0) -> tuple[datetime, datetime]:
    """Get start and end datetime for a specific week (0 = current week)."""
    today = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    # Monday of current week
    monday = today - timedelta(days=today.weekday())
    # Shift by weeks_ago
    target_monday = monday - timedelta(weeks=weeks_ago)
    target_sunday = target_monday + timedelta(days=7)
    return target_monday, target_sunday


def _get_month_dates(months_ago: int = 0) -> tuple[datetime, datetime]:
    """Get start and end datetime for a specific month (0 = current month)."""
    today = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0, day=1)
    # Go back months_ago months
    year = today.year
    month = today.month - months_ago
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1

    start = today.replace(year=year, month=month, day=1)

    # Calculate end of month
    if month == 12:
        end = start.replace(year=year + 1, month=1)
    else:
        end = start.replace(month=month + 1)

    return start, end


def calculate_week_over_week_comparison() -> dict:
    """
    Calculate week-over-week comparison statistics.

    Compares this week vs last week for:
    - Total aircraft (unique ICAO addresses)
    - Total positions (sightings)
    - Total sessions
    - Military aircraft
    """
    now = timezone.now()

    # This week dates
    this_week_start, this_week_end = _get_week_dates(0)
    # Last week dates
    last_week_start, last_week_end = _get_week_dates(1)

    def get_week_stats(start: datetime, end: datetime) -> dict:
        """Get statistics for a specific week."""
        # Limit to data up to now if checking current week
        effective_end = min(end, now)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=start,
            timestamp__lt=effective_end
        )

        sessions = AircraftSession.objects.filter(
            first_seen__gte=start,
            first_seen__lt=effective_end
        )

        sighting_stats = sightings.aggregate(
            total_positions=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            military_positions=Count('id', filter=Q(is_military=True)),
            avg_altitude=Avg('altitude_baro'),
            avg_distance=Avg('distance_nm'),
        )

        session_stats = sessions.aggregate(
            total_sessions=Count('id'),
            military_sessions=Count('id', filter=Q(is_military=True)),
        )

        return {
            'total_positions': sighting_stats['total_positions'] or 0,
            'unique_aircraft': sighting_stats['unique_aircraft'] or 0,
            'total_sessions': session_stats['total_sessions'] or 0,
            'military_aircraft': sessions.filter(is_military=True).values('icao_hex').distinct().count(),
            'military_positions': sighting_stats['military_positions'] or 0,
            'military_sessions': session_stats['military_sessions'] or 0,
            'avg_altitude': round(sighting_stats['avg_altitude']) if sighting_stats['avg_altitude'] else None,
            'avg_distance_nm': round(sighting_stats['avg_distance'], 1) if sighting_stats['avg_distance'] else None,
            'start': start.isoformat() + 'Z',
            'end': effective_end.isoformat() + 'Z',
        }

    this_week = get_week_stats(this_week_start, this_week_end)
    last_week = get_week_stats(last_week_start, last_week_end)

    # Calculate changes
    def calc_change(current: int, previous: int) -> dict:
        """Calculate change and percentage."""
        if previous == 0:
            pct = 100.0 if current > 0 else 0.0
        else:
            pct = ((current - previous) / previous) * 100
        return {
            'absolute': current - previous,
            'percentage': round(pct, 1),
        }

    return {
        'this_week': this_week,
        'last_week': last_week,
        'changes': {
            'total_positions': calc_change(this_week['total_positions'], last_week['total_positions']),
            'unique_aircraft': calc_change(this_week['unique_aircraft'], last_week['unique_aircraft']),
            'total_sessions': calc_change(this_week['total_sessions'], last_week['total_sessions']),
            'military_aircraft': calc_change(this_week['military_aircraft'], last_week['military_aircraft']),
        },
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_seasonal_trends(months: int = 12) -> dict:
    """
    Calculate monthly aggregates for seasonal/year-over-year comparison.

    Returns monthly totals for the past N months, grouped by month name
    to enable year-over-year comparison.
    """
    now = timezone.now()
    monthly_data = []

    for i in range(months):
        start, end = _get_month_dates(i)
        effective_end = min(end, now)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=start,
            timestamp__lt=effective_end
        )

        sessions = AircraftSession.objects.filter(
            first_seen__gte=start,
            first_seen__lt=effective_end
        )

        sighting_stats = sightings.aggregate(
            total_positions=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
        )

        session_count = sessions.count()

        monthly_data.append({
            'year': start.year,
            'month': start.month,
            'month_name': start.strftime('%B'),
            'total_positions': sighting_stats['total_positions'] or 0,
            'unique_aircraft': sighting_stats['unique_aircraft'] or 0,
            'total_sessions': session_count,
            'start': start.isoformat() + 'Z',
            'end': effective_end.isoformat() + 'Z',
        })

    # Sort by date (oldest first)
    monthly_data.sort(key=lambda x: (x['year'], x['month']))

    # Group by month name for year-over-year comparison
    by_month_name = {}
    for m in monthly_data:
        name = m['month_name']
        if name not in by_month_name:
            by_month_name[name] = []
        by_month_name[name].append({
            'year': m['year'],
            'total_positions': m['total_positions'],
            'unique_aircraft': m['unique_aircraft'],
            'total_sessions': m['total_sessions'],
        })

    return {
        'monthly_data': monthly_data,
        'by_month_name': by_month_name,
        'months_included': months,
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_day_night_ratio(days: int = 30) -> dict:
    """
    Calculate day vs night traffic ratios.

    Day is defined as 6am-6pm local time by default.
    Returns traffic breakdown and ratios.
    """
    now = timezone.now()
    cutoff = now - timedelta(days=days)

    sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff)

    # Annotate with hour
    day_night_data = sightings.annotate(
        hour=ExtractHour('timestamp')
    ).values('hour').annotate(
        position_count=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        military_count=Count('id', filter=Q(is_military=True)),
    ).order_by('hour')

    # Aggregate by day/night
    day_stats = {'positions': 0, 'unique_aircraft': set(), 'military': 0}
    night_stats = {'positions': 0, 'unique_aircraft': set(), 'military': 0}
    hourly_breakdown = []

    for row in day_night_data:
        hour = row['hour']
        is_day = DAY_START_HOUR <= hour < DAY_END_HOUR

        hourly_breakdown.append({
            'hour': hour,
            'period': 'day' if is_day else 'night',
            'position_count': row['position_count'] or 0,
            'unique_aircraft': row['unique_aircraft'] or 0,
            'military_count': row['military_count'] or 0,
        })

        if is_day:
            day_stats['positions'] += row['position_count'] or 0
            day_stats['military'] += row['military_count'] or 0
        else:
            night_stats['positions'] += row['position_count'] or 0
            night_stats['military'] += row['military_count'] or 0

    # Get unique aircraft counts for day and night
    day_aircraft = sightings.annotate(
        hour=ExtractHour('timestamp')
    ).filter(
        hour__gte=DAY_START_HOUR,
        hour__lt=DAY_END_HOUR
    ).values('icao_hex').distinct().count()

    night_aircraft = sightings.annotate(
        hour=ExtractHour('timestamp')
    ).exclude(
        hour__gte=DAY_START_HOUR,
        hour__lt=DAY_END_HOUR
    ).values('icao_hex').distinct().count()

    day_stats['unique_aircraft'] = day_aircraft
    night_stats['unique_aircraft'] = night_aircraft

    # Calculate ratios
    total_positions = day_stats['positions'] + night_stats['positions']
    day_ratio = (day_stats['positions'] / total_positions * 100) if total_positions > 0 else 0
    night_ratio = (night_stats['positions'] / total_positions * 100) if total_positions > 0 else 0

    return {
        'day': {
            'hours': f'{DAY_START_HOUR:02d}:00 - {DAY_END_HOUR:02d}:00',
            'start_hour': DAY_START_HOUR,
            'end_hour': DAY_END_HOUR,
            'total_positions': day_stats['positions'],
            'unique_aircraft': day_stats['unique_aircraft'],
            'military_positions': day_stats['military'],
            'percentage': round(day_ratio, 1),
        },
        'night': {
            'hours': f'{DAY_END_HOUR:02d}:00 - {DAY_START_HOUR:02d}:00',
            'start_hour': DAY_END_HOUR,
            'end_hour': DAY_START_HOUR,
            'total_positions': night_stats['positions'],
            'unique_aircraft': night_stats['unique_aircraft'],
            'military_positions': night_stats['military'],
            'percentage': round(night_ratio, 1),
        },
        'ratio': {
            'day_to_night': round(day_stats['positions'] / night_stats['positions'], 2) if night_stats['positions'] > 0 else None,
            'description': 'Day-to-night traffic ratio',
        },
        'hourly_breakdown': hourly_breakdown,
        'days_analyzed': days,
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_weekend_weekday_patterns(weeks: int = 4) -> dict:
    """
    Calculate weekend vs weekday traffic patterns.

    Compares Saturday-Sunday averages to Monday-Friday averages.
    """
    now = timezone.now()
    cutoff = now - timedelta(weeks=weeks)

    sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff)

    # ExtractWeekDay returns 1=Sunday through 7=Saturday in Django/PostgreSQL
    # Weekend: 1 (Sunday), 7 (Saturday)
    # Weekday: 2-6 (Monday-Friday)

    daily_data = sightings.annotate(
        weekday=ExtractWeekDay('timestamp'),
        day=TruncDay('timestamp')
    ).values('day', 'weekday').annotate(
        position_count=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        military_count=Count('id', filter=Q(is_military=True)),
    ).order_by('day')

    # Aggregate by day type
    weekend_days = []
    weekday_days = []

    for row in daily_data:
        weekday = row['weekday']
        day_data = {
            'date': row['day'].isoformat() if row['day'] else None,
            'weekday': weekday,
            'position_count': row['position_count'] or 0,
            'unique_aircraft': row['unique_aircraft'] or 0,
            'military_count': row['military_count'] or 0,
        }

        # 1=Sunday, 7=Saturday are weekends
        if weekday in [1, 7]:
            weekend_days.append(day_data)
        else:
            weekday_days.append(day_data)

    # Calculate averages
    def calc_avg(days_list: list, key: str) -> float:
        if not days_list:
            return 0
        return sum(d[key] for d in days_list) / len(days_list)

    weekend_avg = {
        'avg_positions': round(calc_avg(weekend_days, 'position_count')),
        'avg_unique_aircraft': round(calc_avg(weekend_days, 'unique_aircraft')),
        'avg_military': round(calc_avg(weekend_days, 'military_count')),
        'day_count': len(weekend_days),
        'total_positions': sum(d['position_count'] for d in weekend_days),
        'total_unique_aircraft': sum(d['unique_aircraft'] for d in weekend_days),
    }

    weekday_avg = {
        'avg_positions': round(calc_avg(weekday_days, 'position_count')),
        'avg_unique_aircraft': round(calc_avg(weekday_days, 'unique_aircraft')),
        'avg_military': round(calc_avg(weekday_days, 'military_count')),
        'day_count': len(weekday_days),
        'total_positions': sum(d['position_count'] for d in weekday_days),
        'total_unique_aircraft': sum(d['unique_aircraft'] for d in weekday_days),
    }

    # Calculate per-day-of-week averages
    dow_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    daily_breakdown = []
    for dow in range(1, 8):
        dow_days = [d for d in (weekend_days + weekday_days) if d['weekday'] == dow]
        if dow_days:
            daily_breakdown.append({
                'day_of_week': dow,
                'day_name': dow_names[dow - 1],
                'is_weekend': dow in [1, 7],
                'avg_positions': round(calc_avg(dow_days, 'position_count')),
                'avg_unique_aircraft': round(calc_avg(dow_days, 'unique_aircraft')),
                'avg_military': round(calc_avg(dow_days, 'military_count')),
                'sample_count': len(dow_days),
            })

    # Calculate ratio
    ratio = None
    if weekday_avg['avg_positions'] > 0:
        ratio = round(weekend_avg['avg_positions'] / weekday_avg['avg_positions'], 2)

    return {
        'weekend': weekend_avg,
        'weekday': weekday_avg,
        'ratio': {
            'weekend_to_weekday': ratio,
            'description': 'Weekend-to-weekday average traffic ratio',
        },
        'by_day_of_week': daily_breakdown,
        'weeks_analyzed': weeks,
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_daily_totals(days: int = 30) -> dict:
    """
    Calculate daily totals for the past N days.

    Returns data suitable for time-series charts.
    """
    now = timezone.now()
    cutoff = now - timedelta(days=days)

    daily_data = AircraftSighting.objects.filter(
        timestamp__gte=cutoff
    ).annotate(
        day=TruncDay('timestamp')
    ).values('day').annotate(
        total_positions=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        military_positions=Count('id', filter=Q(is_military=True)),
        avg_altitude=Avg('altitude_baro'),
        avg_distance=Avg('distance_nm'),
        max_distance=Max('distance_nm'),
    ).order_by('day')

    # Also get session counts per day
    session_data = AircraftSession.objects.filter(
        first_seen__gte=cutoff
    ).annotate(
        day=TruncDay('first_seen')
    ).values('day').annotate(
        total_sessions=Count('id'),
        military_sessions=Count('id', filter=Q(is_military=True)),
    )

    session_by_day = {s['day']: s for s in session_data}

    result = []
    for row in daily_data:
        day = row['day']
        session_row = session_by_day.get(day, {})

        result.append({
            'date': day.isoformat() if day else None,
            'total_positions': row['total_positions'] or 0,
            'unique_aircraft': row['unique_aircraft'] or 0,
            'total_sessions': session_row.get('total_sessions', 0),
            'military_positions': row['military_positions'] or 0,
            'military_sessions': session_row.get('military_sessions', 0),
            'avg_altitude': round(row['avg_altitude']) if row['avg_altitude'] else None,
            'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
            'max_distance_nm': round(row['max_distance'], 1) if row['max_distance'] else None,
        })

    # Calculate summary statistics
    if result:
        total_positions = sum(r['total_positions'] for r in result)
        avg_daily_positions = total_positions / len(result)
        peak_day = max(result, key=lambda x: x['total_positions'])
        lowest_day = min(result, key=lambda x: x['total_positions'])
    else:
        avg_daily_positions = 0
        peak_day = None
        lowest_day = None

    return {
        'daily_data': result,
        'summary': {
            'days_included': len(result),
            'total_positions': sum(r['total_positions'] for r in result),
            'avg_daily_positions': round(avg_daily_positions),
            'peak_day': peak_day['date'] if peak_day else None,
            'peak_positions': peak_day['total_positions'] if peak_day else 0,
            'lowest_day': lowest_day['date'] if lowest_day else None,
            'lowest_positions': lowest_day['total_positions'] if lowest_day else 0,
        },
        'days_requested': days,
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_weekly_totals(weeks: int = 12) -> dict:
    """
    Calculate weekly totals for the past N weeks.

    Returns data suitable for time-series charts.
    """
    now = timezone.now()
    cutoff = now - timedelta(weeks=weeks)

    weekly_data = AircraftSighting.objects.filter(
        timestamp__gte=cutoff
    ).annotate(
        week=TruncWeek('timestamp')
    ).values('week').annotate(
        total_positions=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        military_positions=Count('id', filter=Q(is_military=True)),
        avg_altitude=Avg('altitude_baro'),
        avg_distance=Avg('distance_nm'),
        max_distance=Max('distance_nm'),
    ).order_by('week')

    # Also get session counts per week
    session_data = AircraftSession.objects.filter(
        first_seen__gte=cutoff
    ).annotate(
        week=TruncWeek('first_seen')
    ).values('week').annotate(
        total_sessions=Count('id'),
        military_sessions=Count('id', filter=Q(is_military=True)),
    )

    session_by_week = {s['week']: s for s in session_data}

    result = []
    for row in weekly_data:
        week = row['week']
        session_row = session_by_week.get(week, {})

        result.append({
            'week_start': week.isoformat() if week else None,
            'week_end': (week + timedelta(days=6)).isoformat() if week else None,
            'total_positions': row['total_positions'] or 0,
            'unique_aircraft': row['unique_aircraft'] or 0,
            'total_sessions': session_row.get('total_sessions', 0),
            'military_positions': row['military_positions'] or 0,
            'military_sessions': session_row.get('military_sessions', 0),
            'avg_altitude': round(row['avg_altitude']) if row['avg_altitude'] else None,
            'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
            'max_distance_nm': round(row['max_distance'], 1) if row['max_distance'] else None,
        })

    # Calculate summary
    if result:
        total_positions = sum(r['total_positions'] for r in result)
        avg_weekly_positions = total_positions / len(result)
        peak_week = max(result, key=lambda x: x['total_positions'])
        lowest_week = min(result, key=lambda x: x['total_positions'])
    else:
        avg_weekly_positions = 0
        peak_week = None
        lowest_week = None

    return {
        'weekly_data': result,
        'summary': {
            'weeks_included': len(result),
            'total_positions': sum(r['total_positions'] for r in result),
            'avg_weekly_positions': round(avg_weekly_positions),
            'peak_week': peak_week['week_start'] if peak_week else None,
            'peak_positions': peak_week['total_positions'] if peak_week else 0,
            'lowest_week': lowest_week['week_start'] if lowest_week else None,
            'lowest_positions': lowest_week['total_positions'] if lowest_week else 0,
        },
        'weeks_requested': weeks,
        'timestamp': now.isoformat() + 'Z',
    }


def calculate_monthly_totals(months: int = 12) -> dict:
    """
    Calculate monthly totals for the past N months.

    Returns data suitable for time-series charts.
    """
    now = timezone.now()

    # Calculate cutoff date (beginning of month N months ago)
    year = now.year
    month = now.month - months
    while month <= 0:
        month += 12
        year -= 1
    cutoff = now.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)

    monthly_data = AircraftSighting.objects.filter(
        timestamp__gte=cutoff
    ).annotate(
        month=TruncMonth('timestamp')
    ).values('month').annotate(
        total_positions=Count('id'),
        unique_aircraft=Count('icao_hex', distinct=True),
        military_positions=Count('id', filter=Q(is_military=True)),
        avg_altitude=Avg('altitude_baro'),
        avg_distance=Avg('distance_nm'),
        max_distance=Max('distance_nm'),
    ).order_by('month')

    # Also get session counts per month
    session_data = AircraftSession.objects.filter(
        first_seen__gte=cutoff
    ).annotate(
        month=TruncMonth('first_seen')
    ).values('month').annotate(
        total_sessions=Count('id'),
        military_sessions=Count('id', filter=Q(is_military=True)),
    )

    session_by_month = {s['month']: s for s in session_data}

    result = []
    for row in monthly_data:
        month = row['month']
        session_row = session_by_month.get(month, {})

        # Calculate month end
        if month:
            if month.month == 12:
                month_end = month.replace(year=month.year + 1, month=1) - timedelta(days=1)
            else:
                month_end = month.replace(month=month.month + 1) - timedelta(days=1)
        else:
            month_end = None

        result.append({
            'month': month.strftime('%Y-%m') if month else None,
            'month_name': month.strftime('%B %Y') if month else None,
            'month_start': month.isoformat() if month else None,
            'month_end': month_end.isoformat() if month_end else None,
            'total_positions': row['total_positions'] or 0,
            'unique_aircraft': row['unique_aircraft'] or 0,
            'total_sessions': session_row.get('total_sessions', 0),
            'military_positions': row['military_positions'] or 0,
            'military_sessions': session_row.get('military_sessions', 0),
            'avg_altitude': round(row['avg_altitude']) if row['avg_altitude'] else None,
            'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
            'max_distance_nm': round(row['max_distance'], 1) if row['max_distance'] else None,
        })

    # Calculate summary
    if result:
        total_positions = sum(r['total_positions'] for r in result)
        avg_monthly_positions = total_positions / len(result)
        peak_month = max(result, key=lambda x: x['total_positions'])
        lowest_month = min(result, key=lambda x: x['total_positions'])
    else:
        avg_monthly_positions = 0
        peak_month = None
        lowest_month = None

    return {
        'monthly_data': result,
        'summary': {
            'months_included': len(result),
            'total_positions': sum(r['total_positions'] for r in result),
            'avg_monthly_positions': round(avg_monthly_positions),
            'peak_month': peak_month['month'] if peak_month else None,
            'peak_positions': peak_month['total_positions'] if peak_month else 0,
            'lowest_month': lowest_month['month'] if lowest_month else None,
            'lowest_positions': lowest_month['total_positions'] if lowest_month else 0,
        },
        'months_requested': months,
        'timestamp': now.isoformat() + 'Z',
    }


def refresh_time_comparison_cache(broadcast: bool = True) -> dict:
    """
    Refresh all time comparison stats cache.

    Returns the complete comparison data.
    """
    logger.debug("Refreshing time comparison stats cache...")

    try:
        week_comparison = calculate_week_over_week_comparison()
        seasonal = calculate_seasonal_trends()
        day_night = calculate_day_night_ratio()
        weekend_weekday = calculate_weekend_weekday_patterns()
        daily = calculate_daily_totals()
        weekly = calculate_weekly_totals()
        monthly = calculate_monthly_totals()

        # Store individual caches
        cache.set(CACHE_KEY_WEEK_COMPARISON, week_comparison, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_SEASONAL_TRENDS, seasonal, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_DAY_NIGHT, day_night, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_WEEKEND_WEEKDAY, weekend_weekday, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_DAILY_TOTALS, daily, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_WEEKLY_TOTALS, weekly, timeout=CACHE_TIMEOUT)
        cache.set(CACHE_KEY_MONTHLY_TOTALS, monthly, timeout=CACHE_TIMEOUT)

        # Store combined cache
        all_stats = {
            'week_comparison': week_comparison,
            'seasonal_trends': seasonal,
            'day_night': day_night,
            'weekend_weekday': weekend_weekday,
            'daily_totals': daily,
            'weekly_totals': weekly,
            'monthly_totals': monthly,
            'timestamp': timezone.now().isoformat() + 'Z',
        }
        cache.set(CACHE_KEY_TIME_COMPARISON_ALL, all_stats, timeout=CACHE_TIMEOUT)

        logger.debug("Time comparison stats cache refreshed")

        # Broadcast update if requested
        if broadcast:
            broadcast_time_comparison_update(all_stats)

        return all_stats

    except Exception as e:
        logger.error(f"Error refreshing time comparison cache: {e}")
        return {}


def broadcast_time_comparison_update(data: dict) -> None:
    """Broadcast time comparison stats update via WebSocket."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit('stats:update', {
            'stat_type': 'time_comparison',
            'stats': data
        }, room='topic_stats')
        logger.debug("Broadcast time comparison stats update")
    except Exception as e:
        logger.warning(f"Failed to broadcast time comparison stats: {e}")


# Public API - Get Cached Data

def get_week_comparison() -> Optional[dict]:
    """Get cached week-over-week comparison stats."""
    stats = cache.get(CACHE_KEY_WEEK_COMPARISON)
    if stats is None:
        stats = calculate_week_over_week_comparison()
        cache.set(CACHE_KEY_WEEK_COMPARISON, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_seasonal_trends() -> Optional[dict]:
    """Get cached seasonal trends stats."""
    stats = cache.get(CACHE_KEY_SEASONAL_TRENDS)
    if stats is None:
        stats = calculate_seasonal_trends()
        cache.set(CACHE_KEY_SEASONAL_TRENDS, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_day_night_ratio() -> Optional[dict]:
    """Get cached day/night ratio stats."""
    stats = cache.get(CACHE_KEY_DAY_NIGHT)
    if stats is None:
        stats = calculate_day_night_ratio()
        cache.set(CACHE_KEY_DAY_NIGHT, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_weekend_weekday_patterns() -> Optional[dict]:
    """Get cached weekend/weekday patterns stats."""
    stats = cache.get(CACHE_KEY_WEEKEND_WEEKDAY)
    if stats is None:
        stats = calculate_weekend_weekday_patterns()
        cache.set(CACHE_KEY_WEEKEND_WEEKDAY, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_daily_totals(days: int = 30) -> Optional[dict]:
    """Get cached daily totals."""
    # Use custom days if different from default
    if days != 30:
        return calculate_daily_totals(days)

    stats = cache.get(CACHE_KEY_DAILY_TOTALS)
    if stats is None:
        stats = calculate_daily_totals(days)
        cache.set(CACHE_KEY_DAILY_TOTALS, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_weekly_totals(weeks: int = 12) -> Optional[dict]:
    """Get cached weekly totals."""
    # Use custom weeks if different from default
    if weeks != 12:
        return calculate_weekly_totals(weeks)

    stats = cache.get(CACHE_KEY_WEEKLY_TOTALS)
    if stats is None:
        stats = calculate_weekly_totals(weeks)
        cache.set(CACHE_KEY_WEEKLY_TOTALS, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_monthly_totals(months: int = 12) -> Optional[dict]:
    """Get cached monthly totals."""
    # Use custom months if different from default
    if months != 12:
        return calculate_monthly_totals(months)

    stats = cache.get(CACHE_KEY_MONTHLY_TOTALS)
    if stats is None:
        stats = calculate_monthly_totals(months)
        cache.set(CACHE_KEY_MONTHLY_TOTALS, stats, timeout=CACHE_TIMEOUT)
    return stats


def get_all_time_comparison_stats() -> dict:
    """Get all cached time comparison stats."""
    stats = cache.get(CACHE_KEY_TIME_COMPARISON_ALL)
    if stats is None:
        stats = refresh_time_comparison_cache(broadcast=False)
    return stats
