"""
Stats WebSocket consumer for real-time statistics.

Provides WebSocket access to all cached statistics with filter support
and subscription-based updates.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Set

from channels.db import database_sync_to_async
from django.core.cache import cache
from django.utils import timezone

from skyspy.channels.consumers.base import BaseConsumer

logger = logging.getLogger(__name__)

# Stat types supported by this consumer
STAT_TYPES = {
    # Flight patterns & geographic
    'flight_patterns': 'Flight pattern statistics (routes, busiest hours, aircraft types)',
    'geographic': 'Geographic statistics (countries, airlines, airports)',
    'busiest_hours': 'Busiest hours breakdown',
    'common_aircraft_types': 'Most common aircraft types',
    'countries': 'Countries of origin breakdown',
    'airlines': 'Airline frequency statistics',
    'airports': 'Connected airports/locations',

    # Session analytics
    'tracking_quality': 'Tracking quality metrics (update rates, coverage gaps)',
    'coverage_gaps': 'Coverage gap analysis',
    'engagement': 'Engagement statistics (favorites, peak tracking)',

    # Time-based comparison
    'week_comparison': 'Week-over-week comparison',
    'seasonal_trends': 'Seasonal/monthly trends',
    'day_night': 'Day vs night traffic ratio',
    'weekend_weekday': 'Weekend vs weekday patterns',
    'daily_totals': 'Daily totals time series',
    'weekly_totals': 'Weekly totals time series',
    'monthly_totals': 'Monthly totals time series',
    'time_comparison': 'All time comparison stats combined',

    # ACARS
    'acars_stats': 'ACARS message statistics',
    'acars_trends': 'ACARS message trends',
    'acars_airlines': 'ACARS by airline',
    'acars_categories': 'ACARS message categories',
    'acars_text_analysis': 'ACARS free text analysis',

    # Gamification
    'personal_records': 'Personal tracking records',
    'rare_sightings': 'Rare/notable sightings',
    'collection_stats': 'Collection/spotting statistics',
    'spotted_by_type': 'Spotted aircraft by type',
    'spotted_by_operator': 'Spotted aircraft by operator',
    'streaks': 'Sighting streaks',
    'daily_stats': 'Daily gamification stats',
    'lifetime_stats': 'Lifetime totals',

    # General
    'history_stats': 'Historical statistics',
    'history_trends': 'Historical trends',
    'history_top': 'Top performers',
    'safety_stats': 'Safety event statistics',
    'aircraft_stats': 'Current aircraft statistics',
    'top_aircraft': 'Top aircraft by category',
}


class StatsConsumer(BaseConsumer):
    """
    WebSocket consumer for statistics.

    Message Formats:

    Request stats:
        {"type": "stats.request", "stat_type": "flight_patterns", "filters": {"hours": 24}}

    Response:
        {"type": "stats.response", "stat_type": "flight_patterns", "data": {...}}

    Subscribe to updates:
        {"type": "stats.subscribe", "stat_types": ["tracking_quality", "acars_trends"]}

    Unsubscribe:
        {"type": "stats.unsubscribe", "stat_types": ["tracking_quality"]}

    Broadcast updates (when Celery refreshes stats):
        {"type": "stats.update", "stat_type": "flight_patterns", "data": {...}}
    """

    group_name_prefix = 'stats'
    supported_topics = list(STAT_TYPES.keys()) + ['all']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.subscribed_stat_types: Set[str] = set()
        self.default_filters = {}

    async def connect(self):
        """Handle WebSocket connection."""
        await self.accept()

        # Initialize rate limiter from base class
        from skyspy.channels.consumers.base import RateLimiter
        if self.enable_rate_limiting:
            self._rate_limiter = RateLimiter()
        else:
            self._rate_limiter = None
        self._message_batcher = None

        # Parse query parameters for initial stat types
        query_string = self.scope.get('query_string', b'').decode()
        stat_types = self._parse_stat_types(query_string)

        # Join the main stats group for broadcasts
        await self.channel_layer.group_add('stats_all', self.channel_name)

        # Subscribe to specific stat types if provided
        if stat_types:
            await self._subscribe_stat_types(stat_types)

        self.subscribed_topics = {'all'}

        logger.info(f"Stats WebSocket connected: {self.channel_name}, stat_types: {self.subscribed_stat_types}")

        # Send initial metadata
        await self.send_json({
            'type': 'stats.connected',
            'available_stat_types': list(STAT_TYPES.keys()),
            'subscribed': list(self.subscribed_stat_types),
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        # Leave the main stats group
        await self.channel_layer.group_discard('stats_all', self.channel_name)

        # Leave individual stat type groups
        for stat_type in self.subscribed_stat_types:
            group_name = f"stats_{stat_type}"
            await self.channel_layer.group_discard(group_name, self.channel_name)

        logger.info(f"Stats WebSocket disconnected: {self.channel_name}, code: {close_code}")

    async def receive_json(self, content):
        """Handle incoming JSON messages."""
        msg_type = content.get('type')

        if msg_type == 'stats.request':
            # Handle stats request
            stat_type = content.get('stat_type')
            filters = content.get('filters', {})
            request_id = content.get('request_id')
            await self._handle_stats_request(stat_type, filters, request_id)

        elif msg_type == 'stats.subscribe':
            # Subscribe to stat types
            stat_types = content.get('stat_types', [])
            if isinstance(stat_types, str):
                stat_types = [stat_types]
            await self._subscribe_stat_types(stat_types)
            await self.send_json({
                'type': 'stats.subscribed',
                'stat_types': list(self.subscribed_stat_types)
            })

        elif msg_type == 'stats.unsubscribe':
            # Unsubscribe from stat types
            stat_types = content.get('stat_types', [])
            if isinstance(stat_types, str):
                stat_types = [stat_types]
            await self._unsubscribe_stat_types(stat_types)
            await self.send_json({
                'type': 'stats.unsubscribed',
                'stat_types': stat_types,
                'remaining': list(self.subscribed_stat_types)
            })

        elif msg_type == 'stats.set_filters':
            # Set default filters for all requests
            self.default_filters = content.get('filters', {})
            await self.send_json({
                'type': 'stats.filters_set',
                'filters': self.default_filters
            })

        elif msg_type == 'stats.list':
            # List available stat types
            await self.send_json({
                'type': 'stats.list',
                'stat_types': STAT_TYPES,
                'subscribed': list(self.subscribed_stat_types)
            })

        elif msg_type == 'stats.refresh':
            # Request refresh of specific stat type
            stat_type = content.get('stat_type')
            if stat_type:
                await self._refresh_stat(stat_type)

        else:
            # Fall back to base class handling
            await super().receive_json(content)

    async def _handle_stats_request(self, stat_type: str, filters: dict, request_id: str = None):
        """Handle a request for statistics."""
        if stat_type not in STAT_TYPES:
            await self.send_json({
                'type': 'stats.error',
                'request_id': request_id,
                'error': f'Unknown stat type: {stat_type}',
                'available': list(STAT_TYPES.keys())
            })
            return

        # Merge default filters with request filters
        merged_filters = {**self.default_filters, **filters}

        # Get the stats data
        data = await self._get_stat_data(stat_type, merged_filters)

        await self.send_json({
            'type': 'stats.response',
            'request_id': request_id,
            'stat_type': stat_type,
            'filters': merged_filters,
            'data': data
        })

    async def _subscribe_stat_types(self, stat_types: list):
        """Subscribe to specific stat types for updates."""
        for stat_type in stat_types:
            if stat_type in STAT_TYPES or stat_type == 'all':
                if stat_type == 'all':
                    # Subscribe to all types
                    for st in STAT_TYPES.keys():
                        group_name = f"stats_{st}"
                        await self.channel_layer.group_add(group_name, self.channel_name)
                        self.subscribed_stat_types.add(st)
                else:
                    group_name = f"stats_{stat_type}"
                    await self.channel_layer.group_add(group_name, self.channel_name)
                    self.subscribed_stat_types.add(stat_type)

    async def _unsubscribe_stat_types(self, stat_types: list):
        """Unsubscribe from specific stat types."""
        for stat_type in stat_types:
            if stat_type == 'all':
                # Unsubscribe from all
                for st in list(self.subscribed_stat_types):
                    group_name = f"stats_{st}"
                    await self.channel_layer.group_discard(group_name, self.channel_name)
                self.subscribed_stat_types.clear()
            elif stat_type in self.subscribed_stat_types:
                group_name = f"stats_{stat_type}"
                await self.channel_layer.group_discard(group_name, self.channel_name)
                self.subscribed_stat_types.discard(stat_type)

    async def _refresh_stat(self, stat_type: str):
        """Request a refresh of a specific stat type."""
        # Note: This triggers an async refresh, the result will be broadcast
        await self.send_json({
            'type': 'stats.refresh_started',
            'stat_type': stat_type
        })

        # Trigger the refresh in background
        await self._trigger_stat_refresh(stat_type)

    @database_sync_to_async
    def _trigger_stat_refresh(self, stat_type: str):
        """Trigger a stat refresh (sync wrapper for async context)."""
        # Import here to avoid circular imports
        from skyspy.services import stats_cache
        from skyspy.services import time_comparison_stats
        from skyspy.services import acars_stats
        from skyspy.services.gamification import gamification_service

        try:
            if stat_type == 'flight_patterns':
                stats_cache.refresh_flight_patterns_cache(broadcast=True)
            elif stat_type == 'geographic':
                stats_cache.refresh_geographic_cache(broadcast=True)
            elif stat_type == 'tracking_quality':
                stats_cache.refresh_tracking_quality_cache(broadcast=True)
            elif stat_type == 'engagement':
                stats_cache.refresh_engagement_cache(broadcast=True)
            elif stat_type in ('week_comparison', 'seasonal_trends', 'day_night',
                              'weekend_weekday', 'daily_totals', 'weekly_totals',
                              'monthly_totals', 'time_comparison'):
                time_comparison_stats.refresh_time_comparison_cache(broadcast=True)
            elif stat_type in ('acars_stats', 'acars_trends', 'acars_airlines'):
                acars_stats.refresh_acars_stats_cache(broadcast=True)
            elif stat_type in ('history_stats', 'history_trends', 'history_top'):
                stats_cache.refresh_history_cache(broadcast=True)
            elif stat_type == 'safety_stats':
                stats_cache.refresh_safety_cache(broadcast=True)
            # Gamification stats typically update on session completion, not refreshed manually
            logger.debug(f"Triggered refresh for stat type: {stat_type}")
        except Exception as e:
            logger.error(f"Error refreshing {stat_type}: {e}")

    @database_sync_to_async
    def _get_stat_data(self, stat_type: str, filters: dict) -> dict:
        """Get statistics data based on type and filters."""
        # Import here to avoid circular imports
        from skyspy.services import stats_cache
        from skyspy.services import time_comparison_stats
        from skyspy.services import acars_stats
        from skyspy.services.gamification import gamification_service

        # Extract common filters
        hours = filters.get('hours', 24)
        days = filters.get('days', 30)
        weeks = filters.get('weeks', 4)
        months = filters.get('months', 12)
        limit = filters.get('limit', 50)
        aircraft_type = filters.get('aircraft_type')
        airline = filters.get('airline')
        force_refresh = filters.get('force_refresh', False)

        try:
            # Flight patterns & geographic
            if stat_type == 'flight_patterns':
                data = stats_cache.get_flight_patterns_stats()
                if not data or force_refresh:
                    data = stats_cache.calculate_flight_patterns_stats(hours=hours)
                return self._apply_filters(data, filters)

            elif stat_type == 'geographic':
                data = stats_cache.get_geographic_stats()
                if not data or force_refresh:
                    data = stats_cache.calculate_geographic_stats(hours=hours)
                return self._apply_filters(data, filters)

            elif stat_type == 'busiest_hours':
                data = stats_cache.get_flight_patterns_stats()
                if data:
                    return {
                        'busiest_hours': data.get('busiest_hours', []),
                        'peak_hour': data.get('peak_hour'),
                        'peak_aircraft_count': data.get('peak_aircraft_count'),
                        'timestamp': data.get('timestamp')
                    }
                return {}

            elif stat_type == 'common_aircraft_types':
                data = stats_cache.get_flight_patterns_stats()
                if data:
                    types_data = data.get('common_aircraft_types', [])
                    if aircraft_type:
                        types_data = [t for t in types_data if aircraft_type.lower() in t.get('type_code', '').lower()]
                    return {
                        'common_aircraft_types': types_data[:limit],
                        'timestamp': data.get('timestamp')
                    }
                return {}

            elif stat_type == 'countries':
                data = stats_cache.get_geographic_stats()
                if data:
                    return {
                        'countries_breakdown': data.get('countries_breakdown', [])[:limit],
                        'summary': data.get('summary', {}),
                        'timestamp': data.get('timestamp')
                    }
                return {}

            elif stat_type == 'airlines':
                data = stats_cache.get_geographic_stats()
                if data:
                    airlines_data = data.get('operators_frequency', [])
                    if airline:
                        airlines_data = [a for a in airlines_data if
                                        airline.lower() in (a.get('operator', '') or '').lower() or
                                        airline.lower() in (a.get('operator_icao', '') or '').lower()]
                    return {
                        'operators_frequency': airlines_data[:limit],
                        'timestamp': data.get('timestamp')
                    }
                return {}

            elif stat_type == 'airports':
                data = stats_cache.get_geographic_stats()
                if data:
                    return {
                        'connected_locations': data.get('connected_locations', [])[:limit],
                        'timestamp': data.get('timestamp')
                    }
                return {}

            # Session analytics
            elif stat_type == 'tracking_quality':
                data = stats_cache.get_tracking_quality_stats()
                if not data or force_refresh:
                    data = stats_cache.calculate_tracking_quality_stats(hours=hours)
                return data or {}

            elif stat_type == 'coverage_gaps':
                return stats_cache.get_coverage_gaps_analysis(hours=hours)

            elif stat_type == 'engagement':
                data = stats_cache.get_engagement_stats()
                if not data or force_refresh:
                    data = stats_cache.calculate_engagement_stats(hours=hours)
                return data or {}

            # Time-based comparison
            elif stat_type == 'week_comparison':
                return time_comparison_stats.get_week_comparison() or {}

            elif stat_type == 'seasonal_trends':
                return time_comparison_stats.get_seasonal_trends() or {}

            elif stat_type == 'day_night':
                data = time_comparison_stats.get_day_night_ratio()
                if not data or force_refresh:
                    data = time_comparison_stats.calculate_day_night_ratio(days=days)
                return data or {}

            elif stat_type == 'weekend_weekday':
                data = time_comparison_stats.get_weekend_weekday_patterns()
                if not data or force_refresh:
                    data = time_comparison_stats.calculate_weekend_weekday_patterns(weeks=weeks)
                return data or {}

            elif stat_type == 'daily_totals':
                return time_comparison_stats.get_daily_totals(days=days) or {}

            elif stat_type == 'weekly_totals':
                return time_comparison_stats.get_weekly_totals(weeks=weeks) or {}

            elif stat_type == 'monthly_totals':
                return time_comparison_stats.get_monthly_totals(months=months) or {}

            elif stat_type == 'time_comparison':
                return time_comparison_stats.get_all_time_comparison_stats() or {}

            # ACARS
            elif stat_type == 'acars_stats':
                data = acars_stats.get_cached_acars_stats()
                if not data or force_refresh:
                    data = acars_stats.calculate_acars_message_stats(hours=hours)
                return data or {}

            elif stat_type == 'acars_trends':
                data = acars_stats.get_cached_acars_trends()
                if not data or force_refresh:
                    data = acars_stats.calculate_acars_trends(hours=hours)
                return data or {}

            elif stat_type == 'acars_airlines':
                data = acars_stats.get_cached_acars_airlines()
                if not data or force_refresh:
                    data = acars_stats.calculate_acars_airline_stats(hours=hours, limit=limit)
                if airline and data:
                    airlines_data = data.get('airlines', [])
                    airlines_data = [a for a in airlines_data if
                                    airline.lower() in (a.get('airline_name', '') or '').lower() or
                                    airline.lower() in (a.get('airline_icao', '') or '').lower()]
                    data['airlines'] = airlines_data
                return data or {}

            elif stat_type == 'acars_categories':
                return acars_stats.calculate_acars_category_trends(hours=hours)

            elif stat_type == 'acars_text_analysis':
                return acars_stats.calculate_free_text_analysis(hours=hours, limit=limit)

            # Gamification
            elif stat_type == 'personal_records':
                return gamification_service.get_personal_records(force_refresh=force_refresh)

            elif stat_type == 'rare_sightings':
                include_acknowledged = filters.get('include_acknowledged', False)
                return gamification_service.get_rare_sightings(
                    hours=hours,
                    limit=limit,
                    include_acknowledged=include_acknowledged,
                    force_refresh=force_refresh
                )

            elif stat_type == 'collection_stats':
                return gamification_service.get_collection_stats(force_refresh=force_refresh)

            elif stat_type == 'spotted_by_type':
                return gamification_service.get_spotted_by_type(limit=limit, force_refresh=force_refresh)

            elif stat_type == 'spotted_by_operator':
                return gamification_service.get_spotted_by_operator(limit=limit, force_refresh=force_refresh)

            elif stat_type == 'streaks':
                return gamification_service.get_streaks(force_refresh=force_refresh)

            elif stat_type == 'daily_stats':
                return gamification_service.get_daily_stats(days=days, force_refresh=force_refresh)

            elif stat_type == 'lifetime_stats':
                return gamification_service.get_lifetime_stats(force_refresh=force_refresh)

            # General/History
            elif stat_type == 'history_stats':
                data = stats_cache.get_history_stats()
                if not data or force_refresh:
                    data = stats_cache.calculate_history_stats(hours=hours)
                return data or {}

            elif stat_type == 'history_trends':
                data = stats_cache.get_history_trends()
                if not data or force_refresh:
                    interval = filters.get('interval', 'hour')
                    data = stats_cache.calculate_history_trends(hours=hours, interval=interval)
                return data or {}

            elif stat_type == 'history_top':
                data = stats_cache.get_history_top()
                if not data or force_refresh:
                    data = stats_cache.calculate_history_top(hours=hours, limit=limit)
                return data or {}

            elif stat_type == 'safety_stats':
                data = stats_cache.get_safety_stats()
                if not data or force_refresh:
                    data = stats_cache.calculate_safety_stats(hours=hours)
                return data or {}

            elif stat_type == 'aircraft_stats':
                return stats_cache.get_aircraft_stats() or {}

            elif stat_type == 'top_aircraft':
                return stats_cache.get_top_aircraft() or {}

            else:
                return {'error': f'Unknown stat type: {stat_type}'}

        except Exception as e:
            logger.error(f"Error getting stat data for {stat_type}: {e}")
            return {'error': str(e)}

    def _apply_filters(self, data: dict, filters: dict) -> dict:
        """Apply additional filters to data if applicable."""
        if not data:
            return data

        aircraft_type = filters.get('aircraft_type')
        airline = filters.get('airline')
        min_count = filters.get('min_count')

        # Filter aircraft types if present
        if aircraft_type and 'common_aircraft_types' in data:
            data['common_aircraft_types'] = [
                t for t in data.get('common_aircraft_types', [])
                if aircraft_type.lower() in (t.get('type_code', '') or '').lower()
            ]

        # Filter airlines if present
        if airline and 'operators_frequency' in data:
            data['operators_frequency'] = [
                o for o in data.get('operators_frequency', [])
                if airline.lower() in (o.get('operator', '') or '').lower() or
                   airline.lower() in (o.get('operator_icao', '') or '').lower()
            ]

        # Filter by minimum count
        if min_count is not None:
            for key in ['common_aircraft_types', 'operators_frequency', 'countries_breakdown']:
                if key in data:
                    count_field = 'session_count' if 'aircraft_types' in key else 'count'
                    if key == 'operators_frequency':
                        count_field = 'aircraft_count'
                    data[key] = [
                        item for item in data.get(key, [])
                        if (item.get(count_field) or 0) >= min_count
                    ]

        return data

    def _parse_stat_types(self, query_string: str) -> list:
        """Parse stat types from query string."""
        if not query_string:
            return []

        stat_types = []
        for param in query_string.split('&'):
            if '=' in param:
                key, value = param.split('=', 1)
                if key == 'stat_types' or key == 'types':
                    stat_types.extend(value.split(','))
        return stat_types

    # Channel layer message handlers for broadcasts

    async def stats_update(self, event):
        """Handle stats update broadcast from Celery tasks."""
        stat_type = event.get('stat_type')
        data = event.get('data', {})

        # Only send if client is subscribed to this stat type
        if stat_type in self.subscribed_stat_types or 'all' in self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': stat_type,
                'data': data
            })

    async def stats_broadcast(self, event):
        """Handle generic stats broadcast."""
        await self.send_json({
            'type': 'stats.broadcast',
            'data': event.get('data', {})
        })

    async def flight_patterns_update(self, event):
        """Handle flight patterns update."""
        if 'flight_patterns' in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': 'flight_patterns',
                'data': event.get('data', {})
            })

    async def geographic_update(self, event):
        """Handle geographic stats update."""
        if 'geographic' in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': 'geographic',
                'data': event.get('data', {})
            })

    async def tracking_quality_update(self, event):
        """Handle tracking quality update."""
        if 'tracking_quality' in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': 'tracking_quality',
                'data': event.get('data', {})
            })

    async def engagement_update(self, event):
        """Handle engagement stats update."""
        if 'engagement' in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': 'engagement',
                'data': event.get('data', {})
            })

    async def time_comparison_update(self, event):
        """Handle time comparison stats update."""
        if 'time_comparison' in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': 'time_comparison',
                'data': event.get('data', {})
            })

    async def acars_stats_update(self, event):
        """Handle ACARS stats update."""
        if 'acars_stats' in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': 'acars_stats',
                'data': event.get('data', {})
            })

    async def gamification_update(self, event):
        """Handle gamification stats update."""
        stat_type = event.get('stat_type', 'gamification')
        if stat_type in self.subscribed_stat_types or not self.subscribed_stat_types:
            await self.send_json({
                'type': 'stats.update',
                'stat_type': stat_type,
                'data': event.get('data', {})
            })

    async def stats_count_changed(self, event):
        """Handle aircraft count change broadcast."""
        await self.send_json({
            'type': 'stats.count_changed',
            'data': event.get('data', {})
        })

    async def stats_quality_update(self, event):
        """Handle tracking quality update broadcast."""
        await self.send_json({
            'type': 'stats.quality_update',
            'data': event.get('data', {})
        })


def broadcast_stats_to_websocket(stat_type: str, data: dict) -> None:
    """
    Broadcast stats update to WebSocket clients.

    Call this from Celery tasks after refreshing cached stats.
    """
    from channels.layers import get_channel_layer
    from skyspy.utils import sync_group_send

    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            # Broadcast to the general stats group
            sync_group_send(
                channel_layer,
                'stats_all',
                {
                    'type': 'stats_update',
                    'stat_type': stat_type,
                    'data': data
                }
            )

            # Also broadcast to the specific stat type group
            sync_group_send(
                channel_layer,
                f'stats_{stat_type}',
                {
                    'type': 'stats_update',
                    'stat_type': stat_type,
                    'data': data
                }
            )

            logger.debug(f"Broadcast stats update: {stat_type}")
    except Exception as e:
        logger.warning(f"Failed to broadcast stats update: {e}")
