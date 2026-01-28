"""
Aircraft WebSocket consumer for real-time position updates.
"""
import logging
import statistics as stats_lib
from datetime import datetime, timedelta
from typing import Optional
from channels.db import database_sync_to_async
from asgiref.sync import sync_to_async
from django.core.cache import cache
from django.utils import timezone
from django.db.models import Count, Avg, Max, Min, F, Q, Case, When, Value, CharField
from django.db.models.functions import TruncHour, Floor, ExtractHour

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.models import AircraftSighting, AircraftSession, AircraftInfo

logger = logging.getLogger(__name__)


def _parse_int_param(value, default: int, min_val: int = None, max_val: int = None) -> int:
    """
    Safely parse an integer parameter with bounds checking.

    Args:
        value: The value to parse (can be str, int, or None)
        default: Default value if parsing fails
        min_val: Minimum allowed value (optional)
        max_val: Maximum allowed value (optional)

    Returns:
        Validated integer within bounds
    """
    try:
        result = int(value) if value is not None else default
    except (ValueError, TypeError):
        result = default

    if min_val is not None and result < min_val:
        result = min_val
    if max_val is not None and result > max_val:
        result = max_val

    return result


class AircraftConsumer(BaseConsumer):
    """
    WebSocket consumer for aircraft position updates.

    Events:
    - aircraft:snapshot - Initial aircraft state on connect
    - aircraft:new - New aircraft detected
    - aircraft:update - Aircraft position/state changed
    - aircraft:delta - Delta updates with only changed fields
    - aircraft:remove - Aircraft no longer tracked
    - aircraft:heartbeat - Periodic count update

    Topics:
    - aircraft - All aircraft updates
    - stats - Filtered statistics
    - all - Combined feed

    RPi Optimizations:
    - Rate limiting enabled to reduce bandwidth
    - Message batching enabled for high-frequency updates
    - Delta updates to send only changed fields
    """

    group_name_prefix = 'aircraft'
    supported_topics = ['aircraft', 'stats', 'all']

    # Enable RPi optimizations for this high-traffic consumer
    enable_rate_limiting = True
    enable_batching = True

    # Fields to track for delta updates
    DELTA_FIELDS = ['lat', 'lon', 'alt', 'alt_baro', 'track', 'gs', 'vr', 'baro_rate', 'squawk']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.client_filters = {}
        self._previous_aircraft_state: dict = {}  # For delta tracking

    async def receive_json(self, content):
        """Handle incoming JSON messages with aircraft-specific actions."""
        action = content.get('action')

        if action == 'subscribe_stats':
            # Handle stats subscription with filters
            filters = content if isinstance(content, dict) else {}
            self.client_filters = {
                'military_only': filters.get('military_only', False),
                'category': filters.get('category'),
                'min_altitude': filters.get('min_altitude'),
                'max_altitude': filters.get('max_altitude'),
                'min_distance': filters.get('min_distance'),
                'max_distance': filters.get('max_distance'),
                'aircraft_type': filters.get('aircraft_type'),
            }
            await self._join_topics(['stats'])
            await self.send_json({
                'type': 'subscribed',
                'topics': ['stats'],
                'filters': self.client_filters
            })

        elif action == 'update_stats_filters':
            # Update filters for existing stats subscription
            filters = content.get('filters', {})
            self.client_filters.update(filters)
            await self.send_json({
                'type': 'filters_updated',
                'filters': self.client_filters
            })

        else:
            await super().receive_json(content)

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response messages."""
        if request_type == 'aircraft':
            # Return single aircraft by ICAO
            icao = params.get('icao')
            if icao:
                aircraft = await self.get_aircraft_by_icao(icao)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'aircraft',
                    'data': aircraft
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing icao parameter'
                })

        elif request_type == 'aircraft_list':
            # Return list of aircraft with optional filters
            aircraft_list = await self.get_aircraft_list(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'aircraft_list',
                'data': aircraft_list
            })

        elif request_type == 'aircraft-info':
            # Get detailed aircraft info
            icao = params.get('icao') or params.get('hex')
            if icao:
                info = await self.get_aircraft_info(icao)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'aircraft-info',
                    'data': info
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing icao parameter'
                })

        elif request_type == 'aircraft-info-bulk':
            # Get detailed aircraft info for multiple ICAOs
            icaos = params.get('icaos', [])
            if icaos and isinstance(icaos, list):
                info = await self.get_aircraft_info_bulk(icaos)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'aircraft-info-bulk',
                    'data': info
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing or invalid icaos parameter (expected list)'
                })

        elif request_type == 'aircraft-stats':
            # Get live aircraft statistics
            stats = await self.get_aircraft_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'aircraft-stats',
                'data': stats
            })

        elif request_type == 'aircraft-top':
            # Get top aircraft by category
            top = await self.get_top_aircraft()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'aircraft-top',
                'data': top
            })

        elif request_type == 'sightings':
            # Get historical sightings
            sightings = await self.get_sightings(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'sightings',
                'data': sightings
            })

        elif request_type == 'history-stats':
            # Get history statistics
            stats = await self.get_history_stats(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-stats',
                'data': stats
            })

        elif request_type == 'history-trends':
            # Get traffic trends
            trends = await self.get_history_trends(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-trends',
                'data': trends
            })

        elif request_type == 'history-top':
            # Get top performers
            top = await self.get_history_top(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-top',
                'data': top
            })

        elif request_type == 'history-sessions':
            # Get aircraft sessions
            sessions = await self.get_history_sessions(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-sessions',
                'data': sessions
            })

        elif request_type == 'history-analytics-distance':
            # Get distance analytics
            analytics = await self.get_distance_analytics(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-analytics-distance',
                'data': analytics
            })

        elif request_type == 'history-analytics-speed':
            # Get speed analytics
            analytics = await self.get_speed_analytics(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-analytics-speed',
                'data': analytics
            })

        elif request_type == 'history-analytics-correlation':
            # Get correlation analytics
            analytics = await self.get_correlation_analytics(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'history-analytics-correlation',
                'data': analytics
            })

        elif request_type == 'antenna-polar':
            # Get antenna polar coverage
            polar = await self.get_antenna_polar(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'antenna-polar',
                'data': polar
            })

        elif request_type == 'antenna-rssi':
            # Get RSSI vs distance data
            rssi = await self.get_antenna_rssi(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'antenna-rssi',
                'data': rssi
            })

        elif request_type == 'antenna-summary':
            # Get antenna performance summary
            summary = await self.get_antenna_summary(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'antenna-summary',
                'data': summary
            })

        elif request_type == 'antenna-analytics':
            # Get all antenna analytics data
            analytics = await self.get_antenna_analytics(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'antenna-analytics',
                'data': analytics
            })

        elif request_type == 'photo' or request_type == 'photo-cache':
            # Get aircraft photo URL
            icao = params.get('icao') or params.get('hex')
            if icao:
                photo_data = await self.get_aircraft_photo(icao, params)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': request_type,
                    'data': photo_data
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing icao parameter'
                })

        elif request_type == 'safety-stats':
            # Get safety statistics
            stats = await self.get_safety_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'safety-stats',
                'data': stats
            })

        elif request_type == 'acars-stats':
            # Get ACARS statistics
            stats = await self.get_acars_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'acars-stats',
                'data': stats
            })

        # Aviation data requests (delegated from /ws/all/)
        elif request_type == 'airports':
            airports = await self.get_airports(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'airports',
                'data': airports
            })

        elif request_type == 'navaids':
            navaids = await self.get_navaids(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'navaids',
                'data': navaids
            })

        elif request_type in ('airspaces', 'airspace-boundaries', 'boundaries'):
            boundaries = await self.get_airspace_boundaries(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': request_type,
                'data': boundaries
            })

        elif request_type == 'safety-events':
            events = await self.get_safety_events(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'safety-events',
                'data': events
            })

        else:
            await super().handle_request(request_type, request_id, params)

    async def send_initial_state(self):
        """Send initial aircraft snapshot on connect."""
        # Get current aircraft from cache
        aircraft_list = await self.get_current_aircraft()

        await self.send_json({
            'type': 'aircraft:snapshot',
            'data': {
                'aircraft': aircraft_list,
                'count': len(aircraft_list),
                'timestamp': datetime.utcnow().isoformat()
            }
        })

    @sync_to_async
    def get_current_aircraft(self):
        """Get current tracked aircraft from cache (cache-only, no DB)."""
        # Try to get from cache first
        cached = cache.get('current_aircraft')
        if cached:
            return cached
        return []

    @sync_to_async
    def get_aircraft_by_icao(self, icao: str):
        """Get single aircraft by ICAO hex code (cache-only, no DB)."""
        cached = cache.get('current_aircraft')
        if cached:
            for ac in cached:
                if ac.get('hex') == icao or ac.get('icao_hex') == icao:
                    return ac
        return None

    @sync_to_async
    def get_aircraft_list(self, filters: dict):
        """Get filtered aircraft list (cache-only, no DB)."""
        cached = cache.get('current_aircraft')
        if not cached:
            return []

        # Apply filters
        result = cached
        if filters.get('military_only'):
            result = [ac for ac in result if ac.get('is_military')]
        if filters.get('category'):
            cat = filters['category']
            result = [ac for ac in result if ac.get('category') == cat]
        if filters.get('min_altitude') is not None:
            min_alt = filters['min_altitude']
            result = [ac for ac in result if (ac.get('alt_baro') or 0) >= min_alt]
        if filters.get('max_altitude') is not None:
            max_alt = filters['max_altitude']
            result = [ac for ac in result if (ac.get('alt_baro') or 0) <= max_alt]

        return result

    @database_sync_to_async
    def get_aircraft_info(self, icao: str):
        """Get detailed aircraft info from database."""
        try:
            info = AircraftInfo.objects.get(icao_hex=icao.upper())
            return {
                'icao_hex': info.icao_hex,
                'registration': info.registration,
                'type_code': info.type_code,
                'manufacturer': info.manufacturer,
                'model': info.model,
                'operator': info.operator,
                'operator_icao': info.operator_icao,
                'owner': info.owner,
                'year_built': info.year_built,
                'serial_number': info.serial_number,
                'country': info.country,
                'category': info.category,
                'is_military': info.is_military,
                'photo_url': info.photo_url,
                'photo_photographer': info.photo_photographer,
                'source': info.source,
            }
        except AircraftInfo.DoesNotExist:
            return None

    @database_sync_to_async
    def get_aircraft_info_bulk(self, icaos: list):
        """Get detailed aircraft info for multiple ICAOs from database."""
        # Normalize and limit
        icao_list = [i.upper().strip() for i in icaos if i and not i.startswith('~')][:100]
        if not icao_list:
            return {'aircraft': {}, 'found': 0, 'requested': 0}

        result = {}
        for info in AircraftInfo.objects.filter(icao_hex__in=icao_list):
            result[info.icao_hex] = {
                'icao_hex': info.icao_hex,
                'registration': info.registration,
                'type_code': info.type_code,
                'manufacturer': info.manufacturer,
                'model': info.model,
                'operator': info.operator,
                'operator_icao': info.operator_icao,
                'owner': info.owner,
                'year_built': info.year_built,
                'serial_number': info.serial_number,
                'country': info.country,
                'category': info.category,
                'is_military': info.is_military,
                'photo_url': info.photo_url,
                'photo_photographer': info.photo_photographer,
                'source': info.source,
            }

        return {
            'aircraft': result,
            'found': len(result),
            'requested': len(icao_list)
        }

    @sync_to_async
    def get_aircraft_stats(self):
        """Get live aircraft statistics (cache-only, no DB)."""
        cached = cache.get('current_aircraft', [])

        military = sum(1 for ac in cached if ac.get('military'))
        emergency = sum(1 for ac in cached if ac.get('emergency'))

        # Count by category
        categories = {}
        for ac in cached:
            cat = ac.get('category', 'Unknown')
            categories[cat] = categories.get(cat, 0) + 1

        # Count by altitude band
        altitude_bands = {'ground': 0, 'low': 0, 'medium': 0, 'high': 0}
        for ac in cached:
            alt = ac.get('alt_baro') or ac.get('alt') or 0
            if alt < 500:
                altitude_bands['ground'] += 1
            elif alt < 10000:
                altitude_bands['low'] += 1
            elif alt < 30000:
                altitude_bands['medium'] += 1
            else:
                altitude_bands['high'] += 1

        return {
            'total': len(cached),
            'with_position': sum(1 for ac in cached if ac.get('lat')),
            'military': military,
            'emergency': emergency,
            'categories': categories,
            'altitude_bands': altitude_bands,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @sync_to_async
    def get_top_aircraft(self):
        """Get top 5 aircraft by various metrics (cache-only, no DB)."""
        cached = cache.get('current_aircraft', [])

        # Sort by different metrics
        with_position = [ac for ac in cached if ac.get('lat') and ac.get('lon')]

        closest = sorted(
            [ac for ac in with_position if ac.get('distance_nm')],
            key=lambda x: x.get('distance_nm', 999)
        )[:5]

        fastest = sorted(
            [ac for ac in with_position if ac.get('gs')],
            key=lambda x: x.get('gs', 0),
            reverse=True
        )[:5]

        highest = sorted(
            [ac for ac in with_position if ac.get('alt_baro') or ac.get('alt')],
            key=lambda x: x.get('alt_baro') or x.get('alt') or 0,
            reverse=True
        )[:5]

        return {
            'closest': closest,
            'fastest': fastest,
            'highest': highest,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_sightings(self, params: dict):
        """Get historical sightings."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        limit = _parse_int_param(params.get('limit'), 100, min_val=1, max_val=500)
        offset = _parse_int_param(params.get('offset'), 0, min_val=0)
        icao_hex = params.get('icao_hex')
        callsign = params.get('callsign')

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        if icao_hex:
            queryset = queryset.filter(icao_hex=icao_hex.upper())
        if callsign:
            queryset = queryset.filter(callsign__icontains=callsign)

        sightings = list(queryset.order_by('-timestamp')[offset:offset+limit].values(
            'id', 'timestamp', 'icao_hex', 'callsign', 'latitude', 'longitude',
            'altitude_baro', 'ground_speed', 'track', 'vertical_rate',
            'distance_nm', 'rssi', 'is_military'
        ))

        return {
            'sightings': sightings,
            'count': len(sightings),
            'hours': hours,
            'offset': offset,
            'limit': limit
        }

    @database_sync_to_async
    def get_history_stats(self, params: dict):
        """Get history statistics."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        military_only = params.get('military_only', False)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        if military_only:
            queryset = queryset.filter(is_military=True)

        stats = queryset.aggregate(
            total_sightings=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            avg_altitude=Avg('altitude_baro'),
            max_altitude=Max('altitude_baro'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm')
        )

        return {
            **stats,
            'hours': hours,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_history_trends(self, params: dict):
        """Get traffic trends."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        military_only = params.get('military_only', False)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        if military_only:
            queryset = queryset.filter(is_military=True)

        hourly = list(queryset.annotate(
            hour=TruncHour('timestamp')
        ).values('hour').annotate(
            count=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True)
        ).order_by('hour'))

        return {
            'hourly': hourly,
            'hours': hours,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_history_top(self, params: dict):
        """Get top performers."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        limit = _parse_int_param(params.get('limit'), 10, min_val=1, max_val=50)

        cutoff = timezone.now() - timedelta(hours=hours)
        sessions = AircraftSession.objects.filter(last_seen__gte=cutoff)

        longest = list(sessions.order_by('-total_positions')[:limit].values(
            'icao_hex', 'callsign', 'total_positions', 'first_seen', 'last_seen'
        ))

        furthest = list(sessions.filter(max_distance_nm__isnull=False).order_by('-max_distance_nm')[:limit].values(
            'icao_hex', 'callsign', 'max_distance_nm'
        ))

        highest = list(sessions.filter(max_altitude__isnull=False).order_by('-max_altitude')[:limit].values(
            'icao_hex', 'callsign', 'max_altitude'
        ))

        return {
            'longest': longest,
            'furthest': furthest,
            'highest': highest,
            'hours': hours,
            'limit': limit
        }

    @database_sync_to_async
    def get_history_sessions(self, params: dict):
        """Get aircraft sessions."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        limit = _parse_int_param(params.get('limit'), 50, min_val=1, max_val=200)
        icao_hex = params.get('icao_hex')

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSession.objects.filter(last_seen__gte=cutoff)

        if icao_hex:
            queryset = queryset.filter(icao_hex=icao_hex.upper())

        sessions = list(queryset.order_by('-last_seen')[:limit].values(
            'id', 'icao_hex', 'callsign', 'first_seen', 'last_seen',
            'total_positions', 'min_altitude', 'max_altitude',
            'min_distance_nm', 'max_distance_nm', 'is_military'
        ))

        return {
            'sessions': sessions,
            'count': len(sessions),
            'hours': hours
        }

    @database_sync_to_async
    def get_distance_analytics(self, params: dict):
        """Get distance analytics."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sessions = AircraftSession.objects.filter(
            last_seen__gte=cutoff,
            max_distance_nm__isnull=False
        )

        distances = list(sessions.values_list('max_distance_nm', flat=True))

        distribution = {
            '0-25nm': sum(1 for d in distances if d < 25),
            '25-50nm': sum(1 for d in distances if 25 <= d < 50),
            '50-100nm': sum(1 for d in distances if 50 <= d < 100),
            '100-150nm': sum(1 for d in distances if 100 <= d < 150),
            '150-200nm': sum(1 for d in distances if 150 <= d < 200),
            '200+nm': sum(1 for d in distances if d >= 200),
        }

        statistics = {}
        if distances:
            statistics = {
                'count': len(distances),
                'mean_nm': round(stats_lib.mean(distances), 1),
                'median_nm': round(stats_lib.median(distances), 1),
                'max_nm': round(max(distances), 1),
            }

        return {
            'distribution': distribution,
            'statistics': statistics,
            'hours': hours
        }

    @database_sync_to_async
    def get_speed_analytics(self, params: dict):
        """Get speed analytics."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            ground_speed__isnull=False,
            ground_speed__gt=0
        )

        # Limit to 1000 rows to reduce memory usage; add pagination if larger datasets needed
        speeds = list(sightings.values_list('ground_speed', flat=True)[:1000])

        distribution = {
            '0-100kt': sum(1 for s in speeds if s < 100),
            '100-200kt': sum(1 for s in speeds if 100 <= s < 200),
            '200-300kt': sum(1 for s in speeds if 200 <= s < 300),
            '300-400kt': sum(1 for s in speeds if 300 <= s < 400),
            '400-500kt': sum(1 for s in speeds if 400 <= s < 500),
            '500+kt': sum(1 for s in speeds if s >= 500),
        }

        statistics = {}
        if speeds:
            statistics = {
                'count': len(speeds),
                'mean_kt': round(stats_lib.mean(speeds)),
                'median_kt': round(stats_lib.median(speeds)),
                'max_kt': round(max(speeds)),
            }

        return {
            'distribution': distribution,
            'statistics': statistics,
            'hours': hours
        }

    @database_sync_to_async
    def get_correlation_analytics(self, params: dict):
        """Get correlation analytics."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        # Altitude vs Speed correlation
        altitude_bands = sightings.filter(
            altitude_baro__isnull=False,
            ground_speed__isnull=False
        ).annotate(
            altitude_band=Case(
                When(altitude_baro__lt=10000, then=Value('0-10k')),
                When(altitude_baro__lt=20000, then=Value('10-20k')),
                When(altitude_baro__lt=30000, then=Value('20-30k')),
                When(altitude_baro__lt=40000, then=Value('30-40k')),
                default=Value('40k+'),
                output_field=CharField()
            )
        ).values('altitude_band').annotate(
            avg_speed=Avg('ground_speed'),
            sample_count=Count('id')
        )

        altitude_vs_speed = [{
            'altitude_band': row['altitude_band'],
            'avg_speed': round(row['avg_speed']) if row['avg_speed'] else None,
            'sample_count': row['sample_count']
        } for row in altitude_bands]

        # Time of day patterns
        hourly = sightings.annotate(
            hour=ExtractHour('timestamp')
        ).values('hour').annotate(
            unique_aircraft=Count('icao_hex', distinct=True),
            position_count=Count('id')
        ).order_by('hour')

        time_patterns = list(hourly)

        return {
            'altitude_vs_speed': altitude_vs_speed,
            'time_of_day_patterns': time_patterns,
            'hours': hours
        }

    @database_sync_to_async
    def get_antenna_polar(self, params: dict):
        """Get antenna polar coverage data."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            track__isnull=False,
            distance_nm__isnull=False
        )

        bearing_data_raw = sightings.annotate(
            bearing_sector=Floor(F('track') / 10) * 10
        ).values('bearing_sector').annotate(
            count=Count('id'),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            unique_aircraft=Count('icao_hex', distinct=True)
        ).order_by('bearing_sector')

        bearing_data = []
        for row in bearing_data_raw:
            sector = int(row['bearing_sector']) if row['bearing_sector'] else 0
            bearing_data.append({
                'bearing_start': sector,
                'bearing_end': (sector + 10) % 360,
                'count': row['count'] or 0,
                'avg_distance_nm': round(row['avg_distance'], 1) if row['avg_distance'] else None,
                'max_distance_nm': round(row['max_distance'], 1) if row['max_distance'] else None,
                'unique_aircraft': row['unique_aircraft'] or 0,
            })

        return {
            'bearing_data': bearing_data,
            'hours': hours
        }

    @database_sync_to_async
    def get_antenna_rssi(self, params: dict):
        """Get RSSI vs distance data."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        sample_size = _parse_int_param(params.get('sample_size'), 500, min_val=1, max_val=1000)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            rssi__isnull=False,
            distance_nm__isnull=False,
            distance_nm__gt=0
        )

        # Use deterministic ordering to avoid full table scan from order_by('?')
        scatter_data = list(sightings.order_by('-timestamp').values(
            'distance_nm', 'rssi', 'altitude_baro', 'icao_hex'
        )[:sample_size])

        scatter_result = [{
            'distance_nm': round(row['distance_nm'], 1),
            'rssi': round(row['rssi'], 1),
            'altitude': row['altitude_baro'],
            'icao': row['icao_hex'],
        } for row in scatter_data]

        return {
            'scatter_data': scatter_result,
            'sample_size': len(scatter_result),
            'hours': hours
        }

    @database_sync_to_async
    def get_antenna_summary(self, params: dict):
        """Get antenna performance summary."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            distance_nm__isnull=False
        )

        range_stats = sightings.aggregate(
            total_sightings=Count('id'),
            unique_aircraft=Count('icao_hex', distinct=True),
            avg_distance=Avg('distance_nm'),
            max_distance=Max('distance_nm'),
            min_distance=Min('distance_nm')
        )

        rssi_stats = sightings.filter(rssi__isnull=False).aggregate(
            avg_rssi=Avg('rssi'),
            min_rssi=Min('rssi'),
            max_rssi=Max('rssi')
        )

        return {
            'range': {
                'total_sightings': range_stats['total_sightings'] or 0,
                'unique_aircraft': range_stats['unique_aircraft'] or 0,
                'avg_nm': round(range_stats['avg_distance'], 1) if range_stats['avg_distance'] else None,
                'max_nm': round(range_stats['max_distance'], 1) if range_stats['max_distance'] else None,
            },
            'signal': {
                'avg_rssi': round(rssi_stats['avg_rssi'], 1) if rssi_stats['avg_rssi'] else None,
                'best_rssi': round(rssi_stats['max_rssi'], 1) if rssi_stats['max_rssi'] else None,
                'worst_rssi': round(rssi_stats['min_rssi'], 1) if rssi_stats['min_rssi'] else None,
            },
            'hours': hours
        }

    async def get_antenna_analytics(self, params: dict):
        """Get all antenna analytics combined."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)

        # Wrap sync DB calls with sync_to_async to avoid blocking async context
        polar_data = await sync_to_async(self._get_polar_sync)(hours)
        rssi_data = await sync_to_async(self._get_rssi_sync)(hours)
        summary_data = await sync_to_async(self._get_summary_sync)(hours)

        return {
            'polar': polar_data,
            'rssi': rssi_data,
            'summary': summary_data,
            'hours': hours
        }

    def _get_polar_sync(self, hours):
        """Synchronous polar data fetch."""
        cutoff = timezone.now() - timedelta(hours=hours)
        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            track__isnull=False,
            distance_nm__isnull=False
        )
        return list(sightings.annotate(
            bearing_sector=Floor(F('track') / 10) * 10
        ).values('bearing_sector').annotate(
            count=Count('id'),
            max_distance=Max('distance_nm')
        ))

    def _get_rssi_sync(self, hours):
        """Synchronous RSSI data fetch."""
        cutoff = timezone.now() - timedelta(hours=hours)
        return list(AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            rssi__isnull=False,
            distance_nm__isnull=False
        # Use deterministic ordering to avoid full table scan from order_by('?')
        ).order_by('-timestamp').values('distance_nm', 'rssi')[:200])

    def _get_summary_sync(self, hours):
        """Synchronous summary data fetch."""
        cutoff = timezone.now() - timedelta(hours=hours)
        return AircraftSighting.objects.filter(
            timestamp__gte=cutoff
        ).aggregate(
            total=Count('id'),
            max_range=Max('distance_nm'),
            avg_rssi=Avg('rssi')
        )

    @database_sync_to_async
    def get_aircraft_photo(self, icao: str, params: dict):
        """Get aircraft photo URL."""
        from skyspy.services.aircraft_info import get_aircraft_photo
        prefer_thumbnail = params.get('thumbnail', False)
        photo_url = get_aircraft_photo(icao, prefer_thumbnail=prefer_thumbnail)

        # Also try to get from database for more details
        try:
            info = AircraftInfo.objects.filter(icao_hex=icao.upper()).first()
            if info:
                return {
                    'icao': icao.upper(),
                    'photo_url': photo_url or info.photo_url,
                    'photo_thumbnail_url': info.photo_thumbnail_url,
                    'photo_page_link': info.photo_page_link,
                    'photo_photographer': info.photo_photographer,
                    'photo_source': info.photo_source,
                }
        except Exception:
            pass

        return {
            'icao': icao.upper(),
            'photo_url': photo_url,
        }

    @database_sync_to_async
    def get_safety_stats(self):
        """Get safety event statistics."""
        from skyspy.models import SafetyEvent
        cutoff = timezone.now() - timedelta(hours=24)

        events = SafetyEvent.objects.filter(timestamp__gte=cutoff)
        total = events.count()

        by_type = dict(events.values('event_type').annotate(
            count=Count('id')
        ).values_list('event_type', 'count'))

        by_severity = dict(events.values('severity').annotate(
            count=Count('id')
        ).values_list('severity', 'count'))

        return {
            'total_24h': total,
            'by_type': by_type,
            'by_severity': by_severity,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }

    @database_sync_to_async
    def get_acars_stats(self):
        """Get ACARS statistics."""
        from skyspy.models import AcarsMessage
        cutoff = timezone.now() - timedelta(hours=24)

        messages = AcarsMessage.objects.filter(timestamp__gte=cutoff)
        total = messages.count()

        by_label = dict(messages.values('label').annotate(
            count=Count('id')
        ).values_list('label', 'count')[:20])

        return {
            'total_24h': total,
            'by_label': by_label,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }

    # Aviation data methods for /ws/all/ requests

    @database_sync_to_async
    def get_airports(self, params: dict):
        """Get nearby airports."""
        from skyspy.models import CachedAirport
        from django.conf import settings

        lat = params.get('lat', settings.FEEDER_LAT)
        lon = params.get('lon', settings.FEEDER_LON)
        radius_nm = params.get('radius', params.get('radius_nm', 50))
        limit = _parse_int_param(params.get('limit'), 20, min_val=1, max_val=100)

        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = CachedAirport.objects.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta
        )

        airports = []
        for apt in queryset[:limit]:
            airports.append({
                'icao': apt.icao_id,
                'name': apt.name,
                'lat': apt.latitude,
                'lon': apt.longitude,
                'elev': apt.elevation_ft,
                'type': apt.airport_type,
            })
        return airports

    @database_sync_to_async
    def get_navaids(self, params: dict):
        """Get nearby navigation aids."""
        from skyspy.models import CachedNavaid
        from django.conf import settings

        lat = params.get('lat', settings.FEEDER_LAT)
        lon = params.get('lon', settings.FEEDER_LON)
        radius_nm = params.get('radius', params.get('radius_nm', 100))
        limit = _parse_int_param(params.get('limit'), 50, min_val=1, max_val=200)

        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = CachedNavaid.objects.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta
        )

        navaids = []
        for nav in queryset[:limit]:
            navaids.append({
                'id': nav.ident,
                'name': nav.name,
                'type': nav.navaid_type,
                'lat': nav.latitude,
                'lon': nav.longitude,
                'freq': nav.frequency,
            })
        return navaids

    @database_sync_to_async
    def get_airspace_boundaries(self, params: dict):
        """Get airspace boundaries."""
        from skyspy.models import AirspaceBoundary
        from django.conf import settings

        lat = params.get('lat', settings.FEEDER_LAT)
        lon = params.get('lon', settings.FEEDER_LON)
        radius_nm = params.get('radius', params.get('radius_nm', 100))

        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = AirspaceBoundary.objects.filter(
            center_lat__gte=lat - lat_delta,
            center_lat__lte=lat + lat_delta,
            center_lon__gte=lon - lon_delta,
            center_lon__lte=lon + lon_delta
        )

        boundaries = []
        for b in queryset[:200]:
            boundaries.append({
                'id': b.id,
                'name': b.name,
                'icao': b.icao,
                'class': b.airspace_class,
                'floor': b.floor_ft,
                'ceiling': b.ceiling_ft,
                'lat': b.center_lat,
                'lon': b.center_lon,
                'radius': b.radius_nm,
                'polygon': b.polygon,
            })
        return boundaries

    @database_sync_to_async
    def get_safety_events(self, params: dict):
        """Get recent safety events."""
        from skyspy.models import SafetyEvent

        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        limit = _parse_int_param(params.get('limit'), 50, min_val=1, max_val=200)
        cutoff = timezone.now() - timedelta(hours=hours)

        events = SafetyEvent.objects.filter(timestamp__gte=cutoff).order_by('-timestamp')[:limit]

        result = []
        for e in events:
            result.append({
                'id': str(e.id),
                'event_type': e.event_type,
                'severity': e.severity,
                'icao_hex': e.icao_hex,
                'callsign': e.callsign,
                'timestamp': e.timestamp.isoformat() if e.timestamp else None,
                'description': e.description,
                'acknowledged': e.acknowledged,
            })
        return result

    # Channel layer message handlers

    async def aircraft_snapshot(self, event):
        """Handle aircraft snapshot broadcast."""
        await self.send_json({
            'type': 'aircraft:snapshot',
            'data': event['data']
        })

    async def aircraft_new(self, event):
        """Handle new aircraft broadcast."""
        await self.send_json({
            'type': 'aircraft:new',
            'data': event['data']
        })

    async def aircraft_update(self, event):
        """Handle aircraft update broadcast."""
        await self.send_json({
            'type': 'aircraft:update',
            'data': event['data']
        })

    async def aircraft_remove(self, event):
        """Handle aircraft removal broadcast."""
        await self.send_json({
            'type': 'aircraft:remove',
            'data': event['data']
        })

    async def aircraft_heartbeat(self, event):
        """Handle heartbeat broadcast."""
        await self.send_json({
            'type': 'aircraft:heartbeat',
            'data': event['data']
        })

    async def aircraft_position(self, event):
        """Handle position-only update (high frequency)."""
        await self.send_json({
            'type': 'aircraft:position',
            'data': event['data']
        })

    async def antenna_analytics_update(self, event):
        """Handle antenna analytics update broadcast."""
        await self.send_json({
            'type': 'antenna:analytics',
            'data': event['data']
        })

    async def positions_update(self, event):
        """Handle position-only lightweight update."""
        await self.send_json({
            'type': 'positions:update',
            'data': event['data']
        })

    async def airframe_error(self, event):
        """Handle airframe lookup error broadcast."""
        await self.send_json({
            'type': 'airframe:error',
            'data': event['data']
        })

    async def stats_update(self, event):
        """Handle stats update broadcast."""
        await self.send_json({
            'type': 'stats:update',
            'data': event['data']
        })

    async def aircraft_delta(self, event):
        """Handle delta update broadcast (RPi optimization)."""
        await self.send_json({
            'type': 'aircraft:delta',
            'data': event['data']
        })

    def _compute_delta(self, icao: str, current: dict) -> Optional[dict]:
        """
        Compute delta (changed fields only) for an aircraft.

        Returns None if no changes, otherwise returns dict with changed fields.
        """
        previous = self._previous_aircraft_state.get(icao)

        if previous is None:
            # First time seeing this aircraft, store and return None (send full update)
            self._previous_aircraft_state[icao] = current.copy()
            return None

        changes = {}
        for field in self.DELTA_FIELDS:
            curr_val = current.get(field)
            prev_val = previous.get(field)
            if curr_val != prev_val:
                changes[field] = curr_val

        # Update stored state
        self._previous_aircraft_state[icao] = current.copy()

        if changes:
            return {'hex': icao, 'changes': changes}
        return None

    def _cleanup_delta_state(self, active_icaos: set):
        """Remove stale aircraft from delta tracking state."""
        stale = set(self._previous_aircraft_state.keys()) - active_icaos
        for icao in stale:
            self._previous_aircraft_state.pop(icao, None)
